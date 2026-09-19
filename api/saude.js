// Porta de entrada dos dados do app Saude. Recebe um POST do Atalho do
// iPhone e grava na tabela saude_dias. Nao usa login: quem identifica a
// pessoa e a chave que vai no cabecalho x-chave, conferida em saude_chaves.
//
// Escrito no MESMO formato dos outros arquivos deste projeto (auth-proxy.js
// e auth/[...path].js): runtime edge, ESM, recebendo Request e devolvendo
// Response. A primeira versao estava em CommonJS com (req, res) e destoava
// do resto - e o projeto inteiro e compilado como ESM, entao o formato
// tinha que ser esse.
//
// SEM DEPENDENCIA NENHUMA, de proposito: este projeto nao tem package.json,
// entao um require('@neondatabase/serverless') nunca acharia o pacote. A
// conversa com o banco e um POST comum no endpoint SQL-over-HTTP do Neon,
// que e exatamente o que aquele pacote faz por baixo.
//
// Variavel de ambiente necessaria na Vercel:
//   DATABASE_URL = string de conexao do Neon (a "pooled")

export const config = { runtime: 'edge' };

// o endereco do endpoint SQL sai da propria DATABASE_URL: o host com /sql
function enderecoSql(url){
  const m = /@([^/:]+)/.exec(String(url || ''));
  if(!m) throw new Error('DATABASE_URL sem host reconhecivel');
  return 'https://' + m[1] + '/sql';
}

async function sql(texto, params){
  const url = process.env.DATABASE_URL;
  if(!url) throw new Error('falta a variavel DATABASE_URL na Vercel');
  const r = await fetch(enderecoSql(url), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Neon-Connection-String': url,
      'Neon-Raw-Text-Output': 'true',
      'Neon-Array-Mode': 'false'
    },
    body: JSON.stringify({ query: texto, params: params || [] })
  });
  const corpo = await r.json().catch(function(){ return null; });
  if(!r.ok){
    throw new Error((corpo && (corpo.message || corpo.error)) || ('HTTP ' + r.status));
  }
  return (corpo && corpo.rows) || [];
}

function json(dados, status){
  return new Response(JSON.stringify(dados), {
    status: status || 200,
    headers: { 'content-type': 'application/json; charset=utf-8' }
  });
}

function numero(v){
  if(v === null || v === undefined || v === '') return null;
  const n = Number(String(v).replace(',', '.').replace(/[^0-9.\-]/g, ''));
  return isFinite(n) ? n : null;
}
function inteiro(v){
  const n = numero(v);
  return n === null ? null : Math.round(n);
}
// "2026-09-19", "19/09/2026" ou um ISO completo viram sempre AAAA-MM-DD
function dataIso(v){
  const s = String(v || '').trim();
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if(m) return m[1] + '-' + m[2] + '-' + m[3];
  m = /^(\d{2})\/(\d{2})\/(\d{4})/.exec(s);
  if(m) return m[3] + '-' + m[2] + '-' + m[1];
  return null;
}

export default async function handler(request){
  // o Atalho manda POST; um GET no mesmo endereco serve de teste de vida
  if(request.method === 'GET'){
    return json({ ok: true, pronto: !!process.env.DATABASE_URL });
  }
  if(request.method !== 'POST'){
    return json({ erro: 'use POST' }, 405);
  }
  try{
    const chave = request.headers.get('x-chave');
    if(!chave) return json({ erro: 'falta o cabecalho x-chave' }, 401);

    const dono = await sql(
      'select organization_id, user_id, nome from saude_chaves where chave = $1',
      [String(chave)]
    );
    if(!dono.length) return json({ erro: 'chave desconhecida' }, 401);
    const organization_id = dono[0].organization_id;
    const user_id = dono[0].user_id;
    const nome = dono[0].nome;

    let corpo = null;
    try{ corpo = await request.json(); }catch(e){ corpo = null; }
    if(!corpo || typeof corpo !== 'object'){
      return json({ erro: 'corpo precisa ser um JSON' }, 400);
    }

    // sem dia informado, e hoje no fuso de Sao Paulo (o Atalho as vezes
    // manda a data em UTC, o que jogaria o treino da noite pro dia seguinte)
    const dia = dataIso(corpo.dia) ||
      new Date(Date.now() - 3 * 3600 * 1000).toISOString().slice(0, 10);

    const treinos = Array.isArray(corpo.treinos) ? corpo.treinos : [];

    await sql(
      'insert into saude_dias' +
      ' (organization_id, user_id, dia, kcal_ativa, kcal_repouso, minutos_exercicio, passos, treinos, atualizado_em)' +
      ' values ($1,$2,$3,$4,$5,$6,$7,$8::jsonb, now())' +
      ' on conflict (organization_id, user_id, dia) do update set' +
      '   kcal_ativa        = coalesce(excluded.kcal_ativa, saude_dias.kcal_ativa),' +
      '   kcal_repouso      = coalesce(excluded.kcal_repouso, saude_dias.kcal_repouso),' +
      '   minutos_exercicio = coalesce(excluded.minutos_exercicio, saude_dias.minutos_exercicio),' +
      '   passos            = coalesce(excluded.passos, saude_dias.passos),' +
      '   treinos           = case when jsonb_array_length(excluded.treinos) > 0' +
      '                            then excluded.treinos else saude_dias.treinos end,' +
      '   atualizado_em     = now()',
      [organization_id, user_id, dia,
       numero(corpo.kcal_ativa), numero(corpo.kcal_repouso),
       inteiro(corpo.minutos_exercicio), inteiro(corpo.passos),
       JSON.stringify(treinos)]
    );
    await sql('update saude_chaves set ultimo_envio = now() where chave = $1', [String(chave)]);

    return json({ ok: true, pessoa: nome, dia: dia, treinos: treinos.length });
  }catch(e){
    // erro sempre visivel: e o Atalho do iPhone do outro lado, e ele so
    // mostra o que a resposta disser
    return json({ erro: 'falhou ao gravar', detalhe: String((e && e.message) || e) }, 500);
  }
}

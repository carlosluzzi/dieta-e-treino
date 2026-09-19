/* =========================================================
   api/saude.js  -  porta de entrada dos dados do app Saúde
   =========================================================
   Recebe um POST do Atalho do iPhone e grava na tabela saude_dias.
   Não usa login: quem identifica a pessoa é a chave que vai no
   cabeçalho, conferida na tabela saude_chaves.

   SEM DEPENDÊNCIA NENHUMA, de propósito. A versão anterior usava
   `@neondatabase/serverless`, e este projeto não tem package.json -
   ou seja, na Vercel aquele require nunca ia achar o pacote e a
   função quebraria antes de rodar uma linha. Aqui a conversa com o
   banco é um POST comum no endpoint SQL-over-HTTP do Neon, que é
   exatamente o que aquele pacote faz por baixo. O outro arquivo do
   projeto (auth-proxy.js) também não tem dependência: o projeto
   segue sendo só HTML + funções, sem build e sem node_modules.

   Variável de ambiente necessária na Vercel:
     DATABASE_URL = string de conexão do Neon (a "pooled", que
                    começa com postgresql://)

   Exemplo de corpo (tudo opcional menos o dia):
   {
     "dia": "2026-09-19",
     "kcal_ativa": 612,
     "kcal_repouso": 1740,
     "minutos_exercicio": 64,
     "passos": 8412,
     "treinos": [
       {"tipo":"Musculação","inicio":"2026-09-19T18:30:00-03:00","minutos":58,"kcal":380}
     ]
   }
   ========================================================= */

/* ---- conversa com o Neon por HTTP, sem pacote ----
   O endereço do endpoint SQL sai da própria DATABASE_URL: o host do
   banco com /sql no fim. */
function enderecoSql(url){
  const m = /@([^/:]+)/.exec(String(url || ''));
  if(!m) throw new Error('DATABASE_URL sem host reconhecível');
  return 'https://' + m[1] + '/sql';
}

async function sql(texto, params){
  const url = process.env.DATABASE_URL;
  if(!url) throw new Error('falta a variável DATABASE_URL na Vercel');
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
    const detalhe = (corpo && (corpo.message || corpo.error)) || ('HTTP ' + r.status);
    throw new Error(detalhe);
  }
  return (corpo && corpo.rows) || [];
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
/* "2026-09-19", "19/09/2026" ou um ISO completo viram sempre AAAA-MM-DD */
function dataIso(v){
  const s = String(v || '').trim();
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if(m) return m[1] + '-' + m[2] + '-' + m[3];
  m = /^(\d{2})\/(\d{2})\/(\d{4})/.exec(s);
  if(m) return m[3] + '-' + m[2] + '-' + m[1];
  return null;
}

module.exports = async function handler(req, res){
  // o Atalho manda POST; um GET no mesmo endereço serve de teste de vida
  if(req.method === 'GET'){
    return res.status(200).json({ ok: true, pronto: !!process.env.DATABASE_URL });
  }
  if(req.method !== 'POST'){
    return res.status(405).json({ erro: 'use POST' });
  }
  try{
    const chave = req.headers['x-chave'];
    if(!chave) return res.status(401).json({ erro: 'falta o cabeçalho x-chave' });

    const dono = await sql(
      'select organization_id, user_id, nome from saude_chaves where chave = $1',
      [String(chave)]
    );
    if(!dono.length) return res.status(401).json({ erro: 'chave desconhecida' });
    const organization_id = dono[0].organization_id;
    const user_id = dono[0].user_id;
    const nome = dono[0].nome;

    let corpo = req.body;
    if(typeof corpo === 'string'){
      try{ corpo = JSON.parse(corpo); }catch(e){ corpo = null; }
    }
    if(!corpo || typeof corpo !== 'object'){
      return res.status(400).json({ erro: 'corpo precisa ser um JSON' });
    }

    // sem dia informado, é hoje no fuso de São Paulo (o Atalho às vezes
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

    return res.status(200).json({ ok: true, pessoa: nome, dia: dia, treinos: treinos.length });
  }catch(e){
    // erro sempre visível: é o Atalho do iPhone do outro lado, e ele só
    // mostra o que a resposta disser
    return res.status(500).json({ erro: 'falhou ao gravar', detalhe: String((e && e.message) || e) });
  }
};

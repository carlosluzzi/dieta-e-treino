/* =========================================================
   api/saude.js  -  porta de entrada dos dados do app Saúde
   =========================================================
   Recebe um POST do Atalho do iPhone e grava na tabela
   saude_dias. Não usa login: quem identifica a pessoa é a
   chave que vai no cabeçalho, conferida na tabela
   saude_chaves.

   Variável de ambiente necessária na Vercel:
     DATABASE_URL  = string de conexão do Neon (pooled)

   Exemplo de corpo (tudo opcional menos o dia):
   {
     "dia": "2026-09-15",
     "kcal_ativa": 612,
     "kcal_repouso": 1740,
     "minutos_exercicio": 64,
     "passos": 8412,
     "treinos": [
       {"tipo":"Musculação","inicio":"2026-09-15T18:30:00-03:00","minutos":58,"kcal":380}
     ]
   }
   ========================================================= */
const { neon } = require('@neondatabase/serverless');

function numero(v){
  if(v === null || v === undefined || v === '') return null;
  const n = Number(String(v).replace(',', '.').replace(/[^0-9.\-]/g, ''));
  return isFinite(n) ? n : null;
}
function inteiro(v){
  const n = numero(v);
  return n === null ? null : Math.round(n);
}

module.exports = async function handler(req, res){
  if(req.method === 'OPTIONS'){
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'content-type, x-chave');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    return res.status(204).end();
  }
  if(req.method !== 'POST') return res.status(405).json({ erro: 'use POST' });

  const chave = req.headers['x-chave'] || (req.body && req.body.chave);
  if(!chave) return res.status(401).json({ erro: 'sem chave' });

  let corpo = req.body;
  if(typeof corpo === 'string'){
    try{ corpo = JSON.parse(corpo); }catch(e){ return res.status(400).json({ erro: 'json inválido' }); }
  }
  if(!corpo) return res.status(400).json({ erro: 'corpo vazio' });

  const sql = neon(process.env.DATABASE_URL);
  try{
    const dono = await sql`select organization_id, user_id, nome from saude_chaves where chave = ${chave}`;
    if(!dono.length) return res.status(403).json({ erro: 'chave desconhecida' });
    const { organization_id, user_id, nome } = dono[0];

    // sem data no corpo = hoje no fuso de São Paulo
    const dia = (corpo.dia && String(corpo.dia).slice(0, 10))
      || new Date(Date.now() - 3*3600*1000).toISOString().slice(0, 10);

    const treinos = Array.isArray(corpo.treinos) ? corpo.treinos : [];

    await sql`
      insert into saude_dias
        (organization_id, user_id, dia, kcal_ativa, kcal_repouso, minutos_exercicio, passos, treinos, atualizado_em)
      values
        (${organization_id}, ${user_id}, ${dia}, ${numero(corpo.kcal_ativa)}, ${numero(corpo.kcal_repouso)},
         ${inteiro(corpo.minutos_exercicio)}, ${inteiro(corpo.passos)}, ${JSON.stringify(treinos)}, now())
      on conflict (organization_id, user_id, dia) do update set
        kcal_ativa        = coalesce(excluded.kcal_ativa, saude_dias.kcal_ativa),
        kcal_repouso      = coalesce(excluded.kcal_repouso, saude_dias.kcal_repouso),
        minutos_exercicio = coalesce(excluded.minutos_exercicio, saude_dias.minutos_exercicio),
        passos            = coalesce(excluded.passos, saude_dias.passos),
        treinos           = case when jsonb_array_length(excluded.treinos) > 0
                                 then excluded.treinos else saude_dias.treinos end,
        atualizado_em     = now()
    `;
    await sql`update saude_chaves set ultimo_envio = now() where chave = ${chave}`;

    return res.status(200).json({ ok: true, pessoa: nome, dia: dia, treinos: treinos.length });
  }catch(e){
    return res.status(500).json({ erro: 'falhou ao gravar', detalhe: String(e && e.message || e) });
  }
};

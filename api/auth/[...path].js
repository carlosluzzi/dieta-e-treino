// Proxy de autenticacao: o app (dieta-e-treino-sage.vercel.app) chama esse
// endereco (/api/auth/...) em vez de chamar o serviço de login (neon.tech)
// diretamente. Assim o cookie de sessao vira "do mesmo site" pro navegador
// (inclusive Safari no iPhone), em vez de "de outro site" - que e o que
// estava fazendo o login falhar so no celular.
//
// So encaminha um conjunto pequeno e conhecido de cabecalhos (em vez de
// copiar tudo que chegou) e fixa o cabecalho de endereco (host) pro
// endereco de destino na mao - porque o servico de login rejeita pedidos
// cujo cabecalho de endereco nao bate com o dele ("Invalid hostname
// header"), e plataformas de funcao as vezes adicionam cabecalhos extras
// (tipo x-forwarded-host) que entregam o endereco original sem eu pedir.

export const config = { runtime: 'edge' };

var DESTINO_BASE = 'https://ep-soft-bread-ac808or4.neonauth.sa-east-1.aws.neon.tech/dieta_treino/auth';
var DESTINO_HOST = new URL(DESTINO_BASE).host;

export default async function handler(request) {
  var url = new URL(request.url);
  var caminho = url.pathname.replace(/^\/api\/auth/, '');
  var destino = DESTINO_BASE + caminho + url.search;

  var headers = new Headers();
  headers.set('host', DESTINO_HOST);
  ['content-type', 'cookie', 'accept', 'origin', 'user-agent'].forEach(function(nome){
    var v = request.headers.get(nome);
    if (v) headers.set(nome, v);
  });

  // modo de diagnostico temporario: /api/auth/qualquercoisa?debug=1
  // devolve o que SERIA enviado, sem realmente enviar - so pra eu conferir
  // rapido sem precisar pedir mais um teste no celular.
  if (url.searchParams.get('debug') === '1') {
    var vistos = {};
    headers.forEach(function(v, k){ vistos[k] = v; });
    return new Response(JSON.stringify({ destino: destino, headersQueEuMandaria: vistos }, null, 2), {
      status: 200,
      headers: { 'content-type': 'application/json' }
    });
  }

  var temCorpo = !(request.method === 'GET' || request.method === 'HEAD');

  var resposta;
  try {
    resposta = await fetch(destino, {
      method: request.method,
      headers: headers,
      body: temCorpo ? await request.arrayBuffer() : undefined,
      redirect: 'manual'
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: 'Falha ao falar com o serviço de login', detalhe: String(e && e.message || e) }), {
      status: 502,
      headers: { 'content-type': 'application/json' }
    });
  }

  var respHeaders = new Headers(resposta.headers);
  respHeaders.delete('content-encoding');
  respHeaders.delete('content-length');

  return new Response(resposta.body, {
    status: resposta.status,
    headers: respHeaders
  });
}

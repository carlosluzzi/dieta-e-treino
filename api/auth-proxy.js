// Proxy de autenticacao. O app (dieta-e-treino-sage.vercel.app) chama esse
// endereco (/api/auth/...) em vez de chamar o serviço de login
// (neonauth...neon.tech) diretamente. Assim o cookie de sessao vira "do
// mesmo site" pro navegador (inclusive Safari no iPhone), em vez de "de
// outro site" - que era o motivo do login funcionar no computador mas nao
// no celular.
//
// O vercel.json manda todo pedido de /api/auth/... pra esse arquivo unico,
// passando o caminho de verdade como parametro (?path=...). Aqui a gente
// monta o endereco final com esse caminho, refaz o pedido do zero pro
// servico de login de verdade (com o cabecalho de endereco certo - o
// servico rejeita pedidos cujo cabecalho nao bate com o dele, com
// "Invalid hostname header"), e devolve a resposta dele (incluindo o
// cookie) como se tivesse vindo do proprio app.

export const config = { runtime: 'edge' };

var DESTINO_BASE = 'https://ep-soft-bread-ac808or4.neonauth.sa-east-1.aws.neon.tech/dieta_treino/auth';
var DESTINO_HOST = new URL(DESTINO_BASE).host;

export default async function handler(request) {
  var url = new URL(request.url);
  var caminho = url.searchParams.get('path') || '';
  url.searchParams.delete('path');

  var destino = DESTINO_BASE + (caminho ? '/' + caminho : '') + (url.search ? url.search : '');

  var headers = new Headers();
  headers.set('host', DESTINO_HOST);
  ['content-type', 'cookie', 'accept', 'origin', 'user-agent'].forEach(function(nome){
    var v = request.headers.get(nome);
    if (v) headers.set(nome, v);
  });

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

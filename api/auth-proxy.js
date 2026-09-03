// Proxy de autenticacao (versao 2). A tentativa anterior usava um arquivo
// com nome especial (api/auth/[...path].js) pra capturar qualquer caminho
// depois de /api/auth/ automaticamente - só que isso só funcionou pra
// caminhos de UM pedaço (tipo /api/auth/get-session) e nao pra caminhos de
// vários pedaços (tipo /api/auth/sign-in/email, que é exatamente o que o
// login usa!). Essa versao e mais simples e nao depende dessa convencao: o
// vercel.json manda TODO pedido de /api/auth/... pra esse arquivo unico,
// passando o caminho de verdade como um parametro (?path=...), e aqui a
// gente so monta o endereco final com ele.

export const config = { runtime: 'edge' };

var DESTINO_BASE = 'https://ep-soft-bread-ac808or4.neonauth.sa-east-1.aws.neon.tech/dieta_treino/auth';
var DESTINO_HOST = new URL(DESTINO_BASE).host;

export default async function handler(request) {
  var url = new URL(request.url);
  var caminho = url.searchParams.get('path') || '';
  url.searchParams.delete('path');
  var debug = url.searchParams.get('debug') === '1';
  url.searchParams.delete('debug');

  var destino = DESTINO_BASE + (caminho ? '/' + caminho : '') + (url.search ? url.search : '');

  var headers = new Headers();
  headers.set('host', DESTINO_HOST);
  ['content-type', 'cookie', 'accept', 'origin', 'user-agent'].forEach(function(nome){
    var v = request.headers.get(nome);
    if (v) headers.set(nome, v);
  });

  // modo de diagnostico temporario: /api/auth/qualquercoisa?debug=1
  if (debug) {
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

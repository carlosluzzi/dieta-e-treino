// Proxy de autenticacao: o app (dieta-e-treino-sage.vercel.app) chama esse
// endereco (/api/auth/...) em vez de chamar o serviço de login (neon.tech)
// diretamente. Assim o cookie de sessao vira "do mesmo site" pro navegador
// (inclusive Safari no iPhone), em vez de "de outro site" - que e o que
// estava fazendo o login falhar so no celular.
//
// Diferente de um simples "rewrite" do vercel.json (que so encaminha o
// pedido mantendo o endereco original no cabecalho, e o servico de login
// rejeita isso com "Invalid hostname header"), aqui a funcao faz um pedido
// NOVO de verdade pro servico de login, com o cabeçalho de endereco correto
// - e depois devolve a resposta dele (incluindo o cookie) como se tivesse
// vindo do proprio app.

export const config = { runtime: 'edge' };

var DESTINO_BASE = 'https://ep-soft-bread-ac808or4.neonauth.sa-east-1.aws.neon.tech/dieta_treino/auth';

export default async function handler(request) {
  var url = new URL(request.url);
  var caminho = url.pathname.replace(/^\/api\/auth/, '');
  var destino = DESTINO_BASE + caminho + url.search;

  var headers = new Headers(request.headers);
  headers.delete('host');
  headers.delete('content-length');
  headers.delete('connection');

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

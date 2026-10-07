/* =========================================================
   SERVICE WORKER - o app abre do aparelho, não da rede
   =========================================================
   Sem isto, cada abertura baixava o index.html inteiro (meio megabyte) e as
   bibliotecas do Neon do esm.sh (várias idas de rede encadeadas) ANTES de
   qualquer linha de JavaScript rodar - era o primeiro pedaço da espera na
   tela de abertura, e o único que nem o cache de dados do app alcançava.

   Regras:
   - index.html: o guardado responde NA HORA, e a rede atualiza por trás
     ("stale-while-revalidate"). Se a versão nova for diferente, a página é
     avisada (mensagem "nova-versao") e decide o que fazer: recarregar se
     ainda está na abertura, ou mostrar "Atualização pronta" pra tocar.
   - bibliotecas do esm.sh e ícones: guardado primeiro; só vai à rede o que
     ainda não está guardado (as versões são fixas na URL, não mudam).
   - /api/... (login) e o banco do Neon: NUNCA passam por aqui - são sempre
     rede, sempre frescos.
   ========================================================= */
var VERSAO = 'dt-v1';
var PRE = ['/', '/manifest.json', '/icons/icon-192.png', '/icons/icon-512.png', '/icons/apple-touch-icon.png'];

self.addEventListener('install', function(ev){
  ev.waitUntil(
    caches.open(VERSAO).then(function(c){
      return Promise.all(PRE.map(function(u){
        return fetch(u, { cache: 'no-cache' }).then(function(r){ if(r.ok) return c.put(u, r); }).catch(function(){});
      }));
    }).then(function(){ return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function(ev){
  ev.waitUntil(
    caches.keys().then(function(ks){
      return Promise.all(ks.filter(function(k){ return k !== VERSAO; }).map(function(k){ return caches.delete(k); }));
    }).then(function(){ return self.clients.claim(); })
  );
});

function ehPagina(url){
  return url.origin === self.location.origin && (url.pathname === '/' || url.pathname === '/index.html');
}
function ehBiblioteca(url){
  return /(^|\.)esm\.sh$/.test(url.hostname);
}
function ehEstatico(url){
  return url.origin === self.location.origin
    && (url.pathname.indexOf('/icons/') === 0 || url.pathname === '/manifest.json');
}

function avisarClientes(msg){
  self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function(lista){
    lista.forEach(function(cl){ cl.postMessage(msg); });
  });
}

self.addEventListener('fetch', function(ev){
  var req = ev.request;
  if(req.method !== 'GET') return;
  var url;
  try{ url = new URL(req.url); }catch(e){ return; }

  if(ehPagina(url)){
    ev.respondWith(caches.open(VERSAO).then(function(c){
      return c.match('/').then(function(guardada){
        var daRede = fetch(new Request('/', { cache: 'no-cache' })).then(function(resp){
          if(!resp || !resp.ok) return resp;
          var copia = resp.clone();
          if(guardada){
            // só avisa a página quando o conteúdo mudou de verdade
            Promise.all([guardada.clone().text(), resp.clone().text()]).then(function(ts){
              if(ts[0] !== ts[1]) return c.put('/', copia).then(function(){ avisarClientes({ tipo: 'nova-versao' }); });
            }).catch(function(){});
          }else{
            c.put('/', copia).catch(function(){});
          }
          return resp;
        }).catch(function(){ return null; });
        if(guardada) return guardada;
        return daRede.then(function(r){ return r || new Response('Sem conexão', { status: 503 }); });
      });
    }));
    return;
  }

  if(ehBiblioteca(url) || ehEstatico(url)){
    ev.respondWith(caches.open(VERSAO).then(function(c){
      return c.match(req).then(function(guardada){
        if(guardada){
          // ícones e manifest ainda se atualizam por trás; as bibliotecas
          // têm versão na URL e não precisam
          if(ehEstatico(url)) fetch(req).then(function(r){ if(r && r.ok) c.put(req, r); }).catch(function(){});
          return guardada;
        }
        return fetch(req).then(function(r){
          if(r && (r.ok || r.type === 'opaque')) c.put(req, r.clone()).catch(function(){});
          return r;
        });
      });
    }));
    return;
  }
  // todo o resto (api, banco, fotos) segue direto pra rede
});

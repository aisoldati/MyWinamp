import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig} from 'vite';

export default defineConfig(() => {
  return {
    plugins: [
      react(),
      tailwindcss(),
      {
        name: 'winamp-api-server',
        configureServer(server) {
          server.middlewares.use(async (req, res, next) => {
            if (req.url && req.url.startsWith('/auth/youtube/callback')) {
              res.statusCode = 200;
              res.setHeader('Content-Type', 'text/html; charset=utf-8');
              res.end(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>Winamp - Conectado</title></head><body style="background:#0c0d10;color:#00e100;font-family:monospace;display:flex;flex-direction:column;align-items:center;justify-content:center;height:90vh;text-align:center;"><div style="border:2px solid #00e100;padding:24px;border-radius:6px;background:#14151b;"><h2 style="color:#22c55e;">⚡ ¡Conectado con YouTube Music!</h2><p id="msg" style="color:#aaa;">Guardando sesión en Winamp...</p><div id="status" style="font-size:12px;color:#888;">Cerrando pestaña automáticamente...</div></div><script>(function(){try{const p=new URLSearchParams(window.location.hash.substring(1)||window.location.search.substring(1));const t=p.get('access_token');if(t){try{localStorage.setItem('youtube_token',t);}catch(e){}fetch('/api/auth/callback-token',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token:t})}).then(()=>{document.getElementById('status').innerText='¡Listo! Puedes volver a Winamp.';setTimeout(()=>window.close(),800);});}}catch(e){}})();</script></body></html>`);
              return;
            }
            if (req.url && req.url.startsWith('/api/')) {
              try {
                const proxyHeaders: Record<string, string> = {};
                for (const [k, v] of Object.entries(req.headers)) {
                  const lk = k.toLowerCase();
                  if (lk !== 'host' && lk !== 'connection' && typeof v === 'string') {
                    proxyHeaders[k] = v;
                  }
                }
                const proxyRes = await fetch(`http://127.0.0.1:3000${req.url}`, {
                  method: req.method,
                  headers: proxyHeaders,
                  body: (req.method !== 'GET' && req.method !== 'HEAD') ? (req as any) : undefined,
                  // @ts-ignore
                  duplex: 'half',
                });
                res.statusCode = proxyRes.status;
                proxyRes.headers.forEach((v, k) => res.setHeader(k, v));
                const buf = Buffer.from(await proxyRes.arrayBuffer());
                res.end(buf);
                return;
              } catch {
                // Electron server on 3001 is not running, fallback to internal handler
              }

              try {
                const { createRequire } = await import('module');
                const reqModule = createRequire(import.meta.url);
                const { handleApiRequest } = reqModule('./electron/api-handler.cjs');
                const handled = await handleApiRequest(req, res, { isElectron: false });
                if (handled) return;
              } catch (err: any) {
                console.error('API error:', err);
                res.statusCode = 500;
                res.setHeader('Content-Type', 'application/json');
                res.end(JSON.stringify({ error: err.message }));
                return;
              }
            }
            next();
          });
        },
      },
    ],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
        'lucide-react': path.resolve(__dirname, 'node_modules/lucide-react/dist/cjs/lucide-react.js'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modifyâfile watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});

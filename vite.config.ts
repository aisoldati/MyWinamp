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
            if (req.url && req.url.startsWith('/api/')) {
              try {
                const proxyHeaders: Record<string, string> = {};
                for (const [k, v] of Object.entries(req.headers)) {
                  const lk = k.toLowerCase();
                  if (lk !== 'host' && lk !== 'connection' && typeof v === 'string') {
                    proxyHeaders[k] = v;
                  }
                }
                const proxyRes = await fetch(`http://127.0.0.1:5050${req.url}`, {
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
      dedupe: ['react', 'react-dom'],
      alias: {
        '@': path.resolve(__dirname, '.'),
        'react': path.resolve(__dirname, 'node_modules/react'),
        'react-dom': path.resolve(__dirname, 'node_modules/react-dom'),
        'lucide-react': path.resolve(__dirname, 'node_modules/lucide-react'),
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

const { spawn } = require('child_process');
const http = require('http');

console.log('Starting Vite development server...');
const vite = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--port=3000', '--host=127.0.0.1'], {
  shell: false,
  stdio: 'inherit',
  env: { ...process.env, DISABLE_HMR: 'false' }
});

function checkViteReady() {
  http.get('http://127.0.0.1:3000', () => {
    console.log('Vite server is ready! Starting Electron...');
    const electron = spawn('npx', ['electron', '.'], {
      shell: true,
      stdio: 'inherit',
      env: { ...process.env, NODE_ENV: 'development' }
    });

    electron.on('close', () => {
      console.log('Electron closed. Stopping Vite...');
      vite.kill();
      process.exit();
    });
  }).on('error', () => {
    setTimeout(checkViteReady, 250);
  });
}

// Start polling after 1s
setTimeout(checkViteReady, 1000);

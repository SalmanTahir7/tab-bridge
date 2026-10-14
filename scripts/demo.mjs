// Preview the built web app and API together without Vite's development optimizer.
process.env.LOCAL_DEMO = 'true';
process.env.SERVE_STATIC = 'true';
process.env.PORT = '5173';
process.env.PUBLIC_ORIGIN = 'http://localhost:5173';
await import('../server-dist/main.js');

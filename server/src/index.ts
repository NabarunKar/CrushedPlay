import { createServer } from 'node:http';
import { createApp } from './app.js';
import { createWebSocketServer } from './websocket.js';

const port = Number(process.env.PORT ?? 3000);
const app = createApp();
const server = createServer(app);

createWebSocketServer(server);

server.listen(port, () => {
  console.log(`CrushedPlay server listening on http://localhost:${port}`);
});

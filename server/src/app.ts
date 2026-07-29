import express from 'express';
import { randomUUID } from 'node:crypto';
import { createRoom, getRoom } from './rooms.js';

export function createApp() {
  const app = express();

  app.use(express.json());

  app.get('/', (_request, response) => {
    response.json({
      name: 'CrushedPlay API',
      status: 'ok'
    });
  });

  app.get('/health', (_request, response) => {
    response.json({
      status: 'ok',
      uptime: process.uptime()
    });
  });

  app.post('/api/rooms', (_request, response) => {
    const hostId = randomUUID();
    const room = createRoom(hostId);

    response.status(201).json({
      roomId: room.roomId,
      hostId: room.hostId
    });
  });

  app.get('/api/rooms/:roomId', (request, response) => {
    const room = getRoom(request.params.roomId);

    if (!room) {
      response.status(404).json({
        message: 'Room not found'
      });
      return;
    }

    response.json(room);
  });

  return app;
}

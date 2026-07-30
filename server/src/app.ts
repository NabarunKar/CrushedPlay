import express from 'express';
import cors from 'cors';
import { randomUUID } from 'node:crypto';
import { createRoom, getRoom } from './rooms.js';

export function createApp() {
  const app = express();

  app.use(cors({
    origin: ['https://crushed-play-client.vercel.app', 'https://crushedplay.vercel.app/', 'http://localhost:5173'],
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    credentials: true
  }));
  app.use(express.json());

  app.get('/', (_request, response) => {
    response.json({
      name: 'CrushedPlay API',
      status: 'ok'
    });
  });

  app.get('/health', (_request, response) => {
    response.status(200).json({
      status: 200,
      message: 'OK'
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

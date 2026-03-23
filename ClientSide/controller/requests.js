import WebSocket from 'ws';

const socket = new WebSocket('ws://localhost:8000');
// Use ws:// if your server has no SSL (not recommended for production)

socket.on('open', () => {
  console.log('Connected to server!');

  // Send data to server
  socket.send(JSON.stringify({ type: 'hello', payload: 'Hi from Node app!' }));
});

socket.on('message', (data) => {
  const msg = JSON.parse(data);
  console.log('Received from server:', msg);
});

socket.on('close', () => {
  console.log('Disconnected from server');
});

socket.on('error', (err) => {
  console.error('WebSocket error:', err.message);
});

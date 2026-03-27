const express = require('express')
const app = express() 
const port = 8080

const WebSocket = require('ws');
const wss = new WebSocket.Server({ port: 8000 , host: '0.0.0.0' });


app.get('/', (req, res) => {
  res.send('Hello World!')
})

app.listen(port, () => {
  console.log(`http://localhost:${port}/`)
})






wss.on('connection', (socket) => {
  console.log('Node.js app connected!');

  socket.on('message', (msg) => {
    console.log('From Node app:', msg.toString());

    // Send something back
    socket.send(JSON.stringify({ status: 'ok', echo: msg.toString() }));
  });

  socket.on('close', () => console.log('Node app disconnected'));
});
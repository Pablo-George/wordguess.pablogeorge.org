const WebSocket = require('ws');

// room key -> Set<ws>
const rooms = new Map();

function setupWebSocket(server, sessionParser) {
  const wss = new WebSocket.Server({ noServer: true });

  server.on('upgrade', function(req, socket, head) {
    sessionParser(req, {}, function() {
      const userId = req.session && req.session.passport && req.session.passport.user;
      if (!userId) {
        socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
        socket.destroy();
        return;
      }
      wss.handleUpgrade(req, socket, head, function(ws) {
        ws._userId = userId;
        wss.emit('connection', ws, req);
      });
    });
  });

  wss.on('connection', function(ws) {
    ws.isAlive = true;
    ws._room = null;

    ws.on('pong', function() { ws.isAlive = true; });

    ws.on('message', function(raw) {
      try {
        var msg = JSON.parse(raw);
        if (msg.type === 'join' && msg.gameType && msg.gameId) {
          leaveRoom(ws);
          var key = msg.gameType + ':' + msg.gameId;
          if (!rooms.has(key)) rooms.set(key, new Set());
          rooms.get(key).add(ws);
          ws._room = key;
        } else if (msg.type === 'relay' && ws._room && msg.data) {
          // Forward to all other members of sender's room (not back to sender)
          var payload = JSON.stringify(Object.assign({ _room: ws._room }, msg.data));
          var room = rooms.get(ws._room);
          if (room) {
            room.forEach(function(peer) {
              if (peer !== ws && peer.readyState === WebSocket.OPEN) peer.send(payload);
            });
          }
        }
      } catch (e) {}
    });

    ws.on('close', function() { leaveRoom(ws); });
    ws.on('error', function() { leaveRoom(ws); });
  });

  // Heartbeat — detect dead connections every 30s
  var heartbeat = setInterval(function() {
    wss.clients.forEach(function(ws) {
      if (!ws.isAlive) { ws.terminate(); return; }
      ws.isAlive = false;
      ws.ping();
    });
  }, 30000);

  wss.on('close', function() { clearInterval(heartbeat); });

  return wss;
}

function leaveRoom(ws) {
  if (!ws._room) return;
  var room = rooms.get(ws._room);
  if (room) {
    room.delete(ws);
    if (!room.size) rooms.delete(ws._room);
  }
  ws._room = null;
}

function broadcast(gameType, gameId, data) {
  var key = gameType + ':' + gameId;
  var room = rooms.get(key);
  if (!room || !room.size) return;
  var msg = JSON.stringify(Object.assign({ _room: key }, data));
  room.forEach(function(ws) {
    if (ws.readyState === WebSocket.OPEN) ws.send(msg);
  });
}

module.exports = { setupWebSocket, broadcast };

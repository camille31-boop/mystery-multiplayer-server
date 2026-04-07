const WebSocket = require("ws");
const http = require("http");

const PORT = process.env.PORT || 3000;

const server = http.createServer();
const wss = new WebSocket.Server({ server });

const rooms = {};

function generateRoomCode(length = 6) {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";

  do {
    code = "";
    for (let i = 0; i < length; i++) {
      code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
  } while (rooms[code]);

  return code;
}

function send(ws, data) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(data));
  }
}

function broadcastToRoom(roomCode, data) {
  const room = rooms[roomCode];
  if (!room) return;

  Object.values(room.players).forEach((player) => {
    send(player.ws, data);
  });
}

function getPlayerIds(room) {
  return Object.keys(room.players);
}

function assignRoles(room) {
  const ids = getPlayerIds(room);

  if (ids.length >= 1) {
    room.players[ids[0]].role = "series";
  }

  if (ids.length >= 2) {
    room.players[ids[1]].role = "films";
  }
}

function sendRoleUpdateToAll(roomCode) {
  const room = rooms[roomCode];
  if (!room) return;

  Object.values(room.players).forEach((player) => {
    send(player.ws, {
      type: "ROOM_JOINED",
      roomCode: room.code,
      role: player.role
    });
  });
}

wss.on("connection", (ws) => {
  console.log("Client connecté");

  let currentPlayerId = null;
  let currentRoomCode = null;

  send(ws, {
    type: "WELCOME",
    message: "Connexion établie"
  });

  ws.on("message", (message) => {
    try {
      const data = JSON.parse(message.toString());
      console.log("MESSAGE RECU :", data);

      if (!data.type) {
        send(ws, {
          type: "ERROR",
          message: "Type de message manquant"
        });
        return;
      }

      switch (data.type) {
        case "CREATE_ROOM": {
          const playerId = data.playerId;

          if (!playerId) {
            send(ws, {
              type: "ERROR",
              message: "playerId manquant"
            });
            break;
          }

          const roomCode = generateRoomCode();

          rooms[roomCode] = {
            code: roomCode,
            players: {}
          };

          rooms[roomCode].players[playerId] = {
            playerId,
            ws,
            role: "series",
            ready: false
          };

          currentPlayerId = playerId;
          currentRoomCode = roomCode;

          send(ws, {
            type: "ROOM_CREATED",
            roomCode,
            role: "series"
          });

          send(ws, {
            type: "PLAYER_JOINED",
            playerCount: 1
          });

          console.log("SALLE CREEE :", roomCode);
          break;
        }

        case "JOIN_ROOM": {
          const playerId = data.playerId;
          const roomCode = data.roomCode;

          if (!playerId || !roomCode) {
            send(ws, {
              type: "ERROR",
              message: "playerId ou roomCode manquant"
            });
            break;
          }

          const room = rooms[roomCode];

          if (!room) {
            send(ws, {
              type: "ERROR",
              message: "Salle introuvable"
            });
            break;
          }

          const idsBefore = getPlayerIds(room);

          if (idsBefore.length >= 2 && !room.players[playerId]) {
            send(ws, {
              type: "ERROR",
              message: "Salle pleine"
            });
            break;
          }

          room.players[playerId] = {
            playerId,
            ws,
            role: "",
            ready: false
          };

          assignRoles(room);

          currentPlayerId = playerId;
          currentRoomCode = roomCode;

          // IMPORTANT : on renvoie le rôle à TOUS
          sendRoleUpdateToAll(roomCode);

          broadcastToRoom(roomCode, {
            type: "PLAYER_JOINED",
            playerCount: getPlayerIds(room).length
          });

          console.log(`JOUEUR ${playerId} A REJOINT ${roomCode}`);
          break;
        }

        case "SET_READY": {
          const playerId = data.playerId;
          const roomCode = data.roomCode;
          const ready = data.ready;

          if (!playerId || !roomCode || typeof ready !== "boolean") {
            send(ws, {
              type: "ERROR",
              message: "SET_READY invalide"
            });
            break;
          }

          const room = rooms[roomCode];

          if (!room) {
            send(ws, {
              type: "ERROR",
              message: "Salle introuvable"
            });
            break;
          }

          if (!room.players[playerId]) {
            send(ws, {
              type: "ERROR",
              message: "Joueur introuvable dans cette salle"
            });
            break;
          }

          room.players[playerId].ready = ready;

          console.log(`SET_READY | ${playerId} | ${roomCode} | ${ready}`);

          const players = Object.values(room.players);
          const everyoneReady =
            players.length === 2 &&
            players.every((p) => p.ready === true);

          if (everyoneReady) {
            console.log("LES DEUX JOUEURS SONT PRETS");

            broadcastToRoom(roomCode, {
              type: "COUNTDOWN",
              countdown: 3
            });

            setTimeout(() => {
              const roomStillExists = rooms[roomCode];
              if (!roomStillExists) return;

              const currentPlayers = Object.values(roomStillExists.players);
              const stillReady =
                currentPlayers.length === 2 &&
                currentPlayers.every((p) => p.ready === true);

              if (stillReady) {
                broadcastToRoom(roomCode, {
                  type: "START_GAME"
                });

                console.log("START_GAME ENVOYE");
              }
            }, 3000);
          }

          break;
        }

        default: {
          console.log("TYPE INCONNU :", data.type);
          send(ws, {
            type: "ERROR",
            message: "Type de message inconnu"
          });
          break;
        }
      }
    } catch (error) {
      console.error("ERREUR MESSAGE :", error);
      send(ws, {
        type: "ERROR",
        message: "Message invalide"
      });
    }
  });

  ws.on("close", () => {
    console.log("Client déconnecté");

    if (currentRoomCode && currentPlayerId && rooms[currentRoomCode]) {
      delete rooms[currentRoomCode].players[currentPlayerId];

      const remainingIds = getPlayerIds(rooms[currentRoomCode]);

      if (remainingIds.length === 0) {
        delete rooms[currentRoomCode];
        console.log("Salle supprimée :", currentRoomCode);
      } else {
        assignRoles(rooms[currentRoomCode]);
        sendRoleUpdateToAll(currentRoomCode);

        broadcastToRoom(currentRoomCode, {
          type: "PLAYER_JOINED",
          playerCount: remainingIds.length
        });
      }
    }
  });

  ws.on("error", (error) => {
    console.error("ERREUR WS :", error);
  });
});

server.listen(PORT, () => {
  console.log(`Serveur lancé sur le port ${PORT}`);
});

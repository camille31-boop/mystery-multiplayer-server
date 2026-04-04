const express = require("express");
const http = require("http");
const WebSocket = require("ws");

const app = express();
app.use(express.json());

app.get("/", (req, res) => {
  res.send("Serveur du jeu multijoueur OK");
});

app.get("/health", (req, res) => {
  res.status(200).json({ status: "ok" });
});

const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const rooms = new Map();

function send(ws, data) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(data));
  }
}

function broadcast(roomCode, data) {
  const room = rooms.get(roomCode);
  if (!room) return;

  const message = JSON.stringify(data);

  for (const player of room.players) {
    if (player.ws.readyState === WebSocket.OPEN) {
      player.ws.send(message);
    }
  }
}

function generateRoomCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 6; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

wss.on("connection", (ws) => {
  console.log("Client connecté");

  ws.roomCode = null;
  ws.role = null;

  ws.on("message", (raw) => {
    try {
      const data = JSON.parse(raw.toString());
      console.log("Message reçu :", data);

      switch (data.type) {
        case "CREATE_ROOM": {
          let roomCode;

          do {
            roomCode = generateRoomCode();
          } while (rooms.has(roomCode));

          const role = data.role || "series";

          rooms.set(roomCode, {
            players: [{ ws, role }],
            readyStates: new Map([[ws, false]])
          });

          ws.roomCode = roomCode;
          ws.role = role;

          send(ws, {
            type: "ROOM_CREATED",
            roomCode: roomCode,
            role: role
          });

          console.log(`Salle créée : ${roomCode}`);
          break;
        }

        case "JOIN_ROOM": {
          const roomCode = data.roomCode;
          const room = rooms.get(roomCode);

          if (!room) {
            send(ws, {
              type: "ERROR",
              message: "Salle introuvable"
            });
            return;
          }

          if (room.players.length >= 2) {
            send(ws, {
              type: "ERROR",
              message: "Salle déjà complète"
            });
            return;
          }

          const existingRole = room.players[0].role;
          const role = existingRole === "series" ? "films" : "series";

          room.players.push({ ws, role });
          room.readyStates.set(ws, false);

          ws.roomCode = roomCode;
          ws.role = role;

          send(ws, {
            type: "JOIN_SUCCESS",
            roomCode: roomCode,
            role: role
          });

          broadcast(roomCode, {
            type: "PLAYER_JOINED",
            playerCount: room.players.length
          });

          console.log(`Joueur rejoint la salle : ${roomCode}`);
          break;
        }

        case "PLAYER_READY_START": {
          const roomCode = ws.roomCode;
          const room = rooms.get(roomCode);
          if (!room) return;

          room.readyStates.set(ws, true);

          const allReady =
            room.players.length === 2 &&
            room.players.every((p) => room.readyStates.get(p.ws) === true);

          if (allReady) {
            broadcast(roomCode, {
              type: "START_PROJECTOR"
            });

            for (const p of room.players) {
              room.readyStates.set(p.ws, false);
            }

            console.log(`Démarrage projecteur dans la salle ${roomCode}`);
          }
          break;
        }

        case "PLAYER_CANCEL_READY": {
          const roomCode = ws.roomCode;
          const room = rooms.get(roomCode);
          if (!room) return;

          room.readyStates.set(ws, false);
          break;
        }

        case "GAME_EVENT": {
          const roomCode = ws.roomCode;
          const room = rooms.get(roomCode);
          if (!room) return;

          for (const player of room.players) {
            if (player.ws !== ws && player.ws.readyState === WebSocket.OPEN) {
              player.ws.send(JSON.stringify({
                type: "GAME_EVENT",
                eventName: data.eventName,
                payload: data.payload || null
              }));
            }
          }
          break;
        }

        default: {
          send(ws, {
            type: "ERROR",
            message: "Type de message inconnu"
          });
          break;
        }
      }
    } catch (err) {
      console.error("Erreur message :", err);
      send(ws, {
        type: "ERROR",
        message: "Message invalide"
      });
    }
  });

  ws.on("close", () => {
    console.log("Client déconnecté");

    const roomCode = ws.roomCode;
    if (!roomCode) return;

    const room = rooms.get(roomCode);
    if (!room) return;

    room.players = room.players.filter((p) => p.ws !== ws);
    room.readyStates.delete(ws);

    if (room.players.length === 0) {
      rooms.delete(roomCode);
      console.log(`Salle supprimée : ${roomCode}`);
    } else {
      broadcast(roomCode, {
        type: "PLAYER_LEFT",
        playerCount: room.players.length
      });
    }
  });
});

const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
  console.log(`Serveur démarré sur le port ${PORT}`);
});
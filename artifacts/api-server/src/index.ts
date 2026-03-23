import http from "http";
import { Server as IOServer } from "socket.io";
import app from "./app.js";
import { logger } from "./lib/logger.js";
import { setSocketIO } from "./bot/index.js";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error("PORT environment variable is required but was not provided.");
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

const httpServer = http.createServer(app);

const io = new IOServer(httpServer, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
  },
  path: "/api/socket.io",
});

setSocketIO(io);

io.on("connection", (socket) => {
  logger.info({ socketId: socket.id }, "Dashboard client connected");

  socket.on("disconnect", () => {
    logger.info({ socketId: socket.id }, "Dashboard client disconnected");
  });
});

httpServer.listen(port, (err?: Error) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }
  logger.info({ port }, "Server listening");
});

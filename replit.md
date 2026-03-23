# Workspace

## Overview

pnpm workspace monorepo using TypeScript. Each package manages its own dependencies.

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **TypeScript version**: 5.9
- **API framework**: Express 5
- **Database**: PostgreSQL + Drizzle ORM
- **Validation**: Zod (`zod/v4`), `drizzle-zod`
- **API codegen**: Orval (from OpenAPI spec)
- **Build**: esbuild (CJS bundle)
- **Real-time**: Socket.IO

## Structure

```text
artifacts-monorepo/
├── artifacts/              # Deployable applications
│   ├── api-server/         # Express API server (bot backend)
│   └── mc-bot-dashboard/   # React dashboard (Vite)
├── lib/                    # Shared libraries
│   ├── api-spec/           # OpenAPI spec + Orval codegen config
│   ├── api-client-react/   # Generated React Query hooks
│   ├── api-zod/            # Generated Zod schemas from OpenAPI
│   └── db/                 # Drizzle ORM schema + DB connection
├── scripts/                # Utility scripts
├── pnpm-workspace.yaml     # pnpm workspace
├── tsconfig.base.json      # Shared TS options
├── tsconfig.json           # Root TS project references
└── package.json            # Root package with hoisted devDeps
```

## Minecraft Bot System

### Bot Backend (`artifacts/api-server/src/bot/`)

The Minecraft bot uses Mineflayer (offline/cracked mode) with these modules:

- **`state.ts`**: Type definitions for BotState, BotSettings, LogEntry, BotTask, ServerConfig
- **`store.ts`**: In-memory runtime state store
- **`logger.ts`**: Ring-buffer log system (max 500 entries)
- **`combat.ts`**: Combat targeting, attack cooldown, weapon switching
- **`tasks.ts`**: Task queue management (follow, guard_area, move_to)
- **`ai.ts`**: AI state machine with adaptive scan intervals
- **`index.ts`**: Bot lifecycle, Socket.IO broadcasting, command dispatcher

### Bot States
- **IDLE**: Passive, checks for tasks and low-priority threats
- **FOLLOW**: Pathfinds to owner, protects from hostiles
- **GUARD**: Guards area, attacks hostiles and untrusted players
- **COMBAT**: Locks target, attacks with configurable cooldown, retreats on low HP
- **AUTONOMOUS**: When owner offline, wanders safely, flees from mobs
- **DISCONNECTED**: Bot not connected

### Socket.IO Events
- `bot:status` - Emitted every 1s with full bot status
- `bot:log` - Real-time log entries
- `bot:connected` - Bot connected to MC server
- `bot:disconnected` - Bot disconnected

Socket.IO is mounted at `/api/socket.io`.

### API Routes

All routes prefixed with `/api`:

- `GET /bot/status` - Current bot status
- `POST /bot/connect` - Connect to Minecraft server
- `POST /bot/disconnect` - Disconnect bot
- `POST /bot/reconnect` - Reconnect bot
- `POST /bot/command` - Send command (follow/guard/stop/attack_nearest/toggle_autonomous/set_owner)
- `GET /bot/logs` - Recent logs
- `GET /settings` - Current settings
- `PUT /settings` - Update settings
- `GET/POST /settings/whitelist` - Manage whitelist
- `DELETE /settings/whitelist/:username` - Remove from whitelist
- `GET/POST /tasks` - Task queue management
- `DELETE /tasks/:taskId` - Remove task
- `POST /tasks/clear` - Clear all tasks
- `GET/POST /servers` - Saved server configs
- `DELETE /servers/:configId` - Delete server config

### Dashboard (`artifacts/mc-bot-dashboard/`)

React + Vite dashboard with:
- **ConnectionPanel**: Server IP/port/username/owner, connect/disconnect/reconnect buttons, saved server presets
- **StatusPanel**: Live health/food bars, ping, state badge, nearby players, uptime, CPU mode
- **ControlPanel**: Follow/Guard/Stop/Attack Nearest/Toggle Autonomous buttons
- **SettingsPanel**: All settings with live edit (aggression level, follow distance, detection radius, attack delay, scan interval, CPU mode, auto-reconnect, owner name)
- **TaskQueuePanel**: Add/remove tasks (follow, guard_area, move_to), clear all
- **WhitelistPanel**: Add/remove whitelisted players
- **TerminalLog**: Real-time scrolling log with color coding

### Performance Design
- Adaptive scan interval based on CPU mode (LOW: 2x, NORMAL: 1x, HIGH: 0.5x of configured interval)
- Small delays between AI decisions (scan interval timer)
- Stuck detection resets pathfinding after 3 consecutive no-movement ticks
- Mineflayer, socket.io, and other large packages are externalized from esbuild to avoid bundling issues

### Key Dependencies (api-server)
- `mineflayer`: Minecraft bot framework
- `mineflayer-pathfinder`: Pathfinding plugin
- `socket.io`: Real-time WebSocket server
- `uuid`: ID generation

### Key Dependencies (mc-bot-dashboard)
- `socket.io-client`: Real-time connection to backend
- `framer-motion`: Animations
- `react-hook-form`: Form state management
- `lucide-react`: Icons

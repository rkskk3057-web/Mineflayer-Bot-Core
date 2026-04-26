# Changelog

## [1.0.0] - 2026-04-26

### Added
- ✨ **Hybrid AI System**: 5-state controlled bot (IDLE, FOLLOW, GUARD, COMBAT, AUTONOMOUS)
- 🧠 **Lightweight AI Engine**: 100ms decision intervals, event-driven architecture
- ⚔️ **Combat System**: Distance-based weapon selection, attack cooldown, smart retreat
- 👁️ **Detection System**: Optimized entity scanning (300-500ms), small radius detection
- 🛡️ **Protection System**: Owner priority, whitelist support, threat detection
- 📊 **Real-time Dashboard**: Live monitoring, status tracking, entity display
- 🎮 **AI Control Panel**: Follow, Guard, Stop, Attack, Autonomous mode buttons
- ⚙️ **Live Settings**: Change all parameters without restart
- 🔌 **Connection Control**: Change server IP/Port/Username live
- 📋 **System Logs**: Color-coded, timestamped event logging
- 🌐 **WebSocket Support**: Real-time bidirectional communication
- 💾 **Configuration Manager**: Persistent JSON-based config storage
- 🔄 **Auto-Recovery**: Graceful error handling and state validation

### Features
- **Stability First**: No heavy loops, event-driven, CPU efficient
- **Modular Code**: Separated concerns (AI, Combat, Detection)
- **Dashboard Ready**: Full REST API + WebSocket server
- **Configurable**: 10+ adjustable parameters
- **Safe Autonomous Mode**: Limited exploration, mob avoidance
- **Performance Modes**: Low, Normal, High CPU modes

### Performance
- 100ms decision loop
- 300-500ms entity scanning
- 15 block detection radius
- Low memory footprint
- Event-driven (no polling)

### API
- 8 REST endpoints
- 5 command endpoints
- 5+ WebSocket event types
- Status monitoring endpoints

---

**Status**: ✅ Production Ready | Stable | Optimized

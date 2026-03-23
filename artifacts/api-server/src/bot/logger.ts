import { v4 as uuidv4 } from "uuid";
import type { LogEntry } from "./state.js";

const MAX_LOGS = 500;
const logs: LogEntry[] = [];

type LogLevel = LogEntry["level"];

export function addLog(level: LogLevel, message: string): LogEntry {
  const entry: LogEntry = {
    id: uuidv4(),
    timestamp: new Date().toISOString(),
    level,
    message,
  };
  logs.push(entry);
  if (logs.length > MAX_LOGS) {
    logs.shift();
  }
  return entry;
}

export function getLogs(limit = 200): LogEntry[] {
  return logs.slice(-limit);
}

export function clearLogs(): void {
  logs.length = 0;
}

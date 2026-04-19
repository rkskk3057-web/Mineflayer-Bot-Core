import { useBotSocket } from "@/hooks/use-socket";
import { ConnectionPanel } from "@/components/ConnectionPanel";
import { StatusPanel } from "@/components/StatusPanel";
import { ControlPanel } from "@/components/ControlPanel";
import { SettingsPanel } from "@/components/SettingsPanel";
import { TaskQueuePanel } from "@/components/TaskQueuePanel";
import { TerminalLog } from "@/components/TerminalLog";
import { WhitelistPanel } from "@/components/WhitelistPanel";
import { ChatPanel } from "@/components/ChatPanel";
import { InventoryPanel } from "@/components/InventoryPanel";
import { Cpu } from "lucide-react";

export default function Dashboard() {
  const { isConnected } = useBotSocket();

  return (
    <div className="min-h-screen bg-background text-foreground font-sans selection:bg-primary/30 pb-16">

      {/* Background */}
      <div className="fixed inset-0 pointer-events-none z-0">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,_rgba(0,255,0,0.04),_transparent_60%)]" />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_bottom-right,_rgba(0,100,255,0.03),_transparent_50%)]" />
        <div className="absolute inset-0 bg-[linear-gradient(rgba(0,255,0,0.015)_1px,transparent_1px),linear-gradient(90deg,rgba(0,255,0,0.015)_1px,transparent_1px)] bg-[size:40px_40px]" />
      </div>

      <div className="relative z-10 px-4 pt-4 pb-6 md:px-6 lg:px-8 max-w-[1600px] mx-auto space-y-5">

        {/* ── Header ─────────────────────────────────────────────────────── */}
        <header className="flex items-center justify-between border-b border-primary/15 pb-4">
          <div className="flex items-center gap-3">
            <div className="relative w-11 h-11 flex items-center justify-center bg-black/60 border border-primary/30 rounded-xl">
              <Cpu className="w-5 h-5 text-primary" />
              {isConnected && (
                <span className="absolute -top-1 -right-1 flex h-3 w-3">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-60" />
                  <span className="relative inline-flex rounded-full h-3 w-3 bg-primary" />
                </span>
              )}
            </div>
            <div>
              <h1 className="text-2xl md:text-3xl font-black glow-text font-display uppercase tracking-widest text-white m-0 leading-none">
                Aegis <span className="text-primary">Core</span>
              </h1>
              <p className="text-[10px] text-primary/60 font-mono tracking-widest mt-0.5">
                Autonomous Entity Management System
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 px-3 py-1.5 bg-black/40 border border-border rounded-lg">
            <div className={`w-2 h-2 rounded-full transition-colors ${isConnected ? "bg-primary shadow-[0_0_6px_rgba(0,255,0,0.7)]" : "bg-red-500"}`} />
            <span className="text-[10px] font-mono font-bold uppercase tracking-widest text-muted-foreground">
              {isConnected ? "WS ACTIVE" : "NO SIGNAL"}
            </span>
          </div>
        </header>

        {/* ── Main grid ──────────────────────────────────────────────────── */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">

          {/* Left column — Connection, Whitelist, Inventory */}
          <div className="lg:col-span-3 space-y-4">
            <ConnectionPanel />
            <WhitelistPanel />
            <InventoryPanel />
          </div>

          {/* Center column — Status HUD, Controls, Chat, Tasks */}
          <div className="lg:col-span-5 space-y-4">
            <StatusPanel />
            <ControlPanel />
            <ChatPanel />
            <TaskQueuePanel />
          </div>

          {/* Right column — Settings, Log */}
          <div className="lg:col-span-4 space-y-4">
            <SettingsPanel />
            <TerminalLog />
          </div>

        </div>
      </div>
    </div>
  );
}

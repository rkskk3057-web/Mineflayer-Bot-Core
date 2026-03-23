import { useBotSocket } from "@/hooks/use-socket";
import { ConnectionPanel } from "@/components/ConnectionPanel";
import { StatusPanel } from "@/components/StatusPanel";
import { ControlPanel } from "@/components/ControlPanel";
import { SettingsPanel } from "@/components/SettingsPanel";
import { TaskQueuePanel } from "@/components/TaskQueuePanel";
import { TerminalLog } from "@/components/TerminalLog";
import { WhitelistPanel } from "@/components/WhitelistPanel";
import { Cpu } from "lucide-react";

export default function Dashboard() {
  const { isConnected } = useBotSocket();

  return (
    <div className="min-h-screen bg-background text-foreground font-sans selection:bg-primary/30 pb-12">
      {/* Background Graphic */}
      <div className="fixed inset-0 pointer-events-none z-0">
        <img 
          src={`${import.meta.env.BASE_URL}images/cyber-bg.png`} 
          alt="Cyber Background" 
          className="w-full h-full object-cover opacity-20"
        />
        <div className="absolute inset-0 bg-gradient-to-b from-transparent via-background/80 to-background" />
      </div>

      <div className="relative z-10 p-4 md:p-6 lg:p-8 max-w-[1600px] mx-auto space-y-6">
        
        <header className="flex items-center justify-between border-b border-primary/20 pb-6 mb-8">
          <div className="flex items-center gap-4">
            <div className="relative w-12 h-12 flex items-center justify-center bg-black/50 border border-primary/30 rounded-xl glow-box">
              <Cpu className="w-6 h-6 text-primary" />
              {isConnected && (
                <span className="absolute -top-1 -right-1 flex h-3 w-3">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-3 w-3 bg-primary"></span>
                </span>
              )}
            </div>
            <div>
              <h1 className="text-3xl font-black glow-text font-display uppercase tracking-widest text-white m-0 leading-none">
                Aegis <span className="text-primary">Core</span>
              </h1>
              <p className="text-xs text-primary/70 font-mono tracking-widest mt-1">Autonomous Entity Management</p>
            </div>
          </div>
          
          <div className="hidden sm:flex items-center gap-3 px-4 py-2 bg-black/40 border border-border rounded-lg">
            <div className={`w-2 h-2 rounded-full ${isConnected ? 'bg-primary' : 'bg-destructive'}`} />
            <span className="text-xs font-mono font-bold uppercase tracking-wider text-muted-foreground">
              WS: {isConnected ? 'LINK_ACTIVE' : 'NO_SIGNAL'}
            </span>
          </div>
        </header>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
           
           {/* Left Column: Connections & Security */}
           <div className="lg:col-span-3 space-y-6">
             <ConnectionPanel />
             <WhitelistPanel />
           </div>

           {/* Middle Column: Active Operations */}
           <div className="lg:col-span-5 space-y-6">
             <StatusPanel />
             <ControlPanel />
             <TaskQueuePanel />
           </div>

           {/* Right Column: Settings & Logs */}
           <div className="lg:col-span-4 space-y-6">
             <SettingsPanel />
             <TerminalLog />
           </div>

        </div>

      </div>
    </div>
  );
}

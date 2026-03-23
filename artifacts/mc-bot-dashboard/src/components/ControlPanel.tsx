import { useSendBotCommand } from "@workspace/api-client-react";
import { Panel, PanelHeader, GameButton } from "./ui-gaming";
import { Crosshair, Navigation, ShieldAlert, StopCircle, Cpu } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

export function ControlPanel() {
  const { mutate: sendCommand, isPending } = useSendBotCommand();
  const { toast } = useToast();

  const handleCommand = (cmd: "follow" | "guard" | "stop" | "attack_nearest" | "toggle_autonomous") => {
    sendCommand({ data: { command: cmd } }, {
      onSuccess: () => {
        toast({ title: "Command Accepted", description: `Executed: ${cmd.replace('_', ' ').toUpperCase()}` });
      },
      onError: (err) => {
        toast({ title: "Command Failed", description: String(err), variant: "destructive" });
      }
    });
  };

  return (
    <Panel>
      <PanelHeader title="Tactical Controls" icon={Crosshair} />
      <div className="p-5 grid grid-cols-2 sm:grid-cols-3 gap-3">
        <GameButton 
          onClick={() => handleCommand("follow")} 
          disabled={isPending}
        >
          <Navigation className="w-4 h-4" />
          Follow
        </GameButton>
        
        <GameButton 
          variant="secondary" 
          onClick={() => handleCommand("guard")}
          disabled={isPending}
        >
          <ShieldAlert className="w-4 h-4" />
          Guard
        </GameButton>
        
        <GameButton 
          variant="danger" 
          onClick={() => handleCommand("attack_nearest")}
          disabled={isPending}
        >
          <Crosshair className="w-4 h-4" />
          Attack Near
        </GameButton>
        
        <GameButton 
          variant="outline" 
          onClick={() => handleCommand("toggle_autonomous")}
          disabled={isPending}
          className="col-span-2 sm:col-span-1"
        >
          <Cpu className="w-4 h-4" />
          Auto Mode
        </GameButton>

        <GameButton 
          variant="danger" 
          className="bg-red-600 hover:bg-red-700 col-span-2 sm:col-span-2"
          onClick={() => handleCommand("stop")}
          disabled={isPending}
        >
          <StopCircle className="w-4 h-4" />
          FORCE STOP
        </GameButton>
      </div>
    </Panel>
  );
}

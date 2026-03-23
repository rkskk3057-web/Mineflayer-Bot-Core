import { useState } from "react";
import { useGetTasks, useAddTask, useRemoveTask, useClearTasks, type CreateTaskRequestType } from "@workspace/api-client-react";
import { Panel, PanelHeader, GameButton } from "./ui-gaming";
import { ListTodo, Plus, Trash2, X } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";

export function TaskQueuePanel() {
  const { data: taskData } = useGetTasks({ query: { refetchInterval: 3000 } });
  const { mutate: addTask, isPending: isAdding } = useAddTask();
  const { mutate: removeTask } = useRemoveTask();
  const { mutate: clearTasks } = useClearTasks();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [newTaskType, setNewTaskType] = useState<CreateTaskRequestType>("follow");
  const tasks = taskData?.tasks || [];

  const handleAdd = () => {
    addTask({ data: { type: newTaskType, params: {} } }, {
      onSuccess: () => {
        toast({ title: "Task Added" });
        queryClient.invalidateQueries({ queryKey: ["/api/tasks"] });
      }
    });
  };

  const statusColors = {
    pending: "text-yellow-400 bg-yellow-400/10 border-yellow-400/20",
    active: "text-primary bg-primary/10 border-primary/20",
    paused: "text-orange-400 bg-orange-400/10 border-orange-400/20",
    done: "text-gray-400 bg-gray-400/10 border-gray-400/20",
  };

  return (
    <Panel>
      <PanelHeader 
        title="Directive Queue" 
        icon={ListTodo} 
        action={
          <button 
            onClick={() => clearTasks(undefined, { onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/tasks"] }) })}
            className="text-xs text-destructive hover:text-red-400 uppercase font-bold tracking-widest flex items-center gap-1"
          >
            <Trash2 className="w-3 h-3" /> Purge
          </button>
        }
      />
      <div className="p-4 space-y-4">
        
        <div className="flex gap-2">
          <select 
            value={newTaskType}
            onChange={e => setNewTaskType(e.target.value as CreateTaskRequestType)}
            className="flex-1 bg-black/50 border border-border rounded-lg p-2 font-mono text-sm focus:border-primary focus:outline-none"
          >
            <option value="follow">Follow Owner</option>
            <option value="guard_area">Guard Current Area</option>
            <option value="move_to">Move To Coordinate</option>
          </select>
          <GameButton onClick={handleAdd} disabled={isAdding}>
            <Plus className="w-4 h-4" />
          </GameButton>
        </div>

        <div className="space-y-2 max-h-[200px] overflow-y-auto terminal-scroll pr-2">
          {tasks.length === 0 ? (
            <div className="text-center text-muted-foreground text-sm py-4 border border-dashed border-border/50 rounded-lg">
              Queue is empty
            </div>
          ) : (
            tasks.map(task => (
              <div key={task.id} className="group flex items-center justify-between bg-black/30 border border-white/5 p-2 rounded-lg hover:border-white/10 transition-colors">
                <div className="flex items-center gap-3">
                  <div className={`px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest rounded border ${statusColors[task.status]}`}>
                    {task.status}
                  </div>
                  <span className="font-mono text-sm capitalize">{task.type.replace('_', ' ')}</span>
                </div>
                <button 
                  onClick={() => removeTask({ taskId: task.id }, { onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/tasks"] }) })}
                  className="opacity-0 group-hover:opacity-100 p-1 text-muted-foreground hover:text-destructive transition-all"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            ))
          )}
        </div>

      </div>
    </Panel>
  );
}

import * as React from "react";
import { cn } from "@/lib/utils";
import { motion, HTMLMotionProps } from "framer-motion";

export const Panel = React.forwardRef<HTMLDivElement, HTMLMotionProps<"div">>(
  ({ className, children, ...props }, ref) => {
    return (
      <motion.div
        ref={ref}
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
        className={cn(
          "glass-panel rounded-xl overflow-hidden relative group",
          className
        )}
        {...props}
      >
        {/* Subtle decorative corner accent */}
        <div className="absolute top-0 left-0 w-8 h-8 border-t-2 border-l-2 border-primary/40 rounded-tl-xl pointer-events-none" />
        {children}
      </motion.div>
    );
  }
);
Panel.displayName = "Panel";

export const PanelHeader = ({ title, icon: Icon, action }: { title: string; icon?: any; action?: React.ReactNode }) => (
  <div className="flex items-center justify-between p-4 border-b border-border/50 bg-card/40">
    <div className="flex items-center gap-2 text-primary">
      {Icon && <Icon className="w-5 h-5" />}
      <h2 className="text-lg font-bold glow-text m-0">{title}</h2>
    </div>
    {action && <div>{action}</div>}
  </div>
);

export const GameButton = React.forwardRef<HTMLButtonElement, React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'danger' | 'outline' }>(
  ({ className, variant = 'primary', ...props }, ref) => {
    const variants = {
      primary: "bg-primary text-primary-foreground hover:bg-primary/90 shadow-[0_0_15px_rgba(0,255,0,0.2)] hover:shadow-[0_0_25px_rgba(0,255,0,0.4)]",
      secondary: "bg-secondary text-secondary-foreground hover:bg-secondary/80",
      danger: "bg-destructive text-destructive-foreground hover:bg-destructive/90 shadow-[0_0_15px_rgba(255,0,0,0.2)] hover:shadow-[0_0_25px_rgba(255,0,0,0.4)]",
      outline: "bg-transparent border-2 border-primary text-primary hover:bg-primary/10"
    };

    return (
      <button
        ref={ref}
        className={cn(
          "px-4 py-2 rounded-lg font-display font-bold uppercase tracking-wider transition-all duration-200 active:scale-95 disabled:opacity-50 disabled:pointer-events-none flex items-center justify-center gap-2",
          variants[variant],
          className
        )}
        {...props}
      />
    );
  }
);
GameButton.displayName = "GameButton";

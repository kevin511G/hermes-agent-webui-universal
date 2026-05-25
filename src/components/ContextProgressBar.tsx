import * as React from "react";
import { cn } from "@/src/lib/utils";

interface ContextProgressBarProps {
  usedTokens: number;
  maxTokens?: number;
  className?: string;
}

const DEFAULT_MAX_TOKENS = 262_144; // 256K context window

export function ContextProgressBar({
  usedTokens,
  maxTokens = DEFAULT_MAX_TOKENS,
  className,
}: ContextProgressBarProps) {
  const percentage = Math.min((usedTokens / maxTokens) * 100, 100);

  let barColor = "bg-blue-500";
  if (percentage > 90) barColor = "bg-red-500";
  else if (percentage > 75) barColor = "bg-orange-500";
  else if (percentage > 50) barColor = "bg-yellow-500";

  return (
    <div className={cn("px-2 py-1.5", className)}>
      <div className="max-w-4xl mx-auto">
        {/* Progress bar */}
        <div className="w-full h-[4px] bg-slate-100 rounded-full overflow-hidden">
          <div
            className={cn("h-full rounded-full transition-all duration-700 ease-out", barColor)}
            style={{ width: `${percentage}%` }}
          />
        </div>

        {/* Label + count */}
        <div className="flex items-center justify-between mt-1 px-1">
          <span className="text-[10px] text-slate-400 font-medium">
            Tokens this turn
          </span>
          <span className="text-[10px] font-mono text-slate-500">
            {usedTokens.toLocaleString()} / {maxTokens.toLocaleString()}
          </span>
        </div>
      </div>
    </div>
  );
}

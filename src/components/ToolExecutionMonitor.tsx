import * as React from "react";
import { Loader2, CheckCircle2, AlertCircle, Brain } from "lucide-react";
import { cn } from "@/src/lib/utils";

export interface ToolLog {
  id: string;
  name: string;
  status: "running" | "success" | "error";
  timestamp: string;
  details?: string;
}

interface ToolExecutionMonitorProps {
  logs: ToolLog[];
  thinking?: string;
}

export function ToolExecutionMonitor({
  logs,
  thinking,
}: ToolExecutionMonitorProps) {
  const thinkingRef = React.useRef<HTMLDivElement>(null);
  const logsRef = React.useRef<HTMLDivElement>(null);

  const runningCount = logs.filter((l) => l.status === "running").length;
  const successCount = logs.filter((l) => l.status === "success").length;
  const errorCount = logs.filter((l) => l.status === "error").length;

  React.useEffect(() => {
    if (thinkingRef.current) {
      thinkingRef.current.scrollTop = thinkingRef.current.scrollHeight;
    }
  }, [thinking]);

  React.useEffect(() => {
    if (logsRef.current) {
      logsRef.current.scrollTop = logsRef.current.scrollHeight;
    }
  }, [logs]);

  const hasAnyContent = logs.length > 0 || thinking;

  return (
    <div className="border-b border-slate-200 bg-slate-50/80 backdrop-blur-sm">
      <div className="max-w-4xl mx-auto px-4 py-2">
        {/* Thinking section - full width */}
        <div className="h-[60px] mb-1">
          {thinking ? (
            <div
              ref={thinkingRef}
              className="h-full px-2 overflow-y-auto scroll-smooth text-[10px] font-mono leading-relaxed text-blue-600 whitespace-pre-wrap"
            >
              {thinking}
            </div>
          ) : (
            <div className="flex items-center h-full text-[10px] text-slate-400">
              沒有正在思考的內容
            </div>
          )}
        </div>

        {/* Tool log entries - compact row, only show when there are logs */}
        {logs.length > 0 && (
          <div
            ref={logsRef}
            className="h-[30px] overflow-y-auto scroll-smooth"
          >
            <div className="flex items-center gap-1.5">
              {logs.map((log) => (
                <div
                  key={log.id}
                  className={cn(
                    "flex items-center gap-1 px-1.5 py-0.5 rounded transition-colors shrink-0",
                    log.status === "running" && "bg-blue-50/60",
                    log.status === "success" && "bg-green-50/60",
                    log.status === "error" && "bg-red-50/60"
                  )}
                >
                  {log.status === "running" ? (
                    <Loader2 className="w-2.5 h-2.5 animate-spin text-blue-500 shrink-0" />
                  ) : log.status === "success" ? (
                    <CheckCircle2 className="w-2.5 h-2.5 text-green-500 shrink-0" />
                  ) : (
                    <AlertCircle className="w-2.5 h-2.5 text-red-500 shrink-0" />
                  )}
                  <span
                    className={cn(
                      "text-[9px] font-medium truncate",
                      log.status === "running" && "text-blue-700",
                      log.status === "success" && "text-green-700",
                      log.status === "error" && "text-red-700"
                    )}
                  >
                    {log.name}
                  </span>
                  <span className="text-[8px] text-slate-400 font-mono shrink-0">
                    {log.timestamp.split(":").slice(1).join(":")}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

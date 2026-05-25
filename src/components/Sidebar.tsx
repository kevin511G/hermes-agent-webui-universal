import * as React from "react";
import { motion } from "motion/react";
import { 
  PanelLeftClose, 
  Plus, 
  MessageSquare, 
  Settings, 
  Cpu, 
  Fingerprint,
  History,
  Trash2,
  Edit2,
  CalendarClock,
  Clock,
  Repeat2
} from "lucide-react";
import { cn } from "@/src/lib/utils";

interface CronJob {
  id: string;
  name: string;
  summary: string;
  schedule: string;
  repeat: string;
  nextRunAt?: string | null;
  lastRunAt?: string | null;
  lastStatus?: string | null;
  enabled: boolean;
  state: string;
  skills?: string[];
  deliver?: string;
}

interface ModelProvider {
  slug: string;
  name: string;
  models: string[];
  authenticated?: boolean;
  warning?: string;
}

interface SidebarProps {
  isOpen: boolean;
  setIsOpen: (open: boolean) => void;
  currentModel: string;
  currentProvider: string;
  modelProviders: ModelProvider[];
  isModelLoading: boolean;
  isModelUpdating: boolean;
  onModelChange: (provider: string, model: string) => void;
  sessionId: string;
  history: Array<{ id: string; title: string; date: string; source?: string }>;
  cronJobs: CronJob[];
  isCronLoading: boolean;
  onSelectSession: (id: string) => void;
  onDeleteSession: (id: string) => void;
  onRenameSession: (id: string, newTitle: string) => void;
  onNewChat: () => void;
  apiBaseUrl: string;
}

function formatDateTime(value?: string | null) {
  if (!value) return "Not scheduled";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function CronJobCard({ job }: { job: CronJob }) {
  const isPaused = !job.enabled || job.state === "paused";
  return (
    <div className="rounded-xl border border-slate-200 bg-white/60 p-3 shadow-sm space-y-2">
      <div className="flex items-start gap-2">
        <CalendarClock className={cn("w-4 h-4 mt-0.5 shrink-0", isPaused ? "text-slate-400" : "text-emerald-500")} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 min-w-0">
            <div className="truncate text-sm font-medium text-slate-800">{job.name}</div>
            <span className={cn(
              "shrink-0 rounded-md px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide border",
              isPaused
                ? "bg-slate-100 text-slate-500 border-slate-200"
                : "bg-emerald-50 text-emerald-700 border-emerald-100"
            )}>
              {isPaused ? "Paused" : job.state || "Scheduled"}
            </span>
          </div>
          {job.summary && (
            <p className="mt-1 line-clamp-2 text-xs leading-5 text-slate-500">
              {job.summary}
            </p>
          )}
        </div>
      </div>

      <div className="space-y-1.5 text-xs text-slate-500">
        <div className="flex items-center gap-2">
          <Repeat2 className="w-3.5 h-3.5 text-slate-400" />
          <span className="truncate">{job.schedule || "No schedule"}{job.repeat ? ` · ${job.repeat}` : ""}</span>
        </div>
        <div className="flex items-center gap-2">
          <Clock className="w-3.5 h-3.5 text-slate-400" />
          <span className="truncate">Next: {formatDateTime(job.nextRunAt)}</span>
        </div>
        {job.lastRunAt && (
          <div className="pl-5 truncate">
            Last: {formatDateTime(job.lastRunAt)}{job.lastStatus ? ` · ${job.lastStatus}` : ""}
          </div>
        )}
      </div>

      {job.skills && job.skills.length > 0 && (
        <div className="flex flex-wrap gap-1 pt-1">
          {job.skills.slice(0, 3).map(skill => (
            <span key={skill} className="rounded-md bg-blue-50 px-1.5 py-0.5 text-[10px] font-medium text-blue-600 border border-blue-100">
              {skill}
            </span>
          ))}
          {job.skills.length > 3 && (
            <span className="rounded-md bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-500 border border-slate-200">
              +{job.skills.length - 3}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

export function Sidebar({ 
  isOpen, 
  setIsOpen, 
  currentModel, 
  currentProvider,
  modelProviders,
  isModelLoading,
  isModelUpdating,
  onModelChange,
  sessionId, 
  history,
  cronJobs,
  isCronLoading,
  onSelectSession,
  onDeleteSession,
  onRenameSession,
  onNewChat,
  apiBaseUrl
}: SidebarProps) {
  const [activePanel, setActivePanel] = React.useState<"history" | "cron">("history");
  const selectedModelValue = currentProvider && currentModel
    ? `${currentProvider}::${currentModel}`
    : "";
  const selectableProviders = modelProviders.filter(
    provider => provider.models && provider.models.length > 0 && provider.authenticated !== false
  );

  return (
    <motion.div
      initial={false}
      animate={{ width: isOpen ? 280 : 0 }}
      className={cn(
        "relative flex flex-col h-full bg-sidebar-bg border-r border-slate-200 overflow-hidden shrink-0",
        !isOpen && "border-r-0"
      )}
    >
      <div className="flex flex-col h-full w-[280px]">
        {/* Header */}
        <div className="p-4 flex items-center justify-between">
          <button
            onClick={onNewChat}
            className="flex items-center gap-2 px-3 py-2 bg-white border border-slate-200 rounded-xl text-sm font-medium hover:bg-slate-50 transition-colors shadow-sm"
          >
            <Plus className="w-4 h-4" />
            <span>New Chat</span>
          </button>
          
          <button
            onClick={() => setIsOpen(false)}
            className="p-2 hover:bg-slate-200/50 rounded-lg transition-colors text-slate-500"
          >
            <PanelLeftClose className="w-5 h-5" />
          </button>
        </div>

        {/* Info Section */}
        <div className="px-4 py-2 space-y-3">
          <div className="p-3 bg-white/50 rounded-xl border border-slate-100 space-y-2">
            <div className="flex items-center gap-2 text-xs font-semibold text-slate-400 uppercase tracking-wider">
              <Cpu className="w-3 h-3" />
              <span>Current Model</span>
            </div>
            <select
              value={selectedModelValue}
              disabled={isModelLoading || isModelUpdating || selectableProviders.length === 0}
              onChange={(event) => {
                const [provider, ...modelParts] = event.target.value.split("::");
                onModelChange(provider, modelParts.join("::"));
              }}
              className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-sm font-medium text-slate-700 outline-none transition-colors hover:border-slate-300 focus:border-blue-400 focus:ring-2 focus:ring-blue-100 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-400"
              title={currentProvider ? `${currentProvider}: ${currentModel}` : currentModel}
            >
              {!selectedModelValue && (
                <option value="">{isModelLoading ? "Loading models..." : "Select model"}</option>
              )}
              {selectedModelValue && !selectableProviders.some(provider =>
                provider.slug === currentProvider && provider.models.includes(currentModel)
              ) && (
                <option value={selectedModelValue}>{currentModel}</option>
              )}
              {selectableProviders.map(provider => (
                <optgroup key={provider.slug} label={provider.name || provider.slug}>
                  {provider.models.map(model => (
                    <option key={`${provider.slug}::${model}`} value={`${provider.slug}::${model}`}>
                      {model}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
            <div className="truncate text-[10px] font-medium text-slate-400">
              {isModelUpdating
                ? "Updating Hermes config..."
                : currentProvider || "Provider unavailable"}
            </div>
          </div>

          <div className="p-3 bg-white/50 rounded-xl border border-slate-100 space-y-2">
            <div className="flex items-center gap-2 text-xs font-semibold text-slate-400 uppercase tracking-wider">
              <Fingerprint className="w-3 h-3" />
              <span>Session ID</span>
            </div>
            <div className="text-xs font-mono text-slate-500 truncate">
              {sessionId}
            </div>
          </div>
        </div>

        {/* Switcher */}
        <div className="px-4 pt-3">
          <div className="grid grid-cols-2 rounded-xl bg-slate-200/60 p-1 text-xs font-semibold text-slate-500">
            <button
              onClick={() => setActivePanel("history")}
              className={cn(
                "flex items-center justify-center gap-1.5 rounded-lg px-2 py-1.5 transition-all",
                activePanel === "history" ? "bg-white text-slate-900 shadow-sm" : "hover:text-slate-700"
              )}
            >
              <History className="w-3.5 h-3.5" />
              History
            </button>
            <button
              onClick={() => setActivePanel("cron")}
              className={cn(
                "flex items-center justify-center gap-1.5 rounded-lg px-2 py-1.5 transition-all",
                activePanel === "cron" ? "bg-white text-slate-900 shadow-sm" : "hover:text-slate-700"
              )}
            >
              <CalendarClock className="w-3.5 h-3.5" />
              Cron
              {cronJobs.length > 0 && (
                <span className="rounded-full bg-slate-100 px-1.5 text-[10px] text-slate-500">
                  {cronJobs.length}
                </span>
              )}
            </button>
          </div>
        </div>

        {/* History / Cron Section */}
        <div className="flex-1 overflow-y-auto px-2 py-4 space-y-1">
          {activePanel === "history" ? (
            <>
              <div className="px-3 mb-2 flex items-center gap-2 text-xs font-semibold text-slate-400 uppercase tracking-wider">
                <History className="w-3 h-3" />
                <span>Recent History</span>
              </div>
              
              {history.map((item) => (
                <div key={item.id} className="relative group/item">
                  <button
                    onClick={() => onSelectSession(item.id)}
                    className={cn(
                      "w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm text-left transition-all group",
                      sessionId === item.id 
                        ? "bg-white text-slate-900 shadow-sm border border-slate-200 pr-10" 
                        : "text-slate-600 hover:bg-slate-200/50 pr-10"
                    )}
                  >
                    <MessageSquare className={cn(
                      "w-4 h-4 shrink-0",
                      sessionId === item.id ? "text-blue-500" : "text-slate-400 group-hover:text-slate-500"
                    )} />
                    <span className="min-w-0 flex-1 truncate">{item.title}</span>
                    {item.source === "cli" && (
                      <span className="shrink-0 rounded-md bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500 border border-slate-200">
                        CLI
                      </span>
                    )}
                  </button>
                  
                  <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-0.5">
                    <button
                      onClick={async (e) => {
                        e.stopPropagation();
                        const newTitle = prompt("Rename conversation:", item.title);
                        if (newTitle && newTitle.trim()) {
                          try {
                            const res = await fetch(`${apiBaseUrl}/sessions/${item.id}`, {
                              method: 'PATCH',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({ title: newTitle.trim() })
                            });
                            if (res.ok) {
                              onRenameSession(item.id, newTitle.trim());
                            } else {
                              const err = await res.json();
                              alert("Failed to rename: " + (err.detail || "Unknown error"));
                            }
                          } catch (err) {
                            console.error("Rename failed:", err);
                            alert("Failed to rename: " + (err instanceof Error ? err.message : "Unknown error"));
                          }
                        }
                      }}
                      className={cn(
                        "p-1.5 rounded-lg text-slate-400 hover:text-blue-500 hover:bg-blue-50 transition-all opacity-0 group-hover/item:opacity-100",
                        sessionId === item.id && "opacity-100"
                      )}
                    >
                      <Edit2 className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={async (e) => {
                        e.stopPropagation();
                        if (confirm("Delete this conversation?")) {
                          try {
                            const res = await fetch(`${apiBaseUrl}/sessions/${item.id}`, {
                              method: 'DELETE'
                            });
                            if (res.ok) {
                              onDeleteSession(item.id);
                            } else {
                              const err = await res.json();
                              alert("Failed to delete: " + (err.detail || "Unknown error"));
                            }
                          } catch (err) {
                            console.error("Delete failed:", err);
                            alert("Failed to delete: " + (err instanceof Error ? err.message : "Unknown error"));
                          }
                        }
                      }}
                      className={cn(
                        "p-1.5 rounded-lg text-slate-400 hover:text-red-500 hover:bg-red-50 transition-all opacity-0 group-hover/item:opacity-100",
                        sessionId === item.id && "opacity-100"
                      )}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </>
          ) : (
            <>
              <div className="px-3 mb-2 flex items-center gap-2 text-xs font-semibold text-slate-400 uppercase tracking-wider">
                <CalendarClock className="w-3 h-3" />
                <span>Cron Jobs</span>
              </div>
              {isCronLoading ? (
                <div className="px-3 py-8 text-center text-sm text-slate-400">Loading cron jobs...</div>
              ) : cronJobs.length === 0 ? (
                <div className="mx-2 rounded-xl border border-dashed border-slate-200 bg-white/40 px-3 py-6 text-center text-sm text-slate-400">
                  No cron jobs yet.
                </div>
              ) : (
                <div className="space-y-2 px-1">
                  {cronJobs.map(job => <CronJobCard key={job.id} job={job} />)}
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-slate-200">
          <button className="w-full flex items-center gap-3 px-3 py-2 rounded-xl text-sm text-slate-600 hover:bg-slate-200/50 transition-colors">
            <Settings className="w-4 h-4" />
            <span>Settings</span>
          </button>
        </div>
      </div>
    </motion.div>
  );
}

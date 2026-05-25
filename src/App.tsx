import * as React from "react";
import { Sidebar } from "./components/Sidebar";
import { FileExplorerPanel } from "./components/FileExplorerPanel";
import { MessageBubble } from "./components/MessageBubble";
import { ChatInput } from "./components/ChatInput";
import { ThinkingIndicator } from "./components/ThinkingIndicator";
import { ContextProgressBar } from "./components/ContextProgressBar";
import { ToolExecutionMonitor, type ToolLog } from "./components/ToolExecutionMonitor";
import { PanelLeftOpen, PanelRightOpen, Search, Sparkles, Square } from "lucide-react";
import { cn } from "@/src/lib/utils";

// Hermes REST Proxy Config
// Default works with Vite's /api proxy. Set VITE_HERMES_API_URL when serving
// the frontend separately from the backend, e.g. http://127.0.0.1:3001/api.
const HERMES_API_URL = import.meta.env.VITE_HERMES_API_URL || "/api";

interface AttachedFile {
  name: string;
  size: number;
  type: string;
  path: string;
  isImage?: boolean;
  preview?: string;
}

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: string;
}

interface Session {
  id: string;
  title: string;
  date: string;
  source?: "web" | "cli" | string;
}

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

// Each chat turn: user asks → tools execute → assistant responds
interface ChatTurn {
  id: string;
  userMessage: Message;
  assistantMessage: Message | null;
}

export default function App() {
  const [isSidebarOpen, setIsSidebarOpen] = React.useState(true);
  const [isFilePanelOpen, setIsFilePanelOpen] = React.useState(false);
  const [isThinking, setIsThinking] = React.useState(false);
  const [sessionThinking, setSessionThinking] = React.useState("");
  const [currentToolLogs, setCurrentToolLogs] = React.useState<ToolLog[]>([]);
  const [chatTurns, setChatTurns] = React.useState<ChatTurn[]>([]);
  const [currentModel, setCurrentModel] = React.useState("Loading...");
  const [agentVersion, setAgentVersion] = React.useState("");
  const [sessionId, setSessionId] = React.useState("");
  const [usedTokens, setUsedTokens] = React.useState(0);
  const [maxContextTokens, setMaxContextTokens] = React.useState(65536);
  const [prevCumulativeTokens, setPrevCumulativeTokens] = React.useState(0);
  const [history, setHistory] = React.useState<Session[]>([]);
  const [cronJobs, setCronJobs] = React.useState<CronJob[]>([]);
  const [isCronLoading, setIsCronLoading] = React.useState(true);
  const [isLoading, setIsLoading] = React.useState(true);

  // Load sessions and initial messages on mount
  React.useEffect(() => {
    let cancelled = false;

    const loadSessionMessages = async (id: string) => {
      try {
        const res = await fetch(`${HERMES_API_URL}/sessions/${id}`);
        if (res.ok) {
          const data = await res.json();
          const msgs: Message[] = (data.messages || [])
            .filter((m: any) => m.role === "user" || m.role === "assistant")
            .map((m: any, idx: number) => ({
              id: `msg_${idx}`,
              role: m.role,
              content: m.content,
              timestamp: m.timestamp
                ? new Date(m.timestamp * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                : new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            }));
          // Group into turns: user → assistant
          const turns: ChatTurn[] = [];
          let currentTurn: ChatTurn | null = null;
          for (const msg of msgs) {
            if (msg.role === "user") {
              if (currentTurn) turns.push(currentTurn);
              currentTurn = {
                id: `turn_${msg.id}`,
                userMessage: msg,
                assistantMessage: null,
              };
            } else if (currentTurn) {
              currentTurn.assistantMessage = msg;
            }
          }
          if (currentTurn) turns.push(currentTurn);
          setChatTurns(turns);
        }
      } catch (err) {
        console.error("Failed to load session messages:", err);
      }
    };

    const loadSessions = async () => {
      try {
        const res = await fetch(`${HERMES_API_URL}/sessions`);
        if (res.ok) {
          const sessions: Session[] = await res.json();
          if (!cancelled) {
            setHistory(sessions);
            if (sessions.length > 0) {
              const first = sessions[0];
              const savedSessionId = localStorage.getItem("hermes_session_id");
              const targetId = savedSessionId && sessions.some(s => s.id === savedSessionId)
                ? savedSessionId
                : first.id;

              setSessionId(targetId);
              await loadSessionMessages(targetId);
              // Get baseline cumulative for later delta calc
              getCumulativeTokens(targetId).then(tokens => {
                setPrevCumulativeTokens(tokens);
              }).catch(() => setPrevCumulativeTokens(0));
            }
          }
        }
      } catch (err) {
        console.error("Failed to load sessions:", err);
      }
      // Fetch current model and agent version in parallel
      fetch(`${HERMES_API_URL}/models/current`)
        .then(r => r.ok ? r.json() : null)
        .then(data => {
          if (!cancelled && data?.model) {
            setCurrentModel(data.model);
            if (data?.max_context_length) {
              setMaxContextTokens(data.max_context_length);
            }
          }
        })
        .catch(() => {
          if (!cancelled) setCurrentModel("Unknown");
        })
        .finally(() => {
          if (!cancelled) setIsLoading(false);
        });
      fetch(`${HERMES_API_URL}/health`)
        .then(r => r.ok ? r.json() : null)
        .then(data => {
          if (!cancelled && data?.version) setAgentVersion(data.version);
        })
        .catch(() => {});
      fetch(`${HERMES_API_URL}/cron/jobs`)
        .then(r => r.ok ? r.json() : null)
        .then(data => {
          if (!cancelled) setCronJobs(data?.jobs || []);
        })
        .catch(err => {
          console.error("Failed to load cron jobs:", err);
          if (!cancelled) setCronJobs([]);
        })
        .finally(() => {
          if (!cancelled) setIsCronLoading(false);
        });
      return;
    };

    loadSessions();
    return () => { cancelled = true; };
  }, []);

  const messagesEndRef = React.useRef<HTMLDivElement>(null);
  const abortControllerRef = React.useRef<AbortController | null>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  React.useEffect(() => {
    scrollToBottom();
  }, [chatTurns]);

  // Abort the current SSE stream
  const abortCurrentStream = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
  };

  // Interrupt the agent on the backend — fire-and-forget, never await
  const handleInterrupt = async () => {
    abortCurrentStream();
    if (sessionId) {
      // Fire-and-forget: don't await, don't catch errors here
      // This ensures the UI never blocks waiting for the proxy to respond
      fetch(`${HERMES_API_URL}/interrupt`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId }),
      }).catch(() => { /* silently ignore — interrupt is best-effort */ });
    }
  };

  const handleSelectSession = (id: string) => {
    setSessionId(id);
    localStorage.setItem("hermes_session_id", id);
    setSessionThinking("");
    setChatTurns([]);
    fetch(`${HERMES_API_URL}/sessions/${id}`)
      .then(res => res.ok ? res.json() : Promise.reject(new Error("Failed")))
      .then(data => {
        const msgs: Message[] = (data.messages || [])
          .filter((m: any) => m.role === "user" || m.role === "assistant")
          .map((m: any, idx: number) => ({
            id: `msg_${idx}`,
            role: m.role,
            content: m.content,
            timestamp: m.timestamp
              ? new Date(m.timestamp * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
              : new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          }));
        const turns: ChatTurn[] = [];
        let currentTurn: ChatTurn | null = null;
        for (const msg of msgs) {
          if (msg.role === "user") {
            if (currentTurn) turns.push(currentTurn);
            currentTurn = {
              id: `turn_${msg.id}`,
              userMessage: msg,
              assistantMessage: null,
            };
          } else if (currentTurn) {
            currentTurn.assistantMessage = msg;
          }
        }
        if (currentTurn) turns.push(currentTurn);
        setChatTurns(turns);
        // Load cumulative for reference on session switch
        getCumulativeTokens(id).then(tokens => {
          // Not setting state — just for reference; the progress bar shows per-turn usage
          setPrevCumulativeTokens(tokens);
        }).catch(() => setPrevCumulativeTokens(0));
      })
      .catch(err => console.error("Failed to load session messages:", err));
  };

  const handleDeleteSession = (id: string) => {
    setHistory(prev => prev.filter(h => h.id !== id));
    if (sessionId === id) {
      const newId = `sess_${Date.now()}`;
      setSessionId(newId);
      localStorage.setItem("hermes_session_id", newId);
      setChatTurns([]);
      setSessionThinking("");
      setCurrentToolLogs([]);
      setUsedTokens(0);
      setPrevCumulativeTokens(0);
    }
  };

  const handleRenameSession = (id: string, newTitle: string) => {
    setHistory(prev => prev.map(h => h.id === id ? { ...h, title: newTitle } : h));
  };

  // Get cumulative token usage for a session
  const getCumulativeTokens = async (id: string) => {
    try {
      const res = await fetch(`${HERMES_API_URL}/sessions/${id}/usage`);
      if (res.ok) {
        const data = await res.json();
        return (data.input_tokens || 0) + (data.output_tokens || 0) + (data.reasoning_tokens || 0);
      }
    } catch { /* ignore */ }
    return 0;
  };

  const addToolLogToTurn = (name: string, status: ToolLog["status"], details?: string) => {
    const newLog: ToolLog = {
      id: Math.random().toString(36).substring(7),
      name,
      status,
      timestamp: new Date().toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' }),
      details
    };
    setCurrentToolLogs(prev => [...prev, newLog]);
  };

  const appendThinkingToSession = (content: string) => {
    setSessionThinking(prev => {
      // 單純追加內容，不加分隔線
      return prev + content;
    });
  };

  const setAssistantMessage = (turnId: string, content: string) => {
    const msg: Message = {
      id: (Date.now() + 1).toString(),
      role: "assistant",
      content,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    };
    setChatTurns(prev => prev.map(t => {
      if (t.id !== turnId) return t;
      return { ...t, assistantMessage: msg };
    }));
  };

  const appendAssistantMessage = (turnId: string, content: string) => {
    const timestamp = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    setChatTurns(prev => prev.map(t => {
      if (t.id !== turnId) return t;
      return {
        ...t,
        assistantMessage: t.assistantMessage
          ? { ...t.assistantMessage, content }
          : {
              id: (Date.now() + 1).toString(),
              role: "assistant",
              content,
              timestamp,
            },
      };
    }));
  };

  const handleSendMessage = async (content: string, attachedFiles: AttachedFile[] = []) => {
    // If the agent is currently thinking, interrupt it first BEFORE checking empty content
    if (isThinking) {
      await handleInterrupt();
      // After interrupt, wait a brief moment for state to settle, then continue
      await new Promise(r => setTimeout(r, 100));
    }

    if (!content.trim() && attachedFiles.length === 0) return;

    const imageFiles = attachedFiles.filter(f => f.isImage);
    const docFiles = attachedFiles.filter(f => !f.isImage);

    let messageToSend = content;
    if (docFiles.length > 0) {
      const filePaths = docFiles.map(f => `📎 ${f.name} (${f.size} bytes, saved at: ${f.path})`).join('\n');
      messageToSend = content
        ? `${content}\n\n---\nAttached documents:\n${filePaths}`
        : `Attached documents:\n${filePaths}`;
    }

    const userMessage: Message = {
      id: Date.now().toString(),
      role: "user",
      content: messageToSend,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    };

    const turnId = `turn_${Date.now()}`;
    const newTurn: ChatTurn = {
      id: turnId,
      userMessage,
      assistantMessage: null,
    };

    setChatTurns(prev => [...prev, newTurn]);
    setIsThinking(true);
    setUsedTokens(0);

    // Capture baseline token count before sending
    const baselineTokens = await getCumulativeTokens(sessionId || `sess_${Date.now()}`);

    try {
      const controller = new AbortController();
      abortControllerRef.current = controller;

      const response = await fetch(`${HERMES_API_URL}/chat/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: messageToSend,
          sessionId: sessionId || `sess_${Date.now()}`,
          images: imageFiles
            .filter(f => f.preview)
            .map(f => ({ name: f.name, dataUrl: f.preview! })),
        }),
        signal: controller.signal,
      });

      if (!response.ok) throw new Error(`API error: ${response.status}`);

      const reader = response.body?.getReader();
      if (!reader) throw new Error('No response body');

      let fullContent = '';
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += new TextDecoder().decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          try {
            const data = JSON.parse(line.slice(6));
            // console.log('[SSE EVENT]', data);

            if (data.type === 'thinking' && data.content) {
              appendThinkingToSession(data.content);
            } else if (data.type === 'message' && data.content) {
              fullContent += data.content;
              appendAssistantMessage(turnId, fullContent);
            } else if (data.type === 'error') {
              const errorMessage = data.content || 'Unknown server error';
              fullContent = fullContent
                ? `${fullContent}\n\nError: ${errorMessage}`
                : `Error: ${errorMessage}`;
              appendAssistantMessage(turnId, fullContent);
            } else if (data.type === 'tool' && data.name) {
              addToolLogToTurn(data.name, data.status || 'running', data.details);
            } else if (data.type === 'done') {
              // Calculate per-turn token usage (delta from baseline)
              const postTokens = await getCumulativeTokens(sessionId || `sess_${Date.now()}`);
              setUsedTokens(Math.max(postTokens - baselineTokens, 0));

              if (fullContent) {
                setAssistantMessage(turnId, fullContent);
              } else {
                // Still mark as done even without content
                setChatTurns(prev => prev.map(t => {
                  if (t.id !== turnId) return t;
                  return { ...t, assistantMessage: null };
                }));
              }
              setIsThinking(false);
              setCurrentToolLogs([]);
              // Turn 結束時，加上分隔線（確保結尾有 \n 再加分隔線）
              setSessionThinking(prev => {
                const trailing = prev.endsWith('\n') ? '' : '\n';
                return prev + trailing + "=========\n";
              });
              // Reload sessions list to get updated title
              fetch(`${HERMES_API_URL}/sessions`)
                .then(r => r.ok ? r.json() : [])
                .then((sessions: Session[]) => {
                  if (sessions.length > 0) {
                    setHistory(sessions);
                  }
                })
                .catch(() => {});
              return;
            }
          } catch { /* skip malformed JSON */ }
        }
      }
    } catch (err) {
      // If the error is from abort (user clicked stop), don't show error message
      const isAbort = err instanceof DOMException && err.name === 'AbortError';
      if (!isAbort) {
        console.error('Chat error:', err);
        setChatTurns(prev => prev.map(t => {
          if (t.id !== turnId) return t;
          return {
            ...t,
            assistantMessage: {
              id: (Date.now() + 1).toString(),
              role: "assistant",
              content: `Error: ${err instanceof Error ? err.message : 'Unknown error'}`,
              timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
            },
          };
        }));
      }
    } finally {
      setIsThinking(false);
      setCurrentToolLogs([]);
      abortControllerRef.current = null;
    }
  };

  const handleNewChat = () => {
    fetch(`${HERMES_API_URL}/sessions`, { method: 'POST' })
      .then(res => res.ok ? res.json() : null)
      .then(data => {
        const newId = data?.id || `sess_${Date.now()}`;
        const newSession: Session = {
          id: newId,
          title: "New Conversation",
          date: "Just now",
          source: "web",
        };
        setSessionId(newId);
        localStorage.setItem("hermes_session_id", newId);
        setHistory(prev => [newSession, ...prev]);
        setChatTurns([]);
        setUsedTokens(0);
        setPrevCumulativeTokens(0);
      })
      .catch(() => {
        const newId = `sess_${Date.now()}`;
        setSessionId(newId);
        localStorage.setItem("hermes_session_id", newId);
        const newSession: Session = {
          id: newId,
          title: "New Conversation",
          date: "Just now",
          source: "web",
        };
        setHistory(prev => [newSession, ...prev]);
        setChatTurns([]);
        setUsedTokens(0);
        setPrevCumulativeTokens(0);
      });
  };

  return (
    <div className="flex h-screen w-full bg-chat-bg overflow-hidden">
      <Sidebar
        isOpen={isSidebarOpen}
        setIsOpen={setIsSidebarOpen}
        currentModel={currentModel}
        sessionId={sessionId}
        history={history}
        cronJobs={cronJobs}
        isCronLoading={isCronLoading}
        onSelectSession={handleSelectSession}
        onDeleteSession={handleDeleteSession}
        onRenameSession={handleRenameSession}
        onNewChat={handleNewChat}
        apiBaseUrl={HERMES_API_URL}
      />

      <main className="flex-1 flex flex-col relative min-w-0">
        <header className="h-[48px] flex items-center justify-between px-4 border-b border-slate-100 shrink-0">
          <div className="flex items-center gap-3">
            {!isSidebarOpen && (
              <button
                onClick={() => setIsSidebarOpen(true)}
                className="p-1.5 hover:bg-slate-100 rounded-lg transition-colors text-slate-500"
              >
                <PanelLeftOpen className="w-4 h-4" />
              </button>
            )}
            <div className="flex items-center gap-2 px-2.5 py-1 bg-blue-50 text-blue-600 rounded-full text-sm font-semibold whitespace-nowrap">
              <Sparkles className="w-3.5 h-3.5" />
              <span className="text-xs">Hermes Agent{agentVersion ? ` v${agentVersion}` : ""}</span>
            </div>
          </div>

          <div className="flex items-center gap-1">
            {/* Stop button - visible when agent is thinking */}
            {isThinking && (
              <button
                onClick={handleInterrupt}
                className="p-1.5 hover:bg-red-100 rounded-full transition-colors text-red-500"
                title="Stop generation"
              >
                <Square className="w-4 h-4 fill-current" />
              </button>
            )}
            {!isFilePanelOpen && (
              <button
                onClick={() => setIsFilePanelOpen(true)}
                className="p-1.5 hover:bg-slate-100 rounded-lg transition-colors text-slate-500"
              >
                <PanelRightOpen className="w-4 h-4" />
              </button>
            )}
            <button className="p-1.5 hover:bg-slate-100 rounded-full text-slate-500 transition-colors">
              <Search className="w-4 h-4" />
            </button>
            <div className="w-7 h-7 rounded-full bg-gradient-to-tr from-blue-500 to-indigo-600 shadow-sm" />
          </div>
        </header>

        {/* Global ToolExecutionMonitor - sticky at top, always visible when there's thinking or tools */}
        {sessionId && (sessionThinking.length > 0 || currentToolLogs.length > 0 || isThinking) && (
          <div className="shrink-0 sticky top-[48px] z-20 border-b border-slate-200 bg-slate-50/90 backdrop-blur-sm">
            <ToolExecutionMonitor
              logs={currentToolLogs}
              thinking={sessionThinking}
            />
          </div>
        )}

        <div className="flex flex-1 overflow-hidden">
          {/* Chat Content */}
          <div className="flex-1 flex flex-col min-w-0">
            <div className="flex-1 overflow-y-auto overflow-x-hidden scroll-smooth">
              <div className="max-w-5xl mx-auto w-full px-4 py-8">
                {isLoading ? (
                  <div className="flex flex-col items-center justify-center h-[60vh] text-center px-4">
                    <div className="w-12 h-12 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mb-4" />
                    <p className="text-slate-500">Loading sessions...</p>
                  </div>
                ) : chatTurns.length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-[60vh] text-center px-4">
                    <div className="w-16 h-16 bg-blue-50 rounded-2xl flex items-center justify-center mb-6">
                      <Sparkles className="w-8 h-8 text-blue-500" />
                    </div>
                    <h1 className="text-3xl font-semibold text-slate-900 mb-3">
                      How can I help you today?
                    </h1>
                    <p className="text-slate-500 max-w-md">
                      Ask me anything about your project, code, or just have a friendly chat.
                    </p>
                  </div>
                ) : (
                  <div className="space-y-6">
                    {chatTurns.map((turn, idx) => (
                      <React.Fragment key={turn.id}>
                        {/* Separator between turns */}
                        <div className="flex items-center gap-2">
                          <div className="flex-1 h-px bg-slate-200" />
                          <div className="flex-1 h-px bg-slate-200" />
                        </div>

                        {/* User message */}
                        <div className="flex justify-end">
                          <div className="max-w-[70%]">
                            <MessageBubble
                              role="user"
                              content={turn.userMessage.content}
                              timestamp={turn.userMessage.timestamp}
                            />
                          </div>
                        </div>

                        {/* Assistant message */}
                        {turn.assistantMessage && (
                          <div className="flex justify-start w-full">
                            <MessageBubble
                              role="assistant"
                              content={turn.assistantMessage.content}
                              timestamp={turn.assistantMessage.timestamp}
                            />
                          </div>
                        )}
                      </React.Fragment>
                    ))}
                    {isThinking && <ThinkingIndicator />}
                    <div ref={messagesEndRef} />
                  </div>
                )}
              </div>
            </div>

            <div className="shrink-0">
              <ContextProgressBar usedTokens={usedTokens} maxTokens={maxContextTokens} />
            </div>

            <div className="shrink-0">
              <ChatInput onSend={handleSendMessage} disabled={false} />
            </div>
          </div>

          {/* File Explorer Panel */}
          {isFilePanelOpen && (
            <FileExplorerPanel
              isOpen={isFilePanelOpen}
              setIsOpen={setIsFilePanelOpen}
              apiUrl={HERMES_API_URL}
              sessionId={sessionId}
            />
          )}
        </div>
      </main>
    </div>
  );
}

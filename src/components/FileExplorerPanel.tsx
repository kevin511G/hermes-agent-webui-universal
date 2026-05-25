import * as React from "react";
import { PanelRightClose, RefreshCw, Folder, File, FileText, FileCode, Presentation, FileSpreadsheet, Image, ChevronLeft, ChevronRight, Search, Activity, PlusCircle, FileEdit, Trash2, Clock, X, FileImage, Code2, Eye, Copy, CheckCircle2 } from "lucide-react";

interface FileEntry {
  name: string;
  type: "file" | "dir";
  size: number | null;
  modified: string;
}

interface SessionChange {
  path: string;
  type: "added" | "modified" | "deleted";
  timestamp: number;
}

interface FilePanelProps {
  isOpen: boolean;
  setIsOpen: (open: boolean) => void;
  apiUrl?: string;
  sessionId?: string;
}

function formatSize(bytes: number | null): string {
  if (bytes === null) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function formatTimestamp(ts: number): string {
  if (!ts) return "Unknown";
  return new Date(ts * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

const IMAGE_EXTS = new Set(["png", "jpg", "jpeg", "gif", "bmp", "webp", "svg"]);
const TEXT_EXTS = new Set(["txt", "md", "py", "js", "ts", "tsx", "jsx", "sh", "yaml", "yml", "json", "toml", "ini", "cfg", "conf", "csv", "html", "css", "scss", "sql", "java", "c", "cpp", "h", "go", "rs", "rb", "php", "xml", "dockerfile"]);

function getFileIcon(name: string) {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  if (IMAGE_EXTS.has(ext)) return <Image className="w-4 h-4 shrink-0 text-purple-400" />;
  if (TEXT_EXTS.has(ext)) return <FileCode className="w-4 h-4 shrink-0 text-slate-500" />;
  if (["pptx", "ppt"].includes(ext)) return <Presentation className="w-4 h-4 shrink-0 text-orange-400" />;
  if (["xlsx", "xls", "csv"].includes(ext)) return <FileSpreadsheet className="w-4 h-4 shrink-0 text-green-500" />;
  if (["docx", "doc"].includes(ext)) return <FileText className="w-4 h-4 shrink-0 text-blue-400" />;
  if (ext === "pdf") return <FileText className="w-4 h-4 shrink-0 text-red-400" />;
  return <File className="w-4 h-4 shrink-0 text-slate-400" />;
}

function getChangeIcon(type: string) {
  if (type === "added") return <PlusCircle className="w-3.5 h-3.5 text-emerald-500" />;
  if (type === "modified") return <FileEdit className="w-3.5 h-3.5 text-amber-500" />;
  return <Trash2 className="w-3.5 h-3.5 text-red-500" />;
}

interface Bookmark { label: string; path: string; }

export function FileExplorerPanel({ isOpen, setIsOpen, apiUrl = "/api", sessionId }: FilePanelProps) {
  const [bookmarks, setBookmarks] = React.useState<Bookmark[]>([]);
  const [currentPath, setCurrentPath] = React.useState("");
  const [entries, setEntries] = React.useState<FileEntry[]>([]);
  const [isLoadingFiles, setIsLoadingFiles] = React.useState(false);
  const [changes, setChanges] = React.useState<SessionChange[]>([]);
  const [isLoadingChanges, setIsLoadingChanges] = React.useState(false);
  const [previewFile, setPreviewFile] = React.useState<{ name: string; path: string; size: number; content: string; isImage: boolean } | null>(null);
  const [isPreviewLoading, setIsPreviewLoading] = React.useState(false);

  // Fetch user/env info once on mount — no hardcoded paths needed
  React.useEffect(() => {
    fetch(`${apiUrl}/user/info`)
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (!data) return;
        if (data.bookmarks?.length) setBookmarks(data.bookmarks);
        if (data.home) setCurrentPath(prev => prev || data.home);
      })
      .catch(() => {
        // Fallback: use root if the API is unreachable
        setCurrentPath(prev => prev || "/");
      });
  }, [apiUrl]);

  React.useEffect(() => {
    if (!currentPath) return;   // wait until user/info has resolved
    setIsLoadingFiles(true);
    fetch(`${apiUrl}/files/browse?path=${encodeURIComponent(currentPath)}`)
      .then(r => r.ok ? r.json() : null)
      .then(data => { if (data?.entries) setEntries(data.entries); })
      .catch(err => console.error("Failed to load files:", err))
      .finally(() => setIsLoadingFiles(false));
  }, [currentPath, apiUrl]);

  React.useEffect(() => {
    if (!sessionId) { setChanges([]); return; }

    const loadChanges = () => {
      fetch(`${apiUrl}/sessions/${sessionId}/changes`)
        .then(r => r.ok ? r.json() : null)
        .then(data => { if (data?.changes) setChanges(data.changes); })
        .catch(err => console.error("Failed to load changes:", err))
        .finally(() => setIsLoadingChanges(false));
    };

    setIsLoadingChanges(true);
    loadChanges();
    // Poll every 5 seconds so changes appear automatically after agent finishes
    const interval = setInterval(loadChanges, 5000);
    return () => clearInterval(interval);
  }, [sessionId, apiUrl]);

  const handleRefresh = () => {
    setIsLoadingFiles(true);
    fetch(`${apiUrl}/files/browse?path=${encodeURIComponent(currentPath)}`)
      .then(r => r.ok ? r.json() : null)
      .then(data => { if (data?.entries) setEntries(data.entries); })
      .catch(err => console.error("Failed to refresh:", err))
      .finally(() => setIsLoadingFiles(false));
  };

  const handleGoUp = () => {
    const parts = currentPath.split("/").filter(Boolean);
    if (parts.length <= 1) return;
    setCurrentPath("/" + parts.slice(0, -1).join("/"));
  };

  const openPreview = async (entry: FileEntry) => {
    setIsPreviewLoading(true);
    const fullPath = `${currentPath}/${entry.name}`;
    const ext = entry.name.split(".").pop()?.toLowerCase() ?? "";
    const isImage = IMAGE_EXTS.has(ext);
    const isText = TEXT_EXTS.has(ext);

    if (isImage) {
      try {
        const response = await fetch(`${apiUrl}/files/content?path=${encodeURIComponent(fullPath)}`, { headers: { 'Accept': 'application/json' } });
        if (response.ok) {
          setPreviewFile({ name: entry.name, path: fullPath, size: entry.size || 0, content: "[Image files cannot be previewed in text mode]", isImage: true });
        }
      } catch (e) { console.error("Failed to load image preview:", e); }
    } else if (isText) {
      try {
        const response = await fetch(`${apiUrl}/files/content?path=${encodeURIComponent(fullPath)}`);
        if (response.ok) {
          const data = await response.json();
          setPreviewFile({ name: entry.name, path: fullPath, size: entry.size || 0, content: data.content || "[Empty file]", isImage: false });
        }
      } catch (e) { console.error("Failed to load file content:", e); setPreviewFile({ name: entry.name, path: fullPath, size: entry.size || 0, content: "Failed to read file.", isImage: false }); }
    } else {
      setPreviewFile({ name: entry.name, path: fullPath, size: entry.size || 0, content: `Cannot preview binary files (${ext}).`, isImage: false });
    }
    setIsPreviewLoading(false);
  };

  const closePreview = () => setPreviewFile(null);
  const [copiedPath, setCopiedPath] = React.useState<string | null>(null);

  const handleCopyPath = React.useCallback(async (path: string) => {
    try {
      await navigator.clipboard.writeText(path);
      setCopiedPath(path);
      setTimeout(() => setCopiedPath(null), 1500);
    } catch (err) {
      console.error("Failed to copy path:", err);
    }
  }, []);

  const displayPath = currentPath.split("/").slice(-2).join("/") || "/";
  const folders = entries.filter(e => e.type === "dir");
  const files = entries.filter(e => e.type === "file");

  if (!isOpen) return null;

  return (
    <div
      style={{
        width: 300,
        minWidth: 300,
        height: "100%",
        display: "flex",
        flexDirection: "column",
        borderLeft: "1px solid #e2e8f0",
        backgroundColor: "#ffffff",
        overflow: "hidden",
      }}
    >
      {/* Header */}
      <div className="p-4 flex items-center justify-between border-b border-slate-100 bg-white">
        <div className="flex items-center gap-2">
          <Folder className="w-4 h-4 text-slate-400" />
          <h2 className="text-sm font-semibold text-slate-900">File Explorer</h2>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={handleRefresh}
            className={`p-2 hover:bg-slate-200/50 rounded-lg transition-colors text-slate-500 ${isLoadingFiles ? "animate-spin" : ""}`}
          >
            <RefreshCw className="w-4 h-4" />
          </button>
          <button
            onClick={() => setIsOpen(false)}
            className="p-2 hover:bg-slate-200/50 rounded-lg transition-colors text-slate-500"
          >
            <PanelRightClose className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* File Explorer Section */}
      <div className="flex-[3] flex flex-col min-h-0 border-b border-slate-200 bg-white">
        {/* Bookmarks — populated from /api/user/info, no hardcoded paths */}
        {bookmarks.length > 0 && (
          <div className="px-3 py-1.5 flex items-center gap-1.5 flex-wrap bg-slate-50 border-b border-slate-100 shrink-0">
            {bookmarks.map(bm => (
              <button
                key={bm.path}
                onClick={() => setCurrentPath(bm.path)}
                className={`px-2 py-0.5 rounded text-[10px] font-medium transition-colors ${
                  currentPath === bm.path || currentPath.startsWith(bm.path + "/")
                    ? "bg-blue-100 text-blue-600"
                    : "bg-slate-200 text-slate-500 hover:bg-slate-300"
                }`}
              >
                {bm.label}
              </button>
            ))}
          </div>
        )}
        {/* Path + up button */}
        <div className="px-3 py-1.5 flex items-center gap-2 bg-white border-b border-slate-100 shrink-0">
          <button
            onClick={handleGoUp}
            disabled={currentPath === "/"}
            className="p-1 rounded-md hover:bg-slate-200 disabled:opacity-30 disabled:hover:bg-transparent text-slate-500 transition-colors"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <div className="text-[11px] font-mono text-slate-400 truncate flex-1 text-right">
            {displayPath}
          </div>
        </div>

        {previewFile ? (
          <div className="flex-1 flex flex-col min-h-0">
            <div className="flex items-center gap-2 px-4 py-3 border-b border-slate-100 bg-slate-50 shrink-0">
              {previewFile.isImage ? (
                <FileImage className="w-4 h-4 shrink-0 text-purple-500" />
              ) : (
                <Code2 className="w-4 h-4 shrink-0 text-slate-500" />
              )}
              <span className="text-sm font-medium text-slate-700 truncate">{previewFile.name}</span>
              <span className="text-[10px] text-slate-400 ml-auto shrink-0">{formatSize(previewFile.size)}</span>
              <button onClick={closePreview} className="p-1 hover:bg-slate-200 rounded-lg text-slate-400 hover:text-slate-600 transition-colors ml-2 shrink-0">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto px-4 py-3">
              {isPreviewLoading ? (
                <div className="flex items-center justify-center h-full">
                  <RefreshCw className="w-5 h-5 animate-spin text-slate-300" />
                </div>
              ) : previewFile.isImage ? (
                <div className="flex flex-col items-center justify-center h-full text-center gap-4">
                  <FileImage className="w-12 h-12 text-purple-300" />
                  <p className="text-xs text-slate-500 max-w-xs">Image preview is not available in the file explorer panel.</p>
                </div>
              ) : (
                <pre className="text-[11px] font-mono text-slate-600 whitespace-pre-wrap break-all leading-relaxed">{previewFile.content}</pre>
              )}
            </div>
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto px-2 py-2 space-y-1">
            {isLoadingFiles ? (
              <div className="flex items-center justify-center h-full"><RefreshCw className="w-4 h-4 animate-spin text-slate-300" /></div>
            ) : entries.length > 0 ? (
              <>
                {folders.map((entry) => {
                  const fullPath = `${currentPath}/${entry.name}`;
                  const isCopied = copiedPath === fullPath;
                  return (
                    <button
                      key={entry.name}
                      onClick={() => setCurrentPath(fullPath)}
                      className="w-full flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs text-left hover:bg-slate-100 transition-colors text-slate-700 group"
                    >
                      <Folder className="w-3.5 h-3.5 shrink-0 text-amber-400" />
                      <span className="truncate flex-1">{entry.name}</span>
                      <ChevronRight className="w-3 h-3 opacity-0 group-hover:opacity-100 text-slate-300 transition-all" />
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleCopyPath(fullPath);
                        }}
                        className="shrink-0 p-0.5 rounded opacity-0 group-hover:opacity-100 hover:bg-slate-200 text-slate-400 hover:text-blue-500 transition-all"
                        title="Copy path"
                      >
                        {isCopied ? <CheckCircle2 className="w-3 h-3 text-green-500" /> : <Copy className="w-3 h-3" />}
                      </button>
                    </button>
                  );
                })}
                {folders.length > 0 && files.length > 0 && <div className="h-px bg-slate-100 my-1.5 mx-2" />}
                {files.map((entry) => {
                  const fullPath = `${currentPath}/${entry.name}`;
                  const ext = entry.name.split(".").pop()?.toLowerCase() ?? "";
                  const isReadable = TEXT_EXTS.has(ext);
                  const isImageFile = IMAGE_EXTS.has(ext);
                  const isCopied = copiedPath === fullPath;
                  return (
                    <div
                      key={entry.name}
                      onClick={() => openPreview(entry)}
                      className={`w-full flex items-center gap-2 px-3 py-1.5 rounded-lg text-left transition-colors group/file ${isReadable || isImageFile ? "hover:bg-slate-100 text-slate-700 cursor-pointer" : "hover:bg-slate-50 text-slate-500"}`}
                    >
                      {getFileIcon(entry.name)}
                      <span className="truncate flex-1 text-xs">{entry.name}</span>
                      <span className="text-[9px] text-slate-400 font-mono shrink-0">{formatSize(entry.size)}</span>
                      {(isReadable || isImageFile) && <Eye className="w-3 h-3 opacity-0 group-hover/file:opacity-50 text-slate-400 transition-opacity shrink-0" />}
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleCopyPath(fullPath);
                        }}
                        className="shrink-0 p-0.5 rounded opacity-0 group-hover/file:opacity-100 hover:bg-slate-200 text-slate-400 hover:text-blue-500 transition-all"
                        title="Copy path"
                      >
                        {isCopied ? <CheckCircle2 className="w-3 h-3 text-green-500" /> : <Copy className="w-3 h-3" />}
                      </button>
                    </div>
                  );
                })}
              </>
            ) : (
              <div className="flex flex-col items-center justify-center h-full text-center px-4 py-8">
                <Search className="w-5 h-5 text-slate-200 mb-2" />
                <p className="text-[11px] font-medium text-slate-400">Empty folder</p>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Session Changes Section */}
      <div className="flex-[2] flex flex-col min-h-0 bg-slate-50">
        <div className="px-4 py-3 flex items-center justify-between border-b border-slate-200 bg-slate-50">
          <div className="flex items-center gap-2">
            <Activity className="w-4 h-4 text-blue-500" />
            <h3 className="text-xs font-semibold text-slate-700 uppercase tracking-wider">Session Changes</h3>
          </div>
          <div className="px-1.5 py-0.5 bg-blue-100 text-blue-600 rounded text-[9px] font-bold">{changes.length}</div>
        </div>
        <div className="flex-1 overflow-y-auto px-2 py-3 space-y-1.5">
          {isLoadingChanges ? (
            <div className="flex items-center justify-center py-4"><RefreshCw className="w-4 h-4 animate-spin text-slate-300" /></div>
          ) : changes.length > 0 ? (
            changes.map((change, idx) => (
              <div key={idx} className="flex items-center gap-3 px-3 py-2 rounded-lg bg-white border border-slate-100 hover:bg-slate-50 transition-all">
                <div className="shrink-0 p-1 rounded-md">{getChangeIcon(change.type)}</div>
                <div className="flex-1 min-w-0">
                  <div className={`text-xs font-medium truncate ${change.type === "deleted" ? "text-slate-400 line-through" : "text-slate-700"}`}>
                    {change.path.split("/").pop() || change.path}
                  </div>
                  <div className="flex items-center gap-1.5 mt-0.5">
                    <Clock className="w-2.5 h-2.5 text-slate-300" />
                    <span className="text-[9px] text-slate-400 uppercase font-bold">{formatTimestamp(change.timestamp)}</span>
                    <span className={`text-[8px] px-1 rounded font-bold uppercase ${change.type === "added" ? "text-emerald-600 bg-emerald-50" : change.type === "modified" ? "text-amber-600 bg-amber-50" : "text-red-600 bg-red-50"}`}>
                      {change.type === "added" ? "added" : change.type === "modified" ? "modified" : "deleted"}
                    </span>
                  </div>
                </div>
              </div>
            ))
          ) : (
            <div className="flex flex-col items-center justify-center py-8 text-center px-4">
              <Activity className="w-5 h-5 text-slate-200 mb-2" />
              <p className="text-[11px] font-medium text-slate-400">No session changes yet</p>
            </div>
          )}
        </div>
      </div>

      {/* Footer */}
      <div className="p-3 border-t border-slate-200 bg-white shrink-0">
        <div className="text-[10px] text-slate-400 text-center truncate font-mono" title={currentPath}>{currentPath}</div>
      </div>
    </div>
  );
}

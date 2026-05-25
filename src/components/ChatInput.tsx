import * as React from "react";
import { SendHorizontal, Paperclip, Mic, Image as ImageIcon, X, FileText } from "lucide-react";
import { cn } from "@/src/lib/utils";

interface ChatInputProps {
  onSend: (message: string, attachedFiles: AttachedFile[]) => void;
  disabled?: boolean;
}

interface AttachedFile {
  name: string;
  size: number;
  type: string;
  path: string;
  isImage?: boolean;
  preview?: string;
}

export function ChatInput({ onSend, disabled }: ChatInputProps) {
  const [value, setValue] = React.useState("");
  const [attachedFiles, setAttachedFiles] = React.useState<AttachedFile[]>([]);
  const textareaRef = React.useRef<HTMLTextAreaElement>(null);
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const imageInputRef = React.useRef<HTMLInputElement>(null);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleSend = () => {
    const trimmed = value.trim();
    if ((trimmed || attachedFiles.length > 0) && !disabled) {
      onSend(trimmed, attachedFiles);
      setValue("");
      setAttachedFiles([]);
      if (textareaRef.current) {
        textareaRef.current.style.height = "auto";
      }
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setValue(e.target.value);
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height = `${textareaRef.current.scrollHeight}px`;
    }
  };

  const handleImageSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    const allowedTypes = ["image/png", "image/jpeg"];
    const allowedExts = [".png", ".jpg", ".jpeg"];

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const ext = "." + file.name.split(".").pop()?.toLowerCase();
      
      if (!allowedTypes.includes(file.type) && !allowedExts.includes(ext)) {
        alert(`Image type not supported: ${file.name}`);
        continue;
      }

      // Create a preview
      const reader = new FileReader();
      reader.readAsDataURL(file);
      await new Promise(resolve => {
        reader.onloadend = resolve;
      });
      const preview = reader.result as string;

      try {
        const formData = new FormData();
        formData.append("file", file);

        const response = await fetch("/api/upload/image", {
          method: "POST",
          body: formData,
        });

        if (!response.ok) {
          throw new Error("Upload failed");
        }

        const result = await response.json();
        setAttachedFiles(prev => [...prev, {
          name: result.name,
          size: result.size,
          type: file.type,
          path: result.path,
          isImage: true,
          preview,
        }]);
      } catch (err) {
        console.error("Image upload failed:", err);
        alert(`Failed to upload ${file.name}`);
      }
    }

    if (imageInputRef.current) {
      imageInputRef.current.value = "";
    }
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    const allowedTypes = [
      "text/plain",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "application/pdf",
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    ];
    const allowedExts = [".txt", ".docx", ".xlsx", ".pdf", ".pptx"];

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const ext = "." + file.name.split(".").pop()?.toLowerCase();
      
      if (!allowedTypes.includes(file.type) && !allowedExts.includes(ext)) {
        alert(`File type not supported: ${file.name}`);
        continue;
      }

      try {
        const formData = new FormData();
        formData.append("file", file);

        const response = await fetch("/api/upload", {
          method: "POST",
          body: formData,
        });

        if (!response.ok) {
          throw new Error("Upload failed");
        }

        const result = await response.json();
        setAttachedFiles(prev => [...prev, {
          name: result.name,
          size: result.size,
          type: file.type,
          path: result.path,
          isImage: false,
        }]);
      } catch (err) {
        console.error("File upload failed:", err);
        alert(`Failed to upload ${file.name}`);
      }
    }

    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const removeFile = (index: number) => {
    setAttachedFiles(prev => prev.filter((_, i) => i !== index));
  };

  const formatSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  };

  const getFileIcon = (file: AttachedFile) => {
    if (file.isImage) return <ImageIcon className="w-4 h-4 text-purple-500" />;
    const ext = file.name.split(".").pop()?.toLowerCase();
    if (["pdf"].includes(ext || "")) return <FileText className="w-4 h-4 text-red-500" />;
    if (["docx"].includes(ext || "")) return <FileText className="w-4 h-4 text-blue-500" />;
    if (["xlsx"].includes(ext || "")) return <FileText className="w-4 h-4 text-green-500" />;
    if (["pptx"].includes(ext || "")) return <FileText className="w-4 h-4 text-orange-500" />;
    if (["txt"].includes(ext || "")) return <FileText className="w-4 h-4 text-slate-500" />;
    return <FileText className="w-4 h-4 text-slate-400" />;
  };

  const attachedFilesByType = {
    images: attachedFiles.filter(f => f.isImage),
    files: attachedFiles.filter(f => !f.isImage),
  };

  return (
    <div className="w-full max-w-4xl mx-auto px-4 pb-8 pt-2">
      {/* Attached files preview */}
      {attachedFiles.length > 0 && (
        <div className="mb-3 space-y-2">
          {/* Images */}
          {attachedFilesByType.images.map((file, idx) => {
            const realIdx = attachedFiles.indexOf(file);
            return (
              <div
                key={`img-${realIdx}`}
                className="flex items-center gap-3 px-4 py-2.5 bg-white border border-slate-200 rounded-xl shadow-sm group/file"
              >
                {file.preview ? (
                  <img
                    src={file.preview}
                    alt={file.name}
                    className="w-10 h-10 object-cover rounded-lg border border-slate-200 shrink-0"
                  />
                ) : (
                  <div className="w-10 h-10 bg-purple-50 rounded-lg flex items-center justify-center shrink-0">
                    <ImageIcon className="w-5 h-5 text-purple-500" />
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-medium text-slate-700 truncate">
                    {file.name}
                  </div>
                  <div className="text-[10px] text-slate-400">
                    {formatSize(file.size)} · image
                  </div>
                </div>
                <button
                  onClick={() => removeFile(realIdx)}
                  className="p-1 hover:bg-slate-100 rounded-lg text-slate-400 hover:text-red-500 transition-colors opacity-0 group-hover/file:opacity-100"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            );
          })}

          {/* Documents */}
          {attachedFilesByType.files.map((file, idx) => {
            const realIdx = attachedFiles.indexOf(file);
            return (
              <div
                key={`file-${realIdx}`}
                className="flex items-center gap-3 px-4 py-2.5 bg-white border border-slate-200 rounded-xl shadow-sm group/file"
              >
                {getFileIcon(file)}
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-medium text-slate-700 truncate">
                    {file.name}
                  </div>
                  <div className="text-[10px] text-slate-400">
                    {formatSize(file.size)} · document
                  </div>
                </div>
                <button
                  onClick={() => removeFile(realIdx)}
                  className="p-1 hover:bg-slate-100 rounded-lg text-slate-400 hover:text-red-500 transition-colors opacity-0 group-hover/file:opacity-100"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            );
          })}
        </div>
      )}

      {/* Input area */}
      <div className="relative flex items-end gap-2 p-2 bg-slate-100/80 backdrop-blur-md border border-slate-200 rounded-[28px] shadow-sm focus-within:border-blue-400/50 focus-within:ring-4 focus-within:ring-blue-500/5 transition-all">
        {/* Hidden inputs */}
        <input
          ref={fileInputRef}
          type="file"
          accept=".txt,.docx,.xlsx,.pdf,.pptx"
          multiple
          onChange={handleFileSelect}
          className="hidden"
        />
        <input
          ref={imageInputRef}
          type="file"
          accept=".png,.jpg,.jpeg,image/png,image/jpeg"
          multiple
          onChange={handleImageSelect}
          className="hidden"
        />
        <button
          onClick={() => fileInputRef.current?.click()}
          className="p-3 hover:bg-white rounded-full text-slate-500 transition-colors shrink-0"
          title="Attach document"
        >
          <Paperclip className="w-5 h-5" />
        </button>
        
        <textarea
          ref={textareaRef}
          rows={1}
          value={value}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          placeholder="Ask anything..."
          className="flex-1 bg-transparent border-none focus:ring-0 resize-none py-3 px-1 text-[15px] max-h-60"
        />

        <div className="flex items-center gap-1 pr-1 shrink-0">
          {!value.trim() && attachedFiles.length === 0 && (
            <>
              <button
                onClick={() => imageInputRef.current?.click()}
                className="p-3 hover:bg-white rounded-full text-slate-500 transition-colors"
                title="Upload image"
              >
                <ImageIcon className="w-5 h-5" />
              </button>
              <button className="p-3 hover:bg-white rounded-full text-slate-500 transition-colors">
                <Mic className="w-5 h-5" />
              </button>
            </>
          )}
          
          <button
            onClick={handleSend}
            disabled={(!value.trim() && attachedFiles.length === 0) || disabled}
            className={cn(
              "p-3 rounded-full transition-all",
              (value.trim() || attachedFiles.length > 0)
                ? "bg-slate-800 text-white shadow-md hover:bg-slate-700" 
                : "text-slate-300 cursor-not-allowed"
            )}
          >
            <SendHorizontal className="w-5 h-5" />
          </button>
        </div>
      </div>
      
      <p className="text-[11px] text-center text-slate-400 mt-3 font-medium">
        Hermes can make mistakes. Check important info.
      </p>
    </div>
  );
}

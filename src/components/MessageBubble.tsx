import * as React from "react";
import { motion } from "motion/react";
import { User, Bot, Copy, ThumbsUp, ThumbsDown, RotateCcw } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import "katex/dist/katex.min.css";
import { cn } from "@/src/lib/utils";

interface MessageBubbleProps {
  role: "user" | "assistant";
  content: string;
  timestamp: string;
  key?: React.Key;
}

const USER_MESSAGE_WRAP_CHAR_LIMIT = 48;
const USER_MESSAGE_LONG_TOKEN_LIMIT = 24;

const wrapLongTextStyle: React.CSSProperties = {
  overflowWrap: "anywhere",
};

const wrapCodeBlockStyle: React.CSSProperties = {
  overflowWrap: "anywhere",
  whiteSpace: "pre-wrap",
  wordBreak: "break-all",
};

function shouldWrapUserMessage(content: string) {
  return (
    content.length > USER_MESSAGE_WRAP_CHAR_LIMIT ||
    new RegExp(`\\S{${USER_MESSAGE_LONG_TOKEN_LIMIT},}`).test(content)
  );
}

function MarkdownRenderer({ content }: { content: string }) {
  return (
    <div className="prose prose-sm max-w-none min-w-0 overflow-hidden" style={wrapLongTextStyle}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[rehypeKatex]}
        components={{
          // Headings
          h1: ({ children }) => (
            <h1 className="text-2xl font-bold mt-4 mb-2 text-slate-900">{children}</h1>
          ),
          h2: ({ children }) => (
            <h2 className="text-xl font-bold mt-3 mb-2 text-slate-900">{children}</h2>
          ),
          h3: ({ children }) => (
            <h3 className="text-lg font-semibold mt-2 mb-1 text-slate-900">{children}</h3>
          ),
          h4: ({ children }) => (
            <h4 className="text-base font-semibold mt-2 mb-1 text-slate-900">{children}</h4>
          ),
          // Paragraphs
          p: ({ children }) => (
            <p className="mb-2 last:mb-0 leading-relaxed" style={wrapLongTextStyle}>{children}</p>
          ),
          // Lists
          ul: ({ children }) => (
            <ul className="list-disc list-inside mb-2 space-y-1">{children}</ul>
          ),
          ol: ({ children }) => (
            <ol className="list-decimal list-inside mb-2 space-y-1">{children}</ol>
          ),
          li: ({ children }) => (
            <li className="pl-1" style={wrapLongTextStyle}>{children}</li>
          ),
          // Code blocks
          code: ({ className, children, ...props }: any) => {
            const match = /language-(\w+)/.exec(className || "");
            const isInline = !match && !props["data-inline"];
            
            if (isInline) {
              // Inline code
              return (
                <code
                  className="bg-slate-100 text-rose-600 px-1.5 py-0.5 rounded text-sm font-mono"
                  style={wrapLongTextStyle}
                  {...props}
                >
                  {children}
                </code>
              );
            }
            
            // Block code
            return (
              <div className="relative my-3">
                {match && (
                  <div className="absolute right-2 top-1.5 text-[10px] text-slate-200 uppercase font-medium">
                    {match[1]}
                  </div>
                )}
                <pre
                  className="bg-[#1e1e2e] text-slate-100 rounded-lg p-4 overflow-x-hidden text-sm font-mono leading-relaxed"
                  style={wrapCodeBlockStyle}
                >
                  <code className={className} {...props}>
                    {children}
                  </code>
                </pre>
              </div>
            );
          },
          // Tables
          table: ({ children }) => (
            <div className="overflow-x-auto my-3">
              <table className="min-w-full border-collapse border border-slate-200 text-sm rounded-lg overflow-hidden">
                {children}
              </table>
            </div>
          ),
          thead: ({ children }) => (
            <thead className="bg-slate-50">{children}</thead>
          ),
          th: ({ children }) => (
            <th className="border border-slate-200 px-3 py-2 text-left font-semibold text-slate-700">
              {children}
            </th>
          ),
          td: ({ children }) => (
            <td className="border border-slate-200 px-3 py-2 text-slate-600">
              {children}
            </td>
          ),
          // Blockquote
          blockquote: ({ children }) => (
            <blockquote className="border-l-4 border-blue-400 pl-4 my-2 text-slate-600 italic">
              {children}
            </blockquote>
          ),
          // Horizontal rule
          hr: () => (
            <hr className="my-4 border-slate-200" />
          ),
          // Links
          a: ({ href, children }) => (
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-600 underline hover:text-blue-800"
            >
              {children}
            </a>
          ),
          // Emphasis
          strong: ({ children }) => (
            <strong className="font-bold text-slate-900">{children}</strong>
          ),
          em: ({ children }) => (
            <em className="italic">{children}</em>
          ),
          // Del
          del: ({ children }) => (
            <del className="text-slate-400">{children}</del>
          ),
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}

export function MessageBubble({ role, content, timestamp }: MessageBubbleProps) {
  const isUser = role === "user";
  const wrapUserMessage = isUser && shouldWrapUserMessage(content);

  const [copied, setCopied] = React.useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className={cn(
        "flex w-full gap-4 py-6 px-4 md:px-8 group",
        isUser ? "justify-end" : "justify-start"
      )}
    >
      <div className={cn(
        "flex gap-4 min-w-0",
        isUser ? "flex-row-reverse max-w-[85%] md:max-w-[75%]" : "flex-row w-full"
      )}>
        {/* Avatar */}
        <div className={cn(
          "w-8 h-8 rounded-full flex items-center justify-center shrink-0 shadow-sm",
          isUser ? "bg-slate-800 text-white" : "bg-blue-500 text-white"
        )}>
          {isUser ? <User className="w-5 h-5" /> : <Bot className="w-5 h-5" />}
        </div>

        {/* Content */}
        <div className={cn(
          "flex flex-col gap-2 min-w-0 overflow-x-hidden",
          isUser
            ? wrapUserMessage
              ? "items-end w-full max-w-full"
              : "items-end w-auto max-w-full flex-none"
            : "items-start w-full"
        )}>
          <div className={cn(
            "px-4 py-3 rounded-2xl text-[15px] leading-relaxed overflow-x-hidden min-w-0 max-w-full",
            isUser
              ? cn(
                  "bg-slate-100 text-slate-800 rounded-tr-none",
                  wrapUserMessage ? "w-full" : "w-auto flex-none"
                )
              : "w-full bg-transparent text-slate-800 rounded-tl-none"
          )}>
            {isUser ? (
              // User messages rendered as plain text
              <p className="m-0 whitespace-pre-wrap" style={wrapUserMessage ? wrapLongTextStyle : undefined}>
                {content}
              </p>
            ) : (
              // Assistant messages rendered as Markdown
              <MarkdownRenderer content={content} />
            )}
          </div>
          
          {/* Actions & Timestamp */}
          {!isUser && (
            <div className="flex items-center gap-3 mt-1 opacity-0 group-hover:opacity-100 transition-opacity">
              <button 
                onClick={handleCopy}
                className="p-1.5 hover:bg-slate-100 rounded-lg text-slate-400 hover:text-slate-600 transition-colors relative"
              >
                {copied ? <span className="absolute -top-8 left-1/2 -translate-x-1/2 bg-slate-800 text-white text-[10px] px-2 py-1 rounded">Copied!</span> : null}
                <Copy className="w-3.5 h-3.5" />
              </button>
              <button className="p-1.5 hover:bg-slate-100 rounded-lg text-slate-400 hover:text-slate-600 transition-colors">
                <ThumbsUp className="w-3.5 h-3.5" />
              </button>
              <button className="p-1.5 hover:bg-slate-100 rounded-lg text-slate-400 hover:text-slate-600 transition-colors">
                <ThumbsDown className="w-3.5 h-3.5" />
              </button>
              <button className="p-1.5 hover:bg-slate-100 rounded-lg text-slate-400 hover:text-slate-600 transition-colors">
                <RotateCcw className="w-3.5 h-3.5" />
              </button>
              <span className="text-[10px] text-slate-400 font-medium ml-2">{timestamp}</span>
            </div>
          )}
          
          {isUser && (
            <span className="text-[10px] text-slate-400 font-medium">{timestamp}</span>
          )}
        </div>
      </div>
    </motion.div>
  );
}

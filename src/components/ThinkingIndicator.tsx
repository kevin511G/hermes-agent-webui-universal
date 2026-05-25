import * as React from "react";
import { motion } from "motion/react";
import { Sparkles } from "lucide-react";

export function ThinkingIndicator() {
  return (
    <div className="flex items-center gap-3 py-6 px-4 md:px-8">
      <div className="w-8 h-8 rounded-full bg-blue-500 text-white flex items-center justify-center shrink-0 shadow-sm">
        <Sparkles className="w-4 h-4 animate-pulse" />
      </div>
      <div className="flex flex-col gap-1">
        <motion.div 
          initial={{ opacity: 0.4 }}
          animate={{ 
            opacity: [0.4, 1, 0.4],
            scale: [1, 1.02, 1]
          }}
          transition={{ 
            duration: 2, 
            repeat: Infinity,
            ease: "easeInOut" 
          }}
          className="text-[15px] font-medium text-blue-600 flex items-center gap-2"
        >
          Thinking
          <span className="flex gap-1">
            <motion.span
              animate={{ opacity: [0, 1, 0] }}
              transition={{ duration: 1.5, repeat: Infinity, times: [0, 0.5, 1] }}
            >.</motion.span>
            <motion.span
              animate={{ opacity: [0, 1, 0] }}
              transition={{ duration: 1.5, repeat: Infinity, times: [0.2, 0.7, 1] }}
            >.</motion.span>
            <motion.span
              animate={{ opacity: [0, 1, 0] }}
              transition={{ duration: 1.5, repeat: Infinity, times: [0.4, 0.9, 1] }}
            >.</motion.span>
          </span>
        </motion.div>
        <div className="h-1.5 w-24 bg-blue-100 rounded-full overflow-hidden relative">
          <motion.div 
            animate={{ 
              left: ["-100%", "100%"] 
            }}
            transition={{ 
              duration: 1.5, 
              repeat: Infinity, 
              ease: "linear" 
            }}
            className="absolute top-0 bottom-0 w-1/2 bg-gradient-to-r from-transparent via-blue-400 to-transparent"
          />
        </div>
      </div>
    </div>
  );
}

"use client";

import { ThemeProvider } from "next-themes";
import { SWRConfig } from "swr";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { fetchJson } from "@/lib/fetcher";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
      <SWRConfig value={{ fetcher: fetchJson, revalidateOnFocus: true, shouldRetryOnError: false }}>
        <TooltipProvider delayDuration={300}>
          {children}
          <Toaster position="bottom-center" />
        </TooltipProvider>
      </SWRConfig>
    </ThemeProvider>
  );
}

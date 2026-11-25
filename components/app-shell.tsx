"use client";

import { Command as CommandIcon, Moon, Sun } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTheme } from "next-themes";
import { AgentProvider, useAgent } from "@/components/agent/agent-provider";
import { CommandBar } from "@/components/agent/command-bar";
import { UserMenu } from "@/components/auth/user-menu";
import { Logo } from "@/components/logo";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const NAV = [
  { href: "/calendar", label: "Calendar" },
  { href: "/settings", label: "Settings" },
];

function Header() {
  const pathname = usePathname();
  const { openCommand } = useAgent();
  const { resolvedTheme, setTheme } = useTheme();

  return (
    <header className="flex h-14 shrink-0 items-center gap-2 border-b px-3 sm:gap-4 sm:px-4">
      <Link href="/calendar" aria-label="Kairos home">
        <Logo className="text-base" />
      </Link>
      <nav className="flex items-center gap-1 text-sm">
        {NAV.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className={cn(
              "rounded-md px-2.5 py-1.5 text-muted-foreground hover:bg-muted hover:text-foreground",
              pathname.startsWith(item.href) && "bg-muted text-foreground",
            )}
          >
            {item.label}
          </Link>
        ))}
      </nav>
      <div className="ml-auto flex items-center gap-1.5 sm:gap-2">
        <Button variant="outline" size="sm" onClick={() => openCommand()} className="text-muted-foreground">
          <span className="hidden sm:inline">Ask Kairos</span>
          <kbd className="inline-flex items-center gap-0.5 rounded border bg-muted px-1 font-mono text-[10px]">
            <CommandIcon className="size-2.5" />K
          </kbd>
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Toggle dark mode"
          onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
        >
          <Sun className="hidden dark:block" />
          <Moon className="dark:hidden" />
        </Button>
        <UserMenu />
      </div>
    </header>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <AgentProvider>
      <div className="flex h-dvh flex-col">
        <Header />
        <main className="flex min-h-0 flex-1 flex-col">{children}</main>
      </div>
      <CommandBar />
    </AgentProvider>
  );
}

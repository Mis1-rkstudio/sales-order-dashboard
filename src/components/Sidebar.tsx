// components/Sidebar.tsx
'use client';

import React, { JSX, useEffect, useState } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Menu,
  Home,
  FileText,
  Grid,
  ChevronsLeft,
  ChevronsRight,
} from 'lucide-react';

type NavItem = {
  label: string;
  href: string;
  Icon: React.ComponentType<React.SVGProps<SVGSVGElement>>;
};

const NAV: NavItem[] = [
  { label: 'Home', href: '/', Icon: Home },
  { label: 'Sales Orders', href: '/sales-orders', Icon: FileText },
  { label: 'Other', href: '/other-page', Icon: Grid },
];

const STORAGE_KEY = 'sales_dashboard_sidebar_collapsed';

export default function Sidebar(): JSX.Element {
  // default collapsed = true
  const [collapsed, setCollapsed] = useState<boolean>(true);

  // restore saved preference (if any)
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw !== null) {
        setCollapsed(raw === 'true');
      }
    } catch {
      // ignore storage errors
    }
  }, []);

  // persist preference
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, collapsed ? 'true' : 'false');
    } catch {
      // ignore storage errors
    }
  }, [collapsed]);

  return (
    <aside
      aria-label="Main navigation"
      className={`flex flex-col bg-slate-900 border-r border-slate-800 min-h-screen transition-all duration-200 ${
        collapsed ? 'w-16' : 'w-72'
      }`}
    >
      <div className="flex items-center justify-between gap-2 px-3 py-3 border-b border-slate-800">
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setCollapsed((c) => !c)}
            aria-pressed={collapsed}
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            className="p-0"
          >
            {collapsed ? <ChevronsRight className="h-5 w-5" /> : <ChevronsLeft className="h-5 w-5" />}
          </Button>

          {!collapsed && (
            <div className="flex items-center gap-2">
              <Menu className="h-5 w-5 text-slate-300" />
              <span className="text-sm font-semibold">Sales Dashboard</span>
            </div>
          )}
        </div>

        {collapsed ? (
          <div className="hidden md:block" />
        ) : (
          <div className="hidden md:block text-xs text-slate-400">v1</div>
        )}
      </div>

      <ScrollArea className="flex-1 px-1 py-2">
        <nav className="flex flex-col gap-1">
          {NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center gap-3 rounded-md px-2 py-2 transition-colors hover:bg-slate-800 ${
                collapsed ? 'justify-center' : 'justify-start'
              }`}
              aria-label={item.label}
            >
              <item.Icon className="h-5 w-5 text-slate-200" />
              {!collapsed && <span className="text-sm text-slate-100">{item.label}</span>}
            </Link>
          ))}
        </nav>
      </ScrollArea>

      <div className="px-2 py-3 border-t border-slate-800">
        <div className={`flex items-center ${collapsed ? 'justify-center' : 'justify-between'}`}>
          {!collapsed && <div className="text-xs text-slate-400">Signed in as</div>}
          <div className="mt-1 flex items-center gap-2">
            <div className="h-8 w-8 rounded-full bg-slate-700/60" />
            {!collapsed && <div className="text-sm">Team Account</div>}
          </div>
        </div>
      </div>
    </aside>
  );
}

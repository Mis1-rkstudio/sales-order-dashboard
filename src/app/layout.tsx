// app/layout.tsx
import './globals.css';
import type { ReactNode } from 'react';
import Sidebar from '@/components/Sidebar';

export const metadata = {
  title: 'Sales Dashboard',
  description: 'Sales Pending order Dashboard (New)',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="min-h-screen bg-slate-900 text-slate-100">
        <div className="flex">
          <Sidebar />
          <main className="flex-1 p-6">{children}</main>
        </div>
      </body>
    </html>
  );
}

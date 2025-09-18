import React, { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';

export type PaginationControlsProps = {
  page: number; // zero-based
  setPage: (p: number) => void;
  total: number;
  limit: number;
  onSaveDispatched: () => Promise<void> | void;
  saving: boolean;
  selectedCount: number;
  disabled?: boolean;
  showSave?: boolean; // if false hide the save CTA (so you can render it elsewhere)
};

export default function PaginationControls({
  page,
  setPage,
  total,
  limit,
  onSaveDispatched,
  saving,
  selectedCount,
  disabled = false,
  showSave = true,
}: PaginationControlsProps) {
  const totalPages = Math.max(1, Math.ceil(total / Math.max(1, limit)));
  const current = Math.min(totalPages, Math.max(1, page + 1)); // 1-based safe

  const pages = useMemo(() => {
    const maxVisible = 5;
    if (totalPages <= maxVisible) return Array.from({ length: totalPages }, (_, i) => i + 1);

    const half = Math.floor(maxVisible / 2);
    let start = Math.max(1, current - half);
    let end = start + maxVisible - 1;
    if (end > totalPages) {
      end = totalPages;
      start = Math.max(1, end - maxVisible + 1);
    }
    return Array.from({ length: end - start + 1 }, (_, i) => start + i);
  }, [totalPages, current]);

  const goFirst = () => setPage(0);
  const goPrev = () => setPage(Math.max(0, page - 1));
  const goNext = () => setPage(Math.min(totalPages - 1, page + 1));
  const goLast = () => setPage(totalPages - 1);
  const goTo = (p1: number) => setPage(Math.max(0, Math.min(totalPages - 1, p1 - 1))); // p1 is 1-based

  const [jumpValue, setJumpValue] = useState<string>('');

  return (
    // Outer container right-aligns the whole control block.
    // To center on small screens and right-align on larger screens use:
    // className="flex items-center gap-4 w-full justify-center md:justify-end"
    <div className="flex items-center gap-4 w-full justify-end">
      {/* inner inline-flex sizes to content instead of stretching across the full width */}
      <div className="inline-flex items-center gap-4">
        <div className="flex items-center gap-2">
          <Button onClick={goFirst} disabled={page === 0 || disabled}>
            <svg className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor" aria-hidden>
              <path d="M7.41 15.41 12.83 10 7.41 4.59 6 6l4 4-4 4z" />
              <path d="M3.41 15.41 8.83 10 3.41 4.59 2 6l4 4-4 4z" opacity="0.6" />
            </svg>
          </Button>

          <Button onClick={goPrev} disabled={page === 0 || disabled}>
            <svg className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor" aria-hidden>
              <path d="M12.41 15.41 7 10l5.41-5.41L13.83 4 9 8.83 13.83 13.66z" />
            </svg>
          </Button>
        </div>

        <nav aria-label="Pagination" className="flex items-center gap-2">
          {pages[0] > 1 && (
            <>
              <button
                onClick={() => goTo(1)}
                className="px-3 py-1 rounded hover:bg-slate-100 dark:hover:bg-slate-700 text-sm"
                disabled={disabled}
              >
                1
              </button>
              {pages[0] > 2 && <span className="text-slate-400 px-1">…</span>}
            </>
          )}

          {pages.map((p) => {
            const isActive = p === current;
            return (
              <button
                key={p}
                onClick={() => goTo(p)}
                aria-current={isActive ? 'page' : undefined}
                className={`px-3 py-1 rounded text-sm ${isActive ? 'bg-slate-900 text-white' : 'hover:bg-slate-100 dark:hover:bg-slate-700'}`}
                disabled={disabled}
              >
                {p}
              </button>
            );
          })}

          {pages[pages.length - 1] < totalPages && (
            <>
              {pages[pages.length - 1] < totalPages - 1 && <span className="text-slate-400 px-1">…</span>}
              <button
                onClick={() => goTo(totalPages)}
                className="px-3 py-1 rounded hover:bg-slate-100 dark:hover:bg-slate-700 text-sm"
                disabled={disabled}
              >
                {totalPages}
              </button>
            </>
          )}
        </nav>

        <div className="flex items-center gap-2 ml-2">
          <Button onClick={goNext} disabled={page >= totalPages - 1 || disabled}>
            <svg className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor" aria-hidden>
              <path d="M7.59 4.59 13 10l-5.41 5.41L9 16.17 13.83 11.34 9 6.5z" />
            </svg>
          </Button>

          <Button onClick={goLast} disabled={page >= totalPages - 1 || disabled}>
            <svg className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor" aria-hidden>
              <path d="M16.59 15.41 11.17 10 16.59 4.59 18 6l-4 4 4 4z" />
              <path d="M12.59 15.41 7.17 10 12.59 4.59 14 6l-4 4 4 4z" opacity="0.6" />
            </svg>
          </Button>

          <div className="flex items-center gap-2 ml-3">
            <span className="text-sm text-slate-500">Page</span>
            <input
              type="number"
              min={1}
              max={totalPages}
              value={jumpValue}
              onChange={(e) => setJumpValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  const v = Number(jumpValue || current);
                  if (!Number.isNaN(v)) {
                    goTo(Math.min(Math.max(1, Math.floor(v)), totalPages));
                    setJumpValue('');
                  }
                }
              }}
              placeholder={String(current)}
              className="w-16 px-2 py-1 border rounded text-sm bg-white dark:bg-slate-900"
              aria-label="Jump to page"
              disabled={disabled}
            />
            <span className="text-sm text-slate-500">of {totalPages}</span>
          </div>

          <div className="pl-4 text-sm text-slate-500 hidden sm:block">
            {total} items
          </div>
        </div>

        {showSave && (
          <div>
            <Button
              onClick={onSaveDispatched}
              disabled={selectedCount === 0 || saving || disabled}
              className={`px-4 py-2 rounded-full font-medium ${selectedCount > 0 && !saving ? 'bg-indigo-600 text-white hover:bg-indigo-700' : 'bg-slate-200 text-slate-600'}`}
            >
              {saving ? 'Saving…' : `Save Dispatched${selectedCount ? ` (${selectedCount})` : ''}`}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

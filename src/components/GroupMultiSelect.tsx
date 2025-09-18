'use client';

import React, { JSX, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';

type Props = {
  options: string[]; // labels (e.g. ['Customer', 'Item', 'Color'])
  value: string[]; // selected values (same tokens as options)
  onChange: (next: string[]) => void;
  placeholder?: string;
  className?: string;
};

export default function GroupMultiSelect({
  options,
  value,
  onChange,
  placeholder = 'Group by',
  className = '',
}: Props): JSX.Element {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [open, setOpen] = useState<boolean>(false);

  // Close on outside click or Escape
  useEffect(() => {
    function onPointerDown(e: PointerEvent) {
      if (!rootRef.current) return;
      if (e.target instanceof Node && !rootRef.current.contains(e.target)) {
        setOpen(false);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKey);
    };
  }, []);

  function toggleOption(opt: string) {
    if (value.includes(opt)) {
      onChange(value.filter((v) => v !== opt));
      return;
    }
    onChange([...value, opt]);
  }

  function reset() {
    onChange([]);
  }

  const label = value.length === 0 ? 'None' : value.join(' • ');

  return (
    <div ref={rootRef} className={`relative inline-block ${className}`}>
      {/* Trigger button (not wrapping dropdown) */}
      <Button
        type="button"
        onClick={() => setOpen((s) => !s)}
        aria-haspopup="true"
        aria-expanded={open}
        className="flex items-center gap-3 px-3 py-1"
      >
        <span className="font-medium">{placeholder}</span>
        <span className="text-xs text-slate-500">{label}</span>
      </Button>

      {/* Dropdown (sibling - absolute) */}
      {open && (
        <div
          role="dialog"
          aria-modal="false"
          className="absolute z-50 mt-2 w-64 rounded border bg-white dark:bg-slate-900 shadow p-3"
        >
          <div className="flex flex-col gap-2">
            <div className="flex flex-wrap gap-2">
              {options.map((opt) => {
                const active = value.includes(opt);
                return (
                  // these buttons are inside dropdown DIV (not inside the trigger button)
                  <button
                    key={opt}
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleOption(opt);
                    }}
                    className={`text-sm px-3 py-1 rounded-full border transition ${
                      active ? 'bg-slate-800 text-white' : 'bg-white dark:bg-transparent text-slate-700'
                    }`}
                    aria-pressed={active}
                  >
                    {opt}
                  </button>
                );
              })}
            </div>

            <div className="flex items-center justify-between pt-2">
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  reset();
                }}
                className="text-sm text-slate-600 hover:underline"
              >
                Reset
              </button>

              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setOpen(false);
                  }}
                >
                  Close
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

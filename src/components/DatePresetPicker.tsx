// components/DatePresetPicker.tsx
'use client';

import React, { useMemo, useState, useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';

type Props = {
  startDate: string; // '' or 'YYYY-MM-DD'
  endDate: string; // '' or 'YYYY-MM-DD'
  onChange: (val: { startDate: string; endDate: string }) => void;
  onClear?: () => void;
};

function formatDate(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

function prettyLabel(start: string, end: string) {
  if (!start && !end) return 'All';
  if (start === end && start) {
    const [y, m, d] = start.split('-');
    return `${d}/${m}/${y}`;
  }
  if (!start && end) {
    const [y, m, d] = end.split('-');
    return `Till ${d}/${m}/${y}`;
  }
  if (start && !end) {
    const [y, m, d] = start.split('-');
    return `From ${d}/${m}/${y}`;
  }
  const [ys, ms, ds] = start.split('-');
  const [ye, me, de] = end.split('-');
  return `${ds}/${ms}/${ys} — ${de}/${me}/${ye}`;
}

function startOfWeek(d: Date) {
  const day = d.getDay();
  const diff = (day + 6) % 7;
  const s = new Date(d);
  s.setDate(d.getDate() - diff);
  s.setHours(0, 0, 0, 0);
  return s;
}
function endOfWeek(d: Date) {
  const s = startOfWeek(d);
  s.setDate(s.getDate() + 6);
  return s;
}
function startOfMonth(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}
function endOfMonth(d: Date) {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0);
}
function startOfQuarter(d: Date) {
  const q = Math.floor(d.getMonth() / 3);
  return new Date(d.getFullYear(), q * 3, 1);
}
function endOfQuarter(d: Date) {
  const s = startOfQuarter(d);
  return new Date(s.getFullYear(), s.getMonth() + 3, 0);
}

export default function DatePresetPicker({ startDate, endDate, onChange, onClear }: Props) {
  const [open, setOpen] = useState<boolean>(false);
  const [customStart, setCustomStart] = useState<string>(startDate);
  const [customEnd, setCustomEnd] = useState<string>(endDate);

  // single-date custom mode and value
  const [singleCustomMode, setSingleCustomMode] = useState<boolean>(false);
  const [customSingleDate, setCustomSingleDate] = useState<string>('');

  // keep internal state in sync with props
  useEffect(() => {
    setCustomStart(startDate);
    setCustomEnd(endDate);
    if (startDate && startDate === endDate) {
      setCustomSingleDate(startDate);
    } else {
      setCustomSingleDate('');
    }
  }, [startDate, endDate]);

  const rootRef = useRef<HTMLDivElement | null>(null);
  const today = useMemo(() => new Date(), []);

  // click-outside and escape handler
  useEffect(() => {
    function onPointerDown(e: PointerEvent) {
      const el = rootRef.current;
      if (!el) return;
      if (!(e.target instanceof Node) || !el.contains(e.target)) {
        setOpen(false);
      }
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        setOpen(false);
      }
    }
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, []);

  function applyPreset(name: string) {
    if (name !== 'Custom') {
      // reset singleCustomMode (we only enter single mode via Custom)
      setSingleCustomMode(false);
    }

    let s = '';
    let e = '';

    switch (name) {
      case 'Today':
        s = e = formatDate(new Date());
        break;
      case 'Yesterday': {
        const d = new Date();
        d.setDate(d.getDate() - 1);
        s = e = formatDate(d);
        break;
      }
      case '7 Days': {
        const end = new Date();
        const start = new Date();
        start.setDate(end.getDate() - 6);
        s = formatDate(start);
        e = formatDate(end);
        break;
      }
      case '30 Days': {
        const end = new Date();
        const start = new Date();
        start.setDate(end.getDate() - 29);
        s = formatDate(start);
        e = formatDate(end);
        break;
      }
      case '90 Days': {
        const end = new Date();
        const start = new Date();
        start.setDate(end.getDate() - 89);
        s = formatDate(start);
        e = formatDate(end);
        break;
      }
      case 'This Week':
        s = formatDate(startOfWeek(today));
        e = formatDate(endOfWeek(today));
        break;
      case 'This Month':
        s = formatDate(startOfMonth(today));
        e = formatDate(endOfMonth(today));
        break;
      case 'This Quarter':
        s = formatDate(startOfQuarter(today));
        e = formatDate(endOfQuarter(today));
        break;
      case 'Previous Month': {
        const ref = new Date();
        ref.setMonth(ref.getMonth() - 1);
        s = formatDate(startOfMonth(ref));
        e = formatDate(endOfMonth(ref));
        break;
      }
      case 'Previous Quarter': {
        const ref = new Date();
        ref.setMonth(ref.getMonth() - 3);
        s = formatDate(startOfQuarter(ref));
        e = formatDate(endOfQuarter(ref));
        break;
      }
      case 'Till Date':
        s = '';
        e = formatDate(new Date());
        break;
      case 'Custom':
        // toggle behavior:
        // - if we are currently NOT in singleCustomMode -> switch to singleCustomMode
        // - if we ARE in singleCustomMode -> toggle back to range mode (two inputs)
        if (!singleCustomMode) {
          // enter single-date custom mode
          setSingleCustomMode(true);
          setOpen(true);
          // initialize single date to current selection or today
          const fallback = startDate || endDate || formatDate(new Date());
          setCustomSingleDate(fallback);
        } else {
          // already in single mode -> switch to two-input range mode
          setSingleCustomMode(false);
          setOpen(true);
          // keep customStart/customEnd as-is (if they were empty, initialize to today-range)
          if (!customStart && !customEnd) {
            const todayStr = formatDate(new Date());
            setCustomStart(todayStr);
            setCustomEnd(todayStr);
          }
        }
        return;
      default:
        return;
    }

    // apply chosen preset
    setCustomStart(s);
    setCustomEnd(e);
    setCustomSingleDate(s === e ? s : '');
    onChange({ startDate: s, endDate: e });
    setOpen(false);
  }

  function applyCustomRange() {
    onChange({ startDate: customStart ?? '', endDate: customEnd ?? '' });
    setOpen(false);
    setSingleCustomMode(false);
  }

  function applyCustomSingle() {
    const chosen = customSingleDate ?? '';
    onChange({ startDate: chosen, endDate: chosen });
    setCustomStart(chosen);
    setCustomEnd(chosen);
    setOpen(false);
    setSingleCustomMode(false);
  }

  function clearAll() {
    setCustomStart('');
    setCustomEnd('');
    setCustomSingleDate('');
    setSingleCustomMode(false);
    onChange({ startDate: '', endDate: '' });
    if (onClear) onClear();
    setOpen(false);
  }

  const presets = [
    'Today',
    'Yesterday',
    '7 Days',
    '30 Days',
    '90 Days',
    'This Week',
    'This Month',
    'This Quarter',
    'Previous Month',
    'Previous Quarter',
    'Till Date',
    'Custom',
  ];

  return (
    <div className="relative inline-block" ref={rootRef}>
      <div className="flex items-center gap-2">
        <Button onClick={() => setOpen((o) => !o)} size="sm" variant="outline" aria-expanded={open}>
          SO Date ▾
        </Button>

        <div className="text-sm text-slate-500">{prettyLabel(customStart, customEnd)}</div>

        <Button variant="ghost" size="sm" onClick={clearAll}>
          Clear
        </Button>
      </div>

      {open && (
        <div className="absolute z-50 mt-2 w-72 bg-white dark:bg-slate-900 border rounded shadow p-3">
          <div className="grid grid-cols-2 gap-2">
            {presets.map((p) => {
              // show "Custom range" text when singleCustomMode is active (so user can toggle)
              const label = p === 'Custom' && singleCustomMode ? 'Custom range' : p;
              return (
                <button
                  key={p}
                  className="text-left px-2 py-1 rounded hover:bg-slate-100 dark:hover:bg-slate-800"
                  onClick={() => applyPreset(p)}
                  type="button"
                >
                  {label}
                </button>
              );
            })}
          </div>

          <div className="mt-3">
            {singleCustomMode ? (
              <div className="flex flex-col gap-2">
                <label className="text-xs">Pick date</label>
                <input
                  type="date"
                  value={customSingleDate}
                  onChange={(e) => setCustomSingleDate(e.target.value)}
                  className="rounded border px-2 py-1 bg-transparent"
                />
                <div className="flex gap-2 justify-end mt-2">
                  <Button variant="ghost" onClick={clearAll}>
                    Clear
                  </Button>
                  <Button onClick={applyCustomSingle}>Apply</Button>
                </div>
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                <label className="text-xs">Custom range</label>
                <input
                  type="date"
                  value={customStart}
                  onChange={(e) => setCustomStart(e.target.value)}
                  className="rounded border px-2 py-1 bg-transparent"
                />
                <input
                  type="date"
                  value={customEnd}
                  onChange={(e) => setCustomEnd(e.target.value)}
                  className="rounded border px-2 py-1 bg-transparent"
                />
                <div className="flex gap-2 justify-end mt-2">
                  <Button variant="ghost" onClick={clearAll}>
                    Clear
                  </Button>
                  <Button onClick={applyCustomRange}>Apply</Button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

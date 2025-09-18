// components/TokenSearchBar.tsx
'use client';

import React, { KeyboardEvent, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

type Props = {
  tokens: string[];
  onAdd: (token: string) => void;
  onRemove: (token: string) => void;
  onClear: () => void;
};

const MAX_TOKEN_LENGTH = 64;

function sanitizeToken(raw: string): string {
  // collapse internal whitespace, trim
  return raw.replace(/\s+/g, ' ').trim();
}

export default function TokenSearchBar({ tokens, onAdd, onRemove, onClear }: Props) {
  const [value, setValue] = useState<string>('');
  const inputRef = useRef<HTMLInputElement | null>(null);

  function addFromValue() {
    const tRaw = value;
    const t = sanitizeToken(tRaw);
    if (!t) return;

    // case-insensitive duplicate prevention
    const lower = t.toLowerCase();
    if (tokens.some((existing) => existing.toLowerCase() === lower)) {
      setValue('');
      inputRef.current?.focus();
      return;
    }

    // enforce max length
    if (t.length > MAX_TOKEN_LENGTH) {
      // optionally trim or reject — here we trim
      onAdd(t.slice(0, MAX_TOKEN_LENGTH));
    } else {
      onAdd(t);
    }
    setValue('');
    inputRef.current?.focus();
  }

  function onKey(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      e.preventDefault();
      addFromValue();
      return;
    }

    if (e.key === 'Escape') {
      // clear input & blur
      setValue('');
      inputRef.current?.blur();
      return;
    }

    // remove last token on backspace when input is empty
    if (e.key === 'Backspace' && value === '' && tokens.length > 0) {
      e.preventDefault();
      onRemove(tokens[tokens.length - 1]);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex gap-2 items-center">
        <Input
          ref={inputRef}
          placeholder="Add global search token (press Enter)"
          value={value}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => setValue(e.target.value)}
          onKeyDown={onKey}
          aria-label="Add token"
        />
        <Button type="button" onClick={addFromValue} aria-label="Add token">
          +
        </Button>
        <Button type="button" variant="ghost" onClick={onClear} aria-label="Clear tokens">
          Clear
        </Button>
      </div>

      <div className="flex gap-2 flex-wrap" role="list" aria-live="polite">
        {tokens.map((t) => (
          <span
            key={t}
            role="listitem"
            title={t}
            className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-slate-700 text-sm"
          >
            <span>{t}</span>
            <button
              type="button"
              onClick={() => onRemove(t)}
              className="h-5 w-5 flex items-center justify-center rounded-full hover:bg-slate-600"
              aria-label={`remove ${t}`}
            >
              ×
            </button>
          </span>
        ))}
      </div>
    </div>
  );
}

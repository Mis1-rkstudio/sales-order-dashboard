"use client";

import React, { JSX, useCallback, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { cn } from "@/lib/utils";

type Props = {
  /** Options to show in the list (display strings) */
  options: string[];
  /** Currently selected options (controlled) */
  value: string[];
  /** Called when selection changes */
  onChange: (selected: string[]) => void;
  /** Placeholder text shown in the trigger */
  placeholder?: string;
  /** Optional classname for the outer wrapper */
  className?: string;
  /** Max number of chips to show on trigger before collapsing to "+N" */
  maxChips?: number;
};

export default function SearchMultiSelect({
  options,
  value,
  onChange,
  placeholder = "Select...",
  className = "",
  maxChips = 3,
}: Props): JSX.Element {
  const [open, setOpen] = useState<boolean>(false);
  const [query, setQuery] = useState<string>("");

  // filter options by query (case-insensitive)
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter((o) => o.toLowerCase().includes(q));
  }, [options, query]);

  const toggleOption = useCallback(
    (opt: string) => {
      if (value.includes(opt)) {
        onChange(value.filter((v) => v !== opt));
      } else {
        // preserve order according to options array
        const next = Array.from(new Set([...value, opt]));
        const ordered = options.filter((o) => next.includes(o));
        onChange(ordered);
      }
    },
    [onChange, options, value]
  );

  const clearAll = useCallback(() => {
    onChange([]);
  }, [onChange]);

  // text to show on trigger when nothing selected
  const triggerText = value.length === 0 ? placeholder : "";

  return (
    <div className={cn("inline-block", className)}>
      <Popover
        open={open}
        onOpenChange={(o) => {
          setOpen(o);
          if (!o) setQuery("");
        }}
      >
        <PopoverTrigger asChild>
          <Button
            variant="ghost"
            className="min-w-[180px] h-9 flex items-center gap-2 justify-start normal-case"
            aria-expanded={open}
          >
            <div className="flex-1 text-sm text-left">
              {triggerText ? (
                <span className="text-slate-500">{triggerText}</span>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {value.slice(0, maxChips).map((v) => (
                    <span
                      key={v}
                      className="px-3 py-1 text-xs rounded-full border border-slate-200 bg-white/70"
                    >
                      {v}
                    </span>
                  ))}
                  {value.length > maxChips && (
                    <span className="px-3 py-1 text-xs rounded-full border border-slate-200 bg-white/70">
                      +{value.length - maxChips}
                    </span>
                  )}
                </div>
              )}
            </div>

            <div className="text-xs text-slate-400">
              {value.length === 0 ? "None" : `${value.length}`}
            </div>
          </Button>
        </PopoverTrigger>

        <PopoverContent align="start" className="w-[320px] p-0">
          <Command>
            <div className="px-3 py-2">
              <div className="flex items-center justify-between gap-2">
                <CommandInput
                  value={query}
                  onValueChange={(v: string) => setQuery(v)}
                  placeholder="Search..."
                />
                <Button size="sm" variant="ghost" onClick={clearAll}>
                  Clear
                </Button>
              </div>
            </div>

            <CommandList>
              <CommandEmpty>No results.</CommandEmpty>

              <CommandGroup>
                {filtered.map((opt) => {
                  const checked = value.includes(opt);
                  return (
                    <CommandItem
                      key={opt}
                      onSelect={() => {
                        toggleOption(opt);
                      }}
                      className="flex items-center justify-between gap-2 px-3 py-2 hover:bg-slate-50"
                    >
                      <div className="flex items-center gap-3">
                        {/* Stop propagation so clicking the checkbox doesn't also trigger CommandItem onSelect */}
                        <input
                          aria-label={opt}
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleOption(opt)}
                          onClick={(e) => e.stopPropagation()}
                          className="h-4 w-4"
                        />
                        <span className="text-sm">{opt}</span>
                      </div>

                      {checked && (
                        <span className="text-xs text-slate-500">Selected</span>
                      )}
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  );
}

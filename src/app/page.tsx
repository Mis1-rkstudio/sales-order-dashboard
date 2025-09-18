// app/page.tsx
'use client';

import React, { JSX, useState } from 'react';
import TokenSearchBar from '@/components/TokenSearchBar';
import SalesOrdersTable from '@/components/SalesOrdersTable';
import DatePresetPicker from '@/components/DatePresetPicker';
import GroupMultiSelect from '@/components/GroupMultiSelect';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

type Filters = {
  q: string;
  tokens: string[];
  brand: string;
  city: string;
  startDate: string;
  endDate: string;
  limit: number;
};

// group options shown in UI — must match keys used inside SalesOrdersTable
const GROUPABLE_OPTIONS = ['Customer', 'Item', 'Color', 'Broker', 'Status'] as const;
type GroupLabel = typeof GROUPABLE_OPTIONS[number];

export default function HomePage(): JSX.Element {
  const [filters, setFilters] = useState<Filters>({
    q: '',
    tokens: [],
    brand: '',
    city: '',
    startDate: '',
    endDate: '',
    limit: 25,
  });

  // draft state the user can edit before pressing Apply
  const [draft, setDraft] = useState({
    tokens: filters.tokens as string[],
    startDate: filters.startDate,
    endDate: filters.endDate,
    limit: filters.limit,
  });

  // group-by state is controlled here and passed to the table
  const [groupBy, setGroupBy] = useState<GroupLabel[]>(['Customer']); // default grouped by Customer

  // add/remove tokens in draft
  function addToken(token: string) {
    setDraft((d) => ({ ...d, tokens: Array.from(new Set([...d.tokens, token])) }));
  }
  function removeToken(token: string) {
    setDraft((d) => ({ ...d, tokens: d.tokens.filter((t) => t !== token) }));
  }

  // Clear tokens (from draft) AND apply immediately so table refreshes
  function onTokenClear() {
    setDraft((d) => ({ ...d, tokens: [] }));
    setFilters((f) => ({ ...f, tokens: [] }));
  }

  // Clear date selection from draft AND apply immediately so table refreshes
  function onDateClear() {
    setDraft((d) => ({ ...d, startDate: '', endDate: '' }));
    setFilters((f) => ({ ...f, startDate: '', endDate: '' }));
  }

  // global clear: reset both filters & draft (already applied immediately)
  function onClearAll() {
    const empty = {
      q: '',
      tokens: [] as string[],
      brand: '',
      city: '',
      startDate: '',
      endDate: '',
      limit: 25,
    };
    setFilters(empty);
    setDraft({ tokens: [], startDate: '', endDate: '', limit: 25 });
    setGroupBy(['Customer']);
  }

  // Apply draft to filters (user explicit Apply)
  function onApply() {
    setFilters((s) => ({
      ...s,
      tokens: draft.tokens,
      startDate: draft.startDate,
      endDate: draft.endDate,
      limit: draft.limit,
    }));
  }

  // When GroupMultiSelect calls onChange provide fallback to Customer if user clears selection
  function onGroupChange(selected: string[]) {
    if (selected.length === 0) {
      setGroupBy(['Customer']);
    } else {
      // ensure we keep the order defined by GROUPABLE_OPTIONS
      const ordered = GROUPABLE_OPTIONS.filter((opt) => selected.includes(opt)) as GroupLabel[];
      setGroupBy(ordered.length ? ordered : (['Customer'] as GroupLabel[]));
    }
  }

  return (
    <main className="p-6">
      <h1 className="text-2xl font-bold mb-4">Kolkata Sales Orders — Home</h1>

      <Card className="p-4 mb-4">
        {/* Token search row */}
        <div className="mb-4">
          <TokenSearchBar tokens={draft.tokens} onAdd={addToken} onRemove={removeToken} onClear={onTokenClear} />
        </div>

        {/* Date preset picker + Group-by controls + top actions */}
        <div className="flex flex-col md:flex-row md:items-center gap-3 md:gap-4">
          <div className="flex items-center gap-2">
            <DatePresetPicker
              startDate={draft.startDate}
              endDate={draft.endDate}
              onChange={(v) => setDraft((d) => ({ ...d, startDate: v.startDate, endDate: v.endDate }))}
              onClear={onDateClear}
            />
            <div className="ml-3 text-sm text-slate-500">All</div>
          </div>

          {/* Single multiselect control for Group-by */}
          <div className="flex items-center gap-3 ml-4">
            <GroupMultiSelect
              options={GROUPABLE_OPTIONS as unknown as string[]}
              value={groupBy as unknown as string[]}
              onChange={onGroupChange}
              placeholder="Group by"
              className="min-w-[280px]"
            />
          </div>

          <div className="flex items-center gap-2 ml-auto">
            <Button variant="ghost" onClick={onClearAll}>
              Clear
            </Button>

            {/* Apply commits draft -> filters */}
            <Button onClick={onApply}>Apply</Button>
          </div>
        </div>
      </Card>

      {/* pass groupBy to the table as an array of labels (in selected order) */}
      <SalesOrdersTable filters={filters} groupBy={groupBy as unknown as string[]} />
    </main>
  );
}

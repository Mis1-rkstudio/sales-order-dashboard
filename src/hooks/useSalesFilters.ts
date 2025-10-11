"use client";

import { useCallback, useState } from "react";

export type Filters = {
  q: string;
  tokens: string[];
  brand: string;
  city: string;
  startDate: string;
  endDate: string;
  limit: number;
  customers: string[];
  items: string[];
};

export type Draft = {
  tokens: string[];
  startDate: string;
  endDate: string;
  limit: number;
  customers: string[];
  items: string[];
};

export const GROUPABLE_OPTIONS = [
  "Customer",
  "Item",
  "Color",
  "Broker",
  "Status",
] as const;

export type GroupKey = (typeof GROUPABLE_OPTIONS)[number];

export function useSalesFilters() {
  const [filters, setFilters] = useState<Filters>({
    q: "",
    tokens: [],
    brand: "",
    city: "",
    startDate: "",
    endDate: "",
    limit: 25,
    customers: [],
    items: [],
  });

  const [draft, setDraft] = useState<Draft>({
    tokens: [],
    startDate: "",
    endDate: "",
    limit: 25,
    customers: [],
    items: [],
  });

  const [groupBy, setGroupBy] = useState<GroupKey[]>(["Item"]);

  const addToken = useCallback((token: string) => {
    setDraft((d) => ({ ...d, tokens: Array.from(new Set([...d.tokens, token])) }));
  }, []);

  const removeToken = useCallback((token: string) => {
    setDraft((d) => ({ ...d, tokens: d.tokens.filter((t) => t !== token) }));
  }, []);

  const clearTokens = useCallback(() => {
    setDraft((d) => ({ ...d, tokens: [] }));
    setFilters((f) => ({ ...f, tokens: [] }));
  }, []);

  const clearDates = useCallback(() => {
    setDraft((d) => ({ ...d, startDate: "", endDate: "" }));
    setFilters((f) => ({ ...f, startDate: "", endDate: "" }));
  }, []);

  const clearAll = useCallback(() => {
    const empty: Filters = {
      q: "",
      tokens: [],
      brand: "",
      city: "",
      startDate: "",
      endDate: "",
      limit: 25,
      customers: [],
      items: [],
    };
    setFilters(empty);
    setDraft({ tokens: [], startDate: "", endDate: "", limit: 25, customers: [], items: [] });
    setGroupBy(["Customer"]);
  }, []);

  const apply = useCallback(() => {
    setFilters((s) => ({
      ...s,
      tokens: draft.tokens,
      startDate: draft.startDate,
      endDate: draft.endDate,
      limit: draft.limit,
      customers: draft.customers,
      items: draft.items,
    }));
  }, [draft]);

  const onGroupChange = useCallback((selected: string[]) => {
    if (selected.length === 0) {
      setGroupBy(["Customer"]);
      return;
    }
    const ordered = GROUPABLE_OPTIONS.filter((opt) => selected.includes(opt)) as GroupKey[];
    setGroupBy(ordered.length ? ordered : (["Customer"] as GroupKey[]));
  }, []);

  const onDateChange = useCallback((v: { startDate: string; endDate: string }) => {
    setDraft((d) => ({ ...d, startDate: v.startDate, endDate: v.endDate }));
  }, []);

  const onCustomersChange = useCallback((selected: string[]) => {
    setDraft((d) => ({ ...d, customers: selected }));
  }, []);

  const onItemsChange = useCallback((selected: string[]) => {
    setDraft((d) => ({ ...d, items: selected }));
  }, []);

  return {
    // state
    filters,
    draft,
    groupBy,

    // setters for rare cases
    setDraft,
    setGroupBy,

    // options for group select
    groupOptions: [...GROUPABLE_OPTIONS] as string[],

    // actions
    addToken,
    removeToken,
    clearTokens,
    clearDates,
    clearAll,
    apply,
    onGroupChange,
    onDateChange,
    onCustomersChange,
    onItemsChange,
  } as const;
}


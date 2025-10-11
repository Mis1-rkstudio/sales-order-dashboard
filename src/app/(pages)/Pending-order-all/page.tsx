"use client";

import React, { JSX, useEffect, useState } from "react";
import TokenSearchBar from "@/components/TokenSearchBar";
import SalesOrdersTable from "@/components/SalesOrdersTable";
import DatePresetPicker from "@/components/DatePresetPicker";
import GroupMultiSelect from "@/components/GroupMultiSelect";
import CustomerItemMultiSelect from "@/components/CustomerItemMultiSelect";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

/**
 * Page-level types
 */
type Filters = {
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

type Draft = {
  tokens: string[];
  startDate: string;
  endDate: string;
  limit: number;
  customers: string[];
  items: string[];
};

const GROUPABLE_OPTIONS = [
  "Customer",
  "Item",
  "Color",
  "Broker",
  "Status",
] as const;

// Local alias for group key values
type GroupKey = (typeof GROUPABLE_OPTIONS)[number];

type CustomerRow = {
  Customer?: string;
  Company_Name?: string;
};
type CustomersApiResponse = { rows: CustomerRow[] };

type StockRow = {
  Item?: string;
  normalized_item?: string;
};
type StockApiResponse = { rows: StockRow[] };

export default function PendingOrderAll(): JSX.Element {
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
    tokens: filters.tokens,
    startDate: filters.startDate,
    endDate: filters.endDate,
    limit: filters.limit,
    customers: filters.customers,
    items: filters.items,
  });

  // Use local GroupKey type
  const [groupBy, setGroupBy] = useState<GroupKey[]>(["Item" as GroupKey]);

  // We still fetch these for other uses (or to pass later if we extend the component),
  // but we won't pass them to CustomerItemMultiSelect unless the component accepts them.
  const [customerOptions, setCustomerOptions] = useState<string[]>([]);
  const [itemOptions, setItemOptions] = useState<string[]>([]);

  function addToken(token: string) {
    setDraft((d) => ({
      ...d,
      tokens: Array.from(new Set([...d.tokens, token])),
    }));
  }
  function removeToken(token: string) {
    setDraft((d) => ({ ...d, tokens: d.tokens.filter((t) => t !== token) }));
  }

  function onTokenClear() {
    setDraft((d) => ({ ...d, tokens: [] }));
    setFilters((f) => ({ ...f, tokens: [] }));
  }

  function onDateClear() {
    setDraft((d) => ({ ...d, startDate: "", endDate: "" }));
    setFilters((f) => ({ ...f, startDate: "", endDate: "" }));
  }

  function onClearAll() {
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
    setDraft({
      tokens: [],
      startDate: "",
      endDate: "",
      limit: 25,
      customers: [],
      items: [],
    });
    setGroupBy(["Customer" as GroupKey]);
  }

  function onApply() {
    setFilters((s) => ({
      ...s,
      tokens: draft.tokens,
      startDate: draft.startDate,
      endDate: draft.endDate,
      limit: draft.limit,
      customers: draft.customers,
      items: draft.items,
    }));
  }

  // Convert selected string[] from GroupMultiSelect into GroupKey[] (safe because options are known)
  function onGroupChange(selected: string[]) {
    if (selected.length === 0) {
      setGroupBy(["Customer" as GroupKey]);
      return;
    }
    const ordered = GROUPABLE_OPTIONS.filter((opt) =>
      selected.includes(opt)
    ) as GroupKey[];
    setGroupBy(ordered.length ? ordered : (["Customer"] as GroupKey[]));
  }

  useEffect(() => {
    let mounted = true;

    async function fetchCustomers() {
      try {
        const res = await fetch("/api/customers");
        if (!res.ok) throw new Error(`Failed to load customers: ${res.status}`);
        const data = (await res.json()) as CustomersApiResponse;
        const namesSet = new Set(
          data.rows
            .map((r) => r.Customer ?? r.Company_Name ?? "")
            .filter(Boolean)
            .map((n) => n.trim())
        );
        if (mounted) setCustomerOptions(Array.from(namesSet).sort());
      } catch (err) {
        console.warn("Error fetching customers", err);
      }
    }

    async function fetchItems() {
      try {
        const res = await fetch("/api/stock");
        if (!res.ok) throw new Error(`Failed to load stock: ${res.status}`);
        const data = (await res.json()) as StockApiResponse;
        const namesSet = new Set(
          data.rows
            .map((r) => r.Item ?? r.normalized_item ?? "")
            .filter(Boolean)
            .map((n) => n.trim())
        );
        if (mounted) setItemOptions(Array.from(namesSet).sort());
      } catch (err) {
        console.warn("Error fetching stock", err);
      }
    }

    fetchCustomers();
    fetchItems();

    return () => {
      mounted = false;
    };
  }, []);

  return (
    <main className="p-6">
      <h1 className="text-2xl font-bold mb-4">Kolkata Sales Orders — Home</h1>

      <Card className="p-4 mb-4">
        <div className="mb-4">
          <TokenSearchBar
            tokens={draft.tokens}
            onAdd={addToken}
            onRemove={removeToken}
            onClear={onTokenClear}
          />
        </div>

        <div className="flex flex-col md:flex-row md:items-center gap-3 md:gap-4">
          <div className="flex items-center gap-2">
            <DatePresetPicker
              startDate={draft.startDate}
              endDate={draft.endDate}
              onChange={(v) =>
                setDraft((d) => ({
                  ...d,
                  startDate: v.startDate,
                  endDate: v.endDate,
                }))
              }
              onClear={onDateClear}
            />
            <div className="ml-3 text-sm text-slate-500">All</div>
          </div>

          <div className="flex items-center gap-3 ml-4">
            {/* spread readonly tuple into a fresh array to satisfy mutable prop types */}
            <GroupMultiSelect
              options={[...GROUPABLE_OPTIONS]}
              value={[...groupBy]}
              onChange={onGroupChange}
              placeholder="Group by"
              className="min-w-[280px]"
            />
          </div>

          <CustomerItemMultiSelect
            selectedCustomers={draft.customers}
            selectedItems={draft.items}
            onCustomersChange={(selected) =>
              setDraft((d) => ({ ...d, customers: selected }))
            }
            onItemsChange={(selected) =>
              setDraft((d) => ({ ...d, items: selected }))
            }
            className="ml-4"
          />

          <div className="flex items-center gap-2 ml-auto">
            <Button variant="ghost" onClick={onClearAll}>
              Clear
            </Button>
            <Button onClick={onApply}>Apply</Button>
          </div>
        </div>
      </Card>

      <SalesOrdersTable filters={filters} groupBy={groupBy} />
    </main>
  );
}

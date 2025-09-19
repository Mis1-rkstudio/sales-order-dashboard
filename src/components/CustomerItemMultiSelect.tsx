"use client";

import React, { JSX, useEffect, useState } from "react";
import SearchMultiSelect from "./SearchMultiSelect";
import { cn } from "@/lib/utils";

type Props = {
  selectedCustomers: string[];
  selectedItems: string[];
  onCustomersChange: (selected: string[]) => void;
  onItemsChange: (selected: string[]) => void;
  className?: string;
  /** optional: show smaller width for each select */
  compact?: boolean;
};

type CustomerRow = {
  Customer?: string | null;
  Company_Name?: string | null;
  // other fields are ignored here
};

type CustomersApiResponse = {
  rows: CustomerRow[];
};

type StockRow = {
  Item?: string | null;
  normalized_item?: string | null;
  // other fields are ignored here
};

type StockApiResponse = {
  rows: StockRow[];
};

/** Type-safe guard for AbortError-like errors (no `any`) */
function isAbortError(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;
  const e = err as Record<string, unknown>;
  if ("name" in e && typeof e.name === "string") {
    return e.name === "AbortError";
  }
  return false;
}

export default function CustomerItemMultiSelect({
  selectedCustomers,
  selectedItems,
  onCustomersChange,
  onItemsChange,
  className = "",
  compact = false,
}: Props): JSX.Element {
  const [customerOptions, setCustomerOptions] = useState<string[]>([]);
  const [itemOptions, setItemOptions] = useState<string[]>([]);
  const [loadingCustomers, setLoadingCustomers] = useState<boolean>(false);
  const [loadingItems, setLoadingItems] = useState<boolean>(false);
  const [errorCustomers, setErrorCustomers] = useState<string | null>(null);
  const [errorItems, setErrorItems] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    const signal = controller.signal;

    async function fetchCustomers() {
      setLoadingCustomers(true);
      setErrorCustomers(null);
      try {
        const res = await fetch("/api/customers", { signal });
        if (!res.ok)
          throw new Error(`customers: ${res.status} ${res.statusText}`);
        const data = (await res.json()) as CustomersApiResponse;

        const names = data.rows
          .map((r) => (r.Customer ?? r.Company_Name ?? "").trim())
          .filter((v) => v.length > 0);

        const unique = Array.from(new Set(names)).sort((a, b) =>
          a.localeCompare(b)
        );
        setCustomerOptions(unique);
      } catch (err: unknown) {
        if (isAbortError(err)) return;
        setErrorCustomers("Failed to load customers");
        // log for debugging
        console.warn("Error fetching customers", err);
      } finally {
        setLoadingCustomers(false);
      }
    }

    fetchCustomers();
    return () => controller.abort();
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const signal = controller.signal;

    async function fetchItems() {
      setLoadingItems(true);
      setErrorItems(null);
      try {
        const res = await fetch("/api/stock", { signal });
        if (!res.ok) throw new Error(`stock: ${res.status} ${res.statusText}`);
        const data = (await res.json()) as StockApiResponse;

        const names = data.rows
          .map((r) => (r.Item ?? r.normalized_item ?? "").trim())
          .filter((v) => v.length > 0);

        const unique = Array.from(new Set(names)).sort((a, b) =>
          a.localeCompare(b)
        );
        setItemOptions(unique);
      } catch (err: unknown) {
        if (isAbortError(err)) return;
        setErrorItems("Failed to load items");
        // log for debugging
        console.warn("Error fetching items", err);
      } finally {
        setLoadingItems(false);
      }
    }

    fetchItems();
    return () => controller.abort();
  }, []);

  // helper placeholders reflect loading / error states
  const customerPlaceholder = loadingCustomers
    ? "Loading customers…"
    : errorCustomers ?? "Customers";
  const itemPlaceholder = loadingItems
    ? "Loading items…"
    : errorItems ?? "Items";

  return (
    <div className={cn("flex items-center gap-3", className)}>
      <div className={compact ? "min-w-[180px]" : "min-w-[220px]"}>
        <SearchMultiSelect
          options={customerOptions}
          value={selectedCustomers}
          onChange={onCustomersChange}
          placeholder={customerPlaceholder}
          className=""
          maxChips={2}
        />
        {errorCustomers && (
          <div className="text-xs text-red-500 mt-1">{errorCustomers}</div>
        )}
      </div>

      <div className={compact ? "min-w-[180px]" : "min-w-[220px]"}>
        <SearchMultiSelect
          options={itemOptions}
          value={selectedItems}
          onChange={onItemsChange}
          placeholder={itemPlaceholder}
          className=""
          maxChips={2}
        />
        {errorItems && (
          <div className="text-xs text-red-500 mt-1">{errorItems}</div>
        )}
      </div>
    </div>
  );
}

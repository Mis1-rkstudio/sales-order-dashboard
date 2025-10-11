"use client";

import React, { JSX } from "react";
import { Card } from "@/components/ui/card";
import SalesOrdersTable from "@/components/SalesOrdersTable";
import FiltersBar from "@/components/FiltersBar";
import { useSalesFilters } from "@/hooks/useSalesFilters";

export default function HomePage(): JSX.Element {
  const {
    // state
    filters,
    draft,
    groupBy,
    groupOptions,

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
  } = useSalesFilters();

  return (
    <main className="p-6">
      <h1 className="text-2xl font-bold mb-4">Kolkata Sales Orders — Home</h1>

      <Card className="p-4 mb-4">
        <FiltersBar
          draft={draft}
          groupBy={groupBy}
          groupOptions={groupOptions}
          onAddToken={addToken}
          onRemoveToken={removeToken}
          onClearTokens={clearTokens}
          onDateChange={onDateChange}
          onDateClear={clearDates}
          onGroupChange={onGroupChange}
          onCustomersChange={onCustomersChange}
          onItemsChange={onItemsChange}
          onClearAll={clearAll}
          onApply={apply}
        />
      </Card>

      <SalesOrdersTable filters={filters} groupBy={groupBy} />
    </main>
  );
}

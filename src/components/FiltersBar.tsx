"use client";

import React, { JSX } from "react";
import { SearchSection } from "./FiltersBar/SearchSection";
import { FiltersSection } from "./FiltersBar/FiltersSection";
import { ActionsSection } from "./FiltersBar/ActionsSection";

type Props = {
  draft: {
    tokens: string[];
    startDate: string;
    endDate: string;
    customers: string[];
    items: string[];
  };
  groupBy: string[];
  groupOptions: string[];
  onAddToken: (token: string) => void;
  onRemoveToken: (token: string) => void;
  onClearTokens: () => void;
  onDateChange: (v: { startDate: string; endDate: string }) => void;
  onDateClear: () => void;
  onGroupChange: (selected: string[]) => void;
  onCustomersChange: (selected: string[]) => void;
  onItemsChange: (selected: string[]) => void;
  onClearAll: () => void;
  onApply: () => void;
};

export default function FiltersBar({
  draft,
  groupBy,
  groupOptions,
  onAddToken,
  onRemoveToken,
  onClearTokens,
  onDateChange,
  onDateClear,
  onGroupChange,
  onCustomersChange,
  onItemsChange,
  onClearAll,
  onApply,
}: Props): JSX.Element {
  return (
    <div className="flex flex-col gap-3 md:gap-4">
      {/* Top row with search, date filters, and group by */}
      <div className="flex flex-col md:flex-row md:items-center gap-3 md:gap-4">
        <SearchSection
          tokens={draft.tokens}
          onAdd={onAddToken}
          onRemove={onRemoveToken}
          onClear={onClearTokens}
        />
        <FiltersSection
          startDate={draft.startDate}
          endDate={draft.endDate}
          groupBy={groupBy}
          groupOptions={groupOptions}
          onDateChange={onDateChange}
          onDateClear={onDateClear}
          onGroupChange={onGroupChange}
        />
      </div>

      {/* Bottom row with customer/item select and action buttons */}
      <ActionsSection
        selectedCustomers={draft.customers}
        selectedItems={draft.items}
        onCustomersChange={onCustomersChange}
        onItemsChange={onItemsChange}
        onClearAll={onClearAll}
        onApply={onApply}
      />
    </div>
  );
}

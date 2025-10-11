"use client";

import CustomerItemMultiSelect from "@/components/CustomerItemMultiSelect";
import { Button } from "@/components/ui/button";

type ActionsSectionProps = {
  selectedCustomers: string[];
  selectedItems: string[];
  onCustomersChange: (selected: string[]) => void;
  onItemsChange: (selected: string[]) => void;
  onClearAll: () => void;
  onApply: () => void;
};

export function ActionsSection({
  selectedCustomers,
  selectedItems,
  onCustomersChange,
  onItemsChange,
  onClearAll,
  onApply,
}: ActionsSectionProps) {
  return (
    <div className="flex flex-col md:flex-row md:items-center gap-3 md:gap-4 w-full">
      <CustomerItemMultiSelect
        selectedCustomers={selectedCustomers}
        selectedItems={selectedItems}
        onCustomersChange={onCustomersChange}
        onItemsChange={onItemsChange}
        className="flex-1"
      />
      <div className="flex items-center gap-2">
        <Button variant="ghost" onClick={onClearAll}>
          Clear
        </Button>
        <Button onClick={onApply}>Apply</Button>
      </div>
    </div>
  );
}

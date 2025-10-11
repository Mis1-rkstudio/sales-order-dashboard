"use client";

import DatePresetPicker from "@/components/DatePresetPicker";
import GroupMultiSelect from "@/components/GroupMultiSelect";

type FiltersSectionProps = {
  startDate: string;
  endDate: string;
  groupBy: string[];
  groupOptions: string[];
  onDateChange: (v: { startDate: string; endDate: string }) => void;
  onDateClear: () => void;
  onGroupChange: (selected: string[]) => void;
};

export function FiltersSection({
  startDate,
  endDate,
  groupBy,
  groupOptions,
  onDateChange,
  onDateClear,
  onGroupChange,
}: FiltersSectionProps) {
  return (
    <>
      <div className="flex items-center gap-2">
        <DatePresetPicker
          startDate={startDate}
          endDate={endDate}
          onChange={onDateChange}
          onClear={onDateClear}
        />
        <div className="ml-3 text-sm text-slate-500">All</div>
      </div>
      <div className="flex items-center gap-3 ml-4">
        <GroupMultiSelect
          options={[...groupOptions]}
          value={[...groupBy]}
          onChange={onGroupChange}
          placeholder="Group by"
          className="min-w-[280px]"
        />
      </div>
    </>
  );
}

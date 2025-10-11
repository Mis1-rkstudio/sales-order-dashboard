"use client";

import TokenSearchBar from "@/components/TokenSearchBar";

type SearchSectionProps = {
  tokens: string[];
  onAdd: (token: string) => void;
  onRemove: (token: string) => void;
  onClear: () => void;
};

export function SearchSection({
  tokens,
  onAdd,
  onRemove,
  onClear,
}: SearchSectionProps) {
  return (
    <div className="mb-4 md:mb-0 w-full flex-1 min-w-[420px]">
      <TokenSearchBar
        tokens={tokens}
        onAdd={onAdd}
        onRemove={onRemove}
        onClear={onClear}
      />
    </div>
  );
}

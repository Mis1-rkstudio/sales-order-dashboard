"use client";

import React from "react";
import type { SalesOrderRow } from "@/types/sales";

type Props = {
  row: SalesOrderRow;
  compositeKey: string;
  selectedColors: Record<string, string>;
  toggleSelectColorForRow: (row: SalesOrderRow, color: string) => void;
};

export default function StockCell({
  row,
  compositeKey,
  selectedColors,
  toggleSelectColorForRow,
}: Props) {
  const sbc = row.StockByColor;
  if (sbc && Object.keys(sbc).length > 0) {
    return (
      <div className="max-w-[280px] overflow-x-auto">
        <div className="flex items-center gap-1 whitespace-nowrap h-8">
          {Object.entries(sbc).map(([colorName, cs]) => {
            const isSelected =
              selectedColors[compositeKey] === colorName ||
              (row.New_Color === colorName && !selectedColors[compositeKey]);
            return (
              <button
                key={colorName}
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  toggleSelectColorForRow(row, colorName);
                }}
                className={`text-[11px] inline-flex items-center gap-1 px-2 py-1 rounded-full border ${
                  isSelected
                    ? "bg-emerald-100 text-emerald-800 border-emerald-200"
                    : "bg-slate-100 text-slate-800 border-slate-200"
                }`}
                style={{ flex: "0 0 auto" }}
                title={`${colorName}: ${cs}`}
              >
                <span className="hidden md:inline-block">{colorName}</span>
                <span className="font-medium ml-1">{cs}</span>
              </button>
            );
          })}
        </div>
      </div>
    );
  }
  if (typeof row.Stock === "number") {
    return row.Stock === 0 ? (
      <span className="text-slate-500">0</span>
    ) : (
      <>{String(row.Stock)}</>
    );
  }
  return <span className="text-slate-500">—</span>;
}

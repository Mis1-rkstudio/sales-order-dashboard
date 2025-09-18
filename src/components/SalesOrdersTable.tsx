// components/SalesOrdersTable.tsx
"use client";

import React, { JSX, useEffect, useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import FileThumbnail from "@/components/FileThumbnail";
import PaginationControls from "@/components/PaginationControls";

// row type
export type SalesOrderRow = {
  SO_Date?: string | null;
  SO_No?: string | null;
  Customer?: string | null;
  Customer_Type?: string | null;
  Rating?: string | null;
  Broker?: string | null;
  Item?: string | null;
  ItemCode?: string | null;
  Color?: string | null;
  Size?: string | null;
  OrderQty?: number | null;
  Expected_Date?: string | null;
  Status?: string | null;
  so_date_parsed?: string | null;
  Concept?: string | null;
  Fabric?: string | null;
  File_URL?: string | URL | null;

  Stock?: number | null;
  __uid?: string;
};

// helpers
function normItemKey(s?: string | null): string {
  if (!s) return "";
  return String(s)
    .replace(/\s*\[.*?\]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/**
 * Normalize a field for composite matching:
 * - coerce to string
 * - remove bracketed parts like " [Surat]"
 * - trim and uppercase
 *
 * This mirrors the server-side normalization (trim + upper; remove bracketed city tags)
 * so client keys match the server keys from /api/dispatch/keys.
 */
function normalizeFieldForKey(value?: string | null): string {
  const v = (value ?? "").toString();
  // remove bracketed parts anywhere in the string
  const stripped = v.replace(/\s*\[.*?\]/g, "");
  return stripped.trim().toUpperCase();
}

// composite dispatch key uses pipe delimiter and normalized values
function makeDispatchKey(
  so?: string | null,
  customer?: string | null,
  item?: string | null,
  color?: string | null
): string {
  return `${normalizeFieldForKey(so)}|${normalizeFieldForKey(
    customer
  )}|${normalizeFieldForKey(item)}|${normalizeFieldForKey(color)}`;
}

type Filters = {
  q: string;
  tokens: string[];
  brand: string;
  city: string;
  startDate: string;
  endDate: string;
  limit: number;

  // added filters for customer & item multi-selects
  customers?: string[];
  items?: string[];
};

type GroupKey = "Customer" | "Item" | "Color" | "Broker" | "Status";
const ALL_GROUP_KEYS: GroupKey[] = [
  "Customer",
  "Item",
  "Color",
  "Broker",
  "Status",
];

function formatCell(value: unknown): string | number {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") {
    const v = value.trim();
    if (v.length === 0) return "";
    if (v.toLowerCase() === "nan") return "";
    return v;
  }
  if (typeof value === "number") {
    if (Number.isNaN(value)) return "";
    return value;
  }
  return String(value);
}

export default function SalesOrdersTable({
  filters,
  groupBy,
}: {
  filters: Filters;
  groupBy?: string[];
}): JSX.Element {
  const [rows, setRows] = useState<SalesOrderRow[]>([]);
  const [page, setPage] = useState<number>(0);
  const [loading, setLoading] = useState<boolean>(false);
  const [total, setTotal] = useState<number>(0);
  const [collapsedGroups, setCollapsedGroups] = useState<
    Record<string, boolean>
  >({});
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [saving, setSaving] = useState<boolean>(false);

  // composite dispatched key set
  const [dispatchedSet, setDispatchedSet] = useState<Set<string>>(new Set());

  // reset page when filters change (include customers/items JSON to trigger when selection changes)
  useEffect(() => {
    setPage(0);
  }, [
    filters.q,
    JSON.stringify(filters.tokens),
    filters.brand,
    filters.city,
    filters.startDate,
    filters.endDate,
    JSON.stringify(groupBy),
    JSON.stringify(filters.customers ?? []),
    JSON.stringify(filters.items ?? []),
  ]);

  useEffect(() => {
    const abortCtrl = new AbortController();

    async function load() {
      setLoading(true);

      // 1) fetch composite dispatched keys from server
      try {
        const dispatchedRes = await fetch("/api/dispatch/keys", {
          signal: abortCtrl.signal,
        });
        if (dispatchedRes.ok) {
          const json = (await dispatchedRes.json()) as {
            keys?: string[];
          } | null;
          const keys = json?.keys ?? [];
          // keys are expected normalized server-side, but normalize again defensively
          setDispatchedSet(
            new Set(keys.map((k) => (k ?? "").toString().trim().toUpperCase()))
          );
        } else {
          // eslint-disable-next-line no-console
          console.warn(
            "Failed to load dispatched keys:",
            await dispatchedRes.text()
          );
          setDispatchedSet(new Set());
        }
      } catch (e) {
        if ((e as DOMException).name === "AbortError") {
          setLoading(false);
          return;
        }
        // eslint-disable-next-line no-console
        console.error("Error fetching dispatched keys", e);
        setDispatchedSet(new Set());
      }

      // 2) fetch sales orders
      const params = new URLSearchParams();
      params.set("limit", String(filters.limit));
      params.set("offset", String(page * filters.limit));
      if (filters.q) params.set("q", filters.q);
      if (filters.brand) params.set("brand", filters.brand);
      if (filters.city) params.set("city", filters.city);
      if (filters.startDate) params.set("startDate", filters.startDate);
      if (filters.endDate) params.set("endDate", filters.endDate);
      for (const t of filters.tokens) params.append("tokens", t);

      try {
        const res = await fetch(`/api/sales-orders?${params.toString()}`, {
          signal: abortCtrl.signal,
        });
        if (!res.ok) {
          console.error("fetch failed", await res.text());
          setRows([]);
          setTotal(0);
          setLoading(false);
          return;
        }

        const data = (await res.json()) as {
          rows: SalesOrderRow[];
          total: number;
        };
        const incoming = data.rows ?? [];

        // attach uid
        let rowsWithUid: SalesOrderRow[] = incoming.map((r, i) => {
          const so = r.SO_No ?? "";
          const item = (r.Item ?? "").replace(/\s+/g, "_");
          const color = (r.Color ?? "").replace(/\s+/g, "_");
          const uid = `${so}__${item}__${color}__${i}`;
          return { ...r, __uid: uid };
        });

        // FILTER by composite dispatched key (SO_No|Customer|Item|Color)
        if (dispatchedSet && dispatchedSet.size > 0) {
          rowsWithUid = rowsWithUid.filter((row) => {
            const k = makeDispatchKey(
              row.SO_No,
              row.Customer,
              row.Item,
              row.Color
            );
            return !dispatchedSet.has(k);
          });
        }

        // build item keys and fetch stock (keeps original logic)
        const keys = Array.from(
          new Set(
            rowsWithUid
              .map((r) => normItemKey(r.Item ?? r.ItemCode ?? null))
              .filter(Boolean)
          )
        );

        if (keys.length > 0) {
          try {
            const batchRes = await fetch("/api/stock/batch", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ items: keys }),
            });

            if (batchRes.ok) {
              const batchJson = (await batchRes.json()) as {
                rows: Array<{
                  Item?: string;
                  normalized_item?: string;
                  Closing_Stock?: number;
                }>;
              };
              const stockRows = batchJson.rows ?? [];
              const stockMap: Record<string, number> = {};
              for (const s of stockRows) {
                const n = (s.normalized_item ?? "")
                  .toString()
                  .trim()
                  .toLowerCase();
                const r = (s.Item ?? "").toString().trim().toLowerCase();
                const cs =
                  typeof s.Closing_Stock === "number"
                    ? s.Closing_Stock
                    : Number(s.Closing_Stock ?? NaN);
                if (!Number.isNaN(cs)) {
                  if (n) stockMap[n] = cs;
                  if (r) stockMap[r] = cs;
                }
              }
              for (let i = 0; i < rowsWithUid.length; i++) {
                const row = rowsWithUid[i];
                const key = normItemKey(row.Item ?? row.ItemCode ?? null);
                const found = key ? stockMap[key] ?? null : null;
                rowsWithUid[i] = { ...row, Stock: found };
              }
            } else {
              // eslint-disable-next-line no-console
              console.warn("stock/batch failed", await batchRes.text());
            }
          } catch (err) {
            // eslint-disable-next-line no-console
            console.error("stock batch request error", err);
          }
        }

        // sort (same as before)
        rowsWithUid.sort((a, b) => {
          const aQty = Number(a.OrderQty ?? 0);
          const bQty = Number(b.OrderQty ?? 0);
          if (bQty !== aQty) return bQty - aQty;

          const aStock =
            typeof a.Stock === "number" && !Number.isNaN(a.Stock)
              ? a.Stock
              : Number.NEGATIVE_INFINITY;
          const bStock =
            typeof b.Stock === "number" && !Number.isNaN(b.Stock)
              ? b.Stock
              : Number.NEGATIVE_INFINITY;
          if (bStock !== aStock) return bStock - aStock;

          const aDate = a.so_date_parsed
            ? Date.parse(a.so_date_parsed)
            : Number.POSITIVE_INFINITY;
          const bDate = b.so_date_parsed
            ? Date.parse(b.so_date_parsed)
            : Number.POSITIVE_INFINITY;
          return aDate - bDate;
        });

        // update UI
        // remove rows where Stock is exactly 0 or numeric NaN
        const filteredRows = rowsWithUid.filter((r) => {
          // keep rows with no numeric stock info (null/undefined)
          if (typeof r.Stock !== "number") return true;

          // filter OUT rows with Stock === 0 or Stock is numeric NaN
          if (r.Stock === 0) return false;
          if (Number.isNaN(r.Stock)) return false;

          return true;
        });

        // Now apply Customers/Items dropdown filtering (client-side)
        // Behavior: when either customers or items selection is non-empty,
        // only rows that match the selected customers/items are kept.
        const selectedCustomersSet = new Set(
          (filters.customers ?? []).map((c) => (c ?? "").toString().trim())
        );
        const selectedItemsSet = new Set(
          (filters.items ?? []).map((i) => (i ?? "").toString().trim())
        );

        const shouldFilterByCustomers = selectedCustomersSet.size > 0;
        const shouldFilterByItems = selectedItemsSet.size > 0;

        const finalRows = filteredRows.filter((r) => {
          const customerVal = (r.Customer ?? "").toString().trim();
          const itemVal = (r.Item ?? "").toString().trim();

          if (shouldFilterByCustomers) {
            if (!selectedCustomersSet.has(customerVal)) return false;
          }

          if (shouldFilterByItems) {
            if (!selectedItemsSet.has(itemVal)) return false;
          }

          return true;
        });

        // adjust total to reflect removed items on client (includes removed dispatched and zero/NaN-stock rows)
        const removedCount = Math.max(0, incoming.length - filteredRows.length);
        const extraRemovedCount = Math.max(0, filteredRows.length - finalRows.length);
        setRows(finalRows);
        setTotal(Math.max(0, (data.total ?? 0) - removedCount - extraRemovedCount));

        setCollapsedGroups({});
        setChecked({});
      } catch (e) {
        if ((e as DOMException).name === "AbortError") return;
        console.error(e);
      } finally {
        setLoading(false);
      }
    }

    load();
    return () => abortCtrl.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters, page]);

  const effectiveGroupKeys = useMemo(() => {
    if (!groupBy || groupBy.length === 0) return ["Customer"] as GroupKey[];
    const arr: GroupKey[] = [];
    for (const g of groupBy) {
      if (ALL_GROUP_KEYS.includes(g as GroupKey)) arr.push(g as GroupKey);
    }
    return arr.length ? arr : (["Customer"] as GroupKey[]);
  }, [groupBy]);

  const grouped = useMemo(() => {
    function parseDateToTs(value: unknown): number {
      if (value === null || value === undefined) return Infinity;
      const s = String(value).trim();
      if (!s) return Infinity;
      const iso = Date.parse(s);
      if (!Number.isNaN(iso)) return iso;
      const dmyMatch = s.match(/^(\d{2})[-\/](\d{2})[-\/](\d{4})$/);
      if (dmyMatch) {
        const isoLike = `${dmyMatch[3]}-${dmyMatch[2]}-${dmyMatch[1]}`;
        const t = Date.parse(isoLike);
        if (!Number.isNaN(t)) return t;
      }
      const loose = Date.parse(s.replace(/\./g, "-"));
      if (!Number.isNaN(loose)) return loose;
      return Infinity;
    }

    if (!effectiveGroupKeys || effectiveGroupKeys.length === 0) {
      const sum = rows.reduce((s, r) => s + (Number(r.OrderQty ?? 0) || 0), 0);
      const minTs = rows.reduce((min, r) => {
        const ts = parseDateToTs(r.so_date_parsed ?? r.SO_Date);
        return Math.min(min, ts);
      }, Infinity);
      return [
        {
          key: "__all__",
          labelParts: ["All"],
          rows,
          count: rows.length,
          sum,
          minTimestamp: minTs,
        },
      ];
    }

    const map = new Map<
      string,
      {
        key: string;
        labelParts: string[];
        rows: SalesOrderRow[];
        count: number;
        sum: number;
        minTimestamp: number;
      }
    >();

    for (const r of rows) {
      const parts = effectiveGroupKeys.map((k) => {
        const raw = (r as Record<string, unknown>)[k];
        const formatted = formatCell(raw);
        return formatted === "" ? "(empty)" : String(formatted);
      });
      const key = parts.join(" | ");
      const ts = parseDateToTs(r.so_date_parsed ?? r.SO_Date);
      const existing = map.get(key);
      if (existing) {
        existing.rows.push(r);
        existing.count += 1;
        existing.sum += Number(r.OrderQty ?? 0) || 0;
        existing.minTimestamp = Math.min(existing.minTimestamp, ts);
      } else {
        map.set(key, {
          key,
          labelParts: parts,
          rows: [r],
          count: 1,
          sum: Number(r.OrderQty ?? 0) || 0,
          minTimestamp: ts,
        });
      }
    }

    return Array.from(map.values()).sort((a, b) => {
      if (a.minTimestamp !== b.minTimestamp) return a.minTimestamp - b.minTimestamp;
      return a.key.localeCompare(b.key);
    });
  }, [rows, effectiveGroupKeys]);

  function toggleGroupCollapse(key: string) {
    setCollapsedGroups((s) => ({ ...s, [key]: !s[key] }));
  }
  function toggleRowCheckedByUid(uid: string) {
    setChecked((c) => ({ ...c, [uid]: !Boolean(c[uid]) }));
  }
  function renderCheckbox(uid: string) {
    return (
      <input
        type="checkbox"
        className="w-4 h-4"
        checked={Boolean(checked[uid])}
        onChange={(ev) => {
          ev.stopPropagation();
          setChecked((c) => ({ ...c, [uid]: !Boolean(c[uid]) }));
        }}
        aria-label={`Select ${uid}`}
      />
    );
  }

  const selectedCount = Object.values(checked).filter(Boolean).length;

  async function handleSaveDispatched() {
    const selectedUids = Object.keys(checked).filter((k) => checked[k]);
    if (selectedUids.length === 0) return;

    const selectedRows = rows
      .filter((r) => r.__uid && selectedUids.includes(r.__uid))
      .map((r) => ({
        SO_No: r.SO_No ?? "",
        Customer: r.Customer ?? null,
        Item: r.Item ?? null,
        Color: r.Color ?? null,
        Dispatched: true,
      }));

    if (selectedRows.length === 0) {
      // eslint-disable-next-line no-console
      console.warn("No valid rows selected for dispatch (missing SO_No?)");
      return;
    }

    setSaving(true);
    try {
      const res = await fetch("/api/dispatch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rows: selectedRows }),
      });
      if (!res.ok) {
        const txt = await res.text();
        // eslint-disable-next-line no-console
        console.error("Dispatch API error", txt);
        return;
      }

      // remove dispatched rows from UI
      const remaining = rows.filter(
        (r) => !(r.__uid && selectedUids.includes(r.__uid))
      );
      setRows(remaining);
      setChecked({});
      setTotal((t) => Math.max(0, t - selectedRows.length));

      // optimistic: add composite keys
      setDispatchedSet((s) => {
        const next = new Set(s);
        for (const sr of selectedRows) {
          const key = makeDispatchKey(
            sr.SO_No,
            sr.Customer ?? null,
            sr.Item ?? null,
            sr.Color ?? null
          );
          if (key) next.add(key);
        }
        return next;
      });
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error("Save dispatched failed", e);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card className="p-4">
      <div className="flex justify-between items-center mb-4">
        <div className="flex items-center gap-4">
          <div>
            <strong>Showing</strong> {rows.length} / {total}
          </div>
          <div>
            <small>{selectedCount} selected</small>
          </div>
        </div>

        <div>
          <Button
            onClick={handleSaveDispatched}
            disabled={selectedCount === 0 || saving}
            className={`px-4 py-2 rounded-md font-medium ${
              selectedCount > 0 && !saving
                ? "bg-indigo-600 text-white hover:bg-indigo-700"
                : "bg-slate-200 text-slate-600"
            }`}
          >
            {saving
              ? "Saving…"
              : `Save Dispatched${selectedCount ? ` (${selectedCount})` : ""}`}
          </Button>
        </div>
      </div>

      <div className="w-full overflow-x-auto">
        <div className="min-w-[1400px] space-y-4">
          {loading ? (
            <div className="py-8 text-center">Loading...</div>
          ) : grouped.length === 0 ? (
            <div className="py-8 text-center">No results</div>
          ) : (
            grouped.map((g) => {
              const isCollapsed = Boolean(collapsedGroups[g.key]);
              const label =
                g.labelParts
                  .map((p) => (p === "(empty)" ? "" : p))
                  .filter(Boolean)
                  .join(" • ") || "—";
              return (
                <div key={g.key} className="border rounded">
                  <div
                    className="flex items-center justify-between px-4 py-2 bg-slate-100 dark:bg-slate-800 cursor-pointer"
                    onClick={() => toggleGroupCollapse(g.key)}
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-6 h-6 flex items-center justify-center rounded border">
                        {isCollapsed ? "+" : "−"}
                      </div>

                      <div>
                        <div className="text-sm font-medium">{label}</div>
                        <div className="text-xs text-slate-500">
                          {g.count} rows — OrderQty sum: {g.sum}
                        </div>
                      </div>
                    </div>

                    <div className="text-sm text-slate-500">
                      Click to {isCollapsed ? "expand" : "collapse"}
                    </div>
                  </div>

                  {!isCollapsed && (
                    <table className="min-w-[1400px] w-full border-collapse table-auto">
                      <thead>
                        <tr className="text-left border-b">
                          <th className="py-2 pr-6 align-top min-w-[64px]">
                            Dispatched
                          </th>
                          <th className="py-2 pr-6 align-top min-w-[90px]">
                            SO No
                          </th>
                          <th className="py-2 pr-6 align-top min-w-[110px]">
                            SO Date
                          </th>
                          <th className="py-2 pr-6 align-top min-w-[260px] whitespace-normal break-words">
                            Customer
                          </th>
                          <th className="py-2 pr-6 align-top min-w-[140px] whitespace-normal break-words">
                            Customer Type
                          </th>
                          <th className="py-2 pr-6 align-top min-w-[90px] whitespace-normal break-words">
                            Rating
                          </th>
                          <th className="py-2 pr-6 align-top min-w-[120px] whitespace-normal break-words">
                            Broker
                          </th>
                          <th className="py-2 pr-6 align-top min-w-[140px] whitespace-normal break-words">
                            Item
                          </th>
                          <th className="py-2 pr-6 align-top min-w-[160px] whitespace-normal break-words">
                            Concept
                          </th>
                          <th className="py-2 pr-6 align-top min-w-[140px] whitespace-normal break-words">
                            Fabric
                          </th>
                          <th className="py-2 pr-6 align-top min-w-[110px] whitespace-normal break-words">
                            Color
                          </th>
                          <th className="py-2 pr-6 align-top min-w-[90px]">
                            Size
                          </th>
                          <th className="py-2 pr-6 align-top min-w-[90px]">
                            Order Qty
                          </th>
                          <th className="py-2 pr-6 align-top min-w-[90px]">
                            Stock
                          </th>
                          <th className="py-2 pr-6 align-top min-w-[110px]">
                            Status
                          </th>
                          <th className="py-2 pr-6 align-top min-w-[72px]">
                            File
                          </th>
                        </tr>
                      </thead>

                      <tbody>
                        {g.rows.map((r, idx) => {
                          const rowUid = r.__uid ?? `__idx_${idx}`;
                          return (
                            <tr
                              key={`${g.key}-${rowUid}-${idx}`}
                              className="border-b hover:bg-slate-50 cursor-pointer"
                              onClick={() => toggleRowCheckedByUid(rowUid)}
                            >
                              <td
                                className="py-2 pr-6 align-middle flex items-center justify-center"
                                onClick={(e) => e.stopPropagation()}
                              >
                                {renderCheckbox(rowUid)}
                              </td>

                              <td className="py-2 pr-6 align-top whitespace-nowrap">
                                {formatCell(r.SO_No)}
                              </td>
                              <td className="py-2 pr-6 align-top whitespace-nowrap">
                                {formatCell(r.SO_Date)}
                              </td>
                              <td className="py-2 pr-6 align-top">
                                {formatCell(r.Customer)}
                              </td>
                              <td className="py-2 pr-6 align-top">
                                {formatCell(r.Customer_Type)}
                              </td>
                              <td className="py-2 pr-6 align-top">
                                {formatCell(r.Rating)}
                              </td>
                              <td className="py-2 pr-6 align-top">
                                {formatCell(r.Broker)}
                              </td>
                              <td className="py-2 pr-6 align-top">
                                {formatCell(r.Item)}
                              </td>
                              <td className="py-2 pr-6 align-top">
                                {formatCell(r.Concept)}
                              </td>
                              <td className="py-2 pr-6 align-top">
                                {formatCell(r.Fabric)}
                              </td>
                              <td className="py-2 pr-6 align-top">
                                {formatCell(r.Color)}
                              </td>
                              <td className="py-2 pr-6 align-top whitespace-nowrap">
                                {formatCell(r.Size)}
                              </td>
                              <td className="py-2 pr-6 align-top whitespace-nowrap">
                                {formatCell(r.OrderQty)}
                              </td>
                              <td className="py-2 pr-6 align-top text-sm">
                                {typeof r.Stock === "number" ? (
                                  r.Stock === 0 ? (
                                    <span className="text-slate-500">0</span>
                                  ) : (
                                    String(r.Stock)
                                  )
                                ) : (
                                  <span className="text-slate-500">—</span>
                                )}
                              </td>
                              <td className="py-2 pr-6 align-top">
                                {formatCell(r.Status)}
                              </td>
                              <td
                                onClick={(e) => e.stopPropagation()}
                                className="py-2 pr-6 align-top"
                              >
                                {r.File_URL ? (
                                  <button
                                    type="button"
                                    className="p-0"
                                    aria-label={`Open file for ${
                                      r.SO_No ?? ""
                                    }`}
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      const url = r.File_URL;
                                      if (!url) return; // narrows type to string
                                      const newWin = window.open(
                                        url,
                                        "_blank",
                                        "noopener,noreferrer"
                                      );
                                      if (newWin) newWin.opener = null;
                                    }}
                                  >
                                    <FileThumbnail
                                      url={r.File_URL}
                                      alt={`File ${r.SO_No ?? ""}`}
                                      className="w-12 h-12 object-contain"
                                      link={false}
                                    />
                                  </button>
                                ) : (
                                  <span className="text-slate-400">—</span>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>

      <div className="mt-4">
        <PaginationControls
          page={page}
          setPage={setPage}
          total={total}
          limit={filters.limit}
          onSaveDispatched={handleSaveDispatched}
          saving={saving}
          selectedCount={selectedCount}
          disabled={loading}
          showSave={false}
        />
      </div>
    </Card>
  );
}
  
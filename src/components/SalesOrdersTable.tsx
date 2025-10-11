"use client";

import React, { JSX, useCallback, useEffect, useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
// badge imported previously but table uses inline spans for status
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import FileThumbnail from "@/components/FileThumbnail";
import PaginationControls from "@/components/PaginationControls";
import { CancelOrderDialog } from "@/components/CancelOrderDialog";
import StockCell from "./StockCell";
import RowActions from "./RowActions";
import { useSalesOrders } from "@/hooks/useSalesOrders";
import type { SalesOrderRow, Filters, GroupKey } from "@/types/sales";
import { ALL_GROUP_KEYS } from "@/types/sales";

/* ---------- helpers ---------- */

function normItemKey(s?: string | null): string {
  if (!s) return "";
  return String(s)
    .replace(/\s*\[.*?\]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function normalizeFieldForKey(value?: string | null): string {
  const v = (value ?? "").toString();
  const stripped = v.replace(/\s*\[.*?\]/g, "");
  return stripped.trim().toUpperCase();
}

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

function uidForRow(
  so: string | undefined | null,
  item: string | undefined | null,
  color: string | undefined | null,
  idx: number
): string {
  const base = `${String(so ?? "").trim()}__${String(
    item ?? ""
  ).trim()}__${String(color ?? "").trim()}`;
  if (typeof globalThis?.crypto?.randomUUID === "function") {
    return `${base || "uid"}__${globalThis.crypto.randomUUID()}`;
  }
  return `${base || "uid"}__${idx}`;
}

/**
 * Determine whether an unknown value contains a timestamp-like value.
 * Works with string, object shapes (Firestore / protobuf-like), etc.
 */
function verifyHasTimestamp(v: unknown): boolean {
  if (v == null) return false;
  if (typeof v === "string") return v.trim().length > 0;
  if (typeof v === "object") {
    try {
      const obj = v as Record<string, unknown>;
      const maybeValue = obj["value"];
      if (typeof maybeValue === "string") return maybeValue.trim().length > 0;
      const seconds = obj["seconds"];
      if (seconds !== undefined && seconds !== null) return true;
      return Object.keys(obj).length > 0;
    } catch {
      return true;
    }
  }
  return true;
}

/* ---------- normalize helpers used for invoice match ---------- */

function normalizeCustomerForCompare(s?: string | null): string {
  return (s ?? "")
    .toString()
    .replace(/\s*\[.*?\]/g, "")
    .trim()
    .toLowerCase();
}
function normalizeItemForCompare(s?: string | null): string {
  return (s ?? "").toString().trim().toLowerCase();
}
function normalizeColorForCompare(s?: string | null): string {
  return (s ?? "").toString().trim().toLowerCase();
}

/* ---------- component ---------- */

export default function SalesOrdersTable({
  filters,
  groupBy,
}: {
  filters: Filters;
  groupBy?: GroupKey[];
}): JSX.Element {
  const {
    rows,
    setRows,
    page,
    setPage,
    loading,
    total,
    refreshKey,
    invoiceMap,
    setInvoiceMap,
    setLoading,
    setTotal,
  } = useSalesOrders(filters, groupBy);
  const [collapsedGroups, setCollapsedGroups] = useState<
    Record<string, boolean>
  >({});
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [saving, setSaving] = useState<boolean>(false);
  const [verifying, setVerifying] = useState<boolean>(false);

  const [, setDispatchedSet] = useState<Set<string>>(new Set());
  const [, setPendingSet] = useState<Set<string>>(new Set());
  const [pendingMap, setPendingMap] = useState<Record<string, SalesOrderRow>>(
    {}
  );

  // invoice lookup: normalized key -> latest parsed_date (ISO) and daysAgo
  // selection state for replacement color per composite key
  const [selectedColors, setSelectedColors] = useState<Record<string, string>>(
    {}
  );
  // per-row production quantity keyed by row __uid
  const [productionQtyByUid, setProductionQtyByUid] = useState<
    Record<string, number | null>
  >({});
  const [cancelDialogOrder, setCancelDialogOrder] =
    useState<SalesOrderRow | null>(null);

  // Function to handle order cancellation
  const handleCancelOrder = async (order: SalesOrderRow) => {
    if (!order.SO_No) return;

    try {
      const response = await fetch("/api/sales-orders/cancel", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ orderNo: order.SO_No }),
      });

      if (!response.ok) throw new Error("Failed to cancel order");

      // Update local state
      setRows((currentRows) =>
        currentRows.map((row) =>
          row.SO_No === order.SO_No ? { ...row, Status: "Cancelled" } : row
        )
      );

      // Close dialog
      setCancelDialogOrder(null);
    } catch (error) {
      console.error("Error cancelling order:", error);
      // You might want to show an error message to the user here
    }
  };

  useEffect(() => {
    let channel: BroadcastChannel | null = null;
    let handleWindowEvent: ((ev: Event) => void) | null = null;

    try {
      if (typeof BroadcastChannel !== "undefined") {
        channel = new BroadcastChannel("sales-orders");
        channel.addEventListener("message", (ev: MessageEvent) => {
          const data = ev.data as
            | { type?: string; row?: Record<string, unknown> }
            | undefined;
          if (!data || data.type !== "verified:confirmed" || !data.row) return;

          const incoming = data.row as Record<string, unknown>;
          const soNo = String(incoming.SO_No ?? "");
          const customer = String(incoming.Customer ?? "");
          const item = String(incoming.Item ?? "");
          const color = String(incoming.Color ?? "");
          const key = makeDispatchKey(
            soNo,
            customer,
            item,
            color
          ).toUpperCase();

          setPendingSet((s) => {
            const next = new Set(s);
            next.delete(key);
            return next;
          });
          setPendingMap((pm) => {
            const next = { ...pm };
            delete next[key];
            return next;
          });

          // build a strongly-typed SalesOrderRow from unknown incoming record
          const rawSize = incoming.Size;
          const sizeValue: string | number | undefined =
            rawSize === undefined || rawSize === null
              ? undefined
              : typeof rawSize === "number"
              ? rawSize
              : String(rawSize);

          const rawOrderQty = incoming.OrderQty;
          const orderQtyValue: number | undefined =
            rawOrderQty === undefined || rawOrderQty === null
              ? undefined
              : (() => {
                  const n = Number(rawOrderQty as unknown);
                  return Number.isFinite(n) ? n : undefined;
                })();

          const newRow: SalesOrderRow = {
            SO_No: incoming.SO_No ? String(incoming.SO_No) : soNo,
            Customer: incoming.Customer ? String(incoming.Customer) : customer,
            Item: incoming.Item ? String(incoming.Item) : item,
            Color: incoming.Color ? String(incoming.Color) : color,
            New_Color:
              incoming.New_Color !== undefined && incoming.New_Color !== null
                ? String(incoming.New_Color)
                : undefined,
            Size: sizeValue,
            OrderQty: orderQtyValue,
            SO_Date:
              incoming.SO_Date !== undefined && incoming.SO_Date !== null
                ? String(incoming.SO_Date)
                : undefined,
          };

          setRows((prev) => {
            const exists = prev.some((r) => {
              const rk = makeDispatchKey(
                r.SO_No,
                r.Customer,
                r.Item,
                r.Color
              ).toUpperCase();
              return rk === key;
            });
            if (exists) return prev;

            const uid = uidForRow(
              newRow.SO_No,
              newRow.Item ?? newRow.ItemCode,
              newRow.Color,
              Date.now()
            );
            const withUid = { ...newRow, __uid: uid };
            return [withUid, ...prev];
          });

          if (incoming.New_Color) {
            setSelectedColors((prev) => ({
              ...prev,
              [key]: String(incoming.New_Color),
            }));
          }
        });
      } else {
        handleWindowEvent = (ev: Event) => {
          const detail = (ev as CustomEvent).detail as
            | Record<string, unknown>
            | undefined;
          if (!detail) return;
          const data = { type: "verified:confirmed", row: detail };
          const incoming = data.row;
          if (data.type !== "verified:confirmed" || !incoming) return;
          const soNo = String(incoming.SO_No ?? "");
          const customer = String(incoming.Customer ?? "");
          const item = String(incoming.Item ?? "");
          const color = String(incoming.Color ?? "");
          const key = makeDispatchKey(
            soNo,
            customer,
            item,
            color
          ).toUpperCase();

          setPendingSet((s) => {
            const next = new Set(s);
            next.delete(key);
            return next;
          });
          setPendingMap((pm) => {
            const next = { ...pm };
            delete next[key];
            return next;
          });

          const rawSize = incoming.Size;
          const sizeValue: string | number | undefined =
            rawSize === undefined || rawSize === null
              ? undefined
              : typeof rawSize === "number"
              ? rawSize
              : String(rawSize);

          const rawOrderQty = incoming.OrderQty;
          const orderQtyValue: number | undefined =
            rawOrderQty === undefined || rawOrderQty === null
              ? undefined
              : (() => {
                  const n = Number(rawOrderQty as unknown);
                  return Number.isFinite(n) ? n : undefined;
                })();

          const newRow: SalesOrderRow = {
            SO_No: incoming.SO_No ? String(incoming.SO_No) : soNo,
            Customer: incoming.Customer ? String(incoming.Customer) : customer,
            Item: incoming.Item ? String(incoming.Item) : item,
            Color: incoming.Color ? String(incoming.Color) : color,
            New_Color:
              incoming.New_Color !== undefined && incoming.New_Color !== null
                ? String(incoming.New_Color)
                : undefined,
            Size: sizeValue,
            OrderQty: orderQtyValue,
            SO_Date:
              incoming.SO_Date !== undefined && incoming.SO_Date !== null
                ? String(incoming.SO_Date)
                : undefined,
          };

          setRows((prev) => {
            const exists = prev.some((r) => {
              const rk = makeDispatchKey(
                r.SO_No,
                r.Customer,
                r.Item,
                r.Color
              ).toUpperCase();
              return rk === key;
            });
            if (exists) return prev;
            const uid = uidForRow(
              newRow.SO_No,
              newRow.Item ?? newRow.ItemCode,
              newRow.Color,
              Date.now()
            );
            const withUid = { ...newRow, __uid: uid };
            return [withUid, ...prev];
          });

          if (incoming.New_Color) {
            setSelectedColors((prev) => ({
              ...prev,
              [key]: String(incoming.New_Color),
            }));
          }
        };

        window.addEventListener(
          "sales-orders:verified:confirmed",
          handleWindowEvent
        );
      }
    } catch (err) {
      console.warn("Failed to setup BroadcastChannel listener", err);
    }

    return () => {
      try {
        if (channel) channel.close();
        if (handleWindowEvent)
          window.removeEventListener(
            "sales-orders:verified:confirmed",
            handleWindowEvent
          );
      } catch {}
    };
    // include stable setters used inside effect
  }, [setRows, setSelectedColors, setPendingSet, setPendingMap]);

  // stable JSON keys for complex deps used by effects
  const tokensKey = JSON.stringify(filters.tokens);
  const customersKey = JSON.stringify(filters.customers ?? []);
  const itemsKey = JSON.stringify(filters.items ?? []);
  const groupByKey = JSON.stringify(groupBy ?? []);

  useEffect(() => {
    setPage(0);
  }, [
    filters.q,
    tokensKey,
    filters.brand,
    filters.city,
    filters.startDate,
    filters.endDate,
    groupByKey,
    customersKey,
    itemsKey,
    setPage,
  ]);

  useEffect(() => {
    const abortCtrl = new AbortController();

    async function load(): Promise<void> {
      setLoading(true);

      let localDispatchedSet = new Set<string>();
      let localPendingSet = new Set<string>();
      let localVerifiedSet = new Set<string>();

      try {
        const dispatchedRes = await fetch("/api/dispatch/keys", {
          signal: abortCtrl.signal,
        });
        if (dispatchedRes.ok) {
          const json = (await dispatchedRes.json()) as {
            keys?: string[];
          } | null;
          const keys = json?.keys ?? [];
          localDispatchedSet = new Set(
            keys.map((k) => (k ?? "").toString().trim().toUpperCase())
          );
        } else {
          localDispatchedSet = new Set();
        }
      } catch (e: unknown) {
        if (e instanceof DOMException && e.name === "AbortError") {
          setLoading(false);
          return;
        }
        localDispatchedSet = new Set();
      }
      setDispatchedSet(localDispatchedSet);

      let verifyMap: Record<string, Record<string, unknown>> = {};
      try {
        const res = await fetch("/api/verify", { signal: abortCtrl.signal });
        if (res.ok) {
          const data = (await res.json()) as {
            rows?: Array<Record<string, unknown>>;
          } | null;
          const vrows = data?.rows ?? [];
          verifyMap = {};
          for (const r of vrows) {
            const key = makeDispatchKey(
              (r.SO_No as string) ?? null,
              (r.Customer as string) ?? null,
              (r.Item as string) ?? null,
              (r.Color as string) ?? null
            ).toUpperCase();

            verifyMap[key] = r;
            const v = (r as Record<string, unknown>)["verified_at"];
            const hasTs = verifyHasTimestamp(v);
            if (hasTs) {
              localVerifiedSet.add(key);
            } else {
              localPendingSet.add(key);
            }
          }
        } else {
          localPendingSet = new Set();
          localVerifiedSet = new Set();
        }
      } catch (e: unknown) {
        if (e instanceof DOMException && e.name === "AbortError") {
          setLoading(false);
          return;
        }
        localPendingSet = new Set();
        localVerifiedSet = new Set();
      }
      setPendingSet(localPendingSet);

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
        const incoming = Array.isArray(data.rows) ? data.rows : [];

        const serverTotal = Number.isFinite(Number(data.total))
          ? Number(data.total)
          : incoming.length;
        if (incoming.length === 0 && serverTotal > 0 && page > 0) {
          setPage(0);
          setLoading(false);
          return;
        }

        let rowsWithUid: SalesOrderRow[] = incoming.map((r, i) => {
          const uid = uidForRow(r.SO_No, r.Item ?? r.ItemCode, r.Color, i);
          const key = makeDispatchKey(
            r.SO_No,
            r.Customer,
            r.Item,
            r.Color
          ).toUpperCase();
          const isPending = localPendingSet.has(key);
          const verifyRec = verifyMap[key];
          const newColorFromServer =
            verifyRec && verifyRec.New_Color
              ? String(verifyRec.New_Color)
              : undefined;

          if (newColorFromServer) {
            // pre-select server replacement color so UI shows pill
            setSelectedColors((prev) => {
              if (prev[key] === newColorFromServer) return prev;
              return { ...prev, [key]: newColorFromServer };
            });
          }

          return {
            ...r,
            __uid: uid,
            __pending: isPending,
            New_Color: (r.New_Color ?? newColorFromServer) as
              | string
              | undefined,
            StockByColor: null,
          };
        });

        if (localDispatchedSet.size > 0) {
          rowsWithUid = rowsWithUid.filter((row) => {
            const k = makeDispatchKey(
              row.SO_No,
              row.Customer,
              row.Item,
              row.Color
            ).toUpperCase();
            return !localDispatchedSet.has(k);
          });
        }

        if (localPendingSet.size > 0) {
          rowsWithUid = rowsWithUid.filter((row) => {
            const k = makeDispatchKey(
              row.SO_No,
              row.Customer,
              row.Item,
              row.Color
            ).toUpperCase();
            return !localPendingSet.has(k);
          });
        }

        const originPendingKeys = new Set(
          Object.keys(pendingMap).map((k) => k.toUpperCase())
        );
        if (originPendingKeys.size > 0) {
          rowsWithUid = rowsWithUid.filter((row) => {
            const k = makeDispatchKey(
              row.SO_No,
              row.Customer,
              row.Item,
              row.Color
            ).toUpperCase();
            return !originPendingKeys.has(k);
          });
        }

        // --- NEW: fetch invoice-details earlier so we can filter rows by SO_Date vs invoice date ---
        let finalInvMap: Record<string, { dateIso: string; daysAgo: number }> =
          {};
        try {
          const invRes = await fetch("/api/invoice-details?limit=1000", {
            signal: abortCtrl.signal,
          });
          if (invRes.ok) {
            const invJson = (await invRes.json()) as {
              rows?: Array<Record<string, unknown>>;
            } | null;
            const invRows = invJson?.rows ?? [];

            const invMapRaw: Record<string, string> = {};
            for (const inv of invRows) {
              const custName = (
                inv["Customer_Name"] ??
                inv["Customer"] ??
                ""
              ).toString();
              const itemCode = (
                inv["Item_Code"] ??
                inv["Item"] ??
                ""
              ).toString();
              const color = (
                inv["Item_Color"] ??
                inv["Color"] ??
                ""
              ).toString();

              const cNorm = normalizeCustomerForCompare(custName);
              const iNorm = normalizeItemForCompare(itemCode);
              const colNorm = normalizeColorForCompare(color);
              if (!cNorm || !iNorm) continue;

              const dateStrCandidate =
                (inv["parsed_date"] as string | undefined) ??
                (inv["parsed_date_iso"] as string | undefined) ??
                (inv["Date"] as string | undefined) ??
                (inv["date"] as string | undefined);

              if (!dateStrCandidate) continue;

              // parse to ISO yyyy-mm-dd
              const tryParseIso = (ds: string): string | null => {
                const p = Date.parse(ds);
                if (!Number.isNaN(p)) {
                  return new Date(p).toISOString().slice(0, 10);
                }
                const m = ds.match(/^(\d{2})[-\/](\d{2})[-\/](\d{4})$/);
                if (m) {
                  const isoLike = `${m[3]}-${m[2]}-${m[1]}`;
                  const p2 = Date.parse(isoLike);
                  if (!Number.isNaN(p2))
                    return new Date(p2).toISOString().slice(0, 10);
                }
                const loose = Date.parse(ds.replace(/\./g, "-"));
                if (!Number.isNaN(loose))
                  return new Date(loose).toISOString().slice(0, 10);
                return null;
              };

              const iso = tryParseIso(dateStrCandidate);
              if (!iso) continue;
              const key = `${cNorm}|${iNorm}|${colNorm}`;
              const prev = invMapRaw[key];
              if (!prev || iso > prev) invMapRaw[key] = iso;
            }

            // convert to finalInvMap with daysAgo
            const now = Date.now();
            for (const [k, iso] of Object.entries(invMapRaw)) {
              const t = Date.parse(iso);
              if (Number.isNaN(t)) continue;
              const daysAgo = Math.floor((now - t) / (1000 * 60 * 60 * 24));
              finalInvMap[k] = { dateIso: iso, daysAgo };
            }
          } else {
            finalInvMap = {};
          }
        } catch (err) {
          if (!(err instanceof DOMException && err.name === "AbortError")) {
            console.warn("invoice-details fetch failed", err);
          }
          finalInvMap = {};
        }

        // filter rowsWithUid using invoice logic:
        // if soDate < invoiceDate => HIDE the SO row
        // if soDate >= invoiceDate => KEEP (pill will be shown via invoiceMap)
        const tryParseToIso = (ds?: string | null): string | null => {
          if (!ds) return null;
          const s = String(ds).trim();
          if (!s) return null;
          const p = Date.parse(s);
          if (!Number.isNaN(p)) return new Date(p).toISOString().slice(0, 10);
          const m = s.match(/^(\d{2})[-\/](\d{2})[-\/](\d{4})$/);
          if (m) {
            const isoLike = `${m[3]}-${m[2]}-${m[1]}`;
            const p2 = Date.parse(isoLike);
            if (!Number.isNaN(p2))
              return new Date(p2).toISOString().slice(0, 10);
          }
          const loose = Date.parse(s.replace(/\./g, "-"));
          if (!Number.isNaN(loose))
            return new Date(loose).toISOString().slice(0, 10);
          return null;
        };

        rowsWithUid = rowsWithUid.filter((r) => {
          const cust = r.Customer ?? "";
          const item = r.Item ?? r.ItemCode ?? "";
          const color = r.Color ?? "";
          const invKey = `${normalizeCustomerForCompare(
            cust
          )}|${normalizeItemForCompare(item)}|${normalizeColorForCompare(
            color
          )}`;
          const invRec = finalInvMap[invKey];
          if (!invRec) {
            // no invoice match -> keep row
            return true;
          }
          const soIso = tryParseToIso(r.SO_Date ?? r.so_date_parsed ?? "");
          if (!soIso) {
            // cannot parse SO date -> keep row
            return true;
          }
          // keep row only if SO_Date >= invoiceDate
          return soIso >= invRec.dateIso;
        });

        // set invoice state (so UI shows pill)
        setInvoiceMap(finalInvMap);

        // --- continue: compute keys for stock based on filtered rowsWithUid ---
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
                  Color?: string;
                  Closing_Stock?: number | string;
                }>;
              };
              const stockRows = batchJson.rows ?? [];

              const totalStockMap: Record<string, number> = {};
              const colorStockMap: Record<string, Record<string, number>> = {};

              for (const s of stockRows) {
                const norm = (s.normalized_item ?? s.Item ?? "")
                  .toString()
                  .trim()
                  .toLowerCase();
                if (!norm) continue;
                const color = (s.Color ?? "").toString().trim();
                const cs =
                  typeof s.Closing_Stock === "number"
                    ? s.Closing_Stock
                    : Number(s.Closing_Stock ?? NaN);
                if (Number.isNaN(cs)) continue;

                if (!colorStockMap[norm]) colorStockMap[norm] = {};
                colorStockMap[norm][color] =
                  (colorStockMap[norm][color] || 0) + cs;

                totalStockMap[norm] = (totalStockMap[norm] || 0) + cs;
              }

              for (let i = 0; i < rowsWithUid.length; i++) {
                const row = rowsWithUid[i];
                const key = normItemKey(row.Item ?? row.ItemCode ?? null);
                const foundTotal = key ? totalStockMap[key] ?? null : null;
                const foundColorMap = key ? colorStockMap[key] ?? null : null;
                rowsWithUid[i] = {
                  ...row,
                  Stock: foundTotal,
                  StockByColor: foundColorMap ?? null,
                };
              }
            } else {
              console.warn("stock/batch failed", await batchRes.text());
            }
          } catch (err: unknown) {
            console.error("stock batch request error", err);
          }
        }

        // --- sorting & extra filtering (unchanged) ---
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

        const filteredRows = rowsWithUid.filter((r) => {
          if (typeof r.Stock !== "number") return true;
          if (r.Stock === 0) return false;
          if (Number.isNaN(r.Stock)) return false;
          return true;
        });

        const normalizeCustomerForCompareLocal = (s?: string | null) =>
          (s ?? "")
            .toString()
            .replace(/\s*\[.*?\]/g, "")
            .trim()
            .toLowerCase();
        const normalizeItemForCompareLocal = (s?: string | null) =>
          (s ?? "").toString().trim().toLowerCase();

        const selectedCustomersSet = new Set(
          (filters.customers ?? []).map((c) =>
            normalizeCustomerForCompareLocal(c)
          )
        );
        const selectedItemsSet = new Set(
          (filters.items ?? []).map((i) => normalizeItemForCompareLocal(i))
        );

        const shouldFilterByCustomers = selectedCustomersSet.size > 0;
        const shouldFilterByItems = selectedItemsSet.size > 0;

        const finalRows = filteredRows.filter((r) => {
          const customerNorm = normalizeCustomerForCompareLocal(r.Customer);
          const itemNorm = normalizeItemForCompareLocal(r.Item);

          if (
            shouldFilterByCustomers &&
            !selectedCustomersSet.has(customerNorm)
          )
            return false;
          if (shouldFilterByItems && !selectedItemsSet.has(itemNorm))
            return false;
          return true;
        });

        // compute totals accounting for removed rows
        const removedCount = Math.max(0, incoming.length - finalRows.length);
        const computedTotal = Number.isFinite(serverTotal)
          ? Math.max(0, serverTotal - removedCount)
          : finalRows.length;

        setRows(finalRows);
        setTotal(computedTotal);

        setCollapsedGroups({});
        setChecked({});
      } catch (e: unknown) {
        if (e instanceof DOMException && e.name === "AbortError") return;
        console.error(e);
      } finally {
        setLoading(false);
      }
    }

    load();
    return () => abortCtrl.abort();
    // include refreshKey so callers can trigger reloads
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters, page, refreshKey, pendingMap]);

  /* ---------- grouping ---------- */

  const effectiveGroupKeys = useMemo<GroupKey[]>(() => {
    if (!groupBy || groupBy.length === 0) return ["Customer"];
    const arr: GroupKey[] = [];
    for (const g of groupBy) {
      if (ALL_GROUP_KEYS.includes(g)) arr.push(g);
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
      const minTs = rows.reduce(
        (min, r) => Math.min(min, parseDateToTs(r.so_date_parsed ?? r.SO_Date)),
        Infinity
      );
      // also sort the flat rows by date (old first) for consistency
      const flatSorted = [...rows].sort((a, b) => {
        const ta = parseDateToTs(a.so_date_parsed ?? a.SO_Date);
        const tb = parseDateToTs(b.so_date_parsed ?? b.SO_Date);
        if (ta !== tb) return ta - tb;
        const sa = String(a.SO_No ?? "");
        const sb = String(b.SO_No ?? "");
        return sa.localeCompare(sb);
      });
      return [
        {
          key: "__all__",
          labelParts: ["All"],
          rows: flatSorted,
          count: flatSorted.length,
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

    // *** NEW: sort rows inside each group by SO date (old first),
    // tie-break deterministically by SO_No (ascending)
    for (const grp of map.values()) {
      grp.rows.sort((a, b) => {
        const ta = parseDateToTs(a.so_date_parsed ?? a.SO_Date);
        const tb = parseDateToTs(b.so_date_parsed ?? b.SO_Date);
        if (ta !== tb) return ta - tb;
        const sa = String(a.SO_No ?? "");
        const sb = String(b.SO_No ?? "");
        return sa.localeCompare(sb);
      });
    }

    return Array.from(map.values()).sort((a, b) => {
      if (a.minTimestamp !== b.minTimestamp)
        return a.minTimestamp - b.minTimestamp;
      return a.key.localeCompare(b.key);
    });
  }, [rows, effectiveGroupKeys]);

  /* ---------- UI helpers ---------- */

  const toggleGroupCollapse = useCallback((key: string) => {
    setCollapsedGroups((s) => ({ ...s, [key]: !s[key] }));
  }, []);

  const toggleRowCheckedByUid = useCallback((uid: string) => {
    setChecked((c) => ({ ...c, [uid]: !Boolean(c[uid]) }));
  }, []);

  const renderCheckbox = useCallback(
    (uid: string) => {
      return (
        <Checkbox
          checked={Boolean(checked[uid])}
          aria-label={`Select ${uid}`}
          onCheckedChange={(v: boolean | "indeterminate" | undefined) => {
            setChecked((c) => ({ ...c, [uid]: Boolean(v) }));
          }}
        />
      );
    },
    [checked]
  );

  const selectedCount = useMemo(
    () => Object.values(checked).filter(Boolean).length,
    [checked]
  );

  // map normalized item -> set of SO numbers where it appears
  const itemToSOs = useMemo(() => {
    const m = new Map<string, Set<string>>();
    for (const r of rows) {
      const key = normItemKey(r.Item ?? r.ItemCode ?? null);
      if (!key) continue;
      const so = (r.SO_No ?? "").toString().trim();
      if (!so) continue;
      const s = m.get(key) ?? new Set<string>();
      s.add(so);
      m.set(key, s);
    }
    return m;
  }, [rows]);

  const rowKeyFrom = (r: SalesOrderRow) =>
    makeDispatchKey(r.SO_No, r.Customer, r.Item, r.Color).toUpperCase();

  const toggleSelectColorForRow = useCallback(
    (row: SalesOrderRow, color: string) => {
      const key = rowKeyFrom(row);
      setSelectedColors((prev) => {
        const cur = prev[key];
        if (cur === color) {
          const next = { ...prev };
          delete next[key];
          return next;
        }
        return { ...prev, [key]: color };
      });
    },
    []
  );

  /* ---------- actions: verify & confirm (unchanged except New_Color inclusion) ---------- */

  const handleVerifySelected = useCallback(async (): Promise<void> => {
    // shape we send to /api/verify
    type OutgoingRow = {
      SO_No: string;
      Customer: string | null;
      Item: string | null;
      Color: string | null;
      New_Color: string | null;
      Size: string | null;
      OrderQty: number | null;
      SO_Date: string | null;
    };

    const selectedUids = new Set(
      Object.keys(checked).filter((k) => checked[k])
    );

    // Build array with possible nulls
    const maybeRows = rows.map((r) => {
      const uid = r.__uid ?? "";
      const key = makeDispatchKey(
        r.SO_No,
        r.Customer,
        r.Item,
        r.Color
      ).toUpperCase();
      const hasSelectedColor = Boolean(selectedColors[key]);
      const isChecked = selectedUids.has(uid);

      if (!isChecked && !hasSelectedColor) return null;

      const out: OutgoingRow = {
        SO_No: String(r.SO_No ?? ""),
        Customer: r.Customer ?? null,
        Item: r.Item ?? null,
        Color: r.Color ?? null,
        New_Color: (selectedColors[key] ?? r.New_Color ?? null) as
          | string
          | null,
        Size: r.Size == null ? null : String(r.Size),
        OrderQty:
          typeof r.OrderQty === "number"
            ? r.OrderQty
            : r.OrderQty == null
            ? null
            : Number(r.OrderQty) || null,
        SO_Date: r.SO_Date ?? null,
      };

      return out;
    });

    // Type guard to narrow away nulls
    const rowsToSend = maybeRows.filter(
      (v): v is OutgoingRow => v !== null && v !== undefined
    );

    if (rowsToSend.length === 0) return;

    setVerifying(true);
    try {
      const res = await fetch("/api/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "request", rows: rowsToSend }),
      });

      if (!res.ok) {
        const txt = await res.text();
        console.error("Verify (request) API error", txt);
        return;
      }

      // now rowsToSend is properly typed (no `null`s) so TypeScript knows `sr` isn't null
      const keysToAdd: string[] = rowsToSend.map((sr) =>
        makeDispatchKey(
          sr.SO_No ?? "",
          sr.Customer ?? null,
          sr.Item ?? null,
          sr.Color ?? null
        ).toUpperCase()
      );

      // update pendingMap using keysToAdd (use safe lookups)
      setPendingMap((pm) => {
        const next = { ...pm };
        for (const key of keysToAdd) {
          const original = rows.find((r) => {
            const k = makeDispatchKey(
              r.SO_No,
              r.Customer,
              r.Item,
              r.Color
            ).toUpperCase();
            return k === key;
          });
          if (!original) continue;
          // strip verified_at if present
          const { verified_at: _dropVerifiedAt, ...rest } = original as Record<
            string,
            unknown
          >;
          // _dropVerifiedAt intentionally unused; reference to avoid lint
          void _dropVerifiedAt;
          next[key] = rest as SalesOrderRow;
        }
        return next;
      });

      setPendingSet((s) => {
        const next = new Set(s);
        for (const k of keysToAdd) next.add(k);
        return next;
      });

      setRows((prev) =>
        prev.filter((r) => {
          const k = makeDispatchKey(
            r.SO_No,
            r.Customer,
            r.Item,
            r.Color
          ).toUpperCase();
          return !keysToAdd.includes(k);
        })
      );

      setSelectedColors((prev) => {
        const next = { ...prev };
        for (const k of keysToAdd) {
          if (k in next) delete next[k];
        }
        return next;
      });

      setChecked({});
      setTotal((t) => Math.max(0, t - rowsToSend.length));
    } catch (e: unknown) {
      console.error("Verify (request) API failed", e);
    } finally {
      setVerifying(false);
    }
  }, [checked, rows, selectedColors, setRows, setTotal]);

  /* ---------- UPDATED: Save Dispatched (sends New_Color / replaces color) ---------- */

  const handleSaveDispatched = useCallback(async (): Promise<void> => {
    const selectedUids = Object.keys(checked).filter((k) => checked[k]);
    if (selectedUids.length === 0) return;

    const selectedRows = rows
      .filter((r) => r.__uid && selectedUids.includes(r.__uid))
      .map((r) => {
        const compositeKey = makeDispatchKey(
          r.SO_No,
          r.Customer,
          r.Item,
          r.Color
        ).toUpperCase();
        const selectedNew = selectedColors[compositeKey] ?? r.New_Color ?? null;
        const finalColor = selectedNew ?? r.Color ?? null;
        const uid = r.__uid ?? "";
        const prodQty =
          productionQtyByUid[uid] ??
          (r.ProductionQty !== undefined ? r.ProductionQty : null);

        return {
          SO_No: r.SO_No ?? "",
          Customer: r.Customer ?? null,
          Item: r.Item ?? null,
          Old_Color: r.Color ?? null,
          New_Color: selectedNew ?? null,
          Color: finalColor,
          ProductionQty: prodQty,
          Dispatched: true,
        } as Record<string, unknown>;
      });

    if (selectedRows.length === 0) {
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
        console.error("Dispatch API error", txt);
        return;
      }

      const remaining = rows.filter(
        (r) => !(r.__uid && selectedUids.includes(r.__uid))
      );
      setRows(remaining);
      setChecked({});
      setTotal((t) => Math.max(0, t - selectedRows.length));

      setDispatchedSet((s) => {
        const next = new Set(s);
        for (const sr of selectedRows) {
          const key = makeDispatchKey(
            sr.SO_No as string,
            sr.Customer as string | null,
            sr.Item as string | null,
            sr.Color as string | null
          );
          if (key) next.add(key.toUpperCase());
        }
        return next;
      });

      setSelectedColors((prev) => {
        const next = { ...prev };
        for (const r of selectedRows) {
          const origKey = makeDispatchKey(
            r.SO_No as string,
            r.Customer as string | null,
            r.Item as string | null,
            r.Old_Color as string | null
          ).toUpperCase();
          if (origKey in next) delete next[origKey];
          const newKey = makeDispatchKey(
            r.SO_No as string,
            r.Customer as string | null,
            r.Item as string | null,
            r.Color as string | null
          ).toUpperCase();
          if (newKey in next) delete next[newKey];
        }
        return next;
      });
      // clear productionQty entries for dispatched rows
      setProductionQtyByUid((prev) => {
        const next = { ...prev };
        for (const uid of selectedUids) {
          if (uid in next) delete next[uid];
        }
        return next;
      });
    } catch (e: unknown) {
      console.error("Save dispatched failed", e);
    } finally {
      setSaving(false);
    }
  }, [checked, rows, selectedColors, setRows, setTotal, productionQtyByUid]);

  /* ---------- render ---------- */

  return (
    // CENTERED NARROW PAGE: tweak max-w-[1200px] to taste (e.g. max-w-5xl, max-w-[1000px], etc.)
    <div className="max-w-[1350px] mx-auto text-xs border rounded-xl">
      <Card className="p-0 overflow-visible">
        {/* Sticky top toolbar */}
        <div className="sticky top-0 z-40 border rounded-xl">
          <div className="flex justify-between items-center p-3 border-b bg-white dark:bg-slate-900/95 backdrop-blur-sm rounded-xl">
            <div className="flex items-center gap-3">
              <div>
                <strong>Showing</strong> {rows.length} / {total}
              </div>
              <div>
                <small>{selectedCount} selected</small>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <Button
                onClick={handleVerifySelected}
                disabled={
                  (selectedCount === 0 &&
                    Object.keys(selectedColors).length === 0) ||
                  verifying
                }
                variant="outline"
                className={`px-3 py-1.5 rounded-md font-medium ${
                  !verifying ? "hover:bg-slate-100" : ""
                }`}
              >
                {verifying
                  ? "Requesting…"
                  : `Verify from customer${
                      selectedCount ? ` (${selectedCount})` : ""
                    }`}
              </Button>

              <Button
                onClick={handleSaveDispatched}
                disabled={selectedCount === 0 || saving}
                className={`px-3 py-1.5 rounded-md font-medium ${
                  selectedCount > 0 && !saving
                    ? "bg-indigo-600 text-white hover:bg-indigo-700"
                    : "bg-slate-200 text-slate-600"
                }`}
              >
                {saving
                  ? "Saving…"
                  : `Save Dispatched${
                      selectedCount ? ` (${selectedCount})` : ""
                    }`}
              </Button>
            </div>
          </div>
        </div>

        {/* Table body */}
        <div className="p-3 w-full overflow-x-auto">
          <div className="min-w-[1900px] space-y-3">
            {loading ? (
              <div className="py-6 text-center">Loading...</div>
            ) : grouped.length === 0 ? (
              <div className="py-6 text-center">No results</div>
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
                      className="flex items-center justify-between px-3 py-2 bg-slate-100 dark:bg-slate-800 cursor-pointer"
                      onClick={() => toggleGroupCollapse(g.key)}
                      role="button"
                      tabIndex={0}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          toggleGroupCollapse(g.key);
                        }
                      }}
                    >
                      <div className="flex items-center gap-2">
                        <div className="w-5 h-5 flex items-center justify-center rounded border text-[11px]">
                          {isCollapsed ? "+" : "−"}
                        </div>
                        <div>
                          <div className="font-medium">{label}</div>
                          <div className="text-[11px] text-slate-500">
                            {g.count} rows — OrderQty sum: {g.sum}
                          </div>
                        </div>
                      </div>
                      <div className="text-[11px] text-slate-500">
                        Click to {isCollapsed ? "expand" : "collapse"}
                      </div>
                    </div>

                    {!isCollapsed && (
                      <Table className="w-full border-collapse">
                        <TableHeader>
                          <TableRow className="border-b">
                            <TableHead className="w-[64px]">Select</TableHead>
                            <TableHead className="w-[90px] whitespace-nowrap">
                              SO No
                            </TableHead>
                            <TableHead className="w-[110px] whitespace-nowrap">
                              SO Date
                            </TableHead>
                            <TableHead className="w-[260px]">
                              Customer
                            </TableHead>
                            <TableHead className="w-[140px]">
                              Customer Type
                            </TableHead>
                            <TableHead className="w-[90px]">Rating</TableHead>
                            <TableHead className="w-[120px]">Broker</TableHead>
                            <TableHead className="w-[72px]">File</TableHead>
                            <TableHead className="w-[140px]">Item</TableHead>
                            <TableHead className="w-[160px]">Concept</TableHead>
                            <TableHead className="w-[140px]">Fabric</TableHead>
                            <TableHead className="w-[110px]">Color</TableHead>
                            <TableHead className="w-[90px] whitespace-nowrap">
                              Size
                            </TableHead>
                            <TableHead className="w-[90px] whitespace-nowrap">
                              Order Qty
                            </TableHead>
                            <TableHead className="w-[120px] whitespace-nowrap">
                              Qty in Production
                            </TableHead>
                            <TableHead className="w-[140px] whitespace-nowrap">
                              Stock
                            </TableHead>
                            <TableHead className="w-[100px] whitespace-nowrap">
                              Status
                            </TableHead>
                            <TableHead className="w-[60px] whitespace-nowrap text-center">
                              Actions
                            </TableHead>
                          </TableRow>
                        </TableHeader>

                        <TableBody>
                          {g.rows.map((r, idx) => {
                            const rowUid = r.__uid ?? `__idx_${idx}`;
                            const compositeKey = makeDispatchKey(
                              r.SO_No,
                              r.Customer,
                              r.Item,
                              r.Color
                            ).toUpperCase();
                            const selectedColorForThis =
                              selectedColors[compositeKey] ??
                              r.New_Color ??
                              null;

                            // invoice-pill: find invoice match by normalized (customer|item|color)
                            const invoiceKey = `${normalizeCustomerForCompare(
                              r.Customer
                            )}|${normalizeItemForCompare(
                              r.Item ?? r.ItemCode ?? ""
                            )}|${normalizeColorForCompare(r.Color)}`;
                            const invoiceMatch = invoiceMap[invoiceKey];

                            return (
                              <TableRow
                                key={`${g.key}-${rowUid}-${idx}`}
                                className="cursor-pointer"
                                onClick={() => toggleRowCheckedByUid(rowUid)}
                              >
                                <TableCell
                                  className="text-center"
                                  onClick={(e) => e.stopPropagation()}
                                >
                                  {renderCheckbox(rowUid)}
                                </TableCell>

                                <TableCell className="whitespace-nowrap text-[13px]">
                                  <span className="inline-block align-middle">
                                    {formatCell(r.SO_No)}
                                  </span>
                                </TableCell>

                                <TableCell className="whitespace-nowrap">
                                  {formatCell(r.SO_Date)}
                                </TableCell>

                                <TableCell>
                                  <div className="max-w-[260px]">
                                    <div className="truncate">
                                      {formatCell(r.Customer)}
                                    </div>

                                    {invoiceMatch ? (
                                      <div className="mt-1">
                                        <span
                                          title={`Last dispatched on ${invoiceMatch.dateIso}`}
                                          className="inline-block text-[11px] px-2 py-[4px] rounded-full bg-slate-100 text-slate-800 border border-slate-200"
                                        >
                                          {invoiceMatch.daysAgo <= 0
                                            ? "Dispatched today"
                                            : invoiceMatch.daysAgo === 1
                                            ? "Dispatched 1d ago"
                                            : `Dispatched ${invoiceMatch.daysAgo}d ago`}
                                        </span>
                                      </div>
                                    ) : null}
                                  </div>
                                </TableCell>

                                <TableCell>
                                  <div className="max-w-[140px] truncate">
                                    {formatCell(r.Customer_Type)}
                                  </div>
                                </TableCell>

                                <TableCell className="whitespace-nowrap">
                                  {formatCell(r.Rating)}
                                </TableCell>

                                <TableCell>
                                  <div className="max-w-[120px] truncate">
                                    {formatCell(r.Broker)}
                                  </div>
                                </TableCell>

                                <TableCell onClick={(e) => e.stopPropagation()}>
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
                                        if (!url) return;
                                        const href =
                                          typeof url === "string"
                                            ? url
                                            : String(url);
                                        const newWin = window.open(
                                          href,
                                          "_blank",
                                          "noopener,noreferrer"
                                        );
                                        if (newWin) newWin.opener = null;
                                      }}
                                    >
                                      <FileThumbnail
                                        url={r.File_URL}
                                        alt={`File ${r.SO_No ?? ""}`}
                                        className="w-10 h-10 object-contain"
                                        link={false}
                                      />
                                    </button>
                                  ) : (
                                    <span className="text-slate-400">—</span>
                                  )}
                                </TableCell>

                                <TableCell>
                                  <div className="max-w-[140px]">
                                    <div className="truncate">
                                      {formatCell(r.Item)}
                                    </div>

                                    {(() => {
                                      const itemKey = normItemKey(
                                        r.Item ?? r.ItemCode ?? null
                                      );
                                      const sosSet = itemToSOs.get(itemKey);
                                      const allSos = sosSet
                                        ? Array.from(sosSet)
                                        : [];
                                      const currentSo = String(
                                        r.SO_No ?? ""
                                      ).trim();
                                      const otherSos = allSos.filter(
                                        (s) => s !== currentSo
                                      );
                                      const otherCount = otherSos.length;
                                      if (otherCount === 0) return null;

                                      const tooltip = otherSos.join(", ");
                                      return (
                                        <div className="mt-1">
                                          <span
                                            title={tooltip}
                                            className="inline-block text-[11px] px-2 py-[4px] rounded-full bg-slate-100 text-slate-800 border border-slate-200"
                                          >
                                            {otherCount === 1
                                              ? "Also in 1 SO"
                                              : `Also in ${otherCount} SOs`}
                                          </span>
                                        </div>
                                      );
                                    })()}
                                  </div>
                                </TableCell>

                                <TableCell>
                                  <div className="max-w-[160px] truncate">
                                    {formatCell(r.Concept)}
                                  </div>
                                </TableCell>

                                <TableCell>
                                  <div className="max-w-[140px] truncate">
                                    {formatCell(r.Fabric)}
                                  </div>
                                </TableCell>

                                {/* Color cell: if New_Color exists show original struck-through and new pill below */}
                                <TableCell>
                                  <div className="max-w-[110px]">
                                    {selectedColorForThis ? (
                                      <div>
                                        <div className="text-[12px] text-slate-500 line-through">
                                          {formatCell(r.Color)}
                                        </div>
                                        <div className="mt-1">
                                          <span className="text-[11px] inline-block px-2 py-[4px] rounded-full bg-emerald-50 text-emerald-800 border border-emerald-200">
                                            {formatCell(selectedColorForThis)}
                                          </span>
                                        </div>
                                      </div>
                                    ) : (
                                      <div className="truncate">
                                        {formatCell(r.Color)}
                                      </div>
                                    )}
                                  </div>
                                </TableCell>

                                <TableCell className="whitespace-nowrap">
                                  {formatCell(r.Size)}
                                </TableCell>

                                <TableCell className="whitespace-nowrap">
                                  {formatCell(r.OrderQty)}
                                </TableCell>

                                <TableCell
                                  className="whitespace-nowrap"
                                  onClick={(e) => e.stopPropagation()}
                                >
                                  <input
                                    type="number"
                                    min={0}
                                    className="w-20 px-2 py-1 border rounded text-sm"
                                    value={
                                      productionQtyByUid[rowUid] ??
                                      r.ProductionQty ??
                                      ""
                                    }
                                    onChange={(e) => {
                                      const v = e.target.value;
                                      const n = v === "" ? null : Number(v);
                                      setProductionQtyByUid((prev) => ({
                                        ...prev,
                                        [rowUid]: n,
                                      }));
                                    }}
                                  />
                                </TableCell>

                                <TableCell className="whitespace-nowrap">
                                  {/* Stock cell extracted to component */}
                                  <StockCell
                                    row={r}
                                    compositeKey={compositeKey}
                                    selectedColors={selectedColors}
                                    toggleSelectColorForRow={
                                      toggleSelectColorForRow
                                    }
                                  />
                                </TableCell>

                                <TableCell className="whitespace-nowrap">
                                  {/* Status badge */}
                                  <span
                                    className={`inline-block px-2 py-1 rounded-full text-sm ${
                                      r.Status === "Cancelled"
                                        ? "bg-red-100 text-red-800"
                                        : "bg-green-100 text-green-800"
                                    }`}
                                  >
                                    {r.Status === "Cancelled"
                                      ? "Cancelled"
                                      : "Active"}
                                  </span>
                                </TableCell>

                                <TableCell className="text-center">
                                  <RowActions
                                    row={r}
                                    onCancel={(row) =>
                                      setCancelDialogOrder(row)
                                    }
                                  />
                                </TableCell>
                              </TableRow>
                            );
                          })}

                          {/* Cancel Order Dialog */}
                          {cancelDialogOrder && (
                            <CancelOrderDialog
                              isOpen={!!cancelDialogOrder}
                              onClose={() => setCancelDialogOrder(null)}
                              onConfirm={() =>
                                handleCancelOrder(cancelDialogOrder)
                              }
                              orderNo={cancelDialogOrder.SO_No || ""}
                            />
                          )}
                        </TableBody>
                      </Table>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>

        <div className="mt-3 px-3">
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
    </div>
  );
}

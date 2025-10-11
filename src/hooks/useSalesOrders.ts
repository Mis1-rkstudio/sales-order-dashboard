"use client";

import { useEffect, useState } from "react";
import { SalesOrderRow, Filters } from "@/types/sales";

export function useSalesOrders(filters: Filters, _groupBy?: Array<string>) {
  // _groupBy intentionally unused for now
  void _groupBy;
  const [rows, setRows] = useState<SalesOrderRow[]>([]);
  const [page, setPage] = useState<number>(0);
  const [loading, setLoading] = useState<boolean>(false);
  const [total, setTotal] = useState<number>(0);
  const [refreshKey, setRefreshKey] = useState<number>(0);
  const [invoiceMap, setInvoiceMap] = useState<
    Record<string, { dateIso: string; daysAgo: number }>
  >({});

  useEffect(() => {
    const abortCtrl = new AbortController();

    async function load(): Promise<void> {
      setLoading(true);
      try {
        const params = new URLSearchParams();
        params.set("limit", String(filters.limit));
        params.set("offset", String(page * filters.limit));
        if (filters.q) params.set("q", filters.q);
        if (filters.brand) params.set("brand", filters.brand);
        if (filters.city) params.set("city", filters.city);
        if (filters.startDate) params.set("startDate", filters.startDate);
        if (filters.endDate) params.set("endDate", filters.endDate);
        for (const t of filters.tokens) params.append("tokens", t);

        const res = await fetch(`/api/sales-orders?${params.toString()}`, {
          signal: abortCtrl.signal,
        });
        if (!res.ok) {
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

        setRows(incoming);
        setTotal(serverTotal);

        // invoice map left as empty here (consumer can fetch separately if needed)
        setInvoiceMap({});
      } catch (e) {
        console.error(e);
      } finally {
        setLoading(false);
      }
    }

    load();
    return () => abortCtrl.abort();
  }, [filters, page, refreshKey]);

  return {
    rows,
    setRows,
    page,
    setPage,
    loading,
    total,
    refreshKey,
    setRefreshKey,
    invoiceMap,
    setInvoiceMap,
    setLoading,
    setTotal,
  };
}

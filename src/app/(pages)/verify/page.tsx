// app/verified/page.tsx
"use client";

import React, { JSX, useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

type VerifiedRow = {
  SO_No?: string | null;
  Customer?: string | null;
  Item?: string | null;
  Color?: string | null; // original color
  New_Color?: string | null; // replacement color
  Size?: string | null;
  OrderQty?: number | null;
  verified_at?: unknown | null;
  [key: string]: unknown;
};

function formatVerifiedAt(value: unknown): string {
  if (value == null) return "";

  if (typeof value === "string") {
    const parsed = Date.parse(value);
    if (!Number.isNaN(parsed)) return new Date(parsed).toLocaleString();
    return value;
  }

  if (typeof value === "object" && value !== null) {
    // treat incoming object as a safe record and inspect known fields
    const v = value as Record<string, unknown>;

    const maybeValue = v["value"];
    if (typeof maybeValue === "string") {
      const parsed = Date.parse(maybeValue);
      if (!Number.isNaN(parsed)) return new Date(parsed).toLocaleString();
      return maybeValue;
    }

    const secondsRaw = v["seconds"];
    const nanosRaw = v["nanos"];

    // seconds may be number or string (protobuf-like structure or Firestore)
    if (secondsRaw !== undefined && secondsRaw !== null) {
      const secs = Number(secondsRaw);
      const nanos = Number(nanosRaw ?? 0);
      if (!Number.isNaN(secs)) {
        const ms =
          secs * 1000 + Math.round((Number.isNaN(nanos) ? 0 : nanos) / 1e6);
        return new Date(ms).toLocaleString();
      }
    }

    // nested seconds.value pattern (some serialized shapes)
    const secondsObj = v["seconds"];
    if (typeof secondsObj === "object" && secondsObj !== null) {
      const secVal = (secondsObj as Record<string, unknown>)["value"];
      if (secVal !== undefined && secVal !== null) {
        const secs = Number(secVal);
        const nanos = Number(nanosRaw ?? 0);
        if (!Number.isNaN(secs)) {
          const ms =
            secs * 1000 + Math.round((Number.isNaN(nanos) ? 0 : nanos) / 1e6);
          return new Date(ms).toLocaleString();
        }
      }
    }

    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }

  return String(value);
}

export default function VerifiedPage(): JSX.Element {
  const [rows, setRows] = useState<VerifiedRow[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [confirmingMap, setConfirmingMap] = useState<Record<string, boolean>>(
    {}
  );

  function makeKey(r: VerifiedRow): string {
    const so = String(r.SO_No ?? "").trim();
    const customer = String(r.Customer ?? "").trim();
    const item = String(r.Item ?? "").trim();
    const color = String(r.Color ?? "").trim();
    const newColor = String(r.New_Color ?? "").trim();
    // include new color in key so it is unique per replacement
    return `${so}|${customer}|${item}|${color}|${newColor}`;
  }

  useEffect(() => {
    let mounted = true;
    async function load() {
      setLoading(true);
      try {
        const res = await fetch("/api/verify");
        if (!res.ok) {
          console.error("Failed to load verified rows", await res.text());
          if (mounted) setRows([]);
          return;
        }
        const json = await res.json();
        const incoming = Array.isArray(json.rows)
          ? (json.rows as VerifiedRow[])
          : [];
        if (mounted) setRows(incoming);
      } catch (e) {
        console.error("Error loading verified rows", e);
        if (mounted) setRows([]);
      } finally {
        if (mounted) setLoading(false);
      }
    }
    load();
    return () => {
      mounted = false;
    };
  }, []);

  async function handleConfirm(row: VerifiedRow) {
    const key = makeKey(row);
    setConfirmingMap((c) => ({ ...c, [key]: true }));

    try {
      const body = {
        rows: [
          {
            SO_No: row.SO_No ?? "",
            Customer: row.Customer ?? null,
            Item: row.Item ?? null,
            Color: row.Color ?? null,
            New_Color: row.New_Color ?? null, // include replacement color
          },
        ],
      };

      const res = await fetch("/api/verify/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const txt = await res.text();
        console.error("Verify confirm API error", txt);
        setConfirmingMap((c) => ({ ...c, [key]: false }));
        return;
      }

      // Try parse server returned row payload (if any). If not available, synthesize a small payload:
      let payloadRow: VerifiedRow = row;
      try {
        const json = await res.json().catch(() => null);
        // if server returns an object with a row or rows, prefer that:
        if (json) {
          if (Array.isArray(json.rows) && json.rows.length > 0) {
            payloadRow = json.rows[0] as VerifiedRow;
          } else if (json.row) {
            payloadRow = json.row as VerifiedRow;
          } else if (
            json.verified &&
            json.verified.rows &&
            Array.isArray(json.verified.rows) &&
            json.verified.rows[0]
          ) {
            payloadRow = json.verified.rows[0] as VerifiedRow;
          } else {
            // nothing useful: fall back to original row with timestamp
            payloadRow = { ...row, verified_at: new Date().toISOString() };
          }
        } else {
          payloadRow = { ...row, verified_at: new Date().toISOString() };
        }
      } catch {
        payloadRow = { ...row, verified_at: new Date().toISOString() };
      }

      // Broadcast to other tabs/components that a row was confirmed
      try {
        if (typeof BroadcastChannel !== "undefined") {
          const channel = new BroadcastChannel("sales-orders");
          channel.postMessage({ type: "verified:confirmed", row: payloadRow });
          channel.close();
        } else if (
          typeof window !== "undefined" &&
          typeof window.dispatchEvent === "function"
        ) {
          // fallback to window event
          const ev = new CustomEvent("sales-orders:verified:confirmed", {
            detail: payloadRow,
          });
          window.dispatchEvent(ev as Event);
        }
      } catch (err) {
        // non-fatal
        console.warn("Broadcast failed", err);
      }

      // remove from our local list (pending list)
      setRows((prev) => prev.filter((r) => makeKey(r) !== key));
    } catch (e) {
      console.error("Verify confirm failed", e);
      setConfirmingMap((c) => ({ ...c, [key]: false }));
    }
  }

  return (
    <main className="p-6">
      <h1 className="text-2xl font-bold mb-4">Verify — From Customers</h1>

      <Card className="p-4">
        {loading ? (
          <div className="py-8 text-center">Loading…</div>
        ) : rows.length === 0 ? (
          <div className="py-8 text-center">No rows for verification</div>
        ) : (
          <div className="w-full overflow-auto">
            <table className="min-w-full table-auto border-collapse">
              <thead>
                <tr>
                  <th className="p-2 text-left">SO No</th>
                  <th className="p-2 text-left">Customer</th>
                  <th className="p-2 text-left">Item</th>
                  <th className="p-2 text-left">
                    Color (original / replacement)
                  </th>
                  <th className="p-2 text-left">Size</th>
                  <th className="p-2 text-left">Qty</th>
                  <th className="p-2 text-left">Status / Verified At</th>
                  <th className="p-2 text-left">Action</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, idx) => {
                  const key = makeKey(r);
                  const hasVerifiedAt = r.verified_at != null;
                  const confirming = Boolean(confirmingMap[key]);

                  return (
                    <tr key={key || idx} className="border-t">
                      <td className="p-2 align-top">{String(r.SO_No ?? "")}</td>
                      <td className="p-2 align-top">
                        {String(r.Customer ?? "")}
                      </td>
                      <td className="p-2 align-top">{String(r.Item ?? "")}</td>

                      {/* Color cell - shows original color and replacement (if any) */}
                      <td className="p-2 align-top">
                        <div className="flex flex-col gap-1">
                          <div className="text-sm font-medium">
                            {String(r.Color ?? "") || "—"}
                          </div>
                          {r.New_Color ? (
                            <div>
                              <span className="text-xs inline-block px-2 py-1 rounded-full bg-slate-100 text-slate-800 border border-slate-200">
                                Replacement: {String(r.New_Color)}
                              </span>
                            </div>
                          ) : null}
                        </div>
                      </td>

                      <td className="p-2 align-top">{String(r.Size ?? "")}</td>
                      <td className="p-2 align-top">
                        {r.OrderQty != null ? String(r.OrderQty) : ""}
                      </td>

                      <td className="p-2 align-top">
                        {hasVerifiedAt ? (
                          <div className="text-sm text-slate-700">
                            {formatVerifiedAt(r.verified_at)}
                          </div>
                        ) : (
                          <div className="text-sm text-amber-600">
                            Pending verification
                          </div>
                        )}
                      </td>

                      <td className="p-2 align-top">
                        {!hasVerifiedAt ? (
                          <Button
                            size="sm"
                            onClick={() => handleConfirm(r)}
                            disabled={confirming}
                          >
                            {confirming ? "Verifying…" : "Verify further"}
                          </Button>
                        ) : (
                          <div className="text-sm text-slate-500">—</div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </main>
  );
}

/**
 * IMS Pro Supabase Direct REST Client utilities
 */

import { HARDCODED_SUPABASE_URL, HARDCODED_SUPABASE_KEY } from "../constants";

let supabaseUrl = HARDCODED_SUPABASE_URL;
let supabaseKey = HARDCODED_SUPABASE_KEY;

// Try to fetch configuration from config.json dynamically
export async function initializeSupabaseConfig(): Promise<{ url: string; key: string }> {
  try {
    const res = await fetch("/config.json");
    if (res.ok) {
      const cfg = await res.json();
      if (cfg.supabase?.url && cfg.supabase.url !== "REPLACE_WITH_YOUR_SUPABASE_URL") {
        supabaseUrl = cfg.supabase.url;
        supabaseKey = cfg.supabase.anonKey || cfg.supabase.key;
      }
    }
  } catch (e) {
    console.warn("Could not load dynamic config.json, using fallback configuration.", e);
  }
  return { url: supabaseUrl, key: supabaseKey };
}

export function getSupabaseConfig() {
  return { url: supabaseUrl, key: supabaseKey };
}

export async function sbGet(table: string, params: string = "") {
  const url = `${supabaseUrl}/rest/v1/${table}${params}`;
  const res = await fetch(url, {
    headers: {
      apikey: supabaseKey,
      Authorization: `Bearer ${supabaseKey}`,
      "Content-Type": "application/json",
      Prefer: "count=exact",
    },
  });

  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`HTTP ${res.status}: ${txt.substring(0, 200)}`);
  }

  const contentRange = res.headers.get("content-range");
  const count = contentRange ? parseInt(contentRange.split("/")[1]) : 0;
  const data = await res.json();
  return { data, count };
}

/**
 * Fetches all matching rows recursively, overcoming search pagination limits (1000 items)
 */
export async function fetchAllRows(table: string, select: string = "*", customParams: string = "") {
  let allData: any[] = [];
  let offset = 0;
  const limit = 1000;
  let hasMore = true;

  while (hasMore) {
    const params = `?select=${select}&limit=${limit}&offset=${offset}${customParams}`;
    const { data } = await sbGet(table, params);
    if (data && data.length > 0) {
      allData = allData.concat(data);
      if (data.length < limit) {
        hasMore = false;
      }
      offset += limit;
    } else {
      hasMore = false;
    }
    // Safeguard to prevent infinite loops in bad database states
    if (offset > 100000) break;
  }
  return allData;
}

export async function sbPost(table: string, body: any) {
  const url = `${supabaseUrl}/rest/v1/${table}`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      apikey: supabaseKey,
      Authorization: `Bearer ${supabaseKey}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`POST ${res.status}: ${txt.substring(0, 200)}`);
  }
  return res.json();
}

export async function sbPatch(table: string, id: number | string, body: any) {
  const url = `${supabaseUrl}/rest/v1/${table}?id=eq.${id}`;
  const res = await fetch(url, {
    method: "PATCH",
    headers: {
      apikey: supabaseKey,
      Authorization: `Bearer ${supabaseKey}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`PATCH ${res.status}: ${txt.substring(0, 200)}`);
  }
  return res.json();
}

export async function sbDelete(table: string, id: number | string) {
  const url = `${supabaseUrl}/rest/v1/${table}?id=eq.${id}`;
  const res = await fetch(url, {
    method: "DELETE",
    headers: {
      apikey: supabaseKey,
      Authorization: `Bearer ${supabaseKey}`,
    },
  });

  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`DELETE ${res.status}: ${txt.substring(0, 200)}`);
  }
  return true;
}

export async function sbRpc(fn: string, args: any = {}) {
  const url = `${supabaseUrl}/rest/v1/rpc/${fn}`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      apikey: supabaseKey,
      Authorization: `Bearer ${supabaseKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(args),
  });

  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`RPC ${fn} ${res.status}: ${txt.substring(0, 200)}`);
  }
  return res.json();
}

// Global utility formatting methods
export function formatCurrency(num: number | null | undefined): string {
  if (num === null || num === undefined || isNaN(num)) return "₹0.00";
  return (
    "₹" +
    parseFloat(num.toString()).toLocaleString("en-IN", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })
  );
}

export function formatNumber(num: number | null | undefined, decimals: number = 2): string {
  if (num === null || num === undefined || isNaN(num)) return "0";
  return parseFloat(num.toString()).toLocaleString("en-IN", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

export function formatDate(d: string | null | undefined): string {
  if (!d) return "";
  const dt = new Date(d);
  if (isNaN(dt.getTime())) return d;
  return `${String(dt.getDate()).padStart(2, "0")}/${String(dt.getMonth() + 1).padStart(2, "0")}/${dt.getFullYear()}`;
}

export function formatDateTime(d: string | null | undefined): string {
  if (!d) return "";
  const dt = new Date(d);
  if (isNaN(dt.getTime())) return d;
  return `${formatDate(d)} ${String(dt.getHours()).padStart(2, "0")}:${String(dt.getMinutes()).padStart(2, "0")}`;
}

/**
 * Client-Side Stock Recalculator & Database Synchronizer
 * Automatically runs calculations and updates the latest_stock record for a SKU.
 * This acts as a robust failover for when remote database SQL triggers are disabled or have compilation errors.
 */
export async function recalculateAndPatchLatestStock(sku: string): Promise<any> {
  const { url, key } = getSupabaseConfig();
  if (!sku) return;

  try {
    // 1. Fetch the latest closing_stock row for this SKU
    const resCs = await fetch(`${url}/rest/v1/closing_stock?sku=eq.${encodeURIComponent(sku)}&order=date.desc,id.desc&limit=1`, {
      headers: { apikey: key, Authorization: `Bearer ${key}` }
    });
    const csData = await resCs.json();
    const closingRow = csData && csData.length > 0 ? csData[0] : null;
    const closingQty = closingRow ? (Number(closingRow.quantity) || 0) : 0;
    const closingVal = closingRow ? (Number(closingRow.stock_value) || 0) : 0;

    // 2. Fetch all in_out_manual transactions for this SKU
    const resIo = await fetch(`${url}/rest/v1/in_out_manual?sku=eq.${encodeURIComponent(sku)}`, {
      headers: { apikey: key, Authorization: `Bearer ${key}` }
    });
    const transactions = await resIo.json() || [];

    // Sum manual In / Out
    let totalIn = 0;
    let totalOut = 0;
    let totalConsumed = 0;
    const outTransactions: number[] = [];

    transactions.forEach((tx: any) => {
      const qty = Number(tx.quantity) || 0;
      if (tx.in_out === "In") {
        totalIn += qty;
      } else if (tx.in_out === "Out") {
        totalOut += qty;
        totalConsumed += qty;
        const tDate = tx.timestamp ? new Date(tx.timestamp) : (tx.date ? new Date(tx.date) : null);
        if (tDate && !isNaN(tDate.getTime())) {
          outTransactions.push(tDate.getTime());
        }
      }
    });

    // 3. Calculate Average Daily Consumption (ADC)
    let adc = 0;
    if (outTransactions.length > 0) {
      const minTimestamp = Math.min(...outTransactions);
      const maxTimestamp = Math.max(...outTransactions);
      const diffDays = Math.max(Math.ceil((maxTimestamp - minTimestamp) / (1000 * 60 * 60 * 24)) + 1, 1);
      adc = totalConsumed / diffDays;
    }

    // 4. Calculate final quantity & stock valuation
    const quantity = closingQty + totalIn - totalOut;

    // 5. Calculate master price
    let masterPrice = 0;
    if (closingQty > 0) {
      masterPrice = closingVal / closingQty;
    } else if (transactions.length > 0) {
      // Find latest transaction with defined quantity & stock value to extract active price
      const sortedTxs = [...transactions].sort((a: any, b: any) => {
        const db = b.timestamp ? new Date(b.timestamp).getTime() : (b.date ? new Date(b.date).getTime() : 0);
        const da = a.timestamp ? new Date(a.timestamp).getTime() : (a.date ? new Date(a.date).getTime() : 0);
        return db - da;
      });
      const latestTxWithPrice = sortedTxs.find((t: any) => (Number(t.quantity) || 0) > 0 && (Number(t.stock_value) || 0) > 0);
      if (latestTxWithPrice) {
        masterPrice = (Number(latestTxWithPrice.stock_value) || 0) / (Number(latestTxWithPrice.quantity) || 0);
      }
    }

    // Check if the record already exists in latest_stock
    const resLsExist = await fetch(`${url}/rest/v1/latest_stock?sku=eq.${encodeURIComponent(sku)}&select=id,price,item_name,unit,department&limit=1`, {
      headers: { apikey: key, Authorization: `Bearer ${key}` }
    });
    const lsExistData = await resLsExist.json();
    const exists = lsExistData && lsExistData.length > 0;
    const existingRow = exists ? lsExistData[0] : null;

    if (masterPrice === 0) {
      masterPrice = existingRow ? (Number(existingRow.price) || 0) : 0;
    }

    const stockValue = quantity * masterPrice;
    const safetyFactor = stockValue > 100000 ? 2.0 : 1.5;
    const moq = (adc * 7 * safetyFactor) + 5;
    const maxLevel = moq + 5;

    const fallbackItemName = existingRow?.item_name || closingRow?.item_name || (transactions.length > 0 ? transactions[0].item_name : "") || "Unknown Item";
    const fallbackUnit = existingRow?.unit || closingRow?.unit || "Piece";
    const fallbackDept = existingRow?.department || closingRow?.department || (transactions.length > 0 ? transactions[0].department : "General") || "General";

    const payload = {
      sku: sku,
      item_name: fallbackItemName,
      unit: fallbackUnit,
      department: fallbackDept,
      quantity: Number(quantity.toFixed(4)),
      stock_value: Number(stockValue.toFixed(2)),
      price: Number(masterPrice.toFixed(4)),
      avg_daily_consumption: Number(adc.toFixed(6)),
      safety_factor: safetyFactor,
      moq: Number(moq.toFixed(2)),
      max_level: Number(maxLevel.toFixed(2)),
      last_updated: new Date().toISOString()
    };

    let saveRes;
    if (exists) {
      // 6. Direct PATCH update back to the master latest_stock table
      saveRes = await fetch(`${url}/rest/v1/latest_stock?sku=eq.${encodeURIComponent(sku)}`, {
        method: "PATCH",
        headers: {
          apikey: key,
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
          "Prefer": "return=representation"
        },
        body: JSON.stringify(payload)
      });
    } else {
      // 6. Direct POST insert to initialize record in the master latest_stock table
      saveRes = await fetch(`${url}/rest/v1/latest_stock`, {
        method: "POST",
        headers: {
          apikey: key,
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
          "Prefer": "return=representation"
        },
        body: JSON.stringify(payload)
      });
    }

    if (saveRes.ok) {
      console.log(`[Recalculator] Successfully recalculated and synced SKU: ${sku}`);
      const savedData = await saveRes.json();
      return savedData && savedData.length > 0 ? savedData[0] : null;
    } else {
      const errorText = await saveRes.text();
      console.warn(`[Recalculator] Failed to save latest_stock:`, errorText);
    }
  } catch (err) {
    console.error(`[Recalculator] Exception during SKU recalculation:`, err);
  }
}


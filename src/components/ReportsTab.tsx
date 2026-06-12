import React, { useState, useEffect } from "react";
import { fetchAllRows, sbGet, formatCurrency, formatNumber, formatDate, formatDateTime } from "../utils/supabase";
import { LatestStockItem, Transaction, DepartmentValuation } from "../types";
import { AlertCircle, ArrowLeft, Ban, Bolt, Building2, Calendar, FileOutput, HelpCircle, History, Hammer, TrendingUp, AlertTriangle } from "lucide-react";

interface ReportsTabProps {
  quickRunType?: string | null;
  onClearQuickRun?: () => void;
}

export default function ReportsTab({ quickRunType, onClearQuickRun }: ReportsTabProps) {
  const [activeReport, setActiveReport] = useState<string | null>(null);
  const [reportTitle, setReportTitle] = useState("");
  const [reportSubtitle, setReportSubtitle] = useState("");
  const [loading, setLoading] = useState(false);

  // Standard report outputs values state
  const [reportItems, setReportItems] = useState<any[]>([]);

  // Special multi-dates parameters state
  const [ibnoDates, setIbnoDates] = useState({ start: "", end: "" });
  const [froDates, setFroDates] = useState({ start: "", end: "" });

  const [itemNamesList, setItemNamesList] = useState<string[]>([]);

  useEffect(() => {
    // Set default dates
    const today = new Date().toISOString().split("T")[0];
    const past = new Date();
    past.setMonth(past.getMonth() - 1);
    const lastMonth = past.toISOString().split("T")[0];

    setIbnoDates({ start: lastMonth, end: today });
    setFroDates({ start: lastMonth, end: today });

    loadItemNames();
  }, []);

  // Listen to parent triggers
  useEffect(() => {
    if (quickRunType) {
      runReport(quickRunType);
      if (onClearQuickRun) onClearQuickRun();
    }
  }, [quickRunType]);

  async function loadItemNames() {
    try {
      const { data } = await sbGet("latest_stock", "?select=item_name&order=item_name.asc");
      const names = Array.from(new Set(data.map((r: any) => r.item_name).filter(Boolean))) as string[];
      setItemNamesList(names);
    } catch (e) {
      console.error(e);
    }
  }

  async function runReport(type: string) {
    setLoading(true);
    setActiveReport(type);

    try {
      // Fetch complete stock levels for calculations
      const ls: LatestStockItem[] = await fetchAllRows("latest_stock");

      const titles: { [key: string]: string } = {
        negative_stock: "Negative Stock Report",
        high_value: "High Value Items (Top 50)",
        zero_value: "Zero Value Items (With Quantity)",
        dept_value: "Department Valuation Summary",
        electrical: "Electrical Items Registry",
        machinery: "Machinery Spares Registry",
        low_stock: "Low Stock Alert Report",
        in_but_not_out: "In But Not Out Registry",
        frequently_reordered: "Frequently Re-Order Items",
      };

      const subs: { [key: string]: string } = {
        negative_stock: "Inventory items with negative quantities or negative calculated values.",
        high_value: "Top 50 most expensive inventory items based on current valuation.",
        zero_value: "Inventory items holding quantities but registered with zero stock values.",
        dept_value: "Total investment and percentage division by department.",
        electrical: "All components matching electrical equipment patterns.",
        machinery: "Parts and backups matching industrial machinery descriptions.",
        low_stock: "Critical items currently falling below 20% of their maximum safety target level.",
        in_but_not_out: "Items received in the warehouse but not issued once.",
        frequently_reordered: "Items with multiple incoming transactions recorded.",
      };

      setReportTitle(titles[type] || "Analysis Report");
      setReportSubtitle(subs[type] || "Inventory data compilation.");

      let calculated: any[] = [];

      if (type === "negative_stock") {
        calculated = ls.filter((item) => Number(item.quantity) < 0 || Number(item.stock_value) < 0);
      } else if (type === "high_value") {
        calculated = [...ls]
          .sort((a, b) => (Number(b.stock_value) || 0) - (Number(a.stock_value) || 0))
          .slice(0, 50);
      } else if (type === "zero_value") {
        calculated = ls.filter((item) => Number(item.quantity) > 0 && (!item.stock_value || Number(item.stock_value) === 0));
      } else if (type === "low_stock") {
        calculated = ls.filter((item) => {
          const qty = Number(item.quantity) || 0;
          const mx = Number(item.max_level) || 0;
          return qty > 0 && qty < mx * 0.2;
        });
      } else if (type === "electrical") {
        calculated = ls.filter((item) => {
          const s = `${item.item_name} ${item.department}`.toLowerCase();
          return (
            s.includes("elect") ||
            s.includes("bulb") ||
            s.includes("wire") ||
            s.includes("switch") ||
            s.includes("cable") ||
            s.includes("socket") ||
            s.includes("fuse")
          );
        });
      } else if (type === "machinery") {
        calculated = ls.filter((item) => {
          const s = `${item.item_name} ${item.department}`.toLowerCase();
          return (
            s.includes("bearing") ||
            s.includes("belt") ||
            s.includes("valve") ||
            s.includes("pump") ||
            s.includes("motor") ||
            s.includes("gear") ||
            s.includes("coupling")
          );
        });
      } else if (type === "dept_value") {
        const dMap: { [key: string]: number } = {};
        ls.forEach((item) => {
          const d = item.department || "General Store";
          dMap[d] = (dMap[d] || 0) + (Number(item.stock_value) || 0);
        });

        calculated = Object.entries(dMap)
          .sort((a, b) => b[1] - a[1])
          .map(([department, stock_value]) => ({ department, stock_value }));
      } else if (type === "in_but_not_out") {
        // Handled via separate date selection workflow triggers below
        calculated = [];
      } else if (type === "frequently_reordered") {
        // Handled via separate date selection workflow triggers below
        calculated = [];
      }

      setReportItems(calculated);
    } catch (e) {
      console.error("Report run failed:", e);
    } finally {
      setLoading(false);
    }
  }

  // Live query for special dynamic database tables
  async function runInButNotOutReport() {
    setLoading(true);
    try {
      let q = "?select=*&order=date.asc";
      if (ibnoDates.start) q += `&date=gte.${ibnoDates.start}`;
      if (ibnoDates.end) q += `&date=lte.${ibnoDates.end}`;

      const transactions: Transaction[] = await fetchAllRows("in_out_manual", "*", q);

      const skuMap: { [sku: string]: { inQty: number; outQty: number; detail: Transaction } } = {};
      transactions.forEach((tx) => {
        const s = tx.sku;
        if (!skuMap[s]) skuMap[s] = { inQty: 0, outQty: 0, detail: tx };

        const qty = Number(tx.quantity) || 0;
        if (tx.in_out === "In") {
          skuMap[s].inQty += qty;
          skuMap[s].detail = tx; // Ensure latest detail gets stored
        } else if (tx.in_out === "Out") {
          skuMap[s].outQty += qty;
        }
      });

      // Filter SKUs holding incoming quantity in date range but zero outflows
      const filtered = Object.entries(skuMap)
        .filter(([, v]) => v.inQty > 0 && v.outQty === 0)
        .map(([sku, v]) => ({
          ...v.detail,
          sku,
          quantity: v.inQty, // Quantity is the summed incoming quantity
        }));

      setReportItems(filtered);
    } catch (e: any) {
      alert(`Report processing failed: ${e.message}`);
    } finally {
      setLoading(false);
    }
  }

  async function runFrequentlyReorderedReport() {
    setLoading(true);
    try {
      let q = "?select=*&in_out=eq.In&order=date.asc";
      if (froDates.start) q += `&date=gte.${froDates.start}`;
      if (froDates.end) q += `&date=lte.${froDates.end}`;

      const transactions: Transaction[] = await fetchAllRows("in_out_manual", "*", q);

      const skuCount: { [sku: string]: number } = {};
      transactions.forEach((tx) => {
        skuCount[tx.sku] = (skuCount[tx.sku] || 0) + 1;
      });

      // Find items ordered more than once
      const frequentSKUs = new Set(Object.keys(skuCount).filter((s) => skuCount[s] > 1));

      const filtered = transactions
        .filter((tx) => frequentSKUs.has(tx.sku))
        .map((tx) => ({
          ...tx,
          frequency: skuCount[tx.sku],
        }));

      // Sort by frequency (highest orders count first)
      filtered.sort((a, b) => b.frequency - a.frequency || a.sku.localeCompare(b.sku));

      setReportItems(filtered);
    } catch (e: any) {
      alert(`Report processing failed: ${e.message}`);
    } finally {
      setLoading(false);
    }
  }

  function handleExport() {
    if (reportItems.length === 0) {
      alert("No data available to compile.");
      return;
    }

    let csv = "";
    const ds = new Date().toISOString().split("T")[0];

    if (activeReport === "dept_value") {
      const total = reportItems.reduce((sum, r) => sum + (r.stock_value || 0), 0);
      csv = "Department,Valuation Value (₹),Valuation Percentage (%)\n";
      reportItems.forEach((r) => {
        const pct = total > 0 ? ((r.stock_value / total) * 100).toFixed(2) : "0.00";
        csv += `"${r.department}",${r.stock_value},${pct}%\n`;
      });
    } else if (activeReport === "in_but_not_out") {
      csv = "Timestamp,SKU,Type,Date Received,Total Received In Qty,Item Description,Stock Value,Department\n";
      reportItems.forEach((r) => {
        csv += `"${r.timestamp}","${r.sku}","IN","${r.date}",${r.quantity},"${r.item_name}",${r.stock_value},"${r.department || ""}"\n`;
      });
    } else if (activeReport === "frequently_reordered") {
      csv = "Timestamp,SKU,In/Out,Date Ordered,Quantity,Item Description,Transaction Value,Department,Rank Orders Count\n";
      reportItems.forEach((r) => {
        csv += `"${r.timestamp}","${r.sku}","${r.in_out}","${r.date}",${r.quantity},"${r.item_name}",${r.stock_value},"${r.department || ""}",${r.frequency}\n`;
      });
    } else {
      csv = "SKU,Item Name Description,Department,Quantity,Stock Valuation Value (₹)\n";
      reportItems.forEach((r) => {
        csv += `"${r.sku}","${r.item_name}","${r.department || ""}",${r.quantity},${r.stock_value}\n`;
      });
    }

    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const link = document.createElement("a");
    link.setAttribute("href", URL.createObjectURL(blob));
    link.setAttribute("download", `${activeReport}_Export_${ds}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  function closeReport() {
    setActiveReport(null);
    setReportItems([]);
  }

  return (
    <div className="space-y-6 animate-fadeIn pb-12">
      {/* Header */}
      {!activeReport && (
        <div>
          <h1 className="text-3xl font-extrabold text-slate-900 tracking-tight flex items-center gap-3">
            Analytical Reports
          </h1>
          <p className="text-slate-500 mt-2">Interactive, real-time diagnostic reporting models over warehouse reserves.</p>
        </div>
      )}

      {/* Cards Panel (Grid of Reports available) */}
      {!activeReport && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 animate-fadeIn">
          {/* 1: Negative Stock */}
          <div
            onClick={() => runReport("negative_stock")}
            className="bg-white border border-slate-200 rounded-2xl p-6 hover:border-indigo-500 hover:shadow-md transition-all cursor-pointer relative group"
          >
            <div className="flex items-start justify-between">
              <span className="p-3 bg-rose-50 text-rose-600 rounded-xl group-hover:scale-105 transition-transform">
                <AlertTriangle className="w-6 h-6 border-transparent" />
              </span>
              <span className="px-2.5 py-1 text-[10px] font-extrabold rounded-full bg-rose-50 text-rose-700 uppercase tracking-widest border border-rose-100">
                Critical
              </span>
            </div>
            <h3 className="text-lg font-bold text-slate-900 mt-5">Negative Stock Ledger</h3>
            <p className="text-xs text-slate-500 mt-2 leading-relaxed">
              Find items registered with negative warehouse reserves quantities or values.
            </p>
          </div>

          {/* 2: High Value */}
          <div
            onClick={() => runReport("high_value")}
            className="bg-white border border-slate-200 rounded-2xl p-6 hover:border-indigo-500 hover:shadow-md transition-all cursor-pointer relative group"
          >
            <div className="flex items-start justify-between">
              <span className="p-3 bg-indigo-50 text-indigo-600 rounded-xl group-hover:scale-105 transition-transform">
                <TrendingUp className="w-6 h-6" />
              </span>
              <span className="px-2.5 py-1 text-[10px] font-extrabold rounded-full bg-indigo-50 text-indigo-700 uppercase tracking-widest border border-indigo-100">
                Performance
              </span>
            </div>
            <h3 className="text-lg font-bold text-slate-900 mt-5">High Value Items (Top 50)</h3>
            <p className="text-xs text-slate-500 mt-2 leading-relaxed">
              Ranking top 50 inventory descriptions representing the highest capital values.
            </p>
          </div>

          {/* 3: Zero Value */}
          <div
            onClick={() => runReport("zero_value")}
            className="bg-white border border-slate-200 rounded-2xl p-6 hover:border-indigo-500 hover:shadow-md transition-all cursor-pointer relative group"
          >
            <div className="flex items-start justify-between">
              <span className="p-3 bg-slate-50 text-slate-700 rounded-xl group-hover:scale-105 transition-transform">
                <Ban className="w-6 h-6" />
              </span>
              <span className="px-2.5 py-1 text-[10px] font-extrabold rounded-full bg-slate-100 text-slate-600 uppercase tracking-widest border border-slate-200">
                Attention
              </span>
            </div>
            <h3 className="text-lg font-bold text-slate-900 mt-5">Zero Value Items</h3>
            <p className="text-xs text-slate-500 mt-2 leading-relaxed">
              Track items containing positive physical counts but holding null valuation parameters.
            </p>
          </div>

          {/* 4: Dept Valuation */}
          <div
            onClick={() => runReport("dept_value")}
            className="bg-white border border-slate-200 rounded-2xl p-6 hover:border-indigo-500 hover:shadow-md transition-all cursor-pointer relative group"
          >
            <div className="flex items-start justify-between">
              <span className="p-3 bg-teal-50 text-teal-600 rounded-xl group-hover:scale-105 transition-transform">
                <Building2 className="w-6 h-6" />
              </span>
              <span className="px-2.5 py-1 text-[10px] font-extrabold rounded-full bg-teal-50 text-teal-700 uppercase tracking-widest border border-teal-100">
                Divisions
              </span>
            </div>
            <h3 className="text-lg font-bold text-slate-900 mt-5">Department Valuation</h3>
            <p className="text-xs text-slate-500 mt-2 leading-relaxed">
              Explore aggregate stock assets investments distributed department-wise.
            </p>
          </div>

          {/* 5: Electrical */}
          <div
            onClick={() => runReport("electrical")}
            className="bg-white border border-slate-200 rounded-2xl p-6 hover:border-indigo-500 hover:shadow-md transition-all cursor-pointer relative group"
          >
            <div className="flex items-start justify-between">
              <span className="p-3 bg-amber-50 text-amber-500 rounded-xl group-hover:scale-105 transition-transform">
                <Bolt className="w-6 h-6" />
              </span>
              <span className="px-2.5 py-1 text-[10px] font-extrabold rounded-full bg-amber-50 text-amber-700 uppercase tracking-widest border border-amber-100">
                Category
              </span>
            </div>
            <h3 className="text-lg font-bold text-slate-900 mt-5">Electrical Registry</h3>
            <p className="text-xs text-slate-500 mt-2 leading-relaxed">
              Automatic scanning targeting wire lines, bulbs, switches and electrical spares.
            </p>
          </div>

          {/* 6: Machinery spares */}
          <div
            onClick={() => runReport("machinery")}
            className="bg-white border border-slate-200 rounded-2xl p-6 hover:border-indigo-500 hover:shadow-md transition-all cursor-pointer relative group"
          >
            <div className="flex items-start justify-between">
              <span className="p-3 bg-indigo-50 text-indigo-500 rounded-xl group-hover:scale-105 transition-transform">
                <Hammer className="w-6 h-6 animate-none" />
              </span>
              <span className="px-2.5 py-1 text-[10px] font-extrabold rounded-full bg-indigo-50 text-indigo-700 uppercase tracking-widest border border-indigo-100">
                Category
              </span>
            </div>
            <h3 className="text-lg font-bold text-slate-900 mt-5">Machinery Spares</h3>
            <p className="text-xs text-slate-500 mt-2 leading-relaxed">
              Filtered inventory snapshot of valves, pumps, gear wheels and backup elements.
            </p>
          </div>

          {/* 7: Low Stock */}
          <div
            onClick={() => runReport("low_stock")}
            className="bg-white border border-slate-200 rounded-2xl p-6 hover:border-indigo-500 hover:shadow-md transition-all cursor-pointer relative group"
          >
            <div className="flex items-start justify-between">
              <span className="p-3 bg-orange-50 text-orange-600 rounded-xl group-hover:scale-105 transition-transform">
                <AlertCircle className="w-6 h-6 border-transparent" />
              </span>
              <span className="px-2.5 py-1 text-[10px] font-extrabold rounded-full bg-orange-50 text-orange-700 uppercase tracking-widest border border-orange-100">
                Fewer Alert
              </span>
            </div>
            <h3 className="text-lg font-bold text-slate-900 mt-5">Low Stock Alert</h3>
            <p className="text-xs text-slate-500 mt-2 leading-relaxed">
              Examine live instances currently matching low reserves level (under 20% max capacity).
            </p>
          </div>

          {/* 8: In But Not Out */}
          <div
            onClick={() => {
              setActiveReport("in_but_not_out");
              setReportTitle("In But Not Out Registry");
              setReportSubtitle("Registry filtering items imported to ledger during period range but never issued.");
            }}
            className="bg-white border border-slate-200 rounded-2xl p-6 hover:border-indigo-500 hover:shadow-md transition-all cursor-pointer relative group"
          >
            <div className="flex items-start justify-between">
              <span className="p-3 bg-violet-50 text-violet-600 rounded-xl group-hover:scale-105 transition-transform">
                <Calendar className="w-6 h-6" />
              </span>
              <span className="px-2.5 py-1 text-[10px] font-extrabold rounded-full bg-violet-50 text-violet-700 uppercase tracking-widest border border-violet-100">
                Date Flow
              </span>
            </div>
            <h3 className="text-lg font-bold text-slate-900 mt-5">In But Not Out</h3>
            <p className="text-xs text-slate-500 mt-2 leading-relaxed">
              Find and isolate dormant imports sitting in warehouse stores during selected range.
            </p>
          </div>

          {/* 9: Frequently Reorder */}
          <div
            onClick={() => {
              setActiveReport("frequently_reordered");
              setReportTitle("Frequently Re-Order Items");
              setReportSubtitle("Ranking products ordered on several invoices during dating parameters range.");
            }}
            className="bg-white border border-slate-200 rounded-2xl p-6 hover:border-indigo-500 hover:shadow-md transition-all cursor-pointer relative group"
          >
            <div className="flex items-start justify-between">
              <span className="p-3 bg-rose-50 text-rose-500 rounded-xl group-hover:scale-105 transition-transform">
                <History className="w-6 h-6 bg-transparent" />
              </span>
              <span className="px-2.5 py-1 text-[10px] font-extrabold rounded-full bg-rose-50 text-rose-700 uppercase tracking-widest border border-rose-100">
                Ordering
              </span>
            </div>
            <h3 className="text-lg font-bold text-slate-900 mt-5">Frequently Re-Order</h3>
            <p className="text-xs text-slate-500 mt-2 leading-relaxed">
              Review and audit fast-reordered components within warehouse dating records.
            </p>
          </div>
        </div>
      )}

      {/* REPORT VIEWER MODULE */}
      {activeReport && (
        <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden animate-fadeIn">
          {/* Report toolbar */}
          <div className="px-6 py-5 border-b border-slate-100 bg-slate-55 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <button
                onClick={closeReport}
                className="p-2 border border-slate-200 rounded-xl hover:bg-slate-50 text-slate-600 transition-colors cursor-pointer"
              >
                <ArrowLeft className="w-4 h-4" />
              </button>
              <div>
                <h2 className="text-lg font-extrabold text-slate-950 tracking-tight">{reportTitle}</h2>
                <p className="text-xs text-slate-500 mt-0.5 leading-normal">{reportSubtitle}</p>
              </div>
            </div>

            <div className="flex gap-2">
              <button
                onClick={handleExport}
                className="px-4 py-2 border border-slate-200 text-slate-700 font-bold rounded-xl text-xs flex items-center gap-2 hover:bg-slate-50 transition-colors shadow-xs"
              >
                <FileOutput className="w-3.5 h-3.5 text-slate-400" />
                Export CSV
              </button>
              <button
                onClick={closeReport}
                className="px-4 py-2 bg-slate-900 text-white font-bold rounded-xl text-xs hover:bg-slate-800 transition-colors cursor-pointer"
              >
                Clear view
              </button>
            </div>
          </div>

          {/* Special date inputs block for specific reports */}
          {activeReport === "in_but_not_out" && (
            <div className="p-6 border-b border-slate-100 bg-indigo-50/20 flex flex-col md:flex-row md:items-end gap-4">
              <div className="flex-grow">
                <label className="block text-[10px] font-extrabold uppercase text-slate-400 tracking-wider mb-1.5">
                  Import Dating Bracket Date
                </label>
                <div className="flex gap-2">
                  <input
                    type="date"
                    value={ibnoDates.start}
                    onChange={(e) => setIbnoDates((prev) => ({ ...prev, start: e.target.value }))}
                    className="w-full text-xs font-semibold border border-slate-200 rounded-xl px-3.5 py-2 outline-none focus:ring-2 focus:ring-indigo-500 bg-white"
                  />
                  <input
                    type="date"
                    value={ibnoDates.end}
                    onChange={(e) => setIbnoDates((prev) => ({ ...prev, end: e.target.value }))}
                    className="w-full text-xs font-semibold border border-slate-200 rounded-xl px-3.5 py-2 outline-none focus:ring-2 focus:ring-indigo-500 bg-white"
                  />
                </div>
              </div>
              <button
                onClick={runInButNotOutReport}
                className="px-5 py-2.5 bg-indigo-650 bg-indigo-650 hover:bg-indigo-700 text-white font-bold rounded-xl text-xs flex items-center justify-center gap-2"
              >
                <Calendar className="w-4 h-4" />
                Compile Report Data
              </button>
            </div>
          )}

          {activeReport === "frequently_reordered" && (
            <div className="p-6 border-b border-slate-100 bg-indigo-50/20 flex flex-col md:flex-row md:items-end gap-4">
              <div className="flex-grow">
                <label className="block text-[10px] font-extrabold uppercase text-slate-400 tracking-wider mb-1.5">
                  Registry Invoices Bracket Dating
                </label>
                <div className="flex gap-2">
                  <input
                    type="date"
                    value={froDates.start}
                    onChange={(e) => setFroDates((prev) => ({ ...prev, start: e.target.value }))}
                    className="w-full text-xs font-semibold border border-slate-200 rounded-xl px-3.5 py-2 outline-none focus:ring-2 focus:ring-indigo-500 bg-white"
                  />
                  <input
                    type="date"
                    value={froDates.end}
                    onChange={(e) => setFroDates((prev) => ({ ...prev, end: e.target.value }))}
                    className="w-full text-xs font-semibold border border-slate-200 rounded-xl px-3.5 py-2 outline-none focus:ring-2 focus:ring-indigo-500 bg-white"
                  />
                </div>
              </div>
              <button
                onClick={runFrequentlyReorderedReport}
                className="px-5 py-2.5 bg-indigo-650 hover:bg-indigo-700 text-white font-bold rounded-xl text-xs flex items-center justify-center gap-2 animate-pulseHover"
              >
                <Calendar className="w-4 h-4" />
                Compile Registry Data
              </button>
            </div>
          )}

          {/* Grid View table */}
          <div className="overflow-x-auto">
            {loading ? (
              <div className="py-24 text-center">
                <div className="flex flex-col items-center justify-center gap-3">
                  <div className="w-8 h-8 rounded-full border-2 border-indigo-600 border-t-transparent animate-spin" />
                  <span className="text-xs font-bold text-slate-400">Performing math on database view...</span>
                </div>
              </div>
            ) : activeReport === "dept_value" ? (
              <table className="w-full text-slate-650 text-sm">
                <thead className="bg-slate-50 text-[10px] uppercase font-bold tracking-wider text-slate-400 border-b border-slate-100">
                  <tr>
                    <th className="px-6 py-4 text-left">Department Division Title</th>
                    <th className="px-6 py-4 text-left">Valued Asset Sum (₹)</th>
                    <th className="px-6 py-4 text-right">Investment Partition Percentage</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {reportItems.length > 0 ? (
                    reportItems.map((r, i) => {
                      const totalSum = reportItems.reduce((s, it) => s + (it.stock_value || 0), 0);
                      const pct = totalSum > 0 ? ((r.stock_value / totalSum) * 100).toFixed(2) : "0.00";

                      return (
                        <tr key={i} className="hover:bg-slate-50/60 transition-colors font-semibold">
                          <td className="px-6 py-4 text-slate-900 font-bold">{r.department}</td>
                          <td className="px-6 py-4 font-black text-slate-950">{formatCurrency(r.stock_value)}</td>
                          <td className="px-6 py-4 text-right whitespace-nowrap">
                            <span className="inline-flex px-3 py-1 bg-slate-100 text-slate-850 text-xs rounded-full border border-slate-200">
                              {pct}%
                            </span>
                          </td>
                        </tr>
                      );
                    })
                  ) : (
                    <tr>
                      <td colSpan={3} className="py-16 text-center text-slate-400">
                        No department valuation records resolved.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            ) : activeReport === "in_but_not_out" ? (
              <table className="w-full text-slate-650 text-sm">
                <thead className="bg-slate-50 text-[10px] uppercase font-bold tracking-wider text-slate-400 border-b border-slate-100">
                  <tr>
                    <th className="px-6 py-4 text-left">Timestamp</th>
                    <th className="px-6 py-4 text-left">SKU</th>
                    <th className="px-6 py-4 text-left">Date Received</th>
                    <th className="px-6 py-4 text-left">Summed Inflow Qty</th>
                    <th className="px-6 py-4 text-left">Item Name description</th>
                    <th className="px-6 py-4 text-left">Estimated Asset Value</th>
                    <th className="px-6 py-4 text-right">Department</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {reportItems.length > 0 ? (
                    reportItems.map((item, i) => (
                      <tr key={i} className="hover:bg-slate-50/60 transition-colors font-medium">
                        <td className="px-6 py-4 text-xs font-semibold text-slate-400">
                          {formatDateTime(item.timestamp)}
                        </td>
                        <td className="px-6 py-4 text-slate-900 font-bold whitespace-nowrap">{item.sku}</td>
                        <td className="px-6 py-4 whitespace-nowrap">{formatDate(item.date)}</td>
                        <td className="px-6 py-4 font-extrabold text-slate-800">{formatNumber(item.quantity)}</td>
                        <td className="px-6 py-4 font-bold text-slate-900">{item.item_name}</td>
                        <td className="px-6 py-4 font-black text-slate-950">{formatCurrency(item.stock_value)}</td>
                        <td className="px-6 py-4 text-right text-xs text-slate-500 font-semibold">{item.department}</td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={7} className="py-24 text-center text-slate-400">
                        No dormant incoming stock sits in records bounds. Make sure to compile values using date panel.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            ) : activeReport === "frequently_reordered" ? (
              <table className="w-full text-slate-650 text-sm">
                <thead className="bg-slate-50 text-[10px] uppercase font-bold tracking-wider text-slate-400 border-b border-slate-100">
                  <tr>
                    <th className="px-6 py-4 text-left">Timestamp</th>
                    <th className="px-6 py-4 text-left">SKU</th>
                    <th className="px-6 py-4 text-left">Date Ordered</th>
                    <th className="px-6 py-4 text-left">Quantity</th>
                    <th className="px-6 py-4 text-left">Item Name description</th>
                    <th className="px-6 py-4 text-left">Value (₹)</th>
                    <th className="px-6 py-4 text-left">Department</th>
                    <th className="px-6 py-4 text-right">Count Orders</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {reportItems.length > 0 ? (
                    reportItems.map((item, i) => (
                      <tr key={i} className="hover:bg-slate-50/60 transition-colors font-medium">
                        <td className="px-6 py-4 text-xs text-slate-400 font-semibold">
                          {formatDateTime(item.timestamp)}
                        </td>
                        <td className="px-6 py-4 text-slate-900 font-bold whitespace-nowrap">{item.sku}</td>
                        <td className="px-6 py-4 whitespace-nowrap">{formatDate(item.date)}</td>
                        <td className="px-6 py-4 font-bold text-slate-800">{formatNumber(item.quantity)}</td>
                        <td className="px-6 py-4 font-bold text-slate-900">{item.item_name}</td>
                        <td className="px-6 py-4 font-extrabold text-slate-950">{formatCurrency(item.stock_value)}</td>
                        <td className="px-6 py-4 text-slate-500 font-semibold">{item.department}</td>
                        <td className="px-6 py-4 text-right font-black whitespace-nowrap">
                          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-extrabold bg-indigo-50 text-indigo-700 border border-indigo-100">
                            {item.frequency} times ordered
                          </span>
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={8} className="py-24 text-center text-slate-400">
                        No fast-ordering triggers tracked inside date range values. Make sure to compile values using date panel.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            ) : (
              <table className="w-full text-slate-650 text-sm">
                <thead className="bg-slate-50 text-[10px] uppercase font-bold tracking-wider text-slate-400 border-b border-slate-100">
                  <tr>
                    <th className="px-6 py-4 text-left">SKU</th>
                    <th className="px-6 py-4 text-left">Item Name description</th>
                    <th className="px-6 py-4 text-left">Department division</th>
                    <th className="px-6 py-4 text-left">Under physical qty</th>
                    <th className="px-6 py-3.5 text-right">Summed valuation value (₹)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {reportItems.length > 0 ? (
                    reportItems.map((r) => (
                      <tr key={r.sku} className="hover:bg-slate-50/60 transition-colors font-medium">
                        <td className="px-6 py-3.5 font-bold text-slate-900 whitespace-nowrap">{r.sku}</td>
                        <td className="px-6 py-3 text-slate-900 font-bold max-w-sm">{r.item_name}</td>
                        <td className="px-6 py-3.5 text-slate-500 font-semibold whitespace-nowrap">{r.department}</td>
                        <td className="px-6 py-3.5 font-extrabold text-slate-800 whitespace-nowrap">
                          {formatNumber(r.quantity)}
                        </td>
                        <td className="px-6 py-3.5 font-black text-slate-950 text-right whitespace-nowrap">
                          {formatCurrency(r.stock_value)}
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={5} className="py-24 text-center text-slate-400">
                        Zero items match specified report filters state.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            )}
          </div>

          <div className="px-6 py-4 bg-slate-50 border-t border-slate-100 text-slate-400 text-xs font-bold uppercase tracking-wider flex items-center justify-between">
            <span>Generated locally over live snapshots metadata</span>
            {activeReport !== "dept_value" && (
              <span className="text-slate-600">Total matched: {reportItems.length} lines</span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

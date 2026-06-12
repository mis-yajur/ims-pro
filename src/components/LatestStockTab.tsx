import React, { useState, useEffect } from "react";
import { fetchAllRows, sbGet, sbRpc, formatCurrency, formatNumber, recalculateAndPatchLatestStock } from "../utils/supabase";
import { LatestStockItem, Transaction } from "../types";
import { DEPARTMENTS_LIST } from "../constants";
import { FileOutput, RefreshCw, Search, ShieldCheck, Tag, XCircle, ChevronLeft, ChevronRight } from "lucide-react";

interface ProcessedStockItem extends LatestStockItem {
  calculatedStatus: string;
}

export default function LatestStockTab() {
  const [filters, setFilters] = useState({
    sku: "",
    itemName: "",
    department: "All",
    status: "All",
    minQty: "",
    maxQty: "",
    minVal: "",
    maxVal: "",
  });

  const [stockItems, setStockItems] = useState<ProcessedStockItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [page, setPage] = useState(1);
  const [totalCount, setTotalCount] = useState(0);

  // Autocomplete names list
  const [itemNamesList, setItemNamesList] = useState<string[]>([]);

  useEffect(() => {
    // Run all calculations automatically to synchronize the database with master values
    const runInitialSync = async () => {
      try {
        await sbRpc("run_all_calculations");
      } catch (err) {
        console.warn("Silent background calculations failed, loading static list instead:", err);
      } finally {
        loadClosingStockData(1);
      }
    };

    runInitialSync();
    loadItemNames();
  }, []);

  async function loadItemNames() {
    try {
      const { data } = await sbGet("latest_stock", "?select=item_name&order=item_name.asc");
      const names = Array.from(new Set(data.map((r: any) => r.item_name).filter(Boolean))) as string[];
      setItemNamesList(names);
    } catch (e) {
      console.error(e);
    }
  }

  async function loadClosingStockData(p = 1) {
    setLoading(true);
    setPage(p);
    try {
      // Direct self-heal: if the user specifies an exact SKU in the search parameter, recalculate & sync it first!
      if (filters.sku) {
        const exactSku = filters.sku.trim();
        if (exactSku) {
          try {
            await recalculateAndPatchLatestStock(exactSku);
          } catch (e) {
            console.warn(`Pre-load self-heal skipped for partial/invalid SKU "${exactSku}":`, e);
          }
        }
      }

      // Fetch manual Transactions
      const io: Transaction[] = await fetchAllRows("in_out_manual", "*");

      // Filter to find all active SKUs in the last 6 months list
      const activeSkusInLast6Months = new Set<string>();
      const sixMonthsAgo = new Date();
      sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);

      io.forEach((tx) => {
        if (tx.sku && tx.date) {
          const txDate = new Date(tx.date);
          if (txDate >= sixMonthsAgo) {
            activeSkusInLast6Months.add(tx.sku);
          }
        }
      });

      let q = "?select=*";
      if (filters.sku) q += `&sku=ilike.*${filters.sku}*`;
      if (filters.itemName) q += `&item_name=ilike.*${filters.itemName}*`;
      if (filters.department !== "All") q += `&department=eq.${encodeURIComponent(filters.department)}`;
      if (filters.minQty) q += `&quantity=gte.${filters.minQty}`;
      if (filters.maxQty) q += `&quantity=lte.${filters.maxQty}`;
      if (filters.minVal) q += `&stock_value=gte.${filters.minVal}`;
      if (filters.maxVal) q += `&stock_value=lte.${filters.maxVal}`;

      // Fetch all dynamic matching rows first to apply status filtering since status is generated on the client
      const allMatching: LatestStockItem[] = await fetchAllRows("latest_stock", "*", q);

      // Filter so we only show items that are active in the last 6 months (this item in or out)
      const activeMatching = allMatching.filter((item) => activeSkusInLast6Months.has(item.sku));

      // Calculate client-side average consumption, safety factor and status
      const processed: ProcessedStockItem[] = activeMatching.map((item) => {
        const txsForSku = io.filter(tx => tx.sku === item.sku);

        // Find average daily consumption based on manual "Out" transactions
        let totalConsumed = 0;
        let minDateStr = "";
        let maxDateStr = "";
        txsForSku.forEach(tx => {
          if (tx.in_out === "Out") {
            totalConsumed += Number(tx.quantity) || 0;
            const dStr = tx.date || tx.timestamp;
            if (dStr) {
              if (!minDateStr || dStr < minDateStr) minDateStr = dStr;
              if (!maxDateStr || dStr > maxDateStr) maxDateStr = dStr;
            }
          }
        });

        let daysCount = 1;
        if (minDateStr && maxDateStr) {
          const minD = new Date(minDateStr);
          const maxD = new Date(maxDateStr);
          const diffTime = Math.abs(maxD.getTime() - minD.getTime());
          const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
          daysCount = Math.max(diffDays + 1, 1);
        }

        const calculatedAvgConsumption = totalConsumed > 0 ? (totalConsumed / daysCount) : (Number(item.avg_daily_consumption) || 0);

        // Calculate safety stock and reorder point on the fly
        const leadTime = Number(item.lead_time) || 5;
        const safetyStock = calculatedAvgConsumption * 0.4 * leadTime; // peaks to average usage diff
        const reorderLevel = (calculatedAvgConsumption * leadTime) + safetyStock;

        // Overstock limit - can be derived from item.max_level, or we can use reorderLevel * 2 or calculatedAvgConsumption * 20 days
        const maxLevel = Number(item.max_level) || (reorderLevel > 0 ? reorderLevel * 2 : 100);

        const currentStock = Number(item.quantity) || 0;
        const isOverstocked = maxLevel > 0 && currentStock > maxLevel;

        let calculatedStatus = "Normal";
        if (currentStock <= 0) {
          calculatedStatus = "Production Stop";
        } else if (currentStock < safetyStock) {
          calculatedStatus = "Critical";
        } else if (currentStock <= reorderLevel) {
          calculatedStatus = "Purchase Required";
        } else if (isOverstocked) {
          calculatedStatus = "Overstock";
        }

        return {
          ...item,
          avg_daily_consumption: calculatedAvgConsumption,
          safety_factor: safetyStock,
          moq: reorderLevel, // reorder point column, MOQ/Reorder point
          max_level: maxLevel,
          calculatedStatus
        };
      });

      let filtered = processed;
      if (filters.status !== "All") {
        filtered = processed.filter((item) => {
          return item.calculatedStatus === filters.status;
        });
      }

      // Keep default sort by Quantity descending (High to Low)
      filtered = [...filtered].sort((a, b) => {
        const qtyA = Number(a.quantity || 0);
        const qtyB = Number(b.quantity || 0);
        return qtyB - qtyA;
      });

      setTotalCount(filtered.length);

      const offset = (p - 1) * 20;
      const paginationSliced = filtered.slice(offset, offset + 20);
      setStockItems(paginationSliced);
    } catch (e) {
      console.error("Latest stock fetch failed:", e);
    } finally {
      setLoading(false);
    }
  }

  function handleFilterChange(field: string, val: string) {
    setFilters((prev) => ({ ...prev, [field]: val }));
  }

  function handleResetFilters() {
    setFilters({
      sku: "",
      itemName: "",
      department: "All",
      status: "All",
      minQty: "",
      maxQty: "",
      minVal: "",
      maxVal: "",
    });
    setPage(1);
    // Directly call the load with zeroed filter values after status clears
    setTimeout(() => {
      loadClosingStockData(1);
    }, 10);
  }

  async function handleExportCSV() {
    setLoading(true);
    try {
      const data = await fetchAllRows("latest_stock");
      let csv = "SKU,Item Name,Unit,Department,Quantity,Stock Value,Price,Avg Daily Consumption,Lead Time (Days),Safety Factor,MOQ,Max Level,Status\n";

      data.forEach((r) => {
        const qty = Number(r.quantity) || 0;
        const lead = Number(r.lead_time) || 5;
        const avg = Number(r.avg_daily_consumption) || 0;
        const safety = avg * 0.4 * lead;
        const reorder = (avg * lead) + safety;
        const maxLevel = Number(r.max_level) || (reorder > 0 ? reorder * 2 : 100);
        const status = getStockStatus(qty, safety, reorder, maxLevel);

        csv += `"${r.sku}","${r.item_name}","${r.unit || ""}","${r.department || ""}",${r.quantity},${r.stock_value},${r.price},${avg},${lead},${safety},${reorder},${maxLevel},"${status.toUpperCase()}"\n`;
      });

      const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
      const link = document.createElement("a");
      link.setAttribute("href", URL.createObjectURL(blob));
      link.setAttribute("download", `Latest_Stock_${new Date().toISOString().split("T")[0]}.csv`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } catch (e) {
      console.error("Latest stock export failed:", e);
    } finally {
      setLoading(false);
    }
  }

  async function handleRefreshAndSync() {
    setSyncing(true);
    try {
      await sbRpc("run_all_calculations");
    } catch (err) {
      console.warn("Silent background calculations failed:", err);
    } finally {
      setSyncing(false);
      loadClosingStockData(1);
    }
  }

  function getStockStatus(qty: number, safetyStock: number, reorderLevel: number, maxLevel?: number): string {
    if (qty <= 0) return "Production Stop";
    if (qty < safetyStock) return "Critical";
    if (qty <= reorderLevel) return "Purchase Required";
    if (maxLevel && qty > maxLevel) return "Overstock";
    return "Normal";
  }

  const totalPages = Math.ceil(totalCount / 20);

  return (
    <div className="space-y-6 animate-fadeIn pb-12">
      {/* Tab Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-extrabold text-slate-900 tracking-tight flex items-center gap-3">
            Latest Stock
          </h1>
          <p className="text-slate-500 mt-2">Comprehensive directory of warehouse stock states, pricing averages, and dynamic replenishment boundaries.</p>
        </div>
        <div className="flex items-center gap-3 text-sm">
          <button
            onClick={handleRefreshAndSync}
            disabled={syncing || loading}
            className="px-4 py-2.5 bg-white border border-slate-200 text-slate-700 font-semibold rounded-xl hover:bg-slate-50 transition-colors flex items-center gap-2 shadow-sm disabled:opacity-50"
          >
            <RefreshCw className={`w-4 h-4 text-slate-400 ${syncing ? "animate-spin text-indigo-600" : ""}`} />
            {syncing ? "Syncing..." : "Refresh List"}
          </button>
          <button
            onClick={handleExportCSV}
            className="px-5 py-2.5 bg-indigo-600 text-white font-semibold rounded-xl hover:bg-indigo-700 transition-all flex items-center gap-2 shadow-md hover:shadow-indigo-100"
          >
            <FileOutput className="w-4 h-4" />
            Export CSV
          </button>
        </div>
      </div>

      {/* Dynamic Advanced Filters Panel */}
      <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm">
        <h3 className="text-xs font-bold uppercase text-slate-400 tracking-wider mb-4 flex items-center gap-2">
          <Search className="w-4 h-4" />
          Filter Latest Stock
        </h3>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
          <div>
            <label className="block text-xs font-bold text-slate-500 uppercase tracking-widest mb-1.5">SKU Code</label>
            <input
              type="text"
              value={filters.sku}
              onChange={(e) => handleFilterChange("sku", e.target.value)}
              placeholder="Search SKU..."
              className="w-full text-sm border border-slate-200 rounded-xl px-3.5 py-2 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none"
            />
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-500 uppercase tracking-widest mb-1.5">Item Description</label>
            <input
              type="text"
              value={filters.itemName}
              onChange={(e) => handleFilterChange("itemName", e.target.value)}
              placeholder="Search descriptions..."
              list="tabStockNamesAutocomp"
              className="w-full text-sm border border-slate-200 rounded-xl px-3.5 py-2 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none"
            />
            <datalist id="tabStockNamesAutocomp">
              {itemNamesList.map((name, idx) => (
                <option key={idx} value={name} />
              ))}
            </datalist>
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-500 uppercase tracking-widest mb-1.5">Department</label>
            <select
              value={filters.department}
              onChange={(e) => handleFilterChange("department", e.target.value)}
              className="w-full text-sm border border-slate-200 rounded-xl px-3.5 py-2 bg-white outline-none focus:ring-2 focus:ring-indigo-500"
            >
              <option value="All">All Departments</option>
              {DEPARTMENTS_LIST.map((dept) => (
                <option key={dept} value={dept}>
                  {dept}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-500 uppercase tracking-widest mb-1.5">Stock Reserves Level</label>
            <select
              value={filters.status}
              onChange={(e) => handleFilterChange("status", e.target.value)}
              className="w-full text-sm border border-slate-200 rounded-xl px-3.5 py-2 bg-white outline-none focus:ring-2 focus:ring-indigo-500"
            >
              <option value="All">All Levels</option>
              <option value="Production Stop">Production Stop (Zero)</option>
              <option value="Critical">Critical (Below Safety Stock)</option>
              <option value="Purchase Required">Purchase Required (At Reorder Level)</option>
              <option value="Normal">Normal (Above Reorder Level)</option>
              <option value="Overstock">Overstock (Above Max Level)</option>
            </select>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-bold text-slate-500 uppercase tracking-widest mb-1.5">Quantity Bounds (Unit Reserves)</label>
            <div className="flex gap-2">
              <input
                type="number"
                value={filters.minQty}
                onChange={(e) => handleFilterChange("minQty", e.target.value)}
                placeholder="Min Qty"
                className="w-full text-sm border border-slate-200 rounded-xl px-3.5 py-2 outline-none focus:ring-2 focus:ring-indigo-500"
              />
              <input
                type="number"
                value={filters.maxQty}
                onChange={(e) => handleFilterChange("maxQty", e.target.value)}
                placeholder="Max Qty"
                className="w-full text-sm border border-slate-200 rounded-xl px-3.5 py-2 outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-500 uppercase tracking-widest mb-1.5">Valuation Range (₹ Value)</label>
            <div className="flex gap-2">
              <input
                type="number"
                value={filters.minVal}
                onChange={(e) => handleFilterChange("minVal", e.target.value)}
                placeholder="Min Value (₹)"
                className="w-full text-sm border border-slate-200 rounded-xl px-3.5 py-2 outline-none focus:ring-2 focus:ring-indigo-500"
              />
              <input
                type="number"
                value={filters.maxVal}
                onChange={(e) => handleFilterChange("maxVal", e.target.value)}
                placeholder="Max Value (₹)"
                className="w-full text-sm border border-slate-200 rounded-xl px-3.5 py-2 outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
          </div>
        </div>

        <div className="mt-5 pt-4 border-t border-slate-100 flex justify-between items-center bg-slate-50/20">
          <span className="text-xs font-bold text-indigo-600">
            {totalCount} item records match search filters criteria
          </span>
          <div className="flex gap-2">
            <button
              onClick={handleResetFilters}
              className="px-4 py-2 border border-slate-200 text-slate-600 font-semibold rounded-xl text-xs hover:bg-slate-50 transition-colors cursor-pointer"
            >
              Reset Filters
            </button>
            <button
              onClick={() => loadClosingStockData(1)}
              className="px-5 py-2.5 bg-slate-900 text-white font-semibold rounded-xl text-xs hover:bg-slate-800 transition-colors"
            >
              Apply Stock Filter
            </button>
          </div>
        </div>
      </div>

      {/* Snapshot Grid Data */}
      <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-slate-600 text-sm">
            <thead className="bg-slate-50 text-[10px] uppercase font-bold tracking-wider text-slate-400 border-b border-slate-100">
              <tr>
                <th className="px-6 py-4 text-left">SKU</th>
                <th className="px-6 py-4 text-left">Description</th>
                <th className="px-6 py-4 text-left">Unit</th>
                <th className="px-6 py-4 text-left">Department name</th>
                <th className="px-6 py-4 text-left">Reserves Qty</th>
                <th className="px-6 py-3.5 text-left">Valuation Value</th>
                <th className="px-6 py-4 text-left">Average Price</th>
                <th className="px-6 py-4 text-left">ADC (Daily Issue)</th>
                <th className="px-6 py-4 text-left">Lead Days</th>
                <th className="px-6 py-4 text-left">Safety Level</th>
                <th className="px-6 py-4 text-left">MOQ Reorder Pt</th>
                <th className="px-6 py-4 text-left">Target Max Level</th>
                <th className="px-6 py-4 text-right">Status State</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr>
                  <td colSpan={13} className="py-24 text-center">
                    <div className="flex flex-col items-center justify-center gap-3">
                      <div className="w-8 h-8 rounded-full border-2 border-indigo-600 border-t-transparent animate-spin" />
                      <span className="text-xs font-semibold text-slate-400">Loading master stock sheets indexes...</span>
                    </div>
                  </td>
                </tr>
              ) : stockItems.length > 0 ? (
                stockItems.map((item) => {
                  const status = item.calculatedStatus || "Normal";
                  const badges: { [key: string]: string } = {
                    "Production Stop": "bg-rose-100 text-rose-800 border-rose-200 font-extrabold",
                    "Critical": "bg-orange-100 text-orange-800 border-orange-200 font-extrabold animate-pulse",
                    "Purchase Required": "bg-amber-100 text-amber-800 border-amber-200 font-extrabold",
                    "Overstock": "bg-indigo-100 text-indigo-800 border-indigo-200 font-extrabold",
                    "Normal": "bg-emerald-100 text-emerald-800 border-emerald-200 font-bold",
                  };

                  let rowBgClass = "hover:bg-slate-50/60";
                  if (status === "Production Stop") {
                    rowBgClass = "bg-rose-50/40 hover:bg-rose-100/30 text-slate-900";
                  } else if (status === "Critical") {
                    rowBgClass = "bg-orange-50/30 hover:bg-orange-100/25 text-slate-900";
                  } else if (status === "Purchase Required") {
                    rowBgClass = "bg-amber-50/20 hover:bg-amber-100/20 text-slate-900";
                  } else if (status === "Overstock") {
                    rowBgClass = "bg-indigo-50/20 hover:bg-indigo-100/20 text-slate-900";
                  }

                  return (
                    <tr key={item.sku} className={`transition-colors font-medium ${rowBgClass}`}>
                      <td className="px-6 py-3.5 font-bold text-slate-900 whitespace-nowrap">{item.sku}</td>
                      <td className="px-6 py-3 text-slate-900 font-bold max-w-xs">{item.item_name}</td>
                      <td className="px-6 py-3.5 text-slate-500 whitespace-nowrap">{item.unit}</td>
                      <td className="px-6 py-3.5 text-slate-500 whitespace-nowrap">{item.department}</td>
                      <td className="px-6 py-3.5 font-extrabold text-slate-800 whitespace-nowrap">
                        {formatNumber(item.quantity)}
                      </td>
                      <td className="px-6 py-3 font-extrabold text-slate-900 whitespace-nowrap">
                        {formatCurrency(item.stock_value)}
                      </td>
                      <td className="px-6 py-3.5 text-slate-700 whitespace-nowrap">{formatCurrency(item.price)}</td>
                      <td className="px-6 py-3.5 text-slate-600 font-semibold whitespace-nowrap">
                        {formatNumber(item.avg_daily_consumption, 4)}
                      </td>
                      <td className="px-6 py-3.5 text-xs text-slate-400 font-semibold whitespace-nowrap">
                        {item.lead_time || 7} days
                      </td>
                      <td className="px-6 py-3.5 text-slate-600 whitespace-nowrap">
                        {formatNumber(item.safety_factor, 2)}
                      </td>
                      <td className="px-6 py-3.5 text-slate-800 whitespace-nowrap">{formatNumber(item.moq)}</td>
                      <td className="px-6 py-3.5 text-slate-800 whitespace-nowrap">{formatNumber(item.max_level)}</td>
                      <td className="px-6 py-3.5 text-right whitespace-nowrap">
                        <span
                          className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-[10px] font-extrabold border uppercase tracking-wider ${
                            badges[status] || ""
                          }`}
                        >
                          {status.replace("-", " ")}
                        </span>
                      </td>
                    </tr>
                  );
                })
              ) : (
                <tr>
                  <td colSpan={13} className="py-24 text-center">
                    <div className="flex flex-col items-center justify-center gap-2">
                      <XCircle className="w-10 h-10 text-slate-300" />
                      <span className="text-sm font-bold text-slate-700">Empty Inventory Grid Matches</span>
                      <span className="text-xs text-slate-400">Change searching bounds parameters.</span>
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Dynamic Pagination Bar */}
        {!loading && totalPages > 1 && (
          <div className="px-6 py-4.5 border-t border-slate-100 bg-slate-50 flex items-center justify-between text-xs font-semibold text-slate-500">
            <span>
              Page {page} of {totalPages} ({totalCount} items matching query)
            </span>
            <div className="flex items-center gap-1">
              <button
                onClick={() => loadClosingStockData(page - 1)}
                disabled={page <= 1}
                className="p-2 border border-slate-200 rounded-xl bg-white text-slate-500 hover:bg-slate-50 disabled:opacity-50 transition-colors"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              {Array.from({ length: totalPages }, (_, i) => i + 1)
                .filter((pNum) => Math.abs(pNum - page) <= 2 || pNum === 1 || pNum === totalPages)
                .map((pNum, idx, arr) => {
                  const prev = arr[idx - 1];
                  return (
                    <React.Fragment key={pNum}>
                      {prev && pNum - prev > 1 && <span className="px-1 text-slate-400">...</span>}
                      <button
                        onClick={() => loadClosingStockData(pNum)}
                        className={`w-8 h-8 rounded-xl font-bold border transition-all ${
                          pNum === page
                            ? "bg-indigo-600 border-indigo-600 text-white shadow-md shadow-indigo-100"
                            : "border-slate-200 bg-white hover:bg-slate-50 text-slate-500"
                        }`}
                      >
                        {pNum}
                      </button>
                    </React.Fragment>
                  );
                })}
              <button
                onClick={() => loadClosingStockData(page + 1)}
                disabled={page >= totalPages}
                className="p-2 border border-slate-200 rounded-xl bg-white text-slate-500 hover:bg-slate-50 disabled:opacity-50 transition-colors"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

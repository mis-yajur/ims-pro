import React, { useState, useEffect } from "react";
import { fetchAllRows, sbGet, formatCurrency, formatNumber, recalculateAndPatchLatestStock } from "../utils/supabase";
import { LatestStockItem } from "../types";
import { DEPARTMENTS_LIST } from "../constants";
import { FileOutput, RefreshCw, Search, ShieldCheck, Tag, XCircle, ChevronLeft, ChevronRight } from "lucide-react";

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

  const [stockItems, setStockItems] = useState<LatestStockItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [totalCount, setTotalCount] = useState(0);

  // Autocomplete names list
  const [itemNamesList, setItemNamesList] = useState<string[]>([]);

  useEffect(() => {
    loadClosingStockData(1);
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

      let q = "?select=*&order=quantity.desc";
      if (filters.sku) q += `&sku=ilike.*${filters.sku}*`;
      if (filters.itemName) q += `&item_name=ilike.*${filters.itemName}*`;
      if (filters.department !== "All") q += `&department=eq.${encodeURIComponent(filters.department)}`;
      if (filters.minQty) q += `&quantity=gte.${filters.minQty}`;
      if (filters.maxQty) q += `&quantity=lte.${filters.maxQty}`;
      if (filters.minVal) q += `&stock_value=gte.${filters.minVal}`;
      if (filters.maxVal) q += `&stock_value=lte.${filters.maxVal}`;

      // Fetch all dynamic matching rows first to apply status filtering since status is generated on the client
      const allMatching: LatestStockItem[] = await fetchAllRows("latest_stock", "*", q);

      let filtered = allMatching;
      if (filters.status !== "All") {
        filtered = allMatching.filter((item) => {
          const status = getStockStatus(Number(item.quantity || 0), Number(item.max_level || 0));
          return status === filters.status;
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
    // Directly call the load with zeroed filter values
    setTimeout(() => {
      setLoading(true);
      fetchAllRows("latest_stock", "*", "?select=*&order=quantity.desc").then((data) => {
        const sortedData = [...data].sort((a, b) => {
          const qtyA = Number(a.quantity || 0);
          const qtyB = Number(b.quantity || 0);
          return qtyB - qtyA;
        });
        setTotalCount(sortedData.length);
        setStockItems(sortedData.slice(0, 20));
        setLoading(false);
      });
    }, 10);
  }

  async function handleExportCSV() {
    setLoading(true);
    try {
      const data = await fetchAllRows("latest_stock");
      let csv = "SKU,Item Name,Unit,Department,Quantity,Stock Value,Price,Avg Daily Consumption,Lead Time (Days),Safety Factor,MOQ,Max Level,Status\n";

      data.forEach((r) => {
        const qty = Number(r.quantity) || 0;
        const maxL = Number(r.max_level) || 0;
        const status = getStockStatus(qty, maxL);

        csv += `"${r.sku}","${r.item_name}","${r.unit || ""}","${r.department || ""}",${r.quantity},${r.stock_value},${r.price},${r.avg_daily_consumption},${r.lead_time},${r.safety_factor},${r.moq},${r.max_level},"${status.toUpperCase()}"\n`;
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

  function getStockStatus(qty: number, maxLevel: number): string {
    if (qty <= 0) return "out-of-stock";
    if (qty <= maxLevel * 0.1) return "critical";
    if (qty <= maxLevel * 0.3) return "low";
    if (qty <= maxLevel * 0.7) return "normal";
    return "high";
  }

  const totalPages = Math.ceil(totalCount / 20);

  return (
    <div className="space-y-6 animate-fadeIn pb-12">
      {/* Tab Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-extrabold text-slate-900 tracking-tight flex items-center gap-3">
            Reserve Snapshot
          </h1>
          <p className="text-slate-500 mt-2">Comprehensive directory of warehouse stock states, pricing averages, and dynamic replenishment boundaries.</p>
        </div>
        <div className="flex items-center gap-3 text-sm">
          <button
            onClick={() => loadClosingStockData(1)}
            className="px-4 py-2.5 bg-white border border-slate-200 text-slate-700 font-semibold rounded-xl hover:bg-slate-50 transition-colors flex items-center gap-2 shadow-sm"
          >
            <RefreshCw className="w-4 h-4 text-slate-400" />
            Refresh List
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
          Filter Reserve Snapshot
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
              <option value="out-of-stock">Out of Stock (Zero)</option>
              <option value="critical">Critical (≤ 10%)</option>
              <option value="low">Low (≤ 30%)</option>
              <option value="normal">Active (≤ 70%)</option>
              <option value="high">High Inventory (70%+)</option>
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
                  const status = getStockStatus(Number(item.quantity || 0), Number(item.max_level || 0));
                  const badges: { [key: string]: string } = {
                    "out-of-stock": "bg-rose-50 text-rose-700 border-rose-100",
                    critical: "bg-orange-50 text-orange-700 border-orange-100",
                    low: "bg-amber-50 text-amber-700 border-amber-100",
                    normal: "bg-emerald-50 text-emerald-700 border-emerald-100",
                    high: "bg-indigo-50 text-indigo-700 border-indigo-100",
                  };

                  return (
                    <tr key={item.sku} className="hover:bg-slate-50/60 transition-colors font-medium">
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

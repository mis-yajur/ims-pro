import React, { useState, useEffect } from "react";
import { fetchAllRows, sbGet, formatCurrency, formatNumber } from "../utils/supabase";
import { LatestStockItem } from "../types";
import { DEPARTMENTS_LIST } from "../constants";
import { AlertCircle, AlertOctagon, CheckCircle2, FileOutput, RefreshCw, ShieldAlert, XCircle, ChevronLeft, ChevronRight } from "lucide-react";

export default function SafetyFactorTab() {
  const [filters, setFilters] = useState({
    sku: "",
    itemName: "",
    department: "All",
    minSF: "",
    maxSF: "",
  });

  const [items, setItems] = useState<LatestStockItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [totalCount, setTotalCount] = useState(0);

  // Stats Card Counts
  const [cardCounts, setCardCounts] = useState({ critical: 0, low: 0, normal: 0, high: 0 });

  // Range min/max values for heatmap computation
  const [heatmapBounds, setHeatmapBounds] = useState({ min: 0, max: 10 });

  // Autocomplete names list
  const [itemNamesList, setItemNamesList] = useState<string[]>([]);

  useEffect(() => {
    loadSafetyFactorData(1);
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

  async function loadSafetyFactorData(p = 1) {
    setLoading(true);
    setPage(p);
    try {
      let q = "?select=*&order=safety_factor.asc";
      if (filters.sku) q += `&sku=ilike.*${filters.sku}*`;
      if (filters.itemName) q += `&item_name=ilike.*${filters.itemName}*`;
      if (filters.department !== "All") q += `&department=eq.${encodeURIComponent(filters.department)}`;
      if (filters.minSF) q += `&safety_factor=gte.${filters.minSF}`;
      if (filters.maxSF) q += `&safety_factor=lte.${filters.maxSF}`;

      // Fetch all items to compile counts & heat range
      const data: LatestStockItem[] = await fetchAllRows("latest_stock", "*", q);

      // Compute statistics counts
      const counts = { critical: 0, low: 0, normal: 0, high: 0 };
      const sVals: number[] = [];

      data.forEach((r) => {
        const sf = Number(r.safety_factor) || 0;
        sVals.push(sf);
        if (sf < 1) counts.critical++;
        else if (sf < 2) counts.low++;
        else if (sf < 5) counts.normal++;
        else counts.high++;
      });

      setCardCounts(counts);

      // Compute bounds for heatmap coloring
      if (sVals.length > 0) {
        setHeatmapBounds({
          min: Math.min(...sVals),
          max: Math.max(...sVals),
        });
      }

      setTotalCount(data.length);

      const offset = (p - 1) * 20;
      setItems(data.slice(offset, offset + 20));
    } catch (e) {
      console.error("Safety Factor processing failure:", e);
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
      minSF: "",
      maxSF: "",
    });
    setPage(1);
    setTimeout(() => {
      loadSafetyFactorData(1);
    }, 10);
  }

  async function handleExportCSV() {
    setLoading(true);
    try {
      const data = await fetchAllRows("latest_stock");
      let csv = "SKU,Item Name,Department,Quantity,Stock Value,Avg Daily Consumption,Lead Time (Days),Safety Factor,Level State\n";

      data.forEach((r) => {
        const sf = Number(r.safety_factor) || 0;
        const state = getSFStatus(sf);
        csv += `"${r.sku}","${r.item_name}","${r.department || ""}",${r.quantity},${r.stock_value},${r.avg_daily_consumption},${r.lead_time},${sf.toFixed(2)},"${state.toUpperCase()}"\n`;
      });

      const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
      const link = document.createElement("a");
      link.setAttribute("href", URL.createObjectURL(blob));
      link.setAttribute("download", `Safety_Factors_Ledger_${new Date().toISOString().split("T")[0]}.csv`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } catch (e) {
      console.error("Safety factor CSV export failures:", e);
    } finally {
      setLoading(false);
    }
  }

  function getSFStatus(sf: number): string {
    if (sf < 1) return "Critical";
    if (sf < 2) return "Low";
    if (sf < 5) return "Normal";
    return "High";
  }

  // Dynamic heat shading: Red -> Yellow -> Green -> Indigo
  function getHeatMapShading(val: number): string {
    const { min, max } = heatmapBounds;
    if (min === max) return "transparent";

    // Normalize value
    const r = (val - min) / (max - min || 1);

    if (val < 1.0) {
      // Urgent hazard: rose shading
      return `rgba(244, 63, 94, ${0.1 + (1 - r) * 0.15})`;
    } else if (val < 2.0) {
      // Moderate warning: amber shading
      return `rgba(245, 158, 11, 0.12)`;
    } else if (val < 5.5) {
      // Comfortable safety: emerald hue
      return `rgba(16, 185, 129, 0.12)`;
    } else {
      // Immersive level: indigo high buffer
      return `rgba(99, 102, 241, 0.14)`;
    }
  }

  const totalPages = Math.ceil(totalCount / 20);

  return (
    <div className="space-y-6 animate-fadeIn pb-12">
      {/* View Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-extrabold text-slate-900 tracking-tight flex items-center gap-3">
            Safety Factor Console
          </h1>
          <p className="text-slate-500 mt-2">Analytical model reporting stock safety ratios, lead times, and warning thresholds.</p>
        </div>
        <div className="flex items-center gap-3 text-sm">
          <button
            onClick={() => loadSafetyFactorData(1)}
            className="px-4 py-2.5 bg-white border border-slate-200 text-slate-700 font-semibold rounded-xl hover:bg-slate-50 transition-colors flex items-center gap-2 shadow-sm"
          >
            <RefreshCw className="w-4 h-4 text-slate-400" />
            Refresh Analysis
          </button>
          <button
            onClick={handleExportCSV}
            className="px-5 py-2.5 bg-indigo-600 text-white font-semibold rounded-xl hover:bg-indigo-700 transition-all flex items-center gap-2 shadow-md hover:shadow-indigo-100 animate-pulseHover"
          >
            <FileOutput className="w-4 h-4" />
            Export Analysis CSV
          </button>
        </div>
      </div>

      {/* Statistics Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm flex items-center gap-4 relative overflow-hidden">
          <div className="p-3 bg-rose-50 text-rose-600 rounded-xl">
            <AlertOctagon className="w-6 h-6" />
          </div>
          <div>
            <p className="text-xs font-bold text-slate-400 uppercase tracking-widest">Urgent Buffer</p>
            <h3 className="text-2xl font-black text-slate-950 mt-1">{cardCounts.critical}</h3>
            <span className="text-[10px] text-rose-500 font-bold">Safety ratio &lt; 1.0</span>
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm flex items-center gap-4 relative overflow-hidden">
          <div className="p-3 bg-amber-50 text-amber-500 rounded-xl">
            <AlertCircle className="w-6 h-6" />
          </div>
          <div>
            <p className="text-xs font-bold text-slate-400 uppercase tracking-widest">Low Safety</p>
            <h3 className="text-2xl font-black text-slate-950 mt-1">{cardCounts.low}</h3>
            <span className="text-[10px] text-amber-500 font-bold">1.0 ≤ ratio &lt; 2.0</span>
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm flex items-center gap-4 relative overflow-hidden">
          <div className="p-3 bg-emerald-50 text-emerald-600 rounded-xl">
            <CheckCircle2 className="w-6 h-6" />
          </div>
          <div>
            <p className="text-xs font-bold text-slate-400 uppercase tracking-widest">Secure Stock</p>
            <h3 className="text-2xl font-black text-slate-950 mt-1">{cardCounts.normal}</h3>
            <span className="text-[10px] text-emerald-500 font-bold">2.0 ≤ ratio &lt; 5.0</span>
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm flex items-center gap-4 relative overflow-hidden">
          <div className="p-3 bg-indigo-50 text-indigo-600 rounded-xl">
            <ShieldAlert className="w-6 h-6" />
          </div>
          <div>
            <p className="text-xs font-bold text-slate-400 uppercase tracking-widest">Excess Stock</p>
            <h3 className="text-2xl font-black text-slate-950 mt-1">{cardCounts.high}</h3>
            <span className="text-[10px] text-indigo-500 font-bold">Ratio ≥ 5.0 items</span>
          </div>
        </div>
      </div>

      {/* Advanced Filters Block */}
      <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm">
        <h3 className="text-xs font-bold uppercase text-slate-400 tracking-wider mb-4 flex items-center gap-2">
          <RefreshCw className="w-4 h-4" />
          Filter Factor Ratios
        </h3>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
          <div>
            <label className="block text-xs font-bold text-slate-500 uppercase tracking-widest mb-1.5">SKU Code</label>
            <input
              type="text"
              value={filters.sku}
              onChange={(e) => handleFilterChange("sku", e.target.value)}
              placeholder="Search SKU..."
              className="w-full text-sm border border-slate-200 rounded-xl px-3.5 py-2.5 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none"
            />
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-500 uppercase tracking-widest mb-1.5">Item Name</label>
            <input
              type="text"
              value={filters.itemName}
              onChange={(e) => handleFilterChange("itemName", e.target.value)}
              placeholder="Search descriptions..."
              list="tabSFNamesAutocomp"
              className="w-full text-sm border border-slate-200 rounded-xl px-3.5 py-2.5 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none"
            />
            <datalist id="tabSFNamesAutocomp">
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
              className="w-full text-sm border border-slate-200 rounded-xl px-3.5 py-2.5 bg-white outline-none focus:ring-2 focus:ring-indigo-500"
            >
              <option value="All">All Departments</option>
              {DEPARTMENTS_LIST.map((dept) => (
                <option key={dept} value={dept}>
                  {dept}
                </option>
              ))}
            </select>
          </div>

          <div className="lg:col-span-2">
            <label className="block text-xs font-bold text-slate-500 uppercase tracking-widest mb-1.5">Safety Factor Boundaries</label>
            <div className="flex gap-2">
              <input
                type="number"
                value={filters.minSF}
                onChange={(e) => handleFilterChange("minSF", e.target.value)}
                placeholder="Min SF Ratio"
                step="0.1"
                className="w-full text-sm border border-slate-200 rounded-xl px-3.5 py-2 outline-none focus:ring-2 focus:ring-indigo-500"
              />
              <input
                type="number"
                value={filters.maxSF}
                onChange={(e) => handleFilterChange("maxSF", e.target.value)}
                placeholder="Max SF Ratio"
                step="0.1"
                className="w-full text-sm border border-slate-200 rounded-xl px-3.5 py-2 outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
          </div>
        </div>

        <div className="mt-5 pt-4 border-t border-slate-100 flex justify-between items-center bg-slate-50/20">
          <span className="text-xs font-bold text-indigo-600">
            {totalCount} item safety logs matched
          </span>
          <div className="flex gap-2">
            <button
              onClick={handleResetFilters}
              className="px-4 py-2 border border-slate-200 text-slate-600 font-semibold rounded-xl text-xs hover:bg-slate-50 transition-colors cursor-pointer"
            >
              Reset Parameters
            </button>
            <button
              onClick={() => loadSafetyFactorData(1)}
              className="px-5 py-2.5 bg-slate-900 border border-slate-950 text-white font-semibold rounded-xl text-xs hover:bg-slate-800 transition-colors"
            >
              Search Safety Levels
            </button>
          </div>
        </div>
      </div>

      {/* Analysis Grid data layout */}
      <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-slate-600 text-sm">
            <thead className="bg-slate-50 text-[10px] uppercase font-bold tracking-wider text-slate-400 border-b border-slate-100">
              <tr>
                <th className="px-6 py-4 text-left">SKU</th>
                <th className="px-6 py-4 text-left">Description</th>
                <th className="px-6 py-4 text-left">Department</th>
                <th className="px-6 py-4 text-left">Current Reserves</th>
                <th className="px-6 py-3.5 text-left">Net Inventory Valuation</th>
                <th className="px-6 py-4 text-left">Daily Out Cons (ADC)</th>
                <th className="px-6 py-4 text-left">Lead Days</th>
                <th className="px-6 py-4 text-left">Calculated Safety Factor</th>
                <th className="px-6 py-4 text-right">Warning Level</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr>
                  <td colSpan={9} className="py-24 text-center">
                    <div className="flex flex-col items-center justify-center gap-3">
                      <div className="w-8 h-8 rounded-full border-2 border-indigo-600 border-t-transparent animate-spin" />
                      <span className="text-xs font-semibold text-slate-400">Loading safety stats...</span>
                    </div>
                  </td>
                </tr>
              ) : items.length > 0 ? (
                items.map((item) => {
                  const sf = Number(item.safety_factor) || 0;
                  const state = getSFStatus(sf);
                  const cellBg = getHeatMapShading(sf);

                  const badges: { [key: string]: string } = {
                    Critical: "bg-rose-50 text-rose-700 border-rose-100",
                    Low: "bg-amber-50 text-amber-700 border-amber-100",
                    Normal: "bg-emerald-50 text-emerald-700 border-emerald-100",
                    High: "bg-indigo-50 text-indigo-700 border-indigo-100",
                  };

                  return (
                    <tr key={item.sku} className="hover:bg-slate-50/60 transition-colors font-medium">
                      <td className="px-6 py-3.5 font-bold text-slate-900 whitespace-nowrap">{item.sku}</td>
                      <td className="px-6 py-3 text-slate-900 font-bold max-w-sm">{item.item_name}</td>
                      <td className="px-6 py-3.5 text-slate-500 whitespace-nowrap">{item.department}</td>
                      <td className="px-6 py-3.5 font-extrabold text-slate-800 whitespace-nowrap">
                        {formatNumber(item.quantity)}
                      </td>
                      <td className="px-6 py-3 font-extrabold text-slate-900 whitespace-nowrap">
                        {formatCurrency(item.stock_value)}
                      </td>
                      <td className="px-6 py-3.5 text-slate-600 font-semibold whitespace-nowrap">
                        {formatNumber(item.avg_daily_consumption, 4)}
                      </td>
                      <td className="px-6 py-3.5 text-xs text-slate-400 font-semibold whitespace-nowrap">
                        {item.lead_time || 7} days
                      </td>
                      {/* Interactive heatmap dynamic background color */}
                      <td
                        className="px-6 py-3.5 font-extrabold text-slate-900 whitespace-nowrap transition-colors"
                        style={{ backgroundColor: cellBg }}
                      >
                        {formatNumber(sf, 2)}
                      </td>
                      <td className="px-6 py-3.5 text-right whitespace-nowrap">
                        <span
                          className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-[10px] font-extrabold border uppercase tracking-wider ${
                            badges[state] || ""
                          }`}
                        >
                          {state}
                        </span>
                      </td>
                    </tr>
                  );
                })
              ) : (
                <tr>
                  <td colSpan={9} className="py-24 text-center">
                    <div className="flex flex-col items-center justify-center gap-2">
                      <XCircle className="w-10 h-10 text-slate-300" />
                      <span className="text-sm font-bold text-slate-700">Empty Record Set matched</span>
                      <span className="text-xs text-slate-400">Reduce strictness of search bounds.</span>
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
              Page {page} of {totalPages} ({totalCount} items matched)
            </span>
            <div className="flex items-center gap-1">
              <button
                onClick={() => loadSafetyFactorData(page - 1)}
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
                        onClick={() => loadSafetyFactorData(pNum)}
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
                onClick={() => loadSafetyFactorData(page + 1)}
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

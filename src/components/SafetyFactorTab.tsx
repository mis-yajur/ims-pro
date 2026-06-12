import React, { useState, useEffect } from "react";
import { fetchAllRows, sbGet, formatCurrency, formatNumber } from "../utils/supabase";
import { LatestStockItem } from "../types";
import { DEPARTMENTS_LIST } from "../constants";
import { 
  AlertCircle, 
  AlertOctagon, 
  CheckCircle2, 
  FileOutput, 
  RefreshCw, 
  ShieldAlert, 
  XCircle, 
  ChevronLeft, 
  ChevronRight, 
  Sliders, 
  Info,
  TrendingDown,
  TrendingUp,
  Coins,
  Warehouse,
  Flame,
  Zap,
  Search
} from "lucide-react";

export default function SafetyFactorTab() {
  // Global control parameters
  const [targetOverstockDays, setTargetOverstockDays] = useState(20);
  const [peakMultiplier, setPeakMultiplier] = useState(1.4); // Max daily use factor, e.g. 1.4x of average daily use

  // Filter keys
  const [filters, setFilters] = useState({
    sku: "",
    itemName: "",
    department: "All",
    statusFilter: "All"
  });

  // DB items
  const [allItems, setAllItems] = useState<LatestStockItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [totalCount, setTotalCount] = useState(0);

  // Auto-complete names
  const [itemNamesList, setItemNamesList] = useState<string[]>([]);

  useEffect(() => {
    loadSafetyFactorData();
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

  async function loadSafetyFactorData() {
    setLoading(true);
    try {
      // Fetch all items from DB to evaluate in-memory for live configuration updates
      const data: LatestStockItem[] = await fetchAllRows("latest_stock", "*", "?select=*&order=sku.asc");
      setAllItems(data);
    } catch (e) {
      console.error("Safety Factor processing failure:", e);
    } finally {
      setLoading(false);
    }
  }



  // Real-time calculations applied dynamically on complete fetched lists
  const calculatedRows = allItems.map(item => {
    const adu = Number(item.avg_daily_consumption) || 0;
    const mdu = adu * peakMultiplier;
    const lt = item.lead_time || 5;

    // Formulas:
    // 1st: Safety Stock = (Max Daily Usage - Average Daily Usage) * Lead Time
    const safetyStock = (mdu - adu) * lt;

    // 2nd: Reorder Level = (Average Daily Usage * Lead Time) + Safety Stock
    const reorderLevel = (adu * lt) + safetyStock;

    // 4th: Reduce Overstock Days = Current Stock / Average Daily Usage
    const currentStock = Number(item.quantity) || 0;
    const inventoryDays = adu > 0 ? (currentStock / adu) : 0;
    const overstocked = inventoryDays > targetOverstockDays;

    // 3rd: Low Stock Indication
    let status: "Normal" | "Purchase Required" | "Critical" | "Production Stop" = "Normal";
    if (currentStock <= 0) {
      status = "Production Stop";
    } else if (currentStock < safetyStock) {
      status = "Critical";
    } else if (currentStock <= reorderLevel) {
      status = "Purchase Required";
    }

    return {
      ...item,
      adu,
      mdu,
      lt,
      safetyStock,
      reorderLevel,
      inventoryDays,
      overstocked,
      status
    };
  });

  // Apply search filtering on calculated rows
  const filteredCalculatedRows = calculatedRows.filter(row => {
    const matchSku = !filters.sku || row.sku.toLowerCase().includes(filters.sku.toLowerCase());
    const matchName = !filters.itemName || row.item_name.toLowerCase().includes(filters.itemName.toLowerCase());
    const matchDept = filters.department === "All" || row.department === filters.department;
    
    let matchStatus = true;
    if (filters.statusFilter !== "All") {
      if (filters.statusFilter === "Overstocked") {
        matchStatus = row.overstocked;
      } else {
        matchStatus = row.status === filters.statusFilter;
      }
    }

    return matchSku && matchName && matchDept && matchStatus;
  });

  // Re-calculate statistics for header KPIs based on current filtered set
  const statsCounts = {
    productionStop: calculatedRows.filter(r => r.status === "Production Stop").length,
    critical: calculatedRows.filter(r => r.status === "Critical").length,
    purchaseRequired: calculatedRows.filter(r => r.status === "Purchase Required").length,
    normal: calculatedRows.filter(r => r.status === "Normal").length,
    overstocked: calculatedRows.filter(r => r.overstocked).length
  };

  // Pagination parameters
  const offset = (page - 1) * 20;
  const paginatedRows = filteredCalculatedRows.slice(offset, offset + 20);
  const totalPages = Math.ceil(filteredCalculatedRows.length / 20);

  function handleFilterChange(field: string, val: string) {
    setFilters((prev) => ({ ...prev, [field]: val }));
    setPage(1);
  }

  function handleResetFilters() {
    setFilters({
      sku: "",
      itemName: "",
      department: "All",
      statusFilter: "All"
    });
    setPage(1);
  }

  async function handleExportCSV() {
    try {
      let csv = "SKU,Item Name,Department,Current Stock,Avg Daily Usage,Max Daily Usage,Lead Time,Safety Stock,Reorder Level,Inventory Days,Factory Status,Overstock Status\n";

      calculatedRows.forEach((r) => {
        csv += `"${r.sku}","${r.item_name}","${r.department || ""}",${r.quantity},${r.adu.toFixed(4)},${r.mdu.toFixed(4)},${r.lt},${r.safetyStock.toFixed(2)},${r.reorderLevel.toFixed(2)},${r.inventoryDays.toFixed(1)},"${r.status}","${r.overstocked ? "OVERSTOCK" : "OK"}"\n`;
      });

      const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
      const link = document.createElement("a");
      link.setAttribute("href", URL.createObjectURL(blob));
      link.setAttribute("download", `Factory_Stock_Control_Report_${new Date().toISOString().split("T")[0]}.csv`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } catch (e) {
      console.error("CSV export failure:", e);
    }
  }

  return (
    <div id="safety-factor-console-container" className="space-y-6 animate-fadeIn pb-12">
      {/* View Header */}
      <div id="header-section" className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-extrabold text-slate-900 tracking-tight flex items-center gap-3">
            Safety Factor Console
          </h1>
          <p className="text-slate-500 mt-2">
            Automated production safety buffers, reorder thresholds, and dynamic overstock protection engine.
          </p>
        </div>
        <div className="flex items-center gap-3 text-sm">
          <button
            id="refresh-btn"
            onClick={loadSafetyFactorData}
            title="Refresh Stock Data"
            disabled={loading}
            className="px-4 py-2.5 bg-white border border-slate-200 text-slate-700 font-semibold rounded-xl hover:bg-slate-50 transition-colors flex items-center gap-2 shadow-sm disabled:opacity-50"
          >
            <RefreshCw className={`w-4 h-4 text-slate-400 ${loading ? "animate-spin" : ""}`} />
            Refresh Analysis
          </button>
          <button
            id="export-csv-btn"
            onClick={handleExportCSV}
            className="px-5 py-2.5 bg-indigo-600 text-white font-semibold rounded-xl hover:bg-indigo-700 transition-all flex items-center gap-2 shadow-md hover:shadow-indigo-150"
          >
            <FileOutput className="w-4 h-4" />
            Export Analysis CSV
          </button>
        </div>
      </div>

      {/* KPI Overviews based on the requested Factory Status thresholds */}
      <div id="kpi-cards-grid" className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <div className="bg-white border border-rose-200 rounded-2xl p-4 shadow-sm flex flex-col justify-between relative overflow-hidden">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-400 uppercase tracking-widest">Production Stop</span>
            <div className="p-1.5 bg-rose-50 text-rose-600 rounded-lg">
              <AlertOctagon className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-4">
            <h3 className="text-2xl font-black text-rose-600">{statsCounts.productionStop}</h3>
            <p className="text-[10px] text-slate-400 font-semibold mt-0.5">Zero stock items</p>
          </div>
          <div className="absolute top-0 left-0 w-1 h-full bg-rose-500" />
        </div>

        <div className="bg-white border border-orange-200 rounded-2xl p-4 shadow-sm flex flex-col justify-between relative overflow-hidden">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-400 uppercase tracking-widest">Critical Buffer</span>
            <div className="p-1.5 bg-orange-50 text-orange-600 rounded-lg">
              <AlertCircle className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-4">
            <h3 className="text-2xl font-black text-orange-600">{statsCounts.critical}</h3>
            <p className="text-[10px] text-slate-400 font-semibold mt-0.5">Below safety stock</p>
          </div>
          <div className="absolute top-0 left-0 w-1 h-full bg-orange-500" />
        </div>

        <div className="bg-white border border-amber-200 rounded-2xl p-4 shadow-sm flex flex-col justify-between relative overflow-hidden">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-400 uppercase tracking-widest">Reorder Required</span>
            <div className="p-1.5 bg-amber-50 text-amber-500 rounded-lg">
              <Zap className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-4">
            <h3 className="text-2xl font-black text-amber-600">{statsCounts.purchaseRequired}</h3>
            <p className="text-[10px] text-slate-400 font-semibold mt-0.5">At/Below reorder level</p>
          </div>
          <div className="absolute top-0 left-0 w-1 h-full bg-amber-500" />
        </div>

        <div className="bg-white border border-emerald-200 rounded-2xl p-4 shadow-sm flex flex-col justify-between relative overflow-hidden">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-400 uppercase tracking-widest">Normal Reserves</span>
            <div className="p-1.5 bg-emerald-50 text-emerald-600 rounded-lg">
              <CheckCircle2 className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-4">
            <h3 className="text-2xl font-black text-emerald-600">{statsCounts.normal}</h3>
            <p className="text-[10px] text-slate-400 font-semibold mt-0.5">Above reorder level</p>
          </div>
          <div className="absolute top-0 left-0 w-1 h-full bg-emerald-500" />
        </div>

        <div className="bg-white border border-indigo-200 rounded-2xl p-4 shadow-sm flex flex-col justify-between relative overflow-hidden col-span-2 md:col-span-1">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-400 uppercase tracking-widest">Overstock Limit</span>
            <div className="p-1.5 bg-indigo-50 text-indigo-650 rounded-lg">
              <ShieldAlert className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-4">
            <h3 className="text-2xl font-black text-indigo-700">{statsCounts.overstocked}</h3>
            <p className="text-[10px] text-slate-400 font-semibold mt-0.5">Exceeds {targetOverstockDays} days target</p>
          </div>
          <div className="absolute top-0 left-0 w-1 h-full bg-indigo-600" />
        </div>
      </div>



      {/* SECTION 2: Master Controller (Interactive Sliders) */}
      <div id="interactive-sliders-panel" className="bg-gradient-to-r from-slate-50 to-indigo-50/20 rounded-2xl border border-slate-200 p-6 shadow-sm">
        <h3 className="text-xs font-bold uppercase text-slate-500 tracking-wider mb-4 flex items-center gap-2">
          <Warehouse className="w-4 h-4 text-indigo-600" />
          Interactive Global Stock Threshold Controllers
        </h3>
        <p className="text-xs text-slate-500 mb-6 leading-relaxed">
          The sliders below calculate maximum daily usage parameters and flags the inventory ledger overstock statuses across your active stock collection dynamically:
        </p>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
          {/* Slider 1: Target Overstock Days */}
          <div className="space-y-2 bg-white rounded-xl p-4 border border-slate-100">
            <div className="flex justify-between items-center">
              <span className="text-xs font-bold text-slate-700 flex items-center gap-1.5">
                <TrendingDown className="w-4 h-4 text-indigo-600" />
                Target Coverage limit (Overstock Threshold)
              </span>
              <span className="text-sm font-black text-indigo-600 bg-indigo-50 px-2.5 py-1 rounded-lg">
                {targetOverstockDays} Days
              </span>
            </div>
            <input
              type="range"
              min="5"
              max="120"
              step="1"
              value={targetOverstockDays}
              onChange={(e) => setTargetOverstockDays(parseInt(e.target.value))}
              className="w-full h-1.5 bg-slate-100 rounded-lg appearance-none cursor-ew-resize accent-indigo-600"
            />
            <div className="flex justify-between text-[10px] text-slate-400 font-medium">
              <span>5 days (Ultra-lean)</span>
              <span>20 days (Typical)</span>
              <span>120 days (Bulk)</span>
            </div>
          </div>

          {/* Slider 2: Peak Demand Factor */}
          <div className="space-y-2 bg-white rounded-xl p-4 border border-slate-100">
            <div className="flex justify-between items-center">
              <span className="text-xs font-bold text-slate-700 flex items-center gap-1.5">
                <TrendingUp className="w-4 h-4 text-rose-500" />
                Peak Demand Multiplier (Max Daily Usage)
              </span>
              <span className="text-sm font-black text-rose-600 bg-rose-50 px-2.5 py-1 rounded-lg">
                {peakMultiplier.toFixed(2)}x ADU
              </span>
            </div>
            <input
              type="range"
              min="1.0"
              max="3.0"
              step="0.05"
              value={peakMultiplier}
              onChange={(e) => setPeakMultiplier(parseFloat(e.target.value))}
              className="w-full h-1.5 bg-slate-100 rounded-lg appearance-none cursor-ew-resize accent-rose-500"
            />
            <div className="flex justify-between text-[10px] text-slate-400 font-medium">
              <span>1.0x (No variation)</span>
              <span>1.4x (Standard factory)</span>
              <span>3.0x (Extreme volatility)</span>
            </div>
          </div>
        </div>
      </div>

      {/* SECTION 3: Advanced Search Filters */}
      <div id="filter-block" className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm">
        <h3 className="text-xs font-bold uppercase text-slate-400 tracking-wider mb-4 flex items-center gap-2">
          <Search className="w-4 h-4" />
          Filter Factory Stock Control Ledger
        </h3>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <div>
            <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1.5">SKU Code</label>
            <input
              type="text"
              value={filters.sku}
              onChange={(e) => handleFilterChange("sku", e.target.value)}
              placeholder="Search SKU..."
              className="w-full text-sm border border-slate-200 rounded-xl px-3.5 py-2.5 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none"
            />
          </div>

          <div>
            <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1.5">Item Name</label>
            <input
              type="text"
              value={filters.itemName}
              onChange={(e) => handleFilterChange("itemName", e.target.value)}
              placeholder="Search descriptions..."
              list="tabSFNamesAutocomp"
              className="w-full text-sm border border-slate-200 rounded-xl px-3.5 py-2.5 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none"
            />
            <datalist id="tabSFNamesAutocomp">
              {itemNamesList.map((name, idxOr) => (
                <option key={idxOr} value={name} />
              ))}
            </datalist>
          </div>

          <div>
            <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1.5">Department</label>
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

          <div>
            <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1.5">Stock Status Alert</label>
            <select
              value={filters.statusFilter}
              onChange={(e) => handleFilterChange("statusFilter", e.target.value)}
              className="w-full text-sm border border-slate-200 rounded-xl px-3.5 py-2.5 bg-white outline-none focus:ring-2 focus:ring-indigo-500"
            >
              <option value="All">All Items</option>
              <option value="Normal">Normal (Above Reorder Level)</option>
              <option value="Purchase Required">Purchase Required (At Reorder Level)</option>
              <option value="Critical">Critical (Below Safety Stock)</option>
              <option value="Production Stop">Production Stop (Zero Stock)</option>
              <option value="Overstocked">Overstocked Warning</option>
            </select>
          </div>
        </div>

        <div className="mt-5 pt-4 border-t border-slate-100 flex justify-between items-center bg-slate-50/20">
          <span className="text-xs font-bold text-indigo-650">
            Showing {filteredCalculatedRows.length} of {allItems.length} stock ledger items
          </span>
          <div className="flex gap-2">
            <button
              onClick={handleResetFilters}
              className="px-4 py-2 border border-slate-200 text-slate-600 font-semibold rounded-xl text-xs hover:bg-slate-50 transition-colors cursor-pointer"
            >
              Reset Parameters
            </button>
          </div>
        </div>
      </div>

      {/* SECTION 4: Simple Factory Stock Control System Table View */}
      <div id="analysis-grid-container" className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-slate-600 text-sm">
            <thead className="bg-slate-50 text-[10px] uppercase font-bold tracking-wider text-slate-400 border-b border-slate-100">
              <tr>
                <th className="px-5 py-4 text-left">SKU</th>
                <th className="px-5 py-4 text-left">Item Description</th>
                <th className="px-5 py-4 text-left">Dept</th>
                <th className="px-5 py-4 text-right">Current Stock</th>
                <th className="px-4 py-4 text-right">Avg Out (ADU)</th>
                <th className="px-4 py-4 text-right">Max Out (MDU)</th>
                <th className="px-4 py-3.5 text-center">Lead Time</th>
                <th className="px-5 py-4 text-right font-bold text-indigo-650">Safety Stock</th>
                <th className="px-5 py-4 text-right font-bold text-indigo-650">Reorder Level</th>
                <th className="px-4 py-4 text-center">Inv. Days</th>
                <th className="px-5 py-4 text-center">Status</th>
                <th className="px-5 py-4 text-right">Overstock Alert</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr>
                  <td colSpan={12} className="py-24 text-center">
                    <div className="flex flex-col items-center justify-center gap-3">
                      <div className="w-8 h-8 rounded-full border-2 border-indigo-600 border-t-transparent animate-spin" />
                      <span className="text-xs font-semibold text-slate-400">Evaluating stock buffers dynamically...</span>
                    </div>
                  </td>
                </tr>
              ) : paginatedRows.length > 0 ? (
                paginatedRows.map((item) => {
                  // Badges matching requests
                  const badges = {
                    "Production Stop": "bg-rose-100 text-rose-750 border-rose-200 font-extrabold animate-pulse",
                    "Critical": "bg-orange-50 text-orange-700 border-orange-100 font-bold",
                    "Purchase Required": "bg-amber-50 text-amber-700 border-amber-100 font-bold",
                    "Normal": "bg-emerald-50 text-emerald-700 border-emerald-100 font-medium"
                  };

                  return (
                    <tr key={item.sku} className="hover:bg-slate-50/50 transition-colors font-medium">
                      {/* SKU */}
                      <td className="px-5 py-3.5 font-bold text-slate-900 whitespace-nowrap">
                        {item.sku}
                      </td>

                      {/* Description */}
                      <td className="px-5 py-3.5 text-slate-900 font-semibold max-w-xs truncate" title={item.item_name}>
                        {item.item_name}
                      </td>

                      {/* Department */}
                      <td className="px-5 py-3.5 text-slate-500 text-xs whitespace-nowrap">
                        {item.department}
                      </td>

                      {/* Current Stock */}
                      <td className="px-5 py-3.5 font-black text-slate-800 text-right whitespace-nowrap">
                        {formatNumber(item.quantity)} <span className="text-[10px] text-slate-400 font-normal">{item.unit || "pcs"}</span>
                      </td>

                      {/* Avg Daily Usage (ADU) */}
                      <td className="px-4 py-3.5 text-slate-600 text-right font-mono text-xs whitespace-nowrap">
                        {formatNumber(item.adu, 2)}
                      </td>

                      {/* Max Daily Usage (MDU) */}
                      <td className="px-4 py-3.5 text-slate-600 text-right font-mono text-xs whitespace-nowrap">
                        {formatNumber(item.mdu, 2)}
                      </td>

                      {/* Lead Time */}
                      <td className="px-4 py-3.5 text-xs text-slate-400 text-center whitespace-nowrap font-bold">
                        {item.lt}d
                      </td>

                      {/* Safety Stock */}
                      <td className="px-5 py-3.5 font-extrabold text-slate-900 text-right whitespace-nowrap bg-indigo-50/20">
                        {formatNumber(item.safetyStock, 1)}
                      </td>

                      {/* Reorder Level */}
                      <td className="px-5 py-3.5 font-extrabold text-slate-900 text-right whitespace-nowrap bg-indigo-100/10">
                        {formatNumber(item.reorderLevel, 1)}
                      </td>

                      {/* Inventory Days */}
                      <td className="px-4 py-3.5 text-center font-bold text-xs whitespace-nowrap">
                        <span className={item.inventoryDays > targetOverstockDays ? "text-indigo-650" : "text-slate-600"}>
                          {item.inventoryDays > 365 ? "365d+" : `${item.inventoryDays.toFixed(0)} days`}
                        </span>
                      </td>

                      {/* Low Stock status badge matching logic */}
                      <td className="px-5 py-3.5 text-center whitespace-nowrap">
                        <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-[10px] uppercase tracking-wider border ${badges[item.status]}`}>
                          {item.status}
                        </span>
                      </td>

                      {/* Overstock Alert Badge */}
                      <td className="px-5 py-3.5 text-right whitespace-nowrap">
                        {item.overstocked ? (
                          <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider bg-rose-50 text-rose-700 border border-rose-100 animate-pulse">
                            <Flame className="w-3 h-3 text-rose-500 fill-rose-500" />
                            Overstock
                          </span>
                        ) : (
                          <span className="text-[10px] font-bold text-slate-350 bg-slate-50 border border-slate-100 px-2 py-0.5 rounded-full">
                            Optimal
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })
              ) : (
                <tr>
                  <td colSpan={12} className="py-24 text-center">
                    <div className="flex flex-col items-center justify-center gap-2">
                      <XCircle className="w-10 h-10 text-slate-300" />
                      <span className="text-sm font-bold text-slate-700">Empty Record Set matched</span>
                      <span className="text-xs text-slate-400">Reduce strictness of search filters.</span>
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination Controls */}
        {!loading && totalPages > 1 && (
          <div className="px-6 py-4.5 border-t border-slate-100 bg-slate-50 flex items-center justify-between text-xs font-semibold text-slate-500">
            <span>
              Page {page} of {totalPages} ({filteredCalculatedRows.length} items filtered)
            </span>
            <div className="flex items-center gap-1">
              <button
                onClick={() => setPage(p => Math.max(1, p - 1))}
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
                        onClick={() => setPage(pNum)}
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
                onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages}
                className="p-2 border border-slate-200 rounded-xl bg-white text-slate-500 hover:bg-slate-50 disabled:opacity-50 transition-colors"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* SECTION 5: Simple Factory Stock Control System Summary Cheat Sheet */}
      <div id="cheat-sheet-pillar" className="bg-slate-50 border border-slate-200 rounded-2xl p-6">
        <h3 className="text-sm font-bold text-slate-800 mb-4 flex items-center gap-2">
          <Warehouse className="w-4 h-4 text-indigo-650" />
          Simple Factory Stock Control System Overview
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-xs">
            <span className="text-[10px] font-bold text-indigo-650 uppercase tracking-widest block mb-1">Safety Stock</span>
            <p className="text-xs text-slate-650 leading-relaxed">
              Extra emergency stock kept to avoid production stopping when material delivery is delayed. Prevents stock-outs.
            </p>
          </div>
          <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-xs">
            <span className="text-[10px] font-bold text-amber-600 uppercase tracking-widest block mb-1">Reorder Level</span>
            <p className="text-xs text-slate-650 leading-relaxed">
              Determines exactly when to trigger a purchase order to prevent diving below Safety Stock levels during lead days.
            </p>
          </div>
          <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-xs">
            <span className="text-[10px] font-bold text-rose-500 uppercase tracking-widest block mb-1">Maximum Level</span>
            <p className="text-xs text-slate-650 leading-relaxed">
              Avoids expensive overstock issues. Formulated using target coverage limit days to maintain streamlined operations.
            </p>
          </div>
          <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-xs">
            <span className="text-[10px] font-bold text-orange-500 uppercase tracking-widest block mb-1">Minimum Level</span>
            <p className="text-xs text-slate-650 leading-relaxed">
              Avoids shortages and stock depletion. Any drop below Safety Stock triggers a priority status action state.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

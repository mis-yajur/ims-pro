import React, { useState, useEffect } from "react";
import { fetchAllRows, sbRpc, formatCurrency, formatNumber } from "../utils/supabase";
import { LatestStockItem, Transaction, GlobalYearlyData } from "../types";
import { ArrowDownRight, ArrowUpRight, Award, Box, Database, Sparkles, TrendingUp, RefreshCw } from "lucide-react";

interface DashboardTabProps {
  key?: any;
  onSwitchTab: (tab: string) => void;
  onShowAddTransaction: () => void;
  onRunReport: (type: string) => void;
}

export default function DashboardTab({ onSwitchTab, onShowAddTransaction, onRunReport }: DashboardTabProps) {
  const [loading, setLoading] = useState(false);
  const [stats, setStats] = useState({
    totalValue: 0,
    totalQty: 0,
    totalSKU: 0,
    activeSKU: 0,
    totalInQty: 0,
    totalInVal: 0,
    totalOutQty: 0,
    totalOutVal: 0,
  });

  const [yearlyYear, setYearlyYear] = useState<string>("");
  const [yearlyData, setYearlyData] = useState<GlobalYearlyData>({});
  const [chartRange, setChartRange] = useState<number>(6);
  const [monthlyChartData, setMonthlyChartData] = useState<{ label: string; inVal: number; outVal: number }[]>([]);
  const [deptValues, setDeptValues] = useState<{ name: string; value: number }[]>([]);

  const [syncing, setSyncing] = useState(false);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);

  useEffect(() => {
    loadDashboardData();
  }, []);

  async function loadDashboardData() {
    setLoading(true);
    try {
      // 1. Fetch Latest Stock items
      const ls: LatestStockItem[] = await fetchAllRows("latest_stock", "quantity,stock_value,department");

      const totalValue = ls.reduce((sum, item) => sum + (Number(item.stock_value) || 0), 0);
      const totalQty = ls.reduce((sum, item) => sum + (Number(item.quantity) || 0), 0);
      const totalSKU = ls.length;
      const activeSKU = ls.filter((item) => Number(item.quantity) > 0).length;

      // 2. Fetch manual Transactions
      const io: Transaction[] = await fetchAllRows("in_out_manual", "in_out,quantity,stock_value,date");

      const totalInQty = io.filter((r) => r.in_out === "In").reduce((sum, r) => sum + (Number(r.quantity) || 0), 0);
      const totalInVal = io.filter((r) => r.in_out === "In").reduce((sum, r) => sum + (Number(r.stock_value) || 0), 0);
      const totalOutQty = io.filter((r) => r.in_out === "Out").reduce((sum, r) => sum + (Number(r.quantity) || 0), 0);
      const totalOutVal = io.filter((r) => r.in_out === "Out").reduce((sum, r) => sum + (Number(r.stock_value) || 0), 0);

      setStats({
        totalValue,
        totalQty,
        totalSKU,
        activeSKU,
        totalInQty,
        totalInVal,
        totalOutQty,
        totalOutVal,
      });

      // Compute Yearly Month Summary
      const summaryData: GlobalYearlyData = {};
      const yearsSet = new Set<number>();

      io.forEach((r) => {
        if (!r.date) return;
        const d = new Date(r.date);
        const y = d.getFullYear();
        const m = d.getMonth() + 1;
        yearsSet.add(y);

        if (!summaryData[y]) {
          summaryData[y] = {};
          for (let i = 1; i <= 12; i++) {
            summaryData[y][i] = { inQty: 0, outQty: 0, inVal: 0, outVal: 0 };
          }
        }

        const qty = Number(r.quantity) || 0;
        const val = Number(r.stock_value) || 0;

        if (r.in_out === "In") {
          summaryData[y][m].inQty += qty;
          summaryData[y][m].inVal += val;
        } else if (r.in_out === "Out") {
          summaryData[y][m].outQty += qty;
          summaryData[y][m].outVal += val;
        }
      });

      setYearlyData(summaryData);

      const yearsList = Array.from(yearsSet).sort((a, b) => b - a);
      if (yearsList.length > 0) {
        setYearlyYear(yearsList[0].toString());
      } else {
        const curY = new Date().getFullYear();
        setYearlyYear(curY.toString());
      }

      // Compute Monthly Transaction Volume for SVG bar chart
      const monthsCount = chartRange;
      const now = new Date();
      const monthlyComputed: { [key: string]: { inVal: number; outVal: number } } = {};
      const orderKeys: string[] = [];

      for (let i = monthsCount - 1; i >= 0; i--) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        const k = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
        monthlyComputed[k] = { inVal: 0, outVal: 0 };
        orderKeys.push(k);
      }

      io.forEach((r) => {
        if (!r.date) return;
        const d = new Date(r.date);
        const k = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
        if (monthlyComputed[k]) {
          const val = Number(r.stock_value) || 0;
          if (r.in_out === "In") {
            monthlyComputed[k].inVal += val;
          } else if (r.in_out === "Out") {
            monthlyComputed[k].outVal += val;
          }
        }
      });

      const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
      const chartPoints = orderKeys.map((k) => {
        const [y, m] = k.split("-");
        const idx = parseInt(m) - 1;
        return {
          label: `${monthNames[idx]} ${y}`,
          inVal: monthlyComputed[k].inVal,
          outVal: monthlyComputed[k].outVal,
        };
      });
      setMonthlyChartData(chartPoints);

      // Compute Department Distribution values
      const deptMap: { [key: string]: number } = {};
      ls.forEach((item) => {
        const d = item.department || "General Store";
        deptMap[d] = (deptMap[d] || 0) + (Number(item.stock_value) || 0);
      });

      const sortedDepts = Object.entries(deptMap)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10) // Top 10 departments
        .map(([name, value]) => ({ name, value }));

      setDeptValues(sortedDepts);
    } catch (e: any) {
      console.error("Dashboard calculation error:", e);
    } finally {
      setLoading(false);
    }
  }

  // Recalculate monthly charts when range selection shifts
  useEffect(() => {
    loadDashboardData();
  }, [chartRange]);

  async function handleSync() {
    setSyncing(true);
    setSyncMessage(null);
    try {
      const response = await sbRpc("run_all_calculations");
      setSyncMessage("All calculations fully updated and synced with database!");
      await loadDashboardData();
    } catch (e: any) {
      setSyncMessage(`Sync failed: ${e.message}`);
    } finally {
      setSyncing(false);
      setTimeout(() => setSyncMessage(null), 5000);
    }
  }

  const months = [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
  ];
  const activeYearData = yearlyYear ? yearlyData[Number(yearlyYear)] : null;

  // Compute maximum transaction value for bar charts scaling
  const maxChartVal = Math.max(...monthlyChartData.map((d) => Math.max(d.inVal, d.outVal)), 10000);

  // Compute total department value for percentages
  const totalDeptValSum = deptValues.reduce((s, r) => s + r.value, 0);

  return (
    <div className="space-y-8 animate-fadeIn">
      {/* Header controls */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-extrabold text-slate-900 tracking-tight flex items-center gap-3">
            <span className="p-2.5 rounded-xl bg-indigo-600 text-white shadow-md shadow-indigo-100">
              <TrendingUp className="w-7 h-7" />
            </span>
            Dashboard Console
          </h1>
          <p className="text-slate-500 mt-2">Real-time analytical interface synced directly with Supabase.</p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={loadDashboardData}
            disabled={loading}
            className="px-4 py-2.5 bg-white border border-slate-200 text-slate-700 font-medium rounded-xl hover:bg-slate-50 transition-colors flex items-center gap-2 shadow-sm disabled:opacity-50"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
            Refresh Values
          </button>
          <button
            onClick={handleSync}
            disabled={syncing}
            className="px-5 py-2.5 bg-indigo-600 text-white font-semibold rounded-xl hover:bg-indigo-700 transition-all flex items-center gap-2 shadow-md shadow-indigo-100 hover:shadow-indigo-200 disabled:opacity-50"
          >
            <Database className={`w-4 h-4 ${syncing ? "animate-spin" : ""}`} />
            {syncing ? "Syncing..." : "Sync Inventory"}
          </button>
        </div>
      </div>

      {syncMessage && (
        <div
          className={`p-4 rounded-xl border ${
            syncMessage.includes("failed")
              ? "bg-rose-50 border-rose-200 text-rose-800"
              : "bg-emerald-50 border-emerald-200 text-emerald-800"
          } text-sm font-medium flex items-center gap-2`}
        >
          <Sparkles className="w-5 h-5 flex-shrink-0" />
          {syncMessage}
        </div>
      )}

      {/* Stats Cards Row */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {/* Card 1: Total Stock Value */}
        <div className="bg-white p-6 rounded-2xl border border-slate-200/80 shadow-sm hover:shadow-md transition-shadow relative overflow-hidden group">
          <div className="absolute right-0 top-0 w-24 h-24 bg-indigo-50/40 rounded-bl-full pointer-events-none transition-all group-hover:scale-110" />
          <div className="flex items-center justify-between mb-4">
            <span className="p-3 bg-indigo-50 text-indigo-600 rounded-xl">
              <Award className="w-6 h-6" />
            </span>
            <span className="px-2.5 py-1 text-xs font-semibold rounded-full bg-indigo-50 text-indigo-700 uppercase tracking-wider">
              Live Val
            </span>
          </div>
          <h3 className="text-2xl font-bold text-slate-900 tracking-tight">{formatCurrency(stats.totalValue)}</h3>
          <p className="text-sm font-medium text-slate-500 mt-1">Total Stock Valuation</p>
          <div className="mt-4 pt-3 border-t border-slate-150 flex items-center gap-2 text-xs text-slate-400">
            <Database className="w-3.5 h-3.5" />
            <span>PostgreSQL Generated Col</span>
          </div>
        </div>

        {/* Card 2: Active items Qty */}
        <div className="bg-white p-6 rounded-2xl border border-slate-200/80 shadow-sm hover:shadow-md transition-shadow relative overflow-hidden group">
          <div className="absolute right-0 top-0 w-24 h-24 bg-emerald-50/40 rounded-bl-full pointer-events-none transition-all group-hover:scale-110" />
          <div className="flex items-center justify-between mb-4">
            <span className="p-3 bg-emerald-50 text-emerald-600 rounded-xl">
              <Box className="w-6 h-6" />
            </span>
            <span className="px-2.5 py-1 text-xs font-semibold rounded-full bg-emerald-50 text-emerald-700 uppercase tracking-wider">
              Count
            </span>
          </div>
          <h3 className="text-2xl font-bold text-slate-900 tracking-tight">{formatNumber(stats.totalQty, 0)}</h3>
          <p className="text-sm font-medium text-slate-500 mt-1">Total Active Quantity</p>
          <div className="mt-4 flex items-center justify-between text-xs font-semibold border-t border-slate-100 pt-3 text-slate-500">
            <span>
              Total SKU: <strong className="text-slate-800">{stats.totalSKU}</strong>
            </span>
            <span>
              Active SKU: <strong className="text-emerald-600">{stats.activeSKU}</strong>
            </span>
          </div>
        </div>

        {/* Card 3: Total In */}
        <div className="bg-white p-6 rounded-2xl border border-slate-200/80 shadow-sm hover:shadow-md transition-shadow relative overflow-hidden group">
          <div className="absolute right-0 top-0 w-24 h-24 bg-amber-50/40 rounded-bl-full pointer-events-none transition-all group-hover:scale-110" />
          <div className="flex items-center justify-between mb-4">
            <span className="p-3 bg-amber-50 text-amber-600 rounded-xl">
              <ArrowDownRight className="w-6 h-6" />
            </span>
            <span className="px-2.5 py-1 text-xs font-semibold rounded-full bg-amber-50 text-amber-700 uppercase tracking-wider">
              Manual In
            </span>
          </div>
          <h3 className="text-2xl font-bold text-slate-900 tracking-tight">{formatNumber(stats.totalInQty, 0)}</h3>
          <p className="text-sm font-medium text-slate-500 mt-1">Total Received Units</p>
          <div className="mt-4 pt-3 border-t border-slate-150 text-xs font-bold text-amber-600 flex items-center gap-1">
            <span>Value:</span>
            <span>{formatCurrency(stats.totalInVal)}</span>
          </div>
        </div>

        {/* Card 4: Total Out */}
        <div className="bg-white p-6 rounded-2xl border border-slate-200/80 shadow-sm hover:shadow-md transition-shadow relative overflow-hidden group">
          <div className="absolute right-0 top-0 w-24 h-24 bg-rose-50/40 rounded-bl-full pointer-events-none transition-all group-hover:scale-110" />
          <div className="flex items-center justify-between mb-4">
            <span className="p-3 bg-rose-50 text-rose-600 rounded-xl">
              <ArrowUpRight className="w-6 h-6" />
            </span>
            <span className="px-2.5 py-1 text-xs font-semibold rounded-full bg-rose-50 text-rose-700 uppercase tracking-wider">
              Manual Out
            </span>
          </div>
          <h3 className="text-2xl font-bold text-slate-900 tracking-tight">{formatNumber(stats.totalOutQty, 0)}</h3>
          <p className="text-sm font-medium text-slate-500 mt-1">Total Issued Units</p>
          <div className="mt-4 pt-3 border-t border-slate-150 text-xs font-bold text-rose-600 flex items-center gap-1">
            <span>Value:</span>
            <span>{formatCurrency(stats.totalOutVal)}</span>
          </div>
        </div>
      </div>

      {/* Yearly Scrolling Month Blocks */}
      <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6 pb-2 border-b border-slate-100">
          <div>
            <h2 className="text-lg font-bold text-slate-900">Yearly Ledger Summary</h2>
            <p className="text-xs text-slate-500 mt-0.5">Month-by-month comparative ledger flow</p>
          </div>
          <select
            value={yearlyYear}
            onChange={(e) => setYearlyYear(e.target.value)}
            className="px-3.5 py-1.5 text-sm bg-white border border-slate-200 rounded-xl text-slate-800 font-semibold focus:outline-none focus:ring-2 focus:ring-indigo-500 cursor-pointer"
          >
            {Object.keys(yearlyData).length > 0 ? (
              Object.keys(yearlyData)
                .sort((a, b) => Number(b) - Number(a))
                .map((y) => (
                  <option key={y} value={y}>
                    Year {y}
                  </option>
                ))
            ) : (
              <option value="">No Data</option>
            )}
          </select>
        </div>

        <div className="overflow-x-auto pb-3 custom-scrollbar flex gap-4 scroll-smooth">
          {activeYearData ? (
            Array.from({ length: 12 }, (_, i) => i + 1).map((mNum) => {
              const summary = activeYearData[mNum] || { inQty: 0, outQty: 0, inVal: 0, outVal: 0 };
              return (
                <div
                  key={mNum}
                  className="min-w-[260px] bg-slate-50 border border-slate-200/60 rounded-2xl p-4 flex-shrink-0 transition-all hover:bg-white hover:border-indigo-400 hover:shadow-md group"
                >
                  <h4 className="text-sm font-bold text-slate-800 border-b border-slate-200/60 pb-2 mb-3 text-center group-hover:text-indigo-600 transition-colors">
                    {months[mNum - 1]}
                  </h4>

                  <div className="space-y-4">
                    {/* Qty breakdown */}
                    <div>
                      <div className="text-[10px] uppercase font-extrabold tracking-wider text-slate-400 text-center pb-1">
                        Quantity
                      </div>
                      <div className="grid grid-cols-2 gap-2 text-center text-xs">
                        <div className="p-1 px-1.5 bg-emerald-50 text-emerald-900 rounded-lg">
                          <span className="block text-[8px] uppercase font-bold text-emerald-500">In</span>
                          <span className="font-bold text-xs">{formatNumber(summary.inQty, 0)}</span>
                        </div>
                        <div className="p-1 px-1.5 bg-rose-50 text-rose-900 rounded-lg">
                          <span className="block text-[8px] uppercase font-bold text-rose-500">Out</span>
                          <span className="font-bold text-xs">{formatNumber(summary.outQty, 0)}</span>
                        </div>
                      </div>
                    </div>

                    {/* Value breakdown */}
                    <div>
                      <div className="text-[10px] uppercase font-extrabold tracking-wider text-slate-400 text-center pb-1">
                        Valuation
                      </div>
                      <div className="grid grid-cols-2 gap-2 text-center text-xs">
                        <div className="p-1 px-1.5 bg-emerald-50 text-emerald-990 rounded-lg">
                          <span className="block text-[8px] uppercase font-bold text-emerald-500">In Value</span>
                          <span className="font-bold text-xs block truncate">{formatCurrency(summary.inVal)}</span>
                        </div>
                        <div className="p-1 px-1.5 bg-rose-50 text-rose-990 rounded-lg">
                          <span className="block text-[8px] uppercase font-bold text-rose-500">Out Value</span>
                          <span className="font-bold text-xs block truncate">{formatCurrency(summary.outVal)}</span>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })
          ) : (
            <div className="text-center w-full py-12 text-slate-400 font-medium">
              No transactions recorded for selected year.
            </div>
          )}
        </div>
      </div>

      {/* Charts Section utilizing beautifully rendered Responsive SVG components */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* CHART 1: Monthly transaction volume */}
        <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm flex flex-col">
          <div className="flex items-center justify-between gap-4 mb-6 pb-2 border-b border-slate-100">
            <div>
              <h3 className="text-md font-extrabold text-slate-900">Monthly Transaction Volume</h3>
              <p className="text-xs text-slate-500 mt-0.5">Value of manual stock movements</p>
            </div>
            <select
              value={chartRange}
              onChange={(e) => setChartRange(Number(e.target.value))}
              className="px-3 py-1.5 text-xs bg-white border border-slate-200 rounded-xl text-slate-800 font-semibold cursor-pointer"
            >
              <option value="6">Last 6 Months</option>
              <option value="12">Last 12 Months</option>
            </select>
          </div>

          <div className="flex-1 min-h-[280px] flex items-end justify-between gap-3 pt-6 relative px-2">
            {/* Background grids */}
            <div className="absolute inset-0 flex flex-col justify-between pointer-events-none text-[9px] text-slate-350 font-semibold pb-6 pt-6">
              <div className="border-b border-dashed border-slate-250 w-full flex justify-between">
                <span>{formatCurrency(maxChartVal)}</span>
                <span className="h-0.5 w-full border-b border-dashed border-slate-150 ml-2" />
              </div>
              <div className="border-b border-dashed border-slate-250 w-full flex justify-between">
                <span>{formatCurrency(maxChartVal / 2)}</span>
                <span className="h-0.5 w-full border-b border-dashed border-slate-150 ml-2 animate-pulse" />
              </div>
              <div className="w-full flex justify-between">
                <span>₹0.00</span>
                <span className="h-0.5 w-full border-b border-slate-150 ml-2" />
              </div>
            </div>

            {/* Bars container */}
            <div className="relative z-10 w-full h-full flex items-end justify-around gap-2 pt-6 pb-6">
              {monthlyChartData.map((d, idx) => {
                const inPct = Math.min((d.inVal / maxChartVal) * 100, 100);
                const outPct = Math.min((d.outVal / maxChartVal) * 100, 100);
                return (
                  <div key={idx} className="flex-1 flex flex-col items-center group relative h-full justify-end">
                    {/* Hover detail tooltip */}
                    <div className="absolute -top-12 z-50 bg-slate-900 text-white rounded-lg p-2 text-[10px] leading-tight font-medium opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none text-center shadow-lg border border-slate-800 w-32">
                      <span className="block font-bold text-indigo-300">{d.label}</span>
                      <span className="block text-emerald-400">IN: {formatCurrency(d.inVal)}</span>
                      <span className="block text-rose-400">OUT: {formatCurrency(d.outVal)}</span>
                    </div>

                    <div className="w-full flex items-end justify-center gap-1 h-full">
                      {/* IN bar */}
                      <div
                        style={{ height: `${inPct}%` }}
                        className="w-3.5 sm:w-4.5 bg-gradient-to-t from-emerald-500 to-emerald-400 rounded-t-sm transition-all duration-500 hover:brightness-110 shadow-sm"
                      />
                      {/* OUT bar */}
                      <div
                        style={{ height: `${outPct}%` }}
                        className="w-3.5 sm:w-4.5 bg-gradient-to-t from-rose-500 to-rose-400 rounded-t-sm transition-all duration-500 hover:brightness-110 shadow-sm"
                      />
                    </div>
                    {/* Label */}
                    <span className="text-[9px] font-bold text-slate-500 mt-2 rotate-12 origin-top-left group-hover:text-slate-900 transition-colors whitespace-nowrap block">
                      {d.label}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
          <div className="mt-8 flex items-center justify-center gap-6 text-xs font-semibold text-slate-500">
            <span className="flex items-center gap-2">
              <span className="w-3 h-3 bg-emerald-500 rounded-sm" />
              Manual IN Value (Stock Added)
            </span>
            <span className="flex items-center gap-2">
              <span className="w-3 h-3 bg-rose-500 rounded-sm" />
              Manual OUT Value (Stock Issued)
            </span>
          </div>
        </div>

        {/* CHART 2: Department Valuation */}
        <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm flex flex-col">
          <div className="mb-6 pb-2 border-b border-slate-100">
            <h3 className="text-md font-extrabold text-slate-900">Highest Valued Departments</h3>
            <p className="text-xs text-slate-500 mt-0.5">Top stock valuations ranking</p>
          </div>

          <div className="flex-grow space-y-4.5">
            {deptValues.length > 0 ? (
              deptValues.map((dept, idx) => {
                const pct = totalDeptValSum > 0 ? (dept.value / totalDeptValSum) * 100 : 0;
                const colors = [
                  "bg-indigo-600",
                  "bg-emerald-600",
                  "bg-amber-500",
                  "bg-sky-600",
                  "bg-rose-500",
                  "bg-violet-500",
                  "bg-teal-500",
                  "bg-fuchsia-500",
                  "bg-blue-600",
                  "bg-slate-500",
                ];
                const bgColors = [
                  "bg-indigo-50",
                  "bg-emerald-50",
                  "bg-amber-50",
                  "bg-sky-50",
                  "bg-rose-50",
                  "bg-violet-50",
                  "bg-teal-50",
                  "bg-fuchsia-50",
                  "bg-blue-50",
                  "bg-slate-50",
                ];
                const colorClass = colors[idx % colors.length];
                const bgClass = bgColors[idx % bgColors.length];

                return (
                  <div key={idx} className="space-y-1.5 group">
                    <div className="flex justify-between text-xs font-semibold">
                      <span className="text-slate-700 truncate max-w-[240px] flex items-center gap-2">
                        <span className={`w-2.5 h-2.5 rounded-full ${colorClass}`} />
                        {dept.name}
                      </span>
                      <span className="text-slate-900 font-bold">
                        {formatCurrency(dept.value)}{" "}
                        <span className="text-[10px] text-slate-400 font-medium">({pct.toFixed(1)}%)</span>
                      </span>
                    </div>
                    {/* Custom progress visual bar */}
                    <div className="w-full bg-slate-100 rounded-full h-2 overflow-hidden">
                      <div
                        className={`h-full ${colorClass} rounded-full transition-all duration-700`}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                );
              })
            ) : (
              <div className="text-center py-16 text-slate-400 font-medium h-full flex items-center justify-center">
                Sync inventory to compile department distribution metrics.
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Quick Action Bento Board */}
      <div className="bg-slate-50 rounded-2xl p-6 border border-slate-200">
        <h3 className="text-md font-bold text-slate-900 mb-4">Core Operative Actions</h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <button
            onClick={() => {
              onSwitchTab("in-out");
              setTimeout(() => onShowAddTransaction(), 100);
            }}
            className="flex flex-col items-center justify-center p-5 bg-white border border-slate-200/80 rounded-2xl hover:border-indigo-500 hover:shadow-sm transition-all text-center group cursor-pointer"
          >
            <div className="p-3.5 bg-indigo-50 text-indigo-600 rounded-xl mb-3 group-hover:scale-105 transition-transform">
              <ArrowDownRight className="w-6 h-6" />
            </div>
            <span className="text-sm font-bold text-slate-700">Add Transaction</span>
          </button>

          <button
            onClick={() => onRunReport("negative_stock")}
            className="flex flex-col items-center justify-center p-5 bg-white border border-slate-200/80 rounded-2xl hover:border-indigo-500 hover:shadow-sm transition-all text-center group cursor-pointer"
          >
            <div className="p-3.5 bg-rose-50 text-rose-600 rounded-xl mb-3 group-hover:scale-105 transition-transform">
              <ArrowUpRight className="w-6 h-6" />
            </div>
            <span className="text-sm font-bold text-slate-700">Check Negative Stock</span>
          </button>

          <button
            onClick={() => onRunReport("low_stock")}
            className="flex flex-col items-center justify-center p-5 bg-white border border-slate-200/80 rounded-2xl hover:border-indigo-500 hover:shadow-sm transition-all text-center group cursor-pointer"
          >
            <div className="p-3.5 bg-amber-50 text-amber-500 rounded-xl mb-3 group-hover:scale-105 transition-transform">
              <Box className="w-6 h-6" />
            </div>
            <span className="text-sm font-bold text-slate-700">Check Critical Stock</span>
          </button>

          <button
            onClick={() => onSwitchTab("reports")}
            className="flex flex-col items-center justify-center p-5 bg-white border border-slate-200/80 rounded-2xl hover:border-indigo-500 hover:shadow-sm transition-all text-center group cursor-pointer"
          >
            <div className="p-3.5 bg-indigo-50 text-indigo-600 rounded-xl mb-3 group-hover:scale-105 transition-transform">
              <Database className="w-6 h-6" />
            </div>
            <span className="text-sm font-bold text-slate-700">Interactive Reports</span>
          </button>
        </div>
      </div>
    </div>
  );
}

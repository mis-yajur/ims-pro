import React, { useState, useEffect } from "react";
import { fetchAllRows, sbGet, formatCurrency, formatNumber, formatDate, formatDateTime } from "../utils/supabase";
import { LatestStockItem, Transaction, DepartmentValuation, ClosingStockItem } from "../types";
import { 
  AlertCircle, ArrowLeft, Ban, Bolt, Building2, Calendar, FileOutput, HelpCircle, 
  History, Hammer, TrendingUp, AlertTriangle, Download, Search, ArrowUpDown, 
  Tag, Layers, ListFilter, PackageOpen, CheckCircle2 
} from "lucide-react";

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

  const [selectedMonthStart, setSelectedMonthStart] = useState("2026-04");
  const [selectedMonthEnd, setSelectedMonthEnd] = useState("2026-06");
  const [selectedDateStart, setSelectedDateStart] = useState("2026-04-01");
  const [selectedDateEnd, setSelectedDateEnd] = useState("2026-06-30");
  const [dateWiseType, setDateWiseType] = useState<"month" | "day">("month");

  // Glitch fix: Add searchable and sortable options on compiling
  const [reportSearchQuery, setReportSearchQuery] = useState("");
  const [sortField, setSortField] = useState<string | null>(null);
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc");

  // Clear query and sort params when switching reports
  useEffect(() => {
    setReportSearchQuery("");
    setSortField(null);
    setSortOrder("desc");
  }, [activeReport]);

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
        date_wise_stock: "Date & Month-Wise Stock Level Report",
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
        date_wise_stock: "Interactive report tracking active stock levels filtered by Month or Specific Dates.",
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
      } else if (type === "date_wise_stock") {
        let positiveStockItems = ls.filter((item) => Number(item.quantity) > 0);
        let matchingSkuSet = new Set<string>();

        if (dateWiseType === "day") {
          let q = `?select=sku,date&in_out=eq.In`;
          if (selectedDateStart) q += `&date=gte.${selectedDateStart}`;
          if (selectedDateEnd) q += `&date=lte.${selectedDateEnd}`;
          
          const txs: { sku: string; date: string }[] = await fetchAllRows("in_out_manual", "sku,date", q);
          txs.forEach((tx) => matchingSkuSet.add(tx.sku));

          calculated = positiveStockItems.filter((item) => {
            if (matchingSkuSet.has(item.sku)) return true;
            
            const dStr = (item as any).last_updated || item.updated_at || item.created_at;
            if (!dStr) return false;
            const dt = dStr.split("T")[0];
            
            const matchesStart = selectedDateStart ? dt >= selectedDateStart : true;
            const matchesEnd = selectedDateEnd ? dt <= selectedDateEnd : true;
            return matchesStart && matchesEnd;
          });
        } else {
          let q = `?select=sku,date&in_out=eq.In`;
          const txs: { sku: string; date: string }[] = await fetchAllRows("in_out_manual", "sku,date", q);
          
          txs.forEach((tx) => {
            if (tx.date) {
              const txMonth = tx.date.substring(0, 7);
              const matchesStart = selectedMonthStart ? txMonth >= selectedMonthStart : true;
              const matchesEnd = selectedMonthEnd ? txMonth <= selectedMonthEnd : true;
              if (matchesStart && matchesEnd) {
                matchingSkuSet.add(tx.sku);
              }
            }
          });

          calculated = positiveStockItems.filter((item) => {
            if (matchingSkuSet.has(item.sku)) return true;

            const dStr = (item as any).last_updated || item.updated_at || item.created_at;
            if (!dStr) return false;
            const itemMonth = dStr.substring(0, 7);

            const matchesStart = selectedMonthStart ? itemMonth >= selectedMonthStart : true;
            const matchesEnd = selectedMonthEnd ? itemMonth <= selectedMonthEnd : true;
            return matchesStart && matchesEnd;
          });
        }
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
  async function runInButNotOutReport(overrideDates?: { start: string; end: string }) {
    setLoading(true);
    try {
      const activeDates = overrideDates || ibnoDates;
      let q = "?select=*&order=date.asc";
      if (activeDates.start) q += `&date=gte.${activeDates.start}`;
      if (activeDates.end) q += `&date=lte.${activeDates.end}`;

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

  async function runFrequentlyReorderedReport(overrideDates?: { start: string; end: string }) {
    setLoading(true);
    try {
      const activeDates = overrideDates || froDates;
      let q = "?select=*&in_out=eq.In&order=date.asc";
      if (activeDates.start) q += `&date=gte.${activeDates.start}`;
      if (activeDates.end) q += `&date=lte.${activeDates.end}`;

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

  function calculateDynamicStockLevels(
    ls: LatestStockItem[], 
    csRows: ClosingStockItem[], 
    ioRows: Transaction[], 
    startLimit: string, 
    endLimit: string, 
    isMonthMode: boolean
  ): any[] {
    // Map closing stock by SKU, filtering out records registered AFTER the target end limit
    const csMap: { [sku: string]: { quantity: number; stock_value: number; price?: number; item_name?: string; department?: string; unit?: string } } = {};
    csRows.forEach((row) => {
      if (row.sku) {
        if (row.date) {
          if (isMonthMode) {
            const rowMonth = row.date.substring(0, 7);
            if (endLimit && rowMonth > endLimit) return;
          } else {
            if (endLimit && row.date > endLimit) return;
          }
        }
        const sku = row.sku;
        if (!csMap[sku]) {
          csMap[sku] = { quantity: 0, stock_value: 0, item_name: row.item_name, department: row.department, unit: row.unit };
        }
        csMap[sku].quantity += Number(row.quantity) || 0;
        csMap[sku].stock_value += Number(row.stock_value) || 0;
        if (row.price) {
          csMap[sku].price = Number(row.price);
        }
      }
    });

    // Gather all unique SKUs across latest_stock, closing_stock, and in_out_manual
    const skuSet = new Set<string>();
    ls.forEach(item => skuSet.add(item.sku));
    csRows.forEach(row => skuSet.add(row.sku));
    ioRows.forEach(tx => skuSet.add(tx.sku));

    const calculatedItems: any[] = [];

    skuSet.forEach((sku) => {
      const masterItem = ls.find(item => item.sku === sku);
      const closingRow = csMap[sku];
      const txsForSku = ioRows.filter(tx => tx.sku === sku);

      const itemName = masterItem?.item_name || closingRow?.item_name || (txsForSku.length > 0 ? txsForSku[0].item_name : "") || "Unknown SKU " + sku;
      const unit = masterItem?.unit || closingRow?.unit || "Piece";
      const department = masterItem?.department || closingRow?.department || (txsForSku.length > 0 ? txsForSku[0].department : "General") || "General";

      // Filter transactions up to the END limit
      const filteredTxs = txsForSku.filter((tx) => {
        if (!tx.date) return false;
        if (isMonthMode) {
          const txMonth = tx.date.substring(0, 7);
          return endLimit ? txMonth <= endLimit : true;
        } else {
          return endLimit ? tx.date <= endLimit : true;
        }
      });

      // Sum In and Out transactions up to the end limits
      let totalIn = 0;
      let totalOut = 0;
      filteredTxs.forEach((tx) => {
        const qty = Number(tx.quantity) || 0;
        if (tx.in_out === "In") {
          totalIn += qty;
        } else if (tx.in_out === "Out") {
          totalOut += qty;
        }
      });

      const closingQty = closingRow?.quantity || 0;
      const closingVal = closingRow?.stock_value || 0;

      // Dynamic reserves quantity: closing_stock qty + In - Out
      const computedQty = closingQty + totalIn - totalOut;

      // Find unit price as of this period range
      let price = 0;
      if (closingQty > 0 && closingVal > 0) {
        price = closingVal / closingQty;
      } else if (filteredTxs.length > 0) {
        const sortedPeriodTxs = [...filteredTxs].sort((a, b) => {
          const db = b.timestamp ? new Date(b.timestamp).getTime() : (b.date ? new Date(b.date).getTime() : 0);
          const da = a.timestamp ? new Date(a.timestamp).getTime() : (a.date ? new Date(a.date).getTime() : 0);
          return db - da;
        });
        const latestTxWithPrice = sortedPeriodTxs.find((t) => (Number(t.quantity) || 0) > 0 && (Number(t.stock_value) || 0) > 0);
        if (latestTxWithPrice) {
          price = (Number(latestTxWithPrice.stock_value) || 0) / (Number(latestTxWithPrice.quantity) || 0);
        }
      }

      if (price === 0) {
        price = masterItem ? (Number(masterItem.price) || 0) : (closingRow?.price || 0);
      }

      const computedValuation = computedQty * price;

      // Establish timeline point of the last update inside our date limit
      let lastUpdatedStr = "";
      if (filteredTxs.length > 0) {
        const sortedTxsDesc = [...filteredTxs].sort((a, b) => b.date.localeCompare(a.date));
        lastUpdatedStr = sortedTxsDesc[0].timestamp || sortedTxsDesc[0].date;
      } else if (closingRow && csRows.find(r => r.sku === sku)?.date) {
        lastUpdatedStr = csRows.find(r => r.sku === sku)!.date;
      } else if ((masterItem as any)?.last_updated) {
        lastUpdatedStr = (masterItem as any).last_updated;
      } else {
        lastUpdatedStr = masterItem?.created_at || "";
      }

      // Filter: only include positive stock items at the target period endpoint
      if (computedQty > 0) {
        calculatedItems.push({
          sku,
          item_name: itemName,
          unit,
          department,
          quantity: computedQty,
          price: price,
          stock_value: computedValuation,
          last_updated: lastUpdatedStr || endLimit
        });
      }
    });

    return calculatedItems;
  }

  async function runDateWiseStockReport() {
    setLoading(true);
    try {
      const [ls, csRows, ioRows]: [LatestStockItem[], ClosingStockItem[], Transaction[]] = await Promise.all([
        fetchAllRows("latest_stock"),
        fetchAllRows("closing_stock", "*"),
        fetchAllRows("in_out_manual", "*")
      ]);

      const isMonthMode = dateWiseType === "month";
      const startLimit = isMonthMode ? selectedMonthStart : selectedDateStart;
      const endLimit = isMonthMode ? selectedMonthEnd : selectedDateEnd;

      const calculated = calculateDynamicStockLevels(ls, csRows, ioRows, startLimit, endLimit, isMonthMode);
      setReportItems(calculated);
    } catch (e: any) {
      alert(`Report processing failed: ${e.message}`);
    } finally {
      setLoading(false);
    }
  }

  function handleExport() {
    if (sortedAndFilteredItems.length === 0) {
      alert("No data available to compile.");
      return;
    }

    let csv = "";
    const ds = new Date().toISOString().split("T")[0];

    if (activeReport === "dept_value") {
      const total = sortedAndFilteredItems.reduce((sum, r) => sum + (r.stock_value || 0), 0);
      csv = "Department,Valuation Value (₹),Valuation Percentage (%)\n";
      sortedAndFilteredItems.forEach((r) => {
        const pct = total > 0 ? ((r.stock_value / total) * 105 / 105 * 100).toFixed(2) : "0.00";
        csv += `"${r.department}",${r.stock_value},${pct}%\n`;
      });
    } else if (activeReport === "in_but_not_out") {
      csv = "Timestamp,SKU,Type,Date Received,Total Received In Qty,Item Description,Stock Value,Department\n";
      sortedAndFilteredItems.forEach((r) => {
        csv += `"${r.timestamp}","${r.sku}","IN","${r.date}",${r.quantity},"${r.item_name}",${r.stock_value},"${r.department || ""}"\n`;
      });
    } else if (activeReport === "frequently_reordered") {
      csv = "Timestamp,SKU,In/Out,Date Ordered,Quantity,Item Description,Transaction Value,Department,Rank Orders Count\n";
      sortedAndFilteredItems.forEach((r) => {
        csv += `"${r.timestamp}","${r.sku}","${r.in_out}","${r.date}",${r.quantity},"${r.item_name}",${r.stock_value},"${r.department || ""}",${r.frequency}\n`;
      });
    } else if (activeReport === "date_wise_stock") {
      csv = "SKU,Item Name,Department,Reserves Quantity,Price,Stock Valuation (₹),Last Updated\n";
      sortedAndFilteredItems.forEach((r) => {
        csv += `"${r.sku}","${r.item_name}","${r.department || ""}",${r.quantity},${r.price},${r.stock_value},"${r.last_updated || r.updated_at || r.created_at || ""}"\n`;
      });
    } else {
      csv = "SKU,Item Name Description,Department,Quantity,Stock Valuation Value (₹)\n";
      sortedAndFilteredItems.forEach((r) => {
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

  const toggleSort = (field: string) => {
    if (sortField === field) {
      setSortOrder(prev => prev === "asc" ? "desc" : "asc");
    } else {
      setSortField(field);
      setSortOrder("desc");
    }
  };

  const renderSortableHeader = (label: string, field: string, textRight = false) => {
    const isSorted = sortField === field;
    return (
      <th 
        onClick={() => toggleSort(field)}
        className={`px-6 py-4 cursor-pointer hover:bg-slate-100/70 transition-colors group select-none ${textRight ? "text-right" : "text-left"}`}
      >
        <div className={`flex items-center gap-1.5 ${textRight ? "justify-end" : ""}`}>
          <span className="text-[10px] uppercase font-bold tracking-wider text-slate-400 group-hover:text-slate-700">{label}</span>
          <ArrowUpDown className={`w-3.5 h-3.5 transition-all ${isSorted ? "text-indigo-650 scale-105 opacity-100" : "text-slate-300 opacity-40 group-hover:opacity-80"}`} />
        </div>
      </th>
    );
  };

  // Real-time calculated subsets with search & sorting
  const filteredItems = reportItems.filter((item) => {
    if (!reportSearchQuery) return true;
    const query = reportSearchQuery.toLowerCase();
    const skuMatch = (item.sku || "").toLowerCase().includes(query);
    const nameMatch = (item.item_name || "").toLowerCase().includes(query);
    const deptMatch = (item.department || "").toLowerCase().includes(query);
    return skuMatch || nameMatch || deptMatch;
  });

  const sortedAndFilteredItems = [...filteredItems].sort((a, b) => {
    if (!sortField) return 0;
    
    let valA = a[sortField];
    let valB = b[sortField];
    
    if (sortField === "last_updated") {
      valA = a.last_updated || a.updated_at || a.created_at || "";
      valB = b.last_updated || b.updated_at || b.created_at || "";
    }
    
    if (typeof valA === "number" && typeof valB === "number") {
      return sortOrder === "asc" ? valA - valB : valB - valA;
    }
    
    return sortOrder === "asc"
      ? String(valA || "").localeCompare(String(valB || ""))
      : String(valB || "").localeCompare(String(valA || ""));
  });

  const liveRecordsCount = filteredItems.length;
  const liveQtySum = filteredItems.reduce((sum, r) => sum + (Number(r.quantity) || 0), 0);
  const liveValueSum = filteredItems.reduce((sum, r) => sum + (Number(r.stock_value) || 0), 0);

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
            className="bg-gradient-to-br from-rose-50/40 via-white to-white border border-rose-100 rounded-2xl p-6 hover:shadow-[0_8px_30px_rgba(244,63,94,0.12)] hover:border-rose-300 transition-all cursor-pointer relative group duration-300"
          >
            <div className="flex items-start justify-between">
              <span className="p-3 bg-rose-100 text-rose-600 rounded-xl group-hover:scale-105 transition-transform duration-300 shadow-sm">
                <AlertTriangle className="w-6 h-6 border-transparent" />
              </span>
              <span className="px-2.5 py-1 text-[10px] font-extrabold rounded-full bg-rose-100 text-rose-700 uppercase tracking-widest border border-rose-200">
                Critical Alert
              </span>
            </div>
            <h3 className="text-lg font-bold text-rose-950 mt-5 group-hover:text-rose-600 transition-colors">Negative Stock Ledger</h3>
            <p className="text-xs text-slate-500 mt-2 leading-relaxed">
              Find items registered with negative warehouse reserves quantities or values.
            </p>
          </div>

          {/* 2: High Value */}
          <div
            onClick={() => runReport("high_value")}
            className="bg-gradient-to-br from-indigo-50/40 via-white to-white border border-indigo-100 rounded-2xl p-6 hover:shadow-[0_8px_30px_rgba(99,102,241,0.12)] hover:border-indigo-300 transition-all cursor-pointer relative group duration-300"
          >
            <div className="flex items-start justify-between">
              <span className="p-3 bg-indigo-100 text-indigo-600 rounded-xl group-hover:scale-105 transition-transform duration-300 shadow-sm">
                <TrendingUp className="w-6 h-6" />
              </span>
              <span className="px-2.5 py-1 text-[10px] font-extrabold rounded-full bg-indigo-100 text-indigo-700 uppercase tracking-widest border border-indigo-200">
                Auditing
              </span>
            </div>
            <h3 className="text-lg font-bold text-indigo-950 mt-5 group-hover:text-indigo-600 transition-colors">High Value Items (Top 50)</h3>
            <p className="text-xs text-slate-500 mt-2 leading-relaxed">
              Ranking top 50 inventory descriptions representing the highest capital values.
            </p>
          </div>

          {/* 3: Zero Value */}
          <div
            onClick={() => runReport("zero_value")}
            className="bg-gradient-to-br from-amber-50/20 via-white to-white border border-amber-100 rounded-2xl p-6 hover:shadow-[0_8px_30px_rgba(245,158,11,0.08)] hover:border-amber-300 transition-all cursor-pointer relative group duration-300"
          >
            <div className="flex items-start justify-between">
              <span className="p-3 bg-amber-100 text-amber-700 rounded-xl group-hover:scale-105 transition-transform duration-300 shadow-sm">
                <Ban className="w-6 h-6" />
              </span>
              <span className="px-2.5 py-1 text-[10px] font-extrabold rounded-full bg-amber-100 text-amber-700 uppercase tracking-widest border border-amber-200">
                Discrepancy
              </span>
            </div>
            <h3 className="text-lg font-bold text-amber-950 mt-5 group-hover:text-amber-700 transition-colors">Zero Value Items</h3>
            <p className="text-xs text-slate-500 mt-2 leading-relaxed">
              Track items containing positive physical counts but holding null valuation parameters.
            </p>
          </div>

          {/* 4: Dept Valuation */}
          <div
            onClick={() => runReport("dept_value")}
            className="bg-gradient-to-br from-teal-50/40 via-white to-white border border-teal-100 rounded-2xl p-6 hover:shadow-[0_8px_30px_rgba(20,184,166,0.1)] hover:border-teal-300 transition-all cursor-pointer relative group duration-300"
          >
            <div className="flex items-start justify-between">
              <span className="p-3 bg-teal-100 text-teal-600 rounded-xl group-hover:scale-105 transition-transform duration-300 shadow-sm">
                <Building2 className="w-6 h-6" />
              </span>
              <span className="px-2.5 py-1 text-[10px] font-extrabold rounded-full bg-teal-100 text-teal-700 uppercase tracking-widest border border-teal-200">
                Allocation
              </span>
            </div>
            <h3 className="text-lg font-bold text-teal-950 mt-5 group-hover:text-teal-600 transition-colors">Department Valuation</h3>
            <p className="text-xs text-slate-500 mt-2 leading-relaxed">
              Explore aggregate stock assets investments distributed department-wise.
            </p>
          </div>

          {/* 5: Electrical */}
          <div
            onClick={() => runReport("electrical")}
            className="bg-gradient-to-br from-yellow-50/40 via-white to-white border border-yellow-100 rounded-2xl p-6 hover:shadow-[0_8px_30px_rgba(234,179,8,0.1)] hover:border-yellow-300 transition-all cursor-pointer relative group duration-300"
          >
            <div className="flex items-start justify-between">
              <span className="p-3 bg-yellow-100 text-yellow-600 rounded-xl group-hover:scale-105 transition-transform duration-300 shadow-sm">
                <Bolt className="w-6 h-6 animate-pulse" />
              </span>
              <span className="px-2.5 py-1 text-[10px] font-extrabold rounded-full bg-yellow-100 text-yellow-800 uppercase tracking-widest border border-yellow-200">
                Segmented
              </span>
            </div>
            <h3 className="text-lg font-bold text-yellow-950 mt-5 group-hover:text-yellow-600 transition-colors">Electrical Registry</h3>
            <p className="text-xs text-slate-500 mt-2 leading-relaxed">
              Automatic scanning targeting wire lines, bulbs, switches and electrical spares.
            </p>
          </div>

          {/* 6: Machinery spares */}
          <div
            onClick={() => runReport("machinery")}
            className="bg-gradient-to-br from-cyan-50/40 via-white to-white border border-cyan-100 rounded-2xl p-6 hover:shadow-[0_8px_30px_rgba(6,182,212,0.1)] hover:border-cyan-300 transition-all cursor-pointer relative group duration-300"
          >
            <div className="flex items-start justify-between">
              <span className="p-3 bg-cyan-100 text-cyan-600 rounded-xl group-hover:scale-105 transition-transform duration-300 shadow-sm">
                <Hammer className="w-6 h-6 animate-none" />
              </span>
              <span className="px-2.5 py-1 text-[10px] font-extrabold rounded-full bg-cyan-100 text-cyan-700 uppercase tracking-widest border border-cyan-200">
                Spares Parts
              </span>
            </div>
            <h3 className="text-lg font-bold text-cyan-950 mt-5 group-hover:text-cyan-600 transition-colors">Machinery Spares</h3>
            <p className="text-xs text-slate-500 mt-2 leading-relaxed">
              Filtered inventory snapshot of valves, pumps, gear wheels and backup elements.
            </p>
          </div>

          {/* 7: Low Stock */}
          <div
            onClick={() => runReport("low_stock")}
            className="bg-gradient-to-br from-orange-50/40 via-white to-white border border-orange-100 rounded-2xl p-6 hover:shadow-[0_8px_30px_rgba(249,115,22,0.12)] hover:border-orange-300 transition-all cursor-pointer relative group duration-300"
          >
            <div className="flex items-start justify-between">
              <span className="p-3 bg-orange-100 text-orange-600 rounded-xl group-hover:scale-105 transition-transform duration-300 shadow-sm">
                <AlertCircle className="w-6 h-6 border-transparent" />
              </span>
              <span className="px-2.5 py-1 text-[10px] font-extrabold rounded-full bg-orange-100 text-orange-700 uppercase tracking-widest border border-orange-200">
                Running Low
              </span>
            </div>
            <h3 className="text-lg font-bold text-orange-950 mt-5 group-hover:text-orange-600 transition-colors">Low Stock Alert</h3>
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
              // Set default dates if not already present, then execute immediately
              const today = new Date().toISOString().split("T")[0];
              const past = new Date();
              past.setMonth(past.getMonth() - 1);
              const lastMonth = past.toISOString().split("T")[0];
              const dates = ibnoDates.start ? ibnoDates : { start: lastMonth, end: today };
              if (!ibnoDates.start) {
                setIbnoDates(dates);
              }
              runInButNotOutReport(dates);
            }}
            className="bg-gradient-to-br from-violet-50/40 via-white to-white border border-violet-100 rounded-2xl p-6 hover:shadow-[0_8px_30px_rgba(139,92,246,0.12)] hover:border-violet-300 transition-all cursor-pointer relative group duration-300"
          >
            <div className="flex items-start justify-between">
              <span className="p-3 bg-violet-100 text-violet-600 rounded-xl group-hover:scale-105 transition-transform duration-300 shadow-sm">
                <Calendar className="w-6 h-6" />
              </span>
              <span className="px-2.5 py-1 text-[10px] font-extrabold rounded-full bg-violet-100 text-violet-700 uppercase tracking-widest border border-violet-200">
                Stock Activity
              </span>
            </div>
            <h3 className="text-lg font-bold text-violet-950 mt-5 group-hover:text-violet-600 transition-colors">In But Not Out</h3>
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
              // Set default dates if not already present, then execute immediately
              const today = new Date().toISOString().split("T")[0];
              const past = new Date();
              past.setMonth(past.getMonth() - 1);
              const lastMonth = past.toISOString().split("T")[0];
              const dates = froDates.start ? froDates : { start: lastMonth, end: today };
              if (!froDates.start) {
                setFroDates(dates);
              }
              runFrequentlyReorderedReport(dates);
            }}
            className="bg-gradient-to-br from-pink-50/40 via-white to-white border border-pink-100 rounded-2xl p-6 hover:shadow-[0_8px_30px_rgba(236,72,153,0.12)] hover:border-pink-300 transition-all cursor-pointer relative group duration-300"
          >
            <div className="flex items-start justify-between">
              <span className="p-3 bg-pink-100 text-pink-600 rounded-xl group-hover:scale-105 transition-transform duration-300 shadow-sm">
                <History className="w-6 h-6 bg-transparent" />
              </span>
              <span className="px-2.5 py-1 text-[10px] font-extrabold rounded-full bg-pink-100 text-pink-700 uppercase tracking-widest border border-pink-200">
                Fast Velocity
              </span>
            </div>
            <h3 className="text-lg font-bold text-pink-950 mt-5 group-hover:text-pink-600 transition-colors">Frequently Re-Order</h3>
            <p className="text-xs text-slate-500 mt-2 leading-relaxed">
              Review and audit fast-reordered components within warehouse dating records.
            </p>
          </div>

          {/* 10: Date Wise Stock */}
          <div
            onClick={() => {
              setActiveReport("date_wise_stock");
              setReportTitle("Date & Month-Wise Stock Level Report");
              setReportSubtitle("Review active products with positive stock counts at dates or months registration points.");
              
              const defaultMonthStart = "2025-12";
              const defaultMonthEnd = "2026-04";
              
              setSelectedMonthStart(defaultMonthStart);
              setSelectedMonthEnd(defaultMonthEnd);
              setSelectedDateStart("2025-12-01");
              setSelectedDateEnd("2026-04-30");
              setDateWiseType("month");
              setLoading(true);

              Promise.all([
                fetchAllRows("latest_stock"),
                fetchAllRows("closing_stock", "*"),
                fetchAllRows("in_out_manual", "*")
              ]).then(([ls, csRows, ioRows]) => {
                const calculated = calculateDynamicStockLevels(ls, csRows, ioRows, defaultMonthStart, defaultMonthEnd, true);
                setReportItems(calculated);
                setLoading(false);
              }).catch(() => setLoading(false));
            }}
            className="bg-gradient-to-br from-emerald-50/50 via-white to-white border border-emerald-100 rounded-2xl p-6 hover:shadow-[0_8px_30px_rgba(16,185,129,0.15)] hover:border-emerald-300 transition-all cursor-pointer relative group duration-300"
          >
            <div className="flex items-start justify-between">
              <span className="p-3 bg-emerald-100 text-emerald-700 rounded-xl group-hover:scale-105 transition-transform duration-300 shadow-sm">
                <Calendar className="w-6 h-6 animate-none" />
              </span>
              <span className="px-2.5 py-1 text-[10px] font-extrabold rounded-full bg-emerald-100 text-emerald-800 uppercase tracking-widest border border-emerald-200">
                Timeline Report
              </span>
            </div>
            <h3 className="text-lg font-bold text-slate-900 mt-5 group-hover:text-emerald-700 transition-colors">Date Wise Stock Report</h3>
            <p className="text-xs text-slate-500 mt-2 leading-relaxed">
              Analyze incoming products holding positive stock coming from the latest stock sheets, filtered by date or month.
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

          {activeReport === "date_wise_stock" && (
            <div className="p-6 border-b border-slate-100 bg-indigo-50/20 flex flex-col gap-5">
              {/* Filter Method Segmented Control */}
              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                <div className="flex bg-slate-100 p-1 rounded-xl border border-slate-200">
                  <button
                    type="button"
                    onClick={() => {
                      setDateWiseType("month");
                    }}
                    className={`px-4 py-2 text-xs font-bold rounded-lg transition-all ${
                      dateWiseType === "month"
                        ? "bg-white text-indigo-700 shadow-sm"
                        : "text-slate-550 hover:text-slate-800"
                    }`}
                  >
                    Filter by Month Range
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setDateWiseType("day");
                    }}
                    className={`px-4 py-2 text-xs font-bold rounded-lg transition-all ${
                      dateWiseType === "day"
                        ? "bg-white text-indigo-700 shadow-sm"
                        : "text-slate-550 hover:text-slate-800"
                    }`}
                  >
                    Filter by Specific Days
                  </button>
                </div>
                
                <div className="flex flex-wrap gap-2.5">
                  <button
                    onClick={runDateWiseStockReport}
                    className="px-5 py-2.5 bg-indigo-650 hover:bg-indigo-700 text-white font-bold rounded-xl text-xs flex items-center justify-center gap-2 transition-all cursor-pointer shadow-sm"
                  >
                    <Calendar className="w-4 h-4" />
                    Refresh Date Wise Report
                  </button>
                  <button
                    onClick={handleExport}
                    className="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl text-xs flex items-center justify-center gap-2 transition-all cursor-pointer shadow-sm"
                    title="Export current compiled and filtered list directly to a CSV document file"
                  >
                    <Download className="w-4 h-4" />
                    Download CSV Report
                  </button>
                </div>
              </div>

              {/* Range Inputs based on choice */}
              <div className="flex flex-col md:flex-row gap-4">
                {dateWiseType === "month" ? (
                  <>
                    <div className="w-full md:w-1/2">
                      <label className="block text-[10px] font-extrabold uppercase text-slate-400 tracking-wider mb-1.5">
                        Start Month
                      </label>
                      <input
                        type="month"
                        value={selectedMonthStart}
                        onChange={(e) => setSelectedMonthStart(e.target.value)}
                        className="w-full text-xs font-semibold border border-slate-200 rounded-xl px-3.5 py-2 outline-none focus:ring-2 focus:ring-indigo-500 bg-white cursor-pointer"
                      />
                    </div>
                    <div className="w-full md:w-1/2">
                      <label className="block text-[10px] font-extrabold uppercase text-slate-400 tracking-wider mb-1.5">
                        End Month
                      </label>
                      <input
                        type="month"
                        value={selectedMonthEnd}
                        onChange={(e) => setSelectedMonthEnd(e.target.value)}
                        className="w-full text-xs font-semibold border border-slate-200 rounded-xl px-3.5 py-2 outline-none focus:ring-2 focus:ring-indigo-500 bg-white cursor-pointer"
                      />
                    </div>
                  </>
                ) : (
                  <>
                    <div className="w-full md:w-1/2">
                      <label className="block text-[10px] font-extrabold uppercase text-slate-400 tracking-wider mb-1.5">
                        Start Date
                      </label>
                      <input
                        type="date"
                        value={selectedDateStart}
                        onChange={(e) => setSelectedDateStart(e.target.value)}
                        className="w-full text-xs font-semibold border border-slate-200 rounded-xl px-3.5 py-2 outline-none focus:ring-2 focus:ring-indigo-500 bg-white cursor-pointer"
                      />
                    </div>
                    <div className="w-full md:w-1/2">
                      <label className="block text-[10px] font-extrabold uppercase text-slate-400 tracking-wider mb-1.5">
                        End Date
                      </label>
                      <input
                        type="date"
                        value={selectedDateEnd}
                        onChange={(e) => setSelectedDateEnd(e.target.value)}
                        className="w-full text-xs font-semibold border border-slate-200 rounded-xl px-3.5 py-2 outline-none focus:ring-2 focus:ring-indigo-500 bg-white cursor-pointer"
                      />
                    </div>
                  </>
                )}
              </div>
            </div>
          )}

          {/* SEARCH BAR & DYNAMIC STATS PANEL */}
          {!loading && reportItems.length > 0 && (
            <div className="p-6 border-b border-slate-100 bg-slate-50/50 space-y-6">
              {/* Real-time search query input to fix gaps/glitches */}
              <div className="relative">
                <Search className="w-4 h-4 text-slate-400 absolute left-4 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  placeholder="Real-time filter: Type SKU, Item Name description or department to filter compiled results..."
                  value={reportSearchQuery}
                  onChange={(e) => setReportSearchQuery(e.target.value)}
                  className="w-full pl-11 pr-10 py-3 text-sm font-semibold border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-indigo-500 bg-white shadow-xs transition-all"
                />
                {reportSearchQuery && (
                  <button
                    onClick={() => {
                      setReportSearchQuery("");
                    }}
                    className="absolute right-3.5 top-1/2 -translate-y-1/2 w-5 h-5 rounded-full bg-slate-150 text-slate-400 text-xs hover:bg-slate-200 hover:text-slate-600 transition-colors flex items-center justify-center font-black cursor-pointer"
                    title="Clear filter text"
                  >
                    ×
                  </button>
                )}
              </div>

              {/* Colorful Metrics Summary Row (Sums & Valuation Counts) */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                {/* 1. Matches Items Card */}
                <div className="bg-gradient-to-br from-indigo-500/10 to-indigo-500/[0.02] border border-indigo-150/60 rounded-2xl p-4 flex items-center gap-4 shadow-xs">
                  <div className="p-3 bg-indigo-500/15 text-indigo-700 rounded-xl">
                    <Layers className="w-5 h-5" />
                  </div>
                  <div>
                    <span className="block text-[10px] font-extrabold uppercase text-indigo-650 tracking-wider">Matched Lines</span>
                    <span className="text-xl font-extrabold text-indigo-900">{formatNumber(liveRecordsCount)}</span>
                    <span className="text-[10px] text-slate-400 font-bold block">matched criteria</span>
                  </div>
                </div>

                {/* 2. Reserves Qty Sum Card */}
                {activeReport !== "dept_value" && (
                  <div className="bg-gradient-to-br from-emerald-500/10 to-emerald-500/[0.02] border border-emerald-200/50 rounded-2xl p-4 flex items-center gap-4 shadow-xs">
                    <div className="p-3 bg-emerald-500/15 text-emerald-700 rounded-xl">
                      <PackageOpen className="w-5 h-5" />
                    </div>
                    <div>
                      <span className="block text-[10px] font-extrabold uppercase text-emerald-650 tracking-wider">Total Reserves Qty</span>
                      <span className="text-xl font-black text-emerald-900">{formatNumber(liveQtySum)}</span>
                      <span className="text-[10px] text-slate-400 font-bold block">summed physical units</span>
                    </div>
                  </div>
                )}

                {/* 3. Valuation Sum Card */}
                <div className="bg-gradient-to-br from-amber-500/10 to-amber-500/[0.02] border border-amber-200/60 rounded-2xl p-4 flex items-center gap-4 shadow-xs">
                  <div className="p-3 bg-amber-500/15 text-amber-700 rounded-xl">
                    <Tag className="w-5 h-5" />
                  </div>
                  <div>
                    <span className="block text-[10px] font-extrabold uppercase text-amber-650 tracking-wider">Stock Valuation</span>
                    <span className="text-xl font-black text-amber-950">{formatCurrency(liveValueSum)}</span>
                    <span className="text-[10px] text-slate-400 font-bold block">capital reserves value</span>
                  </div>
                </div>
              </div>
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
            ) : activeReport === "date_wise_stock" ? (
              <table className="w-full text-slate-650 text-sm">
                <thead className="bg-slate-50 text-[10px] uppercase font-bold tracking-wider text-slate-400 border-b border-slate-100">
                  <tr>
                    {renderSortableHeader("SKU", "sku")}
                    {renderSortableHeader("Item Name Description", "item_name")}
                    {renderSortableHeader("Department Division", "department")}
                    {renderSortableHeader("Reserves Qty", "quantity")}
                    {renderSortableHeader("Unit Price", "price")}
                    {renderSortableHeader("Stock Valuation (₹)", "stock_value")}
                    {renderSortableHeader("Last Updated Point", "last_updated", true)}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {sortedAndFilteredItems.length > 0 ? (
                    <>
                      {sortedAndFilteredItems.map((item, i) => (
                        <tr key={i} className="hover:bg-slate-50/60 transition-colors font-medium">
                          <td className="px-6 py-4 text-slate-900 font-bold whitespace-nowrap">{item.sku}</td>
                          <td className="px-6 py-4 font-bold text-slate-900">{item.item_name}</td>
                          <td className="px-6 py-4 text-slate-500 font-semibold">{item.department}</td>
                          <td className="px-6 py-4 font-extrabold text-slate-850">
                            {formatNumber(item.quantity)} <span className="text-[10px] font-bold text-slate-400">{item.unit || "pcs"}</span>
                          </td>
                          <td className="px-6 py-4 font-bold text-slate-650">{formatCurrency(item.price)}</td>
                          <td className="px-6 py-4 font-black text-slate-950">{formatCurrency(item.stock_value)}</td>
                          <td className="px-6 py-4 text-right text-xs text-slate-400 font-semibold font-mono whitespace-nowrap">
                            {formatDateTime(item.last_updated || item.updated_at || item.created_at)}
                          </td>
                        </tr>
                      ))}
                      {/* Highlighted Footer Summary Row for date_wise_stock */}
                      <tr className="bg-indigo-50/30 font-extrabold border-t-2 border-indigo-100/80">
                        <td colSpan={3} className="px-6 py-4 text-slate-700 text-xs uppercase tracking-wider font-extrabold text-right">Summed Total:</td>
                        <td className="px-6 py-4 text-indigo-950 text-base font-black">
                          {formatNumber(liveQtySum)}
                        </td>
                        <td className="px-6 py-4 text-slate-400">-</td>
                        <td className="px-6 py-4 text-indigo-950 text-base font-black">
                          {formatCurrency(liveValueSum)}
                        </td>
                        <td className="px-6 py-4 text-right text-xs text-indigo-600 font-bold whitespace-nowrap">
                          Live Filtered
                        </td>
                      </tr>
                    </>
                  ) : (
                    <tr>
                      <td colSpan={7} className="py-24 text-center text-slate-400 font-semibold">
                        No active stock reserves matching the picked dates range filters.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            ) : activeReport === "dept_value" ? (
              <table className="w-full text-slate-650 text-sm">
                <thead className="bg-slate-50 text-[10px] uppercase font-bold tracking-wider text-slate-400 border-b border-slate-100">
                  <tr>
                    {renderSortableHeader("Department Division Title", "department")}
                    {renderSortableHeader("Valued Asset Sum (₹)", "stock_value")}
                    <th className="px-6 py-4 text-right text-[10px] uppercase font-bold tracking-wider text-slate-400">Investment Partition Percentage</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {sortedAndFilteredItems.length > 0 ? (
                    <>
                      {sortedAndFilteredItems.map((r, i) => {
                        const totalSum = sortedAndFilteredItems.reduce((s, it) => s + (it.stock_value || 0), 0);
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
                      })}
                      {/* Highlighted Footer Summary Row for dept_value */}
                      <tr className="bg-indigo-50/30 font-extrabold border-t-2 border-indigo-100/80">
                        <td className="px-6 py-4 text-slate-700 text-xs uppercase tracking-wider font-extrabold text-right">Summed Total Valuation:</td>
                        <td className="px-6 py-4 text-indigo-950 text-base font-black">{formatCurrency(liveValueSum)}</td>
                        <td className="px-6 py-4 text-right text-xs text-indigo-600 font-semibold font-mono">100.00%</td>
                      </tr>
                    </>
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
                    {renderSortableHeader("Timestamp", "timestamp")}
                    {renderSortableHeader("SKU", "sku")}
                    {renderSortableHeader("Date Received", "date")}
                    {renderSortableHeader("Summed Inflow Qty", "quantity")}
                    {renderSortableHeader("Item Name description", "item_name")}
                    {renderSortableHeader("Estimated Asset Value", "stock_value")}
                    {renderSortableHeader("Department", "department", true)}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {sortedAndFilteredItems.length > 0 ? (
                    <>
                      {sortedAndFilteredItems.map((item, i) => (
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
                      ))}
                      {/* Highlighted Footer Summary Row for in_but_not_out */}
                      <tr className="bg-indigo-50/30 font-extrabold border-t-2 border-indigo-100/80">
                        <td colSpan={3} className="px-6 py-4 text-slate-700 text-xs uppercase tracking-wider font-extrabold text-right">Summed Total:</td>
                        <td className="px-6 py-4 text-indigo-950 text-base font-black">{formatNumber(liveQtySum)}</td>
                        <td className="px-6 py-4 text-slate-400">-</td>
                        <td className="px-6 py-4 text-indigo-950 text-base font-black">{formatCurrency(liveValueSum)}</td>
                        <td className="px-6 py-4 text-right text-xs text-indigo-600 font-bold whitespace-nowrap">Live Filtered</td>
                      </tr>
                    </>
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
                    {renderSortableHeader("Timestamp", "timestamp")}
                    {renderSortableHeader("SKU", "sku")}
                    {renderSortableHeader("Date Ordered", "date")}
                    {renderSortableHeader("Quantity", "quantity")}
                    {renderSortableHeader("Item Name description", "item_name")}
                    {renderSortableHeader("Value (₹)", "stock_value")}
                    {renderSortableHeader("Department", "department")}
                    <th className="px-6 py-4 text-right text-[10px] uppercase font-bold tracking-wider text-slate-400">Count Orders</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {sortedAndFilteredItems.length > 0 ? (
                    <>
                      {sortedAndFilteredItems.map((item, i) => (
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
                      ))}
                      {/* Highlighted Footer Summary Row for frequently_reordered */}
                      <tr className="bg-indigo-50/30 font-extrabold border-t-2 border-indigo-100/80">
                        <td colSpan={3} className="px-6 py-4 text-slate-700 text-xs uppercase tracking-wider font-extrabold text-right">Summed Total:</td>
                        <td className="px-6 py-4 text-indigo-950 text-base font-black">{formatNumber(liveQtySum)}</td>
                        <td className="px-6 py-4 text-slate-400">-</td>
                        <td className="px-6 py-4 text-indigo-950 text-base font-black">{formatCurrency(liveValueSum)}</td>
                        <td className="px-6 py-4 text-slate-500">-</td>
                        <td className="px-6 py-4 text-right text-xs text-indigo-600 font-bold whitespace-nowrap">Live Filtered</td>
                      </tr>
                    </>
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
                    {renderSortableHeader("SKU", "sku")}
                    {renderSortableHeader("Item Name description", "item_name")}
                    {renderSortableHeader("Department division", "department")}
                    {renderSortableHeader("Under physical qty", "quantity")}
                    {renderSortableHeader("Summed valuation value (₹)", "stock_value", true)}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {sortedAndFilteredItems.length > 0 ? (
                    <>
                      {sortedAndFilteredItems.map((r) => (
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
                      ))}
                      {/* Highlighted Footer Summary Row for Fallbacks */}
                      <tr className="bg-indigo-50/30 font-extrabold border-t-2 border-indigo-100/80">
                        <td colSpan={3} className="px-6 py-4 text-slate-700 text-xs uppercase tracking-wider font-extrabold text-right">Summed Total:</td>
                        <td className="px-6 py-4 text-indigo-950 text-base font-black">{formatNumber(liveQtySum)}</td>
                        <td className="px-6 py-4 text-indigo-950 text-base font-black text-right whitespace-nowrap">{formatCurrency(liveValueSum)}</td>
                      </tr>
                    </>
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

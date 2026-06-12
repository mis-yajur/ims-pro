import React, { useState, useEffect, useRef } from "react";
import { fetchAllRows, sbGet, sbPost, sbPatch, sbRpc, sbDelete, formatCurrency, formatNumber, formatDate, recalculateAndPatchLatestStock } from "../utils/supabase";
import { Transaction, LatestStockItem } from "../types";
import { DEPARTMENTS_LIST } from "../constants";
import { Edit2, Trash2, FileOutput, Plus, Search, HelpCircle, XCircle, ChevronLeft, ChevronRight, AlertTriangle } from "lucide-react";

interface InOutTabProps {
  showAddModalTrigger: boolean;
  onResetModalTrigger: () => void;
  onSyncRequest: () => void;
}

export default function InOutTab({ showAddModalTrigger, onResetModalTrigger, onSyncRequest }: InOutTabProps) {
  // Primary layout filters state
  const [filters, setFilters] = useState({
    startDate: "",
    endDate: "",
    type: "All",
    department: "All",
    sku: "",
    itemName: "",
  });

  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [count, setCount] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);

  // Grand totals of filtered transactions
  const [grandTotals, setGrandTotals] = useState({ qty: 0, val: 0, visible: false });

  // Autocomplete names list
  const [itemNamesList, setItemNamesList] = useState<string[]>([]);

  // Transaction Modal State
  const [modalOpen, setModalOpen] = useState(false);
  const [modalTitle, setModalTitle] = useState("Add Transaction");
  const [txId, setTxId] = useState<number | null>(null);

  const [modalForm, setModalForm] = useState({
    sku: "",
    in_out: "In" as "In" | "Out",
    date: new Date().toISOString().split("T")[0],
    quantity: "",
    item_name: "",
    price: "",
    stock_value: "",
    department: "",
    current_stock: "0",
    unit: "",
  });

  const [stockWarning, setStockWarning] = useState<string | null>(null);
  const [saveDisabled, setSaveDisabled] = useState(false);

  // Set default dates
  useEffect(() => {
    const today = new Date().toISOString().split("T")[0];
    const past = new Date();
    past.setMonth(past.getMonth() - 1);
    const lastMonth = past.toISOString().split("T")[0];

    setFilters((prev) => ({
      ...prev,
      startDate: lastMonth,
      endDate: today,
    }));

    loadTransactions(1, lastMonth, today);
    loadItemNames();
  }, []);

  // Sync outside trigger to open modal for quick actions
  useEffect(() => {
    if (showAddModalTrigger) {
      showAddModal();
      onResetModalTrigger();
    }
  }, [showAddModalTrigger]);

  async function loadItemNames() {
    try {
      const { data } = await sbGet("latest_stock", "?select=item_name&order=item_name.asc");
      const names = Array.from(new Set(data.map((r: any) => r.item_name).filter(Boolean))) as string[];
      setItemNamesList(names);
    } catch (e) {
      console.error("Failed load names:", e);
    }
  }

  async function loadTransactions(p = 1, forceStart?: string, forceEnd?: string) {
    setLoading(true);
    setPage(p);
    try {
      const sD = forceStart !== undefined ? forceStart : filters.startDate;
      const eD = forceEnd !== undefined ? forceEnd : filters.endDate;

      let q = "?order=date.desc,timestamp.desc";
      if (sD) q += `&date=gte.${sD}`;
      if (eD) q += `&date=lte.${eD}`;
      if (filters.type !== "All") q += `&in_out=eq.${filters.type}`;
      if (filters.department !== "All") q += `&department=eq.${encodeURIComponent(filters.department)}`;
      if (filters.sku) q += `&sku=ilike.*${filters.sku}*`;
      if (filters.itemName) q += `&item_name=ilike.*${filters.itemName}*`;

      // 1. Fetch grand totals of matching transactions (requires fetchAll to be client side persistent)
      const allMatching: Transaction[] = await fetchAllRows("in_out_manual", "quantity,stock_value", q);
      const grandTotalQty = allMatching.reduce((sum, r) => sum + Math.abs(Number(r.quantity) || 0), 0);
      const grandTotalVal = allMatching.reduce((sum, r) => sum + Math.abs(Number(r.stock_value) || 0), 0);

      // 2. Fetch actually paginated rows
      const offset = (p - 1) * 20;
      const { data, count: totalCount } = await sbGet("in_out_manual", `${q}&limit=20&offset=${offset}`);

      setTransactions(data || []);
      setCount(totalCount || allMatching.length);

      if (sD && eD) {
        setGrandTotals({ qty: grandTotalQty, val: grandTotalVal, visible: true });
      } else {
        setGrandTotals({ qty: 0, val: 0, visible: false });
      }
    } catch (e: any) {
      console.error("Load transactions failed:", e);
    } finally {
      setLoading(false);
    }
  }

  function handleFilterChange(field: string, val: string) {
    setFilters((prev) => ({ ...prev, [field]: val }));
  }

  function handleResetFilters() {
    const today = new Date().toISOString().split("T")[0];
    const past = new Date();
    past.setMonth(past.getMonth() - 1);
    const lastMonth = past.toISOString().split("T")[0];

    const resetFields = {
      startDate: lastMonth,
      endDate: today,
      type: "All",
      department: "All",
      sku: "",
      itemName: "",
    };
    setFilters(resetFields);
    setPage(1);
    loadTransactions(1, lastMonth, today);
  }

  async function handleExportCSV() {
    setLoading(true);
    try {
      let q = "?select=*&order=date.desc";
      if (filters.startDate) q += `&date=gte.${filters.startDate}`;
      if (filters.endDate) q += `&date=lte.${filters.endDate}`;
      if (filters.type !== "All") q += `&in_out=eq.${filters.type}`;
      if (filters.department !== "All") q += `&department=eq.${encodeURIComponent(filters.department)}`;
      if (filters.sku) q += `&sku=ilike.*${filters.sku}*`;
      if (filters.itemName) q += `&item_name=ilike.*${filters.itemName}*`;

      const data: Transaction[] = await fetchAllRows("in_out_manual", "*", q);

      let csv = "Timestamp,SKU,In/Out,Date,Quantity,Item Name,Value,Department\n";
      data.forEach((r) => {
        csv += `"${r.timestamp}","${r.sku}","${r.in_out}","${r.date}",${r.quantity},"${r.item_name}",${r.stock_value},"${r.department || ""}"\n`;
      });

      const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
      const link = document.createElement("a");
      link.setAttribute("href", URL.createObjectURL(blob));
      link.setAttribute("download", `Transactions_${new Date().toISOString().split("T")[0]}.csv`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } catch (e) {
      console.error("Export failure:", e);
    } finally {
      setLoading(false);
    }
  }

  // Transaction Form logic
  function showAddModal() {
    setModalTitle("Add Transaction");
    setTxId(null);
    setModalForm({
      sku: "",
      in_out: "In",
      date: new Date().toISOString().split("T")[0],
      quantity: "",
      item_name: "",
      price: "",
      stock_value: "",
      department: "",
      current_stock: "0",
      unit: "",
    });
    setStockWarning(null);
    setSaveDisabled(false);
    setModalOpen(true);
  }

  async function handleSKUChange(sku: string) {
    const cleanSku = sku.toUpperCase().replace(/\s+/g, "");
    setModalForm((prev) => ({ ...prev, sku: cleanSku }));
    if (!cleanSku) return;

    try {
      // 1. Silently recalculate and sync current SKU in database to get the absolute live quantity state
      const syncedItem = await recalculateAndPatchLatestStock(cleanSku);
      
      let item = syncedItem;
      if (!item) {
        const { data } = await sbGet("latest_stock", `?sku=eq.${encodeURIComponent(cleanSku)}&select=*&limit=1`);
        if (data && data.length > 0) {
          item = data[0];
        }
      }

      if (item) {
        const qVal = modalForm.quantity;
        const qty = parseFloat(qVal) || 0;
        const price = Number(item.price) || 0;
        const calculatedValue = qty * price;

        setModalForm((prev) => {
          const updated = {
            ...prev,
            item_name: item.item_name || "",
            unit: item.unit || "",
            department: item.department || "",
            current_stock: String(item.quantity || 0),
            price: String(price),
            stock_value: calculatedValue > 0 ? calculatedValue.toFixed(2) : "",
          };
          verifyStock(updated.in_out, qty, Number(item.quantity || 0));
          return updated;
        });
      } else {
        // If this SKU was never registered anywhere, initialize it to 0 current stock
        setModalForm((prev) => {
          const updated = {
            ...prev,
            current_stock: "0"
          };
          verifyStock(updated.in_out, parseFloat(updated.quantity) || 0, 0);
          return updated;
        });
      }
    } catch (e) {
      console.error("SKU details fetch failed:", e);
    }
  }

  function handleModalFieldChange(field: string, val: string) {
    setModalForm((prev) => {
      const updated = { ...prev, [field]: val };

      if (field === "quantity" || field === "price") {
        const qty = parseFloat(updated.quantity) || 0;
        const prc = parseFloat(updated.price) || 0;
        updated.stock_value = qty * prc > 0 ? (qty * prc).toFixed(2) : "";
      }

      const verifiedQty = parseFloat(updated.quantity) || 0;
      const staticStock = parseFloat(updated.current_stock) || 0;
      verifyStock(updated.in_out, verifiedQty, staticStock);

      return updated;
    });
  }

  function verifyStock(type: "In" | "Out", qty: number, stock: number) {
    if (type === "Out" && qty > stock) {
      setStockWarning(`Stock Insufficient! Available quantity is ${stock} but you are issuing ${qty}.`);
      setSaveDisabled(true);
    } else {
      setStockWarning(null);
      setSaveDisabled(false);
    }
  }

  async function handleSaveTransaction() {
    const qty = parseFloat(modalForm.quantity);
    const val = parseFloat(modalForm.stock_value);

    if (!modalForm.sku || !modalForm.item_name || isNaN(qty) || qty <= 0 || !modalForm.department) {
      alert("Please fill in all mandatory fields with correct positive values.");
      return;
    }

    setLoading(true);
    try {
      const body = {
        sku: modalForm.sku,
        in_out: modalForm.in_out,
        date: modalForm.date,
        quantity: qty,
        item_name: modalForm.item_name,
        stock_value: isNaN(val) ? 0 : val,
        department: modalForm.department,
        timestamp: new Date().toISOString(),
      };

      if (txId) {
        // Recalculate previous SKU if it was switched during editing
        try {
          const { data: oldTxList } = await sbGet("in_out_manual", `?id=eq.${txId}&select=sku`);
          if (oldTxList && oldTxList.length > 0 && oldTxList[0].sku !== modalForm.sku) {
            await recalculateAndPatchLatestStock(oldTxList[0].sku);
          }
        } catch (err) {
          console.error("Retrieving previous transaction SKU failed:", err);
        }
        await sbPatch("in_out_manual", txId, body);
      } else {
        await sbPost("in_out_manual", body);
      }

      // Recalculate the current SKU's stock state securely
      await recalculateAndPatchLatestStock(modalForm.sku);

      setModalOpen(false);

      // Trigger standard DB calculations (shielded from throwing errors)
      try {
        await sbRpc("run_all_calculations");
      } catch (err) {
        console.warn("Stored procedure run_all_calculations failed (which is bypassed by client-side calculator sync):", err);
      }
      onSyncRequest(); // Refresh the parent's dashboard numbers too
      loadTransactions(page);
    } catch (e: any) {
      alert(`Save failed: ${e.message}`);
    } finally {
      setLoading(false);
    }
  }

  async function handleEditTransaction(id: number) {
    setLoading(true);
    try {
      const { data } = await sbGet("in_out_manual", `?id=eq.${id}&select=*&limit=1`);
      if (data && data.length > 0) {
        const r: Transaction = data[0];
        setModalTitle("Edit Transaction");
        setTxId(id);

        const currentPrice = r.stock_value && r.quantity ? r.stock_value / r.quantity : 0;

        setModalForm({
          sku: r.sku,
          in_out: r.in_out,
          date: r.date,
          quantity: String(r.quantity),
          item_name: r.item_name,
          price: String(currentPrice),
          stock_value: String(r.stock_value),
          department: r.department,
          current_stock: "0", // Will be filled immediately below
          unit: "",
        });

        // Fetch current stock
        const { data: stockData } = await sbGet("latest_stock", `?sku=eq.${encodeURIComponent(r.sku)}&select=*&limit=1`);
        if (stockData && stockData.length > 0) {
          setModalForm((prev) => ({
            ...prev,
            current_stock: String(stockData[0].quantity || 0),
            unit: stockData[0].unit || "",
          }));
        }

        setStockWarning(null);
        setSaveDisabled(false);
        setModalOpen(true);
      }
    } catch (e: any) {
      alert(`Error loading transaction: ${e.message}`);
    } finally {
      setLoading(false);
    }
  }

  async function handleDeleteTransaction(id: number) {
    if (!confirm("Are you absolutely sure you want to delete this stock transaction? This will automatically adjust current stock level values.")) {
      return;
    }
    setLoading(true);
    try {
      // Fetch transaction first to grab the target SKU
      const { data } = await sbGet("in_out_manual", `?id=eq.${id}&select=sku`);
      const skuToRecalc = data && data.length > 0 ? data[0].sku : null;

      await sbDelete("in_out_manual", id);

      // Recalculate target SKU stock bounds
      if (skuToRecalc) {
        await recalculateAndPatchLatestStock(skuToRecalc);
      }

      try {
        await sbRpc("run_all_calculations");
      } catch (err) {
        console.warn("DB trigger execution failed during deletion (bypassed on client):", err);
      }
      onSyncRequest();
      loadTransactions(page);
    } catch (e: any) {
      alert(`Delete failed: ${e.message}`);
    } finally {
      setLoading(false);
    }
  }

  const totalPages = Math.ceil(count / 20);

  return (
    <div className="space-y-6 animate-fadeIn pb-12">
      {/* Tab Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-extrabold text-slate-900 tracking-tight flex items-center gap-3">
            Transaction Ledger
          </h1>
          <p className="text-slate-500 mt-2">Manage incoming (IN) and outgoing (OUT) inventory stock assignments.</p>
        </div>
        <div className="flex items-center gap-3 text-sm">
          <button
            onClick={handleExportCSV}
            className="px-4 py-2.5 bg-white border border-slate-200 text-slate-700 font-semibold rounded-xl hover:bg-slate-50 transition-colors flex items-center gap-2 shadow-sm"
          >
            <FileOutput className="w-4 h-4 text-slate-400" />
            Export CSV
          </button>
          <button
            onClick={showAddModal}
            className="px-5 py-2.5 bg-indigo-600 text-white font-semibold rounded-xl hover:bg-indigo-700 transition-all flex items-center gap-2 shadow-md hover:shadow-indigo-100"
          >
            <Plus className="w-4 h-4" />
            Add Transaction
          </button>
        </div>
      </div>

      {/* Advanced Filter Box */}
      <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm">
        <h3 className="text-xs font-bold uppercase text-slate-400 tracking-wider mb-4 flex items-center gap-2">
          <Search className="w-4 h-4" />
          Filter Parameters
        </h3>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-6 gap-4">
          <div className="lg:col-span-2">
            <label className="block text-xs font-bold text-slate-500 uppercase tracking-widest mb-1.5">Date Range</label>
            <div className="flex gap-2">
              <input
                type="date"
                value={filters.startDate}
                onChange={(e) => handleFilterChange("startDate", e.target.value)}
                className="w-full text-sm border border-slate-200 rounded-xl px-3.5 py-2 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none"
              />
              <input
                type="date"
                value={filters.endDate}
                onChange={(e) => handleFilterChange("endDate", e.target.value)}
                className="w-full text-sm border border-slate-200 rounded-xl px-3.5 py-2 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-500 uppercase tracking-widest mb-1.5">Action Type</label>
            <select
              value={filters.type}
              onChange={(e) => handleFilterChange("type", e.target.value)}
              className="w-full text-sm border border-slate-200 rounded-xl px-3.5 py-2 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none bg-white font-medium"
            >
              <option value="All">All Transactions</option>
              <option value="In">IN (Add Stock)</option>
              <option value="Out">OUT (Issue Stock)</option>
            </select>
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-500 uppercase tracking-widest mb-1.5">Department</label>
            <select
              value={filters.department}
              onChange={(e) => handleFilterChange("department", e.target.value)}
              className="w-full text-sm border border-slate-200 rounded-xl px-3.5 py-2 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none bg-white max-w-full"
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
            <label className="block text-xs font-bold text-slate-500 uppercase tracking-widest mb-1.5">Item Name</label>
            <input
              type="text"
              value={filters.itemName}
              onChange={(e) => handleFilterChange("itemName", e.target.value)}
              placeholder="Search descriptions..."
              list="tabItemNamesAutocomp"
              className="w-full text-sm border border-slate-200 rounded-xl px-3.5 py-2 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none"
            />
            <datalist id="tabItemNamesAutocomp">
              {itemNamesList.map((name, idx) => (
                <option key={idx} value={name} />
              ))}
            </datalist>
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-500 uppercase tracking-widest mb-1.5">SKU Code</label>
            <input
              type="text"
              value={filters.sku}
              onChange={(e) => handleFilterChange("sku", e.target.value)}
              placeholder="Enter SKU..."
              className="w-full text-sm border border-slate-200 rounded-xl px-3.5 py-2 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none"
            />
          </div>
        </div>

        <div className="mt-5 pt-4 border-t border-slate-100 flex justify-between items-center">
          <span className="text-xs font-bold text-slate-400">
            {count} matching records found over database search
          </span>
          <div className="flex gap-2">
            <button
              onClick={handleResetFilters}
              className="px-4 py-2 border border-slate-200 text-slate-600 font-semibold rounded-xl text-xs hover:bg-slate-50 transition-colors"
            >
              Reset Parameters
            </button>
            <button
              onClick={() => loadTransactions(1)}
              className="px-5 py-2.5 bg-slate-900 border border-slate-950 text-white font-semibold rounded-xl text-xs hover:bg-slate-800 transition-colors"
            >
              Apply Filter
            </button>
          </div>
        </div>
      </div>

      {/* Date-Filtered Grand Totals */}
      {grandTotals.visible && (
        <div className="bg-slate-900 text-white px-6 py-5 rounded-2xl border border-slate-950 shadow-md animate-fadeIn flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
          <div>
            <h4 className="text-sm font-bold text-indigo-300">Summed Output for Period Selection</h4>
            <p className="text-xs text-slate-400 mt-1">
              Calculated aggregate of matched transactions between dates.
            </p>
          </div>
          <div className="flex justify-between items-center gap-12 self-stretch md:self-auto border-t md:border-t-0 border-slate-800 pt-3 md:pt-0">
            <div>
              <span className="block text-[9px] uppercase tracking-wider font-extrabold text-slate-500">
                Summed Outflow Quantity
              </span>
              <span className="text-xl font-extrabold tracking-tight text-white">{formatNumber(grandTotals.qty)}</span>
            </div>
            <div>
              <span className="block text-[9px] uppercase tracking-wider font-extrabold text-slate-500">
                Summed Outflow Valuation
              </span>
              <span className="text-xl font-extrabold tracking-tight text-emerald-400">
                {formatCurrency(grandTotals.val)}
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Transactions Grid */}
      <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden flex flex-col">
        <div className="overflow-x-auto">
          <table className="w-full text-slate-600 text-sm">
            <thead className="bg-slate-50 text-[10px] uppercase font-bold tracking-wider text-slate-400 border-b border-slate-100">
              <tr>
                <th className="px-6 py-4 text-left">SKU</th>
                <th className="px-6 py-4 text-left">Action</th>
                <th className="px-6 py-4 text-left">Date</th>
                <th className="px-6 py-4 text-left">Quantity</th>
                <th className="px-6 py-3.5 text-left max-w-sm">Description item name</th>
                <th className="px-6 py-4 text-left">Transaction Val</th>
                <th className="px-6 py-4 text-left">Department assignment</th>
                <th className="px-6 py-4 text-right">Operation</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr>
                  <td colSpan={8} className="py-24 text-center">
                    <div className="flex flex-col items-center justify-center gap-3">
                      <div className="w-8 h-8 rounded-full border-2 border-indigo-600 border-t-transparent animate-spin" />
                      <span className="text-xs font-semibold text-slate-400">Consulting remote database...</span>
                    </div>
                  </td>
                </tr>
              ) : transactions.length > 0 ? (
                transactions.map((tx) => (
                  <tr key={tx.id} className="hover:bg-slate-50/60 transition-colors">
                    <td className="px-6 py-3.5 font-bold text-slate-900 whitespace-nowrap">{tx.sku}</td>
                    <td className="px-6 py-3.5 whitespace-nowrap">
                      {tx.in_out === "In" ? (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-bold bg-emerald-50 text-emerald-700 border border-emerald-100">
                          IN
                        </span>
                      ) : (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-bold bg-rose-50 text-rose-700 border border-rose-100">
                          OUT
                        </span>
                      )}
                    </td>
                    <td className="px-6 py-3.5 text-xs text-slate-500 font-semibold whitespace-nowrap">
                      {formatDate(tx.date)}
                    </td>
                    <td className="px-6 py-3.5 font-bold text-slate-800 whitespace-nowrap">{formatNumber(tx.quantity)}</td>
                    <td className="px-6 py-3 text-slate-900 font-medium max-w-sm break-words">{tx.item_name}</td>
                    <td className="px-6 py-3.5 font-bold text-slate-900 whitespace-nowrap">
                      {formatCurrency(tx.stock_value)}
                    </td>
                    <td className="px-6 py-3.5 text-xs font-semibold whitespace-nowrap text-slate-500">
                      {tx.department}
                    </td>
                    <td className="px-6 py-3.5 text-right whitespace-nowrap">
                      <div className="inline-flex gap-2">
                        <button
                          onClick={() => handleEditTransaction(tx.id!)}
                          className="p-1.5 text-slate-500 hover:text-indigo-600 hover:bg-slate-100 rounded-md transition-colors"
                        >
                          <Edit2 className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => handleDeleteTransaction(tx.id!)}
                          className="p-1.5 text-slate-500 hover:text-rose-600 hover:bg-slate-100 rounded-md transition-colors"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={8} className="py-24 text-center">
                    <div className="flex flex-col items-center justify-center gap-2">
                      <XCircle className="w-10 h-10 text-slate-300" />
                      <span className="text-sm font-bold text-slate-700">Empty Ledger Matches</span>
                      <span className="text-xs text-slate-400">
                        Adjust dating parameters or parameters filter values.
                      </span>
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination bar */}
        {!loading && totalPages > 1 && (
          <div className="px-6 py-4.5 border-t border-slate-100 bg-slate-50 flex items-center justify-between text-xs font-semibold text-slate-500">
            <span>
              Page {page} of {totalPages} ({count} matching entries)
            </span>
            <div className="flex items-center gap-1">
              <button
                onClick={() => loadTransactions(page - 1)}
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
                        onClick={() => loadTransactions(pNum)}
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
                onClick={() => loadTransactions(page + 1)}
                disabled={page >= totalPages}
                className="p-2 border border-slate-200 rounded-xl bg-white text-slate-500 hover:bg-slate-50 disabled:opacity-50 transition-colors"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* MODAL WINDOW FOR TRADING */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white rounded-2xl border border-slate-200 max-w-2xl w-full shadow-2xl overflow-hidden flex flex-col my-8 animate-scaleIn">
            <div className="px-6 py-5 border-b border-slate-100 flex justify-between items-center bg-slate-50">
              <h2 className="text-lg font-bold text-slate-900 tracking-tight">{modalTitle}</h2>
              <button
                onClick={() => setModalOpen(false)}
                className="w-8 h-8 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 flex items-center justify-center transition-colors cursor-pointer"
              >
                <XCircle className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 overflow-y-auto space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-slate-500 uppercase tracking-widest mb-1.5">
                    SKU Code *
                  </label>
                  <input
                    type="text"
                    value={modalForm.sku}
                    onChange={(e) => handleSKUChange(e.target.value)}
                    placeholder="Enter unique SKU code..."
                    required
                    className="w-full text-sm border border-slate-200 rounded-xl px-4 py-2.5 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-500 uppercase tracking-widest mb-1.5">
                    Action Direction *
                  </label>
                  <select
                    value={modalForm.in_out}
                    onChange={(e) => handleModalFieldChange("in_out", e.target.value as "In" | "Out")}
                    required
                    className="w-full text-sm border border-slate-200 rounded-xl px-4 py-2.5 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none bg-white font-semibold"
                  >
                    <option value="In">IN (Add Incoming Stock)</option>
                    <option value="Out">OUT (Issue Outgoing Stock)</option>
                  </select>
                </div>

                <div className="md:col-span-2">
                  <label className="block text-xs font-bold text-slate-500 uppercase tracking-widest mb-1.5">
                    Item Name Descriptor *
                  </label>
                  <input
                    type="text"
                    value={modalForm.item_name}
                    readOnly
                    placeholder="Auto-resolves based on SKU..."
                    className="w-full text-sm bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 outline-none text-slate-500 font-semibold cursor-not-allowed"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-500 uppercase tracking-widest mb-1.5">
                    Transaction Date *
                  </label>
                  <input
                    type="date"
                    value={modalForm.date}
                    onChange={(e) => handleModalFieldChange("date", e.target.value)}
                    required
                    className="w-full text-sm border border-slate-200 rounded-xl px-4 py-2.5 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-500 uppercase tracking-widest mb-1.5">
                    Assigned Quantity *
                  </label>
                  <input
                    type="number"
                    value={modalForm.quantity}
                    onChange={(e) => handleModalFieldChange("quantity", e.target.value)}
                    placeholder="0.00"
                    min="0.01"
                    step="0.01"
                    required
                    className="w-full text-sm border border-slate-200 rounded-xl px-4 py-2.5 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-500 uppercase tracking-widest mb-1.5">
                    Price per Unit (₹)
                  </label>
                  <input
                    type="number"
                    value={modalForm.price}
                    onChange={(e) => handleModalFieldChange("price", e.target.value)}
                    placeholder="Auto or manual value"
                    min="0"
                    step="0.0001"
                    className="w-full text-sm border border-slate-200 rounded-xl px-4 py-2.5 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-500 uppercase tracking-widest mb-1.5">
                    Compilated Value (₹)
                  </label>
                  <input
                    type="text"
                    value={modalForm.stock_value ? formatCurrency(parseFloat(modalForm.stock_value)) : ""}
                    readOnly
                    placeholder="Q * P automatically..."
                    className="w-full text-sm bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 outline-none font-bold text-slate-700 cursor-not-allowed"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-500 uppercase tracking-widest mb-1.5">
                    Current Stocks
                  </label>
                  <input
                    type="text"
                    value={`${formatNumber(parseFloat(modalForm.current_stock))} ${modalForm.unit}`}
                    readOnly
                    className="w-full text-sm bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 outline-none text-slate-500 cursor-not-allowed font-medium"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-500 uppercase tracking-widest mb-1.5">
                    Department Assignment *
                  </label>
                  <select
                    value={modalForm.department}
                    onChange={(e) => handleModalFieldChange("department", e.target.value)}
                    required
                    className="w-full text-sm border border-slate-200 rounded-xl px-4 py-2.5 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none bg-white max-w-full font-medium"
                  >
                    <option value="">Choose department list...</option>
                    {DEPARTMENTS_LIST.map((dept) => (
                      <option key={dept} value={dept}>
                        {dept}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {stockWarning && (
                <div className="p-4 rounded-xl border border-rose-200 bg-rose-50/80 text-rose-800 text-sm font-medium flex items-start gap-3 animate-pulse">
                  <AlertTriangle className="w-5 h-5 text-rose-500 flex-shrink-0 mt-0.5" />
                  <div>
                    <h5 className="font-bold text-rose-900">Insufficient Warehouse Level</h5>
                    <p className="text-rose-700 text-xs mt-1 leading-normal">{stockWarning}</p>
                  </div>
                </div>
              )}
            </div>

            <div className="px-6 py-4.5 border-t border-slate-100 bg-slate-50 flex items-center justify-end gap-3.5">
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                className="px-4 py-2.5 border border-slate-200 bg-white text-slate-750 font-semibold rounded-xl text-sm hover:bg-slate-50 transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSaveTransaction}
                disabled={saveDisabled || loading}
                className="px-5 py-2.5 bg-indigo-600 text-white font-bold rounded-xl text-sm hover:bg-indigo-700 transition-all shadow-md hover:shadow-indigo-100 disabled:opacity-50 cursor-pointer"
              >
                Save Stock Update
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

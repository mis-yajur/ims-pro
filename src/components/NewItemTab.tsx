import React, { useState } from "react";
import { sbGet, sbPost, initializeSupabaseConfig } from "../utils/supabase";
import { DEPARTMENTS_LIST } from "../constants";
import { PlusCircle, RefreshCw, Save, CheckCircle, AlertTriangle } from "lucide-react";

export default function NewItemTab() {
  const [form, setForm] = useState({
    date: new Date().toISOString().split("T")[0],
    sku: "",
    item_name: "",
    unit: "",
    department: "",
  });

  const [loading, setLoading] = useState(false);
  const [outcome, setOutcome] = useState<{ type: "success" | "error"; message: string } | null>(null);

  function handleFieldChange(field: string, val: string) {
    setForm((prev) => ({ ...prev, [field]: val }));
    if (outcome) setOutcome(null);
  }

  function handleReset() {
    setForm({
      date: new Date().toISOString().split("T")[0],
      sku: "",
      item_name: "",
      unit: "",
      department: "",
    });
    setOutcome(null);
  }

  async function handleRegisterNewItem() {
    // Basic verification
    if (!form.sku.trim() || !form.item_name.trim() || !form.unit.trim() || !form.department) {
      setOutcome({
        type: "error",
        message: "Validation Error: All inputs are mandatory. Please enter accurate product information.",
      });
      return;
    }

    setLoading(true);
    setOutcome(null);

    try {
      const skuChecked = form.sku.trim();

      // 1. Verify if SKU already exists in latest_stock
      const { data: existing } = await sbGet("latest_stock", `?sku=eq.${encodeURIComponent(skuChecked)}&select=*&limit=1`);
      if (existing && existing.length > 0) {
        setOutcome({
          type: "error",
          message: `Deduplication Check: SKU code "${skuChecked}" already registered inside system inventory.`,
        });
        setLoading(false);
        return;
      }

      // 2. Insert to closing_stock (stores openings entries)
      await sbPost("closing_stock", {
        date: form.date,
        sku: skuChecked,
        item_name: form.item_name.trim(),
        unit: form.unit.trim(),
        department: form.department,
        status: "Active",
        quantity: 0,
        stock_value: 0,
      });

      // 3. Insert to latest_stock with placeholder values so calculations don't drop the product record
      await sbPost("latest_stock", {
        sku: skuChecked,
        item_name: form.item_name.trim(),
        unit: form.unit.trim(),
        department: form.department,
        quantity: 0,
        stock_value: 0,
        price: 0,
        avg_daily_consumption: 0,
        lead_time: 7,
        safety_factor: 0,
        moq: 0,
        max_level: 0,
      });

      setOutcome({
        type: "success",
        message: `Registered Successfully: SKU "${skuChecked}" added. Openings stock points are set to 0.`,
      });

      // Reset values holding form logic
      setForm({
        date: new Date().toISOString().split("T")[0],
        sku: "",
        item_name: "",
        unit: "",
        department: "",
      });
    } catch (e: any) {
      setOutcome({
        type: "error",
        message: `Registration Failure: Server error. Details: ${e.message}`,
      });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-6 animate-fadeIn pb-12">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-extrabold text-slate-900 tracking-tight flex items-center gap-3">
          Register New SKU
        </h1>
        <p className="text-slate-500 mt-2">Introduce a completely new stock keeping unit description into master databases indexes.</p>
      </div>

      <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-8 max-w-2xl mx-auto flex flex-col justify-between">
        {outcome && (
          <div
            className={`p-4 rounded-xl border mb-6 flex items-start gap-3 text-sm leading-relaxed ${
              outcome.type === "success"
                ? "bg-emerald-50 border-emerald-200 text-emerald-800"
                : "bg-rose-50 border-rose-200 text-rose-800"
            }`}
          >
            {outcome.type === "success" ? (
              <CheckCircle className="w-5 h-5 text-emerald-500 flex-shrink-0 mt-0.5" />
            ) : (
              <AlertTriangle className="w-5 h-5 text-rose-500 flex-shrink-0 mt-0.5" />
            )}
            <div>
              <h5 className="font-bold">{outcome.type === "success" ? "Operation Successful" : "Validation Abort"}</h5>
              <p className="text-xs mt-0.5">{outcome.message}</p>
            </div>
          </div>
        )}

        {/* Inputs list */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-5 mb-8">
          <div>
            <label className="block text-xs font-extrabold uppercase tracking-widest text-slate-400 mb-1.5">
              Registration Date *
            </label>
            <input
              type="date"
              value={form.date}
              onChange={(e) => handleFieldChange("date", e.target.value)}
              className="w-full text-sm border border-slate-200 rounded-xl px-4 py-3 focus:ring-2 focus:ring-indigo-500 text-slate-850 outline-none font-semibold whitespace-nowrap bg-white"
              required
            />
          </div>

          <div>
            <label className="block text-xs font-extrabold uppercase tracking-widest text-slate-400 mb-1.5">
              SKU Code *
            </label>
            <input
              type="text"
              value={form.sku}
              onChange={(e) => handleFieldChange("sku", e.target.value.toUpperCase().replace(/\s+/g, ""))}
              placeholder="e.g. ELEC-CB-32A"
              className="w-full text-sm border border-slate-200 rounded-xl px-4 py-3 focus:ring-2 focus:ring-indigo-500 text-slate-850 outline-none font-bold placeholder-slate-300 bg-white"
              required
            />
          </div>

          <div className="sm:col-span-2">
            <label className="block text-xs font-extrabold uppercase tracking-widest text-slate-400 mb-1.5">
              Product description *
            </label>
            <input
              type="text"
              value={form.item_name}
              onChange={(e) => handleFieldChange("item_name", e.target.value)}
              placeholder="e.g. Circuit Breaker MCB 32 Amp Double Pole"
              className="w-full text-sm border border-slate-200 rounded-xl px-4 py-3 focus:ring-2 focus:ring-indigo-500 text-slate-850 outline-none font-bold placeholder-slate-300 bg-white"
              required
            />
          </div>

          <div>
            <label className="block text-xs font-extrabold uppercase tracking-widest text-slate-400 mb-1.5">
              Standard unit *
            </label>
            <input
              type="text"
              value={form.unit}
              onChange={(e) => handleFieldChange("unit", e.target.value)}
              placeholder="e.g. Nos, Meters, Litres"
              className="w-full text-sm border border-slate-200 rounded-xl px-4 py-3 focus:ring-2 focus:ring-indigo-500 text-slate-850 outline-none font-semibold placeholder-slate-300 bg-white"
              required
            />
          </div>

          <div>
            <label className="block text-xs font-extrabold uppercase tracking-widest text-slate-400 mb-1.5">
              Target Warehouse Department *
            </label>
            <select
              value={form.department}
              onChange={(e) => handleFieldChange("department", e.target.value)}
              className="w-full text-sm border border-slate-200 rounded-xl px-4 py-3 bg-white outline-none focus:ring-2 focus:ring-indigo-500 font-semibold text-slate-850"
              required
            >
              <option value="">Select department...</option>
              {DEPARTMENTS_LIST.map((dept) => (
                <option key={dept} value={dept}>
                  {dept}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Buttons */}
        <div className="flex justify-end gap-3.5 pt-6 border-t border-slate-100">
          <button
            type="button"
            onClick={handleReset}
            className="px-5 py-3 border border-slate-200 rounded-xl text-slate-700 font-bold transition-colors hover:bg-slate-50 text-sm cursor-pointer"
          >
            Reset Form
          </button>
          <button
            type="button"
            onClick={handleRegisterNewItem}
            disabled={loading}
            className="px-6 py-3 bg-indigo-600 text-white font-extrabold rounded-xl transition-all shadow-md hover:scale-[1.01] hover:shadow-indigo-100 disabled:opacity-50 flex items-center gap-2 text-sm cursor-pointer"
          >
            {loading ? (
              <RefreshCw className="w-4 h-4 animate-spin text-white" />
            ) : (
              <Save className="w-4 h-4 text-white" />
            )}
            Register Product SKU
          </button>
        </div>
      </div>
    </div>
  );
}

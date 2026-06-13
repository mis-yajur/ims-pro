import React, { useState, useEffect } from "react";
import DashboardTab from "./components/DashboardTab";
import InOutTab from "./components/InOutTab";
import LatestStockTab from "./components/LatestStockTab";
import SafetyFactorTab from "./components/SafetyFactorTab";
import ReportsTab from "./components/ReportsTab";
import NewItemTab from "./components/NewItemTab";
import { initializeSupabaseConfig } from "./utils/supabase";
import { BarChart3, Clock, Database, Globe, HelpCircle, Layers, ShieldCheck, User } from "lucide-react";

export default function App() {
  const [activeTab, setActiveReportTab] = useState<string>("dashboard");
  const [showConfigAlert, setShowConfigAlert] = useState(false);
  const [dbStatus, setDbStatus] = useState<"connected" | "connecting" | "error">("connecting");

  // Sync flags across tabs
  const [quickRunReportType, setQuickRunReportType] = useState<string | null>(null);
  const [syncInOutTabTrigger, setSyncInOutTabTrigger] = useState(false);
  const [syncDashboardTrigger, setSyncDashboardTrigger] = useState(0);

  useEffect(() => {
    // 1. Warm-up and fetch from dynamic configuration
    initializeSupabaseConfig().then((cfg) => {
      if (!cfg.url || cfg.url === "https://REPLACE_WITH_YOUR_SUPABASE_URL") {
        setShowConfigAlert(true);
        setDbStatus("error");
      } else {
        setDbStatus("connected");
      }
    });
  }, []);

  function handleSwitchTab(tab: string) {
    setActiveReportTab(tab);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function handleQuickRunReport(type: string) {
    setQuickRunReportType(type);
    handleSwitchTab("reports");
  }

  function handleTriggerAddTransaction() {
    setSyncInOutTabTrigger(true);
  }

  // Trigger state refreshes across tabs easily
  function handleSyncAcrossTabs() {
    setSyncDashboardTrigger((prev) => prev + 1);
  }

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col font-sans antialiased text-slate-800">
      {/* Top Header Navigation */}
      <header className="sticky top-0 z-40 bg-white/80 backdrop-blur-md border-b border-slate-200">
        <div className="max-w-full mx-auto px-4 md:px-8 lg:px-10">
          <div className="flex justify-between items-center h-16">
            <div className="flex items-center gap-8">
              {/* Logo / Title branding */}
              <div
                onClick={() => handleSwitchTab("dashboard")}
                className="flex items-center gap-2.5 cursor-pointer group"
              >
                <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-indigo-600 to-indigo-505 flex items-center justify-center text-white shadow-md shadow-indigo-100 group-hover:scale-105 transition-transform">
                  <Database className="w-5 h-5 text-white" />
                </div>
                <div>
                  <h1 className="text-lg font-black tracking-tight text-slate-900 flex items-center gap-1.5 leading-none">
                    IMS Pro
                  </h1>
                  <span className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">
                    Warehouse OS
                  </span>
                </div>
              </div>

              {/* Desktop Nav Actions */}
              <nav className="hidden lg:flex items-center gap-1.5 bg-slate-100/90 p-1 rounded-2xl border border-slate-200 shadow-[inset_0_1.5px_3px_rgba(15,23,42,0.03)]">
                {[
                  { id: "dashboard", label: "Dashboard" },
                  { id: "in-out", label: "Transactions" },
                  { id: "latest-stock", label: "Latest Stock" },
                  { id: "safety-factor", label: "Safety Factors" },
                  { id: "reports", label: "Report" },
                  { id: "new-item", label: "Register New SKU" },
                ].map((item) => (
                  <button
                    key={item.id}
                    id={`nav-tab-${item.id}`}
                    onClick={() => handleSwitchTab(item.id)}
                    className={`px-4 py-2 text-sm font-bold rounded-xl transition-all cursor-pointer ${
                      activeTab === item.id
                        ? "bg-white text-indigo-600 shadow-[0_2px_8px_rgba(79,70,229,0.08)] border border-slate-200/40"
                        : "text-slate-600 hover:text-slate-900 hover:bg-white/55"
                    }`}
                  >
                    {item.label}
                  </button>
                ))}
              </nav>
            </div>

            {/* Profile information */}
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2 bg-slate-50 px-3.5 py-1.5 rounded-xl border border-slate-200">
                <span className="relative flex h-2 w-2">
                  <span
                    className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${
                      dbStatus === "connected" ? "bg-emerald-400" : "bg-amber-400"
                    }`}
                  />
                  <span
                    className={`relative inline-flex rounded-full h-2 w-2 ${
                      dbStatus === "connected" ? "bg-emerald-500" : "bg-amber-500"
                    }`}
                  />
                </span>
                <span className="text-[10px] uppercase font-bold text-slate-500 whitespace-nowrap tracking-wider">
                  {dbStatus === "connected" ? "Database Online" : "Connecting Remote..."}
                </span>
              </div>

              <div className="flex items-center gap-2">
                <div className="w-8.5 h-8.5 rounded-xl bg-slate-100 border border-slate-200 flex items-center justify-center font-bold text-slate-600">
                  <User className="w-4 h-4" />
                </div>
                <div className="hidden sm:block leading-tight text-left">
                  <span className="block text-xs font-bold text-slate-800">Admin Console</span>
                  <span className="block text-[9px] uppercase font-semibold text-slate-400">Warehouse Master</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </header>

      {/* Main workspace container */}
      <main className="flex-1 max-w-full w-full mx-auto px-4 md:px-8 lg:px-10 py-8">
        {showConfigAlert && (
          <div className="mb-6 p-4 rounded-xl border border-amber-200 bg-amber-50 text-amber-800 text-sm font-semibold flex items-center gap-3">
            <Globe className="w-5 h-5 flex-shrink-0 animate-pulse" />
            <span>
              Dynamic database setup warning: fallback to production configuration. If configuring custom domains, place
              keys inside <code>config.json</code> in public directory.
            </span>
          </div>
        )}

        {/* Dynamic rendering of tab view content */}
        <div className="transition-all duration-300">
          {activeTab === "dashboard" && (
            <DashboardTab
              key={syncDashboardTrigger}
              onSwitchTab={handleSwitchTab}
              onShowAddTransaction={handleTriggerAddTransaction}
              onRunReport={handleQuickRunReport}
            />
          )}

          {activeTab === "in-out" && (
            <InOutTab
              showAddModalTrigger={syncInOutTabTrigger}
              onResetModalTrigger={() => setSyncInOutTabTrigger(false)}
              onSyncRequest={handleSyncAcrossTabs}
            />
          )}

          {activeTab === "latest-stock" && <LatestStockTab />}

          {activeTab === "safety-factor" && <SafetyFactorTab />}

          {activeTab === "reports" && (
            <ReportsTab quickRunType={quickRunReportType} onClearQuickRun={() => setQuickRunReportType(null)} />
          )}

          {activeTab === "new-item" && <NewItemTab />}
        </div>
      </main>
    </div>
  );
}

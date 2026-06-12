/**
 * IMS Pro Types Definition
 */

export interface Transaction {
  id?: number;
  timestamp: string;
  sku: string;
  in_out: 'In' | 'Out';
  date: string;
  quantity: number;
  item_name: string;
  stock_value: number;
  department: string;
}

export interface LatestStockItem {
  id?: number;
  sku: string;
  item_name: string;
  unit: string;
  department: string;
  quantity: number;
  stock_value: number;
  price: number;
  avg_daily_consumption: number;
  lead_time: number;
  safety_factor: number;
  moq: number;
  max_level: number;
  created_at?: string;
  updated_at?: string;
}

export interface ClosingStockItem {
  id?: number;
  date: string;
  sku: string;
  item_name: string;
  unit: string;
  department: string;
  status: string;
  quantity: number;
  stock_value: number;
  price?: number;
  created_at?: string;
  updated_at?: string;
}

export interface YearlyMonthSummary {
  inQty: number;
  outQty: number;
  inVal: number;
  outVal: number;
}

export interface YearlySummary {
  [month: number]: YearlyMonthSummary;
}

export interface GlobalYearlyData {
  [year: number]: YearlySummary;
}

export interface DepartmentValuation {
  department: string;
  stock_value: number;
  percentage?: number;
}

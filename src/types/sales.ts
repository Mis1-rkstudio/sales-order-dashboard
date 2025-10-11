export type SalesOrderRow = {
  SO_Date?: string | null;
  SO_No?: string | null;
  Customer?: string | null;
  Customer_Type?: string | null;
  Rating?: string | null;
  Broker?: string | null;
  Item?: string | null;
  ItemCode?: string | null;
  Color?: string | null;
  New_Color?: string | null;
  Size?: string | null | number;
  OrderQty?: number | null;
  Expected_Date?: string | null;
  Status?: "Active" | "Cancelled" | null;
  so_date_parsed?: string | null;
  Concept?: string | null;
  Fabric?: string | null;
  File_URL?: string | URL | null;

  Stock?: number | null;
  StockByColor?: Record<string, number> | null;

  // optional production quantity entered by user
  ProductionQty?: number | null;

  __uid?: string;
  __pending?: boolean;
};

export type Filters = {
  q: string;
  tokens: string[];
  brand: string;
  city: string;
  startDate: string;
  endDate: string;
  limit: number;
  customers?: string[];
  items?: string[];
};

export type GroupKey = "Customer" | "Item" | "Color" | "Broker" | "Status";
export const ALL_GROUP_KEYS: GroupKey[] = [
  "Customer",
  "Item",
  "Color",
  "Broker",
  "Status",
];

export type ShipmentStatus =
  | "in_warehouse"
  | "ready_to_ship"
  | "shipped"
  | "moved_to_sorting"
  | "returned_to_warehouse";

export const STATUSES: ShipmentStatus[] = [
  "in_warehouse",
  "returned_to_warehouse",
  "shipped",
  "moved_to_sorting",
  "ready_to_ship",
];

export const statusColor: Record<ShipmentStatus, string> = {
  in_warehouse: "bg-emerald-100 text-emerald-800 border-emerald-300",
  ready_to_ship: "bg-blue-100 text-blue-800 border-blue-300",
  shipped: "bg-red-100 text-red-800 border-red-300",
  moved_to_sorting: "bg-orange-100 text-orange-800 border-orange-300",
  returned_to_warehouse: "bg-purple-100 text-purple-800 border-purple-300",
};

export function statusWarningKey(s: ShipmentStatus): string | null {
  if (s === "moved_to_sorting") return "warnings.sorting";
  if (s === "shipped") return "warnings.shipped";
  if (s === "returned_to_warehouse") return "warnings.returned";
  return null;
}

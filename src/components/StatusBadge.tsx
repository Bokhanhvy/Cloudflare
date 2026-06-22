import { useTranslation } from "react-i18next";
import { statusColor, type ShipmentStatus } from "@/lib/status";

export function StatusBadge({ status }: { status: ShipmentStatus }) {
  const { t } = useTranslation();
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${statusColor[status]}`}
    >
      {t(`status.${status}`)}
    </span>
  );
}

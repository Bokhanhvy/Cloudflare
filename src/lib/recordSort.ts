/**
 * Helpers for ordering shipment records within a product-code group.
 *
 * Some records are created as "reference" entries for a product code rather
 * than a scanned shipment barcode — e.g. a product photo, box photos, or a
 * rework note. These are created (see the Unrecognized screen) with a
 * barcode of the form:
 *
 *   <MA_SAN_PHAM>__<TEN>            e.g. "LJ63-23353K__ANH_SAN_PHAM"
 *
 * i.e. the record's own product code, followed by a double underscore, then
 * a free-form label. Wherever records for a single product code are listed,
 * these "pinned" records should always be shown first, while every other
 * record keeps its existing relative order (by date, name, etc.).
 */

const PIN_SEPARATOR = "__";

/**
 * True when `barcode` follows the `<productCode>__<label>` convention for
 * the given `productCode`. Comparison is case-insensitive and tolerant of
 * surrounding whitespace, since product codes are sometimes typed with
 * inconsistent casing.
 */
export function isPinnedRecord(
  barcode: string | null | undefined,
  productCode: string | null | undefined
): boolean {
  const pc = (productCode || "").trim();
  const bc = (barcode || "").trim();
  if (!pc || !bc) return false;
  return bc.toUpperCase().startsWith(`${pc.toUpperCase()}${PIN_SEPARATOR}`);
}

/**
 * Returns a new array with pinned records (see `isPinnedRecord`) moved to
 * the front of the list. The relative order of pinned records among
 * themselves, and of non-pinned records among themselves, is preserved
 * (stable partition) — so this can be safely applied after any other sort
 * (by date, name, ...) without disturbing it beyond promoting the pinned
 * items.
 */
export function withPinnedFirst<T extends { barcode: string; product_code?: string | null }>(
  items: T[]
): T[] {
  const pinned: T[] = [];
  const rest: T[] = [];
  for (const item of items) {
    if (isPinnedRecord(item.barcode, item.product_code)) pinned.push(item);
    else rest.push(item);
  }
  return [...pinned, ...rest];
}

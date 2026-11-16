import type { AxiosError } from "axios";

/*
 * Whether the server refused a read as a bad request: how a server older
 * than a column answers a select that names it ("Invalid select clause.
 * Cannot select on ..."). The caller then reads again without that column,
 * as it did before the column existed.
 */
export function isRefusedSelect(error: unknown): boolean {
  return (
    Boolean(error) &&
    typeof error === "object" &&
    (error as AxiosError).isAxiosError === true &&
    (error as AxiosError).response?.status === 400
  );
}

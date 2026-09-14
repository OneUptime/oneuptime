import AlignItem from "../../../Types/AlignItem";
import FieldType from "../../Types/FieldType";
import GenericObject from "../../../../Types/GenericObject";
import { ReactElement } from "react";

export default interface Column<T extends GenericObject> {
  title: string;
  // Stable identity carried over from the ModelTable column, if it had one.
  id?: string | undefined;
  description?: string | undefined;
  disableSort?: boolean | undefined;
  tooltipText?: ((item: T) => string) | undefined;
  type: FieldType;
  colSpan?: number | undefined;
  noValueMessage?: string | undefined;
  contentClassName?: string | undefined;
  /*
   * Let this cell's content wrap onto more than one line.
   *
   * Body cells are `whitespace-nowrap` by default, and `white-space` is an
   * INHERITED property - so the nowrap declared on the <td> reaches every
   * element `getElement` returns, whatever classes that element carries. A
   * cell holding a free-text sentence (a status message, a probe error, an
   * operator note) therefore renders as one long line that paints straight
   * over the columns to its right, and a `max-w-*` on the inner element makes
   * that WORSE rather than better: it caps the box the line overflows out of,
   * so the text overlaps its neighbours instead of merely widening the table
   * (OneUptime issue #3585). Never pair a max-width with a nowrap cell - that
   * pairing is what this option exists to make unspellable.
   *
   * Set it on any column whose cell can hold server- or operator-authored
   * prose. The cell then declares `whitespace-normal break-words` and its
   * content is capped at `wrapMaxWidthClassName`, so long text wraps inside
   * the column's own width. Leave it unset - the default, and no change for
   * every column that has one today - for dates, counts, badges, ids and
   * anything else that must stay on a single line.
   *
   * Desktop only, by construction: the mobile card layout declares no nowrap
   * and already wraps, and it reads neither this nor `contentClassName`.
   */
  wrapContent?: boolean | undefined;
  /*
   * Width cap for a wrapping cell, e.g. "max-w-3xl". Read ONLY when
   * `wrapContent` is set; defaults to "max-w-md" (28rem).
   *
   * It belongs here rather than in `contentClassName` for two reasons. Two
   * `max-w-*` utilities on one element are resolved by Tailwind's stylesheet
   * order, not by the order they were written, so the narrower one silently
   * loses; and a width that is only emitted alongside a wrapping mode can
   * never be the overlap generator described above.
   */
  wrapMaxWidthClassName?: string | undefined;
  alignItem?: AlignItem | undefined;
  key?: keyof T | null; //can be null because actions column does not have a key.
  hideOnMobile?: boolean | undefined; // Hide column on mobile devices
  /*
   * Every field that backs this cell, in declaration order. A ModelTable
   * column may declare more than one - e.g. the alert "Affected Resources"
   * cell spans hosts / kubernetesClusters / dockerHosts / podmanHosts /
   * services - while `key` only ever holds the first one, because that is the
   * one used for sorting and for the default renderer. CSV export reads all
   * of them so it does not silently drop the rest. Defaults to [key].
   */
  exportKeys?: Array<string> | undefined;
  /*
   * Exact text for this column's CSV cell, overriding the value read off the
   * row. Use it when the rendered cell is built from something the row does
   * not carry under the column's own field (data fetched alongside the table,
   * a computed summary, several fields combined into one phrase).
   */
  getExportValue?: ((item: T) => string) | undefined;
  // Leave this column out of the CSV export entirely.
  disableCsvExport?: boolean | undefined;
  getElement?:
    | ((item: T, onBeforeFetchData?: T | undefined) => ReactElement)
    | undefined;
}

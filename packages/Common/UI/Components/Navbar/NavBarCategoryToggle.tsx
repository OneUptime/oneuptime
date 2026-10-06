import Icon, { ThickProp } from "../Icon/Icon";
import { Translator } from "../../Utils/TranslateTemplate";
import useTranslator from "../../Utils/UseTranslator";
import IconProp from "../../../Types/Icon/IconProp";
import React, { FunctionComponent, ReactElement, useId } from "react";

/*
 * How a category's row is laid out.
 *
 * Columns: a row of the desktop products menu's list of categories. The
 * list is a grid (CATEGORY_LIST_COLUMNS) and every row takes its columns
 * from it, so the icons, the names, the products each holds and the counts
 * each line up in a column, however long a category's name is.
 *
 * Stacked: the phone menu, too narrow for columns. The row is drawn as the
 * product rows around it are (NavBarItem): the icon before the name, at the
 * same size, stroke and weight, with the products it holds on the line
 * below the name.
 */
export enum NavBarCategoryToggleLayout {
  Columns = "Columns",
  Stacked = "Stacked",
}

/*
 * The columns of the desktop menu's list of categories, which its rows take
 * as a subgrid: icon, name, products, count, chevron. The name takes the
 * width of the longest one; the products take what is left and give way.
 */
export const CATEGORY_LIST_COLUMNS: string =
  "grid-cols-[auto_auto_minmax(0,1fr)_auto_auto]";

// The icon of a category the caller gave none: the products menu's own.
export const DEFAULT_CATEGORY_ICON: IconProp = IconProp.Squares;

export interface ComponentProps {
  // The category's name as the catalog gives it (already in the reader's language).
  title: string;
  // The names of the products inside, for the folded row.
  itemTitles: ReadonlyArray<string>;
  // The category's icon; the products menu's own when unset.
  icon?: IconProp | undefined;
  // Columns in the desktop products menu, stacked (the default) on a phone.
  layout?: NavBarCategoryToggleLayout | undefined;
  isOpen: boolean;
  onToggle: () => void;
  // The element holding the category's products, while they are shown.
  controlsId?: string | undefined;
  // The heading's id, for a group labelled by it.
  headingId?: string | undefined;
  /*
   * The products menu keeps focus in its search box and moves a cursor over
   * its rows with aria-activedescendant: the button's id, whether the cursor
   * is on this row, the row element (to scroll it into view and to find the
   * row above or below), and the hover that moves the cursor here.
   */
  id?: string | undefined;
  isActive?: boolean | undefined;
  rowRef?: ((element: HTMLDivElement | null) => void) | undefined;
  onMouseMove?: (() => void) | undefined;
  // A mouse click opens the category without taking focus from the search box.
  keepsFocusOnClick?: boolean | undefined;
}

/*
 * A category's row, which folds and opens the products under it.
 *
 * Folded, it says what is inside without opening it: the category's icon and
 * name, the products it holds ("Hosts, Kubernetes, Docker, ...") and how
 * many. Open, the same row heads the products, with the chevron turned down
 * as a side-menu section's is.
 *
 * It reads as a row to open, not as a section heading: the name is drawn as
 * a product's title is (sentence case, dark), where it used to be the small
 * spaced capitals of the Essentials heading, and so looked like a heading
 * with a run-on sentence after it.
 *
 * It is the accordion pattern: a <button aria-expanded> inside the heading,
 * so the heading's text stays the category's name. The button's ::after
 * covers the whole row, so a click anywhere on it opens it, and the focus
 * ring is drawn around the row rather than around the word.
 */
const NavBarCategoryToggle: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const summaryId: string = `navbar-category-summary-${useId()}`;
  const count: number = props.itemTitles.length;
  const names: string = props.itemTitles.join(", ");
  const isColumns: boolean =
    props.layout === NavBarCategoryToggleLayout.Columns;
  const isActive: boolean = Boolean(props.isActive);

  const icon: IconProp = props.icon || DEFAULT_CATEGORY_ICON;

  // In columns, the icon sits in a tile, as a product card's does.
  const iconTile: ReactElement = (
    <div
      aria-hidden="true"
      className={`flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg ring-1 transition-colors duration-150 ${
        isActive ? "bg-white ring-indigo-200" : "bg-gray-50 ring-gray-200"
      }`}
    >
      <Icon
        icon={icon}
        className={`h-4 w-4 ${isActive ? "text-indigo-600" : "text-gray-500"}`}
      />
    </div>
  );

  const heading: ReactElement = (
    <h3
      id={props.headingId}
      className={`min-w-0 ${isColumns ? "pr-3" : "flex items-center"}`}
    >
      {!isColumns && (
        <Icon
          icon={icon}
          className="mr-1 h-4 w-4 flex-shrink-0 text-gray-900"
          thick={ThickProp.Thick}
        />
      )}
      <button
        type="button"
        id={props.id}
        aria-expanded={props.isOpen}
        aria-controls={props.isOpen ? props.controlsId : undefined}
        aria-describedby={props.isOpen ? undefined : summaryId}
        onMouseDown={(event: React.MouseEvent<HTMLButtonElement>) => {
          if (props.keepsFocusOnClick) {
            event.preventDefault();
          }
        }}
        onClick={props.onToggle}
        className={`min-w-0 break-words text-left font-medium text-gray-900 focus:outline-none after:absolute after:inset-0 after:content-[''] focus-visible:after:ring-2 focus-visible:after:ring-inset focus-visible:after:ring-indigo-500 ${
          isColumns
            ? "text-sm leading-5"
            : "text-base leading-6 after:rounded-md"
        }`}
      >
        {props.title}
      </button>
    </h3>
  );

  /*
   * What is inside, for the folded row only: once open, the products are
   * right below. Screen readers hear it with the name, count first.
   */
  const summary: ReactElement | null = props.isOpen ? null : (
    <span
      id={summaryId}
      className={`min-w-0 truncate text-gray-500 ${
        isColumns ? "col-start-3 text-sm" : "block pl-5 text-xs leading-4"
      }`}
    >
      <span className="sr-only">
        {translator.translatePlural(
          {
            one: "{{count}} product",
            other: "{{count}} products",
          },
          count,
        )}
      </span>{" "}
      {names}
    </span>
  );

  // The count is said in the summary; drawn, it is a quiet pill.
  const countPill: ReactElement = (
    <span
      aria-hidden="true"
      className={`flex-shrink-0 rounded-full px-2 text-xs font-medium tabular-nums leading-5 transition-colors duration-150 ${
        isActive ? "bg-indigo-100 text-indigo-700" : "bg-gray-100 text-gray-600"
      } ${isColumns ? "col-start-4 justify-self-end" : ""}`}
    >
      {translator.formatNumber(count)}
    </span>
  );

  // Icon draws an <svg> inside a <div>: the wrapper is the grid or flex item.
  const chevron: ReactElement = (
    <div
      className={`flex flex-shrink-0 items-center ${
        isColumns ? "col-start-5" : ""
      }`}
    >
      <Icon
        icon={IconProp.ChevronDown}
        className={`h-4 w-4 transition-transform duration-200 ${
          props.isOpen ? "rotate-0" : "-rotate-90"
        } ${isActive ? "text-indigo-500" : "text-gray-400"}`}
      />
    </div>
  );

  const rowState: string = isActive ? "bg-indigo-50" : "hover:bg-gray-50";

  if (isColumns) {
    return (
      <div
        ref={props.rowRef}
        onMouseMove={props.onMouseMove}
        className={`relative col-span-full grid grid-cols-subgrid items-center px-3 py-2 transition-colors duration-150 ${rowState}`}
      >
        {iconTile}
        {heading}
        {summary}
        {countPill}
        {chevron}
      </div>
    );
  }

  return (
    <div
      ref={props.rowRef}
      onMouseMove={props.onMouseMove}
      className={`relative flex min-w-0 items-center gap-2 rounded-md px-3 py-2 transition-colors duration-150 ${rowState}`}
    >
      <div className="min-w-0 flex-1">
        {heading}
        {summary}
      </div>
      {countPill}
      {chevron}
    </div>
  );
};

export default NavBarCategoryToggle;

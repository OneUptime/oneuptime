import Icon from "../Icon/Icon";
import { Translator } from "../../Utils/TranslateTemplate";
import useTranslator from "../../Utils/UseTranslator";
import IconProp from "../../../Types/Icon/IconProp";
import React, { FunctionComponent, ReactElement, useId } from "react";

export interface ComponentProps {
  // The category's name as the catalog gives it (already in the reader's language).
  title: string;
  // The names of the products inside, for the folded line.
  itemTitles: ReadonlyArray<string>;
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
 * A category heading that folds and opens the products under it.
 *
 * Folded, it is one line: the name, how many products it holds and what they
 * are called ("INFRASTRUCTURE 12 Hosts, Kubernetes, Docker, ..."), so people
 * can tell what is inside without opening it. Open, it is the heading above
 * the products, with the same chevron as a side-menu section: pointing right
 * while folded, down while open.
 *
 * It is the accordion pattern: a <button aria-expanded> inside the heading,
 * so the heading's text stays the category's name. The button's ::after
 * covers the whole row, so a click anywhere on the line opens it, and the
 * focus ring is drawn around the line rather than around the word.
 */
const NavBarCategoryToggle: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const summaryId: string = `navbar-category-summary-${useId()}`;
  const count: number = props.itemTitles.length;
  const names: string = props.itemTitles.join(", ");

  return (
    <div
      ref={props.rowRef}
      onMouseMove={props.onMouseMove}
      className={`relative flex min-w-0 items-center gap-2 rounded-lg border px-2 py-2 transition-colors duration-150 ${
        props.isActive
          ? "border-indigo-300 bg-indigo-50"
          : "border-transparent hover:bg-gray-50"
      }`}
    >
      {/*
       * The name keeps its width and the list of products gives way; only a
       * name too long for the whole line (a long translation on a narrow
       * phone) wraps.
       */}
      <h3 id={props.headingId} className="flex min-w-0 items-center">
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
          className="text-left text-[11px] font-semibold uppercase leading-4 tracking-[0.1em] text-gray-500 focus:outline-none after:absolute after:inset-0 after:rounded-lg after:content-[''] focus-visible:after:ring-2 focus-visible:after:ring-indigo-500"
        >
          {props.title}
        </button>
      </h3>
      {!props.isOpen && (
        <span id={summaryId} className="flex min-w-0 flex-1 items-center gap-2">
          <span
            aria-hidden="true"
            className="flex-shrink-0 rounded-full bg-gray-100 px-1.5 text-[11px] font-medium tabular-nums leading-4 text-gray-600"
          >
            {translator.formatNumber(count)}
          </span>
          <span className="sr-only">
            {translator.translatePlural(
              {
                one: "{{count}} product",
                other: "{{count}} products",
              },
              count,
            )}
          </span>
          <span className="truncate text-xs text-gray-500">{names}</span>
        </span>
      )}
      {/* Icon draws an <svg> inside a <div>: the wrapper is the flex item. */}
      <div className="ml-auto flex flex-shrink-0 items-center">
        <Icon
          icon={IconProp.ChevronDown}
          className={`h-3.5 w-3.5 text-gray-400 transition-transform duration-200 ${
            props.isOpen ? "rotate-0" : "-rotate-90"
          }`}
        />
      </div>
    </div>
  );
};

export default NavBarCategoryToggle;

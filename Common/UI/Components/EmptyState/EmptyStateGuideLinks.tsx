import Icon from "../Icon/Icon";
import Link from "../Link/Link";
import Route from "../../../Types/API/Route";
import URL from "../../../Types/API/URL";
import IconProp from "../../../Types/Icon/IconProp";
import useTranslateValue from "../../Utils/Translation";
import React, { FunctionComponent, ReactElement } from "react";

export interface EmptyStateGuideLink {
  // Stable React key, and the suffix of the link's element id.
  id: string;
  title: string;
  // A short qualifier under the title, e.g. a product category.
  subtitle?: string | undefined;
  icon?: IconProp | undefined;
  to: URL | Route;
  // Defaults to true: a guide is read beside the page, not instead of it.
  openInNewTab?: boolean | undefined;
}

export interface ComponentProps {
  id: string;
  heading?: string | undefined;
  links: Array<EmptyStateGuideLink>;
}

/*
 * Columns come from the width the grid actually has, not the viewport's:
 * an empty state sits in tables beside a side menu, in modals and in full
 * pages, and a viewport breakpoint would squeeze four columns into a
 * table that is only half the screen wide.
 */
export const GUIDE_GRID_CLASS_NAME: string =
  "grid grid-cols-[repeat(auto-fill,minmax(15rem,1fr))] gap-3";

/*
 * A grid of setup-guide links for an EmptyState footer, for when there is
 * more than one place to start (one guide per supported product, say).
 *
 * A bulleted list of links under a centred empty state put its bullets at
 * the far edge of the table and its links in the middle; a grid of cards
 * keeps each guide one obvious, generously sized target, and reads the same
 * at any width.
 */
const EmptyStateGuideLinks: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement | null => {
  const { translateString } = useTranslateValue();

  if (props.links.length === 0) {
    return null;
  }

  const headingId: string = `${props.id}-heading`;

  return (
    <div id={props.id} className="w-full max-w-5xl text-left">
      {props.heading && (
        <h4
          id={headingId}
          className="text-xs font-semibold uppercase tracking-wide text-gray-500"
        >
          {translateString(props.heading)}
        </h4>
      )}
      <ul
        role="list"
        aria-labelledby={props.heading ? headingId : undefined}
        className={`${props.heading ? "mt-3 " : ""}${GUIDE_GRID_CLASS_NAME}`}
      >
        {props.links.map((link: EmptyStateGuideLink): ReactElement => {
          const openInNewTab: boolean = link.openInNewTab !== false;

          return (
            <li key={link.id} className="flex">
              <Link
                id={`${props.id}-${link.id}`}
                to={link.to}
                openInNewTab={openInNewTab}
                className="group flex w-full items-center gap-3 rounded-lg border border-gray-200 bg-white p-3 shadow-sm transition-colors duration-150 ease-out hover:border-indigo-300 hover:bg-indigo-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2"
              >
                {link.icon && (
                  <div
                    aria-hidden="true"
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-gray-50 text-gray-500 ring-1 ring-inset ring-gray-200 group-hover:bg-white group-hover:text-indigo-600"
                  >
                    <Icon icon={link.icon} className="h-5 w-5" />
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <div className="break-words text-sm font-medium text-gray-900 group-hover:text-indigo-700">
                    {translateString(link.title)}
                  </div>
                  {link.subtitle && (
                    <div className="break-words text-xs text-gray-500">
                      {translateString(link.subtitle)}
                    </div>
                  )}
                </div>
                <div aria-hidden="true" className="shrink-0">
                  <Icon
                    icon={
                      openInNewTab
                        ? IconProp.ExternalLink
                        : IconProp.ChevronRight
                    }
                    className="h-4 w-4 text-gray-400 group-hover:text-indigo-500"
                  />
                </div>
                {openInNewTab && (
                  <span className="sr-only">
                    {translateString("(opens in a new tab)")}
                  </span>
                )}
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
};

export default EmptyStateGuideLinks;

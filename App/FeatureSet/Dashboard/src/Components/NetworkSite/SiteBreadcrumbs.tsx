import React, { FunctionComponent, ReactElement } from "react";
import Icon from "Common/UI/Components/Icon/Icon";
import IconProp from "Common/Types/Icon/IconProp";
import { SiteBreadcrumbEntry } from "./SiteHierarchyTypes";

/*
 * Root-first breadcrumb trail for the drill-down network map: a fixed
 * "All Sites" root crumb, then every ancestor, then the current site.
 * Mirrors the top-bar Breadcrumbs component's styling, but navigates via
 * onNavigate instead of router links — the map page keeps the whole drill
 * path in a query param, so a crumb click is a state change, not a route
 * change (and this component stays free of RouteMap imports).
 *
 * Ancestors are muted and interactive (hover + focus ring); the current
 * crumb is a solid pill so the "you are here" step is obvious at the end
 * of a long chain. The list wraps rather than overflowing, so a deep drill
 * path stays fully readable on a narrow viewport.
 */

export interface ComponentProps {
  /** Root-first; the LAST entry is the current site (rendered inert). */
  breadcrumb: Array<SiteBreadcrumbEntry>;
  /** null navigates back to the root (all sites) view. */
  onNavigate: (siteId: string | null) => void;
}

const CRUMB_LINK_CLASS: string =
  "max-w-[12rem] truncate rounded px-1 py-0.5 text-sm font-medium text-gray-500 transition hover:text-gray-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500";

const SiteBreadcrumbs: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const isAtRoot: boolean = props.breadcrumb.length === 0;

  return (
    <nav className="flex" aria-label="Site breadcrumb">
      <ol role="list" className="flex flex-wrap items-center gap-x-0.5 gap-y-1">
        <li className="flex items-center">
          {isAtRoot ? (
            <span
              aria-current="page"
              className="inline-flex items-center gap-1.5 rounded-md bg-gray-100 px-2 py-0.5 text-sm font-semibold text-gray-900"
            >
              <Icon
                className="h-3.5 w-3.5 flex-shrink-0 text-gray-400"
                icon={IconProp.Globe}
              />
              All Sites
            </span>
          ) : (
            <button
              type="button"
              data-testid="site-breadcrumb-root"
              title="Back to all sites"
              className={`inline-flex items-center gap-1.5 ${CRUMB_LINK_CLASS}`}
              onClick={() => {
                props.onNavigate(null);
              }}
            >
              <Icon
                className="h-3.5 w-3.5 flex-shrink-0 text-gray-400"
                icon={IconProp.Globe}
              />
              All Sites
            </button>
          )}
        </li>
        {props.breadcrumb.map(
          (entry: SiteBreadcrumbEntry, index: number): ReactElement => {
            const isCurrent: boolean = index === props.breadcrumb.length - 1;
            return (
              <li key={entry.id} className="flex min-w-0 items-center">
                <Icon
                  className="h-4 w-4 flex-shrink-0 text-gray-300"
                  icon={IconProp.ChevronRight}
                />
                {isCurrent ? (
                  <span
                    aria-current="page"
                    title={`${entry.name} — ${entry.siteType}`}
                    className="ml-0.5 max-w-[16rem] truncate rounded-md bg-gray-100 px-2 py-0.5 text-sm font-semibold text-gray-900"
                  >
                    {entry.name}
                  </span>
                ) : (
                  <button
                    type="button"
                    title={`${entry.name} — ${entry.siteType}`}
                    className={`ml-0.5 ${CRUMB_LINK_CLASS}`}
                    onClick={() => {
                      props.onNavigate(entry.id);
                    }}
                  >
                    {entry.name}
                  </button>
                )}
              </li>
            );
          },
        )}
      </ol>
    </nav>
  );
};

export default SiteBreadcrumbs;

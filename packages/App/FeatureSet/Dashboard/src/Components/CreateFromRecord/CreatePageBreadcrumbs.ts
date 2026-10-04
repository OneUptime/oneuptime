import Link from "Common/Types/Link";
import { useEffect, useMemo, useState } from "react";
import { useOutletContext } from "react-router-dom";

/*
 * A create page's own breadcrumbs, drawn by the layout around it.
 *
 * Declare Incident, Create Alert and Create Scheduled Maintenance Event sit
 * inside their product's layout, whose Page draws the breadcrumbs from the
 * address: Project > Incidents > Declare New Incident. Opened from a
 * record's tab, the trail goes back through that tab instead - which only
 * the page knows, once it has looked the record up. The layout hands the
 * page a way to say so in its <Outlet>, and draws the page's trail while the
 * page has one.
 */
export interface CreatePageOutletContext {
  setCreatePageBreadcrumbLinks: (links: Array<Link> | null) => void;
}

export interface CreatePageBreadcrumbsSlot {
  // The page's trail, while it has one: the layout draws it instead of its own.
  breadcrumbLinks: Array<Link> | null;
  // What the layout passes to its <Outlet context>.
  outletContext: CreatePageOutletContext;
}

// The layout's half.
export const useCreatePageBreadcrumbsSlot: () => CreatePageBreadcrumbsSlot =
  (): CreatePageBreadcrumbsSlot => {
    const [breadcrumbLinks, setBreadcrumbLinks] = useState<Array<Link> | null>(
      null,
    );

    const outletContext: CreatePageOutletContext = useMemo(() => {
      return { setCreatePageBreadcrumbLinks: setBreadcrumbLinks };
    }, []);

    return { breadcrumbLinks: breadcrumbLinks, outletContext: outletContext };
  };

/*
 * The page's half: hands the layout its trail, and takes it back when the
 * page goes. Outside such a layout (a page that draws its own Page, a test)
 * it does nothing.
 */
export const useCreatePageBreadcrumbs: (
  breadcrumbLinks: Array<Link> | null,
) => void = (breadcrumbLinks: Array<Link> | null): void => {
  const outlet: CreatePageOutletContext | null | undefined = useOutletContext<
    CreatePageOutletContext | null | undefined
  >();

  const setCreatePageBreadcrumbLinks:
    | ((links: Array<Link> | null) => void)
    | undefined = outlet?.setCreatePageBreadcrumbLinks;

  useEffect(() => {
    if (!setCreatePageBreadcrumbLinks) {
      return;
    }

    setCreatePageBreadcrumbLinks(breadcrumbLinks);

    return () => {
      setCreatePageBreadcrumbLinks(null);
    };
  }, [setCreatePageBreadcrumbLinks, breadcrumbLinks]);
};

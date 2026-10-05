import Analytics from "../../Utils/Analytics";
import Breadcrumbs from "../Breadcrumbs/Breadcrumbs";
import ErrorMessage from "../ErrorMessage/ErrorMessage";
import PageLoader from "../Loader/PageLoader";
import LabelElement from "../Label/Label";
import Link from "../../../Types/Link";
import LabelModel from "../../../Models/DatabaseModels/Label";
import useTranslateValue from "../../Utils/Translation";
import React, {
  FunctionComponent,
  ReactElement,
  useContext,
  useEffect,
  useState,
} from "react";

/*
 * A page drawn inside a Page can put its own trail where the Page's
 * breadcrumbs are. A layout's Page knows only the address: Project >
 * Incidents > Declare New Incident. The create page inside it knows it was
 * opened from a monitor's Incidents tab, once it has looked the monitor up,
 * and its trail goes back through that tab (Dashboard
 * Components/CreateFromRecord). usePageBreadcrumbLinks hands that trail up
 * to the nearest Page, and takes it back when the page inside goes; null
 * leaves the Page's own breadcrumbs.
 */
export type SetPageBreadcrumbLinks = (links: Array<Link> | null) => void;

export const PageBreadcrumbsContext: React.Context<SetPageBreadcrumbLinks | null> =
  React.createContext<SetPageBreadcrumbLinks | null>(null);

export const usePageBreadcrumbLinks: (links: Array<Link> | null) => void = (
  links: Array<Link> | null,
): void => {
  const setLinks: SetPageBreadcrumbLinks | null = useContext(
    PageBreadcrumbsContext,
  );

  useEffect(() => {
    // Outside a Page there is nowhere to draw it.
    if (!setLinks) {
      return;
    }

    setLinks(links);

    return () => {
      setLinks(null);
    };
  }, [setLinks, links]);
};

export interface ComponentProps {
  title?: string | undefined;
  /*
   * Optional one-line subtitle rendered under the title. Use it to say what the
   * page is for when the title alone is not self-explanatory. Kept optional so
   * existing pages that carry their description in a content card are unchanged.
   */
  description?: string | undefined;
  breadcrumbLinks?: Array<Link> | undefined;
  children: Array<ReactElement> | ReactElement;
  sideMenu?: undefined | ReactElement;
  className?: string | undefined;
  isLoading?: boolean | undefined;
  error?: string | undefined;
  labels?: Array<LabelModel> | undefined;
  headerRight?: ReactElement | undefined;
}

const Page: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const { translateString } = useTranslateValue();
  const translatedTitle: string | undefined = translateString(props.title);
  const translatedDescription: string | undefined = translateString(
    props.description,
  );

  // A trail the page inside handed up (usePageBreadcrumbLinks), while it has one.
  const [innerBreadcrumbLinks, setInnerBreadcrumbLinks] =
    useState<Array<Link> | null>(null);

  const breadcrumbLinks: Array<Link> | undefined =
    innerBreadcrumbLinks || props.breadcrumbLinks;

  useEffect(() => {
    if (breadcrumbLinks && breadcrumbLinks.length > 0) {
      Analytics.capture(
        "Page View: " +
          breadcrumbLinks
            .map((link: Link) => {
              return link.title;
            })
            .join(" > ")
            .toString() || "",
      );
    }
  }, [breadcrumbLinks]);

  /*
   * Give each page a unique, descriptive document title (WCAG 2.4.2 Page
   * Titled). Without this, every page keeps the generic title set once at app
   * startup (e.g. "OneUptime | Dashboard"), which does not describe the page.
   * Prefer the breadcrumb trail (most specific page last) and fall back to the
   * page title.
   */
  useEffect(() => {
    const breadcrumbTitle: string | undefined =
      breadcrumbLinks && breadcrumbLinks.length > 0
        ? breadcrumbLinks
            .map((link: Link) => {
              return translateString(link.title);
            })
            .filter((value: string | undefined): value is string => {
              return Boolean(value);
            })
            .join(" - ")
        : undefined;

    const pageTitle: string | undefined = breadcrumbTitle || translatedTitle;

    if (pageTitle) {
      document.title = `OneUptime | ${pageTitle}`;
    }
  }, [translatedTitle, breadcrumbLinks]);

  if (props.error) {
    return <ErrorMessage message={props.error} />;
  }

  // What the page holds, able to hand its own trail up to this Page.
  const children: ReactElement = (
    <PageBreadcrumbsContext.Provider value={setInnerBreadcrumbLinks}>
      {props.children}
    </PageBreadcrumbsContext.Provider>
  );

  return (
    <div
      className={
        props.className || "mb-auto max-w-full px-4 sm:px-6 lg:px-8 mt-5 h-max"
      }
    >
      {((breadcrumbLinks && breadcrumbLinks.length > 0) || props.title) && (
        <div className="mb-5">
          {breadcrumbLinks && breadcrumbLinks.length > 0 && (
            <div className="mt-2">
              <Breadcrumbs links={breadcrumbLinks} />
            </div>
          )}
          {props.title && (
            <div className="mt-2">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:flex-wrap sm:gap-4">
                <div className="flex flex-col gap-1 min-w-0">
                  <h1 className="text-xl font-semibold leading-7 text-gray-900 sm:text-xl sm:tracking-tight sm:truncate">
                    {translatedTitle}
                  </h1>
                  {translatedDescription && (
                    <p className="max-w-3xl text-sm leading-6 text-gray-500">
                      {translatedDescription}
                    </p>
                  )}
                </div>
                {props.headerRight && (
                  <div className="flex flex-wrap items-center sm:justify-end gap-3">
                    {props.headerRight}
                  </div>
                )}
                {props.labels && props.labels.length > 0 && (
                  <div className="max-sm:hidden sm:flex sm:flex-wrap sm:items-center sm:justify-end sm:gap-3">
                    <span className="text-xs font-semibold uppercase tracking-wide text-gray-500 whitespace-nowrap">
                      {translateString("Labels")}
                    </span>
                    <div className="flex flex-wrap items-center gap-2 justify-end">
                      {props.labels
                        .filter((label: LabelModel | null) => {
                          return Boolean(label && (label.name || label.slug));
                        })
                        .map((label: LabelModel, index: number) => {
                          return (
                            <LabelElement
                              key={
                                label.id?.toString() ||
                                label._id ||
                                label.slug ||
                                `${label.name || "label"}-${index}`
                              }
                              label={label}
                            />
                          );
                        })}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {props.sideMenu && (
        <div className="mx-auto max-w-full pb-10">
          <div className="flex flex-col md:flex-row md:gap-4 lg:gap-5">
            {props.sideMenu}

            {!props.isLoading && (
              <div className="space-y-6 flex-1 min-w-0">{children}</div>
            )}
            {props.isLoading && (
              <div className="flex-1 min-w-0">
                <PageLoader isVisible={true} />
              </div>
            )}
          </div>
        </div>
      )}

      {!props.sideMenu && !props.isLoading && children}
      {!props.sideMenu && props.isLoading && <PageLoader isVisible={true} />}
    </div>
  );
};

export default Page;

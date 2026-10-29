import Analytics from "../../Utils/Analytics";
import Breadcrumbs from "../Breadcrumbs/Breadcrumbs";
import ErrorMessage from "../ErrorMessage/ErrorMessage";
import IsolatedText from "../IsolatedText/IsolatedText";
import PageLoader from "../Loader/PageLoader";
import LabelElement from "../Label/Label";
import Link from "../../../Types/Link";
import LabelModel from "../../../Models/DatabaseModels/Label";
import { sortLabels } from "../../../Utils/LabelOrder";
import { getNumberedRecordName } from "../../../Utils/Project/RecordNumber";
import useTranslateValue from "../../Utils/Translation";
import { getProductName } from "../../Utils/ProductBranding";
import PageTrailEndContext from "./PageTrailEnd";
import { getRecordCrumbName } from "./RecordNameInTrail";
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
  /*
   * The page is one numbered record's - an incident's, an alert's, a
   * scheduled maintenance event's, an episode's - and is headed by its
   * number and its name, "INC-18 Manually declared", in place of the title:
   * two incidents can share a title, never a number
   * (Utils/Project/RecordNumber). The name is drawn as typed.
   */
  recordHeading?: PageRecordHeading | undefined;
}

export interface PageRecordHeading {
  // "INC-18", as the record carries it.
  number: string;
  // The record's name as typed: "Manually declared".
  name: string;
}

// The header's right side (headerRight): its classes, for the tests.
export const PAGE_HEADER_RIGHT_CLASS_NAME: string =
  "flex min-w-0 max-w-full flex-wrap items-center sm:justify-end gap-3";

export const PAGE_HEADER_RIGHT_TEST_ID: string = "page-header-right";

/*
 * A numbered record's heading (recordHeading): the number, then the name.
 * The number is never cut or wrapped, and never parted from the name: a
 * no-break space holds it to the name's first word. It keeps its place at
 * the start of the line - on the right on a right-to-left page.
 *
 * The name gives way. On a phone the two run on as one sentence, two lines
 * at most. From 640px up the heading is one line: the number keeps its
 * whole width and the name is cut short with an ellipsis at its own end,
 * so an English name on a Persian page still reads from its start (a cut
 * across the whole line would take the name's start away there). The
 * whole heading on hover.
 */
export const PAGE_RECORD_HEADING_CLASS_NAME: string =
  "line-clamp-2 break-words [overflow-wrap:anywhere] text-xl font-semibold leading-7 text-gray-900 sm:flex sm:min-w-0 sm:items-baseline sm:line-clamp-none sm:tracking-tight";

export const PAGE_RECORD_NUMBER_CLASS_NAME: string =
  "whitespace-nowrap text-gray-500 sm:shrink-0";

export const PAGE_RECORD_NAME_CLASS_NAME: string = "sm:min-w-0 sm:truncate";

// Between the number and the name: a space no line may break at.
export const PAGE_RECORD_HEADING_SEPARATOR: string = "\u00a0";

export const PAGE_RECORD_HEADING_TEST_IDS: {
  heading: string;
  number: string;
  name: string;
} = {
  heading: "page-record-heading",
  number: "page-record-number",
  name: "page-record-name",
};

const Page: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const { translateString } = useTranslateValue();
  const translatedTitle: string | undefined = translateString(props.title);
  const translatedDescription: string | undefined = translateString(
    props.description,
  );

  // A numbered record's heading, when the page is one's and both are known.
  const recordHeading: PageRecordHeading | null =
    props.recordHeading &&
    props.recordHeading.number.trim() &&
    props.recordHeading.name.trim()
      ? props.recordHeading
      : null;

  const recordHeadingText: string | undefined = recordHeading
    ? getNumberedRecordName(recordHeading)
    : undefined;

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
              /*
               * The record's name where the trail has one (Link.recordName),
               * so a tab says which monitor it is, not "View Monitor" - and
               * a numbered record's number before it (Link.recordNumber),
               * so two incidents of one title are two tabs that read
               * differently. A record's name reads as typed
               * (Link.isRecordName).
               */
              const recordCrumbName: string | undefined =
                getRecordCrumbName(link);

              if (recordCrumbName) {
                return recordCrumbName;
              }

              return link.isRecordName
                ? link.title
                : translateString(link.title);
            })
            .filter((value: string | undefined): value is string => {
              return Boolean(value);
            })
            .join(" - ")
        : undefined;

    const pageTitle: string | undefined =
      breadcrumbTitle || recordHeadingText || translatedTitle;

    if (pageTitle) {
      // The installation's own name when it goes by one (ProductBranding).
      document.title = `${getProductName()} | ${pageTitle}`;
    }
  }, [translatedTitle, recordHeadingText, breadcrumbLinks]);

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
      {((breadcrumbLinks && breadcrumbLinks.length > 0) ||
        props.title ||
        recordHeading) && (
        <div className="mb-5">
          {breadcrumbLinks && breadcrumbLinks.length > 0 && (
            <div className="mt-2">
              <Breadcrumbs links={breadcrumbLinks} />
            </div>
          )}
          {(props.title || recordHeading) && (
            <div className="mt-2">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:flex-wrap sm:gap-4">
                <div className="flex flex-col gap-1 min-w-0">
                  {recordHeading ? (
                    <h1
                      className={PAGE_RECORD_HEADING_CLASS_NAME}
                      title={recordHeadingText}
                      data-testid={PAGE_RECORD_HEADING_TEST_IDS.heading}
                    >
                      <bdi
                        className={PAGE_RECORD_NUMBER_CLASS_NAME}
                        data-testid={PAGE_RECORD_HEADING_TEST_IDS.number}
                      >
                        {recordHeading.number}
                      </bdi>
                      {PAGE_RECORD_HEADING_SEPARATOR}
                      <IsolatedText
                        className={PAGE_RECORD_NAME_CLASS_NAME}
                        text={recordHeading.name}
                        dataTestId={PAGE_RECORD_HEADING_TEST_IDS.name}
                      />
                    </h1>
                  ) : (
                    <h1 className="text-xl font-semibold leading-7 text-gray-900 sm:text-xl sm:tracking-tight sm:truncate">
                      {translatedTitle}
                    </h1>
                  )}
                  {translatedDescription && (
                    <p className="max-w-3xl text-sm leading-6 text-gray-500">
                      {translatedDescription}
                    </p>
                  )}
                </div>
                {/*
                 * Never wider than the header: what sits here shrinks to
                 * the line it is put on, so a wide tab bar (the telemetry
                 * products', which scrolls sideways) stays inside the page
                 * from a phone up. Without min-w-0 it kept the width of all
                 * its tabs, and from 640px to about 700px German pushed the
                 * page sideways.
                 */}
                {props.headerRight && (
                  <div
                    className={PAGE_HEADER_RIGHT_CLASS_NAME}
                    data-testid={PAGE_HEADER_RIGHT_TEST_ID}
                  >
                    {props.headerRight}
                  </div>
                )}
                {props.labels && props.labels.length > 0 && (
                  <div className="max-sm:hidden sm:flex sm:flex-wrap sm:items-center sm:justify-end sm:gap-3">
                    <span className="text-xs font-semibold uppercase tracking-wide text-gray-500 whitespace-nowrap">
                      {translateString("Labels")}
                    </span>
                    <div className="flex flex-wrap items-center gap-2 justify-end">
                      {/*
                       * In natural order, as a record's labels are listed
                       * everywhere (Utils/LabelOrder).
                       */}
                      {sortLabels<LabelModel>(props.labels)
                        .filter((label: LabelModel) => {
                          return Boolean(label.name || label.slug);
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
            <PageTrailEndContext.Provider
              value={
                breadcrumbLinks && breadcrumbLinks.length > 0
                  ? breadcrumbLinks[breadcrumbLinks.length - 1] || null
                  : null
              }
            >
              {props.sideMenu}
            </PageTrailEndContext.Provider>

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

import React, { ReactElement, ReactNode, useMemo } from "react";
import RumProductAnalyticsSavedView from "Common/Models/DatabaseModels/RumProductAnalyticsSavedView";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import IconProp from "Common/Types/Icon/IconProp";
import JSONFunctions from "Common/Types/JSONFunctions";
import ObjectID from "Common/Types/ObjectID";
import { ProductAnalyticsSavedViewType } from "Common/Types/Rum/ProductAnalyticsSavedViews";
import DashboardWidgetIds from "Common/Utils/Dashboard/DashboardWidgetIds";
import RangeStartAndEndDateTime, {
  RangeStartAndEndDateTimeUtil,
} from "Common/Types/Time/RangeStartAndEndDateTime";
import ComponentLoader from "Common/UI/Components/ComponentLoader/ComponentLoader";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import Icon from "Common/UI/Components/Icon/Icon";
import { Translator, translationKey } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import {
  ProductAnalyticsSavedView,
  SAVED_VIEW_UNREADABLE_NOTICE,
  getProductAnalyticsSavedView,
  getProductAnalyticsSavedViewRoute,
  toProductAnalyticsSavedView,
} from "../../ProductAnalytics/ProductAnalyticsSavedViews";
import useProductAnalyticsRead, {
  ProductAnalyticsRead,
} from "../../ProductAnalytics/useProductAnalyticsRead";
import AppLink from "../../AppLink/AppLink";
import DashboardResourceList from "../Utils/DashboardResourceList";
import { DashboardBaseComponentProps } from "./DashboardBaseComponent";
import WidgetPlaceholder from "./WidgetPlaceholder";
import DashboardWidgetLine from "./DashboardWidgetLine";
import { useIsDashboardWidgetPreview } from "./DashboardWidgetPreview";
import {
  DASHBOARD_WIDGET_SETUP_LINE_TEST_ID,
  DashboardWidgetSetupNeed,
  getDashboardWidgetPlace,
  getDashboardWidgetSetupLine,
} from "./DashboardWidgetSetupCopy";

/*
 * What the Funnel and Retention widgets share (issue #6630): each shows a
 * funnel or a retention table saved on a RUM application's page, read with
 * the dashboard's time range through the pages' own read routes - its
 * title (the saved one's name unless the widget names it), "Open in
 * Funnels" or "Open in User Retention" to dig in on the page, and in its
 * box what it read, or why there is nothing: none picked yet, deleted or
 * not this reader's to see, or a public dashboard, which reads no product
 * analytics. The saved one is read again on each refresh, so a rename or
 * an Update shows.
 */

export interface ProductAnalyticsWidgetWords {
  // The kind's icon, in a placeholder.
  icon: IconProp;
  notOnPublic: string;
  /*
   * What it needs before it draws anything: its line, for where it is
   * drawn, is DashboardWidgetSetupCopy's.
   */
  setupNeed: DashboardWidgetSetupNeed;
  missing: string;
  open: string;
}

export const PRODUCT_ANALYTICS_WIDGET_WORDS: Readonly<
  Record<ProductAnalyticsSavedViewType, ProductAnalyticsWidgetWords>
> = {
  [ProductAnalyticsSavedViewType.Funnel]: {
    // The side menu's: Funnels and User Retention.
    icon: IconProp.Funnel,
    notOnPublic: translationKey(
      "Funnels are not available on public dashboards.",
    ),
    setupNeed: DashboardWidgetSetupNeed.SavedFunnel,
    missing: translationKey(
      "The saved funnel this widget shows was deleted, or you cannot see it.",
    ),
    open: translationKey("Open in Funnels"),
  },
  [ProductAnalyticsSavedViewType.Retention]: {
    icon: IconProp.TableCells,
    notOnPublic: translationKey(
      "Retention tables are not available on public dashboards.",
    ),
    setupNeed: DashboardWidgetSetupNeed.SavedRetentionTable,
    missing: translationKey(
      "The saved retention table this widget shows was deleted, or you cannot see it.",
    ),
    open: translationKey("Open in User Retention"),
  },
};

export enum ProductAnalyticsWidgetState {
  // No saved one picked yet.
  Setup = "Setup",
  NotOnPublic = "NotOnPublic",
  Loading = "Loading",
  // Deleted, of the other kind, or not this reader's to see.
  Missing = "Missing",
  // Its definition is not one this version reads.
  Unreadable = "Unreadable",
  Error = "Error",
  Ready = "Ready",
}

export interface ProductAnalyticsWidgetSavedView<
  T extends ProductAnalyticsSavedViewType,
> {
  state: ProductAnalyticsWidgetState;
  view: ProductAnalyticsSavedView<T> | null;
  error: string;
}

/*
 * A widget's saved id as one to read: an id, or none. Read as every board
 * reads a widget's ids (DashboardWidgetIds): text, an ObjectID, or the
 * ObjectID JSON the API, Terraform or a script may store.
 */
export function readProductAnalyticsWidgetSavedViewId(
  value: unknown,
): string | null {
  const id: string | null = DashboardWidgetIds.readId(value);

  return id !== null && ObjectID.isValidUUID(id) ? id : null;
}

/* What a widget makes of what it read of its saved one. */
export function getProductAnalyticsWidgetSavedView<
  T extends ProductAnalyticsSavedViewType,
>(data: {
  savedViewId: string | null;
  viewType: T;
  isPublic: boolean;
  read: ProductAnalyticsRead<RumProductAnalyticsSavedView | null>;
}): ProductAnalyticsWidgetSavedView<T> {
  if (data.isPublic) {
    return {
      state: ProductAnalyticsWidgetState.NotOnPublic,
      view: null,
      error: "",
    };
  }

  if (!data.savedViewId) {
    return { state: ProductAnalyticsWidgetState.Setup, view: null, error: "" };
  }

  if (data.read.error) {
    return {
      state: ProductAnalyticsWidgetState.Error,
      view: null,
      error: data.read.error,
    };
  }

  /*
   * The answer for this id: a row of it stays on screen while a refresh
   * reads it again, so the widget does not blink on each refresh. A row
   * whose id is another's is the last widget setting's, still held while
   * the next is read; no row is an answer once the read is done.
   */
  const row: RumProductAnalyticsSavedView | null = data.read.data;
  const isAnswered: boolean = row
    ? row._id?.toString() === data.savedViewId
    : !data.read.isLoading;

  if (!isAnswered) {
    return {
      state: ProductAnalyticsWidgetState.Loading,
      view: null,
      error: "",
    };
  }

  const view: ProductAnalyticsSavedView<T> | null = row
    ? toProductAnalyticsSavedView<T>(row, data.viewType)
    : null;

  if (!view) {
    return {
      state: ProductAnalyticsWidgetState.Missing,
      view: null,
      error: "",
    };
  }

  if (!view.definition) {
    return {
      state: ProductAnalyticsWidgetState.Unreadable,
      view: view,
      error: "",
    };
  }

  return { state: ProductAnalyticsWidgetState.Ready, view: view, error: "" };
}

/* Reads a widget's saved one, again on each refresh; nothing on a public dashboard. */
export function useProductAnalyticsWidgetSavedView<
  T extends ProductAnalyticsSavedViewType,
>(data: {
  savedViewId: unknown;
  viewType: T;
  refreshTick: number | undefined;
}): ProductAnalyticsWidgetSavedView<T> {
  const isPublic: boolean = DashboardResourceList.isPublic();
  const savedViewId: string | null = readProductAnalyticsWidgetSavedViewId(
    data.savedViewId,
  );

  const read: ProductAnalyticsRead<RumProductAnalyticsSavedView | null> =
    useProductAnalyticsRead<RumProductAnalyticsSavedView | null>(
      `${isPublic ? "public" : savedViewId || ""}|${data.refreshTick || 0}`,
      (): Promise<RumProductAnalyticsSavedView | null> => {
        return isPublic || !savedViewId
          ? Promise.resolve(null)
          : getProductAnalyticsSavedView(savedViewId);
      },
    );

  return getProductAnalyticsWidgetSavedView<T>({
    savedViewId: savedViewId,
    viewType: data.viewType,
    isPublic: isPublic,
    read: read,
  });
}

/* The dashboard's range as a widget reads it: fixed until the range changes or a refresh. */
export function useProductAnalyticsWidgetPeriod(
  props: Pick<
    DashboardBaseComponentProps,
    "dashboardStartAndEndDate" | "refreshTick"
  >,
): InBetween<Date> {
  return useMemo((): InBetween<Date> => {
    return RangeStartAndEndDateTimeUtil.getStartAndEndDate(
      props.dashboardStartAndEndDate,
    );
  }, [props.dashboardStartAndEndDate, props.refreshTick]);
}

/*
 * Whether a widget links to its page: once its saved one is read, and not
 * while the board is edited (a navigation would drop the edit) nor in the
 * widget settings' live preview, which is drawn over a board being edited
 * (issue #6859), nor on a playlist's screen, which nobody drives. A public
 * dashboard reads no saved one, so never there either.
 */
export function isProductAnalyticsWidgetLinked(data: {
  state: ProductAnalyticsWidgetState;
  hasView: boolean;
  isEditMode: boolean;
  isPreview: boolean;
  isPlayback: boolean;
}): boolean {
  return (
    data.hasView &&
    data.state === ProductAnalyticsWidgetState.Ready &&
    !data.isEditMode &&
    !data.isPreview &&
    !data.isPlayback
  );
}

export interface ProductAnalyticsWidgetPageLinkProps<
  T extends ProductAnalyticsSavedViewType,
> {
  view: ProductAnalyticsSavedView<T>;
  viewType: T;
  dashboardStartAndEndDate: RangeStartAndEndDateTime;
  // Under the pointer: where it goes ("Open in User Retention").
  title: string;
  className: string;
  dataTestId: string;
  children: ReactElement | Array<ReactElement> | string;
}

/*
 * A link to the saved one on its page, in the dashboard's range: the
 * title's icon, and a retention table's "2 more weeks" under it. A link,
 * so it opens in a new tab too; not also a click on the widget under it.
 */
export function ProductAnalyticsWidgetPageLink<
  T extends ProductAnalyticsSavedViewType,
>(props: ProductAnalyticsWidgetPageLinkProps<T>): ReactElement {
  return (
    <span
      className="flex flex-none"
      onClick={(event: React.MouseEvent<HTMLSpanElement>): void => {
        event.stopPropagation();
      }}
    >
      <AppLink
        to={getProductAnalyticsSavedViewRoute({
          rumApplicationId: props.view.rumApplicationId,
          viewType: props.viewType,
          savedViewId: props.view.id,
          timeRange: props.dashboardStartAndEndDate,
        })}
        title={props.title}
        dataTestId={props.dataTestId}
        className={props.className}
      >
        {props.children}
      </AppLink>
    </span>
  );
}

export interface ProductAnalyticsWidgetFrameProps<
  T extends ProductAnalyticsSavedViewType,
> {
  viewType: T;
  saved: ProductAnalyticsWidgetSavedView<T>;
  // The widget's own title; the saved one's name when it has none.
  title: string | undefined;
  dashboardStartAndEndDate: RangeStartAndEndDateTime;
  isEditMode: boolean;
  isPlayback: boolean;
  dataTestId: string;
  // What the widget draws once its saved one is read.
  children: ReactNode;
}

/*
 * The widget's box: its title over what it shows, with the link to the
 * page - left out on a public dashboard (no session to open it in), while
 * the board is edited (a navigation would drop the edit), in the widget
 * settings' live preview, which is drawn over a board being edited, and on
 * a playlist's screen, which nobody drives.
 */
export function ProductAnalyticsWidgetFrame<
  T extends ProductAnalyticsSavedViewType,
>(props: ProductAnalyticsWidgetFrameProps<T>): ReactElement {
  const translator: Translator = useTranslator();
  const words: ProductAnalyticsWidgetWords =
    PRODUCT_ANALYTICS_WIDGET_WORDS[props.viewType];
  const view: ProductAnalyticsSavedView<T> | null = props.saved.view;
  const title: string = props.title?.trim() || view?.name || "";
  const isPreview: boolean = useIsDashboardWidgetPreview();
  const isLinked: boolean = isProductAnalyticsWidgetLinked({
    state: props.saved.state,
    hasView: Boolean(view),
    isEditMode: props.isEditMode,
    isPreview: isPreview,
    isPlayback: props.isPlayback,
  });

  let body: ReactNode;

  switch (props.saved.state) {
    case ProductAnalyticsWidgetState.NotOnPublic:
      body = (
        <WidgetPlaceholder icon={words.icon} message={words.notOnPublic} />
      );
      break;
    case ProductAnalyticsWidgetState.Setup:
      /*
       * "Pick a saved funnel in this widget's settings." where they can be
       * opened - the board being edited, the Live Preview above them - and
       * only what is missing on a reader's board (issue #7160).
       */
      body = (
        <WidgetPlaceholder
          icon={words.icon}
          message={getDashboardWidgetSetupLine(
            words.setupNeed,
            getDashboardWidgetPlace({
              isEditMode: props.isEditMode,
              isPreview: isPreview,
            }),
          )}
          messageTestId={DASHBOARD_WIDGET_SETUP_LINE_TEST_ID}
        />
      );
      break;
    case ProductAnalyticsWidgetState.Missing:
      body = <WidgetPlaceholder icon={words.icon} message={words.missing} />;
      break;
    case ProductAnalyticsWidgetState.Unreadable:
      body = (
        <WidgetPlaceholder
          icon={words.icon}
          message={translator.translateTemplate(SAVED_VIEW_UNREADABLE_NOTICE, {
            name: view?.name || "",
          })}
        />
      );
      break;
    case ProductAnalyticsWidgetState.Error:
      body = <ErrorMessage message={props.saved.error} />;
      break;
    case ProductAnalyticsWidgetState.Loading:
      body = (
        <div className="flex h-full items-center justify-center">
          <ComponentLoader />
        </div>
      );
      break;
    default:
      body = props.children;
  }

  return (
    <div className="flex h-full w-full flex-col" data-testid={props.dataTestId}>
      {title || isLinked ? (
        <div className="mb-1 flex min-w-0 items-center justify-between gap-2 px-1">
          <DashboardWidgetLine
            text={title}
            className="min-w-0 truncate text-sm font-medium text-gray-700"
            title={title}
            dataTestId={`${props.dataTestId}-title`}
          />
          {isLinked && view ? (
            /*
             * As the Chart widget's Open in Metric Explorer: an icon at the
             * title's end, its words on hover and to assistive tech, so the
             * title keeps the widget's width - the words beside it cut
             * "Weekly return visits" to "Weekly retur..." on a phone, and
             * German's longer ones cut more.
             */
            <ProductAnalyticsWidgetPageLink
              view={view}
              viewType={props.viewType}
              dashboardStartAndEndDate={props.dashboardStartAndEndDate}
              title={translator.translateText(words.open) || words.open}
              dataTestId={`${props.dataTestId}-open`}
              className="inline-flex h-5 w-5 items-center justify-center rounded-full text-gray-500 transition-all duration-150 hover:bg-gray-100 hover:text-gray-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
            >
              <Icon icon={IconProp.ExternalLink} className="h-3.5 w-3.5" />
              <span className="sr-only">
                {translator.translateText(words.open)}
              </span>
            </ProductAnalyticsWidgetPageLink>
          ) : (
            <></>
          )}
        </div>
      ) : (
        <></>
      )}
      <div className="min-h-0 flex-1 overflow-auto">{body}</div>
    </div>
  );
}

/*
 * Draws again only for what it shows: its settings, the range, a refresh,
 * its size and whether the board is edited - not every move of the board.
 */
export function areProductAnalyticsWidgetPropsEqual(
  prev: DashboardBaseComponentProps & { component: { arguments: unknown } },
  next: DashboardBaseComponentProps & { component: { arguments: unknown } },
): boolean {
  return (
    prev.componentId.toString() === next.componentId.toString() &&
    prev.refreshTick === next.refreshTick &&
    prev.isEditMode === next.isEditMode &&
    prev.isSelected === next.isSelected &&
    prev.isPlayback === next.isPlayback &&
    prev.dashboardComponentWidthInPx === next.dashboardComponentWidthInPx &&
    prev.dashboardComponentHeightInPx === next.dashboardComponentHeightInPx &&
    JSONFunctions.deepEqual(
      prev.dashboardStartAndEndDate,
      next.dashboardStartAndEndDate,
    ) &&
    JSONFunctions.deepEqual(
      prev.component.arguments as never,
      next.component.arguments as never,
    )
  );
}

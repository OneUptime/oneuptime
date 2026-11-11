import RumApplication from "Common/Models/DatabaseModels/RumApplication";
import RumProductAnalyticsSavedView from "Common/Models/DatabaseModels/RumProductAnalyticsSavedView";
import Route from "Common/Types/API/Route";
import Includes from "Common/Types/BaseDatabase/Includes";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import RangeStartAndEndDateTime from "Common/Types/Time/RangeStartAndEndDateTime";
import {
  PRODUCT_ANALYTICS_SAVED_VIEWS_PER_APPLICATION_MAX,
  PRODUCT_ANALYTICS_SAVED_VIEW_URL_KEY,
  ProductAnalyticsDefinitionRead,
  ProductAnalyticsFunnelDefinition,
  ProductAnalyticsRetentionDefinition,
  ProductAnalyticsSavedViewDefinitions,
  ProductAnalyticsSavedViewType,
  readProductAnalyticsFunnelDefinition,
  readProductAnalyticsRetentionDefinition,
  readProductAnalyticsSavedViewDefinition,
} from "Common/Types/Rum/ProductAnalyticsSavedViews";
import {
  ProductAnalyticsEventRef,
  ProductAnalyticsSegmentFilter,
} from "Common/Types/Rum/ProductAnalyticsEventReads";
import { DropdownOption } from "Common/UI/Components/Dropdown/Dropdown";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import ProjectUtil from "Common/UI/Utils/Project";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import {
  PRODUCT_ANALYTICS_EVENTS_URL_KEYS,
  ProductAnalyticsEventsUrlState,
} from "./ProductAnalyticsEventsFormat";
import { buildProductAnalyticsSearch } from "./ProductAnalyticsUrlState";

/*
 * Saved funnels and retention tables (issue #6630), as the Funnels and
 * User Retention pages and the dashboard widgets use them: the words each
 * kind is named with, the page's address (`?view=<id>` beside the
 * definition's own keys), the definition read off a page's state and put
 * back on it, and the reads and writes of RumProductAnalyticsSavedView.
 * Kept apart from React, so each rule is tested on its own.
 */

/* The words a kind's list, dialogs and notes are named with, each a translation key. */
export interface ProductAnalyticsSavedViewWords {
  // The dropdown's trigger and its panel: "Saved funnels".
  list: string;
  empty: string;
  create: string;
  search: string;
  // The save dialog's title and button: "Save funnel".
  save: string;
  saveDescription: string;
  rename: string;
  delete: string;
  notLoaded: string;
  // A link named one this person cannot open.
  missing: string;
  // Nothing on screen to save yet.
  nothingToSave: string;
  // The name field's example.
  namePlaceholder: string;
}

export const PRODUCT_ANALYTICS_SAVED_VIEW_WORDS: Readonly<
  Record<ProductAnalyticsSavedViewType, ProductAnalyticsSavedViewWords>
> = {
  [ProductAnalyticsSavedViewType.Funnel]: {
    list: translationKey("Saved funnels"),
    empty: translationKey("No saved funnels yet."),
    create: translationKey("+ Save funnel"),
    search: translationKey("Search saved funnels"),
    save: translationKey("Save funnel"),
    saveDescription: translationKey(
      "Keeps this funnel's steps, its time to finish and its segment under a name, to open again here or show on a dashboard. The time range is not kept: this page keeps its own, and a dashboard widget reads the dashboard's.",
    ),
    rename: translationKey("Rename saved funnel"),
    delete: translationKey("Delete saved funnel"),
    notLoaded: translationKey("Could not load the saved funnels."),
    missing: translationKey(
      "The saved funnel this link opens was deleted, or you cannot see it.",
    ),
    nothingToSave: translationKey("Nothing to save until the funnel is shown."),
    namePlaceholder: translationKey("Sign-up to first purchase"),
  },
  [ProductAnalyticsSavedViewType.Retention]: {
    list: translationKey("Saved retention tables"),
    empty: translationKey("No saved retention tables yet."),
    create: translationKey("+ Save retention table"),
    search: translationKey("Search saved retention tables"),
    save: translationKey("Save retention table"),
    saveDescription: translationKey(
      "Keeps this table's start and return events, its period and its segment under a name, to open again here or show on a dashboard. The time range is not kept: this page keeps its own, and a dashboard widget reads the dashboard's.",
    ),
    rename: translationKey("Rename saved retention table"),
    delete: translationKey("Delete saved retention table"),
    notLoaded: translationKey("Could not load the saved retention tables."),
    missing: translationKey(
      "The saved retention table this link opens was deleted, or you cannot see it.",
    ),
    nothingToSave: translationKey(
      "Nothing to save until the retention table is shown.",
    ),
    namePlaceholder: translationKey("Weekly return after sign-up"),
  },
};

// Said under a delete's question: the dashboards that show it.
export const SAVED_VIEW_DELETE_WIDGETS_NOTE: string = translationKey(
  "Dashboard widgets that show it will say it was deleted.",
);

// The open saved view, once what is on screen is no longer what it keeps.
export const SAVED_VIEW_CHANGED_TEMPLATE: string =
  translationKey("{{name}} (changed)");

export const SAVED_VIEW_NAME_DESCRIPTION: string = translationKey(
  "What your team calls it, on this page and on dashboards.",
);

// Under the name of one whose definition this version cannot read.
export const SAVED_VIEW_UNREADABLE: string = translationKey("Cannot be opened");

// Said over the page when one of those is picked.
export const SAVED_VIEW_UNREADABLE_NOTICE: string = translationKey(
  "{{name}} cannot be opened: reload the page, or delete it and save it again.",
);

/* ---- The address. ---- */

/*
 * The saved view a page's address names, or null: an id, as a link is
 * untrusted - anything else is no saved view.
 */
export function readProductAnalyticsSavedViewId(
  search: string,
): string | null {
  const value: string | null = new URLSearchParams(search).get(
    PRODUCT_ANALYTICS_SAVED_VIEW_URL_KEY,
  );

  return value && ObjectID.isValidUUID(value) ? value : null;
}

/* The address with the saved view written in, or taken out. */
export function writeProductAnalyticsSavedViewId(
  href: string,
  savedViewId: string | null,
): string {
  const url: URL = new URL(href);

  if (savedViewId) {
    url.searchParams.set(PRODUCT_ANALYTICS_SAVED_VIEW_URL_KEY, savedViewId);
  } else {
    url.searchParams.delete(PRODUCT_ANALYTICS_SAVED_VIEW_URL_KEY);
  }

  return url.toString();
}

/* The address keys a kind's definition is written with. */
export const PRODUCT_ANALYTICS_DEFINITION_URL_KEYS: Readonly<
  Record<ProductAnalyticsSavedViewType, ReadonlyArray<string>>
> = {
  [ProductAnalyticsSavedViewType.Funnel]: [
    PRODUCT_ANALYTICS_EVENTS_URL_KEYS.step,
    PRODUCT_ANALYTICS_EVENTS_URL_KEYS.window,
    PRODUCT_ANALYTICS_EVENTS_URL_KEYS.segment,
  ],
  [ProductAnalyticsSavedViewType.Retention]: [
    PRODUCT_ANALYTICS_EVENTS_URL_KEYS.start,
    PRODUCT_ANALYTICS_EVENTS_URL_KEYS.return,
    PRODUCT_ANALYTICS_EVENTS_URL_KEYS.period,
    PRODUCT_ANALYTICS_EVENTS_URL_KEYS.segment,
  ],
};

/*
 * Whether an address says what to read itself. A link someone shared says
 * what they saw, and it wins over the saved view it names, which is then
 * shown as changed when the two differ; a link that names only the saved
 * view (a dashboard widget's) opens what it keeps.
 */
export function hasProductAnalyticsDefinitionInAddress(
  search: string,
  viewType: ProductAnalyticsSavedViewType,
): boolean {
  const params: URLSearchParams = new URLSearchParams(search);

  return PRODUCT_ANALYTICS_DEFINITION_URL_KEYS[viewType].some(
    (key: string): boolean => {
      return params.has(key);
    },
  );
}

/* What a page's address says of saved views as the page opens. */
export interface ProductAnalyticsSavedViewAddress {
  savedViewId: string | null;
  isDefinitionInAddress: boolean;
  /*
   * A saved view to open before the page reads anything: one is named, and
   * the address says nothing else to read.
   */
  isOpening: boolean;
}

export function readProductAnalyticsSavedViewAddress(
  search: string,
  viewType: ProductAnalyticsSavedViewType,
): ProductAnalyticsSavedViewAddress {
  const savedViewId: string | null = readProductAnalyticsSavedViewId(search);
  const isDefinitionInAddress: boolean = hasProductAnalyticsDefinitionInAddress(
    search,
    viewType,
  );

  return {
    savedViewId: savedViewId,
    isDefinitionInAddress: isDefinitionInAddress,
    isOpening: savedViewId !== null && !isDefinitionInAddress,
  };
}

/*
 * The page a saved view opens on: its application's Funnels or User
 * Retention page, naming it, in the time range given (a widget's link
 * keeps its dashboard's).
 */
export function getProductAnalyticsSavedViewRoute(data: {
  rumApplicationId: ObjectID | string;
  viewType: ProductAnalyticsSavedViewType;
  savedViewId: string;
  timeRange?: RangeStartAndEndDateTime | undefined;
}): Route {
  const route: Route = RouteUtil.populateRouteParams(
    RouteMap[
      data.viewType === ProductAnalyticsSavedViewType.Funnel
        ? PageMap.RUM_APPLICATION_VIEW_PRODUCT_ANALYTICS_FUNNELS
        : PageMap.RUM_APPLICATION_VIEW_PRODUCT_ANALYTICS_RETENTION
    ] as Route,
    { modelId: new ObjectID(data.rumApplicationId.toString()) },
  );
  const params: URLSearchParams = new URLSearchParams(
    data.timeRange
      ? buildProductAnalyticsSearch({ timeRange: data.timeRange })
      : "",
  );

  params.set(PRODUCT_ANALYTICS_SAVED_VIEW_URL_KEY, data.savedViewId);

  return new Route(`${route.toString()}?${params.toString()}`);
}

/* ---- A page's state and a definition. ---- */

/*
 * What a funnel page shows, as a definition: null until its steps are
 * known - the page picks them once it has read the application's events.
 */
export function toProductAnalyticsFunnelDefinition(data: {
  steps: Array<ProductAnalyticsEventRef> | null;
  windowMs: number;
  filters: Array<ProductAnalyticsSegmentFilter>;
}): ProductAnalyticsFunnelDefinition | null {
  if (!data.steps) {
    return null;
  }

  return readProductAnalyticsFunnelDefinition({
    steps: data.steps,
    windowMs: data.windowMs,
    filters: data.filters,
  }).definition;
}

/*
 * What a retention page shows, as a definition: the period picked, not
 * the longer one a long range is read by - the saved table keeps what was
 * asked for, and each read fits it to its own range.
 */
export function toProductAnalyticsRetentionDefinition(
  state: Pick<
    ProductAnalyticsEventsUrlState,
    "startEvent" | "returnEvent" | "period" | "filters"
  >,
): ProductAnalyticsRetentionDefinition | null {
  return readProductAnalyticsRetentionDefinition({
    startEvent: state.startEvent,
    returnEvent: state.returnEvent,
    period: state.period,
    filters: state.filters,
  }).definition;
}

/* A page's state showing a saved funnel: its steps, its window, its segment. */
export function applyProductAnalyticsFunnelDefinition(
  state: ProductAnalyticsEventsUrlState,
  definition: ProductAnalyticsFunnelDefinition,
): ProductAnalyticsEventsUrlState {
  return {
    ...state,
    steps: definition.steps,
    windowMs: definition.windowMs,
    filters: definition.filters,
  };
}

/* A page's state showing a saved retention table. */
export function applyProductAnalyticsRetentionDefinition(
  state: ProductAnalyticsEventsUrlState,
  definition: ProductAnalyticsRetentionDefinition,
): ProductAnalyticsEventsUrlState {
  return {
    ...state,
    startEvent: definition.startEvent,
    returnEvent: definition.returnEvent,
    period: definition.period,
    filters: definition.filters,
  };
}

/* ---- Reads and writes. ---- */

/*
 * A saved view as a page and a widget hold it. Its definition is read as
 * untrusted (the API, Terraform and scripts write these rows too): null
 * when it is not one of its kind any more.
 */
export interface ProductAnalyticsSavedView<T extends ProductAnalyticsSavedViewType> {
  id: string;
  name: string;
  rumApplicationId: string;
  viewType: T;
  definition: ProductAnalyticsSavedViewDefinitions[T] | null;
  // Why the definition cannot be read; null when it can.
  problem: string | null;
}

/* A row as a kind's saved view, or null when the row is of another kind. */
export function toProductAnalyticsSavedView<
  T extends ProductAnalyticsSavedViewType,
>(
  row: RumProductAnalyticsSavedView,
  viewType: T,
): ProductAnalyticsSavedView<T> | null {
  if (row.viewType !== viewType) {
    return null;
  }

  const read: ProductAnalyticsDefinitionRead<
    ProductAnalyticsSavedViewDefinitions[T]
  > = readProductAnalyticsSavedViewDefinition(viewType, row.definition);

  return {
    id: row._id?.toString() || "",
    name: row.name || "",
    rumApplicationId: row.rumApplicationId?.toString() || "",
    viewType: viewType,
    definition: read.definition,
    problem: read.problem,
  };
}

/* An application's saved views of a kind, by name: the whole list, which is short. */
export async function listProductAnalyticsSavedViews<
  T extends ProductAnalyticsSavedViewType,
>(data: {
  rumApplicationId: ObjectID;
  viewType: T;
}): Promise<Array<ProductAnalyticsSavedView<T>>> {
  const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();

  const result: ListResult<RumProductAnalyticsSavedView> =
    await ModelAPI.getList<RumProductAnalyticsSavedView>({
      modelType: RumProductAnalyticsSavedView,
      query: {
        ...(projectId ? { projectId: projectId } : {}),
        rumApplicationId: data.rumApplicationId,
        viewType: data.viewType,
      },
      limit: PRODUCT_ANALYTICS_SAVED_VIEWS_PER_APPLICATION_MAX,
      skip: 0,
      select: {
        _id: true,
        name: true,
        rumApplicationId: true,
        viewType: true,
        definition: true,
      },
      sort: { name: SortOrder.Ascending },
    });

  return result.data
    .map(
      (
        row: RumProductAnalyticsSavedView,
      ): ProductAnalyticsSavedView<T> | null => {
        return toProductAnalyticsSavedView(row, data.viewType);
      },
    )
    .filter(
      (
        view: ProductAnalyticsSavedView<T> | null,
      ): view is ProductAnalyticsSavedView<T> => {
        return view !== null;
      },
    );
}

/* One saved view by its id: null when it was deleted, or this person cannot see it. */
export async function getProductAnalyticsSavedView(
  savedViewId: string,
): Promise<RumProductAnalyticsSavedView | null> {
  return await ModelAPI.getItem<RumProductAnalyticsSavedView>({
    modelType: RumProductAnalyticsSavedView,
    id: new ObjectID(savedViewId),
    select: {
      _id: true,
      name: true,
      rumApplicationId: true,
      viewType: true,
      definition: true,
    },
  });
}

/* A saved view keeps what is on screen now ("Update"). */
export async function updateProductAnalyticsSavedViewDefinition(data: {
  savedViewId: string;
  definition:
    | ProductAnalyticsFunnelDefinition
    | ProductAnalyticsRetentionDefinition;
}): Promise<void> {
  await ModelAPI.updateById<RumProductAnalyticsSavedView>({
    modelType: RumProductAnalyticsSavedView,
    id: new ObjectID(data.savedViewId),
    data: { definition: data.definition as unknown as JSONObject },
  });
}

export async function deleteProductAnalyticsSavedView(
  savedViewId: string,
): Promise<void> {
  await ModelAPI.deleteItem<RumProductAnalyticsSavedView>({
    modelType: RumProductAnalyticsSavedView,
    id: new ObjectID(savedViewId),
  });
}

/* ---- A dashboard widget's settings. ---- */

/*
 * The saved funnels or retention tables a widget's settings offer, each
 * with its application's name under it: two applications can each keep a
 * "Sign-up" funnel. `items` and `options` are in the same order.
 */
export function nameProductAnalyticsSavedViewApplications(data: {
  items: ReadonlyArray<RumProductAnalyticsSavedView>;
  options: Array<DropdownOption>;
  applicationNames: ReadonlyMap<string, string>;
}): void {
  data.items.forEach(
    (item: RumProductAnalyticsSavedView, index: number): void => {
      const option: DropdownOption | undefined = data.options[index];
      const applicationName: string | undefined =
        data.applicationNames.get(item.rumApplicationId?.toString() || "");

      if (option && applicationName) {
        option.description = applicationName;
      }
    },
  );
}

/*
 * Reads the applications' names and puts them under the options. Read
 * apart from the saved views: a role that reads saved funnels need not
 * read applications, and its options then keep their names alone.
 */
export async function describeProductAnalyticsSavedViewOptions(data: {
  items: ReadonlyArray<RumProductAnalyticsSavedView>;
  options: Array<DropdownOption>;
  projectId: ObjectID;
}): Promise<void> {
  const applicationIds: Array<string> = Array.from(
    new Set<string>(
      data.items
        .map((item: RumProductAnalyticsSavedView): string => {
          return item.rumApplicationId?.toString() || "";
        })
        .filter((id: string): boolean => {
          return ObjectID.isValidUUID(id);
        }),
    ),
  );

  if (applicationIds.length === 0) {
    return;
  }

  let applications: ListResult<RumApplication>;

  try {
    applications = await ModelAPI.getList<RumApplication>({
      modelType: RumApplication,
      query: {
        projectId: data.projectId,
        _id: new Includes(
          applicationIds.map((id: string): ObjectID => {
            return new ObjectID(id);
          }),
        ),
      },
      limit: applicationIds.length,
      skip: 0,
      select: { _id: true, name: true },
      sort: { name: SortOrder.Ascending },
    });
  } catch {
    return;
  }

  const applicationNames: Map<string, string> = new Map<string, string>();

  for (const application of applications.data) {
    const id: string = application._id?.toString() || "";

    if (id && application.name) {
      applicationNames.set(id, application.name);
    }
  }

  nameProductAnalyticsSavedViewApplications({
    items: data.items,
    options: data.options,
    applicationNames: applicationNames,
  });
}

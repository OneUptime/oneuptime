/*
 * Saved funnels and retention tables (issue #6630): a RUM application's
 * Funnels and User Retention pages keep what they read - a funnel's steps,
 * the time to finish it and its segment; a retention table's start and
 * return events, its period and its segment - under a name, for the team
 * to open again, and for a dashboard widget to read with the dashboard's
 * time range. The range is not part of it: the page keeps its own, and a
 * widget reads the dashboard's.
 *
 * One shape for the three that write and read one - the server
 * (RumProductAnalyticsSavedViewService refuses a definition the read
 * routes would refuse), the pages and the widgets (each reads a stored
 * one as untrusted, and says so when it cannot) - with the read routes'
 * own rules (ProductAnalyticsEventReads): the same events, windows,
 * periods and segments, and nothing else.
 */

import {
  DEFAULT_PRODUCT_ANALYTICS_FUNNEL_WINDOW_MS,
  PRODUCT_ANALYTICS_FUNNEL_MAX_STEPS,
  PRODUCT_ANALYTICS_FUNNEL_MIN_STEPS,
  PRODUCT_ANALYTICS_FUNNEL_WINDOWS_MS,
  PRODUCT_ANALYTICS_MAX_SEGMENT_FILTERS,
  PRODUCT_ANALYTICS_RETENTION_PERIODS,
  ProductAnalyticsEventRef,
  ProductAnalyticsRetentionPeriod,
  ProductAnalyticsSegmentFilter,
  toProductAnalyticsEventRef,
  toProductAnalyticsSegmentFilter,
} from "./ProductAnalyticsEventReads";

/* What a saved definition is of: the page that saved it, and the widget that draws it. */
export enum ProductAnalyticsSavedViewType {
  Funnel = "funnel",
  Retention = "retention",
}

export const PRODUCT_ANALYTICS_SAVED_VIEW_TYPES: ReadonlyArray<ProductAnalyticsSavedViewType> =
  [
    ProductAnalyticsSavedViewType.Funnel,
    ProductAnalyticsSavedViewType.Retention,
  ];

export function isProductAnalyticsSavedViewType(
  value: unknown,
): value is ProductAnalyticsSavedViewType {
  return (
    typeof value === "string" &&
    (PRODUCT_ANALYTICS_SAVED_VIEW_TYPES as ReadonlyArray<string>).includes(
      value,
    )
  );
}

/* A name as the list shows it: the model's short text. */
export const PRODUCT_ANALYTICS_SAVED_VIEW_NAME_MAX_LENGTH: number = 100;

/*
 * The most of one kind an application keeps: a team's list to pick from,
 * which the pages read whole.
 */
export const PRODUCT_ANALYTICS_SAVED_VIEWS_PER_APPLICATION_MAX: number = 100;

/*
 * The address key a page opens a saved definition by
 * (`?view=<id>`): the link a widget's "Open" goes to, and the one a page
 * keeps while the definition on screen is the saved one.
 */
export const PRODUCT_ANALYTICS_SAVED_VIEW_URL_KEY: string = "view";

export interface ProductAnalyticsFunnelDefinition {
  steps: Array<ProductAnalyticsEventRef>;
  windowMs: number;
  filters: Array<ProductAnalyticsSegmentFilter>;
}

export interface ProductAnalyticsRetentionDefinition {
  startEvent: ProductAnalyticsEventRef;
  returnEvent: ProductAnalyticsEventRef;
  period: ProductAnalyticsRetentionPeriod;
  filters: Array<ProductAnalyticsSegmentFilter>;
}

export interface ProductAnalyticsSavedViewDefinitions {
  [ProductAnalyticsSavedViewType.Funnel]: ProductAnalyticsFunnelDefinition;
  [ProductAnalyticsSavedViewType.Retention]: ProductAnalyticsRetentionDefinition;
}

/* A definition read from what someone sent or stored: it, or the first thing wrong with it. */
export type ProductAnalyticsDefinitionRead<T> =
  | { definition: T; problem: null }
  | { definition: null; problem: string };

/*
 * Why a definition cannot be kept or read, in the words the read routes
 * use for the same mistakes.
 */
export const PRODUCT_ANALYTICS_SAVED_VIEW_PROBLEMS: {
  notAnObject: string;
  steps: string;
  step: string;
  window: string;
  filters: string;
  filter: string;
  startEvent: string;
  returnEvent: string;
  period: string;
  name: string;
  nameTooLong: string;
  viewType: string;
  viewTypeFixed: string;
  oneKindAtATime: string;
  definition: string;
  tooMany: string;
} = {
  notAnObject: "A saved definition must be an object.",
  steps: `A funnel has ${PRODUCT_ANALYTICS_FUNNEL_MIN_STEPS} to ${PRODUCT_ANALYTICS_FUNNEL_MAX_STEPS} steps.`,
  step: "Each step must be an event: a kind and, for a page or a custom event, its name.",
  window: `windowMs must be one of ${PRODUCT_ANALYTICS_FUNNEL_WINDOWS_MS.join(", ")}.`,
  filters: `A segment has at most ${PRODUCT_ANALYTICS_MAX_SEGMENT_FILTERS} filters.`,
  filter:
    "Each filter needs a field, a key for a property or a user property, and a value.",
  startEvent:
    "The start event must be an event: a kind and, for a page or a custom event, its name.",
  returnEvent:
    "The return event must be an event: a kind and, for a page or a custom event, its name.",
  period: `period must be one of ${PRODUCT_ANALYTICS_RETENTION_PERIODS.join(", ")}.`,
  name: "Give it a name.",
  nameTooLong: `A name has at most ${PRODUCT_ANALYTICS_SAVED_VIEW_NAME_MAX_LENGTH} characters.`,
  viewType: `viewType must be one of ${PRODUCT_ANALYTICS_SAVED_VIEW_TYPES.join(", ")}.`,
  viewTypeFixed:
    "A saved funnel stays a funnel, and a saved retention table a retention table: save a new one instead.",
  oneKindAtATime:
    "A definition is a funnel's or a retention table's: update saved funnels and saved retention tables apart.",
  definition: "Save what the page shows: its definition is missing.",
  tooMany: `An application keeps at most ${PRODUCT_ANALYTICS_SAVED_VIEWS_PER_APPLICATION_MAX} saved funnels and ${PRODUCT_ANALYTICS_SAVED_VIEWS_PER_APPLICATION_MAX} saved retention tables. Delete one you no longer use first.`,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function problem<T>(message: string): ProductAnalyticsDefinitionRead<T> {
  return { definition: null, problem: message };
}

/* A segment as the routes read one: absent is none; each filter as the routes keep it. */
function readFilters(
  value: unknown,
): ProductAnalyticsDefinitionRead<Array<ProductAnalyticsSegmentFilter>> {
  if (value === undefined || value === null) {
    return { definition: [], problem: null };
  }

  if (
    !Array.isArray(value) ||
    value.length > PRODUCT_ANALYTICS_MAX_SEGMENT_FILTERS
  ) {
    return problem(PRODUCT_ANALYTICS_SAVED_VIEW_PROBLEMS.filters);
  }

  const filters: Array<ProductAnalyticsSegmentFilter> = [];

  for (const entry of value as Array<unknown>) {
    const filter: ProductAnalyticsSegmentFilter | null =
      toProductAnalyticsSegmentFilter(entry);

    if (!filter) {
      return problem(PRODUCT_ANALYTICS_SAVED_VIEW_PROBLEMS.filter);
    }

    filters.push({
      field: filter.field,
      key: filter.key,
      value: filter.value,
    });
  }

  return { definition: filters, problem: null };
}

/*
 * A funnel's definition: two to six steps, a time to finish it the page
 * offers (the default when none is named) and a segment - kept in that
 * shape alone, so nothing else a caller sent is stored.
 */
export function readProductAnalyticsFunnelDefinition(
  value: unknown,
): ProductAnalyticsDefinitionRead<ProductAnalyticsFunnelDefinition> {
  if (!isRecord(value)) {
    return problem(PRODUCT_ANALYTICS_SAVED_VIEW_PROBLEMS.notAnObject);
  }

  const rawSteps: unknown = value["steps"];

  if (
    !Array.isArray(rawSteps) ||
    rawSteps.length < PRODUCT_ANALYTICS_FUNNEL_MIN_STEPS ||
    rawSteps.length > PRODUCT_ANALYTICS_FUNNEL_MAX_STEPS
  ) {
    return problem(PRODUCT_ANALYTICS_SAVED_VIEW_PROBLEMS.steps);
  }

  const steps: Array<ProductAnalyticsEventRef> = [];

  for (const rawStep of rawSteps as Array<unknown>) {
    const step: ProductAnalyticsEventRef | null =
      toProductAnalyticsEventRef(rawStep);

    if (!step) {
      return problem(PRODUCT_ANALYTICS_SAVED_VIEW_PROBLEMS.step);
    }

    steps.push({ kind: step.kind, name: step.name });
  }

  const rawWindow: unknown = value["windowMs"];
  const windowMs: unknown =
    rawWindow === undefined || rawWindow === null
      ? DEFAULT_PRODUCT_ANALYTICS_FUNNEL_WINDOW_MS
      : rawWindow;

  if (
    typeof windowMs !== "number" ||
    !PRODUCT_ANALYTICS_FUNNEL_WINDOWS_MS.includes(windowMs)
  ) {
    return problem(PRODUCT_ANALYTICS_SAVED_VIEW_PROBLEMS.window);
  }

  const filters: ProductAnalyticsDefinitionRead<
    Array<ProductAnalyticsSegmentFilter>
  > = readFilters(value["filters"]);

  if (!filters.definition) {
    return problem(filters.problem);
  }

  return {
    definition: {
      steps: steps,
      windowMs: windowMs,
      filters: filters.definition,
    },
    problem: null,
  };
}

/*
 * A retention table's definition: its start and return events, a period
 * (a week when none is named, as the read's own default) and a segment.
 */
export function readProductAnalyticsRetentionDefinition(
  value: unknown,
): ProductAnalyticsDefinitionRead<ProductAnalyticsRetentionDefinition> {
  if (!isRecord(value)) {
    return problem(PRODUCT_ANALYTICS_SAVED_VIEW_PROBLEMS.notAnObject);
  }

  const startEvent: ProductAnalyticsEventRef | null =
    toProductAnalyticsEventRef(value["startEvent"]);

  if (!startEvent) {
    return problem(PRODUCT_ANALYTICS_SAVED_VIEW_PROBLEMS.startEvent);
  }

  const returnEvent: ProductAnalyticsEventRef | null =
    toProductAnalyticsEventRef(value["returnEvent"]);

  if (!returnEvent) {
    return problem(PRODUCT_ANALYTICS_SAVED_VIEW_PROBLEMS.returnEvent);
  }

  const rawPeriod: unknown = value["period"];
  const period: unknown =
    rawPeriod === undefined || rawPeriod === null
      ? ProductAnalyticsRetentionPeriod.Week
      : rawPeriod;

  if (
    typeof period !== "string" ||
    !(PRODUCT_ANALYTICS_RETENTION_PERIODS as ReadonlyArray<string>).includes(
      period,
    )
  ) {
    return problem(PRODUCT_ANALYTICS_SAVED_VIEW_PROBLEMS.period);
  }

  const filters: ProductAnalyticsDefinitionRead<
    Array<ProductAnalyticsSegmentFilter>
  > = readFilters(value["filters"]);

  if (!filters.definition) {
    return problem(filters.problem);
  }

  return {
    definition: {
      startEvent: { kind: startEvent.kind, name: startEvent.name },
      returnEvent: { kind: returnEvent.kind, name: returnEvent.name },
      period: period as ProductAnalyticsRetentionPeriod,
      filters: filters.definition,
    },
    problem: null,
  };
}

/* A definition of the kind named, read as that kind's. */
export function readProductAnalyticsSavedViewDefinition<
  T extends ProductAnalyticsSavedViewType,
>(
  viewType: T,
  value: unknown,
): ProductAnalyticsDefinitionRead<ProductAnalyticsSavedViewDefinitions[T]> {
  if (viewType === ProductAnalyticsSavedViewType.Funnel) {
    return readProductAnalyticsFunnelDefinition(
      value,
    ) as ProductAnalyticsDefinitionRead<
      ProductAnalyticsSavedViewDefinitions[T]
    >;
  }

  if (viewType === ProductAnalyticsSavedViewType.Retention) {
    return readProductAnalyticsRetentionDefinition(
      value,
    ) as ProductAnalyticsDefinitionRead<
      ProductAnalyticsSavedViewDefinitions[T]
    >;
  }

  return problem(PRODUCT_ANALYTICS_SAVED_VIEW_PROBLEMS.viewType);
}

/* A name as it is kept: trimmed. */
export function toProductAnalyticsSavedViewName(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/* What is wrong with a name, or null: there is one, and it fits. */
export function getProductAnalyticsSavedViewNameProblem(
  value: unknown,
): string | null {
  const name: string = toProductAnalyticsSavedViewName(value);

  if (name.length === 0) {
    return PRODUCT_ANALYTICS_SAVED_VIEW_PROBLEMS.name;
  }

  if (name.length > PRODUCT_ANALYTICS_SAVED_VIEW_NAME_MAX_LENGTH) {
    return PRODUCT_ANALYTICS_SAVED_VIEW_PROBLEMS.nameTooLong;
  }

  return null;
}

/*
 * Whether two definitions read the same: what a page compares to say the
 * one on screen is the saved one, or has changed since.
 */
export function isSameProductAnalyticsDefinition(
  left: unknown,
  right: unknown,
): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

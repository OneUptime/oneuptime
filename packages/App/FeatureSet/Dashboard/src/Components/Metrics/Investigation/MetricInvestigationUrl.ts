import Dictionary from "Common/Types/Dictionary";
import MetricInvestigationTime, {
  MetricInvestigationTimePreset,
  MetricInvestigationTimeSelection,
  MetricInvestigationTimeUrlValue,
} from "./MetricInvestigationTime";
import MetricInvestigationQueryUtil, {
  MetricInvestigationQueries,
  MetricInvestigationQueriesUrlValue,
} from "./MetricInvestigationQueries";

/*
 * Where a metric investigation is remembered: in the page's own URL.
 *
 * The page's address then carries the investigation, so a reload keeps it
 * and a link pasted to a teammate opens the very same charts. Only what the
 * reader changed is written - an untouched investigation leaves the URL as
 * it was - and nothing is stored anywhere else: the next person to open the
 * page without the link starts from the page's own defaults, not from
 * somebody else's investigation.
 *
 * Every name starts with the page's prefix ("metricsTime", "metricsStart"),
 * so it never meets another part of the page's URL state, such as a list's
 * filters.
 *
 * In two halves: the time range ("Time", "Start", "End"), which a card with
 * no metrics of its own keeps too (an incident's logs; see
 * UseInvestigationTimeRange), and the metrics ("Queries", "Formulas").
 */

export interface MetricInvestigationTimeUrlParamNames {
  time: string;
  start: string;
  end: string;
}

export interface MetricInvestigationQueryUrlParamNames {
  queries: string;
  formulas: string;
}

export interface MetricInvestigationUrlParamNames
  extends MetricInvestigationTimeUrlParamNames,
    MetricInvestigationQueryUrlParamNames {}

/*
 * What the URL keeps: the pick and the queries the reader chose, each null
 * while it is the page's default.
 */
export interface MetricInvestigationUrlState {
  selection: MetricInvestigationTimeSelection | null;
  queries: MetricInvestigationQueries | null;
}

export type ReadUrlParamFunction = (name: string) => string | null;

export default class MetricInvestigationUrl {
  public static getTimeParamNames(
    prefix: string,
  ): MetricInvestigationTimeUrlParamNames {
    return {
      time: `${prefix}Time`,
      start: `${prefix}Start`,
      end: `${prefix}End`,
    };
  }

  public static getQueryParamNames(
    prefix: string,
  ): MetricInvestigationQueryUrlParamNames {
    return {
      queries: `${prefix}Queries`,
      formulas: `${prefix}Formulas`,
    };
  }

  public static getParamNames(
    prefix: string,
  ): MetricInvestigationUrlParamNames {
    return {
      ...MetricInvestigationUrl.getTimeParamNames(prefix),
      ...MetricInvestigationUrl.getQueryParamNames(prefix),
    };
  }

  /*
   * The time range's params to set, by name: a null value is one to take
   * out, so every time name the investigation owns is in the result (see
   * buildParams).
   */
  public static buildTimeParams(input: {
    prefix: string;
    selection: MetricInvestigationTimeSelection | null;
  }): Dictionary<string | null> {
    const names: MetricInvestigationTimeUrlParamNames =
      MetricInvestigationUrl.getTimeParamNames(input.prefix);

    const time: MetricInvestigationTimeUrlValue | null = input.selection
      ? MetricInvestigationTime.toUrlValue(input.selection)
      : null;

    return {
      [names.time]: time ? time.time : null,
      [names.start]: time?.start || null,
      [names.end]: time?.end || null,
    };
  }

  // The metrics' params to set, by name, the same way.
  public static buildQueryParams(input: {
    prefix: string;
    queries: MetricInvestigationQueries | null;
  }): Dictionary<string | null> {
    const names: MetricInvestigationQueryUrlParamNames =
      MetricInvestigationUrl.getQueryParamNames(input.prefix);

    const queries: MetricInvestigationQueriesUrlValue | null = input.queries
      ? MetricInvestigationQueryUtil.toUrlValue(input.queries)
      : null;

    return {
      [names.queries]: queries ? queries.queries : null,
      [names.formulas]: queries?.formulas || null,
    };
  }

  /*
   * The params to set, by name. A null value is a param to take out, so
   * every name the investigation owns is in the result, and handing it to
   * Navigation.setQueryString leaves the URL holding exactly this state and
   * everything else on it untouched.
   */
  public static buildParams(input: {
    prefix: string;
    state: MetricInvestigationUrlState;
  }): Dictionary<string | null> {
    return {
      ...MetricInvestigationUrl.buildTimeParams({
        prefix: input.prefix,
        selection: input.state.selection,
      }),
      ...MetricInvestigationUrl.buildQueryParams({
        prefix: input.prefix,
        queries: input.state.queries,
      }),
    };
  }

  /*
   * The pick a URL keeps for this page, or null when it keeps none the page
   * can show (see MetricInvestigationTime.fromUrlValue).
   */
  public static readSelection(input: {
    prefix: string;
    read: ReadUrlParamFunction;
    presets: Array<MetricInvestigationTimePreset>;
  }): MetricInvestigationTimeSelection | null {
    const names: MetricInvestigationTimeUrlParamNames =
      MetricInvestigationUrl.getTimeParamNames(input.prefix);

    return MetricInvestigationTime.fromUrlValue({
      time: input.read(names.time),
      start: input.read(names.start),
      end: input.read(names.end),
      presets: input.presets,
    });
  }

  /*
   * The metrics a URL keeps for this page, or null when it keeps none (see
   * MetricInvestigationQueryUtil.fromUrlValue).
   */
  public static readQueries(input: {
    prefix: string;
    read: ReadUrlParamFunction;
  }): MetricInvestigationQueries | null {
    const names: MetricInvestigationQueryUrlParamNames =
      MetricInvestigationUrl.getQueryParamNames(input.prefix);

    return MetricInvestigationQueryUtil.fromUrlValue({
      queries: input.read(names.queries),
      formulas: input.read(names.formulas),
    });
  }

  /*
   * The state a URL keeps for this page, or nulls for what it keeps none of
   * that the page can show (see MetricInvestigationTime.fromUrlValue and
   * MetricInvestigationQueryUtil.fromUrlValue).
   */
  public static readState(input: {
    prefix: string;
    read: ReadUrlParamFunction;
    presets: Array<MetricInvestigationTimePreset>;
  }): MetricInvestigationUrlState {
    return {
      selection: MetricInvestigationUrl.readSelection(input),
      queries: MetricInvestigationUrl.readQueries(input),
    };
  }

  /*
   * An address with these params set, and the ones whose value is null
   * taken out; everything else in it as it was. The address as handed in
   * when it cannot be read.
   */
  public static applyParams(
    href: string,
    params: Dictionary<string | null>,
  ): string {
    let url: URL;

    try {
      url = new URL(href);
    } catch {
      return href;
    }

    for (const name of Object.keys(params)) {
      const value: string | null | undefined = params[name];

      if (value === null || value === undefined || value === "") {
        url.searchParams.delete(name);
      } else {
        url.searchParams.set(name, value);
      }
    }

    return url.toString();
  }

  // Whether the URL holds any of the investigation's params at all.
  public static hasAnyParam(input: {
    prefix: string;
    read: ReadUrlParamFunction;
  }): boolean {
    return (
      MetricInvestigationUrl.hasAnyTimeParam(input) ||
      MetricInvestigationUrl.hasAnyQueryParam(input)
    );
  }

  // Whether the URL holds any of the time range's params.
  public static hasAnyTimeParam(input: {
    prefix: string;
    read: ReadUrlParamFunction;
  }): boolean {
    return Object.values(
      MetricInvestigationUrl.getTimeParamNames(input.prefix),
    ).some((name: string): boolean => {
      return Boolean(input.read(name));
    });
  }

  // Whether the URL holds any of the metrics' params.
  public static hasAnyQueryParam(input: {
    prefix: string;
    read: ReadUrlParamFunction;
  }): boolean {
    return Object.values(
      MetricInvestigationUrl.getQueryParamNames(input.prefix),
    ).some((name: string): boolean => {
      return Boolean(input.read(name));
    });
  }
}

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
 */

export interface MetricInvestigationUrlParamNames {
  time: string;
  start: string;
  end: string;
  queries: string;
  formulas: string;
}

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
  public static getParamNames(prefix: string): MetricInvestigationUrlParamNames {
    return {
      time: `${prefix}Time`,
      start: `${prefix}Start`,
      end: `${prefix}End`,
      queries: `${prefix}Queries`,
      formulas: `${prefix}Formulas`,
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
    const names: MetricInvestigationUrlParamNames =
      MetricInvestigationUrl.getParamNames(input.prefix);

    const time: MetricInvestigationTimeUrlValue | null = input.state.selection
      ? MetricInvestigationTime.toUrlValue(input.state.selection)
      : null;

    const queries: MetricInvestigationQueriesUrlValue | null = input.state
      .queries
      ? MetricInvestigationQueryUtil.toUrlValue(input.state.queries)
      : null;

    return {
      [names.time]: time ? time.time : null,
      [names.start]: time?.start || null,
      [names.end]: time?.end || null,
      [names.queries]: queries ? queries.queries : null,
      [names.formulas]: queries?.formulas || null,
    };
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
    const names: MetricInvestigationUrlParamNames =
      MetricInvestigationUrl.getParamNames(input.prefix);

    return {
      selection: MetricInvestigationTime.fromUrlValue({
        time: input.read(names.time),
        start: input.read(names.start),
        end: input.read(names.end),
        presets: input.presets,
      }),
      queries: MetricInvestigationQueryUtil.fromUrlValue({
        queries: input.read(names.queries),
        formulas: input.read(names.formulas),
      }),
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
    const names: MetricInvestigationUrlParamNames =
      MetricInvestigationUrl.getParamNames(input.prefix);

    return Object.values(names).some((name: string): boolean => {
      return Boolean(input.read(name));
    });
  }
}

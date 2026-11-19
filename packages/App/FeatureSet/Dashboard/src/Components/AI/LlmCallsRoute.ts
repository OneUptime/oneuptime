import { SpanStatus } from "Common/Models/AnalyticsModels/Span";
import Route from "Common/Types/API/Route";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import Dictionary from "Common/Types/Dictionary";
import { JSONObject } from "Common/Types/JSON";
import TableFilterUrlState from "Common/UI/Utils/TableFilterUrlState";

/*
 * LLM USAGE'S ERROR RATE OPENS THE AI CALLS THAT FAILED (#9750).
 *
 * The Usage tab's "AI calls" tile said "3.2% error rate" under its count, and
 * nothing opened the calls that failed: an error rate says something
 * failed, never what (#9593 made every telemetry Overview's error rate open
 * its failed requests; this was the one left). It counts the AI calls the
 * apps send - GenAI spans, as Calls lists every one - whose status is Error,
 * in the tab's range (LlmUsageReader). So it opens Calls on exactly those:
 *
 *   - the Status filter on Error, as a chip the reader sees and can take
 *     off;
 *   - the Seen At filter on the tab's own range;
 *
 * both in the list's own address, the parameter its filters write when
 * someone sets them by hand (TableFilterUrlState), so the list arrives
 * filtered, and each row opens its call in the trace viewer, where its
 * error is.
 *
 * Pure, and free of the route map (it reads the app's config, which reads
 * `window` when it loads): the page hands in the Calls route.
 */

// The Calls list's table (LlmCallsTable): its id, and the namespace of its URL state.
export const LLM_CALLS_TABLE_ID: string = "llm-calls-table";

/*
 * The Calls list's filters for the calls a count counted: those that failed,
 * in the range it counted.
 */
export function getLlmCallsFilterData(data: {
  range: InBetween<Date>;
  isFailedOnly: boolean;
}): JSONObject {
  const filter: JSONObject = {
    startTime: new InBetween<Date>(
      data.range.startValue,
      data.range.endValue,
    ) as unknown as JSONObject,
  };

  if (data.isFailedOnly) {
    filter["statusCode"] = [SpanStatus.Error];
  }

  return filter;
}

// AI / LLM > Calls, on the calls of the range that failed.
export function getFailedLlmCallsRoute(data: {
  callsRoute: Route;
  range: InBetween<Date>;
}): Route {
  const params: Dictionary<string> = TableFilterUrlState.getLinkQueryParams(
    LLM_CALLS_TABLE_ID,
    {
      filter: getLlmCallsFilterData({
        range: data.range,
        isFailedOnly: true,
      }),
    },
  );

  return new Route(data.callsRoute.toString()).addQueryParams(params);
}

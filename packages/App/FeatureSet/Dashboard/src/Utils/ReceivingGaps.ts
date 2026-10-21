import URL from "Common/Types/API/URL";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import { JSONObject } from "Common/Types/JSON";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import { APP_API_URL } from "Common/UI/Config";
import ChartEventKind from "Common/UI/Components/Charts/Types/ChartEventKind";
import ChartReferenceRegionProps from "Common/UI/Components/Charts/Types/ReferenceRegionProps";
import { translationKey, Translator } from "Common/UI/Utils/TranslateTemplate";
import ReceivingGapsUtil, {
  ReceivingGap,
  ReceivingGapReason,
} from "Common/Utils/Telemetry/ReceivingGaps";

/*
 * When OneUptime itself was not receiving data, for the availability charts
 * of the host, Docker host, Podman host and Kubernetes cluster overviews
 * (issue #2825).
 *
 * Those charts are drawn from the heartbeat the resource's agent sends. A
 * stretch with no heartbeat used to read as "Down" even when OneUptime was
 * restarting, being upgraded or catching up on its ingest queue. The charts
 * now fetch those stretches, leave them out of the uptime badge
 * (HeartbeatAvailabilityUtil) and shade them as "Not monitored".
 */

export const RECEIVING_GAPS_ROUTE: string = "/receiving-gaps";

/*
 * The charts are drawn once their metrics and these gaps are in. The gaps
 * come from a tiny, cached read and normally land long before the metrics;
 * if they ever do not, the charts are drawn without them after this long
 * rather than waiting, and the next refresh asks again.
 */
export const RECEIVING_GAPS_TIMEOUT_MS: number = 3_000;

/*
 * The shade of a "Not monitored" stretch: neutral, so it reads as "unknown"
 * next to the chart's up/down line in both themes.
 */
export const NOT_MONITORED_REGION_COLOR: string = "#9ca3af";

export const NOT_MONITORED_LABEL: string = translationKey("Not monitored");

/*
 * What a "Not monitored" stretch was, in the hover card. English here,
 * looked up when shown.
 */
export const NOT_MONITORED_EXPLANATIONS: Record<ReceivingGapReason, string> = {
  [ReceivingGapReason.NotReceiving]: translationKey(
    "OneUptime was not receiving data (a restart, an upgrade or an outage). This time is left out of uptime.",
  ),
  [ReceivingGapReason.Reconnecting]: translationKey(
    "OneUptime had just come back and agents were reconnecting. This time is left out of uptime.",
  ),
  [ReceivingGapReason.CatchingUp]: translationKey(
    "OneUptime has received this data and is still processing it. This time is left out of uptime until it catches up.",
  ),
};

/*
 * The gaps in [startsAt, endsAt]. Never throws, and never takes longer than
 * RECEIVING_GAPS_TIMEOUT_MS: a chart that cannot ask, or does not hear back
 * in time, draws as it always did, with every silent interval judged.
 */
export async function fetchReceivingGaps(window: {
  startsAt: Date;
  endsAt: Date;
}): Promise<Array<ReceivingGap>> {
  let timer: ReturnType<typeof setTimeout> | undefined = undefined;

  const timedOut: Promise<Array<ReceivingGap>> = new Promise<
    Array<ReceivingGap>
  >((resolve: (gaps: Array<ReceivingGap>) => void) => {
    timer = setTimeout(() => {
      resolve([]);
    }, RECEIVING_GAPS_TIMEOUT_MS);
  });

  try {
    return await Promise.race([requestReceivingGaps(window), timedOut]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}

async function requestReceivingGaps(window: {
  startsAt: Date;
  endsAt: Date;
}): Promise<Array<ReceivingGap>> {
  try {
    const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
      await API.post<JSONObject>({
        url: URL.fromString(APP_API_URL.toString()).addRoute(
          RECEIVING_GAPS_ROUTE,
        ),
        data: {
          startsAt: window.startsAt.toISOString(),
          endsAt: window.endsAt.toISOString(),
        },
        headers: { ...ModelAPI.getCommonHeaders() },
      });

    if (!response || response instanceof HTTPErrorResponse) {
      return [];
    }

    return ReceivingGapsUtil.fromJSON((response.data || {})["gaps"]);
  } catch {
    return [];
  }
}

/*
 * The shaded "Not monitored" regions for a chart. Touching gaps - an outage
 * and the reconnect grace after it - are one stretch to a reader, so they
 * are one region, explained by the reason that says the most.
 */
export function getNotMonitoredRegions(data: {
  gaps: Array<ReceivingGap>;
  translator: Translator;
}): Array<ChartReferenceRegionProps> {
  const stretches: Array<{
    startsAt: Date;
    endsAt: Date;
    reasons: Set<ReceivingGapReason>;
  }> = [];

  for (const gap of ReceivingGapsUtil.normalize(data.gaps)) {
    const previous:
      | { startsAt: Date; endsAt: Date; reasons: Set<ReceivingGapReason> }
      | undefined = stretches[stretches.length - 1];

    if (previous && previous.endsAt.getTime() >= gap.startsAt.getTime()) {
      previous.endsAt = gap.endsAt;
      previous.reasons.add(gap.reason);
      continue;
    }

    stretches.push({
      startsAt: gap.startsAt,
      endsAt: gap.endsAt,
      reasons: new Set<ReceivingGapReason>([gap.reason]),
    });
  }

  return stretches.map(
    (stretch: {
      startsAt: Date;
      endsAt: Date;
      reasons: Set<ReceivingGapReason>;
    }): ChartReferenceRegionProps => {
      const reason: ReceivingGapReason = stretch.reasons.has(
        ReceivingGapReason.NotReceiving,
      )
        ? ReceivingGapReason.NotReceiving
        : stretch.reasons.has(ReceivingGapReason.Reconnecting)
          ? ReceivingGapReason.Reconnecting
          : ReceivingGapReason.CatchingUp;

      return {
        startDate: stretch.startsAt,
        endDate: stretch.endsAt,
        label: data.translator.translateText(NOT_MONITORED_LABEL),
        subtitle: data.translator.translateText(
          NOT_MONITORED_EXPLANATIONS[reason],
        ),
        color: NOT_MONITORED_REGION_COLOR,
        kind: ChartEventKind.Generic,
      };
    },
  );
}

import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import URL from "Common/Types/API/URL";
import { JSONObject, JSONValue } from "Common/Types/JSON";
import {
  OnCallFireDrillPreview,
  OnCallFireDrillRecord,
  OnCallFireDrillRun,
} from "Common/Types/OnCallDutyPolicy/OnCallFireDrill";
import {
  OnCallTestPagePreview,
  OnCallTestPageRecordKind,
  OnCallTestPageResult,
} from "Common/Types/OnCallDutyPolicy/OnCallTestPage";
import { APP_API_URL } from "Common/UI/Config";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";

/*
 * TEST PAGES, AS THE DASHBOARD ASKS FOR THEM (Common/Server/API/
 * OnCallTestPageAPI): what a test will send, sending it, and what became of
 * it. Every page that offers a test - User Settings, On-Call > Readiness,
 * an on-call policy, a guided setup - goes through here.
 */

// Who a test is for.
export type OnCallTestPageTarget =
  | { kind: "self" }
  | { kind: "member"; userId: string; userName?: string | undefined }
  | { kind: "policy"; policyId: string; policyName?: string | undefined };

// What a test stands in for: a kind of record, and one of its severities.
export interface OnCallTestPageSeverityChoice {
  recordKind: OnCallTestPageRecordKind;
  severityId: string;
}

export const ON_CALL_TEST_PAGE_API_PATH: string = "/on-call-test-page";

// A refusal, in the server's own words when it said any.
export class OnCallTestPageApiError extends Error {
  public statusCode: number | undefined;

  public constructor(message: string, statusCode?: number | undefined) {
    super(message);
    this.statusCode = statusCode;
  }
}

function getUrl(route: string): URL {
  return URL.fromString(APP_API_URL.toString()).addRoute(
    `${ON_CALL_TEST_PAGE_API_PATH}${route}`,
  );
}

function toBody(
  response: HTTPResponse<JSONObject> | HTTPErrorResponse,
): JSONObject {
  if (response instanceof HTTPErrorResponse) {
    throw new OnCallTestPageApiError(
      API.getFriendlyMessage(response),
      response.statusCode,
    );
  }

  const body: JSONValue = response.data as JSONValue;

  return body && typeof body === "object" && !Array.isArray(body)
    ? (body as JSONObject)
    : {};
}

// The body a request names its target and severity in.
export function getTestPageRequestBody(data: {
  target: OnCallTestPageTarget;
  severity: OnCallTestPageSeverityChoice;
  walksEscalation?: boolean | undefined;
}): JSONObject {
  const body: JSONObject = {
    recordKind: data.severity.recordKind,
    severityId: data.severity.severityId,
  };

  if (data.target.kind === "member") {
    body["userId"] = data.target.userId;
  }

  if (data.target.kind === "policy") {
    body["policyId"] = data.target.policyId;
    body["walksEscalation"] = Boolean(data.walksEscalation);
  }

  return body;
}

export default class OnCallTestPageApi {
  public static async preview(data: {
    target: OnCallTestPageTarget;
    severity: OnCallTestPageSeverityChoice;
  }): Promise<OnCallTestPagePreview> {
    const body: JSONObject = toBody(
      await API.post<JSONObject>({
        url: getUrl("/preview"),
        data: getTestPageRequestBody(data),
        headers: { ...ModelAPI.getCommonHeaders() },
      }),
    );

    return body as unknown as OnCallTestPagePreview;
  }

  // Sends the test. Returns its run, to read its result by.
  public static async send(data: {
    target: OnCallTestPageTarget;
    severity: OnCallTestPageSeverityChoice;
    walksEscalation?: boolean | undefined;
  }): Promise<string> {
    const body: JSONObject = toBody(
      await API.post<JSONObject>({
        url: getUrl(
          data.target.kind === "policy" ? "/page-policy" : "/page-person",
        ),
        data: getTestPageRequestBody(data),
        headers: { ...ModelAPI.getCommonHeaders() },
      }),
    );

    const executionLogId: string =
      typeof body["executionLogId"] === "string"
        ? (body["executionLogId"] as string)
        : "";

    if (!executionLogId) {
      throw new OnCallTestPageApiError(
        "The test page was sent, but its result can't be shown.",
      );
    }

    return executionLogId;
  }

  /*
   * A MONITOR'S FIRE DRILL (#7012): the monitor's failures, and for the one
   * picked (or the first), each policy it pages and who - before anything
   * is sent.
   */
  public static async fireDrillPreview(data: {
    monitorId: string;
    eventKey?: string | undefined;
  }): Promise<OnCallFireDrillPreview> {
    const body: JSONObject = toBody(
      await API.post<JSONObject>({
        url: getUrl("/fire-drill/preview"),
        data: {
          monitorId: data.monitorId,
          ...(data.eventKey ? { eventKey: data.eventKey } : {}),
        },
        headers: { ...ModelAPI.getCommonHeaders() },
      }),
    );

    return body as unknown as OnCallFireDrillPreview;
  }

  /*
   * Starts the drill of a failure: the server pages the policies it pages
   * now - each one's first level, or every level in turn when the drill
   * walks them (#9385). Returns each policy's test, to read its result by.
   */
  public static async startFireDrill(data: {
    monitorId: string;
    eventKey: string;
    walksEscalation?: boolean | undefined;
  }): Promise<Array<OnCallFireDrillRun>> {
    const body: JSONObject = toBody(
      await API.post<JSONObject>({
        url: getUrl("/fire-drill/start"),
        data: {
          monitorId: data.monitorId,
          eventKey: data.eventKey,
          walksEscalation: Boolean(data.walksEscalation),
        },
        headers: { ...ModelAPI.getCommonHeaders() },
      }),
    );

    const runs: Array<OnCallFireDrillRun> = Array.isArray(body["runs"])
      ? (body["runs"] as unknown as Array<OnCallFireDrillRun>).filter(
          (run: OnCallFireDrillRun): boolean => {
            return Boolean(run && run.executionLogId);
          },
        )
      : [];

    if (runs.length === 0) {
      throw new OnCallTestPageApiError(
        "The fire drill was started, but its results can't be shown.",
      );
    }

    return runs;
  }

  /*
   * A MONITOR'S LAST FIRE DRILL (#9386): when it ran, who ran it, the
   * failure it rehearsed and what became of each policy's test - or null,
   * with none the reader may read.
   */
  public static async lastFireDrill(
    monitorId: string,
  ): Promise<OnCallFireDrillRecord | null> {
    const body: JSONObject = toBody(
      await API.get<JSONObject>({
        url: getUrl(`/fire-drill/last/${monitorId}`),
        headers: { ...ModelAPI.getCommonHeaders() },
      }),
    );

    const fireDrill: JSONValue | undefined = body["fireDrill"];

    return fireDrill &&
      typeof fireDrill === "object" &&
      !Array.isArray(fireDrill) &&
      Array.isArray((fireDrill as JSONObject)["runs"])
      ? (fireDrill as unknown as OnCallFireDrillRecord)
      : null;
  }

  public static async getResult(
    executionLogId: string,
  ): Promise<OnCallTestPageResult> {
    const body: JSONObject = toBody(
      await API.get<JSONObject>({
        url: getUrl(`/result/${executionLogId}`),
        headers: { ...ModelAPI.getCommonHeaders() },
      }),
    );

    return body as unknown as OnCallTestPageResult;
  }
}

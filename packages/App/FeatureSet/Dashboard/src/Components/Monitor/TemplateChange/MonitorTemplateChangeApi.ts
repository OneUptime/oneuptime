import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import URL from "Common/Types/API/URL";
import BadDataException from "Common/Types/Exception/BadDataException";
import { JSONObject, JSONValue } from "Common/Types/JSON";
import {
  MonitorTemplateChangeSettings,
  MonitorTemplateChangeView,
  MonitorTemplateLinkResult,
  MonitorTemplateChangeOutcome,
  readMonitorTemplateChangeView,
} from "Common/Types/Monitor/MonitorTemplateChange";
import MonitorType from "Common/Types/Monitor/MonitorType";
import { APP_API_URL } from "Common/UI/Config";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";

/*
 * The Dashboard's calls to change monitors' template (issues #11260,
 * #11266): one monitor at a time through the template's own routes
 * (MonitorTemplateAPI), many at once through a change the server runs
 * (MonitorTemplateChangeAPI). Every call carries the project's headers, and
 * a non-2xx answer is thrown, so a dialog shows it with
 * API.getFriendlyMessage. React-free: tested from App.
 */

export const MONITOR_TEMPLATE_CHANGE_ROUTES: {
  start: string;
  change: (changeId: string) => string;
  activeOfTemplate: (monitorTemplateId: string) => string;
  ofProject: string;
  autoImportRuleMonitors: (ruleId: string) => string;
  stop: (changeId: string) => string;
  retry: (changeId: string) => string;
  linkOne: (monitorTemplateId: string, monitorId: string) => string;
  unlinkOne: (monitorTemplateId: string, monitorId: string) => string;
} = {
  start: "/monitor-template-change/start",
  change: (changeId: string): string => {
    return `/monitor-template-change/change/${encodeURIComponent(changeId)}`;
  },
  activeOfTemplate: (monitorTemplateId: string): string => {
    return `/monitor-template-change/template/${encodeURIComponent(monitorTemplateId)}/active`;
  },
  ofProject: "/monitor-template-change/project/active",
  autoImportRuleMonitors: (ruleId: string): string => {
    return `/monitor-template-change/auto-import-rule/${encodeURIComponent(ruleId)}/monitors`;
  },
  stop: (changeId: string): string => {
    return `/monitor-template-change/change/${encodeURIComponent(changeId)}/stop`;
  },
  retry: (changeId: string): string => {
    return `/monitor-template-change/change/${encodeURIComponent(changeId)}/retry`;
  },
  linkOne: (monitorTemplateId: string, monitorId: string): string => {
    return `/monitor-template/${encodeURIComponent(monitorTemplateId)}/link-monitor/${encodeURIComponent(monitorId)}`;
  },
  unlinkOne: (monitorTemplateId: string, monitorId: string): string => {
    return `/monitor-template/${encodeURIComponent(monitorTemplateId)}/unlink-monitor/${encodeURIComponent(monitorId)}`;
  },
};

function apiUrl(route: string): URL {
  return URL.fromString(APP_API_URL.toString()).addRoute(route);
}

async function getJson(route: string): Promise<JSONObject> {
  const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
    await API.get<JSONObject>({
      url: apiUrl(route),
      headers: ModelAPI.getCommonHeaders(),
    });

  if (response instanceof HTTPErrorResponse) {
    throw response;
  }

  return (response.data || {}) as JSONObject;
}

async function postJson(route: string, body: JSONObject): Promise<JSONObject> {
  const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
    await API.post<JSONObject>({
      url: apiUrl(route),
      headers: ModelAPI.getCommonHeaders(),
      data: body,
    });

  if (response instanceof HTTPErrorResponse) {
    throw response;
  }

  return (response.data || {}) as JSONObject;
}

/*
 * The change an answer carries, or a refusal: a 2xx answer without one is
 * the server not doing what it said, and must not read as "no change".
 */
function readChange(body: JSONObject): MonitorTemplateChangeView {
  const view: MonitorTemplateChangeView | null = readMonitorTemplateChangeView(
    body["change"],
  );

  if (!view) {
    // A sentence of the Dashboard's locales, so it reads in the reader's language.
    throw new BadDataException(
      translationKey(
        "The answer from the server could not be read. Reload the page, then try again.",
      ),
    );
  }

  return view;
}

// What a change of many monitors is asked with.
export interface MonitorTemplateChangeRequest {
  // The template the monitors are linked to, or unlinked from.
  monitorTemplateId?: string | undefined;
  settings: MonitorTemplateChangeSettings;
  // The monitors picked; or every one linked to the template.
  monitorIds?: Array<string> | undefined;
  allLinkedToTemplate?: boolean | undefined;
  /*
   * An auto import rule's devices' monitors, from the template it uses,
   * moved to `monitorTemplateId` - then the rule pointed at it (#11451).
   */
  autoImportRuleId?: string | undefined;
}

export async function startMonitorTemplateChange(
  request: MonitorTemplateChangeRequest,
): Promise<MonitorTemplateChangeView> {
  return readChange(
    await postJson(MONITOR_TEMPLATE_CHANGE_ROUTES.start, {
      ...(request.monitorTemplateId
        ? { monitorTemplateId: request.monitorTemplateId }
        : {}),
      settings: request.settings as unknown as JSONObject,
      ...(request.monitorIds
        ? { monitorIds: request.monitorIds as unknown as JSONValue }
        : {}),
      ...(request.allLinkedToTemplate ? { allLinkedToTemplate: true } : {}),
      ...(request.autoImportRuleId
        ? { autoImportRuleId: request.autoImportRuleId }
        : {}),
    }),
  );
}

export async function getMonitorTemplateChange(
  changeId: string,
  options?: { allLines?: boolean | undefined },
): Promise<MonitorTemplateChangeView> {
  return readChange(
    await getJson(
      `${MONITOR_TEMPLATE_CHANGE_ROUTES.change(changeId)}${
        options?.allLines ? "?lines=all" : ""
      }`,
    ),
  );
}

export async function stopMonitorTemplateChange(
  changeId: string,
): Promise<MonitorTemplateChangeView> {
  return readChange(
    await postJson(MONITOR_TEMPLATE_CHANGE_ROUTES.stop(changeId), {}),
  );
}

export async function retryMonitorTemplateChange(
  changeId: string,
): Promise<MonitorTemplateChangeView> {
  return readChange(
    await postJson(MONITOR_TEMPLATE_CHANGE_ROUTES.retry(changeId), {}),
  );
}

function readChanges(body: JSONObject): Array<MonitorTemplateChangeView> {
  return (Array.isArray(body["changes"]) ? body["changes"] : []).flatMap(
    (change: unknown): Array<MonitorTemplateChangeView> => {
      const view: MonitorTemplateChangeView | null =
        readMonitorTemplateChangeView(change);
      return view ? [view] : [];
    },
  );
}

/*
 * The project's changes the Monitors list shows (#11454): still running, or
 * finished in the last hour with monitors left out or failed - newest first.
 */
export async function getProjectMonitorTemplateChanges(): Promise<
  Array<MonitorTemplateChangeView>
> {
  return readChanges(await getJson(MONITOR_TEMPLATE_CHANGE_ROUTES.ofProject));
}

// What an auto import rule's move would move (#11451), before it is asked for.
export interface AutoImportRuleMonitorsToMove {
  // The rule's devices' monitors on the template it uses now.
  count: number;
  monitorTemplateId?: string | undefined;
  monitorTemplateName?: string | undefined;
  monitorType?: MonitorType | undefined;
  // A move of the rule's monitors is running already.
  isMoveRunning: boolean;
}

export async function getAutoImportRuleMonitorsToMove(
  ruleId: string,
): Promise<AutoImportRuleMonitorsToMove> {
  const body: JSONObject = await getJson(
    MONITOR_TEMPLATE_CHANGE_ROUTES.autoImportRuleMonitors(ruleId),
  );
  const count: number = Number(body["count"]);
  const text: (key: string) => string | undefined = (
    key: string,
  ): string | undefined => {
    const value: unknown = body[key];
    return typeof value === "string" && value ? value : undefined;
  };

  return {
    count: Number.isFinite(count) && count > 0 ? Math.floor(count) : 0,
    monitorTemplateId: text("monitorTemplateId"),
    monitorTemplateName: text("monitorTemplateName"),
    monitorType: text("monitorType") as MonitorType | undefined,
    isMoveRunning: body["isMoveRunning"] === true,
  };
}

// The template's changes that have not finished, newest first.
export async function getActiveMonitorTemplateChanges(
  monitorTemplateId: string,
): Promise<Array<MonitorTemplateChangeView>> {
  return readChanges(
    await getJson(
      MONITOR_TEMPLATE_CHANGE_ROUTES.activeOfTemplate(monitorTemplateId),
    ),
  );
}

function readLinkResult(body: JSONObject): MonitorTemplateLinkResult {
  const count: (key: string) => number = (key: string): number => {
    const value: number = Number(body[key]);
    return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
  };

  return {
    outcome:
      body["outcome"] === MonitorTemplateChangeOutcome.Unchanged
        ? MonitorTemplateChangeOutcome.Unchanged
        : MonitorTemplateChangeOutcome.Changed,
    resolvedIncidentCount: count("resolvedIncidentCount"),
    resolvedAlertCount: count("resolvedAlertCount"),
  };
}

// One monitor unlinked from the template, now: Unlink from Template's row.
export async function unlinkOneMonitor(data: {
  monitorTemplateId: string;
  monitorId: string;
  clearTemplateSettings: boolean;
}): Promise<MonitorTemplateLinkResult> {
  return readLinkResult(
    await postJson(
      MONITOR_TEMPLATE_CHANGE_ROUTES.unlinkOne(
        data.monitorTemplateId,
        data.monitorId,
      ),
      { clearTemplateSettings: data.clearTemplateSettings },
    ),
  );
}

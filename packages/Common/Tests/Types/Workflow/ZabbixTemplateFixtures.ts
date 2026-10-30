/*
 * Shared fixtures for the Zabbix template tests.
 *
 * Zabbix's side comes in two parts:
 *
 *   - What Zabbix fills the OneUptime media type's parameters with, for each
 *     kind of event (zabbixMacroValues): the macros of the parameter table
 *     in the Zabbix guide, resolved as Zabbix resolves them. A macro Zabbix
 *     does not support for an event stays as written - {EVENT.UPDATE.ACTION}
 *     on a problem, {EVENT.UPDATE.STATUS} on a recovery - and the media
 *     type's script sends it as nothing. And what the script then posts
 *     (zabbixPostedBody): App's IntegrationsDocsFacts runs the guide's own
 *     script on zabbixMacroValues and holds what it posts to this, so the
 *     templates are tested on exactly what the guide's media type sends.
 *   - Zabbix's JSON-RPC API (FakeZabbix), with the rules of Zabbix's own
 *     event.acknowledge: a close refused for a trigger that does not allow
 *     closing problems by hand, an acknowledgment of an acknowledged problem
 *     and a close of a resolved one skipped, a message required with the
 *     message flag, the API token taken only as a bearer token, and every
 *     refusal answered with HTTP 200 and the reason in the body.
 *
 * OneUptime's side is in the shape BaseModel.toJSON hands records to a
 * workflow: a record's own `_id` a plain string, foreign keys, names and
 * dates { _type, value } wrappers.
 *
 * Not a test file itself (jest only collects *.test.ts).
 */

import VMRunner from "../../../Server/Utils/VM/VMRunner";
import ReturnResult from "../../../Types/IsolatedVM/ReturnResult";
import { JSONObject, JSONValue } from "../../../Types/JSON";
import ComponentID from "../../../Types/Workflow/ComponentID";
import {
  ZABBIX_EVENT_ID_CUSTOM_FIELD,
  ZabbixEventKind,
  getTemplateGraphSpec,
} from "../../../Types/Workflow/Templates";

/*
 * A request the fake Zabbix answers, and its answer: the shapes of the
 * template simulator's SimulatedRequest and SimulatedReply, which this file
 * does not import. App's docs facts read these fixtures, and the simulator
 * reaches React through the Builder's component registry, which App's
 * compile cannot resolve.
 */
export interface ZabbixHttpRequest {
  method: string;
  url: string;
  headers: { [name: string]: string };
  body?: JSONValue | undefined;
}

export interface ZabbixHttpReply {
  status: number;
  body: JSONObject | Array<JSONObject> | string;
  headers?: { [name: string]: string } | undefined;
}

export const ZABBIX_URL: string = "https://zabbix.example.com";
export const ZABBIX_API_URL: string = `${ZABBIX_URL}/api_jsonrpc.php`;
export const ZABBIX_API_TOKEN: string =
  "bbcfce79a2d95037502f7e9a534906d3466c9a1484beb6ea0f4e7be28e8b8ce2";
export const EVENT_ID: string = "12345";
export const OTHER_EVENT_ID: string = "67890";
export const TRIGGER_ID: string = "23456";
export const PROBLEM_LINK: string = `[problem ${EVENT_ID}](${ZABBIX_URL}/tr_events.php?triggerid=${TRIGGER_ID}&eventid=${EVENT_ID})`;

/* ------------------------------- Zabbix's side ------------------------------- */

export interface ZabbixEventProps {
  kind?: ZabbixEventKind | undefined;
  eventId?: string | undefined;
  name?: string | undefined;
  host?: string | undefined;
  // Zabbix's number for the severity, 0 Not classified to 5 Disaster.
  severityNumber?: number | undefined;
  // The severity's name, when it is not Zabbix's own.
  severityName?: string | undefined;
  opdata?: string | undefined;
  tags?: Array<{ tag: string; value: string }> | undefined;
  updateAction?: string | undefined;
  updateMessage?: string | undefined;
  updateUser?: string | undefined;
}

const SEVERITY_NAMES: Array<string> = [
  "Not classified",
  "Information",
  "Warning",
  "Average",
  "High",
  "Disaster",
];

/*
 * The media type's parameters as Zabbix fills them in for one event: name
 * to value, the way the script receives them in `value`. A macro Zabbix does
 * not support for this kind of event is left as written, and {ALERT.SENDTO}
 * is the workflow's URL, from the OneUptime user's media.
 */
export function zabbixMacroValues(props: ZabbixEventProps = {}): {
  [name: string]: string;
} {
  const kind: ZabbixEventKind = props.kind || ZabbixEventKind.Problem;
  const severityNumber: number =
    props.severityNumber === undefined ? 4 : props.severityNumber;
  const isUpdate: boolean = kind === ZabbixEventKind.Update;

  return {
    url: "https://oneuptime.example.com/workflow/trigger/KEY",
    event_id: props.eventId || EVENT_ID,
    event_name: props.name === undefined ? "High CPU utilization" : props.name,
    // A recovery and an update name the problem; only an update's status says it is one.
    event_value: kind === ZabbixEventKind.Recovery ? "0" : "1",
    event_severity:
      props.severityName || (SEVERITY_NAMES[severityNumber] as string),
    event_nseverity: String(severityNumber),
    host: props.host === undefined ? "web-1" : props.host,
    event_date: "2026.10.18",
    event_time: "10:15:00",
    event_opdata:
      props.opdata === undefined ? "CPU utilization: 95.2 %" : props.opdata,
    event_tags: JSON.stringify(
      props.tags || [
        { tag: "service", value: "checkout" },
        { tag: "team", value: "ops" },
      ],
    ),
    trigger_id: TRIGGER_ID,
    // Zabbix supports {EVENT.UPDATE.STATUS} on problem and update notifications, not on a recovery.
    event_update_status:
      kind === ZabbixEventKind.Recovery
        ? "{EVENT.UPDATE.STATUS}"
        : isUpdate
          ? "1"
          : "0",
    event_update_action: isUpdate
      ? props.updateAction === undefined
        ? "acknowledged and commented"
        : props.updateAction
      : "{EVENT.UPDATE.ACTION}",
    event_update_message: isUpdate
      ? props.updateMessage === undefined
        ? "Looking into it: the checkout pods are being restarted."
        : props.updateMessage
      : "{EVENT.UPDATE.MESSAGE}",
    event_update_user: isUpdate
      ? props.updateUser === undefined
        ? "Ada Lovelace (ada)"
        : props.updateUser
      : "{USER.FULLNAME}",
  };
}

/*
 * What the OneUptime media type's script posts for the event: the body the
 * Webhook trigger hands the workflow as its request-body.
 */
export function zabbixPostedBody(props: ZabbixEventProps = {}): JSONObject {
  const values: { [name: string]: string } = zabbixMacroValues(props);
  const kind: ZabbixEventKind = props.kind || ZabbixEventKind.Problem;
  const body: JSONObject = {
    source: "zabbix",
    event: kind,
    event_id: values["event_id"] as string,
    name: values["event_name"] as string,
    host: values["host"] as string,
    severity: values["event_severity"] as string,
    severity_number: values["event_nseverity"] as string,
    status: values["event_value"] as string,
    date: values["event_date"] as string,
    time: values["event_time"] as string,
    opdata: values["event_opdata"] as string,
    tags: JSON.parse(values["event_tags"] as string) as Array<JSONObject>,
    trigger_id: values["trigger_id"] as string,
  };

  if (kind === ZabbixEventKind.Update) {
    body["update"] = {
      action: values["event_update_action"] as string,
      message: values["event_update_message"] as string,
      user: values["event_update_user"] as string,
    };
  }

  return body;
}

/*
 * What the media type the Zabbix guide gave before these templates posted:
 * no event, no severity number, no update, no link to the trigger. Its
 * problems and recoveries still work.
 */
export function zabbixFirstMediaTypeBody(
  props: ZabbixEventProps = {},
): JSONObject {
  const values: { [name: string]: string } = zabbixMacroValues(props);

  return {
    source: "zabbix",
    event_id: values["event_id"] as string,
    name: values["event_name"] as string,
    host: values["host"] as string,
    severity: values["event_severity"] as string,
    status: values["event_value"] as string,
    date: values["event_date"] as string,
    time: values["event_time"] as string,
  };
}

// What the Webhook trigger hands over for a request: its body, headers and query.
export function webhookDelivery(body: JSONValue): JSONObject {
  return {
    "request-body": body,
    "request-headers": { "content-type": "application/json" },
    "request-params": {},
  };
}

/* ---------------------------- Zabbix's JSON-RPC API ---------------------------- */

export interface FakeProblem {
  eventid: string;
  // "0" until the problem is resolved; then the recovery event's ID.
  r_eventid: string;
  acknowledged: "0" | "1";
  // The trigger's "Allow manual close": "1" when it allows closing problems by hand.
  manual_close: "0" | "1";
  triggerid: string;
  messages: Array<string>;
}

export interface FakeZabbixCall {
  method: string;
  params: JSONObject;
}

// Zabbix's refusal: HTTP 200, with the reason in the body.
function refusal(data: string): ZabbixHttpReply {
  return {
    status: 200,
    body: {
      jsonrpc: "2.0",
      error: { code: -32602, message: "Invalid params.", data: data },
      id: 1,
    },
  };
}

const DIGITS: RegExp = /^[0-9]+$/;

// Zabbix reads a number sent as text as the number, and so does this.
function integerOf(value: JSONValue | undefined): number | null {
  const text: string = String(value);

  return DIGITS.test(text) ? Number(text) : null;
}

/*
 * Zabbix's API, for the calls the templates make: event.get and
 * event.acknowledge, as Zabbix 6.4 and later answer them.
 */
export class FakeZabbix {
  public problems: Map<string, FakeProblem> = new Map();
  public calls: Array<FakeZabbixCall> = [];
  public token: string = ZABBIX_API_TOKEN;
  // Whether the token's user may close problems (read-write on the host, and a role that allows it).
  public canClose: boolean = true;
  private nextEventId: number = 99000;

  public constructor(problems: Array<Partial<FakeProblem>> = []) {
    for (const problem of problems) {
      this.add(problem);
    }
  }

  public add(problem: Partial<FakeProblem> = {}): FakeProblem {
    const added: FakeProblem = {
      eventid: problem.eventid || EVENT_ID,
      r_eventid: problem.r_eventid || "0",
      acknowledged: problem.acknowledged || "0",
      manual_close: problem.manual_close || "0",
      triggerid: problem.triggerid || TRIGGER_ID,
      messages: problem.messages || [],
    };

    this.problems.set(added.eventid, added);

    return added;
  }

  public problem(eventId: string = EVENT_ID): FakeProblem {
    const problem: FakeProblem | undefined = this.problems.get(eventId);

    if (!problem) {
      throw new Error(`Zabbix has no problem ${eventId}`);
    }

    return problem;
  }

  // The HTTP side, for the simulator's http.
  public answer(request: ZabbixHttpRequest): ZabbixHttpReply {
    if (request.method.toUpperCase() !== "POST") {
      return { status: 405, body: "Method Not Allowed" };
    }

    if (new URL(request.url).pathname !== "/api_jsonrpc.php") {
      return { status: 404, body: "<html><body>Not Found</body></html>" };
    }

    const body: JSONObject = (request.body || {}) as JSONObject;

    if (body["jsonrpc"] !== "2.0" || typeof body["method"] !== "string") {
      return {
        status: 200,
        body: {
          jsonrpc: "2.0",
          error: {
            code: -32600,
            message: "Invalid request.",
            data: 'Invalid parameter "/jsonrpc": value must be "2.0".',
          },
          id: null,
        } as JSONObject,
      };
    }

    // Zabbix 7.2 and later refuse the "auth" property; the templates never send it.
    if ("auth" in body) {
      return {
        status: 200,
        body: {
          jsonrpc: "2.0",
          error: {
            code: -32600,
            message: "Invalid request.",
            data: 'Invalid parameter "/": unexpected parameter "auth".',
          },
          id: 1,
        },
      };
    }

    const authorization: string = Object.entries(request.headers)
      .filter(([name]: [string, string]): boolean => {
        return name.toLowerCase() === "authorization";
      })
      .map(([, value]: [string, string]): string => {
        return value;
      })[0] as string;

    if (authorization !== `Bearer ${this.token}`) {
      return refusal("Not authorized.");
    }

    const params: JSONObject = (body["params"] || {}) as JSONObject;

    this.calls.push({ method: body["method"] as string, params: params });

    if (body["method"] === "event.get") {
      return this.get(params);
    }

    if (body["method"] === "event.acknowledge") {
      return this.acknowledge(params);
    }

    return {
      status: 200,
      body: {
        jsonrpc: "2.0",
        error: {
          code: -32601,
          message: "Method not found.",
          data: `Incorrect API "${String(body["method"]).split(".")[0]}".`,
        },
        id: 1,
      },
    };
  }

  private get(params: JSONObject): ZabbixHttpReply {
    const ids: Array<string> = (
      (params["eventids"] as Array<JSONValue>) || []
    ).map((id: JSONValue): string => {
      return String(id);
    });
    const output: Array<string> = (params["output"] as Array<string>) || [];
    const related: Array<string> | undefined = params["selectRelatedObject"] as
      | Array<string>
      | undefined;

    const result: Array<JSONObject> = ids
      .map((id: string): FakeProblem | undefined => {
        return this.problems.get(id);
      })
      .filter((problem: FakeProblem | undefined): problem is FakeProblem => {
        return Boolean(problem);
      })
      .map((problem: FakeProblem): JSONObject => {
        const event: JSONObject = {};

        for (const field of output) {
          event[field] = (problem as unknown as JSONObject)[field] as string;
        }

        if (related) {
          const trigger: JSONObject = {};

          for (const field of related) {
            trigger[field] =
              field === "triggerid" ? problem.triggerid : problem.manual_close;
          }

          event["relatedObject"] = trigger;
        }

        return event;
      });

    return { status: 200, body: { jsonrpc: "2.0", result: result, id: 1 } };
  }

  private acknowledge(params: JSONObject): ZabbixHttpReply {
    const action: number | null = integerOf(params["action"]);

    if (action === null) {
      return refusal('Invalid parameter "/action": an integer is expected.');
    }

    const ids: Array<string> = (
      (params["eventids"] as Array<JSONValue>) || []
    ).map((id: JSONValue): string => {
      return String(id);
    });
    const problems: Array<FakeProblem> = [];

    for (const id of ids) {
      const problem: FakeProblem | undefined = this.problems.get(id);

      if (!problem) {
        return refusal(
          "No permissions to referred object or it does not exist!",
        );
      }

      problems.push(problem);
    }

    const message: string =
      typeof params["message"] === "string" ? params["message"] : "";

    if ((action & 4) === 4 && message === "") {
      return refusal('Incorrect value for field "message": cannot be empty.');
    }

    if (message.length > 2048) {
      return refusal('Invalid parameter "/message": value is too long.');
    }

    if ((action & 1) === 1) {
      for (const problem of problems) {
        if (problem.manual_close !== "1") {
          return refusal(
            "Cannot close problem: trigger does not allow manual closing.",
          );
        }
      }

      if (!this.canClose) {
        return refusal(
          "No permissions to referred object or it does not exist!",
        );
      }
    }

    for (const problem of problems) {
      // Already done is skipped, not refused.
      if ((action & 2) === 2 && problem.acknowledged === "0") {
        problem.acknowledged = "1";
      }

      if ((action & 4) === 4) {
        problem.messages.push(message);
      }

      if ((action & 1) === 1 && problem.r_eventid === "0") {
        this.nextEventId++;
        problem.r_eventid = String(this.nextEventId);
      }
    }

    return {
      status: 200,
      body: { jsonrpc: "2.0", result: { eventids: ids }, id: 1 },
    };
  }
}

/* ------------------------------ OneUptime's side ------------------------------ */

export function objectIdJson(value: string): JSONObject {
  return { _type: "ObjectID", value: value };
}

// A state as Find Many hands it back: a JSON object, with the fields a template reads.
export interface StateFixture extends JSONObject {
  _id: string;
  name: string;
  order: number;
  isAcknowledgedState: boolean;
  isResolvedState: boolean;
}

/*
 * Everything that differs between an incident and an alert, for tests that
 * run the incident and the alert version of a template alike.
 */
export interface ZabbixKindFixture {
  noun: "incident" | "alert";
  Noun: string;
  Plural: string;
  // How the template words making one: an incident is declared, an alert created.
  created: string;
  Created: string;
  recordId: string;
  number: string;
  numberField: string;
  severityIdColumn: string;
  stateRelation: string;
  idColumn: string;
  timelineStateColumn: string;
  severities: Array<JSONObject>;
  states: Array<StateFixture>;
  problemTemplateId: string;
  stateTemplateId: string;
  noteTemplateId: string;
  // The fields a new record from a Zabbix problem gets besides its own: an incident is kept off status pages.
  quietFields: JSONObject;
}

function statesOf(prefix: string): Array<StateFixture> {
  // In the order Find Many hands them back: none in particular.
  return [
    {
      _id: `${prefix}-0000-4000-8000-000000000003`,
      name: "Resolved",
      order: 3,
      isAcknowledgedState: false,
      isResolvedState: true,
    },
    {
      _id: `${prefix}-0000-4000-8000-000000000001`,
      name: "Created",
      order: 1,
      isAcknowledgedState: false,
      isResolvedState: false,
    },
    {
      _id: `${prefix}-0000-4000-8000-000000000002`,
      name: "Acknowledged",
      order: 2,
      isAcknowledgedState: true,
      isResolvedState: false,
    },
  ];
}

export const INCIDENT: ZabbixKindFixture = {
  noun: "incident",
  Noun: "Incident",
  Plural: "Incidents",
  created: "declared",
  Created: "Declared",
  recordId: "3f0e2a4c-5b6d-4e7f-8a9b-0c1d2e3f4a5b",
  number: "INC-42",
  numberField: "incidentNumberWithPrefix",
  severityIdColumn: "incidentSeverityId",
  stateRelation: "currentIncidentState",
  idColumn: "incidentId",
  timelineStateColumn: "incidentStateId",
  // A new project's three, out of order.
  severities: [
    {
      _id: "bbbbbbbb-0000-4000-8000-000000000003",
      name: "Minor Incident",
      order: 3,
    },
    {
      _id: "bbbbbbbb-0000-4000-8000-000000000001",
      name: "Critical Incident",
      order: 1,
    },
    {
      _id: "bbbbbbbb-0000-4000-8000-000000000002",
      name: "Major Incident",
      order: 2,
    },
  ],
  states: statesOf("aaaaaaaa"),
  problemTemplateId: "zabbix-declare-incident-from-problem",
  stateTemplateId: "zabbix-update-problem-on-incident-state",
  noteTemplateId: "zabbix-message-from-incident-private-note",
  quietFields: {
    isVisibleOnStatusPage: false,
    shouldStatusPageSubscribersBeNotifiedOnIncidentCreated: false,
  },
};

export const ALERT: ZabbixKindFixture = {
  noun: "alert",
  Noun: "Alert",
  Plural: "Alerts",
  created: "created",
  Created: "Created",
  recordId: "5d6e7f80-1a2b-4c3d-8e4f-5a6b7c8d9e0f",
  number: "ALT-7",
  numberField: "alertNumberWithPrefix",
  severityIdColumn: "alertSeverityId",
  stateRelation: "currentAlertState",
  idColumn: "alertId",
  timelineStateColumn: "alertStateId",
  // A new project's two, out of order.
  severities: [
    { _id: "eeeeeeee-0000-4000-8000-000000000002", name: "Low", order: 2 },
    { _id: "eeeeeeee-0000-4000-8000-000000000001", name: "High", order: 1 },
  ],
  states: statesOf("dddddddd"),
  problemTemplateId: "zabbix-create-alert-from-problem",
  stateTemplateId: "zabbix-update-problem-on-alert-state",
  noteTemplateId: "zabbix-message-from-alert-private-note",
  quietFields: {},
};

export const KINDS: Array<ZabbixKindFixture> = [INCIDENT, ALERT];

export function stateNamed(
  kind: ZabbixKindFixture,
  name: string,
): StateFixture {
  const state: StateFixture | undefined = kind.states.find(
    (candidate: StateFixture): boolean => {
      return candidate.name === name;
    },
  );

  if (!state) {
    throw new Error(`No ${kind.noun} state ${name}`);
  }

  return state;
}

export interface RecordProps {
  state?: string | undefined;
  eventId?: string | null | undefined;
  isPrivate?: boolean | undefined;
}

/*
 * The record a problem opened, as a Find One or an On Update trigger hands
 * it over: its number, its state, and the problem's event ID in its custom
 * fields. An eventId of null is a record no Zabbix problem opened.
 */
export function recordModel(
  kind: ZabbixKindFixture,
  props: RecordProps = {},
): JSONObject {
  const state: StateFixture = stateNamed(kind, props.state || "Created");
  const model: JSONObject = {
    _id: kind.recordId,
    [kind.numberField]: kind.number,
    customFields:
      props.eventId === null
        ? {}
        : { [ZABBIX_EVENT_ID_CUSTOM_FIELD]: props.eventId || EVENT_ID },
    [kind.stateRelation]: {
      _id: state._id,
      name: state.name,
      order: state.order,
      isAcknowledgedState: state.isAcknowledgedState,
      isResolvedState: state.isResolvedState,
    },
  };

  if (props.isPrivate !== undefined) {
    model["isPrivate"] = props.isPrivate;
  }

  return model;
}

export interface NoteProps {
  note?: string | undefined;
  authorName?: string | null | undefined;
}

// A private note, as its On Create trigger hands it over.
export function noteModel(
  kind: ZabbixKindFixture,
  props: NoteProps = {},
): JSONObject {
  const model: JSONObject = {
    _id: "cccccccc-0000-4000-8000-000000000001",
    note:
      props.note === undefined
        ? "Rolled the checkout pods back to v4.1. Error rate is dropping."
        : props.note,
    [kind.idColumn]: objectIdJson(kind.recordId),
  };

  if (props.authorName !== null) {
    model["createdByUser"] = {
      name: { _type: "Name", value: props.authorName || "Jane Doe" },
    };
  }

  return model;
}

/* -------------------------------- Scripts -------------------------------- */

// The JavaScript a template ships for one of its steps.
export function scriptOf(templateId: string, componentId: string): string {
  const spec: { nodes: Array<JSONObject> } | null = getTemplateGraphSpec(
    templateId,
  ) as unknown as { nodes: Array<JSONObject> } | null;

  const node: JSONObject | undefined = spec?.nodes.find(
    (candidate: JSONObject): boolean => {
      return (
        candidate["componentId"] === componentId &&
        (candidate["metadataId"] === ComponentID.JavaScriptCode ||
          candidate["metadataId"] === ComponentID.JavaScriptCheck)
      );
    },
  );

  if (!node) {
    throw new Error(
      `Template ${templateId} has no script step ${componentId}.`,
    );
  }

  return (node["args"] as JSONObject)["code"] as string;
}

/*
 * Runs a template's script in the isolated-vm sandbox the workflow runner
 * uses. A script that throws fails the test, unless the test asks for what
 * it threw.
 */
export async function runZabbixScript(data: {
  templateId: string;
  componentId: string;
  args: JSONValue;
  editCode?: ((code: string) => string) | undefined;
}): Promise<JSONObject> {
  let code: string = scriptOf(data.templateId, data.componentId);

  if (data.editCode) {
    const edited: string = data.editCode(code);

    if (edited === code) {
      throw new Error("editCode did not change the script.");
    }

    code = edited;
  }

  const result: ReturnResult = await VMRunner.runCodeInSandbox({
    code: code,
    options: { args: data.args as JSONObject, timeout: 5000 },
  });

  if (result.scriptError) {
    throw result.scriptError;
  }

  return result.returnValue as JSONObject;
}

/*
 * What a script receives for a step output quoted into its JSON arguments:
 * the runtime pretty-prints the object and substitutes it as a JSON string.
 */
export function quoted(value: JSONValue): string {
  return JSON.stringify(value, null, 2);
}

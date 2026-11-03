/*
 * Shared fixtures for the Datadog and New Relic template tests.
 *
 * Datadog's side is what its Webhooks integration posts with the payload
 * the templates' read step says to paste (DATADOG_WEBHOOK_PAYLOAD): each of
 * Datadog's template variables filled in as Datadog fills it for one
 * notification of a monitor (datadogVariableValues), then the payload
 * written with them (datadogPostedBody).
 *
 * New Relic's side is what a New Relic workflow's webhook posts with the
 * payload New Relic fills in by default, and isAcknowledged when a test
 * gives it - the one field the templates ask a payload to add
 * (newRelicPostedBody).
 *
 * Not a test file itself (jest only collects *.test.ts).
 */

import VMRunner from "../../../Server/Utils/VM/VMRunner";
import ReturnResult from "../../../Types/IsolatedVM/ReturnResult";
import { JSONObject, JSONValue } from "../../../Types/JSON";
import ComponentID from "../../../Types/Workflow/ComponentID";
import {
  DATADOG_WEBHOOK_PAYLOAD,
  DatadogTransition,
  NewRelicIssueState,
  getTemplateGraphSpec,
} from "../../../Types/Workflow/Templates";

/* ------------------------------- The templates ------------------------------- */

export interface AlertingToolKind {
  noun: "incident" | "alert";
  Noun: string;
  // How the record's description starts: "Declared", "Created".
  Created: string;
  // How the From Another Tool step says it made one: "Opened", "Created".
  Opened: string;
  datadogTemplateId: string;
  newRelicTemplateId: string;
  // The From Another Tool step's component id.
  step: string;
  // What the test project's most severe, middle and least severe severities are called.
  severities: [string, string, string];
  // The first number the test project gives a record of this kind.
  firstNumber: string;
  secondNumber: string;
}

export const INCIDENT: AlertingToolKind = {
  noun: "incident",
  Noun: "Incident",
  Created: "Declared",
  Opened: "Opened",
  datadogTemplateId: "datadog-declare-incident-from-monitor",
  newRelicTemplateId: "new-relic-declare-incident-from-issue",
  step: "incident-from-another-tool-1",
  severities: ["Critical Incident", "Major Incident", "Minor Incident"],
  firstNumber: "INC-1",
  secondNumber: "INC-2",
};

export const ALERT: AlertingToolKind = {
  noun: "alert",
  Noun: "Alert",
  Created: "Created",
  Opened: "Created",
  datadogTemplateId: "datadog-create-alert-from-monitor",
  newRelicTemplateId: "new-relic-create-alert-from-issue",
  step: "alert-from-another-tool-1",
  // A new project's alerts have two severities: the middle place is the less severe of them.
  severities: ["High", "Low", "Low"],
  firstNumber: "ALT-1",
  secondNumber: "ALT-2",
};

export const KINDS: Array<AlertingToolKind> = [INCIDENT, ALERT];

// The component id of the step that reads what the tool posted, in both tools' templates.
export const READ_STEP: string = "read-event-1";

/* --------------------------------- Datadog --------------------------------- */

export const ALERT_CYCLE_KEY: string = "7151157925468446720";
export const OTHER_ALERT_CYCLE_KEY: string = "7151157925468446721";
export const DATADOG_LINK: string =
  "https://app.datadoghq.com/event/event?id=7151157925468446720";

export interface DatadogNotificationProps {
  transition?: string | undefined;
  alertCycleKey?: string | undefined;
  // "" for a monitor with no priority.
  priority?: string | undefined;
  title?: string | undefined;
  body?: string | undefined;
  host?: string | undefined;
  scope?: string | undefined;
  link?: string | undefined;
}

/*
 * What Datadog fills each variable of the payload with, for one
 * notification of a monitor named "High CPU on {{host.name}}". Datadog
 * starts the notification's title with the monitor's priority, when it has
 * one, and with what happened and to which group.
 */
export function datadogVariableValues(
  props: DatadogNotificationProps = {},
): Record<string, string> {
  const transition: string = props.transition ?? DatadogTransition.Triggered;
  const priority: string = props.priority ?? "P1";
  const host: string = props.host ?? "web-1";

  return {
    $ALERT_CYCLE_KEY: props.alertCycleKey ?? ALERT_CYCLE_KEY,
    $ALERT_TRANSITION: transition,
    $ALERT_PRIORITY: priority,
    $EVENT_TITLE:
      props.title ??
      `${priority ? `[${priority}] ` : ""}[${transition} on {host:${host}}] High CPU on ${host}`,
    $TEXT_ONLY_MSG:
      props.body ??
      `CPU on ${host} has been above 90% for 5 minutes.\n\nRunbook: restart the checkout pods.`,
    $HOSTNAME: host,
    $ALERT_SCOPE: props.scope ?? `host:${host}`,
    $LINK: props.link ?? DATADOG_LINK,
  };
}

// What Datadog posts: the templates' payload, with each of its variables filled in.
export function datadogPostedBody(
  props: DatadogNotificationProps = {},
): JSONObject {
  const values: Record<string, string> = datadogVariableValues(props);
  const body: JSONObject = {};

  for (const [key, variable] of Object.entries(DATADOG_WEBHOOK_PAYLOAD)) {
    body[key] = values[variable] ?? "";
  }

  return body;
}

/* -------------------------------- New Relic -------------------------------- */

export const ISSUE_ID: string = "7d4a2e1c-3b5f-4c8e-9a1d-2f6b8c0e4a71";
export const OTHER_ISSUE_ID: string = "0b6f9d2a-8e4c-4a7b-b1d3-5c2e9f8a6b14";
export const NEW_RELIC_LINK: string = `https://radar-api.service.newrelic.com/accounts/1234567/issues/${ISSUE_ID}?notifier=WEBHOOK`;

export interface NewRelicNotificationProps {
  issueId?: string | undefined;
  state?: string | undefined;
  // Left out of the payload unless given, as New Relic's default payload leaves it out.
  isAcknowledged?: JSONValue | undefined;
  priority?: string | undefined;
  title?: string | undefined;
  issueUrl?: string | undefined;
  entities?: JSONValue | undefined;
  policies?: JSONValue | undefined;
  conditions?: JSONValue | undefined;
}

/*
 * What a New Relic workflow's webhook posts for an issue with the payload
 * New Relic fills in by default, and isAcknowledged when it is given.
 */
export function newRelicPostedBody(
  props: NewRelicNotificationProps = {},
): JSONObject {
  // A list given as null is posted as null: only a list left out takes the default.
  const listOr: (
    given: JSONValue | undefined,
    list: Array<string>,
  ) => JSONValue = (
    given: JSONValue | undefined,
    list: Array<string>,
  ): JSONValue => {
    return given === undefined ? list : given;
  };

  return {
    id: props.issueId ?? ISSUE_ID,
    issueUrl: props.issueUrl ?? NEW_RELIC_LINK,
    title: props.title ?? "High CPU on checkout-service",
    priority: props.priority ?? "CRITICAL",
    impactedEntities: listOr(props.entities, [
      "checkout-service",
      "checkout-db",
    ]),
    totalIncidents: 1,
    state: props.state ?? NewRelicIssueState.Activated,
    trigger: "STATE_CHANGE",
    isCorrelated: false,
    createdAt: 1730000000000,
    updatedAt: 1730000060000,
    sources: ["newrelic"],
    alertPolicyNames: listOr(props.policies, ["Production"]),
    alertConditionNames: listOr(props.conditions, ["CPU above 90%"]),
    workflowName: "OneUptime",
    ...(props.isAcknowledged !== undefined
      ? { isAcknowledged: props.isAcknowledged }
      : {}),
  };
}

/* ---------------------------------- Runs ---------------------------------- */

// What the Webhook trigger hands over for a request: its body, headers and query.
export function webhookDelivery(body: JSONValue): JSONObject {
  return {
    "request-body": body,
    "request-headers": { "content-type": "application/json" },
    "request-params": {},
  };
}

// The JavaScript a template ships for one of its steps.
export function scriptOf(
  templateId: string,
  componentId: string = READ_STEP,
): string {
  const spec: { nodes: Array<JSONObject> } | null = getTemplateGraphSpec(
    templateId,
  ) as unknown as { nodes: Array<JSONObject> } | null;

  const node: JSONObject | undefined = spec?.nodes.find(
    (candidate: JSONObject): boolean => {
      return (
        candidate["componentId"] === componentId &&
        candidate["metadataId"] === ComponentID.JavaScriptCheck
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
 * What a script receives for a step output quoted into its JSON arguments:
 * the runtime pretty-prints the object and substitutes it as a JSON string.
 */
export function quoted(value: JSONValue): string {
  return JSON.stringify(value, null, 2);
}

/*
 * Runs a template's read step in the isolated-vm sandbox the workflow
 * runner uses, on what the tool posted, handed over as the runtime hands it:
 * the request's body quoted into the step's arguments. A script that throws
 * fails the test.
 */
export async function runReadScript(data: {
  templateId: string;
  payload: JSONValue;
  // The payload as the object itself, rather than the JSON text the runtime substitutes.
  asObject?: boolean | undefined;
  editCode?: ((code: string) => string) | undefined;
}): Promise<JSONObject> {
  let code: string = scriptOf(data.templateId);

  if (data.editCode) {
    const edited: string = data.editCode(code);

    if (edited === code) {
      throw new Error("editCode did not change the script.");
    }

    code = edited;
  }

  const result: ReturnResult = await VMRunner.runCodeInSandbox({
    code: code,
    options: {
      args: {
        payload: data.asObject ? data.payload : quoted(data.payload),
      } as JSONObject,
      timeout: 5000,
    },
  });

  if (result.scriptError) {
    throw result.scriptError;
  }

  return result.returnValue as JSONObject;
}

import { DatabaseBaseModelType } from "../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Alert from "../../Models/DatabaseModels/Alert";
import AlertInternalNote from "../../Models/DatabaseModels/AlertInternalNote";
import AlertStateTimeline from "../../Models/DatabaseModels/AlertStateTimeline";
import Incident from "../../Models/DatabaseModels/Incident";
import IncidentInternalNote from "../../Models/DatabaseModels/IncidentInternalNote";
import IncidentOwnerTeam from "../../Models/DatabaseModels/IncidentOwnerTeam";
import IncidentPublicNote from "../../Models/DatabaseModels/IncidentPublicNote";
import IncidentSeverity from "../../Models/DatabaseModels/IncidentSeverity";
import IncidentStateTimeline from "../../Models/DatabaseModels/IncidentStateTimeline";
import IncomingCallPolicy from "../../Models/DatabaseModels/IncomingCallPolicy";
import IncomingCallPolicyEscalationRule from "../../Models/DatabaseModels/IncomingCallPolicyEscalationRule";
import AlertSeverity from "../../Models/DatabaseModels/AlertSeverity";
import Monitor from "../../Models/DatabaseModels/Monitor";
import MonitorGroupResource from "../../Models/DatabaseModels/MonitorGroupResource";
import MonitorOwnerTeam from "../../Models/DatabaseModels/MonitorOwnerTeam";
import MonitorStatusTimeline from "../../Models/DatabaseModels/MonitorStatusTimeline";
import OnCallDutyPolicy from "../../Models/DatabaseModels/OnCallDutyPolicy";
import OnCallDutyPolicyEscalationRule from "../../Models/DatabaseModels/OnCallDutyPolicyEscalationRule";
import OnCallDutyPolicyEscalationRuleSchedule from "../../Models/DatabaseModels/OnCallDutyPolicyEscalationRuleSchedule";
import OnCallDutyPolicyEscalationRuleTeam from "../../Models/DatabaseModels/OnCallDutyPolicyEscalationRuleTeam";
import OnCallDutyPolicySchedule from "../../Models/DatabaseModels/OnCallDutyPolicySchedule";
import OnCallDutyPolicyScheduleLayer from "../../Models/DatabaseModels/OnCallDutyPolicyScheduleLayer";
import OnCallDutyPolicyScheduleLayerUser from "../../Models/DatabaseModels/OnCallDutyPolicyScheduleLayerUser";
import ScheduledMaintenancePublicNote from "../../Models/DatabaseModels/ScheduledMaintenancePublicNote";
import ScheduledMaintenanceStateTimeline from "../../Models/DatabaseModels/ScheduledMaintenanceStateTimeline";
import StatusPage from "../../Models/DatabaseModels/StatusPage";
import StatusPageAnnouncement from "../../Models/DatabaseModels/StatusPageAnnouncement";
import StatusPageGroup from "../../Models/DatabaseModels/StatusPageGroup";
import StatusPageResource from "../../Models/DatabaseModels/StatusPageResource";
import StatusPageSubscriber from "../../Models/DatabaseModels/StatusPageSubscriber";
import Team from "../../Models/DatabaseModels/Team";
import TeamMember from "../../Models/DatabaseModels/TeamMember";
import Recurring from "../../Types/Events/Recurring";
import EventInterval from "../../Types/Events/EventInterval";
import { JSONValue } from "../../Types/JSON";
import MonitorType from "../../Types/Monitor/MonitorType";
import RestrictionTimes from "../../Types/OnCallDutyPolicy/RestrictionTimes";
import PositiveNumber from "../../Types/PositiveNumber";
import { DeveloperDocsLivePick } from "./LiveData";

/*
 * What the Developer pages know about each resource beyond its metadata:
 * the fields most people set (in the order they read best, with realistic
 * values and a few plain words on each), the change people make most, the
 * filters they reach for, and the recipes and tasks that come up again and
 * again (an incident's owner team, a status page's groups, acknowledging an
 * alert over the API).
 *
 * Every field here is a model column, and the generators turn it into the
 * provider attribute or API field the metadata says it is, so nothing here
 * names a Terraform attribute or a URL directly. Values point at the
 * project's own records where they can (`live`), so an example declares an
 * incident with one of the project's severities, not a placeholder.
 *
 * Common/Tests/Utils/DeveloperDocs/ResourceProfiles.test.ts holds every
 * profile to the models, the provider-schema mirror and the API's own
 * request schemas: a renamed column, a field that cannot be created, or a
 * query the server would refuse fails there.
 */

// What an example sets a field to.
export type DeveloperDocsValue =
  // A fixed value, as the API takes it.
  | { kind: "literal"; value: JSONValue }
  /*
   * One of the project's records: its id (a list of one id with `list`),
   * named in a comment. `tableName` defaults to the model the column points
   * at.
   */
  | {
      kind: "live";
      tableName?: string | undefined;
      pick?: DeveloperDocsLivePick | undefined;
      list?: boolean | undefined;
    }
  // The name of one of the project's records (to look it up by name).
  | {
      kind: "liveName";
      tableName: string;
      pick?: DeveloperDocsLivePick | undefined;
      fallback: string;
    }
  // The record the page is about (its id, or a list of it).
  | { kind: "this"; list?: boolean | undefined }
  // The name of the record the page is about.
  | { kind: "thisName"; fallback: string }
  // The person reading the page.
  | { kind: "me" }
  /*
   * A moment relative to when the page is read: `days` from today (or the
   * next `weekday`, 0 for Sunday), at `hour`:`minute` UTC. With neither, now.
   */
  | {
      kind: "date";
      days?: number | undefined;
      weekday?: number | undefined;
      hour?: number | undefined;
      minute?: number | undefined;
    }
  /*
   * A monitor's steps with the criteria a new monitor of this type starts
   * with in the dashboard (MonitorSteps.getDefaultMonitorSteps), wired to
   * the project's own statuses and severities.
   */
  | {
      kind: "monitorSteps";
      monitorType: MonitorType;
      destination?:
        | { type: "URL" | "Hostname" | "IP"; value: string }
        | undefined;
      requestHeaders?: Record<string, string> | undefined;
    }
  // Another block of the same recipe (Terraform only): its id.
  | { kind: "ref"; block: string; list?: boolean | undefined };

export interface DeveloperDocsField {
  column: string;
  /*
   * What the example sets. By default: one of the project's records for a
   * column that points at one, otherwise the column's documented example or
   * default.
   */
  value?: DeveloperDocsValue | undefined;
  // What the field is for, in a few plain words. By default the column's own description.
  about?: string | undefined;
}

export type DeveloperDocsQueryOperator =
  | "equals"
  | "notEqual"
  | "search"
  | "greaterThan"
  | "includes";

export interface DeveloperDocsQueryPart {
  column: string;
  operator: DeveloperDocsQueryOperator;
  value: DeveloperDocsValue;
}

export interface DeveloperDocsSort {
  column: string;
  order: "ASC" | "DESC";
}

/*
 * A list filter on the API page. `{name}` in the description is replaced
 * with the name of the record the filter uses.
 */
export interface DeveloperDocsFilter {
  title: string;
  description: string;
  query: Array<DeveloperDocsQueryPart>;
  sort?: DeveloperDocsSort | undefined;
}

export type DeveloperDocsScopeName = "list" | "view";

// One resource block of a recipe.
export interface DeveloperDocsRecipeBlock {
  // How other blocks of the recipe refer to this one.
  id: string;
  modelType: DatabaseBaseModelType;
  // A data source looks an existing record up by name instead of creating one.
  kind?: "resource" | "data" | undefined;
  // The block's Terraform name; by default made from its name field.
  localName?: string | undefined;
  fields: Array<DeveloperDocsField>;
}

// A Terraform recipe: a few resources that are often set up together.
export interface DeveloperDocsRecipe {
  title: string;
  description: string;
  // The pages it is on: a type's list, one record's page, or both.
  scopes: Array<DeveloperDocsScopeName>;
  blocks: Array<DeveloperDocsRecipeBlock>;
}

/*
 * An API request on a related resource that people make for this one:
 * acknowledging an incident is creating a state timeline entry for it.
 */
export interface DeveloperDocsTask {
  title: string;
  description: string;
  scopes: Array<DeveloperDocsScopeName>;
  modelType: DatabaseBaseModelType;
  operation: "create" | "list";
  fields?: Array<DeveloperDocsField> | undefined;
  query?: Array<DeveloperDocsQueryPart> | undefined;
  select?: Array<string> | undefined;
  sort?: DeveloperDocsSort | undefined;
}

export interface DeveloperDocsUpdate {
  description: string;
  fields: Array<DeveloperDocsField>;
}

export interface DeveloperDocsProfile {
  // The create step's title: "Declare an incident". By default "Create a(n) <name>".
  createTitle?: string | undefined;
  // A note with the create step: who usually makes these, what to set first.
  createNote?: string | undefined;
  /*
   * Why Terraform should not create these (it can still import and manage
   * the ones that exist): OneUptime works out a field itself on create, so
   * the value Terraform sent would never match.
   */
  terraformCannotCreate?: string | undefined;
  // The fields most people set, in reading order. Required fields always come too.
  fields: Array<DeveloperDocsField | string>;
  // Fields a read or list asks for, besides the id. By default the plain fields above.
  readFields?: Array<string> | undefined;
  // The change the "Change it" example makes. By default a new description.
  update?: DeveloperDocsUpdate | undefined;
  filters?: Array<DeveloperDocsFilter> | undefined;
  recipes?: Array<DeveloperDocsRecipe> | undefined;
  tasks?: Array<DeveloperDocsTask> | undefined;
}

// Helpers that keep the profiles below readable.
function literal(value: JSONValue): DeveloperDocsValue {
  return { kind: "literal", value };
}

function live(
  pick?: DeveloperDocsLivePick | undefined,
  tableName?: string | undefined,
): DeveloperDocsValue {
  return { kind: "live", tableName, pick };
}

function liveList(tableName?: string | undefined): DeveloperDocsValue {
  return { kind: "live", tableName, list: true };
}

const THIS: DeveloperDocsValue = { kind: "this" };
const THIS_LIST: DeveloperDocsValue = { kind: "this", list: true };
const ME: DeveloperDocsValue = { kind: "me" };

function ref(block: string, list?: boolean): DeveloperDocsValue {
  return { kind: "ref", block, list };
}

function field(
  column: string,
  value?: DeveloperDocsValue | undefined,
  about?: string | undefined,
): DeveloperDocsField {
  return { column, value, about };
}

// Plain words for columns many resources share.
export const COMMON_FIELD_ABOUT: Readonly<Record<string, string>> = {
  name: "What it is called in OneUptime.",
  description: "A few words on what it is for.",
  labels: "Labels to find and filter it by.",
  isEnabled: "Whether it is on.",
};

// A weekly rotation, as the schedule layer's `rotation` column takes it.
function weeklyRotation(): JSONValue {
  const rotation: Recurring = Recurring.getDefault();
  rotation.intervalType = EventInterval.Week;
  rotation.intervalCount = new PositiveNumber(1);
  return rotation.toJSON() as JSONValue;
}

const NOT_RESOLVED_INCIDENT_FILTER: DeveloperDocsFilter = {
  title: "Not resolved",
  description:
    "Incidents that have not reached the {name} state, newest first.",
  query: [
    {
      column: "currentIncidentStateId",
      operator: "notEqual",
      value: live({ flag: "isResolvedState" }),
    },
  ],
  sort: { column: "declaredAt", order: "DESC" },
};

export const DEVELOPER_DOCS_PROFILES: Readonly<
  Record<string, DeveloperDocsProfile>
> = {
  Monitor: {
    fields: [
      field("name", literal("Website"), "What the monitor is called."),
      field(
        "description",
        literal("Checks that the home page loads."),
        "What it checks, for whoever is paged.",
      ),
      field(
        "monitorType",
        literal(MonitorType.Website),
        "What kind of check it runs: Website, API, Ping, Port, SSL Certificate, Manual, and more. It cannot be changed later.",
      ),
      field(
        "monitorSteps",
        {
          kind: "monitorSteps",
          monitorType: MonitorType.Website,
          destination: { type: "URL", value: "https://example.com" },
        },
        "What to check, and the criteria that decide its status and open incidents. These are the criteria a new website monitor starts with, using this project's statuses and severities.",
      ),
      field(
        "monitoringInterval",
        literal("*/5 * * * *"),
        "How often it checks, as a cron expression: every 5 minutes here.",
      ),
      "labels",
    ],
    readFields: [
      "name",
      "description",
      "monitorType",
      "currentMonitorStatusId",
      "disableActiveMonitoring",
      "createdAt",
    ],
    update: {
      description:
        "Pause its checks, during a deploy for example. Send false to start them again. Fields you leave out stay as they are.",
      fields: [field("disableActiveMonitoring", literal(true))],
    },
    filters: [
      {
        title: "Not operational",
        description: "Monitors whose status is not {name} right now.",
        query: [
          {
            column: "currentMonitorStatusId",
            operator: "notEqual",
            value: live({ flag: "isOperationalState" }),
          },
        ],
      },
      {
        title: "By type",
        description: "Only website monitors.",
        query: [
          {
            column: "monitorType",
            operator: "equals",
            value: literal(MonitorType.Website),
          },
        ],
      },
      {
        title: "With a label",
        description: "Monitors labelled {name}.",
        query: [{ column: "labels", operator: "includes", value: liveList() }],
      },
      {
        title: "Search",
        description: "Monitors whose name mentions “api”.",
        query: [{ column: "name", operator: "search", value: literal("api") }],
      },
    ],
    recipes: [
      {
        title: "API monitor",
        description:
          "Calls an API and expects a successful answer. Add request headers and a body as the API needs them.",
        scopes: ["list"],
        blocks: [
          {
            id: "monitor",
            modelType: Monitor,
            fields: [
              field("name", literal("Orders API")),
              field("monitorType", literal(MonitorType.API)),
              field("monitorSteps", {
                kind: "monitorSteps",
                monitorType: MonitorType.API,
                destination: {
                  type: "URL",
                  value: "https://api.example.com/health",
                },
                requestHeaders: { Accept: "application/json" },
              }),
              field("monitoringInterval", literal("*/5 * * * *")),
            ],
          },
        ],
      },
      {
        title: "Ping a host",
        description: "Checks that a host answers ping.",
        scopes: ["list"],
        blocks: [
          {
            id: "monitor",
            modelType: Monitor,
            fields: [
              field("name", literal("Gateway")),
              field("monitorType", literal(MonitorType.Ping)),
              field("monitorSteps", {
                kind: "monitorSteps",
                monitorType: MonitorType.Ping,
                destination: { type: "Hostname", value: "gateway.example.com" },
              }),
              field("monitoringInterval", literal("*/5 * * * *")),
            ],
          },
        ],
      },
      {
        title: "Manual monitor",
        description:
          "Runs no checks: you set its status yourself, or from a workflow. Useful for a vendor you cannot check.",
        scopes: ["list"],
        blocks: [
          {
            id: "monitor",
            modelType: Monitor,
            fields: [
              field("name", literal("Payment provider")),
              field(
                "description",
                literal("Set by hand during the provider's incidents."),
              ),
              field("monitorType", literal(MonitorType.Manual)),
            ],
          },
        ],
      },
      {
        title: "Show it on a status page",
        description:
          "Adds this monitor to one of your status pages, where visitors see its status and uptime.",
        scopes: ["view"],
        blocks: [
          {
            id: "resource",
            modelType: StatusPageResource,
            localName: "on_status_page",
            fields: [
              field("statusPageId", live()),
              field("monitorId", THIS),
              field("displayName", { kind: "thisName", fallback: "Website" }),
            ],
          },
        ],
      },
      {
        title: "Add it to a monitor group",
        description:
          "A monitor group rolls the status of its monitors up into one.",
        scopes: ["view"],
        blocks: [
          {
            id: "member",
            modelType: MonitorGroupResource,
            localName: "in_monitor_group",
            fields: [field("monitorGroupId", live()), field("monitorId", THIS)],
          },
        ],
      },
      {
        title: "Make a team its owner",
        description:
          "Owners are told about its incidents and alerts, and can be paged.",
        scopes: ["view"],
        blocks: [
          {
            id: "owner",
            modelType: MonitorOwnerTeam,
            localName: "owner_team",
            fields: [field("teamId", live()), field("monitorId", THIS)],
          },
        ],
      },
    ],
    tasks: [
      {
        title: "Status history",
        description: "Its status changes, newest first.",
        scopes: ["view"],
        modelType: MonitorStatusTimeline,
        operation: "list",
        query: [{ column: "monitorId", operator: "equals", value: THIS }],
        select: ["monitorStatusId", "startsAt", "endsAt"],
        sort: { column: "startsAt", order: "DESC" },
      },
      {
        title: "Its incidents",
        description: "The incidents that affect it, newest first.",
        scopes: ["view"],
        modelType: Incident,
        operation: "list",
        query: [{ column: "monitors", operator: "includes", value: THIS_LIST }],
        select: [
          "title",
          "incidentSeverityId",
          "currentIncidentStateId",
          "declaredAt",
        ],
        sort: { column: "declaredAt", order: "DESC" },
      },
    ],
  },

  MonitorGroup: {
    fields: [
      field("name", literal("Checkout")),
      field("description", literal("Everything checkout depends on.")),
      "labels",
    ],
    recipes: [
      {
        title: "Add a monitor",
        description:
          "The group's status follows the worst status among its monitors.",
        scopes: ["view"],
        blocks: [
          {
            id: "member",
            modelType: MonitorGroupResource,
            localName: "member",
            fields: [field("monitorGroupId", THIS), field("monitorId", live())],
          },
        ],
      },
    ],
    tasks: [
      {
        title: "Its monitors",
        description: "The monitors in this group.",
        scopes: ["view"],
        modelType: MonitorGroupResource,
        operation: "list",
        query: [{ column: "monitorGroupId", operator: "equals", value: THIS }],
        select: ["monitorId"],
      },
    ],
  },

  Incident: {
    createTitle: "Declare an incident",
    createNote:
      "This declares a real incident: its owners, on-call policies and status page subscribers are told, just as when you declare one in the dashboard. Most incidents are declared by monitors; declare them yourself for drills, or from your own tooling.",
    fields: [
      field(
        "title",
        literal("Checkout requests are failing"),
        "What is wrong, in a few words. Status pages show it.",
      ),
      field(
        "description",
        literal(
          "Customers see an error when they pay. We are looking into it.",
        ),
        "More detail, in Markdown. Status pages show it too.",
      ),
      field(
        "incidentSeverityId",
        undefined,
        "How bad it is: one of your incident severities.",
      ),
      field(
        "monitors",
        undefined,
        "The monitors it affects. Status pages that show them show the incident.",
      ),
      field(
        "changeMonitorStatusToId",
        live({ withoutFlags: ["isOperationalState", "isOfflineState"] }),
        "The status those monitors move to while the incident is open.",
      ),
      "labels",
    ],
    readFields: [
      "title",
      "description",
      "incidentSeverityId",
      "currentIncidentStateId",
      "declaredAt",
      "createdAt",
    ],
    update: {
      description: "Move it to {name}. Fields you leave out stay as they are.",
      fields: [field("incidentSeverityId", live())],
    },
    filters: [
      NOT_RESOLVED_INCIDENT_FILTER,
      {
        title: "By severity",
        description: "Only {name} incidents.",
        query: [
          {
            column: "incidentSeverityId",
            operator: "equals",
            value: live(),
          },
        ],
      },
      {
        title: "By monitor",
        description: "Incidents that affect {name}.",
        query: [
          { column: "monitors", operator: "includes", value: liveList() },
        ],
      },
      {
        title: "Last 7 days",
        description: "Incidents declared in the last seven days.",
        query: [
          {
            column: "declaredAt",
            operator: "greaterThan",
            value: { kind: "date", days: -7, hour: 0 },
          },
        ],
        sort: { column: "declaredAt", order: "DESC" },
      },
      {
        title: "Search",
        description: "Incidents whose title mentions “database”.",
        query: [
          {
            column: "title",
            operator: "search",
            value: literal("database"),
          },
        ],
      },
    ],
    recipes: [
      {
        title: "Severity by name",
        description:
          "Look a severity up by its name instead of pasting its ID, so the configuration reads well and works in every project with a severity of that name.",
        scopes: ["list"],
        blocks: [
          {
            id: "severity",
            modelType: IncidentSeverity,
            kind: "data",
            fields: [
              field("name", {
                kind: "liveName",
                tableName: "IncidentSeverity",
                fallback: "Critical Incident",
              }),
            ],
          },
          {
            id: "incident",
            modelType: Incident,
            fields: [
              field("title", literal("Checkout requests are failing")),
              field("incidentSeverityId", ref("severity")),
            ],
          },
        ],
      },
      {
        title: "Owner team",
        description:
          "An incident's owners are told about it and about every change to it.",
        scopes: ["list"],
        blocks: [
          {
            id: "incident",
            modelType: Incident,
            fields: [
              field("title", literal("Checkout requests are failing")),
              field("incidentSeverityId", live()),
            ],
          },
          {
            id: "owner",
            modelType: IncidentOwnerTeam,
            localName: "checkout_owner",
            fields: [
              field("incidentId", ref("incident")),
              field("teamId", live()),
            ],
          },
        ],
      },
      {
        title: "Owner team",
        description:
          "Its owners are told about it and about every change to it.",
        scopes: ["view"],
        blocks: [
          {
            id: "owner",
            modelType: IncidentOwnerTeam,
            localName: "owner_team",
            fields: [field("incidentId", THIS), field("teamId", live())],
          },
        ],
      },
    ],
    tasks: [
      {
        title: "Acknowledge it",
        description:
          "Moves it to {name}, as the Acknowledge button does. Its owners and on-call policies are told.",
        scopes: ["view"],
        modelType: IncidentStateTimeline,
        operation: "create",
        fields: [
          field("incidentId", THIS),
          field("incidentStateId", live({ flag: "isAcknowledgedState" })),
        ],
      },
      {
        title: "Resolve it",
        description: "Moves it to {name}, as the Resolve button does.",
        scopes: ["view"],
        modelType: IncidentStateTimeline,
        operation: "create",
        fields: [
          field("incidentId", THIS),
          field("incidentStateId", live({ flag: "isResolvedState" })),
        ],
      },
      {
        title: "Internal note",
        description: "A note only your team sees.",
        scopes: ["view"],
        modelType: IncidentInternalNote,
        operation: "create",
        fields: [
          field("incidentId", THIS),
          field(
            "note",
            literal("Rolled back the 14:05 deploy. Error rates are dropping."),
          ),
        ],
      },
      {
        title: "Public update",
        description:
          "A note on the status pages that show it, sent to their subscribers.",
        scopes: ["view"],
        modelType: IncidentPublicNote,
        operation: "create",
        fields: [
          field("incidentId", THIS),
          field(
            "note",
            literal("We found the cause and are rolling out a fix."),
          ),
        ],
      },
    ],
  },

  IncidentEpisode: {
    fields: [
      field(
        "title",
        literal("Checkout outage"),
        "What the episode is about, in a few words.",
      ),
      field(
        "description",
        literal("Several checkout incidents with one cause."),
      ),
      field("incidentSeverityId", undefined, "How bad it is."),
      "labels",
    ],
    update: {
      description: "Move it to {name}. Fields you leave out stay as they are.",
      fields: [field("incidentSeverityId", live())],
    },
    tasks: [
      {
        title: "Its incidents",
        description: "The incidents grouped into this episode.",
        scopes: ["view"],
        modelType: Incident,
        operation: "list",
        query: [
          { column: "incidentEpisodeId", operator: "equals", value: THIS },
        ],
        select: ["title", "incidentSeverityId", "declaredAt"],
        sort: { column: "declaredAt", order: "DESC" },
      },
    ],
  },

  Alert: {
    createNote:
      "This creates a real alert: its owners and on-call policies are told, just as for an alert from a monitor.",
    fields: [
      field(
        "title",
        literal("High error rate on the orders API"),
        "What is wrong, in a few words.",
      ),
      field(
        "description",
        literal("More than 5% of requests failed in the last 5 minutes."),
        "More detail, in Markdown.",
      ),
      field(
        "alertSeverityId",
        undefined,
        "How bad it is: one of your alert severities.",
      ),
      field("monitorId", undefined, "The monitor it is about."),
      "labels",
    ],
    readFields: [
      "title",
      "description",
      "alertSeverityId",
      "currentAlertStateId",
      "monitorId",
      "createdAt",
    ],
    update: {
      description: "Move it to {name}. Fields you leave out stay as they are.",
      fields: [field("alertSeverityId", live())],
    },
    filters: [
      {
        title: "Not resolved",
        description: "Alerts that have not reached the {name} state.",
        query: [
          {
            column: "currentAlertStateId",
            operator: "notEqual",
            value: live({ flag: "isResolvedState" }),
          },
        ],
        sort: { column: "createdAt", order: "DESC" },
      },
      {
        title: "By severity",
        description: "Only {name} alerts.",
        query: [
          { column: "alertSeverityId", operator: "equals", value: live() },
        ],
      },
      {
        title: "By monitor",
        description: "Alerts about {name}.",
        query: [{ column: "monitorId", operator: "equals", value: live() }],
      },
      {
        title: "Search",
        description: "Alerts whose title mentions “cpu”.",
        query: [{ column: "title", operator: "search", value: literal("cpu") }],
      },
    ],
    recipes: [
      {
        title: "Severity by name",
        description:
          "Look a severity up by its name instead of pasting its ID.",
        scopes: ["list"],
        blocks: [
          {
            id: "severity",
            modelType: AlertSeverity,
            kind: "data",
            fields: [
              field("name", {
                kind: "liveName",
                tableName: "AlertSeverity",
                fallback: "High",
              }),
            ],
          },
          {
            id: "alert",
            modelType: Alert,
            fields: [
              field("title", literal("High error rate on the orders API")),
              field("alertSeverityId", ref("severity")),
            ],
          },
        ],
      },
    ],
    tasks: [
      {
        title: "Acknowledge it",
        description: "Moves it to {name}, as the Acknowledge button does.",
        scopes: ["view"],
        modelType: AlertStateTimeline,
        operation: "create",
        fields: [
          field("alertId", THIS),
          field("alertStateId", live({ flag: "isAcknowledgedState" })),
        ],
      },
      {
        title: "Resolve it",
        description: "Moves it to {name}, as the Resolve button does.",
        scopes: ["view"],
        modelType: AlertStateTimeline,
        operation: "create",
        fields: [
          field("alertId", THIS),
          field("alertStateId", live({ flag: "isResolvedState" })),
        ],
      },
      {
        title: "Internal note",
        description: "A note only your team sees.",
        scopes: ["view"],
        modelType: AlertInternalNote,
        operation: "create",
        fields: [
          field("alertId", THIS),
          field("note", literal("Restarted the worker. Watching the queue.")),
        ],
      },
    ],
  },

  AlertEpisode: {
    fields: [
      field(
        "title",
        literal("Orders API errors"),
        "What the episode is about, in a few words.",
      ),
      field("description", literal("Alerts from the orders API this morning.")),
      field("alertSeverityId", undefined, "How bad it is."),
      "labels",
    ],
    update: {
      description: "Move it to {name}. Fields you leave out stay as they are.",
      fields: [field("alertSeverityId", live())],
    },
    tasks: [
      {
        title: "Its alerts",
        description: "The alerts grouped into this episode.",
        scopes: ["view"],
        modelType: Alert,
        operation: "list",
        query: [{ column: "alertEpisodeId", operator: "equals", value: THIS }],
        select: ["title", "alertSeverityId", "createdAt"],
        sort: { column: "createdAt", order: "DESC" },
      },
    ],
  },

  ScheduledMaintenance: {
    createTitle: "Schedule maintenance",
    createNote:
      "Subscribers of the status pages it is on are told about it when it is created, again when it starts, and when it ends.",
    fields: [
      field(
        "title",
        literal("Database upgrade"),
        "What you are doing, in a few words. Status pages show it.",
      ),
      field(
        "description",
        literal("Writes pause for up to ten minutes while we upgrade."),
        "What people will notice, in Markdown.",
      ),
      field(
        "startsAt",
        { kind: "date", weekday: 6, hour: 2 },
        "When it starts, as an RFC 3339 time: next Saturday at 02:00 UTC here.",
      ),
      field("endsAt", { kind: "date", weekday: 6, hour: 4 }, "When it ends."),
      field("monitors", undefined, "The monitors it affects."),
      field("statusPages", undefined, "The status pages that announce it."),
      "labels",
    ],
    readFields: [
      "title",
      "startsAt",
      "endsAt",
      "currentScheduledMaintenanceStateId",
      "createdAt",
    ],
    update: {
      description:
        "Move it to another time: send the new start and end. Fields you leave out stay as they are.",
      fields: [
        field("startsAt", { kind: "date", weekday: 0, hour: 2 }),
        field("endsAt", { kind: "date", weekday: 0, hour: 4 }),
      ],
    },
    filters: [
      {
        title: "Upcoming",
        description: "Maintenance that starts after now, soonest first.",
        query: [
          {
            column: "startsAt",
            operator: "greaterThan",
            value: { kind: "date" },
          },
        ],
        sort: { column: "startsAt", order: "ASC" },
      },
      {
        title: "In progress",
        description: "Maintenance in the {name} state.",
        query: [
          {
            column: "currentScheduledMaintenanceStateId",
            operator: "equals",
            value: live({ flag: "isOngoingState" }),
          },
        ],
      },
      {
        title: "Search",
        description: "Maintenance whose title mentions “database”.",
        query: [
          { column: "title", operator: "search", value: literal("database") },
        ],
      },
    ],
    tasks: [
      {
        title: "Start it now",
        description: "Moves it to {name}, as the Mark Ongoing button does.",
        scopes: ["view"],
        modelType: ScheduledMaintenanceStateTimeline,
        operation: "create",
        fields: [
          field("scheduledMaintenanceId", THIS),
          field(
            "scheduledMaintenanceStateId",
            live({ flag: "isOngoingState" }),
          ),
        ],
      },
      {
        title: "End it",
        description: "Moves it to {name}.",
        scopes: ["view"],
        modelType: ScheduledMaintenanceStateTimeline,
        operation: "create",
        fields: [
          field("scheduledMaintenanceId", THIS),
          field("scheduledMaintenanceStateId", live({ flag: "isEndedState" })),
        ],
      },
      {
        title: "Public update",
        description:
          "A note on the status pages that show it, sent to their subscribers.",
        scopes: ["view"],
        modelType: ScheduledMaintenancePublicNote,
        operation: "create",
        fields: [
          field("scheduledMaintenanceId", THIS),
          field(
            "note",
            literal("The upgrade is going to plan. Writes are back."),
          ),
        ],
      },
    ],
  },

  StatusPage: {
    fields: [
      field("name", literal("Acme status"), "What it is called in OneUptime."),
      field(
        "description",
        literal("The status of everything our customers use."),
      ),
      field(
        "pageTitle",
        literal("Acme status"),
        "The title visitors and search engines see.",
      ),
      field(
        "pageDescription",
        literal("Live status and uptime of Acme's services."),
        "The description search engines show.",
      ),
      field(
        "isPublicStatusPage",
        literal(true),
        "Whether anyone can see it. A private page asks visitors to sign in.",
      ),
      field(
        "enableEmailSubscribers",
        literal(true),
        "Whether visitors can subscribe to updates by email.",
      ),
      "labels",
    ],
    readFields: [
      "name",
      "description",
      "pageTitle",
      "isPublicStatusPage",
      "createdAt",
    ],
    update: {
      description:
        "Make it private: only people you invite can see it. Fields you leave out stay as they are.",
      fields: [field("isPublicStatusPage", literal(false))],
    },
    filters: [
      {
        title: "Public pages",
        description: "Status pages anyone can see.",
        query: [
          {
            column: "isPublicStatusPage",
            operator: "equals",
            value: literal(true),
          },
        ],
      },
      {
        title: "Search",
        description: "Status pages whose name mentions “acme”.",
        query: [{ column: "name", operator: "search", value: literal("acme") }],
      },
    ],
    recipes: [
      {
        title: "Groups and monitors",
        description:
          "A status page shows monitors, in groups. This one has one group with one of your monitors in it.",
        scopes: ["list"],
        blocks: [
          {
            id: "page",
            modelType: StatusPage,
            fields: [
              field("name", literal("Acme status")),
              field("pageTitle", literal("Acme status")),
            ],
          },
          {
            id: "group",
            modelType: StatusPageGroup,
            fields: [
              field("statusPageId", ref("page")),
              field("name", literal("Core services")),
            ],
          },
          {
            id: "resource",
            modelType: StatusPageResource,
            localName: "website",
            fields: [
              field("statusPageId", ref("page")),
              field("statusPageGroupId", ref("group")),
              field("monitorId", live()),
              field("displayName", {
                kind: "liveName",
                tableName: "Monitor",
                fallback: "Website",
              }),
            ],
          },
        ],
      },
      {
        title: "Groups and monitors",
        description:
          "Adds a group to this status page, with one of your monitors in it.",
        scopes: ["view"],
        blocks: [
          {
            id: "group",
            modelType: StatusPageGroup,
            fields: [
              field("statusPageId", THIS),
              field("name", literal("Core services")),
            ],
          },
          {
            id: "resource",
            modelType: StatusPageResource,
            localName: "website",
            fields: [
              field("statusPageId", THIS),
              field("statusPageGroupId", ref("group")),
              field("monitorId", live()),
              field("displayName", {
                kind: "liveName",
                tableName: "Monitor",
                fallback: "Website",
              }),
            ],
          },
        ],
      },
      {
        title: "Announcement",
        description:
          "Shows a message at the top of this status page, from the time you choose.",
        scopes: ["view"],
        blocks: [
          {
            id: "announcement",
            modelType: StatusPageAnnouncement,
            fields: [
              field("title", literal("Maintenance on Saturday")),
              field(
                "description",
                literal("Writes pause for up to ten minutes from 02:00 UTC."),
              ),
              field("showAnnouncementAt", {
                kind: "date",
                days: 1,
                hour: 9,
              }),
              field("statusPages", THIS_LIST),
            ],
          },
        ],
      },
    ],
    tasks: [
      {
        title: "Post an announcement",
        description:
          "Shows a message at the top of this status page, and tells its subscribers.",
        scopes: ["view"],
        modelType: StatusPageAnnouncement,
        operation: "create",
        fields: [
          field("title", literal("Maintenance on Saturday")),
          field(
            "description",
            literal("Writes pause for up to ten minutes from 02:00 UTC."),
          ),
          field("showAnnouncementAt", { kind: "date", hour: 9, days: 1 }),
          field("statusPages", THIS_LIST),
        ],
      },
      {
        title: "Its subscribers",
        description: "Who gets this status page's updates.",
        scopes: ["view"],
        modelType: StatusPageSubscriber,
        operation: "list",
        query: [{ column: "statusPageId", operator: "equals", value: THIS }],
        select: ["subscriberEmail", "subscriberPhone", "createdAt"],
        sort: { column: "createdAt", order: "DESC" },
      },
    ],
  },

  StatusPageAnnouncement: {
    createTitle: "Post an announcement",
    createNote:
      "The subscribers of the status pages it is on are told about it when it is posted.",
    fields: [
      field("title", literal("Maintenance on Saturday"), "The headline."),
      field(
        "description",
        literal("Writes pause for up to ten minutes from 02:00 UTC."),
        "The message, in Markdown.",
      ),
      field("statusPages", undefined, "The status pages it shows on."),
      field(
        "showAnnouncementAt",
        { kind: "date", days: 1, hour: 9 },
        "When it starts showing.",
      ),
      field(
        "endAnnouncementAt",
        { kind: "date", days: 3, hour: 9 },
        "When it stops showing. Leave it out to show it until you end it.",
      ),
    ],
    update: {
      description:
        "End it now: it stops showing on the status pages. Fields you leave out stay as they are.",
      fields: [field("endAnnouncementAt", { kind: "date" })],
    },
  },

  OnCallDutyPolicy: {
    fields: [
      field("name", literal("Production on-call")),
      field("description", literal("Pages whoever is on call for production.")),
      field(
        "repeatPolicyIfNoOneAcknowledges",
        literal(true),
        "Start again from the first rule when nobody acknowledges.",
      ),
      field(
        "repeatPolicyIfNoOneAcknowledgesNoOfTimes",
        literal(2),
        "How many times to start again.",
      ),
      "labels",
    ],
    update: {
      description:
        "Start the policy again when nobody acknowledges, up to three times. Fields you leave out stay as they are.",
      fields: [
        field("repeatPolicyIfNoOneAcknowledges", literal(true)),
        field("repeatPolicyIfNoOneAcknowledgesNoOfTimes", literal(3)),
      ],
    },
    recipes: [
      {
        title: "Page a team",
        description:
          "A policy whose first rule pages one of your teams, and moves on after 5 minutes without an acknowledgement.",
        scopes: ["list"],
        blocks: [
          {
            id: "policy",
            modelType: OnCallDutyPolicy,
            fields: [field("name", literal("Production on-call"))],
          },
          {
            id: "rule",
            modelType: OnCallDutyPolicyEscalationRule,
            fields: [
              field("onCallDutyPolicyId", ref("policy")),
              field("name", literal("Page the on-call team")),
              field("escalateAfterInMinutes", literal(5)),
            ],
          },
          {
            id: "team",
            modelType: OnCallDutyPolicyEscalationRuleTeam,
            localName: "page_the_team",
            fields: [
              field("onCallDutyPolicyId", ref("policy")),
              field("onCallDutyPolicyEscalationRuleId", ref("rule")),
              field("teamId", live()),
            ],
          },
        ],
      },
      {
        title: "Page a team",
        description:
          "An escalation rule that pages one of your teams, and moves on after 5 minutes without an acknowledgement.",
        scopes: ["view"],
        blocks: [
          {
            id: "rule",
            modelType: OnCallDutyPolicyEscalationRule,
            fields: [
              field("onCallDutyPolicyId", THIS),
              field("name", literal("Page the on-call team")),
              field("escalateAfterInMinutes", literal(5)),
            ],
          },
          {
            id: "team",
            modelType: OnCallDutyPolicyEscalationRuleTeam,
            localName: "page_the_team",
            fields: [
              field("onCallDutyPolicyId", THIS),
              field("onCallDutyPolicyEscalationRuleId", ref("rule")),
              field("teamId", live()),
            ],
          },
        ],
      },
      {
        title: "Page a schedule",
        description:
          "An escalation rule that pages whoever is on call in one of your schedules.",
        scopes: ["view"],
        blocks: [
          {
            id: "rule",
            modelType: OnCallDutyPolicyEscalationRule,
            fields: [
              field("onCallDutyPolicyId", THIS),
              field("name", literal("Page whoever is on call")),
              field("escalateAfterInMinutes", literal(10)),
            ],
          },
          {
            id: "schedule",
            modelType: OnCallDutyPolicyEscalationRuleSchedule,
            localName: "page_the_schedule",
            fields: [
              field("onCallDutyPolicyId", THIS),
              field("onCallDutyPolicyEscalationRuleId", ref("rule")),
              field("onCallDutyPolicyScheduleId", live()),
            ],
          },
        ],
      },
    ],
    tasks: [
      {
        title: "Its escalation rules",
        description: "Its rules, in the order they page.",
        scopes: ["view"],
        modelType: OnCallDutyPolicyEscalationRule,
        operation: "list",
        query: [
          { column: "onCallDutyPolicyId", operator: "equals", value: THIS },
        ],
        select: ["name", "escalateAfterInMinutes", "order"],
        sort: { column: "order", order: "ASC" },
      },
    ],
  },

  OnCallDutyPolicySchedule: {
    fields: [
      field("name", literal("Primary rotation")),
      field("description", literal("Who is on call for production.")),
      field(
        "timezone",
        literal("America/New_York"),
        "The time zone its hand-off times are in.",
      ),
      "labels",
    ],
    recipes: [
      {
        title: "Weekly rotation",
        description:
          "A schedule with one layer that hands over every week. You are its first member; add the others the same way.",
        scopes: ["list"],
        blocks: [
          {
            id: "schedule",
            modelType: OnCallDutyPolicySchedule,
            fields: [field("name", literal("Primary rotation"))],
          },
          {
            id: "layer",
            modelType: OnCallDutyPolicyScheduleLayer,
            fields: [
              field("onCallDutyPolicyScheduleId", ref("schedule")),
              field("name", literal("Weekly")),
              field("startsAt", { kind: "date", weekday: 1, hour: 9 }),
              field("handOffTime", { kind: "date", weekday: 1, hour: 9 }),
              field("rotation", literal(weeklyRotation())),
              field(
                "restrictionTimes",
                literal(RestrictionTimes.getDefault().toJSON() as JSONValue),
              ),
            ],
          },
          {
            id: "member",
            modelType: OnCallDutyPolicyScheduleLayerUser,
            localName: "me",
            fields: [
              field("onCallDutyPolicyScheduleId", ref("schedule")),
              field("onCallDutyPolicyScheduleLayerId", ref("layer")),
              field("userId", ME),
            ],
          },
        ],
      },
      {
        title: "Weekly rotation",
        description:
          "Adds a layer that hands over every week. You are its first member; add the others the same way.",
        scopes: ["view"],
        blocks: [
          {
            id: "layer",
            modelType: OnCallDutyPolicyScheduleLayer,
            fields: [
              field("onCallDutyPolicyScheduleId", THIS),
              field("name", literal("Weekly")),
              field("startsAt", { kind: "date", weekday: 1, hour: 9 }),
              field("handOffTime", { kind: "date", weekday: 1, hour: 9 }),
              field("rotation", literal(weeklyRotation())),
              field(
                "restrictionTimes",
                literal(RestrictionTimes.getDefault().toJSON() as JSONValue),
              ),
            ],
          },
          {
            id: "member",
            modelType: OnCallDutyPolicyScheduleLayerUser,
            localName: "me",
            fields: [
              field("onCallDutyPolicyScheduleId", THIS),
              field("onCallDutyPolicyScheduleLayerId", ref("layer")),
              field("userId", ME),
            ],
          },
        ],
      },
    ],
  },

  IncomingCallPolicy: {
    fields: [
      field("name", literal("Support line")),
      field("description", literal("Routes calls to whoever is on call.")),
      field(
        "greetingMessage",
        literal("Thanks for calling. Connecting you to the on-call engineer."),
        "What callers hear first.",
      ),
      field("isEnabled", literal(true), "Whether it answers calls."),
      "labels",
    ],
    recipes: [
      {
        title: "Route calls to a schedule",
        description:
          "Rings whoever is on call in one of your schedules, for 30 seconds before the next rule.",
        scopes: ["view"],
        blocks: [
          {
            id: "rule",
            modelType: IncomingCallPolicyEscalationRule,
            fields: [
              field("incomingCallPolicyId", THIS),
              field("name", literal("On-call engineer")),
              field("onCallDutyPolicyScheduleId", live()),
              field("escalateAfterSeconds", literal(30)),
            ],
          },
        ],
      },
      {
        title: "Route calls to a schedule",
        description:
          "A policy that rings whoever is on call in one of your schedules.",
        scopes: ["list"],
        blocks: [
          {
            id: "policy",
            modelType: IncomingCallPolicy,
            fields: [field("name", literal("Support line"))],
          },
          {
            id: "rule",
            modelType: IncomingCallPolicyEscalationRule,
            fields: [
              field("incomingCallPolicyId", ref("policy")),
              field("name", literal("On-call engineer")),
              field("onCallDutyPolicyScheduleId", live()),
              field("escalateAfterSeconds", literal(30)),
            ],
          },
        ],
      },
    ],
  },

  Team: {
    fields: [
      field("name", literal("Platform"), "What the team is called."),
      field("description", literal("Owns the platform and its on-call.")),
    ],
    recipes: [
      {
        title: "Team with a member",
        description:
          "A team and its first member, you. Add the others the same way, with their user IDs.",
        scopes: ["list"],
        blocks: [
          {
            id: "team",
            modelType: Team,
            fields: [field("name", literal("Platform"))],
          },
          {
            id: "member",
            modelType: TeamMember,
            localName: "me",
            fields: [field("teamId", ref("team")), field("userId", ME)],
          },
        ],
      },
      {
        title: "Add a member",
        description:
          "Adds you to this team. Add others the same way, with their user IDs.",
        scopes: ["view"],
        blocks: [
          {
            id: "member",
            modelType: TeamMember,
            localName: "me",
            fields: [field("teamId", THIS), field("userId", ME)],
          },
        ],
      },
    ],
    tasks: [
      {
        title: "Its members",
        description: "Who is in this team.",
        scopes: ["view"],
        modelType: TeamMember,
        operation: "list",
        query: [{ column: "teamId", operator: "equals", value: THIS }],
        select: ["userId", "hasAcceptedInvitation"],
      },
    ],
  },

  Workflow: {
    createNote:
      "Build a workflow's steps in the workflow builder. Terraform keeps its name, labels and whether it runs; to keep its steps as code too, copy the configuration from an existing workflow's own Terraform page.",
    fields: [
      field("name", literal("Notify the team about new incidents")),
      field(
        "description",
        literal("Posts every new incident to the team's channel."),
      ),
      field(
        "isEnabled",
        literal(false),
        "Whether it runs. Turn it on once its steps are built.",
      ),
      "labels",
    ],
    update: {
      description:
        "Turn it off: it stops running, from any trigger. Fields you leave out stay as they are.",
      fields: [field("isEnabled", literal(false))],
    },
  },

  Dashboard: {
    fields: [
      field("name", literal("Checkout health")),
      field(
        "description",
        literal("Errors, latency and traffic for checkout."),
      ),
      "labels",
    ],
  },

  Runbook: {
    createNote:
      "Build a runbook's steps in the dashboard. Terraform keeps its name, labels and whether it is on; to keep its steps as code too, copy the configuration from an existing runbook's own Terraform page.",
    fields: [
      field("name", literal("Restart the checkout service")),
      field(
        "description",
        literal("What to do when checkout stops answering."),
      ),
      field("isEnabled", literal(true), "Whether it can run."),
      "labels",
    ],
  },

  Form: {
    fields: [
      field("name", literal("Report a problem")),
      field(
        "description",
        literal("Tell us what looks broken. The on-call team is told at once."),
      ),
      field("isEnabled", literal(true), "Whether its link works."),
      field(
        "targetType",
        literal("Incident"),
        "What each submission creates: Incident, or ScheduledMaintenance.",
      ),
    ],
  },

  ServiceLevelObjective: {
    fields: [
      field("name", literal("Checkout availability")),
      field("description", literal("Checkout is up 99.9% of the time.")),
      field("monitors", undefined, "The monitors whose uptime it measures."),
      field(
        "targetPercentage",
        literal(99.9),
        "The target, as a percentage below 100.",
      ),
      field("windowDays", literal(30), "The rolling window, in days."),
      "labels",
    ],
  },

  Service: {
    fields: [
      field("name", literal("Checkout API")),
      field("description", literal("Takes payments and creates orders.")),
      "labels",
    ],
  },

  CodeRepository: {
    fields: [
      field("name", literal("Checkout API")),
      field("description", literal("The checkout service's code.")),
      field(
        "repositoryHostedAt",
        literal("GitHub"),
        "Where it is hosted, such as GitHub.",
      ),
      field(
        "organizationName",
        literal("acme"),
        "The organization or user that owns it.",
      ),
      field("repositoryName", literal("checkout-api"), "Its name on the host."),
      field("mainBranchName", literal("main"), "Its main branch."),
      "labels",
    ],
  },

  KubernetesCluster: {
    createNote:
      "The OneUptime Kubernetes agent adds a cluster the first time it reports. Create one ahead of the agent only to set it up in advance, with the same cluster identifier as the agent's k8s.cluster.name.",
    fields: [
      field("name", literal("production-us-east")),
      field(
        "clusterIdentifier",
        literal("production-us-east"),
        "The cluster's k8s.cluster.name, as the agent reports it.",
      ),
      field("description", literal("Production cluster in US East.")),
      "labels",
    ],
  },

  DockerHost: {
    createNote:
      "The OneUptime Docker agent adds a host the first time it reports. Create one ahead of it only to set it up in advance, with the host.name the agent reports as its host identifier.",
    fields: [
      field("name", literal("docker-prod-1")),
      field(
        "hostIdentifier",
        literal("docker-prod-1"),
        "The host's host.name, as the agent reports it.",
      ),
      field("description", literal("Production Docker host.")),
      "labels",
    ],
  },

  DockerSwarmCluster: {
    createNote:
      "The OneUptime agent adds a swarm the first time it reports. Its name must match the docker.swarm.cluster.name the agent reports.",
    fields: [
      field("name", literal("swarm-production")),
      field("description", literal("Production Docker Swarm.")),
      "labels",
    ],
  },

  PodmanHost: {
    createNote:
      "The OneUptime agent adds a Podman host the first time it reports. Create one ahead of it only to set it up in advance, with the host.name the agent reports as its host identifier.",
    fields: [
      field("name", literal("podman-prod-1")),
      field(
        "hostIdentifier",
        literal("podman-prod-1"),
        "The host's host.name, as the agent reports it.",
      ),
      field("description", literal("Production Podman host.")),
      "labels",
    ],
  },

  ProxmoxCluster: {
    createNote:
      "The OneUptime agent adds a cluster the first time it reports. Its name must match the proxmox.cluster.name the agent reports.",
    fields: [
      field("name", literal("pve-production")),
      field("description", literal("Production Proxmox VE cluster.")),
      "labels",
    ],
  },

  VMwareVCenter: {
    createNote:
      "The OneUptime agent adds a vCenter the first time it reports. Its name must match the vcenter name the agent reports.",
    fields: [
      field("name", literal("vcenter-prod")),
      field("description", literal("Production vCenter Server.")),
      "labels",
    ],
  },

  CephCluster: {
    createNote:
      "The OneUptime agent adds a Ceph cluster the first time it reports. Its name must match the ceph.cluster.name the agent reports.",
    fields: [
      field("name", literal("ceph-production")),
      field("description", literal("Production Ceph cluster.")),
      "labels",
    ],
  },

  Host: {
    createNote:
      "The OneUptime agent adds a host the first time it reports. Create one ahead of it only to set it up in advance, with the host.name the agent reports as its host identifier.",
    fields: [
      field("name", literal("web-1")),
      field(
        "hostIdentifier",
        literal("web-1"),
        "The host's host.name, as the agent reports it.",
      ),
      field("description", literal("Production web server.")),
      "labels",
    ],
  },

  IoTFleet: {
    createNote:
      "A fleet is added the first time one of its devices reports. Its name must match the iot.fleet.name the devices report.",
    fields: [
      field("name", literal("field-sensors")),
      field("description", literal("Temperature sensors in the warehouses.")),
      "labels",
    ],
  },

  DatabaseServer: {
    createNote:
      "Databases are added when OneUptime first sees them in your telemetry. Create one only for a database nothing reports on yet.",
    fields: [
      field("name", literal("PostgreSQL orders-db.internal:5432")),
      field(
        "databaseIdentifier",
        literal("postgresql|orders-db.internal:5432"),
        "The engine and the endpoint, joined with | and :, as OneUptime keys it.",
      ),
      field(
        "dbSystem",
        literal("postgresql"),
        "The database engine, such as postgresql or mysql.",
      ),
      field(
        "serverAddress",
        literal("orders-db.internal"),
        "The host name or IP address it answers on.",
      ),
      field("serverPort", literal(5432), "The port it answers on."),
      field("description", literal("The orders service's database.")),
      "labels",
    ],
  },

  MessageQueue: {
    createNote:
      "Queues are added when OneUptime first sees them in your telemetry. Create one only for a queue nothing reports on yet.",
    fields: [
      field("name", literal("orders.created")),
      field(
        "queueIdentifier",
        literal("kafka||orders.created"),
        "The broker, its scope and the destination, joined with |, as OneUptime keys it.",
      ),
      field(
        "messagingSystem",
        literal("kafka"),
        "The broker it lives on, such as kafka or rabbitmq.",
      ),
      field(
        "destinationName",
        literal("orders.created"),
        "The queue or topic name applications use.",
      ),
      field("description", literal("Order events from checkout.")),
      "labels",
    ],
  },

  ServerlessFunction: {
    createNote:
      "Functions are added when OneUptime first sees them in your telemetry. The function identifier is the faas.name they report.",
    fields: [
      field("name", literal("checkout-handler")),
      field(
        "functionIdentifier",
        literal("checkout-handler"),
        "The function's faas.name, as its telemetry reports it.",
      ),
      field("description", literal("Handles checkout webhooks.")),
      "labels",
    ],
  },

  CloudResource: {
    createNote:
      "Cloud environments are added when OneUptime first sees them in your telemetry. Create one only to set it up in advance.",
    fields: [
      field("name", literal("AWS ECS · us-east-1")),
      field(
        "resourceIdentifier",
        literal("aws_ecs|123456789012|us-east-1"),
        "The platform, account and region, joined with |, as OneUptime keys it.",
      ),
      field("description", literal("Production containers on ECS.")),
      "labels",
    ],
  },

  NetworkDevice: {
    fields: [
      field("name", literal("core-switch-1")),
      field(
        "hostname",
        literal("10.0.0.1"),
        "The address the probe polls over SNMP.",
      ),
      field("description", literal("Core switch in the main office.")),
      field("probeId", undefined, "The probe that polls it."),
      field("siteId", undefined, "The network site it is in."),
      field(
        "snmpVersion",
        literal("V2c"),
        "The SNMP version to poll it with: V1, V2c or V3.",
      ),
      field(
        "pollingIntervalInMinutes",
        literal(5),
        "How often it is polled, in minutes.",
      ),
      "labels",
    ],
  },

  NetworkSite: {
    fields: [
      field("name", literal("Head office")),
      field("description", literal("The main office and its devices.")),
      field(
        "address",
        literal("1 Main Street, Springfield"),
        "Its street address, shown on maps.",
      ),
      field("latitude", literal(39.7817), "Where it is on maps: its latitude."),
      field(
        "longitude",
        literal(-89.6501),
        "Where it is on maps: its longitude.",
      ),
    ],
  },

  RumApplication: {
    createNote:
      "A RUM application is added the first time its browser SDK reports. Its app identifier is the service.name the SDK reports.",
    fields: [
      field("name", literal("storefront-web")),
      field(
        "appIdentifier",
        literal("storefront-web"),
        "The service.name its browser SDK reports.",
      ),
      field("description", literal("The customer storefront.")),
      field(
        "isSessionReplayEnabled",
        literal(true),
        "Whether visits can be recorded and replayed.",
      ),
      field(
        "sessionReplaySamplePercentage",
        literal(10),
        "The share of visits that are recorded.",
      ),
      "labels",
    ],
  },

  InventoryItem: {
    createNote:
      "Most inventory items are discovered from telemetry. Add one by hand for something that sends none, such as a vendor's API: its type is external.service, external.database or appliance.",
    terraformCannotCreate:
      "OneUptime works out an inventory item's key from its name when it is created, so add new ones in the dashboard or with the API. Terraform can still manage the ones you have: bring them in below.",
    fields: [
      field(
        "displayName",
        literal("Stripe payments API"),
        "What it is called in the inventory.",
      ),
      field(
        "entityType",
        literal("external.service"),
        "What it is: external.service, external.database or appliance.",
      ),
      field(
        "entityKey",
        literal("stripe-payments-api"),
        "Required, but OneUptime replaces it with a key it works out from the name.",
      ),
      field("source", literal("manual"), "Where it came from: manual here."),
      field(
        "description",
        literal("Vendor-managed payments API. Sends no telemetry."),
      ),
    ],
  },
};

// The profile of a model, by its table name, or an empty one.
export function getDeveloperDocsProfile(
  modelType: DatabaseBaseModelType,
): DeveloperDocsProfile {
  return (
    DEVELOPER_DOCS_PROFILES[new modelType().tableName || ""] || {
      fields: [],
    }
  );
}

// A profile's fields, as fields.
export function getDeveloperDocsProfileFields(
  profile: DeveloperDocsProfile,
): Array<DeveloperDocsField> {
  return profile.fields.map(
    (item: DeveloperDocsField | string): DeveloperDocsField => {
      return typeof item === "string" ? { column: item } : item;
    },
  );
}

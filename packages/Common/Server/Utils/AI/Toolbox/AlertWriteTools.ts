import Alert from "../../../../Models/DatabaseModels/Alert";
import AlertSeverity from "../../../../Models/DatabaseModels/AlertSeverity";
import AlertStateTimeline from "../../../../Models/DatabaseModels/AlertStateTimeline";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import Permission from "../../../../Types/Permission";
import BadDataException from "../../../../Types/Exception/BadDataException";
import SortOrder from "../../../../Types/BaseDatabase/SortOrder";
import { AIChatCitationTargetType } from "../../../../Types/AI/AIChatTypes";
import FeedMarkdown from "../../../../Utils/Markdown/FeedMarkdown";
import AlertService from "../../../Services/AlertService";
import AlertSeverityService from "../../../Services/AlertSeverityService";
import WorkspaceMemberActions, {
  WorkspaceEvent,
  WorkspaceEventType,
} from "../../Workspace/WorkspaceMemberActions";
import ToolResultSerializer, { SerializedResult } from "./Serializer";
import WidgetBuilder from "./WidgetBuilder";
import {
  ObservabilityTool,
  PreparedMutation,
  ToolArgs,
  ToolContext,
  ToolExecutionResult,
} from "./ToolTypes";
import AffectedResourceLinks, {
  AFFECTED_RESOURCES_ARGUMENT_NAME,
  AFFECTED_RESOURCES_ARGUMENT_SCHEMA,
  AffectedResourcesToLink,
  LinkedAffectedResource,
} from "./AffectedResourceLinks";
import { AiAffectedResourceRelation } from "../../../../Types/AI/AiAffectedResources";
import AIChatPageContextType from "../../../../Types/AI/AIChatPageContext";
import DatabaseRequestType from "../../../Types/BaseDatabase/DatabaseRequestType";

/*
 * Acknowledging or resolving an alert changes its state: the permission to
 * create its state timeline row, as the dashboard's state panel asks.
 *
 * Derived from the model ACL so the tool gate can never drift from RBAC.
 * Resolved lazily rather than at module load: this module is pulled in through
 * the service import graph before the model classes are fully wired up, so
 * calling a model method at import time throws a circular-dependency
 * TypeError. By the time a tool actually executes, every module is loaded.
 */
let cachedStateChangePermissions: Array<Permission> | null = null;
const resolveStateChangePermissions: () => Array<Permission> =
  (): Array<Permission> => {
    if (!cachedStateChangePermissions) {
      cachedStateChangePermissions =
        new AlertStateTimeline().getCreatePermissions();
    }
    return cachedStateChangePermissions;
  };

/*
 * Raising an alert creates one, as the dashboard's Create Alert form does:
 * the permission to create alerts (Create Alert in a custom role).
 */
let cachedCreatePermissions: Array<Permission> | null = null;
const resolveCreatePermissions: () => Array<Permission> =
  (): Array<Permission> => {
    if (!cachedCreatePermissions) {
      cachedCreatePermissions = new Alert().getCreatePermissions();
    }
    return cachedCreatePermissions;
  };

// Linking resources to an alert edits it, as its Affected Resources Edit does.
let cachedUpdatePermissions: Array<Permission> | null = null;
const resolveUpdatePermissions: () => Array<Permission> =
  (): Array<Permission> => {
    if (!cachedUpdatePermissions) {
      cachedUpdatePermissions = new Alert().getUpdatePermissions();
    }
    return cachedUpdatePermissions;
  };

/*
 * The alert a call is about: its alertId, or - when it names none - the
 * alert the conversation is about (its page, or its shared thread).
 */
function getAlertId(args: JSONObject, ctx: ToolContext): ObjectID | undefined {
  const named: ObjectID | undefined = ToolArgs.getObjectID(args, "alertId");

  if (named) {
    return named;
  }

  if (
    ctx.pageContext?.type === AIChatPageContextType.Alert &&
    ctx.pageContext.entityId &&
    ObjectID.isValidUUID(ctx.pageContext.entityId)
  ) {
    return new ObjectID(ctx.pageContext.entityId);
  }

  return undefined;
}

/*
 * How the person knows an alert - its number with the project's prefix -
 * read with their own props, for an approval card's title. Null when they
 * may not read it or the read fails: the card then keeps
 * buildActionTitle's title, and running the action says why.
 */
async function getAlertNumberForPerson(data: {
  alertId: ObjectID;
  ctx: ToolContext;
}): Promise<string | null> {
  try {
    const alert: Alert | null = await AlertService.findOneById({
      id: data.alertId,
      select: {
        _id: true,
        alertNumber: true,
        alertNumberWithPrefix: true,
      },
      props: data.ctx.props,
    });

    if (alert?.alertNumberWithPrefix) {
      return alert.alertNumberWithPrefix;
    }

    return typeof alert?.alertNumber === "number"
      ? `#${alert.alertNumber}`
      : null;
  } catch {
    return null;
  }
}

// The severity a new alert takes, and whether it is the one the call named.
export interface AlertSeverityChoice {
  severity: AlertSeverity;
  // False when the call named none, or one the project does not have.
  isNamed: boolean;
}

/*
 * The severities a new alert may take, in the project's order - never an
 * archived one - read as the person: what the dashboard's Create Alert
 * form offers them.
 */
async function readAlertSeverities(
  ctx: ToolContext,
): Promise<Array<AlertSeverity>> {
  return await AlertSeverityService.findBy({
    query: { projectId: ctx.projectId, isArchived: false },
    select: {
      _id: true,
      name: true,
      order: true,
    },
    sort: {
      order: SortOrder.Ascending,
    },
    limit: 50,
    skip: 0,
    props: ctx.props,
  });
}

/*
 * The severity a new alert takes: the one the call names, matched without
 * regard to case, else the project's first - as create_incident picks an
 * incident's. Null when the project has none.
 */
export function pickAlertSeverity(data: {
  severities: Array<AlertSeverity>;
  severityName: string | undefined;
}): AlertSeverityChoice | null {
  const first: AlertSeverity | undefined = data.severities[0];

  if (!first) {
    return null;
  }

  const wanted: string = (data.severityName || "").trim().toLowerCase();

  if (wanted) {
    const named: AlertSeverity | undefined = data.severities.find(
      (severity: AlertSeverity): boolean => {
        return (severity.name || "").trim().toLowerCase() === wanted;
      },
    );

    if (named) {
      return { severity: named, isNamed: true };
    }
  }

  return { severity: first, isNamed: false };
}

/*
 * The severity a call gives its alert, by its name in the project, for the
 * arguments the person approves: the call's own, or the project's first
 * when it names none, or one the project does not have. Null when the
 * person may not read the severities or the project has none - running
 * the action then says why.
 */
async function getAlertSeverityNameForPerson(data: {
  args: JSONObject;
  ctx: ToolContext;
}): Promise<string | null> {
  try {
    const choice: AlertSeverityChoice | null = pickAlertSeverity({
      severities: await readAlertSeverities(data.ctx),
      severityName: ToolArgs.getString(data.args, "severityName"),
    });

    return choice?.severity.name?.trim() || null;
  } catch {
    return null;
  }
}

/*
 * The approval card's line under "Create alert: <title>": the severity the
 * alert takes, then what it is linked to - 'Severity: High. Linked to host
 * "test01".' The severity is said in words here because the argument line
 * under it is cut at two lines, and on a phone the severity, written last,
 * was never seen before the person approved (#5301's UI review). Undefined
 * when there is nothing to say.
 */
export function describeAlertForPerson(data: {
  severityName: string | null;
  linked: string | undefined;
}): string | undefined {
  const parts: Array<string> = [];

  if (data.severityName) {
    parts.push(`Severity: ${data.severityName}.`);
  }

  if (data.linked) {
    parts.push(data.linked);
  }

  return parts.length > 0 ? parts.join(" ") : undefined;
}

/*
 * create_alert raises an alert from the conversation, as the dashboard's
 * Create Alert form does (issue #5301: Ask AI declared incidents, but could
 * not raise an alert). It is create_incident's twin:
 *
 *   - created as the person who asked, with their props: held to their
 *     permission to create alerts, their labels and the project's plan,
 *     and credited to them;
 *   - with one of the project's alert severities, by name, else its first;
 *   - starting where every new alert starts (AlertService stamps the
 *     project's created state), so the project's rules, owners and on-call
 *     policies treat it as they treat any new alert;
 *   - linked to what it is about: the resources the call names or - raised
 *     from a resource's page without naming any - that resource, written
 *     out before the person approves it, with the severity it takes.
 *
 * Like create_incident, it never links a monitor
 * (Types/AI/AiAffectedResources): an alert's monitor stays the person's
 * pick on the Create Alert form.
 */
export const CreateAlertTool: ObservabilityTool = {
  name: "create_alert",
  description:
    "Raise (create) a new alert in this project, as the dashboard's Create Alert does: for something the team should look into that is not, or not yet, an outage users feel, such as a host's memory running high or an error rate creeping up. For an outage or a problem users feel, declare an incident with create_incident instead; when the user names one, create that one. Provide a clear title and a description of what you found. Optionally set the severity by name (must match an existing alert severity); otherwise the project's first-defined alert severity is used. Link it to the infrastructure and services it is about with affectedResources: OneUptime AI investigates and fixes what an alert is linked to, and nothing else. Asked from a resource's page (a host, a cluster, a database, a service, ...), the alert is linked to that resource unless you pass affectedResources yourself; pass an empty list to link nothing. An alert is raised once, now: it is not a rule and watches nothing.",
  inputSchema: {
    type: "object",
    properties: {
      title: {
        type: "string",
        description: "Short, specific alert title (required).",
      },
      description: {
        type: "string",
        description:
          "Markdown description of what you found, its impact and any known cause.",
      },
      severityName: {
        type: "string",
        description:
          "Name of an existing alert severity (e.g. 'High', 'Low'). Defaults to the project's first-defined alert severity.",
      },
      [AFFECTED_RESOURCES_ARGUMENT_NAME]: AFFECTED_RESOURCES_ARGUMENT_SCHEMA,
    },
    required: ["title"],
  },
  get requiredPermissions(): Array<Permission> {
    return resolveCreatePermissions();
  },
  isMutation: true,
  buildActionTitle: (args: JSONObject): string => {
    return `Create alert: ${ToolArgs.getString(args, "title") || "Untitled"}`;
  },
  /*
   * The page's resource written out (the alert is raised from it), the
   * severity it takes by name, and what every resource it names is, for
   * the approval card.
   */
  prepareMutation: async (
    args: JSONObject,
    ctx: ToolContext,
  ): Promise<PreparedMutation> => {
    const prepared: JSONObject =
      AffectedResourceLinks.withPageResourceWrittenOut({ args, ctx });

    const toLink: AffectedResourcesToLink =
      await AffectedResourceLinks.resolveForCall({
        args: prepared,
        ctx,
        defaultsToPage: false,
      });

    const severityName: string | null = await getAlertSeverityNameForPerson({
      args: prepared,
      ctx,
    });

    return {
      arguments: severityName ? { ...prepared, severityName } : prepared,
      description: describeAlertForPerson({
        severityName,
        linked: AffectedResourceLinks.describeForPerson({
          linked: toLink.linked,
          hasNotLinked: toLink.notLinked.length > 0,
          verb: "Linked to",
        }),
      }),
    };
  },
  execute: async (
    args: JSONObject,
    ctx: ToolContext,
  ): Promise<ToolExecutionResult> => {
    const title: string | undefined = ToolArgs.getString(args, "title");
    if (!title) {
      throw new BadDataException("title is required to create an alert.");
    }

    const description: string = ToolArgs.getString(args, "description") || "";

    const userId: ObjectID | undefined = ctx.props.userId;
    if (!userId) {
      throw new BadDataException(
        "No authenticated user in context; cannot create an alert.",
      );
    }

    const severities: Array<AlertSeverity> = await readAlertSeverities(ctx);
    const severityName: string | undefined = ToolArgs.getString(
      args,
      "severityName",
    );
    const choice: AlertSeverityChoice | null = pickAlertSeverity({
      severities,
      severityName,
    });

    if (!choice) {
      throw new BadDataException(
        "No alert severities are configured for this project. Add one in Alerts > Settings > Alert Severity first.",
      );
    }

    const severity: AlertSeverity = choice.severity;

    /*
     * What it is linked to: the resources the call names, or - raised from
     * a resource's page without naming any - that resource. Each read with
     * the person's props; the ones they may not view, archived ones and
     * ones of another project are left out, and the model is told why.
     */
    const toLink: AffectedResourcesToLink =
      await AffectedResourceLinks.resolveForCall({
        args,
        ctx,
        defaultsToPage: true,
      });

    const alert: Alert = new Alert();
    alert.projectId = ctx.projectId;
    alert.title = title;
    /*
     * The model wrote the description from what it read, telemetry included:
     * it stays Markdown, but nothing in it acts on its own in the alert's
     * feed, Slack and Teams (FeedMarkdown.aiWritten).
     */
    alert.description = FeedMarkdown.aiWritten(description).toString();
    alert.alertSeverityId = severity.id!;
    alert.createdByUserId = userId;

    /*
     * Linked with the create itself, as the Create Alert form links what
     * its Other Affected Resources picks: the investigation and
     * auto-remediation the create starts read these lists.
     */
    AffectedResourceLinks.setOnRecord(alert, toLink.linked);

    // Created under the user's props so the model-layer RBAC applies too.
    const created: Alert = await AlertService.create({
      data: alert,
      props: ctx.props,
    });

    const alertIdString: string = created.id!.toString();
    // How the person knows it: its number with the project's prefix.
    const alertNumber: string =
      created.alertNumberWithPrefix || `#${created.alertNumber ?? ""}`;

    const serialized: SerializedResult = ToolResultSerializer.serializeRows([
      {
        id: alertIdString,
        alertNumber: alertNumber,
        title: title,
        severity: severity.name,
        ...(toLink.linked.length > 0
          ? {
              affectedResources: AffectedResourceLinks.describeForWidget(
                toLink.linked,
              ),
            }
          : {}),
      },
    ]);

    const lines: Array<string> = [
      `Successfully created alert ${alertNumber} ("${title}", severity ${severity.name}).`,
    ];

    if (severityName && !choice.isNamed) {
      lines.push(
        `No alert severity of this project is named ${JSON.stringify(severityName)}, so it took the first, ${severity.name}. The project's alert severities: ${severities
          .map((item: AlertSeverity): string => {
            return item.name || "";
          })
          .filter((name: string): boolean => {
            return Boolean(name);
          })
          .join(", ")}.`,
      );
    }

    const linkedText: string = AffectedResourceLinks.describeForModel({
      linked: toLink.linked,
      notLinked: toLink.notLinked,
      verb: "Linked to",
    });

    if (linkedText) {
      lines.push(linkedText);
    }

    if (toLink.linked.length === 0) {
      lines.push(
        "It is linked to no infrastructure or service, and OneUptime AI fixes only what an alert is linked to. When you know what it is about, link it with add_alert_affected_resources.",
      );
    }

    return {
      dataForLlm: `${lines.join("\n")}\n${serialized.text}`,
      rowCount: 1,
      citationLabel: `Created alert ${alertNumber}`,
      citationTarget: {
        type: AIChatCitationTargetType.AlertView,
        params: { alertId: alertIdString },
      },
      redactionCount: serialized.redactionCount,
      isTruncated: false,
      widget: WidgetBuilder.resourceCard({
        title: "Alert created",
        resourceType: "Alert",
        heading: `${alertNumber} · ${title}`,
        subheading: severity.name ? `Severity: ${severity.name}` : undefined,
        fields: [
          { label: "Number", value: alertNumber },
          { label: "Severity", value: severity.name || "—" },
          ...(toLink.linked.length > 0
            ? [
                {
                  label: "Affected resources",
                  value: AffectedResourceLinks.describeForWidget(toLink.linked),
                },
              ]
            : []),
          ...(description
            ? [
                {
                  label: "Description",
                  value:
                    description.length > 200
                      ? `${description.substring(0, 200)}…`
                      : description,
                },
              ]
            : []),
        ],
        link: {
          type: AIChatCitationTargetType.AlertView,
          params: { alertId: alertIdString },
        },
      }),
    };
  },
};

async function changeAlertStateTool(data: {
  args: JSONObject;
  ctx: ToolContext;
  verb: "acknowledge" | "resolve";
}): Promise<ToolExecutionResult> {
  const { args, ctx, verb } = data;

  const alertId: ObjectID | undefined = ToolArgs.getObjectID(args, "alertId");
  if (!alertId) {
    throw new BadDataException(
      "alertId is required. Use query_alerts to find it first.",
    );
  }

  if (!ctx.props.userId) {
    throw new BadDataException(
      "No authenticated user in context; cannot change the alert.",
    );
  }

  // The alert as the person reads it, for the answer below.
  const alert: Alert | null = await AlertService.findOneById({
    id: alertId,
    select: {
      _id: true,
      alertNumber: true,
      title: true,
    },
    props: ctx.props,
  });

  if (!alert) {
    throw new BadDataException(
      "Alert not found (or you do not have access to it).",
    );
  }

  /*
   * The change is the alert state timeline row the dashboard's state panel
   * creates, created as the person who asked (WorkspaceMemberActions): held
   * to their permission to change the alert's state, their labels and
   * owners and the project's plan, and credited to them in the alert's
   * timeline and feed.
   */
  const event: WorkspaceEvent = {
    type: WorkspaceEventType.Alert,
    id: alertId,
  };

  if (verb === "acknowledge") {
    await WorkspaceMemberActions.acknowledge({
      event: event,
      props: ctx.props,
    });
  } else {
    await WorkspaceMemberActions.resolve({ event: event, props: ctx.props });
  }

  const newStateName: string =
    verb === "acknowledge" ? "Acknowledged" : "Resolved";

  const alertIdString: string = alertId.toString();

  const serialized: SerializedResult = ToolResultSerializer.serializeRows([
    {
      id: alertIdString,
      alertNumber: alert.alertNumber,
      title: alert.title,
      newState: newStateName,
    },
  ]);

  return {
    dataForLlm: `Alert #${alert.alertNumber} ("${alert.title}") is now ${newStateName}.\n${serialized.text}`,
    rowCount: 1,
    citationLabel: `${newStateName} alert #${alert.alertNumber}`,
    citationTarget: {
      type: AIChatCitationTargetType.AlertView,
      params: { alertId: alertIdString },
    },
    redactionCount: serialized.redactionCount,
    isTruncated: false,
    widget: WidgetBuilder.resourceCard({
      title: `Alert ${newStateName.toLowerCase()}`,
      resourceType: "Alert",
      heading: `#${alert.alertNumber} · ${alert.title}`,
      subheading: `Now ${newStateName}`,
      // The heading and the line under it say the number and the state.
      fields: [],
      link: {
        type: AIChatCitationTargetType.AlertView,
        params: { alertId: alertIdString },
      },
    }),
  };
}

export const AcknowledgeAlertTool: ObservabilityTool = {
  name: "acknowledge_alert",
  description:
    "Acknowledge an alert (move it to the acknowledged state) by its alertId. Find the alertId with query_alerts first.",
  inputSchema: {
    type: "object",
    properties: {
      alertId: {
        type: "string",
        description: "The alert's ID (required).",
      },
    },
    required: ["alertId"],
  },
  get requiredPermissions(): Array<Permission> {
    return resolveStateChangePermissions();
  },
  isMutation: true,
  buildActionTitle: (args: JSONObject): string => {
    return `Acknowledge alert ${ToolArgs.getString(args, "alertId") || ""}`.trim();
  },
  execute: async (
    args: JSONObject,
    ctx: ToolContext,
  ): Promise<ToolExecutionResult> => {
    return changeAlertStateTool({ args, ctx, verb: "acknowledge" });
  },
};

export const ResolveAlertTool: ObservabilityTool = {
  name: "resolve_alert",
  description:
    "Resolve an alert (move it to the resolved state) by its alertId. Find the alertId with query_alerts first.",
  inputSchema: {
    type: "object",
    properties: {
      alertId: {
        type: "string",
        description: "The alert's ID (required).",
      },
    },
    required: ["alertId"],
  },
  get requiredPermissions(): Array<Permission> {
    return resolveStateChangePermissions();
  },
  isMutation: true,
  buildActionTitle: (args: JSONObject): string => {
    return `Resolve alert ${ToolArgs.getString(args, "alertId") || ""}`.trim();
  },
  execute: async (
    args: JSONObject,
    ctx: ToolContext,
  ): Promise<ToolExecutionResult> => {
    return changeAlertStateTool({ args, ctx, verb: "resolve" });
  },
};

/*
 * The alert twin of add_incident_affected_resources: links an existing
 * alert to the infrastructure and services it is about, as its Affected
 * Resources Edit does, added to what it lists already and made as the
 * person.
 */
export const AddAlertAffectedResourcesTool: ObservabilityTool = {
  name: "add_alert_affected_resources",
  description:
    "Link an existing alert to the infrastructure and services it is about, as its Affected Resources do: OneUptime AI investigates and fixes what an alert is linked to. What it is linked to already stays. Name each resource in affectedResources by its OneUptime ID from query_telemetry_resources (or lookup_context for a service). alertId defaults to the alert this conversation is about; asked from a resource's page, affectedResources defaults to that resource. When OneUptime AI found nothing to fix on the alert because it was linked to nothing, it tries again once a cluster or host it can fix is linked.",
  inputSchema: {
    type: "object",
    properties: {
      alertId: {
        type: "string",
        description:
          "The alert's ID. Defaults to the alert this conversation is about.",
      },
      [AFFECTED_RESOURCES_ARGUMENT_NAME]: AFFECTED_RESOURCES_ARGUMENT_SCHEMA,
    },
  },
  get requiredPermissions(): Array<Permission> {
    return resolveUpdatePermissions();
  },
  isMutation: true,
  buildActionTitle: (args: JSONObject): string => {
    const alertId: string | undefined = ToolArgs.getString(args, "alertId");

    return alertId
      ? `Link alert ${alertId} to affected resources`
      : "Link this alert to affected resources";
  },
  prepareMutation: async (
    args: JSONObject,
    ctx: ToolContext,
  ): Promise<PreparedMutation> => {
    const alertId: ObjectID | undefined = getAlertId(args, ctx);

    const prepared: JSONObject = {
      ...AffectedResourceLinks.withPageResourceWrittenOut({ args, ctx }),
      ...(alertId ? { alertId: alertId.toString() } : {}),
    };

    const toLink: AffectedResourcesToLink =
      await AffectedResourceLinks.resolveForCall({
        args: prepared,
        ctx,
        defaultsToPage: false,
      });

    /*
     * The card names the alert by its number: written out, its ID would
     * otherwise be all buildActionTitle can name it by.
     */
    const alertNumber: string | null = alertId
      ? await getAlertNumberForPerson({ alertId, ctx })
      : null;

    return {
      arguments: prepared,
      ...(alertNumber
        ? { title: `Link alert ${alertNumber} to affected resources` }
        : {}),
      description: AffectedResourceLinks.describeForPerson({
        linked: toLink.linked,
        hasNotLinked: toLink.notLinked.length > 0,
        verb: "Adds",
      }),
    };
  },
  execute: async (
    args: JSONObject,
    ctx: ToolContext,
  ): Promise<ToolExecutionResult> => {
    const alertId: ObjectID | undefined = getAlertId(args, ctx);

    if (!alertId) {
      throw new BadDataException(
        "alertId is required. Use query_alerts to find it first.",
      );
    }

    if (!ctx.props.userId) {
      throw new BadDataException(
        "No authenticated user in context; cannot change the alert.",
      );
    }

    // The alert as the person reads it, for the answer below.
    const alert: Alert | null = await AlertService.findOneById({
      id: alertId,
      select: { _id: true, alertNumber: true, title: true },
      props: ctx.props,
    });

    if (!alert) {
      throw new BadDataException(
        "Alert not found (or you do not have access to it).",
      );
    }

    const toLink: AffectedResourcesToLink =
      await AffectedResourceLinks.resolveForCall({
        args,
        ctx,
        defaultsToPage: true,
      });

    if (toLink.linked.length === 0) {
      throw new BadDataException(
        toLink.notLinked.length > 0
          ? `Nothing was linked. ${toLink.notLinked.join(" ")}`
          : "Name the resources to link in affectedResources: { resourceType, resourceId } each, with the IDs query_telemetry_resources returns.",
      );
    }

    /*
     * What the alert lists already, of the kinds being added - read as
     * OneUptime for the alert the person's own read returned: a list is
     * written whole, and a link the person may not view must stay.
     */
    const relations: Array<AiAffectedResourceRelation> =
      AffectedResourceLinks.getRelationsOf(toLink.linked);
    const select: JSONObject = { _id: true };

    for (const relation of relations) {
      select[relation] = { _id: true };
    }

    const held: Alert | null = await AlertService.findOneById({
      id: alertId,
      select: select as never,
      props: { isRoot: true },
    });

    const lists: {
      lists: Partial<Record<AiAffectedResourceRelation, Array<unknown>>>;
      added: Array<LinkedAffectedResource>;
      alreadyLinked: Array<LinkedAffectedResource>;
    } = AffectedResourceLinks.getListsWithAdded({
      held: AffectedResourceLinks.readHeldIds(held, relations),
      linked: toLink.linked,
    });

    if (lists.added.length > 0) {
      /*
       * Edited as the person, as the alert's Affected Resources Edit edits
       * it: an alert they may read but not change changes nothing, and
       * they are told so.
       */
      const updatedCount: number = await AlertService.updateOneById({
        id: alertId,
        data: lists.lists as never,
        props: ctx.props,
      });

      if (updatedCount === 0) {
        throw await AlertService.getUnwrittenByIdError({
          id: alertId,
          props: ctx.props,
          type: DatabaseRequestType.Update,
        });
      }
    }

    const alertIdString: string = alertId.toString();

    const serialized: SerializedResult = ToolResultSerializer.serializeRows([
      {
        alertNumber: alert.alertNumber,
        added: AffectedResourceLinks.describeForWidget(lists.added),
        alreadyLinked: AffectedResourceLinks.describeForWidget(
          lists.alreadyLinked,
        ),
      },
    ]);

    const lines: Array<string> = [
      lists.added.length > 0
        ? `Linked alert #${alert.alertNumber} ("${alert.title}") to ${AffectedResourceLinks.describeForWidget(lists.added)}.`
        : `Alert #${alert.alertNumber} ("${alert.title}") was linked to all of these already; nothing changed.`,
    ];

    if (lists.alreadyLinked.length > 0 && lists.added.length > 0) {
      lines.push(
        `Already linked: ${AffectedResourceLinks.describeForWidget(lists.alreadyLinked)}.`,
      );
    }

    for (const reason of toLink.notLinked) {
      lines.push(`Not linked: ${reason}`);
    }

    if (
      lists.added.length > 0 &&
      AffectedResourceLinks.hasFixableResource(lists.added)
    ) {
      lines.push(
        "If OneUptime AI found nothing to fix on this alert because it was linked to nothing, it tries again now, under the project's AI rules and each resource's own fix settings.",
      );
    }

    return {
      dataForLlm: `${lines.join("\n")}\n${serialized.text}`,
      rowCount: lists.added.length,
      citationLabel: `Linked alert #${alert.alertNumber}`,
      citationTarget: {
        type: AIChatCitationTargetType.AlertView,
        params: { alertId: alertIdString },
      },
      redactionCount: serialized.redactionCount,
      isTruncated: false,
      widget: WidgetBuilder.resourceCard({
        title: "Affected resources linked",
        resourceType: "Alert",
        heading: `#${alert.alertNumber} · ${alert.title}`,
        fields: [
          { label: "Number", value: `#${alert.alertNumber ?? ""}` },
          ...(lists.added.length > 0
            ? [
                {
                  label: "Linked",
                  value: AffectedResourceLinks.describeForWidget(lists.added),
                },
              ]
            : []),
          ...(lists.alreadyLinked.length > 0
            ? [
                {
                  label: "Already linked",
                  value: AffectedResourceLinks.describeForWidget(
                    lists.alreadyLinked,
                  ),
                },
              ]
            : []),
        ],
        link: {
          type: AIChatCitationTargetType.AlertView,
          params: { alertId: alertIdString },
        },
      }),
    };
  },
};

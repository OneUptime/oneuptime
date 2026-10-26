import Alert from "../../../../Models/DatabaseModels/Alert";
import AlertStateTimeline from "../../../../Models/DatabaseModels/AlertStateTimeline";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import Permission from "../../../../Types/Permission";
import BadDataException from "../../../../Types/Exception/BadDataException";
import { AIChatCitationTargetType } from "../../../../Types/AI/AIChatTypes";
import AlertService from "../../../Services/AlertService";
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
      fields: [
        { label: "Number", value: `#${alert.alertNumber ?? ""}` },
        { label: "State", value: newStateName },
      ],
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

    return {
      arguments: prepared,
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

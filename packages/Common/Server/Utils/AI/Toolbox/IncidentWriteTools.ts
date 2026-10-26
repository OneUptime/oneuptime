import Incident from "../../../../Models/DatabaseModels/Incident";
import IncidentSeverity from "../../../../Models/DatabaseModels/IncidentSeverity";
import IncidentStateTimeline from "../../../../Models/DatabaseModels/IncidentStateTimeline";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import Permission from "../../../../Types/Permission";
import BadDataException from "../../../../Types/Exception/BadDataException";
import SortOrder from "../../../../Types/BaseDatabase/SortOrder";
import { AIChatCitationTargetType } from "../../../../Types/AI/AIChatTypes";
import IncidentService from "../../../Services/IncidentService";
import IncidentSeverityService from "../../../Services/IncidentSeverityService";
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

import FeedMarkdown from "../../../../Utils/Markdown/FeedMarkdown";
/*
 * Derived from the model ACL so the tool gate can never drift from RBAC.
 * Resolved lazily rather than at module load: this module is pulled in through
 * the service import graph before the Incident model class is fully wired up,
 * so calling a model method at import time throws a circular-dependency
 * TypeError. By the time a tool actually executes, every module is loaded.
 */
let cachedCreatePermissions: Array<Permission> | null = null;
const resolveCreatePermissions: () => Array<Permission> =
  (): Array<Permission> => {
    if (!cachedCreatePermissions) {
      cachedCreatePermissions = new Incident().getCreatePermissions();
    }
    return cachedCreatePermissions;
  };
/*
 * Acknowledging or resolving an incident changes its state: the permission
 * to create its state timeline row, as the dashboard's state panel asks.
 */
let cachedStateChangePermissions: Array<Permission> | null = null;
const resolveStateChangePermissions: () => Array<Permission> =
  (): Array<Permission> => {
    if (!cachedStateChangePermissions) {
      cachedStateChangePermissions =
        new IncidentStateTimeline().getCreatePermissions();
    }
    return cachedStateChangePermissions;
  };
// Linking resources to an incident edits it, as its Affected Resources Edit does.
let cachedUpdatePermissions: Array<Permission> | null = null;
const resolveUpdatePermissions: () => Array<Permission> =
  (): Array<Permission> => {
    if (!cachedUpdatePermissions) {
      cachedUpdatePermissions = new Incident().getUpdatePermissions();
    }
    return cachedUpdatePermissions;
  };

/*
 * The incident a call is about: its incidentId, or - when it names none -
 * the incident the conversation is about (its page, or its shared thread).
 */
function getIncidentId(
  args: JSONObject,
  ctx: ToolContext,
): ObjectID | undefined {
  const named: ObjectID | undefined = ToolArgs.getObjectID(args, "incidentId");

  if (named) {
    return named;
  }

  if (
    ctx.pageContext?.type === AIChatPageContextType.Incident &&
    ctx.pageContext.entityId &&
    ObjectID.isValidUUID(ctx.pageContext.entityId)
  ) {
    return new ObjectID(ctx.pageContext.entityId);
  }

  return undefined;
}

/*
 * Write tools mutate the project. They are gated twice: once by the tool's
 * requiredPermissions (RBAC) and once by the conversation's permission mode
 * (approval / auto-run / hidden in read-only). Each write is the one the
 * dashboard makes for the same change, made with the requesting user's
 * props (ctx.props, never a tool argument), so it is held to what that
 * person may do and is credited to them.
 */

export const CreateIncidentTool: ObservabilityTool = {
  name: "create_incident",
  description:
    "Declare (create) a new incident in this project. Provide a clear title and a description of the problem. Optionally set the severity by name (must match an existing incident severity); otherwise the project's first-defined severity is used. Link it to the infrastructure and services it is about with affectedResources: OneUptime AI investigates and fixes what an incident is linked to, and nothing else. Asked from a resource's page (a host, a cluster, a database, a service, ...), the incident is linked to that resource unless you pass affectedResources yourself; pass an empty list to link nothing. Use this when the user asks you to open, declare or create an incident.",
  inputSchema: {
    type: "object",
    properties: {
      title: {
        type: "string",
        description: "Short, specific incident title (required).",
      },
      description: {
        type: "string",
        description:
          "Markdown description of what is happening, impact and any known cause.",
      },
      severityName: {
        type: "string",
        description:
          "Name of an existing incident severity (e.g. 'SEV1', 'Critical'). Defaults to the project's first-defined severity.",
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
    return `Create incident: ${ToolArgs.getString(args, "title") || "Untitled"}`;
  },
  /*
   * The page's resource written out (the incident is declared from it), and
   * what every resource it names is, for the approval card.
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

    return {
      arguments: prepared,
      description: AffectedResourceLinks.describeForPerson({
        linked: toLink.linked,
        hasNotLinked: toLink.notLinked.length > 0,
        verb: "Linked to",
      }),
    };
  },
  execute: async (
    args: JSONObject,
    ctx: ToolContext,
  ): Promise<ToolExecutionResult> => {
    const title: string | undefined = ToolArgs.getString(args, "title");
    if (!title) {
      throw new BadDataException("title is required to create an incident.");
    }

    const description: string = ToolArgs.getString(args, "description") || "";

    const userId: ObjectID | undefined = ctx.props.userId;
    if (!userId) {
      throw new BadDataException(
        "No authenticated user in context; cannot create an incident.",
      );
    }

    const severities: Array<IncidentSeverity> =
      await IncidentSeverityService.findBy({
        // The severities a new incident may take: never an archived one.
        query: { isArchived: false },
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

    if (severities.length === 0) {
      throw new BadDataException(
        "No incident severities are configured for this project. Add one in Incidents > Settings > Incident Severity first.",
      );
    }

    let severity: IncidentSeverity = severities[0]!;
    const severityName: string | undefined = ToolArgs.getString(
      args,
      "severityName",
    );
    if (severityName) {
      const match: IncidentSeverity | undefined = severities.find(
        (item: IncidentSeverity) => {
          return item.name?.toLowerCase() === severityName.toLowerCase();
        },
      );
      if (match) {
        severity = match;
      }
    }

    /*
     * What it is linked to: the resources the call names, or - declared
     * from a resource's page without naming any - that resource. Each read
     * with the person's props; the ones they may not view, archived ones
     * and ones of another project are left out, and the model is told why.
     */
    const toLink: AffectedResourcesToLink =
      await AffectedResourceLinks.resolveForCall({
        args,
        ctx,
        defaultsToPage: true,
      });

    const incident: Incident = new Incident();
    incident.projectId = ctx.projectId;
    incident.title = title;
    /*
     * The model wrote the description from what it read, telemetry included:
     * it stays Markdown, but nothing in it acts on its own in the incident's
     * feed, Slack and Teams (FeedMarkdown.aiWritten).
     */
    incident.description = FeedMarkdown.aiWritten(description).toString();
    incident.incidentSeverityId = severity.id!;
    incident.createdByUserId = userId;
    /*
     * No root cause until somebody knows one: the incident names the person
     * whose copilot opened it as its creator (WhoOpenedItRootCause).
     */

    /*
     * Linked with the create itself, as Declare Incident links what its
     * Affected Resources step picks: the investigation and auto-remediation
     * the create starts read these lists.
     */
    AffectedResourceLinks.setOnRecord(incident, toLink.linked);

    // Created under the user's props so the model-layer RBAC applies too.
    const created: Incident = await IncidentService.create({
      data: incident,
      props: ctx.props,
    });

    const incidentIdString: string = created.id!.toString();

    const serialized: SerializedResult = ToolResultSerializer.serializeRows([
      {
        id: incidentIdString,
        incidentNumber: created.incidentNumber,
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

    const linkedText: string = AffectedResourceLinks.describeForModel({
      linked: toLink.linked,
      notLinked: toLink.notLinked,
      verb: "Linked to",
    });

    return {
      dataForLlm: `Successfully created incident #${created.incidentNumber} ("${title}", severity ${severity.name}).${
        linkedText ? `\n${linkedText}` : ""
      }${
        toLink.linked.length === 0
          ? "\nIt is linked to no infrastructure or service, and OneUptime AI fixes only what an incident is linked to. When you know what it is about, link it with add_incident_affected_resources."
          : ""
      }\n${serialized.text}`,
      rowCount: 1,
      citationLabel: `Created incident #${created.incidentNumber}`,
      citationTarget: {
        type: AIChatCitationTargetType.IncidentView,
        params: { incidentId: incidentIdString },
      },
      redactionCount: serialized.redactionCount,
      isTruncated: false,
      widget: WidgetBuilder.resourceCard({
        title: "Incident created",
        resourceType: "Incident",
        heading: `#${created.incidentNumber} · ${title}`,
        subheading: severity.name ? `Severity: ${severity.name}` : undefined,
        fields: [
          { label: "Number", value: `#${created.incidentNumber ?? ""}` },
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
          type: AIChatCitationTargetType.IncidentView,
          params: { incidentId: incidentIdString },
        },
      }),
    };
  },
};

/*
 * Links an existing incident to infrastructure or services, as its
 * Affected Resources Edit does: what OneUptime AI identified in the
 * conversation ("this is about host test01"), so its investigation reaches
 * it and auto-remediation can fix it there. Added to what the incident
 * lists already - never in place of it - and made as the person, with
 * their permission to edit the incident.
 */
export const AddIncidentAffectedResourcesTool: ObservabilityTool = {
  name: "add_incident_affected_resources",
  description:
    "Link an existing incident to the infrastructure and services it is about, as its Affected Resources do: OneUptime AI investigates and fixes what an incident is linked to. What it is linked to already stays. Name each resource in affectedResources by its OneUptime ID from query_telemetry_resources (or lookup_context for a service). incidentId defaults to the incident this conversation is about; asked from a resource's page, affectedResources defaults to that resource. When OneUptime AI found nothing to fix on the incident because it was linked to nothing, it tries again once a cluster or host it can fix is linked.",
  inputSchema: {
    type: "object",
    properties: {
      incidentId: {
        type: "string",
        description:
          "The incident's ID. Defaults to the incident this conversation is about.",
      },
      [AFFECTED_RESOURCES_ARGUMENT_NAME]: AFFECTED_RESOURCES_ARGUMENT_SCHEMA,
    },
  },
  get requiredPermissions(): Array<Permission> {
    return resolveUpdatePermissions();
  },
  isMutation: true,
  buildActionTitle: (args: JSONObject): string => {
    const incidentId: string | undefined = ToolArgs.getString(
      args,
      "incidentId",
    );

    return incidentId
      ? `Link incident ${incidentId} to affected resources`
      : "Link this incident to affected resources";
  },
  prepareMutation: async (
    args: JSONObject,
    ctx: ToolContext,
  ): Promise<PreparedMutation> => {
    const incidentId: ObjectID | undefined = getIncidentId(args, ctx);

    const prepared: JSONObject = {
      ...AffectedResourceLinks.withPageResourceWrittenOut({ args, ctx }),
      ...(incidentId ? { incidentId: incidentId.toString() } : {}),
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
    const incidentId: ObjectID | undefined = getIncidentId(args, ctx);

    if (!incidentId) {
      throw new BadDataException(
        "incidentId is required. Use query_incidents to find it first.",
      );
    }

    if (!ctx.props.userId) {
      throw new BadDataException(
        "No authenticated user in context; cannot change the incident.",
      );
    }

    // The incident as the person reads it, for the answer below.
    const incident: Incident | null = await IncidentService.findOneById({
      id: incidentId,
      select: { _id: true, incidentNumber: true, title: true },
      props: ctx.props,
    });

    if (!incident) {
      throw new BadDataException(
        "Incident not found (or you do not have access to it).",
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
     * What the incident lists already, of the kinds being added - read as
     * OneUptime for the incident the person's own read returned: a list is
     * written whole, and a link the person may not view must stay.
     */
    const relations: Array<AiAffectedResourceRelation> =
      AffectedResourceLinks.getRelationsOf(toLink.linked);
    const select: JSONObject = { _id: true };

    for (const relation of relations) {
      select[relation] = { _id: true };
    }

    const held: Incident | null = await IncidentService.findOneById({
      id: incidentId,
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
       * Edited as the person, as the incident's Affected Resources Edit
       * edits it: an incident they may read but not change changes
       * nothing, and they are told so.
       */
      const updatedCount: number = await IncidentService.updateOneById({
        id: incidentId,
        data: lists.lists as never,
        props: ctx.props,
      });

      if (updatedCount === 0) {
        throw await IncidentService.getUnwrittenByIdError({
          id: incidentId,
          props: ctx.props,
          type: DatabaseRequestType.Update,
        });
      }
    }

    const incidentIdString: string = incidentId.toString();

    const serialized: SerializedResult = ToolResultSerializer.serializeRows([
      {
        incidentNumber: incident.incidentNumber,
        added: AffectedResourceLinks.describeForWidget(lists.added),
        alreadyLinked: AffectedResourceLinks.describeForWidget(
          lists.alreadyLinked,
        ),
      },
    ]);

    const lines: Array<string> = [
      lists.added.length > 0
        ? `Linked incident #${incident.incidentNumber} ("${incident.title}") to ${AffectedResourceLinks.describeForWidget(lists.added)}.`
        : `Incident #${incident.incidentNumber} ("${incident.title}") was linked to all of these already; nothing changed.`,
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
        "If OneUptime AI found nothing to fix on this incident because it was linked to nothing, it tries again now, under the project's AI rules and each resource's own fix settings.",
      );
    }

    return {
      dataForLlm: `${lines.join("\n")}\n${serialized.text}`,
      rowCount: lists.added.length,
      citationLabel: `Linked incident #${incident.incidentNumber}`,
      citationTarget: {
        type: AIChatCitationTargetType.IncidentView,
        params: { incidentId: incidentIdString },
      },
      redactionCount: serialized.redactionCount,
      isTruncated: false,
      widget: WidgetBuilder.resourceCard({
        title: "Affected resources linked",
        resourceType: "Incident",
        heading: `#${incident.incidentNumber} · ${incident.title}`,
        fields: [
          { label: "Number", value: `#${incident.incidentNumber ?? ""}` },
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
          type: AIChatCitationTargetType.IncidentView,
          params: { incidentId: incidentIdString },
        },
      }),
    };
  },
};

async function changeIncidentStateTool(data: {
  args: JSONObject;
  ctx: ToolContext;
  verb: "acknowledge" | "resolve";
}): Promise<ToolExecutionResult> {
  const { args, ctx, verb } = data;

  const incidentId: ObjectID | undefined = ToolArgs.getObjectID(
    args,
    "incidentId",
  );
  if (!incidentId) {
    throw new BadDataException(
      "incidentId is required. Use query_incidents to find it first.",
    );
  }

  if (!ctx.props.userId) {
    throw new BadDataException(
      "No authenticated user in context; cannot change the incident.",
    );
  }

  // The incident as the person reads it, for the answer below.
  const incident: Incident | null = await IncidentService.findOneById({
    id: incidentId,
    select: {
      _id: true,
      incidentNumber: true,
      title: true,
    },
    props: ctx.props,
  });

  if (!incident) {
    throw new BadDataException(
      "Incident not found (or you do not have access to it).",
    );
  }

  /*
   * The change is the incident state timeline row the dashboard's state
   * panel creates, created as the person who asked
   * (WorkspaceMemberActions): held to their permission to change the
   * incident's state, their labels and owners and the project's plan, and
   * credited to them in the incident's timeline and feed.
   */
  const event: WorkspaceEvent = {
    type: WorkspaceEventType.Incident,
    id: incidentId,
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

  const incidentIdString: string = incidentId.toString();

  const serialized: SerializedResult = ToolResultSerializer.serializeRows([
    {
      id: incidentIdString,
      incidentNumber: incident.incidentNumber,
      title: incident.title,
      newState: newStateName,
    },
  ]);

  return {
    dataForLlm: `Incident #${incident.incidentNumber} ("${incident.title}") is now ${newStateName}.\n${serialized.text}`,
    rowCount: 1,
    citationLabel: `${newStateName} incident #${incident.incidentNumber}`,
    citationTarget: {
      type: AIChatCitationTargetType.IncidentView,
      params: { incidentId: incidentIdString },
    },
    redactionCount: serialized.redactionCount,
    isTruncated: false,
    widget: WidgetBuilder.resourceCard({
      title: `Incident ${newStateName.toLowerCase()}`,
      resourceType: "Incident",
      heading: `#${incident.incidentNumber} · ${incident.title}`,
      subheading: `Now ${newStateName}`,
      fields: [
        { label: "Number", value: `#${incident.incidentNumber ?? ""}` },
        { label: "State", value: newStateName },
      ],
      link: {
        type: AIChatCitationTargetType.IncidentView,
        params: { incidentId: incidentIdString },
      },
    }),
  };
}

export const AcknowledgeIncidentTool: ObservabilityTool = {
  name: "acknowledge_incident",
  description:
    "Acknowledge an incident (move it to the acknowledged state) by its incidentId. Find the incidentId with query_incidents first.",
  inputSchema: {
    type: "object",
    properties: {
      incidentId: {
        type: "string",
        description: "The incident's ID (required).",
      },
    },
    required: ["incidentId"],
  },
  get requiredPermissions(): Array<Permission> {
    return resolveStateChangePermissions();
  },
  isMutation: true,
  buildActionTitle: (args: JSONObject): string => {
    return `Acknowledge incident ${ToolArgs.getString(args, "incidentId") || ""}`.trim();
  },
  execute: async (
    args: JSONObject,
    ctx: ToolContext,
  ): Promise<ToolExecutionResult> => {
    return changeIncidentStateTool({ args, ctx, verb: "acknowledge" });
  },
};

export const ResolveIncidentTool: ObservabilityTool = {
  name: "resolve_incident",
  description:
    "Resolve an incident (move it to the resolved state) by its incidentId. Find the incidentId with query_incidents first.",
  inputSchema: {
    type: "object",
    properties: {
      incidentId: {
        type: "string",
        description: "The incident's ID (required).",
      },
    },
    required: ["incidentId"],
  },
  get requiredPermissions(): Array<Permission> {
    return resolveStateChangePermissions();
  },
  isMutation: true,
  buildActionTitle: (args: JSONObject): string => {
    return `Resolve incident ${ToolArgs.getString(args, "incidentId") || ""}`.trim();
  },
  execute: async (
    args: JSONObject,
    ctx: ToolContext,
  ): Promise<ToolExecutionResult> => {
    return changeIncidentStateTool({ args, ctx, verb: "resolve" });
  },
};

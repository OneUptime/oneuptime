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
import IncidentStateService from "../../../Services/IncidentStateService";
import IncidentState from "../../../../Models/DatabaseModels/IncidentState";
import { StateListType } from "../../../../Utils/StateOrder";
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
import {
  AI_ACTION_CARD_KINDS,
  AI_ACTION_CARD_LINES,
  AI_ACTION_TERMS,
  AI_ACTION_TITLES,
  AIActionSentence,
  aiActionSentence,
  aiActionTerm,
} from "../../../../Types/AI/AIActionWords";
import DatabaseRequestType from "../../../Types/BaseDatabase/DatabaseRequestType";
import {
  getIncidentNumberForPerson,
  getIncidentNumberText,
  getRecordTitleName,
  prepareRecordNamesInTitle,
  RecordNames,
} from "./RecordNamesForPerson";
import {
  asksForStart,
  describeLinkingCard,
  describeNewRecordCard,
  describeNewRecordForPerson,
  describeSeverityNotFound,
  describeStartForModel,
  getDescribedNewRecordArguments,
  getInitialStateArgumentSchema,
  getInvalidStartMessage,
  INITIAL_STATE_ARGUMENT_NAME,
  NewRecordStart,
  pickNamedSeverity,
  pickStartState,
  readRequestedStart,
  RequestedStart,
  SeverityChoice,
  withStartWrittenOut,
} from "./NewRecords";

import FeedMarkdown from "../../../../Utils/Markdown/FeedMarkdown";
import NewIncidentSubscriberNotificationDefaultReader from "../../StatusPage/NewIncidentSubscriberNotificationDefaultReader";
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
 * The severities a new incident may take, in the project's order - never
 * an archived one - read as the person: what the dashboard's Declare
 * Incident form offers them.
 */
async function readIncidentSeverities(
  ctx: ToolContext,
): Promise<Array<IncidentSeverity>> {
  return await IncidentSeverityService.findBy({
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

// The severity a new incident takes, and whether it is the one the call named.
export type IncidentSeverityChoice = SeverityChoice<IncidentSeverity>;

/*
 * The severity a new incident takes: the one the call names, matched
 * without regard to case or the spaces around it, else the project's
 * first - as create_alert picks an alert's (NewRecords). Null when the
 * project has none.
 */
export function pickIncidentSeverity(data: {
  severities: Array<IncidentSeverity>;
  severityName: string | undefined;
}): IncidentSeverityChoice | null {
  return pickNamedSeverity(data);
}

/*
 * The severity a call gives its incident, by its name in the project, for
 * the arguments the person approves and the card's line: the call's own,
 * or the project's first when it names none, or one the project does not
 * have - as create_alert says its alert's. Null when the person may not
 * read the severities or the project has none: running the action then
 * says why.
 */
async function getIncidentSeverityNameForPerson(data: {
  args: JSONObject;
  ctx: ToolContext;
}): Promise<string | null> {
  try {
    const choice: IncidentSeverityChoice | null = pickIncidentSeverity({
      severities: await readIncidentSeverities(data.ctx),
      severityName: ToolArgs.getString(data.args, "severityName"),
    });

    return choice?.severity.name?.trim() || null;
  } catch {
    return null;
  }
}

/*
 * The approval card's line under "Create incident: <title>": the severity
 * it takes, where it starts when it is written up after the fact, then
 * what it is linked to - 'Severity: SEV2. Linked to host "test01".' - as
 * create_alert's card says its alert's (NewRecords).
 */
export function describeIncidentForPerson(data: {
  severityName: string | null;
  start?: NewRecordStart | null | undefined;
  linked: Array<AIActionSentence>;
}): Array<AIActionSentence> {
  return describeNewRecordForPerson(data);
}

/*
 * The project's incident state a new incident starts in, when the call
 * asks for a later one (NewRecords): its acknowledged or its resolved
 * state, read as OneUptime - which states those are is the project's to
 * say, as for Acknowledge and Resolve (WorkspaceMemberActions).
 */
async function getIncidentStartState(data: {
  start: NewRecordStart;
  ctx: ToolContext;
}): Promise<IncidentState> {
  const states: Array<IncidentState> =
    await IncidentStateService.getAllIncidentStates({
      projectId: data.ctx.projectId,
      props: { isRoot: true },
    });

  const state: IncidentState | null = pickStartState({
    start: data.start,
    list: StateListType.IncidentState,
    states,
  });

  if (!state || !state.id) {
    throw new BadDataException(
      `This project has no ${data.start} incident state. Add one in Incidents > Settings > Incident State first.`,
    );
  }

  return state;
}

/*
 * An acknowledge's or resolve's card title: the incident by its number,
 * once the prepare read it (RecordNamesForPerson), else by what the call
 * names - its ID - or nothing at all.
 */
function buildIncidentStateChangeTitle(
  verb: "acknowledge" | "resolve",
): (args: JSONObject, names: RecordNames) => AIActionSentence {
  return (args: JSONObject, names: RecordNames): AIActionSentence => {
    const incident: string | undefined = getRecordTitleName(
      args,
      names,
      "incidentId",
    );

    if (!incident) {
      return aiActionSentence(
        verb === "acknowledge"
          ? AI_ACTION_TITLES.acknowledgeIncidentUnnamed
          : AI_ACTION_TITLES.resolveIncidentUnnamed,
      );
    }

    return aiActionSentence(
      verb === "acknowledge"
        ? AI_ACTION_TITLES.acknowledgeIncident
        : AI_ACTION_TITLES.resolveIncident,
      { incident },
    );
  };
}

const buildAcknowledgeIncidentTitle: (
  args: JSONObject,
  names: RecordNames,
) => AIActionSentence = buildIncidentStateChangeTitle("acknowledge");

const buildResolveIncidentTitle: (
  args: JSONObject,
  names: RecordNames,
) => AIActionSentence = buildIncidentStateChangeTitle("resolve");

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
    "Declare (create) a new incident in this project. Provide a clear title and a description of the problem. Optionally set the severity by name (must match an existing incident severity); otherwise the project's first-defined severity is used. Link it to the infrastructure and services it is about with affectedResources: OneUptime AI investigates and fixes what an incident is linked to, and nothing else. Asked from a resource's page (a host, a cluster, a database, a service, ...), the incident is linked to that resource unless you pass affectedResources yourself; pass an empty list to link nothing. To write up an incident that already happened, at the user's word, set initialState: it then pages nobody. Use this when the user asks you to open, declare or create an incident.",
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
      [INITIAL_STATE_ARGUMENT_NAME]: getInitialStateArgumentSchema("incident"),
    },
    required: ["title"],
  },
  get requiredPermissions(): Array<Permission> {
    return resolveCreatePermissions();
  },
  /*
   * An incident that starts acknowledged or resolved is an incident
   * declared and then acknowledged or resolved, paging nobody: it takes the
   * permission to change an incident's state too, as acknowledge_incident
   * does (NewRecords).
   */
  getRequiredPermissionGroups: (args: JSONObject): Array<Array<Permission>> => {
    return asksForStart(args)
      ? [resolveCreatePermissions(), resolveStateChangePermissions()]
      : [resolveCreatePermissions()];
  },
  isMutation: true,
  buildActionTitle: (args: JSONObject): AIActionSentence => {
    return aiActionSentence(AI_ACTION_TITLES.createIncident, {
      title:
        ToolArgs.getString(args, "title") ||
        aiActionTerm(AI_ACTION_TERMS.untitled),
    });
  },
  /*
   * The page's resource written out (the incident is declared from it),
   * the severity it takes by name, where it starts when it starts later,
   * and what every resource it names is, for the approval card - as
   * create_alert prepares its alert.
   */
  prepareMutation: async (
    args: JSONObject,
    ctx: ToolContext,
  ): Promise<PreparedMutation> => {
    const prepared: JSONObject = withStartWrittenOut(
      AffectedResourceLinks.withPageResourceWrittenOut({ args, ctx }),
    );

    const toLink: AffectedResourcesToLink =
      await AffectedResourceLinks.resolveForCall({
        args: prepared,
        ctx,
        defaultsToPage: false,
      });

    const severityName: string | null = await getIncidentSeverityNameForPerson({
      args: prepared,
      ctx,
    });

    const preparedArguments: JSONObject = severityName
      ? { ...prepared, severityName }
      : prepared;

    return {
      arguments: preparedArguments,
      describedArguments: getDescribedNewRecordArguments(preparedArguments),
      description: describeIncidentForPerson({
        severityName,
        start: readRequestedStart(prepared).start,
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
      throw new BadDataException("title is required to create an incident.");
    }

    const description: string = ToolArgs.getString(args, "description") || "";

    const userId: ObjectID | undefined = ctx.props.userId;
    if (!userId) {
      throw new BadDataException(
        "No authenticated user in context; cannot create an incident.",
      );
    }

    // Where it starts: where every new incident does, unless the call asks later.
    const requestedStart: RequestedStart = readRequestedStart(args);

    if (requestedStart.isInvalid) {
      throw new BadDataException(getInvalidStartMessage("incident"));
    }

    // The severities a new incident may take: never an archived one.
    const severities: Array<IncidentSeverity> =
      await readIncidentSeverities(ctx);
    const severityName: string | undefined = ToolArgs.getString(
      args,
      "severityName",
    );
    const choice: IncidentSeverityChoice | null = pickIncidentSeverity({
      severities,
      severityName,
    });

    if (!choice) {
      throw new BadDataException(
        "No incident severities are configured for this project. Add one in Incidents > Settings > Incident Severity first.",
      );
    }

    const severity: IncidentSeverity = choice.severity;

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

    /*
     * The project's acknowledged or resolved state: IncidentService places
     * it (StartingStage), so the incident pages nobody and, resolved,
     * nothing answers it as a live problem.
     */
    const startState: IncidentState | null = requestedStart.start
      ? await getIncidentStartState({ start: requestedStart.start, ctx })
      : null;

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

    if (startState) {
      incident.currentIncidentStateId = startState.id!;
    }
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

    /*
     * The approval card asks nothing about status page subscribers, so they
     * are told as the project starts "Notify Status Page Subscribers" on
     * Declare New Incident (Incidents > Settings > Subscriber
     * Notifications): unticked there, declared here without notifying.
     */
    await NewIncidentSubscriberNotificationDefaultReader.applyToIncidentDeclaredWithoutBox(
      {
        incident: incident,
        projectId: ctx.projectId,
      },
    );

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

    const startText: string = describeStartForModel(
      requestedStart.start,
      "incident",
    );

    // Said when the severity it named is not one of the project's, as for an alert.
    const severityText: string =
      severityName && !choice.isNamed
        ? describeSeverityNotFound({
            noun: "incident",
            severityName,
            taken: severity.name || "",
            severities,
          })
        : "";

    return {
      dataForLlm: `Successfully created incident #${created.incidentNumber} ("${title}", severity ${severity.name}).${
        startText ? `\n${startText}` : ""
      }${severityText ? `\n${severityText}` : ""}${
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
      widget: WidgetBuilder.actionCard({
        title: "Incident created",
        heading: `${getIncidentNumberText(created)} · ${title}`,
        words: describeNewRecordCard({
          kind: AI_ACTION_CARD_KINDS.incident,
          severityName: severity.name,
          start: requestedStart.start,
          linked: toLink.linked,
          description,
        }),
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
  buildActionTitle: (args: JSONObject): AIActionSentence => {
    const incidentId: string | undefined = ToolArgs.getString(
      args,
      "incidentId",
    );

    return incidentId
      ? aiActionSentence(AI_ACTION_TITLES.linkIncident, {
          incident: incidentId,
        })
      : aiActionSentence(AI_ACTION_TITLES.linkThisIncident);
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

    /*
     * The card names the incident by its number: written out, its ID
     * would otherwise be all buildActionTitle can name it by.
     */
    const incidentNumber: string | null = incidentId
      ? await getIncidentNumberForPerson({ incidentId, ctx })
      : null;

    return {
      arguments: prepared,
      ...(incidentNumber
        ? {
            title: aiActionSentence(AI_ACTION_TITLES.linkIncident, {
              incident: incidentNumber,
            }),
            namedArguments: ["incidentId"],
          }
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
      select: {
        _id: true,
        incidentNumber: true,
        incidentNumberWithPrefix: true,
        title: true,
      },
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
      widget: WidgetBuilder.actionCard({
        title: "Affected resources linked",
        heading: `${getIncidentNumberText(incident)} · ${incident.title}`,
        words: describeLinkingCard({
          kind: AI_ACTION_CARD_KINDS.incident,
          added: lists.added,
          alreadyLinked: lists.alreadyLinked,
        }),
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
      incidentNumberWithPrefix: true,
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
    // The heading and the line under it say the number and the state.
    widget: WidgetBuilder.actionCard({
      title: `Incident ${newStateName.toLowerCase()}`,
      heading: `${getIncidentNumberText(incident)} · ${incident.title}`,
      words: {
        kind: aiActionTerm(AI_ACTION_CARD_KINDS.incident),
        line: [
          aiActionSentence(
            verb === "acknowledge"
              ? AI_ACTION_CARD_LINES.nowAcknowledged
              : AI_ACTION_CARD_LINES.nowResolved,
          ),
        ],
      },
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
  buildActionTitle: (args: JSONObject): AIActionSentence => {
    return buildAcknowledgeIncidentTitle(args, {});
  },
  // The incident by its number, as the person knows it.
  prepareMutation: prepareRecordNamesInTitle({
    keys: ["incidentId"],
    buildTitle: buildAcknowledgeIncidentTitle,
  }),
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
  buildActionTitle: (args: JSONObject): AIActionSentence => {
    return buildResolveIncidentTitle(args, {});
  },
  // The incident by its number, as the person knows it.
  prepareMutation: prepareRecordNamesInTitle({
    keys: ["incidentId"],
    buildTitle: buildResolveIncidentTitle,
  }),
  execute: async (
    args: JSONObject,
    ctx: ToolContext,
  ): Promise<ToolExecutionResult> => {
    return changeIncidentStateTool({ args, ctx, verb: "resolve" });
  },
};

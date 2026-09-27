import ScheduledMaintenanceInternalNote from "../../../../../Models/DatabaseModels/ScheduledMaintenanceInternalNote";
import ScheduledMaintenancePublicNote from "../../../../../Models/DatabaseModels/ScheduledMaintenancePublicNote";
import ScheduledMaintenanceState from "../../../../../Models/DatabaseModels/ScheduledMaintenanceState";
import ScheduledMaintenanceStateTimeline from "../../../../../Models/DatabaseModels/ScheduledMaintenanceStateTimeline";
import DatabaseCommonInteractionProps from "../../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import Search from "../../../../../Types/BaseDatabase/Search";
import SortOrder from "../../../../../Types/BaseDatabase/SortOrder";
import BadDataException from "../../../../../Types/Exception/BadDataException";
import NotAuthorizedException from "../../../../../Types/Exception/NotAuthorizedException";
import ObjectID from "../../../../../Types/ObjectID";
import ScheduledMaintenanceService from "../../../../Services/ScheduledMaintenanceService";
import ScheduledMaintenanceInternalNoteService from "../../../../Services/ScheduledMaintenanceInternalNoteService";
import ScheduledMaintenancePublicNoteService from "../../../../Services/ScheduledMaintenancePublicNoteService";
import ScheduledMaintenanceStateService from "../../../../Services/ScheduledMaintenanceStateService";
import WorkspaceActionAuthorization from "../../WorkspaceActionAuthorization";
import {
  DiscordActionModuleRegistration,
  DiscordActionRequest,
  DiscordActionResult,
  DiscordChoicePage,
  DiscordChoiceQuery,
  DiscordHandlerResponseMode,
  DiscordInteractionKind,
  DiscordStringSelectOption,
} from "./Types";

function selectedId(value: string | undefined, label: string): ObjectID {
  if (!value || !ObjectID.isValidUUID(value)) {
    throw new BadDataException(`Choose a valid ${label}.`);
  }
  return new ObjectID(value);
}

async function authorizeState(
  request: DiscordActionRequest,
  stateId?: ObjectID,
): Promise<DatabaseCommonInteractionProps> {
  const id: ObjectID = selectedId(
    request.resourceId?.toString(),
    "maintenance event",
  );
  return WorkspaceActionAuthorization.authorize({
    projectId: request.context.projectId,
    userId: request.context.userId,
    modelType: ScheduledMaintenanceStateTimeline,
    action: "change this maintenance event's state",
    resources: [
      { service: ScheduledMaintenanceService, id },
      ...(stateId
        ? [{ service: ScheduledMaintenanceStateService, id: stateId }]
        : []),
    ],
  });
}

async function mutate(
  request: DiscordActionRequest,
): Promise<DiscordActionResult> {
  const id: ObjectID = selectedId(
    request.resourceId?.toString(),
    "maintenance event",
  );
  if (request.action === "SubmitScheduledMaintenanceNote") {
    const note: string | undefined = request.values["note"];
    const visibility: string | undefined = request.values["noteType"];
    if (!note?.trim() || note.length > 4000) {
      throw new BadDataException("Note must contain 1–4000 characters.");
    }
    if (visibility !== "public" && visibility !== "private") {
      throw new BadDataException("Choose a public or private note.");
    }
    await WorkspaceActionAuthorization.authorize({
      projectId: request.context.projectId,
      userId: request.context.userId,
      modelType:
        visibility === "public"
          ? ScheduledMaintenancePublicNote
          : ScheduledMaintenanceInternalNote,
      action: `add a ${visibility} maintenance note`,
      resources: [{ service: ScheduledMaintenanceService, id }],
    });
    const data: {
      scheduledMaintenanceId: ObjectID;
      projectId: ObjectID;
      userId: ObjectID;
      note: string;
    } = {
      scheduledMaintenanceId: id,
      projectId: request.context.projectId,
      userId: request.context.userId,
      note,
    };
    if (visibility === "public") {
      await ScheduledMaintenancePublicNoteService.addNote(data);
    } else {
      await ScheduledMaintenanceInternalNoteService.addNote(data);
    }
    return {
      kind: "message",
      content:
        visibility === "public" ? "Public note added." : "Private note added.",
      ephemeral: true,
    };
  }
  if (
    ![
      "MarkScheduledMaintenanceAsOngoing",
      "MarkScheduledMaintenanceAsComplete",
      "SubmitChangeScheduledMaintenanceState",
    ].includes(request.action)
  ) {
    throw new BadDataException(
      "This Discord maintenance action is not supported.",
    );
  }
  const stateId: ObjectID | undefined =
    request.action === "SubmitChangeScheduledMaintenanceState"
      ? selectedId(request.values["stateId"], "state")
      : undefined;
  const props: DatabaseCommonInteractionProps = await authorizeState(
    request,
    stateId,
  );
  if (stateId) {
    /*
     * The generic update hook replaces actor props with root props. Use the
     * timeline service entry point to preserve attribution and notifications.
     */
    await ScheduledMaintenanceService.changeScheduledMaintenanceState({
      projectId: request.context.projectId,
      scheduledMaintenanceId: id,
      scheduledMaintenanceStateId: stateId,
      shouldNotifyStatusPageSubscribers: true,
      isSubscribersNotified: false,
      notifyOwners: true,
      props,
    });
  } else if (request.action === "MarkScheduledMaintenanceAsOngoing") {
    await ScheduledMaintenanceService.markScheduledMaintenanceAsOngoing(
      id,
      request.context.userId,
    );
  } else {
    await ScheduledMaintenanceService.markScheduledMaintenanceAsComplete(
      id,
      request.context.userId,
    );
  }
  return {
    kind: "message",
    content: "Maintenance state updated.",
    ephemeral: true,
  };
}

async function noteModal(
  request: DiscordActionRequest,
): Promise<DiscordActionResult> {
  const id: ObjectID = selectedId(
    request.resourceId?.toString(),
    "maintenance event",
  );
  const props: DatabaseCommonInteractionProps =
    await WorkspaceActionAuthorization.getProjectMemberProps(request.context);
  const options: Array<DiscordStringSelectOption> = [];
  for (const visibility of ["private", "public"] as const) {
    try {
      await WorkspaceActionAuthorization.assertCanCreate({
        props,
        modelType:
          visibility === "public"
            ? ScheduledMaintenancePublicNote
            : ScheduledMaintenanceInternalNote,
        action: `add a ${visibility} maintenance note`,
        resources: [{ service: ScheduledMaintenanceService, id }],
      });
      options.push({
        label: visibility === "public" ? "Public" : "Private",
        value: visibility,
      });
    } catch (error) {
      if (!(error instanceof NotAuthorizedException)) {
        throw error;
      }
    }
  }
  if (!options.length) {
    throw new NotAuthorizedException(
      "You do not have permission to add notes to this maintenance event.",
    );
  }
  return {
    kind: "modal",
    modal: {
      customId: `SubmitScheduledMaintenanceNote:${id}`,
      title: "Add maintenance note",
      fields: [
        {
          kind: "string-select",
          customId: "noteType",
          label: "Note visibility",
          required: true,
          options,
        },
        {
          kind: "text",
          customId: "note",
          label: "Note",
          style: "paragraph",
          required: true,
          minLength: 1,
          maxLength: 4000,
        },
      ],
    },
  };
}

async function stateChoices(
  query: DiscordChoiceQuery,
): Promise<DiscordChoicePage> {
  const skip: number = query.cursor ? Number(query.cursor) : 0;
  const cursorPattern: RegExp = /^\d+$/;
  if (
    !Number.isInteger(query.limit) ||
    query.limit < 1 ||
    query.limit > 25 ||
    !Number.isSafeInteger(skip) ||
    skip < 0 ||
    (query.cursor && !cursorPattern.test(query.cursor)) ||
    (query.search?.length || 0) > 100
  ) {
    throw new BadDataException("Invalid Discord selection page.");
  }
  const props: DatabaseCommonInteractionProps = await authorizeState({
    action: "",
    resourceId: query.resourceId,
    values: {},
    context: query.context,
  });
  const search: string = query.search?.trim() || "";
  const rows: Array<ScheduledMaintenanceState> =
    await ScheduledMaintenanceStateService.findBy({
      query: {
        projectId: query.context.projectId,
        ...(search ? { name: new Search(search) } : {}),
      },
      select: { _id: true, name: true },
      sort: { name: SortOrder.Ascending, _id: SortOrder.Ascending },
      skip,
      limit: query.limit + 1,
      props,
    });
  return {
    options: rows
      .slice(0, query.limit)
      .map((row: ScheduledMaintenanceState): DiscordStringSelectOption => {
        return {
          label: String(row.name || "Unnamed").slice(0, 100),
          value: row.id!.toString(),
        };
      }),
    ...(skip
      ? { previousCursor: String(Math.max(0, skip - query.limit)) }
      : {}),
    ...(rows.length > query.limit
      ? { nextCursor: String(skip + query.limit) }
      : {}),
  };
}

export const DiscordScheduledMaintenanceActionModule: DiscordActionModuleRegistration =
  {
    handlers: [
      {
        actions: [
          "MarkScheduledMaintenanceAsOngoing",
          "MarkScheduledMaintenanceAsComplete",
          "SubmitScheduledMaintenanceNote",
          "SubmitChangeScheduledMaintenanceState",
        ],
        interactionKinds: [
          DiscordInteractionKind.MessageComponent,
          DiscordInteractionKind.ModalSubmit,
        ],
        responseMode: DiscordHandlerResponseMode.Deferred,
        handle: mutate,
      },
      {
        actions: ["ViewAddScheduledMaintenanceNote"],
        interactionKinds: [DiscordInteractionKind.MessageComponent],
        responseMode: DiscordHandlerResponseMode.Immediate,
        handle: noteModal,
      },
      {
        actions: ["ViewChangeScheduledMaintenanceState"],
        interactionKinds: [DiscordInteractionKind.MessageComponent],
        responseMode: DiscordHandlerResponseMode.Deferred,
        handle: async (
          request: DiscordActionRequest,
        ): Promise<DiscordActionResult> => {
          await authorizeState(request);
          return {
            kind: "picker",
            picker: {
              provider: "scheduled-maintenance-states",
              submitAction: "SubmitChangeScheduledMaintenanceState",
              field: "stateId",
              title: "Change maintenance state",
              resourceId: request.resourceId,
            },
          };
        },
      },
    ],
    choiceProviders: [
      { name: "scheduled-maintenance-states", getPage: stateChoices },
    ],
  };

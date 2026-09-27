import DatabaseBaseModel, {
  DatabaseBaseModelType,
} from "../../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import OnCallDutyPolicyExecutionLog from "../../../../../Models/DatabaseModels/OnCallDutyPolicyExecutionLog";
import DatabaseCommonInteractionProps from "../../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import BadDataException from "../../../../../Types/Exception/BadDataException";
import ObjectID from "../../../../../Types/ObjectID";
import UserNotificationEventType from "../../../../../Types/UserNotification/UserNotificationEventType";
import DatabaseService from "../../../../Services/DatabaseService";
import OnCallDutyPolicyService from "../../../../Services/OnCallDutyPolicyService";
import WorkspaceActionAuthorization from "../../WorkspaceActionAuthorization";
import { DiscordActionRequest, DiscordActionResult } from "./Types";

export interface DiscordResponderMutationContext {
  resourceId: ObjectID;
  projectId: ObjectID;
  userId: ObjectID;
  props: DatabaseCommonInteractionProps;
}

export interface DiscordResponderDefinition {
  name: "Incident" | "Alert" | "IncidentEpisode" | "AlertEpisode";
  label: string;
  service: DatabaseService<DatabaseBaseModel>;
  stateService: DatabaseService<DatabaseBaseModel>;
  timelineModel: DatabaseBaseModelType;
  internalNoteModel: DatabaseBaseModelType;
  publicNoteModel?: DatabaseBaseModelType | undefined;
  acknowledge: (context: DiscordResponderMutationContext) => Promise<void>;
  resolve: (context: DiscordResponderMutationContext) => Promise<void>;
  changeState: (
    context: DiscordResponderMutationContext,
    stateId: ObjectID,
  ) => Promise<void>;
  assertCanUpdate?:
    | ((context: DiscordResponderMutationContext) => Promise<void>)
    | undefined;
  addInternalNote: (
    context: DiscordResponderMutationContext,
    note: string,
  ) => Promise<void>;
  addPublicNote?:
    | ((
        context: DiscordResponderMutationContext,
        note: string,
      ) => Promise<void>)
    | undefined;
  policyTrigger:
    | "triggeredByIncidentId"
    | "triggeredByAlertId"
    | "triggeredByIncidentEpisodeId"
    | "triggeredByAlertEpisodeId";
  notificationEvent: UserNotificationEventType;
}

/** Domain operations shared by the four responder families, independent of HTTP. */
export default class DiscordResponderAction {
  public constructor(public readonly definition: DiscordResponderDefinition) {}

  public async execute(
    request: DiscordActionRequest,
  ): Promise<DiscordActionResult> {
    const definition: DiscordResponderDefinition = this.definition;
    const actions: Array<string> = [
      `Acknowledge${definition.name}`,
      `Resolve${definition.name}`,
      `Submit${definition.name}Note`,
      `SubmitChange${definition.name}State`,
      `SubmitExecute${definition.name}OnCallPolicy`,
    ];
    if (!actions.includes(request.action)) {
      throw new BadDataException("This Discord action is not supported.");
    }
    const resourceId: ObjectID = this.resourceId(request);
    // A form is not a permission grant. Rebuild membership on every submission.
    const props: DatabaseCommonInteractionProps =
      await WorkspaceActionAuthorization.getProjectMemberProps({
        projectId: request.context.projectId,
        userId: request.context.userId,
      });
    const context: DiscordResponderMutationContext = {
      resourceId,
      projectId: request.context.projectId,
      userId: request.context.userId,
      props,
    };

    if (request.action === `Submit${definition.name}Note`) {
      const note: string = this.text(request.values["note"], "Note", 4000);
      const noteType: string | undefined =
        request.values["noteType"] ||
        (definition.publicNoteModel ? undefined : "private");
      if (noteType !== "public" && noteType !== "private") {
        throw new BadDataException("Choose a public or private note.");
      }
      if (
        noteType === "public" &&
        (!definition.publicNoteModel || !definition.addPublicNote)
      ) {
        throw new BadDataException(
          `Public notes are not supported for this ${definition.label}.`,
        );
      }
      await WorkspaceActionAuthorization.assertCanCreate({
        props,
        modelType:
          noteType === "public"
            ? definition.publicNoteModel!
            : definition.internalNoteModel,
        action: `add a ${noteType} note to this ${definition.label}`,
        resources: [{ service: definition.service, id: resourceId }],
      });
      if (noteType === "public") {
        await definition.addPublicNote!(context, note);
      } else {
        await definition.addInternalNote(context, note);
      }
      return {
        kind: "message",
        content: `${noteType === "public" ? "Public" : "Private"} note added.`,
        ephemeral: true,
      };
    }

    if (request.action === `SubmitExecute${definition.name}OnCallPolicy`) {
      const policyId: ObjectID = this.selectedId(
        request.values["onCallPolicyId"],
        "on-call policy",
      );
      await WorkspaceActionAuthorization.assertCanCreate({
        props,
        modelType: OnCallDutyPolicyExecutionLog,
        action: `execute an on-call policy for this ${definition.label}`,
        resources: [
          { service: definition.service, id: resourceId },
          { service: OnCallDutyPolicyService, id: policyId },
        ],
      });
      await OnCallDutyPolicyService.executePolicy(policyId, {
        [definition.policyTrigger]: resourceId,
        userNotificationEventType: definition.notificationEvent,
      });
      return {
        kind: "message",
        content: "On-call policy executed.",
        ephemeral: true,
      };
    }

    const stateId: ObjectID | undefined =
      request.action === `SubmitChange${definition.name}State`
        ? this.selectedId(request.values["stateId"], "state")
        : undefined;
    await WorkspaceActionAuthorization.assertCanCreate({
      props,
      modelType: definition.timelineModel,
      action: `change the state of this ${definition.label}`,
      resources: [
        { service: definition.service, id: resourceId },
        ...(stateId ? [{ service: definition.stateService, id: stateId }] : []),
      ],
    });
    if (definition.assertCanUpdate) {
      await definition.assertCanUpdate(context);
    }
    if (stateId) {
      await definition.changeState(context, stateId);
    } else if (request.action === `Acknowledge${definition.name}`) {
      await definition.acknowledge(context);
    } else {
      await definition.resolve(context);
    }
    return {
      kind: "message",
      content: `${definition.label.charAt(0).toUpperCase() + definition.label.slice(1)} state updated.`,
      ephemeral: true,
    };
  }

  private resourceId(request: DiscordActionRequest): ObjectID {
    return this.selectedId(request.resourceId?.toString(), "resource");
  }

  private selectedId(value: unknown, label: string): ObjectID {
    if (typeof value !== "string" || !ObjectID.isValidUUID(value)) {
      throw new BadDataException(`Choose a valid ${label}.`);
    }
    return new ObjectID(value);
  }

  private text(value: unknown, label: string, maxLength: number): string {
    if (
      typeof value !== "string" ||
      !value.trim() ||
      value.length > maxLength
    ) {
      throw new BadDataException(
        `${label} must contain 1–${maxLength} characters.`,
      );
    }
    return value;
  }
}

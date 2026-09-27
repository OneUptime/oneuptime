import DatabaseBaseModel, {
  DatabaseBaseModelType,
} from "../../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import OnCallDutyPolicyExecutionLog from "../../../../../Models/DatabaseModels/OnCallDutyPolicyExecutionLog";
import DatabaseCommonInteractionProps from "../../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import Search from "../../../../../Types/BaseDatabase/Search";
import SortOrder from "../../../../../Types/BaseDatabase/SortOrder";
import BadDataException from "../../../../../Types/Exception/BadDataException";
import NotAuthorizedException from "../../../../../Types/Exception/NotAuthorizedException";
import ObjectID from "../../../../../Types/ObjectID";
import DatabaseService from "../../../../Services/DatabaseService";
import OnCallDutyPolicyService from "../../../../Services/OnCallDutyPolicyService";
import Query from "../../../../Types/Database/Query";
import Select from "../../../../Types/Database/Select";
import Sort from "../../../../Types/Database/Sort";
import WorkspaceActionAuthorization from "../../WorkspaceActionAuthorization";
import DiscordResponderAction, {
  DiscordResponderDefinition,
} from "./ResponderAction";
import {
  DiscordActionModuleRegistration,
  DiscordActionRequest,
  DiscordActionResult,
  DiscordChoicePage,
  DiscordChoiceQuery,
  DiscordHandlerResponseMode,
  DiscordInteractionKind,
  DiscordModalField,
  DiscordStringSelectOption,
} from "./Types";

/** Connect one responder family to Discord-native forms and bounded selectors. */
export default class DiscordResponderForms {
  public static register(
    actions: DiscordResponderAction,
  ): DiscordActionModuleRegistration {
    const definition: DiscordResponderDefinition = actions.definition;
    const prefix: string = definition.name
      .replace(/([a-z])([A-Z])/g, "$1-$2")
      .toLowerCase();
    const stateProvider: string = `${prefix}-states`;
    const policyProvider: string = `${prefix}-policies`;
    return {
      handlers: [
        {
          actions: [
            `Acknowledge${definition.name}`,
            `Resolve${definition.name}`,
            `Submit${definition.name}Note`,
            `SubmitChange${definition.name}State`,
            `SubmitExecute${definition.name}OnCallPolicy`,
          ],
          interactionKinds: [
            DiscordInteractionKind.MessageComponent,
            DiscordInteractionKind.ModalSubmit,
          ],
          responseMode: DiscordHandlerResponseMode.Deferred,
          handle: async (
            request: DiscordActionRequest,
          ): Promise<DiscordActionResult> => {
            return actions.execute(request);
          },
        },
        {
          actions: [`ViewAdd${definition.name}Note`],
          interactionKinds: [DiscordInteractionKind.MessageComponent],
          responseMode: DiscordHandlerResponseMode.Immediate,
          handle: async (
            request: DiscordActionRequest,
          ): Promise<DiscordActionResult> => {
            return this.noteModal(definition, request);
          },
        },
        {
          actions: [
            `ViewChange${definition.name}State`,
            `ViewExecute${definition.name}OnCallPolicy`,
          ],
          interactionKinds: [DiscordInteractionKind.MessageComponent],
          responseMode: DiscordHandlerResponseMode.Deferred,
          handle: async (
            request: DiscordActionRequest,
          ): Promise<DiscordActionResult> => {
            const policy: boolean =
              request.action === `ViewExecute${definition.name}OnCallPolicy`;
            await this.authorizePicker(definition, request, policy);
            return {
              kind: "picker",
              picker: {
                provider: policy ? policyProvider : stateProvider,
                submitAction: policy
                  ? `SubmitExecute${definition.name}OnCallPolicy`
                  : `SubmitChange${definition.name}State`,
                field: policy ? "onCallPolicyId" : "stateId",
                title: policy
                  ? "Execute on-call policy"
                  : `Change ${definition.label} state`,
                resourceId: request.resourceId,
              },
            };
          },
        },
      ],
      choiceProviders: [
        {
          name: stateProvider,
          getPage: async (
            query: DiscordChoiceQuery,
          ): Promise<DiscordChoicePage> => {
            return this.choices(definition, query, false);
          },
        },
        {
          name: policyProvider,
          getPage: async (
            query: DiscordChoiceQuery,
          ): Promise<DiscordChoicePage> => {
            return this.choices(definition, query, true);
          },
        },
      ],
    };
  }

  private static resourceId(
    request: Pick<DiscordActionRequest, "resourceId">,
  ): ObjectID {
    if (
      !request.resourceId ||
      !ObjectID.isValidUUID(request.resourceId.toString())
    ) {
      throw new BadDataException("Choose a valid resource.");
    }
    return request.resourceId;
  }

  private static async noteModal(
    definition: DiscordResponderDefinition,
    request: DiscordActionRequest,
  ): Promise<DiscordActionResult> {
    const resourceId: ObjectID = this.resourceId(request);
    const props: DatabaseCommonInteractionProps =
      await WorkspaceActionAuthorization.getProjectMemberProps(request.context);
    const options: Array<DiscordStringSelectOption> = [];
    for (const visibility of ["private", "public"]) {
      const modelType: DatabaseBaseModelType | undefined =
        visibility === "public"
          ? definition.publicNoteModel
          : definition.internalNoteModel;
      if (!modelType) {
        continue;
      }
      try {
        await WorkspaceActionAuthorization.assertCanCreate({
          props,
          modelType,
          action: `add a ${visibility} note to this ${definition.label}`,
          resources: [{ service: definition.service, id: resourceId }],
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
        `You do not have permission to add notes to this ${definition.label}.`,
      );
    }
    const fields: Array<DiscordModalField> = [];
    if (definition.publicNoteModel) {
      fields.push({
        kind: "string-select",
        customId: "noteType",
        label: "Note visibility",
        options,
        required: true,
      });
    }
    fields.push({
      kind: "text",
      customId: "note",
      label: "Note",
      style: "paragraph",
      required: true,
      minLength: 1,
      maxLength: 4000,
    });
    return {
      kind: "modal",
      modal: {
        customId: `Submit${definition.name}Note:${resourceId}`,
        title: `Add ${definition.label} note`,
        fields,
      },
    };
  }

  private static async authorizePicker(
    definition: DiscordResponderDefinition,
    request: DiscordActionRequest,
    policy: boolean,
  ): Promise<DatabaseCommonInteractionProps> {
    const resourceId: ObjectID = this.resourceId(request);
    const props: DatabaseCommonInteractionProps =
      await WorkspaceActionAuthorization.getProjectMemberProps(request.context);
    await WorkspaceActionAuthorization.assertCanCreate({
      props,
      modelType: policy
        ? OnCallDutyPolicyExecutionLog
        : definition.timelineModel,
      action: policy
        ? `execute an on-call policy for this ${definition.label}`
        : `change the state of this ${definition.label}`,
      resources: [{ service: definition.service, id: resourceId }],
    });
    if (!policy && definition.assertCanUpdate) {
      await definition.assertCanUpdate({
        resourceId,
        projectId: request.context.projectId,
        userId: request.context.userId,
        props,
      });
    }
    return props;
  }

  private static async choices(
    definition: DiscordResponderDefinition,
    data: DiscordChoiceQuery,
    policy: boolean,
  ): Promise<DiscordChoicePage> {
    const limit: number = data.limit;
    const skip: number = data.cursor ? Number(data.cursor) : 0;
    const cursorPattern: RegExp = /^\d+$/;
    if (
      !Number.isInteger(limit) ||
      limit < 1 ||
      limit > 25 ||
      !Number.isSafeInteger(skip) ||
      skip < 0 ||
      (data.cursor && !cursorPattern.test(data.cursor)) ||
      (data.search?.length || 0) > 100
    ) {
      throw new BadDataException("Invalid Discord selection page.");
    }
    const props: DatabaseCommonInteractionProps = await this.authorizePicker(
      definition,
      {
        action: "",
        resourceId: data.resourceId,
        values: {},
        context: data.context,
      },
      policy,
    );
    const service: DatabaseService<DatabaseBaseModel> = policy
      ? OnCallDutyPolicyService
      : definition.stateService;
    const search: string = data.search?.trim() || "";
    const query: Query<DatabaseBaseModel> = {
      projectId: data.context.projectId,
      ...(search ? { name: new Search(search) } : {}),
    } as Query<DatabaseBaseModel>;
    const rows: Array<DatabaseBaseModel> = await service.findBy({
      query,
      select: { _id: true, name: true } as Select<DatabaseBaseModel>,
      sort: {
        name: SortOrder.Ascending,
        _id: SortOrder.Ascending,
      } as Sort<DatabaseBaseModel>,
      skip,
      limit: limit + 1,
      props,
    });
    return {
      options: rows
        .slice(0, limit)
        .map((row: DatabaseBaseModel): DiscordStringSelectOption => {
          return {
            label: String(row.getColumnValue("name") || "Unnamed").slice(
              0,
              100,
            ),
            value: row.id!.toString(),
          };
        }),
      ...(skip ? { previousCursor: String(Math.max(0, skip - limit)) } : {}),
      ...(rows.length > limit ? { nextCursor: String(skip + limit) } : {}),
    };
  }
}

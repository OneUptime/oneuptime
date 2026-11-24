import DataSecurityAiProposal from "../../../../../Models/DatabaseModels/DataSecurityAiProposal";
import DataSecurityCustomDataType from "../../../../../Models/DatabaseModels/DataSecurityCustomDataType";
import DatabaseCommonInteractionProps from "../../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { DataSecurityAiProposalKind } from "../../../../../Types/DataSecurity/DataSecurityAi";
import BadDataException from "../../../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../../../Types/JSON";
import ObjectID from "../../../../../Types/ObjectID";
import Permission from "../../../../../Types/Permission";
import { mdText } from "../../../../../Utils/Markdown/FeedMarkdown";
import DataSecurityCustomDataTypeService from "../../../../Services/DataSecurityCustomDataTypeService";
import { queueDataSecurityEvaluation } from "../../../DataSecurity/DataSecurityJobs";
import {
  DataSecurityAiAction,
  DataSecurityAiActor,
  DataSecurityAiChangeMade,
  DataSecurityAiChangeUndone,
  DataSecurityAiPlanOutcome,
} from "../DataSecurityAiAction";
import { holdsAnyOf } from "./StoreOwnerChanges";

/*
 * ADD A DATA TYPE ONEUPTIME AI FOUND IN THE PROJECT'S STORES (#10371).
 *
 * The proposal is a draft proven on the stores that keep it
 * (DataTypeProving). A person adds it the way they add any data type: Add
 * Data Type opens the data type form filled in with the draft, and the
 * form saves the type - with their own permission, through the same
 * checks as a type written by hand, changed first if they like. Approving
 * the proposal is that save, said of it: the change it takes is the saved
 * type (readChanges), which must be the project's, and approving it with
 * none makes nothing. It is planned for the project, never for one issue,
 * so the engine never plans it.
 *
 * Undo deletes the type, with the person's own permission to delete one:
 * scans stop finding it, and the stores' sensitivity is evaluated again.
 */

export const ADD_DATA_TYPE_FROM_FORM_MESSAGE: string =
  "A data type OneUptime AI found is added from the data type form: Add Data Type opens it filled in, and saving it adds the type. Nothing was done.";

export const ADD_DATA_TYPE_NOT_FOUND_MESSAGE: string =
  "The data type you saved could not be found in this project, so nothing was done.";

function permissionsOf(
  operation: "create" | "delete",
): Array<Permission> {
  const model: DataSecurityCustomDataType = new DataSecurityCustomDataType();

  return operation === "create"
    ? model.createRecordPermissions
    : model.deleteRecordPermissions;
}

function readCustomDataTypeId(changes: unknown): string | null {
  const id: unknown =
    changes && typeof changes === "object" && !Array.isArray(changes)
      ? (changes as JSONObject)["customDataTypeId"]
      : undefined;

  return typeof id === "string" && ObjectID.isValidUUID(id) ? id : null;
}

const AddDataTypeAction: DataSecurityAiAction = {
  kind: DataSecurityAiProposalKind.AddDataType,

  // Planned for the project's stores, never for one issue.
  appliesToCheck(_checkId: string | undefined): boolean {
    return false;
  },

  async plan(): Promise<DataSecurityAiPlanOutcome> {
    return { kind: "nothing", detail: "planned-for-the-project" };
  },

  getApproveRefusal(data: {
    props: DatabaseCommonInteractionProps;
    proposal: DataSecurityAiProposal;
  }): string | null {
    return holdsAnyOf(data.props, permissionsOf("create"))
      ? null
      : "Adding this creates a data type, and you do not have permission to create one. Ask a Project Owner or Project Admin, or for Create Custom Data Type.";
  },

  getUndoRefusal(data: {
    props: DatabaseCommonInteractionProps;
    proposal: DataSecurityAiProposal;
  }): string | null {
    return holdsAnyOf(data.props, permissionsOf("delete"))
      ? null
      : "Undoing this deletes a data type, and you do not have permission to delete one. Ask a Project Owner or Project Admin, or for Delete Custom Data Type.";
  },

  // The type the person saved from the form: the project's, and only that.
  async readChanges(data: {
    projectId: ObjectID;
    proposal: DataSecurityAiProposal;
    changes: unknown;
  }): Promise<JSONObject> {
    const id: string | null = readCustomDataTypeId(data.changes);

    if (!id) {
      throw new BadDataException(ADD_DATA_TYPE_FROM_FORM_MESSAGE);
    }

    const saved: DataSecurityCustomDataType | null =
      await DataSecurityCustomDataTypeService.findOneBy({
        query: { _id: new ObjectID(id), projectId: data.projectId },
        select: { _id: true },
        props: { isRoot: true },
      });

    if (!saved?.id) {
      throw new BadDataException(ADD_DATA_TYPE_NOT_FOUND_MESSAGE);
    }

    return { customDataTypeId: saved.id.toString() };
  },

  async apply(data: {
    projectId: ObjectID;
    proposal: DataSecurityAiProposal;
    actor: DataSecurityAiActor;
    changes?: JSONObject | undefined;
  }): Promise<DataSecurityAiChangeMade> {
    const id: string | null = readCustomDataTypeId(data.changes);

    if (!id) {
      throw new BadDataException(ADD_DATA_TYPE_FROM_FORM_MESSAGE);
    }

    // Read as the person: a type they may not read is not one they added.
    const saved: DataSecurityCustomDataType | null =
      await DataSecurityCustomDataTypeService.findOneBy({
        query: { _id: new ObjectID(id), projectId: data.projectId },
        select: { _id: true, name: true },
        props: data.actor.props,
      });

    if (!saved?.id) {
      throw new BadDataException(ADD_DATA_TYPE_NOT_FOUND_MESSAGE);
    }

    return {
      result: {
        customDataTypeId: saved.id.toString(),
        name: (saved.name || "").slice(0, 100),
      },
      summaryMarkdown:
        mdText`The data type **${saved.name || ""}** was added to Your Data Types: scans find it from their next run on.`.toString(),
    };
  },

  async undo(data: {
    projectId: ObjectID;
    proposal: DataSecurityAiProposal;
    actor: DataSecurityAiActor;
  }): Promise<DataSecurityAiChangeUndone> {
    const id: string | null = readCustomDataTypeId(data.proposal.result);

    if (id) {
      await DataSecurityCustomDataTypeService.deleteBy({
        query: { _id: new ObjectID(id), projectId: data.projectId },
        limit: 1,
        skip: 0,
        props: data.actor.props,
      });
    }

    await queueDataSecurityEvaluation(data.projectId);

    return {
      summaryMarkdown:
        mdText`The data type was deleted: scans no longer find it.`.toString(),
    };
  },
};

export default AddDataTypeAction;

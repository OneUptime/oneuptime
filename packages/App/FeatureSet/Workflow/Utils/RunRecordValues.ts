import { RunRecordTrigger, readRunRecordTrigger } from "./RunRecordTrigger";
import RunRecordSearch from "Common/Server/Utils/Workflow/RunRecordSearch";
import DatabaseCommonInteractionProps from "Common/Types/BaseDatabase/DatabaseCommonInteractionProps";
import BadDataException from "Common/Types/Exception/BadDataException";
import NotAuthorizedException from "Common/Types/Exception/NotAuthorizedException";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import {
  RUN_RECORD_ARGUMENT_ID,
  RunRecordMessages,
  RunRecordOption,
  RunRecordReference,
  RunRecordReferenceKind,
  isRunRecordId,
  parseRunRecordReference,
} from "Common/Types/Workflow/RunRecord";

/*
 * The values Run Workflow starts a run with, with the record a person named
 * turned into the record's ID - the one thing a record trigger reads.
 *
 * The panel lists the records and sends the ID of the one picked. Someone who
 * types INC-8 and presses Run before picking sends INC-8, and that is looked
 * up here, the same way the list looks it up: in the workflow's project, with
 * the caller's own permissions, by its exact ID or number. Part of a title is
 * not enough to run with, so it is refused with what to do instead. An ID is
 * passed on as it always was.
 */

type ResolveRunRecordValuesFunction = (data: {
  workflowId: ObjectID;
  projectId: ObjectID;
  props: DatabaseCommonInteractionProps;
  // What Run Workflow sent: the trigger's run values.
  values: JSONObject;
}) => Promise<JSONObject>;

export const resolveRunRecordValues: ResolveRunRecordValuesFunction =
  async (data: {
    workflowId: ObjectID;
    projectId: ObjectID;
    props: DatabaseCommonInteractionProps;
    values: JSONObject;
  }): Promise<JSONObject> => {
    const value: unknown = data.values[RUN_RECORD_ARGUMENT_ID];

    // Nothing named, or an ID: nothing to look up.
    if (
      typeof value !== "string" ||
      value.trim() === "" ||
      isRunRecordId(value)
    ) {
      return data.values;
    }

    const trigger: RunRecordTrigger | null = await readRunRecordTrigger(
      data.workflowId,
    );

    // Not a trigger that runs on a record: its values go on as they came.
    if (!trigger) {
      return data.values;
    }

    const reference: RunRecordReference = parseRunRecordReference(value);
    const singularName: string =
      trigger.service.getModel().singularName || "record";

    let record: RunRecordOption | null = null;

    try {
      record = await RunRecordSearch.resolve({
        service: trigger.service,
        projectId: data.projectId,
        props: data.props,
        search: value,
      });
    } catch (error) {
      if (error instanceof NotAuthorizedException) {
        throw new NotAuthorizedException(
          RunRecordMessages.cannotRead(
            trigger.service.getModel().pluralName || "these records",
          ),
        );
      }

      throw error;
    }

    if (!record) {
      throw new BadDataException(
        reference.kind === RunRecordReferenceKind.Number
          ? RunRecordMessages.noRecordWithNumber({
              singularName: singularName,
              text: reference.text,
            })
          : RunRecordMessages.pickFromList(singularName),
      );
    }

    return {
      ...data.values,
      [RUN_RECORD_ARGUMENT_ID]: record.id,
    };
  };

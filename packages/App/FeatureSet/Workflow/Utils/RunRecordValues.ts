import { RunRecordTrigger, readRunRecordTrigger } from "./RunRecordTrigger";
import RunRecordSearch from "Common/Server/Utils/Workflow/RunRecordSearch";
import DatabaseCommonInteractionProps from "Common/Types/BaseDatabase/DatabaseCommonInteractionProps";
import BadDataException from "Common/Types/Exception/BadDataException";
import NotAuthorizedException from "Common/Types/Exception/NotAuthorizedException";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import {
  WHAT_HAPPENED_ID,
  WhatHappenedForRun,
  getWhatHappenedForRun,
  isCreateOrUpdateTrigger,
} from "Common/Types/Workflow/CreateOrUpdateTrigger";
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
 *
 * On Create or Update also runs with What Happened: whether the run is for
 * the record being created or updated. It is read as the trigger reads it -
 * "created" when it says nothing - and anything but the two is refused here,
 * before the run is queued, rather than failing the run
 * (Types/Workflow/CreateOrUpdateTrigger).
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
    const isRecordToLookUp: boolean =
      typeof value === "string" && value.trim() !== "" && !isRunRecordId(value);

    // What Happened, which only On Create or Update reads.
    const asksWhatHappened: boolean = Object.prototype.hasOwnProperty.call(
      data.values,
      WHAT_HAPPENED_ID,
    );

    if (!isRecordToLookUp && !asksWhatHappened) {
      return data.values;
    }

    const trigger: RunRecordTrigger | null = await readRunRecordTrigger(
      data.workflowId,
    );

    // Not a trigger that runs on a record: its values go on as they came.
    if (!trigger) {
      return data.values;
    }

    let values: JSONObject = data.values;

    if (asksWhatHappened && isCreateOrUpdateTrigger(trigger.metadata)) {
      const whatHappened: WhatHappenedForRun = getWhatHappenedForRun(
        values[WHAT_HAPPENED_ID],
      );

      if (!whatHappened.whatHappened) {
        throw new BadDataException(
          whatHappened.error || "What Happened is not set.",
        );
      }

      values = {
        ...values,
        [WHAT_HAPPENED_ID]: whatHappened.whatHappened,
      };
    }

    if (!isRecordToLookUp || typeof value !== "string") {
      return values;
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
      ...values,
      [RUN_RECORD_ARGUMENT_ID]: record.id,
    };
  };

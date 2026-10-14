import { loadAllComponentMetadata } from "./ComponentMetadata";
import DatabaseService from "Common/Server/Services/DatabaseService";
import Services from "Common/Server/Services/Index";
import WorkflowService from "Common/Server/Services/WorkflowService";
import BaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Workflow from "Common/Models/DatabaseModels/Workflow";
import Dictionary from "Common/Types/Dictionary";
import ObjectID from "Common/Types/ObjectID";
import ComponentMetadata from "Common/Types/Workflow/Component";
import { getRunRecordArgument } from "Common/Types/Workflow/RunRecord";

/*
 * The trigger a workflow is run with from Run Workflow, when it acts on a
 * record - On Create, On Update or On Delete of an incident, an alert, any
 * model a workflow can watch - and the service its records are read with.
 *
 * Read from the workflow as it is saved (Workflow.triggerId, which the save
 * keeps in step with the graph), because that is the trigger a run starts
 * from: the Builder saves every change within a second.
 */

export interface RunRecordTrigger {
  metadata: ComponentMetadata;
  service: DatabaseService<BaseModel>;
}

let metadataById: Dictionary<ComponentMetadata> | null = null;

type GetMetadataFunction = (metadataId: string) => ComponentMetadata | null;

// Every step's metadata, the database ones included, built once.
const getMetadata: GetMetadataFunction = (
  metadataId: string,
): ComponentMetadata | null => {
  if (!metadataById) {
    metadataById = loadAllComponentMetadata();
  }

  return metadataById[metadataId] || null;
};

type GetRunRecordServiceFunction = (
  tableName: string,
) => DatabaseService<BaseModel> | null;

/** The service that reads a model's records, by the model's table. */
export const getRunRecordService: GetRunRecordServiceFunction = (
  tableName: string,
): DatabaseService<BaseModel> | null => {
  for (const service of Services) {
    if (
      service instanceof DatabaseService &&
      service.getModel().tableName === tableName
    ) {
      return service as unknown as DatabaseService<BaseModel>;
    }
  }

  return null;
};

type GetRunRecordTriggerFunction = (
  triggerId: string | null | undefined,
) => RunRecordTrigger | null;

/**
 * The record trigger with this step id (Workflow.triggerId), or null for a
 * trigger that does not run on a record, or for none at all.
 */
export const getRunRecordTrigger: GetRunRecordTriggerFunction = (
  triggerId: string | null | undefined,
): RunRecordTrigger | null => {
  if (!triggerId) {
    return null;
  }

  const metadata: ComponentMetadata | null = getMetadata(triggerId);

  if (!metadata || !getRunRecordArgument(metadata) || !metadata.tableName) {
    return null;
  }

  const service: DatabaseService<BaseModel> | null = getRunRecordService(
    metadata.tableName,
  );

  return service ? { metadata: metadata, service: service } : null;
};

type ReadRunRecordTriggerFunction = (
  workflowId: ObjectID,
) => Promise<RunRecordTrigger | null>;

/*
 * The saved workflow's record trigger. Read as OneUptime, and only its
 * trigger: the routes that ask have already checked that the caller may run
 * this workflow, in their own project (WorkflowRunAccess).
 */
export const readRunRecordTrigger: ReadRunRecordTriggerFunction = async (
  workflowId: ObjectID,
): Promise<RunRecordTrigger | null> => {
  const workflow: Workflow | null = await WorkflowService.findOneById({
    id: workflowId,
    select: {
      triggerId: true,
    },
    props: {
      isRoot: true,
    },
  });

  return getRunRecordTrigger(workflow?.triggerId);
};

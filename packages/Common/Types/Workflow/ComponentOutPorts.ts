/*
 * A step's outputs - the dots on the bottom of its card that connections
 * leave from - as the step is set up now.
 *
 * Nearly every step has the same outputs whatever its settings say: Success
 * and Error, Yes and No, Out. Those are its metadata's outPorts. A Switch /
 * Case step has one output per case, named after the case, and Default, so
 * its outputs come from its settings, and change as the cases are added,
 * renamed, moved and removed.
 *
 * Everything that asks what a step's outputs are - the canvas, the settings'
 * Outputs list, the graph checks, the builder dropping a connection from a
 * case that was removed, the templates - asks here, with the step's settings,
 * rather than reading metadata.outPorts.
 *
 * Pure: no DOM, no server.
 */

import BaseModel from "../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import { JSONObject } from "../JSON";
import ComponentMetadata, { Port } from "./Component";
import ComponentID from "./ComponentID";
import { DatabaseOperation, getDatabaseOperation } from "./DatabaseOperation";
import {
  getDisplayColumn,
  getWorkflowModel,
} from "./Documentation/ModelExamples";
import { SWITCH_ARGUMENT_IDS } from "./Components/Switch";
import {
  getStarterSwitchCases,
  getSwitchOutPorts,
  toStoredSwitchCases,
} from "./Components/SwitchCases";

type OutPortsFromSettingsFunction = (
  args: JSONObject | undefined | null,
) => Array<Port>;

// The steps whose outputs depend on their settings, and how.
const OUT_PORTS_FROM_SETTINGS: Partial<
  Record<string, OutPortsFromSettingsFunction>
> = {
  [ComponentID.Switch]: getSwitchOutPorts,
};

type HasOutPortsFromSettingsFunction = (
  metadataId: string | undefined | null,
) => boolean;

/** Whether a step's outputs come from its settings (Switch / Case). */
export const hasOutPortsFromSettings: HasOutPortsFromSettingsFunction = (
  metadataId: string | undefined | null,
): boolean => {
  return Boolean(metadataId && OUT_PORTS_FROM_SETTINGS[metadataId]);
};

type GetComponentOutPortsFunction = (data: {
  metadata: ComponentMetadata | undefined | null;
  arguments?: JSONObject | undefined | null;
}) => Array<Port>;

/** A step's outputs, in the order the canvas draws them. */
export const getComponentOutPorts: GetComponentOutPortsFunction = (data: {
  metadata: ComponentMetadata | undefined | null;
  arguments?: JSONObject | undefined | null;
}): Array<Port> => {
  if (!data.metadata) {
    return [];
  }

  const fromSettings: OutPortsFromSettingsFunction | undefined =
    OUT_PORTS_FROM_SETTINGS[data.metadata.id];

  if (fromSettings) {
    return fromSettings(data.arguments);
  }

  return data.metadata.outPorts || [];
};

type IsOutPortFromSettingsFunction = (data: {
  metadata: ComponentMetadata | undefined | null;
  portId: string;
}) => boolean;

/**
 * Whether an output was made from the step's settings - a Switch / Case
 * case - rather than being one the step always has, such as Default. Its
 * name is then the person's own words, shown as written.
 */
export const isOutPortFromSettings: IsOutPortFromSettingsFunction = (data: {
  metadata: ComponentMetadata | undefined | null;
  portId: string;
}): boolean => {
  if (!data.metadata || !hasOutPortsFromSettings(data.metadata.id)) {
    return false;
  }

  return !(data.metadata.outPorts || []).some((port: Port): boolean => {
    return port.id === data.portId;
  });
};

type GetNewStepArgumentsFunction = (
  metadataId: string | undefined | null,
  // The model a database step reads, for its Fields to pass on.
  tableName?: string | undefined | null,
) => JSONObject | null;

/*
 * The steps that pass a record on, whose Fields to pass on a new step fills
 * in: the On Create and On Update triggers and the two Find steps.
 */
const PASSES_RECORD_ON: Array<DatabaseOperation> = [
  DatabaseOperation.OnCreate,
  DatabaseOperation.OnUpdate,
  DatabaseOperation.FindOne,
  DatabaseOperation.FindMany,
];

/**
 * The settings a step starts with when it is added to the canvas, or null
 * for a step that starts empty, as nearly all do.
 *
 * - A Switch / Case starts with two cases, so its outputs are on the canvas,
 *   ready to connect, before it is opened.
 * - A step that passes a record on starts by passing on the field that
 *   names it - an incident's title, a monitor's name. The record's ID is
 *   always passed on. So the step works as it is added, the next steps'
 *   value picker has those fields to offer, and the setting shows what it is
 *   for before anyone reads its help.
 */
export const getNewStepArguments: GetNewStepArgumentsFunction = (
  metadataId: string | undefined | null,
  tableName?: string | undefined | null,
): JSONObject | null => {
  if (metadataId === ComponentID.Switch) {
    return {
      [SWITCH_ARGUMENT_IDS.cases]: toStoredSwitchCases(getStarterSwitchCases()),
    };
  }

  if (metadataId && tableName) {
    const operation: DatabaseOperation | null = getDatabaseOperation({
      componentId: metadataId,
      tableName: tableName,
    });
    const model: BaseModel | null = operation
      ? getWorkflowModel(tableName)
      : null;

    if (operation && model && PASSES_RECORD_ON.includes(operation)) {
      return {
        select: { [getDisplayColumn(model).id]: true },
      };
    }
  }

  return null;
};

import BaseModel from "../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import { ReflectionMetadataType } from "../Reflection";
import "reflect-metadata";

/*
 * A NAME ONE OF ITS KIND IN ITS PROJECT, WHILE THE PROJECT REQUIRES IT
 * (#10761).
 *
 * Marks the column a kind of record is known by - a monitor's name, a
 * template's name - as held to one record of its kind in the project while
 * the project's Require Unique Names setting is on (Project
 * requireUniqueNames). Two monitors called "API Health Check" are then
 * refused, on a create and on a rename, over the Dashboard, the API and
 * Terraform alike; with the setting off they may share it, and the
 * Dashboard only warns.
 *
 *   @UniqueNameWhenRequired()
 *   @TableColumn({ ... })
 *   @Column({ ... })
 *   public name?: string = undefined;
 *
 * One generic rule, read by the base service (DatabaseService, through
 * Server/Utils/Database/RequiredUniqueNames) on every create and update of a
 * marked model, by the Dashboard's forms (Common/UI/Components/Forms/
 * DuplicateNameNotice) and by the list of names a project already holds
 * twice (Project Settings > Project). Names are compared as UniqueName reads
 * them: case and spacing aside.
 *
 * A kind is marked when people configure it at the project level and find
 * or pick it by name: monitors, monitor groups, probes, SLOs, templates,
 * connections and the rest. Events and records (incidents, alerts,
 * episodes, maintenance events, announcements), what OneUptime discovers and
 * names from its source, the parts of another record, rules (whose names a
 * form fills in from what they do), and what one person keeps for
 * themselves are never marked. The kinds that hold their name one of their
 * kind always - @UniqueColumnBy("projectId") on the name, and teams, labels,
 * on-call policies and schedules (UniqueNameInProject) - keep their rule and
 * are never marked either: RequiredUniqueNamesCoverage (Common Tests) holds
 * every model to one of these, with its reason.
 *
 * At most one column of a model is marked, and it holds text.
 */

const uniqueNameWhenRequired: symbol = Symbol("UniqueNameWhenRequired");

export default (): ReflectionMetadataType => {
  return Reflect.metadata(uniqueNameWhenRequired, true);
};

// What each model's marked column is, worked out once per model.
const columnByModel: WeakMap<{ new (): BaseModel }, string | null> =
  new WeakMap<{ new (): BaseModel }, string | null>();

/*
 * The column a model holds one of its kind in its project while the project
 * requires unique names, or null for a model that marks none.
 */
export const getUniqueNameWhenRequiredColumn: (
  model: BaseModel | { new (): BaseModel } | null | undefined,
) => string | null = (
  model: BaseModel | { new (): BaseModel } | null | undefined,
): string | null => {
  if (!model) {
    return null;
  }

  const modelType: { new (): BaseModel } =
    typeof model === "function"
      ? model
      : (model.constructor as { new (): BaseModel });

  if (columnByModel.has(modelType)) {
    return columnByModel.get(modelType) || null;
  }

  const instance: BaseModel = typeof model === "function" ? new model() : model;

  let found: string | null = null;

  for (const key of Object.keys(instance)) {
    if (Reflect.getMetadata(uniqueNameWhenRequired, instance, key)) {
      found = key;
      break;
    }
  }

  columnByModel.set(modelType, found);

  return found;
};

// Every column of a model marked: a model marks one at most.
export const getUniqueNameWhenRequiredColumns: (
  model: BaseModel,
) => Array<string> = (model: BaseModel): Array<string> => {
  return Object.keys(model).filter((key: string): boolean => {
    return Boolean(Reflect.getMetadata(uniqueNameWhenRequired, model, key));
  });
};

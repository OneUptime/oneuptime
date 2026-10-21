import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import ObjectID from "../../../Types/ObjectID";
import GlobalEvents from "../../Utils/GlobalEvents";

/*
 * One column of one record can be saved from more than one place on a
 * screen: a monitor's monitoring from the switch on its Settings page and
 * from the "Turn monitoring on" button on the banner above it. Each place
 * announces what it saved here, and each listens, so the others follow at
 * once instead of contradicting it until a reload.
 *
 * Keyed on the table name, the id and the column, so a change to one
 * record's switch never moves another's. The value is what the column now
 * stores, not what a switch shows: an inverted switch turns it around
 * itself.
 */
export const MODEL_SWITCH_SAVED_EVENT: string = "MODEL_SWITCH_SAVED";

export interface ModelSwitchSaved {
  tableName: string;
  modelId: string;
  column: string;
  value: boolean;
  /*
   * Who saved it, so the place that saved it does not hear its own change
   * as somebody else's.
   */
  source: string;
}

type ModelType = { new (): BaseModel };

const getTableName: (modelType: ModelType) => string = (
  modelType: ModelType,
): string => {
  return new modelType().tableName || "";
};

export const announceModelSwitchSaved: (data: {
  modelType: ModelType;
  modelId: ObjectID;
  column: string;
  value: boolean;
  source?: string | undefined;
}) => void = (data: {
  modelType: ModelType;
  modelId: ObjectID;
  column: string;
  value: boolean;
  source?: string | undefined;
}): void => {
  const saved: ModelSwitchSaved = {
    tableName: getTableName(data.modelType),
    modelId: data.modelId.toString(),
    column: data.column,
    value: data.value,
    source: data.source || "",
  };

  GlobalEvents.dispatchEvent(MODEL_SWITCH_SAVED_EVENT, { ...saved });
};

/*
 * Calls onSaved with what the column now stores, for saves of this one
 * column of this one record made anywhere else (not by `source`). Returns
 * the unsubscribe.
 */
export const subscribeToModelSwitchSaved: (data: {
  modelType: ModelType;
  modelId: ObjectID;
  column: string;
  source?: string | undefined;
  onSaved: (value: boolean) => void;
}) => () => void = (data: {
  modelType: ModelType;
  modelId: ObjectID;
  column: string;
  source?: string | undefined;
  onSaved: (value: boolean) => void;
}): (() => void) => {
  const tableName: string = getTableName(data.modelType);
  const modelId: string = data.modelId.toString();

  const listener: (event: CustomEvent) => void = (event: CustomEvent): void => {
    const saved: Partial<ModelSwitchSaved> =
      (event.detail as Partial<ModelSwitchSaved>) || {};

    if (
      saved.tableName !== tableName ||
      saved.modelId !== modelId ||
      saved.column !== data.column ||
      typeof saved.value !== "boolean"
    ) {
      return;
    }

    if (data.source && saved.source === data.source) {
      return;
    }

    data.onSaved(saved.value);
  };

  GlobalEvents.addEventListener(MODEL_SWITCH_SAVED_EVENT, listener);

  return (): void => {
    GlobalEvents.removeEventListener(MODEL_SWITCH_SAVED_EVENT, listener);
  };
};

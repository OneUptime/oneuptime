import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import ObjectID from "../../../Types/ObjectID";
import GlobalEvents from "../../Utils/GlobalEvents";

/*
 * A record's page header - "Host - web-01", with the record's labels beside
 * it - is read once by the layout's ModelPage, which stays mounted while the
 * tabs below it change. A tab that renames the record or changes its labels
 * (the details card on a resource's Settings page) announces it here, and
 * ModelPage reads its header again, so the header never keeps the old name
 * until a reload.
 *
 * Keyed on the table name and the id, so saving one record never reloads
 * another's header.
 */
export const MODEL_HEADER_CHANGED_EVENT: string = "MODEL_HEADER_CHANGED";

export interface ModelHeaderChanged {
  tableName: string;
  modelId: string;
}

type ModelType = { new (): BaseModel };

const getTableName: (modelType: ModelType) => string = (
  modelType: ModelType,
): string => {
  return new modelType().tableName || "";
};

export const announceModelHeaderChanged: (data: {
  modelType: ModelType;
  modelId: ObjectID;
}) => void = (data: { modelType: ModelType; modelId: ObjectID }): void => {
  const changed: ModelHeaderChanged = {
    tableName: getTableName(data.modelType),
    modelId: data.modelId.toString(),
  };

  GlobalEvents.dispatchEvent(MODEL_HEADER_CHANGED_EVENT, { ...changed });
};

/*
 * Calls onChanged whenever the header of this one record is announced as
 * changed. Returns the unsubscribe.
 */
export const subscribeToModelHeaderChanged: (data: {
  modelType: ModelType;
  modelId: ObjectID;
  onChanged: () => void;
}) => () => void = (data: {
  modelType: ModelType;
  modelId: ObjectID;
  onChanged: () => void;
}): (() => void) => {
  const tableName: string = getTableName(data.modelType);
  const modelId: string = data.modelId.toString();

  const listener: (event: CustomEvent) => void = (event: CustomEvent): void => {
    const changed: Partial<ModelHeaderChanged> =
      (event.detail as Partial<ModelHeaderChanged>) || {};

    if (changed.tableName !== tableName || changed.modelId !== modelId) {
      return;
    }

    data.onChanged();
  };

  GlobalEvents.addEventListener(MODEL_HEADER_CHANGED_EVENT, listener);

  return (): void => {
    GlobalEvents.removeEventListener(MODEL_HEADER_CHANGED_EVENT, listener);
  };
};

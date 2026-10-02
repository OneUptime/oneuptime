import BaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import { REFRESH_SIDEBAR_COUNT_EVENT } from "Common/UI/Components/SideMenu/CountModelSideMenuItem";
import GlobalEvents from "Common/UI/Utils/GlobalEvents";
import ObjectID from "Common/Types/ObjectID";

/*
 * One resource can be archived or unarchived from more than one place on the
 * same screen: the banner at the top of its pages and the Archive card on its
 * Settings page. Each announces the change here, and each listens, so the
 * other updates at once instead of contradicting it until a reload.
 *
 * Keyed on the table name and the id, so a change to one workflow never moves
 * the banner of another, or of a monitor with the same id shape.
 */
export const ARCHIVE_STATE_CHANGED_EVENT: string =
  "RESOURCE_ARCHIVE_STATE_CHANGED";

export interface ArchiveStateChange {
  tableName: string;
  modelId: string;
  isArchived: boolean;
}

type ModelType = { new (): BaseModel };

const getTableName: (modelType: ModelType) => string = (
  modelType: ModelType,
): string => {
  return new modelType().tableName || "";
};

export const announceArchiveStateChange: (data: {
  modelType: ModelType;
  modelId: ObjectID;
  isArchived: boolean;
}) => void = (data: {
  modelType: ModelType;
  modelId: ObjectID;
  isArchived: boolean;
}): void => {
  const change: ArchiveStateChange = {
    tableName: getTableName(data.modelType),
    modelId: data.modelId.toString(),
    isArchived: data.isArchived,
  };

  GlobalEvents.dispatchEvent(ARCHIVE_STATE_CHANGED_EVENT, {
    ...change,
  });

  /*
   * Side-menu badges count resources the lists show (Not Operational,
   * Disabled, ...), which archived ones no longer are.
   */
  GlobalEvents.dispatchEvent(REFRESH_SIDEBAR_COUNT_EVENT);
};

// Calls onChange for changes to this one resource. Returns the unsubscribe.
export const subscribeToArchiveStateChanges: (data: {
  modelType: ModelType;
  modelId: ObjectID;
  onChange: (isArchived: boolean) => void;
}) => () => void = (data: {
  modelType: ModelType;
  modelId: ObjectID;
  onChange: (isArchived: boolean) => void;
}): (() => void) => {
  const tableName: string = getTableName(data.modelType);
  const modelId: string = data.modelId.toString();

  const listener: (event: CustomEvent) => void = (event: CustomEvent): void => {
    const change: Partial<ArchiveStateChange> =
      (event.detail as Partial<ArchiveStateChange>) || {};

    if (change.tableName !== tableName || change.modelId !== modelId) {
      return;
    }

    data.onChange(change.isArchived === true);
  };

  GlobalEvents.addEventListener(ARCHIVE_STATE_CHANGED_EVENT, listener);

  return (): void => {
    GlobalEvents.removeEventListener(ARCHIVE_STATE_CHANGED_EVENT, listener);
  };
};

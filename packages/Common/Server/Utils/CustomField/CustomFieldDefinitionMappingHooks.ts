import ObjectID from "../../../Types/ObjectID";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import CustomFieldMappingService from "../../Services/CustomFieldMappingService";
import logger from "../Logger";

/*
 * The half of the custom-field-definition lifecycle that belongs to value
 * mapping, factored out so the three definition services that can carry a
 * mapping (Alert, Incident, Scheduled Maintenance) say the same thing.
 *
 * Validation lives next door in CustomFieldMappingValidator and runs in the
 * before-hooks; this file is only the after-effect: a mapping that was just
 * created or changed should fill in the records that already exist, not just
 * the ones created from now on.
 */

export type BackfillMappedCustomFieldValuesFunction = (data: {
  definitionModelType: { new (): BaseModel };
  projectId: ObjectID | undefined;
  definitionName: string;
}) => void;

/*
 * Deliberately NOT awaited, and deliberately not returning a promise.
 *
 * A project-wide backfill can touch thousands of rows, and both onCreateSuccess
 * and onUpdateSuccess are awaited by the write that triggered them — awaiting
 * this would put the whole sweep inside the settings form's HTTP request and
 * time it out. This is the same fire-and-forget shape every rule engine in
 * this codebase uses from onCreateSuccess, and it carries the same
 * consequence: a backfill lost to a pod restart leaves records holding their
 * previous values until their source changes again. Because mapping never
 * clears a value, that is always a stale copy and never a lost one.
 */
export const backfillMappedCustomFieldValues: BackfillMappedCustomFieldValuesFunction =
  (data: {
    definitionModelType: { new (): BaseModel };
    projectId: ObjectID | undefined;
    definitionName: string;
  }): void => {
    if (!data.projectId) {
      return;
    }

    CustomFieldMappingService.backfillProject({
      definitionModelType: data.definitionModelType,
      projectId: data.projectId,
    }).catch((error: Error) => {
      logger.error(
        `Custom field value mapping: backfill after a ${data.definitionName} change failed.`,
      );
      logger.error(error);
    });
  };

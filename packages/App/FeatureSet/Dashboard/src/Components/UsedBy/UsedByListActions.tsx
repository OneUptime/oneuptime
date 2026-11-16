import UsedByApi from "./UsedByApi";
import {
  UsedByBulkImpact,
  UsedByImpactForRecord,
  UsedByImpactList,
} from "./UsedByImpact";
import BaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import ObjectID from "Common/Types/ObjectID";
import { UsedByRecordKind, UsedBySummary } from "Common/Types/UsedBy/UsedBy";
import { BulkActionConfirmControls } from "Common/UI/Components/BulkUpdate/BulkUpdateForm";
import { DeleteConfirmation } from "Common/UI/Components/ModelTable/BaseModelTable";
import React, { ReactElement } from "react";

/*
 * "USED BY" IN A LIST (#7435): a row's Delete and Archive, and Bulk
 * Actions > Delete and Archive, say what still uses the records before
 * anything happens - as the record's own Delete page and Archive card do.
 *
 *   - a row's Delete reads the record's summary when it is clicked, and its
 *     dialog opens with what still uses it (the table waits for the answer,
 *     saying it is checking when it is slow);
 *   - a row's Archive reads it when its dialog opens;
 *   - a bulk Delete or Archive reads one summary for the whole selection
 *     (UsedByApi.getSummaries: each relation counted once for all of it),
 *     one request however many records are selected, and holds its action
 *     until the answer is in.
 *
 * Advisories: a read that fails says nothing, and nothing is held back or
 * skipped because something uses it.
 */

export interface UsedByListActions<T extends BaseModel> {
  getDeleteConfirmation: (item: T) => Promise<DeleteConfirmation>;
  deleteConfirmationDetails: (
    items: Array<T>,
    controls: BulkActionConfirmControls,
  ) => ReactElement | undefined;
  archiveConfirmDetails: (
    items: Array<T>,
    controls: BulkActionConfirmControls,
  ) => ReactElement | undefined;
  getArchiveConfirmationDetails: (item: T) => ReactElement | undefined;
}

// A row's id, as the table holds it.
export function readUsedByRecordId(item: BaseModel): ObjectID | null {
  const id: unknown = item._id || item.id;

  if (!id) {
    return null;
  }

  return id instanceof ObjectID ? id : new ObjectID(String(id));
}

function readIds(items: Array<BaseModel>): Array<ObjectID> {
  return items
    .map(readUsedByRecordId)
    .filter((id: ObjectID | null): id is ObjectID => {
      return id !== null;
    });
}

export function getUsedByListActions<T extends BaseModel>(
  recordKind: UsedByRecordKind,
): UsedByListActions<T> {
  const bulkDetails: (
    items: Array<T>,
    controls: BulkActionConfirmControls,
  ) => ReactElement | undefined = (
    items: Array<T>,
    controls: BulkActionConfirmControls,
  ): ReactElement | undefined => {
    const ids: Array<ObjectID> = readIds(items);

    if (ids.length === 0) {
      return undefined;
    }

    return (
      <UsedByBulkImpact
        recordKind={recordKind}
        recordIds={ids}
        controls={controls}
      />
    );
  };

  return {
    getDeleteConfirmation: async (item: T): Promise<DeleteConfirmation> => {
      const id: ObjectID | null = readUsedByRecordId(item);

      if (!id) {
        return {};
      }

      try {
        const summary: UsedBySummary = await UsedByApi.getSummary({
          recordKind: recordKind,
          recordId: id,
        });

        return {
          details: (
            <UsedByImpactList state={{ status: "loaded", summary: summary }} />
          ),
        };
      } catch {
        // An advisory: the Delete goes on without it.
        return {};
      }
    },
    deleteConfirmationDetails: bulkDetails,
    archiveConfirmDetails: bulkDetails,
    getArchiveConfirmationDetails: (item: T): ReactElement | undefined => {
      const id: ObjectID | null = readUsedByRecordId(item);

      if (!id) {
        return undefined;
      }

      return (
        <UsedByImpactForRecord
          recordKind={recordKind}
          recordId={id}
          showChecking={true}
        />
      );
    },
  };
}

import {
  BULK_DELETE_CHANGES_INTRO,
  BULK_DELETE_CHANGES_INTRO_OTHERS,
  BULK_DELETE_REFUSED,
  BULK_DELETE_REFUSED_ALREADY_ARCHIVED,
  BULK_DELETE_REFUSED_ARCHIVE_INSTEAD,
  BULK_DELETE_REFUSED_MORE,
  BULK_DELETE_REFUSED_NAMES_SHOWN,
  BULK_DELETE_SKIPS,
  CHECKING_WHAT_USES_THEM,
} from "./ArchivableValueCopy";
import { UsageGroups, UsageList } from "./ArchivableValueUsageList";
import { UsageGroup, getDeleteDialogGroups } from "./ArchivableValueUsageText";
import { fetchArchivableValuesUsage } from "./FetchArchivableValueUsage";
import { formatNameList } from "../AiAccess/AiAccessModes";
import BaseModel, {
  DatabaseBaseModelType,
} from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import {
  ArchivableValuesUsage,
  ArchivableValuesUsagePurpose,
} from "Common/Types/ArchivableValue/ArchivableValueUsage";
import ObjectID from "Common/Types/ObjectID";
import { BulkActionConfirmControls } from "Common/UI/Components/BulkUpdate/BulkUpdateForm";
import { joinSentences } from "Common/UI/Components/DeleteConfirmation/DeleteConsequences";
import InlineLoadingLine from "Common/UI/Components/Loader/InlineLoadingLine";
import {
  NameListSummary,
  summarizeNames,
} from "Common/UI/Utils/ModelDisplayName";
import { Translator, composedValue } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";

/*
 * WHAT A BULK DELETE OF VALUES WOULD DO, said in its dialog after the names
 * (Bulk Actions > Delete on the settings page of a state, a severity, a
 * label...).
 *
 * The bulk Delete used to ask only "Are you sure you want to delete 3
 * incident severities?" and send the deletes: a severity incidents still
 * have came back refused with "delete those records first", and one only
 * people's on-call rules named took every one of those rules with it
 * without a word - where a row's own Delete said both first. Now the
 * dialog reads, once for the selection (POST <value route>/usage), which of
 * the values records still have - those are left as they are, with what
 * has them and Archive as the way on - and what deleting the rest changes,
 * each record or person counted once however many of them it has. Its
 * Delete waits for the answer, and stays unavailable when nothing could be
 * deleted. A read that fails says nothing: the delete goes on, and the
 * server refuses what it must.
 */

export interface ComponentProps {
  modelType: DatabaseBaseModelType;
  items: Array<BaseModel>;
  controls: BulkActionConfirmControls;
  // The selection is of the Archived section's values.
  isArchivedList: boolean;
  /*
   * Told which of the values records still have (lower-cased ids), so the
   * run leaves them out with the reason instead of sending their deletes.
   */
  onRefusedValueIds: (valueIds: Array<string>) => void;
}

const readId: (item: BaseModel) => ObjectID | null = (
  item: BaseModel,
): ObjectID | null => {
  const id: unknown = item._id || item.id;

  if (!id) {
    return null;
  }

  return id instanceof ObjectID ? id : new ObjectID(id.toString());
};

const readName: (item: BaseModel) => string = (item: BaseModel): string => {
  const name: unknown = item.getColumnValue("name");

  return typeof name === "string" ? name.trim() : "";
};

const ArchivableValuesBulkDeleteDetails: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();

  // null while it is read; "failed" when the read failed.
  const [answer, setAnswer] = useState<ArchivableValuesUsage | null | "failed">(
    null,
  );

  const ids: Array<ObjectID> = props.items
    .map(readId)
    .filter((id: ObjectID | null): id is ObjectID => {
      return id !== null;
    });

  useEffect(() => {
    let cancelled: boolean = false;

    // The dialog's Delete waits for what it would do.
    props.controls.setIsSubmitHeld(true);

    fetchArchivableValuesUsage({
      modelType: props.modelType,
      valueIds: ids,
      purpose: ArchivableValuesUsagePurpose.Delete,
    })
      .then((usage: ArchivableValuesUsage) => {
        if (cancelled) {
          return;
        }

        const refused: Set<string> = new Set<string>(
          usage.refusedValueIds.map((id: string): string => {
            return id.toLowerCase();
          }),
        );

        props.onRefusedValueIds(Array.from(refused));
        setAnswer(usage);

        // Nothing it could delete: its Delete stays unavailable.
        props.controls.setIsSubmitHeld(
          ids.every((id: ObjectID): boolean => {
            return refused.has(id.toString().toLowerCase());
          }),
        );
      })
      .catch(() => {
        if (cancelled) {
          return;
        }

        props.onRefusedValueIds([]);
        setAnswer("failed");
        props.controls.setIsSubmitHeld(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  if (answer === null) {
    return (
      <InlineLoadingLine
        text={CHECKING_WHAT_USES_THEM}
        dataTestId="archivable-values-bulk-checking"
      />
    );
  }

  if (answer === "failed") {
    return <></>;
  }

  const refused: Set<string> = new Set<string>(
    answer.refusedValueIds.map((id: string): string => {
      return id.toLowerCase();
    }),
  );

  const refusedItems: Array<BaseModel> = props.items.filter(
    (item: BaseModel): boolean => {
      const id: ObjectID | null = readId(item);

      return Boolean(id && refused.has(id.toString().toLowerCase()));
    },
  );

  const refusedCount: number = refusedItems.length;

  /*
   * The refused ones by name, the first two of them, and the rest counted:
   * "Critical, Major and 3 more" - a selection of many labels never turns
   * the sentence into a list of them.
   */
  const refusedNames: NameListSummary = summarizeNames({
    names: refusedItems.map(readName),
    totalCount: refusedCount,
    maxShown: BULK_DELETE_REFUSED_NAMES_SHOWN,
  });

  const deletableCount: number = props.items.length - refusedCount;
  // What goes with the ones it deletes: "Deleted with them" for several.
  const groups: Array<UsageGroup> = getDeleteDialogGroups(
    answer.usage,
    deletableCount,
  );

  if (refusedCount === 0 && groups.length === 0) {
    return <></>;
  }

  return (
    <div
      className="space-y-4 text-sm leading-6 text-gray-600"
      data-testid="archivable-values-bulk-delete-usage"
    >
      {refusedCount > 0 ? (
        <div data-testid="archivable-values-bulk-delete-refused">
          <p className="font-medium text-gray-900">
            {translator.translatePlural(BULK_DELETE_REFUSED, refusedCount, {
              names: composedValue((sentence: Translator): string => {
                if (refusedNames.shownNames.length === 0) {
                  return sentence.formatNumber(refusedCount);
                }

                return formatNameList(
                  refusedNames.remainingCount > 0
                    ? [
                        ...refusedNames.shownNames,
                        sentence.translatePlural(
                          BULK_DELETE_REFUSED_MORE,
                          refusedNames.remainingCount,
                        ),
                      ]
                    : refusedNames.shownNames,
                  "and",
                  sentence,
                );
              }),
            })}
          </p>
          <UsageList
            items={answer.refusedUsage}
            dataTestId="archivable-values-bulk-delete-refused-by"
          />
          <p
            className="mt-2"
            data-testid="archivable-values-bulk-delete-refused-way-on"
          >
            {joinSentences([
              /*
               * What the Delete does with them, while it has others to
               * delete; with nothing else, it is unavailable.
               */
              deletableCount > 0
                ? translator.translatePlural(BULK_DELETE_SKIPS, refusedCount)
                : "",
              translator.translatePlural(
                props.isArchivedList
                  ? BULK_DELETE_REFUSED_ALREADY_ARCHIVED
                  : BULK_DELETE_REFUSED_ARCHIVE_INSTEAD,
                refusedCount,
              ),
            ])}
          </p>
        </div>
      ) : (
        <></>
      )}

      {groups.length > 0 && deletableCount > 0 ? (
        <div data-testid="archivable-values-bulk-delete-changes">
          <p className="font-medium text-gray-900">
            {translator.translatePlural(
              refusedCount > 0
                ? BULK_DELETE_CHANGES_INTRO_OTHERS
                : BULK_DELETE_CHANGES_INTRO,
              deletableCount,
            )}
          </p>
          <UsageGroups groups={groups} showLabels={true} />
        </div>
      ) : (
        <></>
      )}
    </div>
  );
};

export default ArchivableValuesBulkDeleteDetails;

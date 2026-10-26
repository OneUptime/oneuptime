import OneUptimeDate from "Common/Types/Date";
import BadDataException from "Common/Types/Exception/BadDataException";
import GreaterThan from "Common/Types/BaseDatabase/GreaterThan";
import LessThanOrEqual from "Common/Types/BaseDatabase/LessThanOrEqual";
import NotEqual from "Common/Types/BaseDatabase/NotEqual";
import Query from "Common/Types/BaseDatabase/Query";
import Select from "Common/Types/BaseDatabase/Select";
import Sort from "Common/Types/BaseDatabase/Sort";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import ObjectID from "Common/Types/ObjectID";
import BaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import DeleteConsequenceParagraph from "Common/UI/Components/DeleteConfirmation/DeleteConsequenceParagraph";
import IrreversibleQuestion from "Common/UI/Components/DeleteConfirmation/IrreversibleQuestion";
import { DeleteConfirmation } from "Common/UI/Components/ModelTable/BaseModelTable";
import TranslatedSentence from "Common/UI/Components/TranslatedSentence/TranslatedSentence";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import ProjectUtil from "Common/UI/Utils/Project";
import { Translator, translationKey } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import {
  decideStateRowDelete,
  StateRowDeleteEffect,
  StateTimelineRecord,
} from "Common/Utils/StateTimeline/StateTimelineRowDelete";
import React, { ReactElement, useState } from "react";

/*
 * Deleting one row of an incident's, alert's, scheduled maintenance event's
 * or episode's Status Timeline, from its page: the rule the services follow
 * (Common/Utils/StateTimeline/StateTimelineRowDelete), said before anyone
 * clicks. The monitor's Status Timeline page does the same for status events
 * (MonitorStatusEventDelete); a timeline drawn any other way should reuse
 * this.
 *
 *   - The record's only state: its Delete is locked, with the server's own
 *     reason, and a bulk Delete lists it, with that reason, among the rows
 *     it did not delete.
 *   - Every other row's Delete dialog says which state it is ("the
 *     Acknowledged state that started ...") and, in a paragraph of its own
 *     under the question, what deleting it does: the state before it becomes
 *     current again, or takes over its time.
 *   - A row is called by its state and start wherever the table names it -
 *     its checkbox and ⋯ for a screen reader, a bulk Delete's lists - never
 *     by its id.
 */

export interface StateTimelineRowDeleteWords {
  // Why the record's only state is not deleted: the server's words.
  onlyStateReason: string;
  // "{{state}}, the state before it, becomes the incident's current state again."
  previousIsCurrentAgain: string;
  // Said after a bulk Delete's question: what deleting several does.
  bulkWarning: string;
}

/*
 * Each record's words. onlyStateReason is the server's refusal word for word
 * (ONLY_STATE_DELETE_MESSAGES; a test keeps them equal), so it is read in the
 * reader's language wherever it shows: the locked Delete's tooltip, a bulk
 * Delete's list, the error dialog when the server refuses it after all.
 */
export const STATE_TIMELINE_DELETE_WORDS: Readonly<
  Record<StateTimelineRecord, StateTimelineRowDeleteWords>
> = {
  [StateTimelineRecord.Incident]: {
    onlyStateReason: translationKey(
      "The incident's only state can't be deleted: an incident always has a state. To change it, add a new state.",
    ),
    previousIsCurrentAgain: translationKey(
      "{{state}}, the state before it, becomes the incident's current state again.",
    ),
    bulkWarning: translationKey(
      "The state before each deleted state takes over its time, so deleting the newest one changes the incident's current state.",
    ),
  },
  [StateTimelineRecord.Alert]: {
    onlyStateReason: translationKey(
      "The alert's only state can't be deleted: an alert always has a state. To change it, add a new state.",
    ),
    previousIsCurrentAgain: translationKey(
      "{{state}}, the state before it, becomes the alert's current state again.",
    ),
    bulkWarning: translationKey(
      "The state before each deleted state takes over its time, so deleting the newest one changes the alert's current state.",
    ),
  },
  [StateTimelineRecord.ScheduledMaintenance]: {
    onlyStateReason: translationKey(
      "The event's only state can't be deleted: a scheduled maintenance event always has a state. To change it, add a new state.",
    ),
    previousIsCurrentAgain: translationKey(
      "{{state}}, the state before it, becomes the event's current state again.",
    ),
    bulkWarning: translationKey(
      "The state before each deleted state takes over its time, so deleting the newest one changes the event's current state.",
    ),
  },
  [StateTimelineRecord.IncidentEpisode]: {
    onlyStateReason: translationKey(
      "The episode's only state can't be deleted: an episode always has a state. To change it, add a new state.",
    ),
    previousIsCurrentAgain: translationKey(
      "{{state}}, the state before it, becomes the episode's current state again.",
    ),
    bulkWarning: translationKey(
      "The state before each deleted state takes over its time, so deleting the newest one changes the episode's current state.",
    ),
  },
  [StateTimelineRecord.AlertEpisode]: {
    onlyStateReason: translationKey(
      "The episode's only state can't be deleted: an episode always has a state. To change it, add a new state.",
    ),
    previousIsCurrentAgain: translationKey(
      "{{state}}, the state before it, becomes the episode's current state again.",
    ),
    bulkWarning: translationKey(
      "The state before each deleted state takes over its time, so deleting the newest one changes the episode's current state.",
    ),
  },
};

export const STATE_ROW_DELETE_QUESTION: string = translationKey(
  "Are you sure you want to delete the {{state}} state that started {{startsAt}}?",
);

export const PREVIOUS_STATE_TAKES_OVER: string = translationKey(
  "{{state}}, the state before it, takes over its time.",
);

/*
 * What one row is called wherever the table names it - the Delete dialog's
 * title ("Delete State Change"), a bulk Delete's ("Delete 2 State Changes")
 * and its result, the selection bar, the Create button and the page count -
 * instead of the model's "Incident State Timeline", which names the whole
 * history rather than one entry in it.
 */
export const STATE_CHANGE_NAMES: Readonly<{
  singular: string;
  plural: string;
}> = {
  singular: translationKey("State Change"),
  plural: translationKey("State Changes"),
};

export interface StateTimelineRowDeleteOptions<T extends BaseModel> {
  record: StateTimelineRecord;
  modelType: { new (): T };
  // The column naming the record the timeline belongs to: "incidentId".
  recordIdColumn: string;
  recordId: ObjectID;
  // The relation holding the state, with its name: "incidentState".
  stateColumn: string;
}

// What a Status Timeline page hands its ModelTable.
export interface StateTimelineRowDeleteProps<T extends BaseModel> {
  getDeleteDisabledReason: (item: T) => string | undefined;
  getItemName: (item: T) => string;
  getDeleteConfirmation: (item: T) => Promise<DeleteConfirmation>;
  // Reads which row is the only one again; call on every load of the table.
  onFetchSuccess: () => void;
  // Said after a bulk Delete's question (the row's dialog says more).
  deleteConfirmationWarning: string;
  // What one row is called: a state change (STATE_CHANGE_NAMES).
  singularName: string;
  pluralName: string;
}

/*
 * The words of a state's dialog that name the record's own things, in bold
 * so they read as the record and not as more of the sentence: a state's
 * name, which wraps like any name, and when it began, which is kept on one
 * line - "Oct 14 2026, 09:05 AM GMT" broken after "Oct" read as two things.
 */
export const boldStateName: (text: string) => ReactElement = (
  text: string,
): ReactElement => {
  return (
    <strong className="break-words font-semibold text-gray-900">{text}</strong>
  );
};

export const boldStartsAt: (text: string) => ReactElement = (
  text: string,
): ReactElement => {
  return (
    <strong
      className="whitespace-nowrap font-semibold text-gray-900"
      data-testid="delete-confirmation-starts-at"
    >
      {text}
    </strong>
  );
};

type ReadRowFunction = (row: BaseModel) => {
  id: string;
  stateName: string;
  startsAt: Date | undefined;
};

const useStateTimelineRowDelete: <T extends BaseModel>(
  options: StateTimelineRowDeleteOptions<T>,
) => StateTimelineRowDeleteProps<T> = <T extends BaseModel>(
  options: StateTimelineRowDeleteOptions<T>,
): StateTimelineRowDeleteProps<T> => {
  const translator: Translator = useTranslator();
  const words: StateTimelineRowDeleteWords =
    STATE_TIMELINE_DELETE_WORDS[options.record];

  /*
   * The record's only row, whose delete the server refuses - read on every
   * load of the table, since a new state or a delete changes it. Null while
   * the record has more than one row, or when the read failed: nothing is
   * locked then, and the server still refuses, saying why.
   */
  const [onlyRowId, setOnlyRowId] = useState<string | null>(null);

  const readRow: ReadRowFunction = (
    row: BaseModel,
  ): { id: string; stateName: string; startsAt: Date | undefined } => {
    const values: Record<string, unknown> = row as unknown as Record<
      string,
      unknown
    >;
    const state: { name?: unknown } | undefined = values[
      options.stateColumn
    ] as { name?: unknown } | undefined;
    const name: string = state?.name ? String(state.name) : "";
    const startsAt: unknown = values["startsAt"];

    return {
      id: (row._id || row.id?.toString() || "").toLowerCase(),
      /*
       * A state's name as the table's pill shows it: a built-in one in the
       * reader's language, a project's own as it was typed.
       */
      stateName: name ? translator.translateText(name) || name : "",
      startsAt: startsAt
        ? OneUptimeDate.fromString(startsAt as Date)
        : undefined,
    };
  };

  // When it began, as the table's Starts At column shows it.
  const formatStartsAt: (startsAt: Date | undefined) => string = (
    startsAt: Date | undefined,
  ): string => {
    return startsAt
      ? OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(startsAt, false)
      : "";
  };

  const getOnlyStateReason: () => string = (): string => {
    return (
      translator.translateText(words.onlyStateReason) || words.onlyStateReason
    );
  };

  const recordQuery: () => Query<T> = (): Query<T> => {
    return {
      [options.recordIdColumn]: options.recordId,
      projectId: ProjectUtil.getCurrentProjectId()!,
    } as Query<T>;
  };

  const loadOnlyRow: () => Promise<void> = async (): Promise<void> => {
    try {
      const rows: ListResult<T> = await ModelAPI.getList<T>({
        modelType: options.modelType,
        query: recordQuery(),
        limit: 1,
        skip: 0,
        select: { _id: true } as Select<T>,
        sort: { startsAt: SortOrder.Ascending } as Sort<T>,
      });

      setOnlyRowId(
        rows.count === 1 && rows.data[0] ? readRow(rows.data[0]).id : null,
      );
    } catch {
      setOnlyRowId(null);
    }
  };

  const getDeleteDisabledReason: (item: T) => string | undefined = (
    item: T,
  ): string | undefined => {
    const id: string = readRow(item).id;

    if (!onlyRowId || !id || id !== onlyRowId) {
      return undefined;
    }

    return getOnlyStateReason();
  };

  const getItemName: (item: T) => string = (item: T): string => {
    const row: { stateName: string; startsAt: Date | undefined } =
      readRow(item);
    const startsAt: string = formatStartsAt(row.startsAt);

    return row.stateName && startsAt
      ? `${row.stateName} (${startsAt})`
      : row.stateName || startsAt;
  };

  /*
   * The row's two neighbours, as the service reads them, and so what the
   * delete does. Null when they can't be read: the dialog then only asks,
   * and the server still decides.
   */
  const readEffect: (item: T) => Promise<{
    effect: StateRowDeleteEffect;
    previousStateName: string;
  } | null> = async (
    item: T,
  ): Promise<{
    effect: StateRowDeleteEffect;
    previousStateName: string;
  } | null> => {
    const row: { id: string; startsAt: Date | undefined } = readRow(item);

    if (!row.id || !row.startsAt) {
      return null;
    }

    try {
      const [before, after]: [ListResult<T>, ListResult<T>] = await Promise.all(
        [
          ModelAPI.getList<T>({
            modelType: options.modelType,
            query: {
              ...recordQuery(),
              startsAt: new LessThanOrEqual<Date>(row.startsAt),
              _id: new NotEqual<string>(row.id),
            } as Query<T>,
            limit: 1,
            skip: 0,
            select: {
              _id: true,
              [options.stateColumn]: { name: true },
            } as Select<T>,
            sort: { startsAt: SortOrder.Descending } as Sort<T>,
          }),
          ModelAPI.getList<T>({
            modelType: options.modelType,
            query: {
              ...recordQuery(),
              startsAt: new GreaterThan<Date>(row.startsAt),
            } as Query<T>,
            limit: 1,
            skip: 0,
            select: { _id: true } as Select<T>,
            sort: { startsAt: SortOrder.Ascending } as Sort<T>,
          }),
        ],
      );

      const previous: T | undefined = before.data[0];

      return {
        effect: decideStateRowDelete({
          hasStateBefore: Boolean(previous),
          hasStateAfter: after.data.length > 0,
        }),
        previousStateName: previous ? readRow(previous).stateName : "",
      };
    } catch {
      return null;
    }
  };

  const getDeleteConfirmation: (
    item: T,
  ) => Promise<DeleteConfirmation> = async (
    item: T,
  ): Promise<DeleteConfirmation> => {
    const read: {
      effect: StateRowDeleteEffect;
      previousStateName: string;
    } | null = await readEffect(item);

    if (read?.effect === StateRowDeleteEffect.OnlyState) {
      /*
       * The timeline changed since the table loaded it: this is now the
       * record's only state. Say so instead of asking - the server would
       * refuse it.
       */
      throw new BadDataException(getOnlyStateReason());
    }

    const row: { stateName: string; startsAt: Date | undefined } =
      readRow(item);

    const previousStateName: string = read?.previousStateName || "";

    // What deleting it does to the states around it, when it moves any.
    const effect: ReactElement | null =
      previousStateName &&
      read?.effect === StateRowDeleteEffect.PreviousIsCurrentAgain ? (
        <TranslatedSentence
          template={words.previousIsCurrentAgain}
          slots={{ state: boldStateName(previousStateName) }}
        />
      ) : previousStateName &&
        read?.effect === StateRowDeleteEffect.PreviousTakesOver ? (
        <TranslatedSentence
          template={PREVIOUS_STATE_TAKES_OVER}
          slots={{ state: boldStateName(previousStateName) }}
        />
      ) : null;

    /*
     * The question and that it cannot be undone, then - a paragraph of its
     * own, as every Delete dialog sets apart what goes with a record - what
     * deleting it does to the states around it.
     */
    return {
      description: (
        <span data-testid="state-row-delete-confirmation">
          <IrreversibleQuestion
            template={STATE_ROW_DELETE_QUESTION}
            slots={{
              state: boldStateName(row.stateName),
              startsAt: boldStartsAt(formatStartsAt(row.startsAt)),
            }}
          />
          {effect ? (
            <DeleteConsequenceParagraph dataTestId="state-row-delete-effect">
              {effect}
            </DeleteConsequenceParagraph>
          ) : (
            <></>
          )}
        </span>
      ),
    };
  };

  return {
    getDeleteDisabledReason,
    getItemName,
    getDeleteConfirmation,
    onFetchSuccess: (): void => {
      void loadOnlyRow();
    },
    deleteConfirmationWarning: words.bulkWarning,
    singularName: STATE_CHANGE_NAMES.singular,
    pluralName: STATE_CHANGE_NAMES.plural,
  };
};

export default useStateTimelineRowDelete;

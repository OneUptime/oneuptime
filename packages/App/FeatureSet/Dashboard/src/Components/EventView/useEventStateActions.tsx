import BaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import BadDataException from "Common/Types/Exception/BadDataException";
import { ErrorFunction, VoidFunction } from "Common/Types/FunctionTypes";
import IconProp from "Common/Types/Icon/IconProp";
import { JSONObject } from "Common/Types/JSON";
import Includes from "Common/Types/BaseDatabase/Includes";
import ObjectID from "Common/Types/ObjectID";
import PrivateRecordPublicNotes from "Common/Types/StatusPage/PrivateRecordPublicNotes";
import ActionButtonSchema, {
  ActionButtonPlacement,
  RowActionContext,
} from "Common/UI/Components/ActionButton/ActionButtonSchema";
import { ActionMenuGroup } from "Common/UI/Components/ActionButton/ActionMenuGroup";
import {
  BULK_ITEM_CHANGED,
  BulkItemOutcome,
  bulkItemUnchanged,
  runBulkAction,
} from "Common/UI/Components/BulkUpdate/BulkActionRunner";
import BulkReadAhead from "Common/UI/Components/BulkUpdate/BulkReadAhead";
import {
  BulkActionButtonSchema,
  BulkActionOnClickProps,
} from "Common/UI/Components/BulkUpdate/BulkUpdateForm";
import { VALUE_CHANGE_RESULT_LABELS } from "Common/UI/Components/BulkUpdate/ValueChangeActions";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import { joinSentences } from "Common/UI/Components/DeleteConfirmation/DeleteConsequences";
import { REFRESH_SIDEBAR_COUNT_EVENT } from "Common/UI/Components/SideMenu/CountModelSideMenuItem";
import API from "Common/UI/Utils/API/API";
import DropdownUtil from "Common/UI/Utils/Dropdown";
import GlobalEvents from "Common/UI/Utils/GlobalEvents";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import { getRecordDisplayName } from "Common/UI/Utils/ModelDisplayName";
import PermissionGate, {
  ModelAction,
  PermissionGateResult,
} from "Common/UI/Utils/PermissionGate";
import ProjectUtil from "Common/UI/Utils/Project";
import {
  translatableTerm,
  TranslatableTerm,
  Translator,
} from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { ReactElement, useRef, useState } from "react";
import {
  BulkStateChangeNoteType,
  buildBulkStateChangeMiscDataProps,
  buildIncidentBulkStateChange,
  IncidentBulkStateChange,
} from "../../Utils/BulkStateChange";
import BulkChangeStateModal, {
  BulkChangeStateSubmitData,
} from "./BulkChangeStateModal";
import {
  BULK_QUICK_MOVE_DESCRIPTIONS,
  BULK_QUICK_MOVE_TITLES,
  EVENT_STATE_KINDS,
  EventStateKind,
  EventStateKindDefinition,
  EventStateQuickMove,
  MARK_AS_STATE,
  QUICK_MOVE_RESULT_LABELS,
  ROW_CHANGE_STATE_DESCRIPTION,
} from "./EventStateKinds";
import {
  EventStateLike,
  getMoveRefusal,
  getQuickMoveTarget,
  getRowStateId,
  getStateId,
  getStatesToOffer,
  isQuickMoveOffered,
} from "./EventStateMoves";
import { STATE_CHANGE_NOTE_TITLES } from "./StateChangeFormFields";
import useNoteTemplates from "./useNoteTemplates";

/*
 * MOVE INCIDENTS, ALERTS, EPISODES AND SCHEDULED MAINTENANCE FROM THEIR LISTS.
 *
 * The everyday moves of a record that walks down a list of states, without
 * opening it - in each row's ⋯ menu and in Bulk Actions, the same on every
 * list of the kind (EventStateKinds):
 *
 *   - Acknowledge and Resolve (incidents, alerts, episodes), Mark as Ongoing
 *     and Mark as Ended (scheduled maintenance), offered on a row only when
 *     it can make that move now - the state timeline's own rule
 *     (EventStateMoves);
 *   - Change State, to any state the row may move into next;
 *   - every one asks first, as the record's page does: the same words, the
 *     same "Notify Status Page Subscribers" where the record reaches a
 *     status page, the same note folded under "Add a public note" / "Add a
 *     private note", offered to whoever may post it - and names the records
 *     it is about;
 *   - each record is moved by a new row of its state timeline, written
 *     through the API as one row's move is - several records at once (the
 *     kind's bulkConcurrency), their states read a window at a time just
 *     before (BulkReadAhead: one list request per window, not one read per
 *     record): one that is there already, or past it, is left alone and
 *     listed with why ("Already acknowledged."), one the server refuses is
 *     listed in its words;
 *   - someone who may not move the kind sees the actions locked, saying so
 *     for the row or for the selection ("You do not have permission to
 *     change this incident's state.", "... the state of these incidents."),
 *     with the permission it takes.
 *
 * The list hands it the project's states as it read them (their places,
 * archive switches and built-in flags) and reads each row's current state
 * with its _id.
 */

export interface EventStateActionsConfig<T extends BaseModel> {
  kind: EventStateKind;
  states: Array<BaseModel>;
  // How a dialog names a row; its name column otherwise.
  getItemName?: ((item: T) => string) | undefined;
  // Told once records moved (after the list is read again).
  onChanged?: (() => void) | undefined;
}

export interface EventStateActionsResult<T extends BaseModel> {
  rowActions: Array<ActionButtonSchema<T>>;
  bulkActions: Array<BulkActionButtonSchema<T>>;
  modals: ReactElement;
}

interface StateDialog<T extends BaseModel> {
  scope: "row" | "bulk";
  // The named move, or null for Change State.
  move: EventStateQuickMove | null;
  // Where a named move goes.
  targetState: EventStateLike | null;
  items: Array<T>;
  bulkActionProps?: BulkActionOnClickProps<T> | undefined;
  context?: RowActionContext | undefined;
}

// Change State's icon: the flag every event list's State filter wears.
export const CHANGE_STATE_ICON: IconProp = IconProp.Flag;

// A move's lock: disabled, with why, when the reader may not make it.
export interface EventStateActionLock {
  disabled?: boolean;
  tooltip?: string;
}

/*
 * Locked only with a reason to show: before the permissions are read there
 * is nothing honest to say, and the server decides (PermissionGate).
 */
export const getEventStateActionLock: (
  gate: PermissionGateResult,
) => EventStateActionLock = (
  gate: PermissionGateResult,
): EventStateActionLock => {
  return !gate.isAllowed && gate.disabledReason
    ? { disabled: true, tooltip: gate.disabledReason }
    : {};
};

const QUICK_MOVE_ICONS: Record<EventStateQuickMove, IconProp> = {
  [EventStateQuickMove.Acknowledge]: IconProp.Check,
  [EventStateQuickMove.Resolve]: IconProp.CheckCircle,
  [EventStateQuickMove.Start]: IconProp.Clock,
  [EventStateQuickMove.End]: IconProp.CheckCircle,
};

function useEventStateActions<T extends BaseModel>(
  config: EventStateActionsConfig<T>,
): EventStateActionsResult<T> {
  const translator: Translator = useTranslator();
  const tx: (text: string) => string = (text: string): string => {
    return translator.translateText(text) || text;
  };
  const definition: EventStateKindDefinition = EVENT_STATE_KINDS[config.kind];
  const model: BaseModel = new definition.eventModelType();
  const states: Array<EventStateLike> =
    config.states as unknown as Array<EventStateLike>;

  const { noteTemplates } = useNoteTemplates({
    modelType: definition.noteTemplateModelType as never,
  });

  const [dialog, setDialog] = useState<StateDialog<T> | null>(null);
  const [dialogError, setDialogError] = useState<string>("");
  // A row's move in flight: a second press of the dialog's button waits.
  const isRowMoveRunning: React.MutableRefObject<boolean> =
    useRef<boolean>(false);
  // The same, drawn: the dialog's button is busy while the move is written.
  const [isRowMoving, setIsRowMoving] = useState<boolean>(false);

  /*
   * A move is a new row of the kind's state timeline: someone who may not
   * create one may not move the record. They find the moves locked, saying
   * why in the words of what they pressed - a row's as its record page
   * says it, a selection's about the records selected - and not "create
   * this Incident State Timeline" (EventStateKinds' lock sentences).
   */
  const rowLock: EventStateActionLock = getEventStateActionLock(
    PermissionGate.check(new definition.timelineModelType(), ModelAction.Create, {
      sentence: definition.words.rowLockSentence,
    }),
  );

  const bulkLock: EventStateActionLock = getEventStateActionLock(
    PermissionGate.check(new definition.timelineModelType(), ModelAction.Create, {
      sentence: definition.words.bulkLockSentence,
    }),
  );

  const nameOf: (item: T) => string = (item: T): string => {
    const given: string = config.getItemName
      ? config.getItemName(item).trim()
      : "";

    return given || getRecordDisplayName(item, { model: model });
  };

  const stateTerm: (
    state: EventStateLike | null,
    inSentence: boolean,
  ) => TranslatableTerm = (
    state: EventStateLike | null,
    inSentence: boolean,
  ): TranslatableTerm => {
    return translatableTerm(state?.name || "", { inSentence: inSentence });
  };

  // The menu item of a named move: "Acknowledge", "Mark as Ongoing".
  const getQuickMoveTitle: (
    move: EventStateQuickMove,
    target: EventStateLike | null,
  ) => string = (
    move: EventStateQuickMove,
    target: EventStateLike | null,
  ): string => {
    if (move === EventStateQuickMove.Acknowledge) {
      return "Acknowledge";
    }

    if (move === EventStateQuickMove.Resolve) {
      return "Resolve";
    }

    return translator.translateTemplate(MARK_AS_STATE, {
      state: stateTerm(target, false),
    });
  };

  const isPrivateRow: (item: T | undefined) => boolean = (
    item: T | undefined,
  ): boolean => {
    return Boolean(
      definition.hasPerEventPrivacy &&
        item &&
        !PrivateRecordPublicNotes.takesPublicNotes(
          item as unknown as Parameters<
            typeof PrivateRecordPublicNotes.takesPublicNotes
          >[0],
        ),
    );
  };

  // What a move reads of a record first: the state it is in now.
  const currentSelect: Record<string, unknown> = {
    _id: true,
    [definition.currentStateColumn]: {
      _id: true,
      name: true,
      order: true,
    },
    ...(definition.hasPerEventPrivacy ? { isPrivate: true } : {}),
  };

  // One record's state, read alone: a row's move.
  const readOne: (item: T) => Promise<BaseModel | null> = async (
    item: T,
  ): Promise<BaseModel | null> => {
    if (!item.id) {
      return null;
    }

    return await ModelAPI.getItem<BaseModel>({
      modelType: definition.eventModelType,
      id: item.id,
      select: currentSelect as never,
    });
  };

  /*
   * A window of records' states in one list request: a bulk move
   * (BulkReadAhead). A record the answer leaves out was deleted since, or is
   * one the viewer may not read: it is moved as before, and the server
   * answers for it.
   */
  const readWindow: (
    items: Array<T>,
  ) => Promise<Map<string, BaseModel>> = async (
    items: Array<T>,
  ): Promise<Map<string, BaseModel>> => {
    const ids: Array<string> = items
      .map((item: T): string => {
        return item.id?.toString() || "";
      })
      .filter((id: string): boolean => {
        return id.length > 0;
      });

    const found: Map<string, BaseModel> = new Map<string, BaseModel>();

    if (ids.length === 0) {
      return found;
    }

    const result: ListResult<BaseModel> = await ModelAPI.getList<BaseModel>({
      modelType: definition.eventModelType,
      query: {
        _id: new Includes(ids),
      } as never,
      limit: ids.length,
      skip: 0,
      select: currentSelect as never,
      sort: {},
    });

    for (const record of result.data) {
      const id: string = record.id?.toString() || "";

      if (id) {
        found.set(id, record);
      }
    }

    return found;
  };

  /*
   * Moves one record: reads the state it is in now, leaves it alone if the
   * move would not take it anywhere it may go, else writes the new row of
   * its state timeline, with the note and the subscriber flag the dialog
   * asked for.
   */
  type MoveFunction = (data: {
    item: T;
    targetStateId: string;
    targetStateName: string;
    move: EventStateQuickMove | null;
    submitted: BulkChangeStateSubmitData;
    readCurrent: (item: T) => Promise<BaseModel | null>;
  }) => Promise<BulkItemOutcome>;

  const moveOne: MoveFunction = async (data: {
    item: T;
    targetStateId: string;
    targetStateName: string;
    move: EventStateQuickMove | null;
    submitted: BulkChangeStateSubmitData;
    readCurrent: (item: T) => Promise<BaseModel | null>;
  }): Promise<BulkItemOutcome> => {
    if (!data.item.id) {
      throw new BadDataException("Item ID not found");
    }

    const fetched: BaseModel | null = await data.readCurrent(data.item);

    const refusal: string | null = getMoveRefusal({
      definition: definition,
      states: states,
      move: data.move,
      currentStateId: getRowStateId({ definition: definition, item: fetched }),
      targetStateId: data.targetStateId,
    });

    if (refusal) {
      return bulkItemUnchanged(
        translator.translateTemplate(refusal, {
          state: translatableTerm(data.targetStateName),
        }),
      );
    }

    const timeline: BaseModel = new definition.timelineModelType();
    const row: Record<string, unknown> = timeline as unknown as Record<
      string,
      unknown
    >;

    row[definition.eventIdField] = data.item.id;
    row[definition.stateIdField] = new ObjectID(data.targetStateId);
    row["projectId"] = ProjectUtil.getCurrentProjectId()!;

    let miscDataProps: JSONObject = {};

    if (definition.hasPerEventPrivacy) {
      // A private incident takes the note as a private one and tells nobody.
      const change: IncidentBulkStateChange = buildIncidentBulkStateChange({
        isPrivate: !PrivateRecordPublicNotes.takesPublicNotes(
          fetched as unknown as Parameters<
            typeof PrivateRecordPublicNotes.takesPublicNotes
          >[0],
        ),
        note: data.submitted.note,
        shouldStatusPageSubscribersBeNotified:
          data.submitted.shouldStatusPageSubscribersBeNotified,
      });

      row["shouldStatusPageSubscribersBeNotified"] =
        change.shouldStatusPageSubscribersBeNotified;
      miscDataProps = change.miscDataProps;
    } else {
      miscDataProps = buildBulkStateChangeMiscDataProps({
        noteType: definition.noteType,
        note: data.submitted.note,
      });

      if (definition.notifiesSubscribers) {
        row["shouldStatusPageSubscribersBeNotified"] =
          data.submitted.shouldStatusPageSubscribersBeNotified ?? true;
      }
    }

    await ModelAPI.create<BaseModel>({
      model: timeline,
      modelType: definition.timelineModelType,
      miscDataProps: miscDataProps,
    });

    return BULK_ITEM_CHANGED;
  };

  const afterMoves: (context?: RowActionContext | undefined) => void = (
    context?: RowActionContext | undefined,
  ): void => {
    context?.refresh();
    // The side menu's counts (Unresolved, Active) follow.
    GlobalEvents.dispatchEvent(REFRESH_SIDEBAR_COUNT_EVENT);
    config.onChanged?.();
  };

  const close: VoidFunction = (): void => {
    setDialog(null);
    setDialogError("");
  };

  type SubmitFunction = (submitted: BulkChangeStateSubmitData) => Promise<void>;

  const submit: SubmitFunction = async (
    submitted: BulkChangeStateSubmitData,
  ): Promise<void> => {
    if (!dialog) {
      return;
    }

    const targetStateId: string = submitted.stateId.toString();
    const targetState: EventStateLike | undefined = states.find(
      (state: EventStateLike): boolean => {
        return getStateId(state) === targetStateId;
      },
    );
    const targetStateName: string =
      targetState?.name || dialog.targetState?.name || "";

    if (dialog.scope === "row") {
      const item: T | undefined = dialog.items[0];

      if (!item || isRowMoveRunning.current) {
        return;
      }

      isRowMoveRunning.current = true;
      setIsRowMoving(true);

      try {
        const outcome: BulkItemOutcome = await moveOne({
          item: item,
          targetStateId: targetStateId,
          targetStateName: targetStateName,
          move: dialog.move,
          submitted: submitted,
          readCurrent: readOne,
        });

        // Left alone: the dialog says why, and nothing was written.
        if ("reason" in outcome) {
          setDialogError(outcome.reason);
          return;
        }
      } catch (err) {
        setDialogError(API.getFriendlyMessage(err));
        return;
      } finally {
        isRowMoveRunning.current = false;
        setIsRowMoving(false);
      }

      const context: RowActionContext | undefined = dialog.context;
      close();
      afterMoves(context);
      return;
    }

    const actionProps: BulkActionOnClickProps<T> | undefined =
      dialog.bulkActionProps;
    const move: EventStateQuickMove | null = dialog.move;

    // The progress dialog takes over.
    close();

    if (!actionProps) {
      return;
    }

    const reader: BulkReadAhead<T, BaseModel> = new BulkReadAhead<T, BaseModel>(
      {
        items: actionProps.items,
        getKey: (item: T): string => {
          return item.id?.toString() || "";
        },
        readWindow: readWindow,
        readOne: readOne,
      },
    );

    await runBulkAction<T>({
      actionProps: actionProps,
      concurrency: definition.bulkConcurrency,
      step: async (item: T): Promise<BulkItemOutcome> => {
        return await moveOne({
          item: item,
          targetStateId: targetStateId,
          targetStateName: targetStateName,
          move: move,
          submitted: submitted,
          readCurrent: (record: T): Promise<BaseModel | null> => {
            return reader.read(record);
          },
        });
      },
    });

    afterMoves();
  };

  const rowActions: Array<ActionButtonSchema<T>> = [];
  const bulkActions: Array<BulkActionButtonSchema<T>> = [];

  for (const move of definition.quickMoves) {
    const target: EventStateLike | null = getQuickMoveTarget({
      definition: definition,
      states: states,
      move: move,
    });

    // A project without the state the move goes to offers no such move.
    if (!target || !getStateId(target)) {
      continue;
    }

    const title: string = getQuickMoveTitle(move, target);

    rowActions.push({
      title: title,
      icon: QUICK_MOVE_ICONS[move],
      buttonStyleType: ButtonStyleType.OUTLINE,
      menuGroup: ActionMenuGroup.Change,
      // In the ⋯ menu: the row's one button stays View.
      placement: ActionButtonPlacement.MoreMenu,
      isVisible: (item: T): boolean => {
        return isQuickMoveOffered({
          definition: definition,
          states: states,
          move: move,
          currentStateId: getRowStateId({ definition: definition, item: item }),
        });
      },
      ...rowLock,
      onClick: (
        item: T,
        onCompleteAction: VoidFunction,
        _onError: ErrorFunction,
        context?: RowActionContext | undefined,
      ): void => {
        setDialogError("");
        setDialog({
          scope: "row",
          move: move,
          targetState: target,
          items: [item],
          context: context,
        });
        onCompleteAction();
      },
    });

    bulkActions.push({
      title: title,
      icon: QUICK_MOVE_ICONS[move],
      buttonStyleType: ButtonStyleType.NORMAL,
      menuGroup: ActionMenuGroup.Change,
      resultLabels:
        QUICK_MOVE_RESULT_LABELS[move] || VALUE_CHANGE_RESULT_LABELS,
      // Nothing to do when every selected row is there already.
      isVisible: (items: Array<T>): boolean => {
        if (items.length === 0) {
          return true;
        }

        return items.some((item: T): boolean => {
          return isQuickMoveOffered({
            definition: definition,
            states: states,
            move: move,
            currentStateId: getRowStateId({
              definition: definition,
              item: item,
            }),
          });
        });
      },
      ...bulkLock,
      onClick: async (
        actionProps: BulkActionOnClickProps<T>,
      ): Promise<void> => {
        setDialogError("");
        setDialog({
          scope: "bulk",
          move: move,
          targetState: target,
          items: actionProps.items,
          bulkActionProps: actionProps,
        });
      },
    });
  }

  /*
   * A flag, as the list's own State filter wears: the same idea, drawn the
   * same way on the page.
   */
  rowActions.push({
    title: "Change State",
    icon: CHANGE_STATE_ICON,
    buttonStyleType: ButtonStyleType.OUTLINE,
    menuGroup: ActionMenuGroup.Change,
    placement: ActionButtonPlacement.MoreMenu,
    // Only when there is a state to move to.
    isVisible: (item: T): boolean => {
      return (
        getStatesToOffer({
          definition: definition,
          states: states,
          currentStateId: getRowStateId({ definition: definition, item: item }),
        }).length > 0
      );
    },
    ...rowLock,
    onClick: (
      item: T,
      onCompleteAction: VoidFunction,
      _onError: ErrorFunction,
      context?: RowActionContext | undefined,
    ): void => {
      setDialogError("");
      setDialog({
        scope: "row",
        move: null,
        targetState: null,
        items: [item],
        context: context,
      });
      onCompleteAction();
    },
  });

  bulkActions.push({
    title: "Change State",
    buttonStyleType: ButtonStyleType.NORMAL,
    menuGroup: ActionMenuGroup.Change,
    icon: CHANGE_STATE_ICON,
    resultLabels: VALUE_CHANGE_RESULT_LABELS,
    ...bulkLock,
    onClick: async (actionProps: BulkActionOnClickProps<T>): Promise<void> => {
      setDialogError("");
      setDialog({
        scope: "bulk",
        move: null,
        targetState: null,
        items: actionProps.items,
        bulkActionProps: actionProps,
      });
    },
  });

  let modals: ReactElement = <></>;

  if (dialog) {
    const firstItem: T | undefined = dialog.items[0];
    const isRow: boolean = dialog.scope === "row";
    // One private incident's dialog: a private note, no subscribers.
    const isPrivate: boolean = isRow && isPrivateRow(firstItem);
    const noteType: BulkStateChangeNoteType = isPrivate
      ? BulkStateChangeNoteType.Private
      : definition.noteType;
    const nounValues: Record<string, TranslatableTerm> = {
      itemName: translatableTerm(model.singularName || "item", {
        inSentence: true,
      }),
      itemsName: translatableTerm(model.pluralName || "items", {
        inSentence: true,
      }),
    };

    let title: string = tx(definition.words.changeStateTitle);
    let description: string = "";
    let submitButtonText: string = "Change State";

    if (dialog.move) {
      submitButtonText = getQuickMoveTitle(dialog.move, dialog.targetState);

      if (isRow) {
        const words: { rowTitle: string; rowDescription: string } | undefined =
          definition.quickMoveWords[dialog.move];

        title = translator.translateTemplate(words?.rowTitle || "", {
          state: stateTerm(dialog.targetState, false),
        });
        description = tx(words?.rowDescription || "");
      } else {
        title = translator.translatePlural(
          BULK_QUICK_MOVE_TITLES[dialog.move],
          dialog.items.length,
          {
            itemName: translatableTerm(model.singularName || "item"),
            itemsName: translatableTerm(model.pluralName || "items"),
            state: stateTerm(dialog.targetState, false),
          },
        );

        const sentences: Array<string> = [
          translator.translateTemplate(
            BULK_QUICK_MOVE_DESCRIPTIONS[dialog.move],
            {
              ...nounValues,
              state: stateTerm(dialog.targetState, true),
            },
          ),
        ];

        if (
          definition.words.bulkMembersSentence &&
          (dialog.move === EventStateQuickMove.Acknowledge ||
            dialog.move === EventStateQuickMove.Resolve)
        ) {
          sentences.push(tx(definition.words.bulkMembersSentence));
        }

        description = joinSentences(sentences);
      }
    } else if (isRow) {
      description = translator.translateTemplate(ROW_CHANGE_STATE_DESCRIPTION, {
        name: firstItem ? nameOf(firstItem) : "",
      });
    } else {
      description = tx(definition.words.changeStateBulkDescription);
    }

    const stateOptions: Array<EventStateLike> = dialog.move
      ? []
      : isRow
        ? getStatesToOffer({
            definition: definition,
            states: states,
            currentStateId: getRowStateId({
              definition: definition,
              item: firstItem,
            }),
          })
        : states.filter((state: EventStateLike): boolean => {
            return state.isArchived !== true;
          });

    const noteModelType: { new (): BaseModel } =
      isPrivate && definition.privateNoteModelType
        ? definition.privateNoteModelType
        : definition.noteModelType;

    modals = (
      <BulkChangeStateModal
        title={title}
        description={description}
        submitButtonText={submitButtonText}
        stateFieldKey={definition.stateIdField}
        stateOptions={DropdownUtil.getDropdownOptionsFromEntityArray({
          array: stateOptions as unknown as Array<BaseModel>,
          labelField: "name",
          valueField: "_id",
        })}
        fixedStateId={
          dialog.move && dialog.targetState
            ? getStateId(dialog.targetState)
            : undefined
        }
        /*
         * The records it lands on, named above the fields - but not for one
         * row's Change State, whose sentence names the row already ("Pick
         * the next state for Checkout API down.").
         */
        itemNames={
          isRow && !dialog.move
            ? undefined
            : dialog.items.map((item: T): string => {
                return nameOf(item);
              })
        }
        noteType={noteType}
        noteTitle={
          isRow
            ? STATE_CHANGE_NOTE_TITLES[noteType]
            : definition.words.bulkNoteTitle
        }
        noteDescription={
          isRow
            ? isPrivate && definition.words.rowPrivateNoteDescription
              ? definition.words.rowPrivateNoteDescription
              : definition.words.rowNoteDescription
            : definition.words.bulkNoteDescription
        }
        noteTemplates={noteTemplates}
        noteModel={new noteModelType()}
        showNotifyStatusPageSubscribers={
          definition.notifiesSubscribers && !isPrivate
        }
        error={dialogError || undefined}
        isSubmitting={isRow && isRowMoving}
        onClose={close}
        onSubmit={submit}
      />
    );
  }

  return {
    rowActions: rowActions,
    bulkActions: bulkActions,
    modals: modals,
  };
}

export default useEventStateActions;

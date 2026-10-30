import {
  ISSUE_MOVES_LOCKED,
  ISSUE_MOVE_BULK_QUESTIONS,
  ISSUE_MOVE_ICONS,
  ISSUE_MOVE_RESULT_LABELS,
  ISSUE_MOVE_TITLES,
  IssueAcceptance,
  IssueMove,
  getIssueMoveSentence,
  getIssueMoveSkipReason,
  getIssueMoveWrite,
  getIssueName,
  isIssueMoveOffered,
  readIssueId,
} from "./IssueChanges";
import { AcceptIssueRiskModal } from "./IssueModals";
import DataSecurityIssue from "Common/Models/DatabaseModels/DataSecurityIssue";
import BadDataException from "Common/Types/Exception/BadDataException";
import { ErrorFunction, VoidFunction } from "Common/Types/FunctionTypes";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import ActionButtonSchema, {
  ActionButtonPlacement,
  RowActionConfirmation,
} from "Common/UI/Components/ActionButton/ActionButtonSchema";
import { ActionMenuGroup } from "Common/UI/Components/ActionButton/ActionMenuGroup";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import {
  BULK_ACTION_CONCURRENCY,
  BULK_ITEM_CHANGED,
  BulkItemOutcome,
  bulkItemUnchanged,
  runBulkAction,
} from "Common/UI/Components/BulkUpdate/BulkActionRunner";
import {
  BulkActionButtonSchema,
  BulkActionOnClickProps,
} from "Common/UI/Components/BulkUpdate/BulkUpdateForm";
import DeleteItemNames from "Common/UI/Components/DeleteConfirmation/DeleteItemNames";
import NamedSentence from "Common/UI/Components/DeleteConfirmation/NamedSentence";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import PermissionGate, {
  ModelAction,
  PermissionGateResult,
} from "Common/UI/Utils/PermissionGate";
import {
  PluralTemplate,
  Translator,
  translationKey,
} from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { ReactElement, useState } from "react";

/*
 * WORKING DATA SECURITY ISSUES FROM THE LIST.
 *
 * Each row's ⋯ menu offers the moves its issue can take - Mark Resolved,
 * Accept Risk, Not an Issue, Reopen - beside View, and Bulk Actions offers
 * Mark Resolved, Accept Risk and Not an Issue for the issues selected. Each
 * move is the update the issue's own page makes (IssueChanges), one issue
 * at a time through the API, so the server checks the permission on each
 * and writes each to its timeline. Bulk Actions asks first, naming the
 * issues, and its result lists the ones left alone ("Already resolved.")
 * and the ones the server refused, in its words.
 *
 * Changing an issue is an update of it: a reader who may not (a Security
 * Viewer) sees the moves locked, saying what it takes; before the reader's
 * permissions are known they are not shown.
 */

/*
 * The question a row asks before a move that closes its issue. Accept Risk
 * asks in its own dialog; Reopen asks nothing - it is undone from the same
 * menu.
 */
const ROW_QUESTIONS: Partial<Record<IssueMove, string>> = {
  [IssueMove.Resolve]: translationKey("Mark {{name}} resolved?"),
  [IssueMove.NotAnIssue]: translationKey("Mark {{name}} as not an issue?"),
};

// The moves Bulk Actions offers, in its menu's order.
const BULK_MOVES: ReadonlyArray<IssueMove> = [
  IssueMove.Resolve,
  IssueMove.Accept,
  IssueMove.NotAnIssue,
];

// The moves a row's ⋯ offers, in its order.
const ROW_MOVES: ReadonlyArray<IssueMove> = [
  IssueMove.Resolve,
  IssueMove.Accept,
  IssueMove.NotAnIssue,
  IssueMove.Reopen,
];

export interface IssueListActionsConfig {
  // Told once issues changed: the list reads its rows again.
  onChanged: () => void;
}

export interface IssueListActions {
  // In each row's ⋯ menu, in this order, before the table's own Delete.
  rowActions: Array<ActionButtonSchema<DataSecurityIssue>>;
  // In Bulk Actions, before the table's own Delete.
  bulkActions: Array<BulkActionButtonSchema<DataSecurityIssue>>;
  // Accept Risk's dialog; drawn by the list beside its table.
  modals: ReactElement;
}

interface AcceptDialog {
  issues: Array<DataSecurityIssue>;
  // Set for Bulk Actions: the run its progress dialog reports.
  bulkActionProps?: BulkActionOnClickProps<DataSecurityIssue> | undefined;
}

function idOf(issue: DataSecurityIssue): ObjectID {
  const id: ObjectID | null = readIssueId(issue);

  if (!id) {
    throw new BadDataException("Issue ID not found");
  }

  return id;
}

export default function useIssueListActions(
  config: IssueListActionsConfig,
): IssueListActions {
  const translator: Translator = useTranslator();
  const [acceptDialog, setAcceptDialog] = useState<AcceptDialog | null>(null);

  const gate: PermissionGateResult = PermissionGate.check(
    new DataSecurityIssue(),
    ModelAction.Update,
    { sentence: ISSUE_MOVES_LOCKED },
  );
  const isShown: boolean = gate.isAllowed || Boolean(gate.disabledReason);
  const lock: { disabled?: boolean; tooltip?: string } = gate.isAllowed
    ? {}
    : {
        disabled: true,
        ...(gate.disabledReason ? { tooltip: gate.disabledReason } : {}),
      };

  type WriteFunction = (
    issue: DataSecurityIssue,
    data: JSONObject,
  ) => Promise<void>;

  const write: WriteFunction = async (
    issue: DataSecurityIssue,
    data: JSONObject,
  ): Promise<void> => {
    await ModelAPI.updateById<DataSecurityIssue>({
      modelType: DataSecurityIssue,
      id: idOf(issue),
      data: data,
    });
  };

  type StepFunction = (
    move: IssueMove,
    acceptance?: IssueAcceptance | undefined,
  ) => (issue: DataSecurityIssue) => Promise<BulkItemOutcome>;

  const stepFor: StepFunction = (
    move: IssueMove,
    acceptance?: IssueAcceptance | undefined,
  ) => {
    return async (issue: DataSecurityIssue): Promise<BulkItemOutcome> => {
      const reason: string | null = getIssueMoveSkipReason(issue, move);

      if (reason) {
        return bulkItemUnchanged(translator.translateText(reason) || reason);
      }

      await write(issue, getIssueMoveWrite(move, acceptance));

      return BULK_ITEM_CHANGED;
    };
  };

  type RunBulkFunction = (
    actionProps: BulkActionOnClickProps<DataSecurityIssue>,
    step: (issue: DataSecurityIssue) => Promise<BulkItemOutcome>,
  ) => Promise<void>;

  const runBulk: RunBulkFunction = async (
    actionProps: BulkActionOnClickProps<DataSecurityIssue>,
    step: (issue: DataSecurityIssue) => Promise<BulkItemOutcome>,
  ): Promise<void> => {
    try {
      await runBulkAction<DataSecurityIssue>({
        actionProps: actionProps,
        concurrency: BULK_ACTION_CONCURRENCY,
        step: step,
      });
    } finally {
      config.onChanged();
    }
  };

  type ConfirmationFunction = (
    move: IssueMove,
    question: string,
  ) => (issue: DataSecurityIssue) => RowActionConfirmation;

  const confirmationFor: ConfirmationFunction = (
    move: IssueMove,
    question: string,
  ) => {
    return (issue: DataSecurityIssue): RowActionConfirmation => {
      return {
        title: ISSUE_MOVE_TITLES[move],
        description: (
          <NamedSentence
            template={question}
            name={getIssueName(issue, translator)}
            dataTestId="data-security-issue-move-name"
          />
        ),
        details: (
          <p className="text-sm leading-6 text-gray-600">
            {getIssueMoveSentence(move, translator)}
          </p>
        ),
        submitButtonText: ISSUE_MOVE_TITLES[move],
      };
    };
  };

  const rowActions: Array<ActionButtonSchema<DataSecurityIssue>> = !isShown
    ? []
    : ROW_MOVES.map(
        (move: IssueMove): ActionButtonSchema<DataSecurityIssue> => {
          const base: ActionButtonSchema<DataSecurityIssue> = {
            title: ISSUE_MOVE_TITLES[move],
            icon: ISSUE_MOVE_ICONS[move],
            buttonStyleType: ButtonStyleType.OUTLINE,
            // In the ⋯ menu: the row's one button stays View.
            placement: ActionButtonPlacement.MoreMenu,
            menuGroup: ActionMenuGroup.Change,
            isVisible: (issue: DataSecurityIssue): boolean => {
              return isIssueMoveOffered(issue, move);
            },
            ...lock,
            onClick: async (
              issue: DataSecurityIssue,
              onCompleteAction: VoidFunction,
              onError: ErrorFunction,
            ): Promise<void> => {
              if (move === IssueMove.Accept) {
                setAcceptDialog({ issues: [issue] });
                onCompleteAction();
                return;
              }

              try {
                await write(issue, getIssueMoveWrite(move));
                onCompleteAction();
                config.onChanged();
              } catch (err) {
                onError(err as Error);
              }
            },
          };

          const question: string | undefined = ROW_QUESTIONS[move];

          return question
            ? { ...base, getConfirmation: confirmationFor(move, question) }
            : base;
        },
      );

  const namesOf: (issues: Array<DataSecurityIssue>) => Array<string> = (
    issues: Array<DataSecurityIssue>,
  ): Array<string> => {
    return issues
      .map((issue: DataSecurityIssue): string => {
        return getIssueName(issue, translator);
      })
      .filter((name: string): boolean => {
        return Boolean(name);
      });
  };

  const bulkActions: Array<BulkActionButtonSchema<DataSecurityIssue>> = !isShown
    ? []
    : BULK_MOVES.map(
        (move: IssueMove): BulkActionButtonSchema<DataSecurityIssue> => {
          const action: BulkActionButtonSchema<DataSecurityIssue> = {
            title: ISSUE_MOVE_TITLES[move],
            icon: ISSUE_MOVE_ICONS[move],
            buttonStyleType: ButtonStyleType.NORMAL,
            menuGroup: ActionMenuGroup.Change,
            resultLabels: ISSUE_MOVE_RESULT_LABELS[move],
            ...lock,
            onClick: async (
              actionProps: BulkActionOnClickProps<DataSecurityIssue>,
            ): Promise<void> => {
              if (move === IssueMove.Accept) {
                // Asks why and until when first; the run starts from there.
                setAcceptDialog({
                  issues: actionProps.items,
                  bulkActionProps: actionProps,
                });
                return;
              }

              await runBulk(actionProps, stepFor(move));
            },
          };

          if (move === IssueMove.Accept) {
            return action;
          }

          return {
            ...action,
            confirmTitle: (items: Array<DataSecurityIssue>): string => {
              const question: PluralTemplate | undefined =
                ISSUE_MOVE_BULK_QUESTIONS[move];

              return question
                ? translator.translatePlural(question, items.length)
                : translator.translateText(ISSUE_MOVE_TITLES[move]) ||
                    ISSUE_MOVE_TITLES[move];
            },
            confirmMessage: (): string => {
              return getIssueMoveSentence(move, translator);
            },
            confirmDetails: (items: Array<DataSecurityIssue>): ReactElement => {
              return (
                <DeleteItemNames
                  names={namesOf(items)}
                  totalCount={items.length}
                />
              );
            },
            confirmButtonStyleType: ButtonStyleType.PRIMARY,
          };
        },
      );

  const modals: ReactElement = acceptDialog ? (
    <AcceptIssueRiskModal
      issues={acceptDialog.issues}
      onClose={() => {
        setAcceptDialog(null);
      }}
      onSubmit={async (acceptance: IssueAcceptance): Promise<void> => {
        const dialog: AcceptDialog = acceptDialog;

        if (dialog.bulkActionProps) {
          // The progress dialog takes over from here.
          setAcceptDialog(null);
          await runBulk(
            dialog.bulkActionProps,
            stepFor(IssueMove.Accept, acceptance),
          );
          return;
        }

        const issue: DataSecurityIssue | undefined = dialog.issues[0];

        if (issue) {
          // Saved with the dialog open, which says why if it cannot be.
          await write(issue, getIssueMoveWrite(IssueMove.Accept, acceptance));
        }

        setAcceptDialog(null);
        config.onChanged();
      }}
    />
  ) : (
    <></>
  );

  return {
    rowActions: rowActions,
    bulkActions: bulkActions,
    modals: modals,
  };
}

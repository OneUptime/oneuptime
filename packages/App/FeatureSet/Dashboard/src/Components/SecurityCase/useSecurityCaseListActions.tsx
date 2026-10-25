import {
  ASSIGNED_RESULT_LABELS,
  ASSIGNED_TO_YOU_RESULT_LABELS,
  ASSIGN_TO_ME,
  ASSIGN_TO_SOMEONE_ELSE,
  CHANGE_PRIORITY,
  CHANGE_STATUS,
  SECURITY_CASE_CHANGE_ICONS,
  SKIP_REASON_TEXT,
  SecurityCaseAssigneePick,
  SecurityCaseSkipReason,
  SecurityCaseStatusPick,
  UPDATED_RESULT_LABELS,
  getSecurityCaseAssignSkipReason,
  getSecurityCaseAssignWrite,
  getSecurityCasePrioritySkipReason,
  getSecurityCasePriorityWrite,
  getSecurityCaseStatusSkipReason,
  getSecurityCaseStatusWrite,
  getSecurityCaseValueName,
  isAssignToMeOffered,
  isAssignToSomeoneElseOffered,
  readSecurityCaseId,
} from "./SecurityCaseChanges";
import {
  AssignSecurityCaseModal,
  ChangeSecurityCasePriorityModal,
  ChangeSecurityCaseStatusModal,
} from "./SecurityCaseChangeModals";
import { SecurityCaseValueLists } from "./SecurityCaseValues";
import SecurityCase from "Common/Models/DatabaseModels/SecurityCase";
import SecurityCasePriority from "Common/Models/DatabaseModels/SecurityCasePriority";
import SecurityCaseStatus from "Common/Models/DatabaseModels/SecurityCaseStatus";
import BadDataException from "Common/Types/Exception/BadDataException";
import { ErrorFunction, VoidFunction } from "Common/Types/FunctionTypes";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import ActionButtonSchema, {
  ActionButtonPlacement,
} from "Common/UI/Components/ActionButton/ActionButtonSchema";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import {
  BULK_ITEM_CHANGED,
  BulkItemOutcome,
  bulkItemUnchanged,
  runBulkAction,
} from "Common/UI/Components/BulkUpdate/BulkActionRunner";
import {
  BulkActionButtonSchema,
  BulkActionOnClickProps,
} from "Common/UI/Components/BulkUpdate/BulkUpdateForm";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import PermissionGate, {
  ModelAction,
  PermissionGateResult,
} from "Common/UI/Utils/PermissionGate";
import {
  Translator,
  translatableTerm,
} from "Common/UI/Utils/TranslateTemplate";
import User from "Common/UI/Utils/User";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { ReactElement, useState } from "react";

/*
 * WORKING CASES FROM A LIST.
 *
 * Every list of security cases offers the moves a case is worked with, in
 * each row's ⋯ menu - beside View, with Delete kept last - and in Bulk
 * Actions for the cases selected:
 *
 *   - Assign to Me, at once, on an open case that is not the reader's;
 *   - Assign to Someone Else, a person or a team, on an open case;
 *   - Change Status, which asks for the verdict when the status closes;
 *   - Change Priority.
 *
 * What each writes, and when a case is left as it is, is
 * SecurityCaseChanges' - the rules the case's own page follows - and every
 * write is an update through the API, one case at a time, so the server
 * checks each and records each on the case's timeline, naming who made it.
 * Bulk Actions' result lists each case left alone with why ("Already
 * Investigating.") and each the server refused with its words.
 *
 * Working a case is an update of it: a reader who may not update cases
 * (a Security Viewer) sees every one of these locked, saying what it takes,
 * as the table's own Delete does. Before the reader's permissions are known
 * they are not shown at all.
 */

export interface SecurityCaseListActionsConfig {
  // The project's priorities and statuses (Security Events > Settings).
  values: SecurityCaseValueLists;
  /*
   * Which bulk assignments the list offers: Assign to Me where cases are
   * taken on (not Assigned to Me, not Closed Cases), Assign to Someone
   * Else wherever cases are worked (not Closed Cases). Rows offer them by
   * the case (SecurityCaseChanges).
   */
  canAssignToMeInBulk: boolean;
  canAssignToSomeoneElseInBulk: boolean;
  // Told once cases changed: the list reads its rows again.
  onChanged: () => void;
}

export interface SecurityCaseListActions {
  // In each row's ⋯ menu, in this order, before the table's own Delete.
  rowActions: Array<ActionButtonSchema<SecurityCase>>;
  // In Bulk Actions, before the table's own Delete.
  bulkActions: Array<BulkActionButtonSchema<SecurityCase>>;
  // The dialogs these open; drawn by the list beside its table.
  modals: ReactElement;
}

type DialogKind = "assign" | "status" | "priority";

interface OpenDialog {
  kind: DialogKind;
  securityCases: Array<SecurityCase>;
  // Set for Bulk Actions: the run its progress dialog reports.
  bulkActionProps?: BulkActionOnClickProps<SecurityCase> | undefined;
}

/*
 * Whether, and how, a list offers its moves to this reader: shown and
 * usable; shown, locked, saying what it takes; or - while the reader's
 * permissions are not known - not shown. BaseModelTable gates its own
 * Delete the same way.
 */
export interface SecurityCaseActionGate {
  isShown: boolean;
  isLocked: boolean;
  reason?: string | undefined;
}

export function getSecurityCaseActionGate(): SecurityCaseActionGate {
  const gate: PermissionGateResult = PermissionGate.check(
    new SecurityCase(),
    ModelAction.Update,
  );

  if (gate.isAllowed) {
    return { isShown: true, isLocked: false };
  }

  if (gate.disabledReason) {
    return { isShown: true, isLocked: true, reason: gate.disabledReason };
  }

  return { isShown: false, isLocked: true };
}

// A case's id, for its update.
function idOf(securityCase: SecurityCase): ObjectID {
  const id: string = readSecurityCaseId(securityCase._id || securityCase.id);

  if (!id) {
    throw new BadDataException("Security Case ID not found");
  }

  return new ObjectID(id);
}

export default function useSecurityCaseListActions(
  config: SecurityCaseListActionsConfig,
): SecurityCaseListActions {
  const translator: Translator = useTranslator();
  const [dialog, setDialog] = useState<OpenDialog | null>(null);

  const statuses: Array<SecurityCaseStatus> = config.values.statuses;
  const priorities: Array<SecurityCasePriority> = config.values.priorities;
  const gate: SecurityCaseActionGate = getSecurityCaseActionGate();

  const lock: { disabled?: boolean; tooltip?: string } = gate.isLocked
    ? { disabled: true, ...(gate.reason ? { tooltip: gate.reason } : {}) }
    : {};

  const getMyId: () => string = (): string => {
    const myId: string = readSecurityCaseId(User.getUserId());

    if (!myId) {
      throw new BadDataException("You are not signed in.");
    }

    return myId;
  };

  type WriteFunction = (
    securityCase: SecurityCase,
    data: JSONObject,
  ) => Promise<void>;

  const write: WriteFunction = async (
    securityCase: SecurityCase,
    data: JSONObject,
  ): Promise<void> => {
    await ModelAPI.updateById<SecurityCase>({
      modelType: SecurityCase,
      id: idOf(securityCase),
      data: data,
    });
  };

  // Why a case was left alone, in the reader's words.
  type SkipTextFunction = (
    reason: SecurityCaseSkipReason,
    valueName?: string,
  ) => string;

  const skipText: SkipTextFunction = (
    reason: SecurityCaseSkipReason,
    valueName?: string,
  ): string => {
    if (reason === SecurityCaseSkipReason.SameValue) {
      return translator.translateTemplate(SKIP_REASON_TEXT[reason], {
        value: translatableTerm(valueName || ""),
      });
    }

    return (
      translator.translateText(SKIP_REASON_TEXT[reason]) ||
      SKIP_REASON_TEXT[reason]
    );
  };

  type RunBulkFunction = (
    actionProps: BulkActionOnClickProps<SecurityCase>,
    step: (securityCase: SecurityCase) => Promise<BulkItemOutcome>,
  ) => Promise<void>;

  // One case at a time, each as the server sees it; the list read again after.
  const runBulk: RunBulkFunction = async (
    actionProps: BulkActionOnClickProps<SecurityCase>,
    step: (securityCase: SecurityCase) => Promise<BulkItemOutcome>,
  ): Promise<void> => {
    try {
      await runBulkAction<SecurityCase>({
        actionProps: actionProps,
        concurrency: 1,
        step: step,
      });
    } finally {
      config.onChanged();
    }
  };

  type AssignStepFunction = (
    pick: SecurityCaseAssigneePick,
  ) => (securityCase: SecurityCase) => Promise<BulkItemOutcome>;

  const assignStep: AssignStepFunction = (pick: SecurityCaseAssigneePick) => {
    return async (securityCase: SecurityCase): Promise<BulkItemOutcome> => {
      const reason: SecurityCaseSkipReason | null =
        getSecurityCaseAssignSkipReason({
          securityCase: securityCase,
          pick: pick,
          statuses: statuses,
          myUserId: User.getUserId(),
        });

      if (reason) {
        return bulkItemUnchanged(skipText(reason));
      }

      await write(securityCase, getSecurityCaseAssignWrite(pick));

      return BULK_ITEM_CHANGED;
    };
  };

  type StatusStepFunction = (
    pick: SecurityCaseStatusPick,
  ) => (securityCase: SecurityCase) => Promise<BulkItemOutcome>;

  const statusStep: StatusStepFunction = (pick: SecurityCaseStatusPick) => {
    return async (securityCase: SecurityCase): Promise<BulkItemOutcome> => {
      const reason: SecurityCaseSkipReason | null =
        getSecurityCaseStatusSkipReason({
          securityCase: securityCase,
          statusId: pick.statusId,
        });

      if (reason) {
        return bulkItemUnchanged(
          skipText(reason, getSecurityCaseValueName(statuses, pick.statusId)),
        );
      }

      await write(
        securityCase,
        getSecurityCaseStatusWrite({
          securityCase: securityCase,
          pick: pick,
          statuses: statuses,
        }),
      );

      return BULK_ITEM_CHANGED;
    };
  };

  type PriorityStepFunction = (
    priorityId: string,
  ) => (securityCase: SecurityCase) => Promise<BulkItemOutcome>;

  const priorityStep: PriorityStepFunction = (priorityId: string) => {
    return async (securityCase: SecurityCase): Promise<BulkItemOutcome> => {
      const reason: SecurityCaseSkipReason | null =
        getSecurityCasePrioritySkipReason({
          securityCase: securityCase,
          priorityId: priorityId,
        });

      if (reason) {
        return bulkItemUnchanged(
          skipText(reason, getSecurityCaseValueName(priorities, priorityId)),
        );
      }

      await write(securityCase, getSecurityCasePriorityWrite(priorityId));

      return BULK_ITEM_CHANGED;
    };
  };

  type OpenFunction = (
    kind: DialogKind,
    securityCases: Array<SecurityCase>,
    bulkActionProps?: BulkActionOnClickProps<SecurityCase>,
  ) => void;

  const open: OpenFunction = (
    kind: DialogKind,
    securityCases: Array<SecurityCase>,
    bulkActionProps?: BulkActionOnClickProps<SecurityCase>,
  ): void => {
    setDialog({
      kind: kind,
      securityCases: securityCases,
      bulkActionProps: bulkActionProps,
    });
  };

  const close: VoidFunction = (): void => {
    setDialog(null);
  };

  /*
   * A dialog's submit: for one row, the change is saved with the dialog
   * open (it says why if it cannot be), then the list is read again; for
   * Bulk Actions, the dialog gives way to the progress of the run.
   */
  type SubmitFunction = (
    step: (securityCase: SecurityCase) => Promise<BulkItemOutcome>,
  ) => Promise<void>;

  const submit: SubmitFunction = async (
    step: (securityCase: SecurityCase) => Promise<BulkItemOutcome>,
  ): Promise<void> => {
    if (!dialog) {
      return;
    }

    if (dialog.bulkActionProps) {
      const actionProps: BulkActionOnClickProps<SecurityCase> =
        dialog.bulkActionProps;

      close();
      await runBulk(actionProps, step);
      return;
    }

    const securityCase: SecurityCase | undefined = dialog.securityCases[0];

    if (securityCase) {
      // A case the pick leaves as it is closes the dialog without a write.
      await step(securityCase);
    }

    close();
    config.onChanged();
  };

  const rowAction: (
    title: string,
    icon: ActionButtonSchema<SecurityCase>["icon"],
  ) => Pick<
    ActionButtonSchema<SecurityCase>,
    "title" | "icon" | "buttonStyleType" | "placement"
  > = (title: string, icon: ActionButtonSchema<SecurityCase>["icon"]) => {
    return {
      title: title,
      icon: icon,
      buttonStyleType: ButtonStyleType.OUTLINE,
      // In the ⋯ menu: the row's one button stays View.
      placement: ActionButtonPlacement.MoreMenu,
    };
  };

  const rowActions: Array<ActionButtonSchema<SecurityCase>> = !gate.isShown
    ? []
    : [
        {
          ...rowAction(ASSIGN_TO_ME, SECURITY_CASE_CHANGE_ICONS.assignToMe),
          isVisible: (securityCase: SecurityCase): boolean => {
            return isAssignToMeOffered({
              securityCase: securityCase,
              statuses: statuses,
              myUserId: User.getUserId(),
            });
          },
          ...lock,
          onClick: async (
            securityCase: SecurityCase,
            onCompleteAction: VoidFunction,
            onError: ErrorFunction,
          ): Promise<void> => {
            try {
              await write(
                securityCase,
                getSecurityCaseAssignWrite({ userId: getMyId() }),
              );
              onCompleteAction();
              config.onChanged();
            } catch (err) {
              onError(new Error(API.getFriendlyMessage(err)));
            }
          },
        },
        {
          ...rowAction(
            ASSIGN_TO_SOMEONE_ELSE,
            SECURITY_CASE_CHANGE_ICONS.assignToSomeoneElse,
          ),
          isVisible: (securityCase: SecurityCase): boolean => {
            return isAssignToSomeoneElseOffered({
              securityCase: securityCase,
              statuses: statuses,
            });
          },
          ...lock,
          onClick: (
            securityCase: SecurityCase,
            onCompleteAction: VoidFunction,
          ): void => {
            open("assign", [securityCase]);
            onCompleteAction();
          },
        },
        {
          ...rowAction(CHANGE_STATUS, SECURITY_CASE_CHANGE_ICONS.changeStatus),
          ...lock,
          onClick: (
            securityCase: SecurityCase,
            onCompleteAction: VoidFunction,
          ): void => {
            open("status", [securityCase]);
            onCompleteAction();
          },
        },
        {
          ...rowAction(
            CHANGE_PRIORITY,
            SECURITY_CASE_CHANGE_ICONS.changePriority,
          ),
          ...lock,
          onClick: (
            securityCase: SecurityCase,
            onCompleteAction: VoidFunction,
          ): void => {
            open("priority", [securityCase]);
            onCompleteAction();
          },
        },
      ];

  const bulkAction: (
    title: string,
    icon: BulkActionButtonSchema<SecurityCase>["icon"],
    resultLabels: BulkActionButtonSchema<SecurityCase>["resultLabels"],
    onClick: (
      actionProps: BulkActionOnClickProps<SecurityCase>,
    ) => Promise<void>,
  ) => BulkActionButtonSchema<SecurityCase> = (
    title: string,
    icon: BulkActionButtonSchema<SecurityCase>["icon"],
    resultLabels: BulkActionButtonSchema<SecurityCase>["resultLabels"],
    onClick: (
      actionProps: BulkActionOnClickProps<SecurityCase>,
    ) => Promise<void>,
  ): BulkActionButtonSchema<SecurityCase> => {
    return {
      title: title,
      icon: icon,
      buttonStyleType: ButtonStyleType.NORMAL,
      resultLabels: resultLabels,
      ...lock,
      onClick: onClick,
    };
  };

  const bulkActions: Array<BulkActionButtonSchema<SecurityCase>> = !gate.isShown
    ? []
    : [
        ...(config.canAssignToMeInBulk
          ? [
              bulkAction(
                ASSIGN_TO_ME,
                SECURITY_CASE_CHANGE_ICONS.assignToMe,
                ASSIGNED_TO_YOU_RESULT_LABELS,
                async (
                  actionProps: BulkActionOnClickProps<SecurityCase>,
                ): Promise<void> => {
                  await runBulk(actionProps, assignStep({ userId: getMyId() }));
                },
              ),
            ]
          : []),
        ...(config.canAssignToSomeoneElseInBulk
          ? [
              bulkAction(
                ASSIGN_TO_SOMEONE_ELSE,
                SECURITY_CASE_CHANGE_ICONS.assignToSomeoneElse,
                ASSIGNED_RESULT_LABELS,
                async (
                  actionProps: BulkActionOnClickProps<SecurityCase>,
                ): Promise<void> => {
                  open("assign", actionProps.items, actionProps);
                },
              ),
            ]
          : []),
        bulkAction(
          CHANGE_STATUS,
          SECURITY_CASE_CHANGE_ICONS.changeStatus,
          UPDATED_RESULT_LABELS,
          async (
            actionProps: BulkActionOnClickProps<SecurityCase>,
          ): Promise<void> => {
            open("status", actionProps.items, actionProps);
          },
        ),
        bulkAction(
          CHANGE_PRIORITY,
          SECURITY_CASE_CHANGE_ICONS.changePriority,
          UPDATED_RESULT_LABELS,
          async (
            actionProps: BulkActionOnClickProps<SecurityCase>,
          ): Promise<void> => {
            open("priority", actionProps.items, actionProps);
          },
        ),
      ];

  let modals: ReactElement = <></>;

  if (dialog?.kind === "assign") {
    modals = (
      <AssignSecurityCaseModal
        securityCases={dialog.securityCases}
        onClose={close}
        onSubmit={async (pick: SecurityCaseAssigneePick): Promise<void> => {
          await submit(assignStep(pick));
        }}
      />
    );
  } else if (dialog?.kind === "status") {
    modals = (
      <ChangeSecurityCaseStatusModal
        securityCases={dialog.securityCases}
        values={config.values}
        onClose={close}
        onSubmit={async (pick: SecurityCaseStatusPick): Promise<void> => {
          await submit(statusStep(pick));
        }}
      />
    );
  } else if (dialog?.kind === "priority") {
    modals = (
      <ChangeSecurityCasePriorityModal
        securityCases={dialog.securityCases}
        values={config.values}
        onClose={close}
        onSubmit={async (priorityId: string): Promise<void> => {
          await submit(priorityStep(priorityId));
        }}
      />
    );
  }

  return {
    rowActions: rowActions,
    bulkActions: bulkActions,
    modals: modals,
  };
}

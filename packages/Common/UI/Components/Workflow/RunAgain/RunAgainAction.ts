/*
 * Run again in a run list's row: in the ⋯ menu, on the rows that can be, asking
 * first (the row draws the dialog, and says a refusal in it).
 */

import ActionButtonSchema, {
  ActionButtonPlacement,
  RowActionContext,
} from "../../ActionButton/ActionButtonSchema";
import { ButtonStyleType } from "../../Button/Button";
import API from "../../../Utils/API/API";
import { ErrorFunction, VoidFunction } from "../../../../Types/FunctionTypes";
import IconProp from "../../../../Types/Icon/IconProp";
import WorkflowLog from "../../../../Models/DatabaseModels/WorkflowLog";
import { getLockedReason, getWorkflowRunGate } from "../WorkflowRunGate";
import { RunAgainCopy } from "./RunAgainButton";
import { sendRunAgain } from "./RunAgainSource";

export type GetWorkflowRunAgainActionFunction = (data: {
  // The new run has started: the page opens it, to follow it.
  onStarted: (run: WorkflowLog) => void;
}) => ActionButtonSchema<WorkflowLog>;

/**
 * "Run again", for a run list's rows. The list must select the row's
 * canRunAgain, and call this on every render: the permission snapshot may land
 * after the first paint.
 */
export const getWorkflowRunAgainAction: GetWorkflowRunAgainActionFunction =
  (data: {
    onStarted: (run: WorkflowLog) => void;
  }): ActionButtonSchema<WorkflowLog> => {
    const lockedReason: string | undefined =
      getLockedReason(getWorkflowRunGate());

    return {
      title: RunAgainCopy.runAgain,
      icon: IconProp.Refresh,
      buttonStyleType: ButtonStyleType.NORMAL,
      // Opening the run is what a row is for: View Logs keeps the row's button.
      placement: ActionButtonPlacement.MoreMenu,
      isVisible: (run: WorkflowLog): boolean => {
        return run.canRunAgain === true;
      },
      disabled: Boolean(lockedReason),
      tooltip: lockedReason,
      getConfirmation: () => {
        return {
          title: RunAgainCopy.confirmTitle,
          description: RunAgainCopy.confirmDescription,
          submitButtonText: RunAgainCopy.runAgain,
        };
      },
      onClick: async (
        run: WorkflowLog,
        onCompleteAction: VoidFunction,
        onError: ErrorFunction,
        context?: RowActionContext | undefined,
      ): Promise<void> => {
        try {
          await sendRunAgain(String(run._id));
        } catch (err) {
          onError(new Error(API.getFriendlyMessage(err)));
          return;
        }

        onCompleteAction();
        context?.refresh();
        data.onStarted(run);
      },
    };
  };

import RowActionsStore, {
  RowActionDialog,
  RowActionDialogKind,
  RowActionError,
  RowActionQuestion,
} from "./RowActionsStore";
import ConfirmModal from "../Modal/ConfirmModal";
import GenericObject from "../../../Types/GenericObject";
import useTranslateValue from "../../Utils/Translation";
import React, {
  ReactElement,
  useCallback,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { createPortal } from "react-dom";

/*
 * THE DIALOGS A ROW'S ACTIONS OPEN: an action's question, and an action's
 * error. Drawn by whatever keeps them (RowActionsStore): a table, outside
 * its rows, so that a change of how it fits - which draws every row again -
 * leaves them open, a question still busy with its answer or showing in
 * place why the action could not be done; a row's actions drawn outside a
 * table draw their own.
 */

/*
 * Where a row's dialogs - an action's question, an error - are drawn: in
 * the page's body (or the element shown full screen, which hides everything
 * outside it), never inside the row. Drawn in the row, a dialog sat inside
 * the table's sticky Actions cell: its sentences took the cell's no-wrap and
 * ran off its right edge, the other rows' Actions cells were drawn over its
 * backdrop and could still be pressed, and a click on its text reached the
 * row, which opened the record and took the dialog away. The row's click
 * (RowClick) leaves alone a click that lands outside it, as it does for the
 * ⋯ menu, which is drawn in the body too.
 */
export const getRowDialogTarget: () => HTMLElement | null =
  (): HTMLElement | null => {
    if (typeof document === "undefined") {
      return null;
    }

    const fullscreenElement: Element | null = document.fullscreenElement;

    return fullscreenElement instanceof HTMLElement
      ? fullscreenElement
      : document.body;
  };

const drawRowDialog: (dialog: ReactElement) => ReactElement = (
  dialog: ReactElement,
): ReactElement => {
  const target: HTMLElement | null = getRowDialogTarget();

  return target ? createPortal(dialog, target) : dialog;
};

/*
 * A dialog closed: once the page has settled, the focus goes back to what
 * opened it - the row's button, or its ⋯ - in the row as the table draws it
 * now, when it fell to the page's body. The dialog gives it back itself to
 * the element it was opened from (Modal), but a change of fit took that
 * element away with its row, and the next Tab started again at the top of
 * the page. A row that is gone, its action done, leaves the focus be.
 */
const closeAndGiveFocusBack: <T extends GenericObject>(
  store: RowActionsStore<T>,
  dialog: RowActionDialog<T>,
) => void = <T extends GenericObject>(
  store: RowActionsStore<T>,
  dialog: RowActionDialog<T>,
): void => {
  store.closeDialog(dialog.id);

  if (typeof window === "undefined") {
    return;
  }

  window.requestAnimationFrame((): void => {
    const activeElement: Element | null = document.activeElement;

    if (!activeElement || activeElement === document.body) {
      store.focusOpener(dialog.rowKey, dialog.openedFrom);
    }
  });
};

interface QuestionProps<T extends GenericObject> {
  store: RowActionsStore<T>;
  question: RowActionQuestion<T>;
}

/*
 * An action's question. Answered, it runs the action on the row it names,
 * and stays open, its button busy, until the action is done - or says in
 * place why it could not be, for another try.
 */
const RowActionQuestionDialog: <T extends GenericObject>(
  props: QuestionProps<T>,
) => ReactElement = <T extends GenericObject>(
  props: QuestionProps<T>,
): ReactElement => {
  const { translateString } = useTranslateValue();
  const { store, question } = props;

  const [isRunning, setIsRunning] = useState<boolean>(false);
  const [error, setError] = useState<string>("");

  /*
   * Whether the action is running, as a second press reads it: before the
   * busy button is drawn, two presses in a row would run it twice.
   */
  const isRunningRef: React.MutableRefObject<boolean> = useRef<boolean>(false);

  const run: () => void = (): void => {
    if (isRunningRef.current) {
      return;
    }

    const { button, index } = question.action;
    const loadingActionIndexes: Array<boolean> = store.getLoadingActionIndexes(
      question.rowKey,
    );

    isRunningRef.current = true;
    loadingActionIndexes[index] = true;
    setError("");
    setIsRunning(true);

    button.onClick(
      question.item,
      () => {
        isRunningRef.current = false;
        loadingActionIndexes[index] = false;
        setIsRunning(false);
        closeAndGiveFocusBack(store, question);
      },
      (err: Error) => {
        isRunningRef.current = false;
        loadingActionIndexes[index] = false;
        setIsRunning(false);
        setError(
          (err as Error).message ||
            translateString("Something went wrong. Please try again.") ||
            "Something went wrong. Please try again.",
        );
      },
    );
  };

  return drawRowDialog(
    <div className="text-align-left" data-testid="row-actions-dialog">
      <ConfirmModal
        title={question.confirmation.title}
        description={question.confirmation.description}
        submitButtonText={question.confirmation.submitButtonText}
        submitButtonType={question.confirmation.submitButtonType}
        isLoading={isRunning}
        error={error || undefined}
        onClose={() => {
          // An action already running finishes either way.
          if (isRunningRef.current) {
            return;
          }

          closeAndGiveFocusBack(store, question);
        }}
        onSubmit={run}
      >
        {question.confirmation.details}
      </ConfirmModal>
    </div>,
  );
};

interface ErrorProps<T extends GenericObject> {
  store: RowActionsStore<T>;
  error: RowActionError;
}

// What an action that ran at once said when it failed.
const RowActionErrorDialog: <T extends GenericObject>(
  props: ErrorProps<T>,
) => ReactElement = <T extends GenericObject>(
  props: ErrorProps<T>,
): ReactElement => {
  return drawRowDialog(
    <div className="text-align-left" data-testid="row-actions-dialog">
      <ConfirmModal
        title={`Error`}
        description={props.error.message}
        submitButtonText={"Close"}
        onSubmit={() => {
          closeAndGiveFocusBack(props.store, props.error);
        }}
      />
    </div>,
  );
};

export interface ComponentProps<T extends GenericObject> {
  store: RowActionsStore<T>;
}

// Every dialog the store holds open, each drawn over the page.
const RowActionDialogs: <T extends GenericObject>(
  props: ComponentProps<T>,
) => ReactElement = <T extends GenericObject>(
  props: ComponentProps<T>,
): ReactElement => {
  const { store } = props;

  const subscribe: (listener: () => void) => () => void = useCallback(
    (listener: () => void): (() => void) => {
      return store.subscribe(listener);
    },
    [store],
  );

  const getSnapshot: () => ReadonlyArray<RowActionDialog<T>> =
    useCallback((): ReadonlyArray<RowActionDialog<T>> => {
      return store.getDialogs();
    }, [store]);

  const dialogs: ReadonlyArray<RowActionDialog<T>> = useSyncExternalStore(
    subscribe,
    getSnapshot,
    getSnapshot,
  );

  return (
    <>
      {dialogs.map((dialog: RowActionDialog<T>): ReactElement => {
        return dialog.kind === RowActionDialogKind.Question ? (
          <RowActionQuestionDialog<T>
            key={dialog.id}
            store={store}
            question={dialog}
          />
        ) : (
          <RowActionErrorDialog<T>
            key={dialog.id}
            store={store}
            error={dialog}
          />
        );
      })}
    </>
  );
};

export default RowActionDialogs;

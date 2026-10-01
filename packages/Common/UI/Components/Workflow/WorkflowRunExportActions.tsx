/*
 * Copy log and Download, in the header of a workflow run's modal.
 *
 * Copy log puts the Full Log tab's text on the clipboard, for pasting into a
 * chat or a ticket. Download offers the two files a run can be saved as: the
 * log, as plain text, and the whole run - each step's inputs and outputs too -
 * as JSON. Both work from either tab, and from a run that is still going,
 * which then saves what it has logged so far.
 *
 * They are drawn like the step dialog's "How to use", the other control a
 * workflow dialog keeps in its header: quiet, label beside the icon, and only
 * the icon on a phone, where the header has no room for words (the label
 * stays for screen readers). Neither is the thing the modal is for - it only
 * shows a run, and its one way out is Close - so neither looks like an action
 * button.
 */

import Icon from "../Icon/Icon";
import MoreMenu from "../MoreMenu/MoreMenu";
import MoreMenuItem from "../MoreMenu/MoreMenuItem";
import Clipboard from "../../Utils/Clipboard";
import useTranslateValue from "../../Utils/Translation";
import {
  WorkflowRunExportText,
  downloadWorkflowRun,
} from "./DownloadWorkflowRun";
import {
  WorkflowRunExport,
  WorkflowRunExportFormat,
} from "./WorkflowRunExport";
import IconProp from "../../../Types/Icon/IconProp";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useRef,
  useState,
} from "react";

export interface ComponentProps {
  run: WorkflowRunExport;
}

// How long "Copied!" or "Copy failed" stays on the button.
export const COPY_FEEDBACK_DURATION_MS: number = 2000;

enum CopyState {
  Idle = "Idle",
  Copied = "Copied",
  Failed = "Failed",
}

// Drawn like the step dialog's header button (ComponentSettingsModal).
const BUTTON_CLASS_NAME: string =
  "inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-sm font-medium text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500";

// The words beside an icon, which a phone leaves to screen readers.
const LABEL_CLASS_NAME: string = "max-sm:sr-only";

const WorkflowRunExportActions: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const { translateString } = useTranslateValue();

  const translate: (text: string) => string = (text: string): string => {
    return translateString(text) || text;
  };

  const [copyState, setCopyState] = useState<CopyState>(CopyState.Idle);
  const [downloadError, setDownloadError] = useState<string | null>(null);

  const copyFeedbackTimer: React.MutableRefObject<ReturnType<
    typeof setTimeout
  > | null> = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (copyFeedbackTimer.current) {
        clearTimeout(copyFeedbackTimer.current);
      }
    };
  }, []);

  type ShowCopyStateFunction = (state: CopyState) => void;

  const showCopyState: ShowCopyStateFunction = (state: CopyState): void => {
    if (copyFeedbackTimer.current) {
      clearTimeout(copyFeedbackTimer.current);
    }

    setCopyState(state);

    copyFeedbackTimer.current = setTimeout(() => {
      copyFeedbackTimer.current = null;
      setCopyState(CopyState.Idle);
    }, COPY_FEEDBACK_DURATION_MS);
  };

  const copyLog: () => Promise<void> = async (): Promise<void> => {
    // A refused or missing clipboard resolves false: "Copied!" would lie.
    const hasCopied: boolean = await Clipboard.copyToClipboard(props.run.logs);

    showCopyState(hasCopied ? CopyState.Copied : CopyState.Failed);
  };

  type DownloadFunction = (format: WorkflowRunExportFormat) => void;

  const download: DownloadFunction = (
    format: WorkflowRunExportFormat,
  ): void => {
    setDownloadError(null);

    try {
      downloadWorkflowRun(props.run, format);
    } catch {
      setDownloadError(translate(WorkflowRunExportText.downloadFailed));
    }
  };

  const hasLog: boolean = props.run.logs.length > 0;

  const copyLabel: string =
    copyState === CopyState.Copied
      ? WorkflowRunExportText.copied
      : copyState === CopyState.Failed
        ? WorkflowRunExportText.copyFailed
        : WorkflowRunExportText.copyLog;

  const copyIcon: IconProp =
    copyState === CopyState.Copied
      ? IconProp.Check
      : copyState === CopyState.Failed
        ? IconProp.Alert
        : IconProp.Copy;

  const copyIconClassName: string =
    copyState === CopyState.Copied
      ? "h-4 w-4 text-emerald-600"
      : copyState === CopyState.Failed
        ? "h-4 w-4 text-red-600"
        : "h-4 w-4";

  /*
   * Said once, to a screen reader, when a copy lands or fails: a changed
   * button label is not reliably announced while the button has focus.
   */
  const copyAnnouncement: string =
    copyState === CopyState.Copied
      ? translate(WorkflowRunExportText.copied)
      : copyState === CopyState.Failed
        ? translate(WorkflowRunExportText.copyFailedMessage)
        : "";

  return (
    <div
      className="flex flex-col items-end gap-1"
      data-testid="workflow-run-export-actions"
    >
      <div className="flex items-center gap-1">
        {/*
         * Copy only when there is a log to copy. A run that recorded steps
         * but printed nothing still has its steps to download.
         */}
        {hasLog ? (
          <button
            type="button"
            className={BUTTON_CLASS_NAME}
            data-testid="workflow-run-copy-log"
            onClick={() => {
              void copyLog();
            }}
          >
            <Icon icon={copyIcon} className={copyIconClassName} />
            <span className={LABEL_CLASS_NAME}>{translate(copyLabel)}</span>
          </button>
        ) : (
          <></>
        )}

        {/*
         * Portalled: drawn inside the dialog, the menu would be cut off by its
         * scrolling body under a short Steps tab. MoreMenu keeps the keyboard,
         * and a click that only closes the menu, from reaching the modal.
         */}
        <MoreMenu
          text={translate(WorkflowRunExportText.download)}
          isMenuPortaled={true}
          elementToBeShownInsteadOfButton={
            <button
              type="button"
              className={BUTTON_CLASS_NAME}
              data-testid="workflow-run-download"
            >
              <Icon icon={IconProp.Download} className="h-4 w-4" />
              <span className={LABEL_CLASS_NAME}>
                {translate(WorkflowRunExportText.download)}
              </span>
              <Icon icon={IconProp.ChevronDown} className="h-3.5 w-3.5" />
            </button>
          }
        >
          {[
            <MoreMenuItem
              key="log"
              text={translate(WorkflowRunExportText.downloadLog)}
              icon={IconProp.TextFile}
              onClick={() => {
                download(WorkflowRunExportFormat.Log);
              }}
            />,
            <MoreMenuItem
              key="json"
              text={translate(WorkflowRunExportText.downloadJson)}
              icon={IconProp.Code}
              onClick={() => {
                download(WorkflowRunExportFormat.JSON);
              }}
            />,
          ]}
        </MoreMenu>
      </div>

      <span className="sr-only" role="status" aria-live="polite">
        {copyAnnouncement}
      </span>

      {downloadError ? (
        <p
          className="max-w-[14rem] text-right text-xs text-red-600"
          role="alert"
          data-testid="workflow-run-download-error"
        >
          {downloadError}
        </p>
      ) : (
        <></>
      )}
    </div>
  );
};

export default WorkflowRunExportActions;

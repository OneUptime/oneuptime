/*
 * Saving a workflow run as a file, from the run's modal and from a row of the
 * run lists.
 *
 * The file is built in the browser from the run the page already read
 * (WorkflowRunExport), so there is no download endpoint to secure and no
 * second copy of the permission rules: whoever can read a run in the list
 * can save that run, and nobody else ever gets it on screen to save. A long
 * log costs nothing extra either - it is handed to the browser as one Blob,
 * not drawn.
 */

import ActionButtonSchema, {
  ActionButtonPlacement,
} from "../ActionButton/ActionButtonSchema";
import { ButtonStyleType } from "../Button/Button";
import downloadFile from "../../Utils/DownloadFile";
import {
  WorkflowRunExport,
  WorkflowRunExportFile,
  WorkflowRunExportFormat,
  getWorkflowRunExportFile,
  getWorkflowRunExportFromWorkflowLog,
} from "./WorkflowRunExport";
import { ErrorFunction, VoidFunction } from "../../../Types/FunctionTypes";
import IconProp from "../../../Types/Icon/IconProp";
import WorkflowLog from "../../../Models/DatabaseModels/WorkflowLog";

/*
 * Every word the run's copy and download controls show, in English. The
 * dashboard looks each one up whole in its locale files, and
 * WorkflowRunExportI18n.test.ts holds all seventeen of them to having it.
 */
export const WorkflowRunExportText: {
  readonly copyLog: string;
  readonly copied: string;
  readonly copyFailed: string;
  readonly copyFailedMessage: string;
  readonly download: string;
  readonly downloadLog: string;
  readonly downloadJson: string;
  readonly downloadFailed: string;
} = {
  copyLog: "Copy log",
  copied: "Copied!",
  copyFailed: "Copy failed",
  copyFailedMessage: "The log could not be copied. Download it instead.",
  download: "Download",
  downloadLog: "Download log",
  downloadJson: "Download run as JSON",
  downloadFailed: "This run could not be downloaded. Try again.",
};

export type DownloadWorkflowRunFunction = (
  run: WorkflowRunExport,
  format: WorkflowRunExportFormat,
) => WorkflowRunExportFile;

/**
 * Save a run as a file: the log as text, or the whole run as JSON. Returns
 * what was saved. Throws when the browser refuses the download, for the
 * caller to say so.
 */
export const downloadWorkflowRun: DownloadWorkflowRunFunction = (
  run: WorkflowRunExport,
  format: WorkflowRunExportFormat,
): WorkflowRunExportFile => {
  const file: WorkflowRunExportFile = getWorkflowRunExportFile(run, format);

  downloadFile({
    content: file.content,
    filename: file.fileName,
    mimeType: file.mimeType,
  });

  return file;
};

type GetDownloadActionFunction = (
  title: string,
  icon: IconProp,
  format: WorkflowRunExportFormat,
) => ActionButtonSchema<WorkflowLog>;

const getDownloadAction: GetDownloadActionFunction = (
  title: string,
  icon: IconProp,
  format: WorkflowRunExportFormat,
): ActionButtonSchema<WorkflowLog> => {
  return {
    title: title,
    icon: icon,
    buttonStyleType: ButtonStyleType.NORMAL,
    /*
     * Opening the run is what a row is for, so View Logs keeps the row's one
     * button and the downloads wait in its ⋯ menu.
     */
    placement: ActionButtonPlacement.MoreMenu,
    onClick: (
      item: WorkflowLog,
      onCompleteAction: VoidFunction,
      onError: ErrorFunction,
    ): void => {
      try {
        downloadWorkflowRun(getWorkflowRunExportFromWorkflowLog(item), format);
        onCompleteAction();
      } catch {
        onError(new Error(WorkflowRunExportText.downloadFailed));
      }
    },
  };
};

export type GetWorkflowRunDownloadActionsFunction = () => Array<
  ActionButtonSchema<WorkflowLog>
>;

/**
 * "Download log" and "Download run as JSON", for a run list's rows. The list
 * must select the row's logs and stepTrace, and its workflow's name, which is
 * what the downloads are written from and named after.
 */
export const getWorkflowRunDownloadActions: GetWorkflowRunDownloadActionsFunction =
  (): Array<ActionButtonSchema<WorkflowLog>> => {
    return [
      getDownloadAction(
        WorkflowRunExportText.downloadLog,
        IconProp.TextFile,
        WorkflowRunExportFormat.Log,
      ),
      getDownloadAction(
        WorkflowRunExportText.downloadJson,
        IconProp.Code,
        WorkflowRunExportFormat.JSON,
      ),
    ];
  };

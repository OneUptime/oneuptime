import React, { FunctionComponent, ReactElement } from "react";
import IsolatedText from "Common/UI/Components/IsolatedText/IsolatedText";
import TableEmptyValue from "Common/UI/Components/Table/TableEmptyValue";
import WorkspaceNotificationStatus from "Common/Types/Workspace/WorkspaceNotificationStatus";
import WorkspaceType from "Common/Types/Workspace/WorkspaceType";
import WorkspaceRefusal, {
  WorkspaceRefusalReading,
} from "Common/Utils/Workspace/WorkspaceRefusal";

/*
 * WHY A SLACK, MICROSOFT TEAMS OR MATTERMOST POST FAILED, IN ITS ROW (#7121).
 *
 * The Workspace Logs table said only Error, and the reason was under the
 * row's ⋯ > View Status Message, one row at a time: a page of Error rows
 * could not be read for which were the same problem. The Reason column
 * shows it in the row: the workspace's refusal in OneUptime's words
 * (WorkspaceRefusal), two lines at most, the whole of it - with what the
 * workspace answered, for support - under the pointer and in View Status
 * Message. A row written before the refusals were worded ("Error from
 * Slack is_archived") reads as a new one does.
 *
 * A row that went out has no reason: the quiet dash, which a phone's card
 * leaves out. The reason is the server's English, as the other workspace
 * reasons are, so it reads its own way on a right-to-left page
 * (IsolatedText).
 */

// Two lines at most, broken between words, in a cell that keeps its values on one line.
export const WORKSPACE_LOG_REASON_CLASS_NAME: string =
  "line-clamp-2 whitespace-normal text-sm leading-5 text-gray-900 [overflow-wrap:anywhere]";

export const WORKSPACE_LOG_REASON_TEST_ID: string = "workspace-log-reason";

export interface WorkspaceLogReasonRow {
  status?: WorkspaceNotificationStatus | string | undefined;
  statusMessage?: string | undefined;
  workspaceType?: WorkspaceType | undefined;
}

/*
 * The reason of a row that failed: OneUptime's words, and the workspace's
 * answer apart. Null for a row that went out, or a failure with no words.
 */
export const getWorkspaceLogReason: (
  row: WorkspaceLogReasonRow,
) => WorkspaceRefusalReading | null = (
  row: WorkspaceLogReasonRow,
): WorkspaceRefusalReading | null => {
  if (row.status !== WorkspaceNotificationStatus.Error) {
    return null;
  }

  const reading: WorkspaceRefusalReading = WorkspaceRefusal.read({
    message: row.statusMessage,
    workspaceType: row.workspaceType,
  });

  return reading.reason ? reading : null;
};

/*
 * The whole of a row's status message as a person reads it: a failure's
 * reason with what the workspace answered after it - an old row's raw
 * code said in words too - or a row's message as it was written.
 */
export const getWorkspaceLogStatusText: (
  row: WorkspaceLogReasonRow,
) => string = (row: WorkspaceLogReasonRow): string => {
  const reading: WorkspaceRefusalReading | null = getWorkspaceLogReason(row);

  if (!reading) {
    return row.statusMessage || "";
  }

  return WorkspaceRefusal.toText({
    reading: reading,
    workspaceType: row.workspaceType,
  });
};

const WorkspaceLogReason: FunctionComponent<WorkspaceLogReasonRow> = (
  props: WorkspaceLogReasonRow,
): ReactElement => {
  const row: WorkspaceLogReasonRow = {
    status: props.status,
    statusMessage: props.statusMessage,
    workspaceType: props.workspaceType,
  };

  const reading: WorkspaceRefusalReading | null = getWorkspaceLogReason(row);

  if (!reading) {
    return <TableEmptyValue />;
  }

  return (
    <IsolatedText
      className={WORKSPACE_LOG_REASON_CLASS_NAME}
      text={reading.reason}
      title={getWorkspaceLogStatusText(row)}
      dataTestId={WORKSPACE_LOG_REASON_TEST_ID}
    />
  );
};

export default WorkspaceLogReason;

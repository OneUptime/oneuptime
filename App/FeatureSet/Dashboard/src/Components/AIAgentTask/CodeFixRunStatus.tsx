import React, { FunctionComponent, ReactElement } from "react";
import AIRunStatus from "Common/Types/AI/AIRunStatus";
import CodeFixTaskType from "Common/Types/AI/CodeFixTaskType";
import Color from "Common/Types/Color";
import {
  Blue,
  Yellow,
  Green,
  Red,
  Amber500,
  Gray500,
} from "Common/Types/BrandColors";
import Pill from "Common/UI/Components/Pill/Pill";

/*
 * Shared status presentation for code-fix AIRuns (the rows behind the AI
 * Agent Tasks pages). Wording mirrors the server's CODE_FIX_STATUS_TEXT in
 * TelemetryExceptionAPI so the exception page and the tasks pages agree.
 */

export interface CodeFixRunStatusText {
  title: string;
  description: string;
}

/*
 * Human labels for the task-type discriminator on code-fix runs
 * (`codeFixTaskType` on the /code-fix-run/list and /get responses — the
 * server normalizes missing values to FixException, so it is never null on
 * the wire).
 */
const TASK_TYPE_LABEL: { [key in CodeFixTaskType]: string } = {
  [CodeFixTaskType.FixException]: "Fix Exception",
  [CodeFixTaskType.WriteRegressionTest]: "Regression Test",
  [CodeFixTaskType.ImproveInstrumentation]: "Improve Instrumentation",
  [CodeFixTaskType.FixPerformance]: "Fix Performance",
  [CodeFixTaskType.FixFromIncident]: "Fix from Incident",
};

export function getCodeFixTaskTypeLabel(taskType: string | undefined): string {
  if (!taskType) {
    // Older servers omit the field — every run they know about is a fix.
    return TASK_TYPE_LABEL[CodeFixTaskType.FixException];
  }

  // Unknown (newer) task types fall back to the raw discriminator string.
  return TASK_TYPE_LABEL[taskType as CodeFixTaskType] || taskType;
}

const STATUS_TEXT: { [key in AIRunStatus]: CodeFixRunStatusText } = {
  [AIRunStatus.Queued]: {
    title: "Queued",
    description:
      "The fix task is queued and waiting to be picked up by an AI agent.",
  },
  [AIRunStatus.Running]: {
    title: "In Progress",
    description: "An AI agent is working on a fix for this exception.",
  },
  [AIRunStatus.WaitingForApproval]: {
    title: "Waiting for Approval",
    description: "The run is paused waiting for an approval.",
  },
  [AIRunStatus.Completed]: {
    title: "Completed",
    description:
      "The AI agent finished. Review the pull request it opened for the proposed fix.",
  },
  [AIRunStatus.Error]: {
    title: "Error",
    description: "The AI agent could not complete the fix.",
  },
  [AIRunStatus.Cancelled]: {
    title: "Cancelled",
    description: "The fix task was cancelled before an agent completed it.",
  },
  [AIRunStatus.Stale]: {
    title: "Stale",
    description:
      "The AI agent stopped reporting progress and the run was marked as stale. You can retry the fix.",
  },
};

const STATUS_COLOR: { [key in AIRunStatus]: Color } = {
  [AIRunStatus.Queued]: Blue,
  [AIRunStatus.Running]: Yellow,
  [AIRunStatus.WaitingForApproval]: Amber500,
  [AIRunStatus.Completed]: Green,
  [AIRunStatus.Error]: Red,
  [AIRunStatus.Cancelled]: Gray500,
  [AIRunStatus.Stale]: Red,
};

export function getCodeFixRunStatusText(
  status: AIRunStatus | undefined,
): CodeFixRunStatusText {
  if (status && STATUS_TEXT[status]) {
    return STATUS_TEXT[status];
  }

  return {
    title: status || "Unknown",
    description: "",
  };
}

export interface ComponentProps {
  status: AIRunStatus | undefined;
}

const CodeFixRunStatusPill: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const color: Color =
    (props.status ? STATUS_COLOR[props.status] : undefined) || Gray500;

  return (
    <Pill text={getCodeFixRunStatusText(props.status).title} color={color} />
  );
};

export default CodeFixRunStatusPill;

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
import { DropdownOption } from "Common/UI/Components/Dropdown/Dropdown";

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
 * Human labels for the task-type discriminator on code-fix runs. A null
 * `codeFixTaskType` means FixException — rows predating task recipes — so it
 * is treated as such below. The backfill migration writes the value
 * explicitly, and /code-fix-run/get still normalizes it on the wire, but the
 * standard CRUD the list reads returns the column verbatim.
 */
const TASK_TYPE_LABEL: { [key in CodeFixTaskType]: string } = {
  [CodeFixTaskType.FixException]: "Fix Exception",
  [CodeFixTaskType.WriteRegressionTest]: "Regression Test",
  [CodeFixTaskType.ImproveExceptionHandling]: "Improve Error Handling",
  [CodeFixTaskType.ImproveInstrumentation]: "Improve Instrumentation",
  [CodeFixTaskType.ImproveLogging]: "Improve Logging",
  [CodeFixTaskType.ImproveTracing]: "Improve Tracing",
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
    description: "The fix task is queued and waiting to be picked up by AI.",
  },
  [AIRunStatus.Running]: {
    title: "In Progress",
    description: "AI is working on a fix for this exception.",
  },
  [AIRunStatus.WaitingForApproval]: {
    title: "Waiting for Approval",
    description: "The run is paused waiting for an approval.",
  },
  [AIRunStatus.Completed]: {
    title: "Completed",
    description:
      "AI finished. Review the pull request it opened for the proposed fix.",
  },
  [AIRunStatus.NoFixFound]: {
    title: "No Fix Found",
    description:
      "AI reviewed the code and did not find a fix to propose, so it opened no pull request.",
  },
  [AIRunStatus.Error]: {
    title: "Error",
    description: "AI could not complete the fix.",
  },
  [AIRunStatus.Cancelled]: {
    title: "Cancelled",
    description: "The fix task was cancelled before AI completed it.",
  },
  [AIRunStatus.Stale]: {
    title: "Stale",
    description:
      "AI stopped reporting progress and the run was marked as stale. You can retry the fix.",
  },
};

/*
 * NoFixFound is deliberately neutral, not red: the run succeeded and simply
 * had nothing to propose. Only statuses that need someone to act are alarming.
 */
const STATUS_COLOR: { [key in AIRunStatus]: Color } = {
  [AIRunStatus.Queued]: Blue,
  [AIRunStatus.Running]: Yellow,
  [AIRunStatus.WaitingForApproval]: Amber500,
  [AIRunStatus.Completed]: Green,
  [AIRunStatus.NoFixFound]: Gray500,
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

/*
 * Filter dropdown options for the tasks list. These carry the same wording as
 * the status pill and the Task column rather than the raw enum values, so the
 * filter chip reads "Task is Fix Exception", not "Task is FixException".
 */
export function getCodeFixTaskTypeDropdownOptions(): Array<DropdownOption> {
  return Object.values(CodeFixTaskType).map(
    (taskType: CodeFixTaskType): DropdownOption => {
      return {
        label: getCodeFixTaskTypeLabel(taskType),
        value: taskType,
      };
    },
  );
}

export function getCodeFixRunStatusDropdownOptions(): Array<DropdownOption> {
  return Object.values(AIRunStatus).map(
    (status: AIRunStatus): DropdownOption => {
      return {
        label: getCodeFixRunStatusText(status).title,
        value: status,
      };
    },
  );
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

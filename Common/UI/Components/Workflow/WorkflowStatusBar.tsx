/*
 * The strip above the canvas: whether the draft is saved, what the run it
 * started is doing, and what the static checks have to say about it.
 *
 * All three used to be loose text of different shapes and colours sitting next
 * to each other, and the checks in particular were a bare underlined link — the
 * one thing on the strip that is clickable looked the least like a control.
 * They are pills here so the strip reads as one row of statuses, and so the
 * clickable one can carry a border, a hover state and a focus ring.
 */

import Icon, { SizeProp } from "../Icon/Icon";
import IconProp from "../../../Types/Icon/IconProp";
import { WorkflowLintResult } from "./GraphLint";
import {
  WorkflowLintTone,
  getWorkflowLintCountText,
  getWorkflowLintStatusText,
  getWorkflowLintTone,
} from "./GraphLintSummary";
import React, { FunctionComponent, ReactElement } from "react";

/** Where the draft is between the last edit and the server having it. */
export enum WorkflowSaveState {
  /** Nothing has been edited yet. */
  Idle = "Idle",
  Saving = "Saving",
  Saved = "Saved",
  Error = "Error",
}

export interface SaveStatePresentation {
  label: string;
  dotClassName: string;
  textClassName: string;
}

export type GetSaveStatePresentationFunction = (
  state: WorkflowSaveState,
) => SaveStatePresentation;

export const getWorkflowSaveStatePresentation: GetSaveStatePresentationFunction =
  (state: WorkflowSaveState): SaveStatePresentation => {
    if (state === WorkflowSaveState.Saved) {
      return {
        label: "Saved",
        dotClassName: "bg-emerald-500",
        textClassName: "text-emerald-700",
      };
    }

    if (state === WorkflowSaveState.Saving) {
      return {
        label: "Saving…",
        dotClassName: "bg-indigo-500 animate-pulse",
        textClassName: "text-indigo-700",
      };
    }

    if (state === WorkflowSaveState.Error) {
      return {
        label: "Could not save",
        dotClassName: "bg-red-500",
        textClassName: "text-red-700",
      };
    }

    return {
      label: "Ready",
      dotClassName: "bg-gray-400",
      textClassName: "text-gray-600",
    };
  };

const PILL_CLASS_NAME: string =
  "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium leading-4 whitespace-nowrap";

type GetLintPillClassNameFunction = (tone: WorkflowLintTone) => string;

const getLintPillClassName: GetLintPillClassNameFunction = (
  tone: WorkflowLintTone,
): string => {
  if (tone === WorkflowLintTone.Error) {
    return "border-red-200 bg-red-50 text-red-700 hover:bg-red-100 hover:border-red-300";
  }

  if (tone === WorkflowLintTone.Warning) {
    return "border-amber-200 bg-amber-50 text-amber-800 hover:bg-amber-100 hover:border-amber-300";
  }

  return "border-emerald-200 bg-emerald-50 text-emerald-700";
};

type GetRunPillClassNameFunction = (
  hasFailed: boolean,
  isClickable: boolean,
) => string;

const getRunPillClassName: GetRunPillClassNameFunction = (
  hasFailed: boolean,
  isClickable: boolean,
): string => {
  if (hasFailed) {
    return `border-red-200 bg-red-50 text-red-700${
      isClickable ? " hover:bg-red-100 hover:border-red-300" : ""
    }`;
  }

  return `border-gray-200 bg-gray-50 text-gray-600${
    isClickable ? " hover:bg-gray-100 hover:border-gray-300" : ""
  }`;
};

export interface ComponentProps {
  saveState: WorkflowSaveState;
  /** null until the canvas has run its checks for the first time. */
  lintResult?: WorkflowLintResult | null | undefined;
  /** Opens the panel listing what the checks found. */
  onShowIssues?: (() => void) | undefined;
  /** What the run this builder started is doing, while it is doing it. */
  runStatusMessage?: string | null | undefined;
  runStatusFailed?: boolean | undefined;
  /**
   * Opens that run's log. Given one, the run pill becomes a control — the
   * modal opens by itself when a run starts, and this is how it is got back
   * after being closed.
   */
  onShowRunLog?: (() => void) | undefined;
}

const WorkflowStatusBar: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const savePresentation: SaveStatePresentation =
    getWorkflowSaveStatePresentation(props.saveState);

  const lintResult: WorkflowLintResult | null = props.lintResult || null;
  const tone: WorkflowLintTone = lintResult
    ? getWorkflowLintTone(lintResult)
    : WorkflowLintTone.Clean;

  const hasIssues: boolean = Boolean(
    lintResult && lintResult.issues.length > 0,
  );

  return (
    <div
      className="flex flex-wrap items-center gap-2"
      data-testid="workflow-status-bar"
    >
      <span
        className={`${PILL_CLASS_NAME} border-gray-200 bg-white ${savePresentation.textClassName}`}
        data-testid="workflow-save-status"
      >
        <span
          className={`h-1.5 w-1.5 shrink-0 rounded-full ${savePresentation.dotClassName}`}
          aria-hidden="true"
        />
        {savePresentation.label}
      </span>

      {props.runStatusMessage &&
        (props.onShowRunLog ? (
          <button
            type="button"
            onClick={props.onShowRunLog}
            title="See this run's log"
            aria-label={`${props.runStatusMessage} Open the run log.`}
            data-testid="workflow-run-status-button"
            className={`${PILL_CLASS_NAME} cursor-pointer transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-1 ${getRunPillClassName(
              Boolean(props.runStatusFailed),
              true,
            )}`}
          >
            <Icon
              icon={props.runStatusFailed ? IconProp.Alert : IconProp.Play}
              size={SizeProp.ExtraSmall}
              className="h-3 w-3 shrink-0"
            />
            {props.runStatusMessage}
          </button>
        ) : (
          <span
            className={`${PILL_CLASS_NAME} ${getRunPillClassName(
              Boolean(props.runStatusFailed),
              false,
            )}`}
            data-testid="workflow-run-status"
          >
            <Icon
              icon={props.runStatusFailed ? IconProp.Alert : IconProp.Play}
              size={SizeProp.ExtraSmall}
              className="h-3 w-3 shrink-0"
            />
            {props.runStatusMessage}
          </span>
        ))}

      {lintResult &&
        (hasIssues ? (
          <button
            type="button"
            onClick={props.onShowIssues}
            title="See everything the checks found"
            aria-label={`${getWorkflowLintCountText(
              lintResult,
            )} found in this workflow. Open the list.`}
            data-testid="workflow-lint-status-button"
            className={`${PILL_CLASS_NAME} cursor-pointer transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-1 ${getLintPillClassName(
              tone,
            )}`}
          >
            <Icon
              icon={IconProp.Alert}
              size={SizeProp.ExtraSmall}
              className="h-3 w-3 shrink-0"
            />
            {getWorkflowLintCountText(lintResult)}
          </button>
        ) : (
          <span
            className={`${PILL_CLASS_NAME} ${getLintPillClassName(
              WorkflowLintTone.Clean,
            )}`}
            data-testid="workflow-lint-status"
          >
            <Icon
              icon={IconProp.CheckCircle}
              size={SizeProp.ExtraSmall}
              className="h-3 w-3 shrink-0"
            />
            {getWorkflowLintStatusText(lintResult)}
          </span>
        ))}
    </div>
  );
};

export default WorkflowStatusBar;

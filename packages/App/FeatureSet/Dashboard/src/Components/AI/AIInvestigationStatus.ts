import AIRunHumanVerdict from "Common/Types/AI/AIRunHumanVerdict";
import AIRunStatus from "Common/Types/AI/AIRunStatus";

export const AI_INVESTIGATION_PANEL_ID: string = "ai-investigation";

/*
 * A responder's verdict on the report, from the payload's raw
 * `run.humanVerdict`. Only the two values the server writes count; anything
 * else (an API replica that knows a value this build does not) reads as no
 * verdict, so the header never shows a badge it cannot name.
 */
export const getAIInvestigationVerdict: (
  value: unknown,
) => AIRunHumanVerdict | null = (value: unknown): AIRunHumanVerdict | null => {
  if (value === AIRunHumanVerdict.Confirmed) {
    return AIRunHumanVerdict.Confirmed;
  }

  if (value === AIRunHumanVerdict.Rejected) {
    return AIRunHumanVerdict.Rejected;
  }

  return null;
};

/*
 * Where the automatic investigation stands, as the card's conversation
 * needs to know it:
 *  - "checking": the card is still asking whether a run exists;
 *  - "underway": a run is queued, investigating or writing its report;
 *  - "reported": a root-cause report is on screen;
 *  - "none": there is no report to read and none is coming (nothing ran, the
 *    run stopped, or it finished without one).
 */
export type AIInvestigationStage =
  | "checking"
  | "underway"
  | "reported"
  | "none";

export const isActiveAIInvestigationStatus: (
  status: AIRunStatus | null | undefined,
) => boolean = (status: AIRunStatus | null | undefined): boolean => {
  return status === AIRunStatus.Queued || status === AIRunStatus.Running;
};

export const getAIInvestigationStage: (data: {
  isChecking: boolean;
  runStatus: AIRunStatus | null | undefined;
  hasReport: boolean;
  isReportPending: boolean;
}) => AIInvestigationStage = (data: {
  isChecking: boolean;
  runStatus: AIRunStatus | null | undefined;
  hasReport: boolean;
  isReportPending: boolean;
}): AIInvestigationStage => {
  if (data.isChecking) {
    return "checking";
  }

  if (isActiveAIInvestigationStatus(data.runStatus)) {
    return "underway";
  }

  if (data.runStatus === AIRunStatus.Completed) {
    if (data.hasReport) {
      return "reported";
    }

    return data.isReportPending ? "underway" : "none";
  }

  return "none";
};

/*
 * A completed investigation only earns a header notice when it left a
 * summary to show; without one the notice would be an empty "done" banner.
 */
export const hasAIInvestigationSummary: (
  summary: string | null | undefined,
) => boolean = (summary: string | null | undefined): boolean => {
  return typeof summary === "string" && summary.trim().length > 0;
};

export const isCompletedAIInvestigationWithSummary: (
  status: AIRunStatus | null | undefined,
  summary: string | null | undefined,
) => boolean = (
  status: AIRunStatus | null | undefined,
  summary: string | null | undefined,
): boolean => {
  return status === AIRunStatus.Completed && hasAIInvestigationSummary(summary);
};

/*
 * Whether an event header should render AIInvestigationHeaderStatus at all:
 * while the run is queued or running, or once it completed with a summary.
 */
export const shouldShowAIInvestigationHeaderStatus: (
  status: AIRunStatus | null | undefined,
  summary?: string | null | undefined,
) => boolean = (
  status: AIRunStatus | null | undefined,
  summary?: string | null | undefined,
): boolean => {
  return (
    isActiveAIInvestigationStatus(status) ||
    isCompletedAIInvestigationWithSummary(status, summary)
  );
};

export const scrollToAIInvestigationPanel: () => void = (): void => {
  const investigationPanel: HTMLElement | null = document.getElementById(
    AI_INVESTIGATION_PANEL_ID,
  );

  if (!investigationPanel) {
    return;
  }

  const prefersReducedMotion: boolean =
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  investigationPanel.scrollIntoView({
    behavior: prefersReducedMotion ? "auto" : "smooth",
    block: "start",
  });
  investigationPanel.focus({ preventScroll: true });
};

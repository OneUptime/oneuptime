import AIRunStatus from "Common/Types/AI/AIRunStatus";

export const AI_INVESTIGATION_PANEL_ID: string = "ai-investigation";

export const isActiveAIInvestigationStatus: (
  status: AIRunStatus | null | undefined,
) => boolean = (status: AIRunStatus | null | undefined): boolean => {
  return status === AIRunStatus.Queued || status === AIRunStatus.Running;
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

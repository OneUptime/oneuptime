import AIRunStatus from "Common/Types/AI/AIRunStatus";

export const AI_INVESTIGATION_PANEL_ID: string = "ai-investigation";

export const isActiveAIInvestigationStatus: (
  status: AIRunStatus | null | undefined,
) => boolean = (status: AIRunStatus | null | undefined): boolean => {
  return status === AIRunStatus.Queued || status === AIRunStatus.Running;
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

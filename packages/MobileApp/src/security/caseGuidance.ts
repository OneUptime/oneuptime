import type { Ionicons } from "@expo/vector-icons";
import type { StatusTone } from "../components/StatusPill";

type IconName = keyof typeof Ionicons.glyphMap;

/*
 * WHERE A CASE STANDS, AND THE NEXT STEP, in the card above the case's
 * actions - the same card an incident's screen has, with a case's words.
 *
 * An analyst opening a case from a page needs one answer first: is anybody
 * on it? So the stages are about who has it - nobody, somebody else, you -
 * and then whether it is done. The titles avoid the project's status names,
 * which the status pill already says; they say what to do next.
 */

export type CaseStage = "unassigned" | "theirs" | "mine" | "closed";

export interface CaseGuidance {
  stage: CaseStage;
  tone: StatusTone;
  icon: IconName;
  title: string;
  message: string;
}

export function getCaseGuidance(data: {
  isClosed: boolean;
  isMine: boolean;
  // Whether a person has the case: someone else, when not the reader.
  hasAssignee: boolean;
  assigneeName: string;
  isContained: boolean;
  verdict: string | null | undefined;
}): CaseGuidance {
  if (data.isClosed) {
    return {
      stage: "closed",
      tone: "success",
      icon: "checkmark-circle-outline",
      title: "Case closed",
      message: data.verdict
        ? `Closed as ${data.verdict}. Reopen it if it needs more work.`
        : "Reopen it if it needs more work.",
    };
  }

  if (data.isMine) {
    return {
      stage: "mine",
      tone: "info",
      icon: "construct-outline",
      title: "You have this case",
      message: data.isContained
        ? "The threat is contained. Close the case with a verdict once the cleanup is done."
        : "Change its status as you work it, and close it with a verdict when it is done.",
    };
  }

  if (data.hasAssignee) {
    return {
      stage: "theirs",
      tone: "info",
      icon: "person-outline",
      title: data.assigneeName
        ? `${data.assigneeName} has this case`
        : "Someone has this case",
      message: "Assign it to yourself if you are taking it over.",
    };
  }

  return {
    stage: "unassigned",
    tone: "warning",
    icon: "alert-circle-outline",
    title: "Needs an analyst",
    message:
      "Nobody has taken this case yet. Assign it to yourself to take it on.",
  };
}

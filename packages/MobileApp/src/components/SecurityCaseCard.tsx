import React from "react";
import { useTheme } from "../theme";
import { rgbToHex } from "../utils/color";
import { formatRelativeTime } from "../utils/date";
import { toPlainText } from "../utils/text";
import ResponseRow from "./ResponseRow";
import type {
  SecurityCaseItem,
  SecurityCasePersonRef,
} from "../api/types";

interface SecurityCaseCardProps {
  securityCase: SecurityCaseItem;
  // A playbook step on the case waits for somebody to approve it.
  awaitingApproval?: boolean;
  // The case is assigned to the person signed in.
  isMine?: boolean;
  onPress: () => void;
  /** Open in the detail pane beside the list. */
  selected?: boolean;
  showChevron?: boolean;
}

// A person as a row names them: their name, else their email.
export function getPersonName(
  person: SecurityCasePersonRef | null | undefined,
): string {
  if (!person) {
    return "";
  }

  return toPlainText(person.name).trim() || toPlainText(person.email).trim();
}

// The case's number as the dashboard prints it, CASE-42, or #42 for a project without a prefix.
export function getCaseNumber(securityCase: SecurityCaseItem): string {
  if (securityCase.caseNumberWithPrefix) {
    return securityCase.caseNumberWithPrefix;
  }

  return typeof securityCase.caseNumber === "number"
    ? `#${securityCase.caseNumber}`
    : "";
}

/*
 * Who has the case, in the words a row reads it in: you, a person, or -
 * a case handed to a team with nobody on it yet - the team it waits for.
 */
export function describeCaseAssignee(
  securityCase: SecurityCaseItem,
  isMine: boolean,
): { text: string; isTeam: boolean } {
  if (isMine) {
    return { text: "Assigned to you", isTeam: false };
  }

  const person: string = getPersonName(securityCase.assignedToUser);

  if (person) {
    return { text: `Assigned to ${person}`, isTeam: false };
  }

  if (securityCase.assignedToUserId) {
    return { text: "Assigned", isTeam: false };
  }

  const team: string = toPlainText(securityCase.assignedToTeam?.name).trim();

  return team
    ? { text: `Unassigned · ${team}`, isTeam: true }
    : { text: "Unassigned", isTeam: false };
}

/**
 * A security case in a list: where it stands and how urgent first, then what
 * it is about, then who has it. A case waiting for an approval says so in
 * words; the list puts those first.
 */
export default function SecurityCaseCard({
  securityCase,
  awaitingApproval = false,
  isMine = false,
  onPress,
  selected,
  showChevron,
}: SecurityCaseCardProps): React.JSX.Element {
  const { theme } = useTheme();
  const number: string = getCaseNumber(securityCase);
  const status: string = toPlainText(securityCase.securityCaseStatus?.name);
  const priority: string = toPlainText(securityCase.securityCasePriority?.name);
  const assignee: { text: string; isTeam: boolean } = describeCaseAssignee(
    securityCase,
    isMine,
  );

  return (
    <ResponseRow
      title={securityCase.title}
      kind="Security case"
      number={number}
      time={formatRelativeTime(
        securityCase.lastDetectedAt || securityCase.createdAt,
      )}
      state={status || undefined}
      stateColor={
        securityCase.securityCaseStatus?.color
          ? rgbToHex(securityCase.securityCaseStatus.color)
          : theme.colors.textTertiary
      }
      severity={priority || undefined}
      context={assignee.text}
      contextIcon={assignee.isTeam ? "people-outline" : "person-outline"}
      badge={
        awaitingApproval
          ? { label: "Approval needed", tone: "warning" }
          : undefined
      }
      selected={selected}
      showChevron={showChevron}
      accessibilityLabel={[
        `Security case ${number}, ${securityCase.title}.`,
        status ? `Status: ${status}.` : "",
        priority ? `Priority: ${priority}.` : "",
        `${assignee.text}.`,
        awaitingApproval ? "A playbook step is waiting for approval." : "",
      ]
        .filter(Boolean)
        .join(" ")}
      accessibilityHint="Open the case and its response actions"
      onPress={onPress}
    />
  );
}

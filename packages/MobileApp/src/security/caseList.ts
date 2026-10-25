import { matchesSearch } from "../utils/search";
import { toPlainText } from "../utils/text";
import { getCasePriorityRank, type CaseValueList } from "./caseValues";
import { isCaseAssignedTo } from "./caseChanges";
import { readCaseEntities, type SecurityEntity } from "./caseTerms";
import type {
  ProjectSecurityCaseItem,
  SecurityCaseItem,
  SecurityCasePriorityItem,
} from "../api/types";

/*
 * THE OPEN CASES, IN THE ORDER A PAGED ANALYST WORKS THEM.
 *
 * The dashboard's Open Cases sorts by the latest detection, which suits a
 * desk with the whole queue in view. A phone shows four or five rows, so the
 * list leads with what cannot wait: a case whose playbook is held for an
 * approval - nothing happens until somebody decides - then the most urgent
 * priority by the project's own ranking, then the latest detection. The three
 * filters ask the dashboard's own questions of the queue: every open case,
 * the ones assigned to me, and the ones nobody has picked up.
 */

export type CaseListFilter = "open" | "mine" | "unassigned";

export const CASE_LIST_FILTERS: ReadonlyArray<{
  key: CaseListFilter;
  label: string;
  accessibilityLabel: string;
}> = [
  { key: "open", label: "Open", accessibilityLabel: "Every open case" },
  {
    key: "mine",
    label: "Assigned to me",
    accessibilityLabel: "Open cases assigned to me",
  },
  {
    key: "unassigned",
    label: "Unassigned",
    accessibilityLabel: "Open cases nobody has picked up",
  },
];

export function isCaseListFilter(value: unknown): value is CaseListFilter {
  return CASE_LIST_FILTERS.some((filter: { key: string }): boolean => {
    return filter.key === value;
  });
}

function toTime(value: string | null | undefined): number | null {
  if (!value) {
    return null;
  }

  const time: number = new Date(value).getTime();

  return Number.isFinite(time) ? time : null;
}

// When the case last moved: its latest detection, else when it opened.
export function getCaseActivityTime(securityCase: SecurityCaseItem): number {
  return (
    toTime(securityCase.lastDetectedAt) ?? toTime(securityCase.createdAt) ?? 0
  );
}

export function isCaseAwaitingApproval(
  securityCase: SecurityCaseItem,
  awaitingCaseIds: ReadonlySet<string>,
): boolean {
  return awaitingCaseIds.has(String(securityCase._id).toLowerCase());
}

export function sortCasesForTriage(
  items: ReadonlyArray<ProjectSecurityCaseItem>,
  priorities: CaseValueList<SecurityCasePriorityItem>,
  awaitingCaseIds: ReadonlySet<string>,
): Array<ProjectSecurityCaseItem> {
  const rankOf: (item: SecurityCaseItem) => number = (
    item: SecurityCaseItem,
  ): number => {
    const rank: number | null = getCasePriorityRank(
      priorities,
      item.securityCasePriorityId ?? item.securityCasePriority?._id,
    );

    return rank === null ? Number.MAX_SAFE_INTEGER : rank;
  };

  return items
    .map((wrapped: ProjectSecurityCaseItem, index: number) => {
      return { wrapped, index };
    })
    .sort(
      (
        a: { wrapped: ProjectSecurityCaseItem; index: number },
        b: { wrapped: ProjectSecurityCaseItem; index: number },
      ): number => {
        const aWaiting: boolean = isCaseAwaitingApproval(
          a.wrapped.item,
          awaitingCaseIds,
        );
        const bWaiting: boolean = isCaseAwaitingApproval(
          b.wrapped.item,
          awaitingCaseIds,
        );

        if (aWaiting !== bWaiting) {
          return aWaiting ? -1 : 1;
        }

        const rankDifference: number =
          rankOf(a.wrapped.item) - rankOf(b.wrapped.item);

        if (rankDifference !== 0) {
          return rankDifference;
        }

        const timeDifference: number =
          getCaseActivityTime(b.wrapped.item) -
          getCaseActivityTime(a.wrapped.item);

        // The server's own order breaks what is left: the sort is stable.
        return timeDifference !== 0 ? timeDifference : a.index - b.index;
      },
    )
    .map((entry: { wrapped: ProjectSecurityCaseItem }) => {
      return entry.wrapped;
    });
}

/*
 * Search looks through what a responder remembers about a case: its title,
 * its number (CASE-42, or 42), who has it, and what it is about - the user,
 * host or address in the page that woke them.
 */
export function matchesCaseSearch(
  securityCase: SecurityCaseItem,
  search: string,
): boolean {
  if (!search.trim()) {
    return true;
  }

  return matchesSearch(search, [
    securityCase.title,
    securityCase.caseNumberWithPrefix,
    securityCase.caseNumber,
    toPlainText(securityCase.assignedToUser?.name),
    toPlainText(securityCase.assignedToUser?.email),
    toPlainText(securityCase.assignedToTeam?.name),
    ...readCaseEntities(securityCase.entities).map(
      (entity: SecurityEntity): string => {
        return entity.value;
      },
    ),
  ]);
}

export function filterCases(
  items: ReadonlyArray<ProjectSecurityCaseItem>,
  options: {
    filter: CaseListFilter;
    userId: string | null | undefined;
    search: string;
  },
): Array<ProjectSecurityCaseItem> {
  return items.filter((wrapped: ProjectSecurityCaseItem): boolean => {
    const securityCase: SecurityCaseItem = wrapped.item;

    if (
      options.filter === "mine" &&
      !isCaseAssignedTo(securityCase.assignedToUserId, options.userId)
    ) {
      return false;
    }

    if (options.filter === "unassigned" && securityCase.assignedToUserId) {
      return false;
    }

    return matchesCaseSearch(securityCase, options.search);
  });
}

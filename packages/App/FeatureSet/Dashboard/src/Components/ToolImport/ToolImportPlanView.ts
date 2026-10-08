import {
  ToolImportAction,
  ToolImportOutcome,
  ToolImportPlan,
  ToolImportPlanItem,
  ToolImportReport,
  ToolImportReportItem,
} from "Common/Types/ToolImport/ToolImportPlan";
import ToolImportResourceKind, {
  ToolImportResourceKindOrder,
} from "Common/Types/ToolImport/ToolImportResourceKind";
import ToolImportRunStatus from "Common/Types/ToolImport/ToolImportRunStatus";

/*
 * How the preview and the report are laid out, and what ticking does -
 * worked out apart from React so the App tests read it.
 *
 * The preview is one section per kind, in the order OneUptime builds them
 * (people before the teams they are in, schedules before the policies that
 * page them). What an item names (a team's members, a policy's schedules)
 * is brought over only if it is ticked too, so each ticked item says which
 * of the things it uses will be left out.
 */

/*
 * A row of buttons. Button keeps a left margin meant for a dialog's footer
 * (md:ml-3); the row's gap spaces these, so the margin is cleared on each
 * button, and on the one a disabled button's tooltip wraps.
 */
export const TOOL_IMPORT_BUTTON_ROW_CLASS_NAME: string =
  "flex flex-wrap items-center gap-3 [&>button]:ml-0 [&>button]:md:ml-0 [&>*>button]:ml-0 [&>*>button]:md:ml-0";

// How many items a section of the preview or the report lists before "Show more".
export const TOOL_IMPORT_SECTION_PAGE_SIZE: number = 50;

export interface ToolImportPlanSection {
  kind: ToolImportResourceKind;
  items: Array<ToolImportPlanItem>;
  // The keys of the items that can be ticked.
  selectableKeys: Array<string>;
  // How many items of each action, for the line under the title.
  actionCounts: Record<ToolImportAction, number>;
}

function getEmptyActionCounts(): Record<ToolImportAction, number> {
  return {
    [ToolImportAction.Create]: 0,
    [ToolImportAction.Invite]: 0,
    [ToolImportAction.Match]: 0,
    [ToolImportAction.AlreadyImported]: 0,
    [ToolImportAction.Skip]: 0,
  };
}

// Items that would create something come first, then the rest, by name.
const ACTION_ORDER: Record<ToolImportAction, number> = {
  [ToolImportAction.Create]: 0,
  [ToolImportAction.Invite]: 0,
  [ToolImportAction.Match]: 1,
  [ToolImportAction.AlreadyImported]: 2,
  [ToolImportAction.Skip]: 3,
};

export function getToolImportPlanSections(
  plan: ToolImportPlan,
): Array<ToolImportPlanSection> {
  const sections: Array<ToolImportPlanSection> = [];

  for (const kind of ToolImportResourceKindOrder) {
    const items: Array<ToolImportPlanItem> = plan.items
      .filter((item: ToolImportPlanItem): boolean => {
        return item.kind === kind;
      })
      .sort((a: ToolImportPlanItem, b: ToolImportPlanItem): number => {
        const byAction: number =
          ACTION_ORDER[a.action] - ACTION_ORDER[b.action];

        return byAction !== 0 ? byAction : a.name.localeCompare(b.name);
      });

    if (items.length === 0) {
      continue;
    }

    const actionCounts: Record<ToolImportAction, number> =
      getEmptyActionCounts();

    for (const item of items) {
      actionCounts[item.action] += 1;
    }

    sections.push({
      kind: kind,
      items: items,
      selectableKeys: items
        .filter((item: ToolImportPlanItem): boolean => {
          return item.isSelectable;
        })
        .map((item: ToolImportPlanItem): string => {
          return item.key;
        }),
      actionCounts: actionCounts,
    });
  }

  return sections;
}

// What starts ticked: what the plan ticks, and only what can be ticked.
export function getDefaultToolImportSelection(
  plan: ToolImportPlan,
): Set<string> {
  return new Set<string>(
    plan.items
      .filter((item: ToolImportPlanItem): boolean => {
        return item.isSelectable && item.isSelectedByDefault;
      })
      .map((item: ToolImportPlanItem): string => {
        return item.key;
      }),
  );
}

// The selection with `keys` ticked or unticked, as a new set.
export function setToolImportKeys(
  selection: ReadonlySet<string>,
  keys: ReadonlyArray<string>,
  isTicked: boolean,
): Set<string> {
  const next: Set<string> = new Set<string>(selection);

  for (const key of keys) {
    if (isTicked) {
      next.add(key);
    } else {
      next.delete(key);
    }
  }

  return next;
}

export function countTickedKeys(
  keys: ReadonlyArray<string>,
  selection: ReadonlySet<string>,
): number {
  return keys.filter((key: string): boolean => {
    return selection.has(key);
  }).length;
}

/*
 * What a ticked item uses that will not be brought over: items it names
 * that are left unticked, or that cannot come over at all. Items that are
 * already in OneUptime are used as they are, so they are never listed.
 */
export function getLeftOutReferences(data: {
  item: ToolImportPlanItem;
  itemsByKey: ReadonlyMap<string, ToolImportPlanItem>;
  selection: ReadonlySet<string>;
}): Array<ToolImportPlanItem> {
  const leftOut: Array<ToolImportPlanItem> = [];
  const seen: Set<string> = new Set<string>();

  for (const key of data.item.references) {
    const referenced: ToolImportPlanItem | undefined = data.itemsByKey.get(key);

    if (!referenced || seen.has(key)) {
      continue;
    }

    seen.add(key);

    const isLeftOut: boolean = referenced.isSelectable
      ? !data.selection.has(key)
      : referenced.action === ToolImportAction.Skip;

    if (isLeftOut) {
      leftOut.push(referenced);
    }
  }

  return leftOut;
}

export function getToolImportItemsByKey(
  plan: ToolImportPlan,
): Map<string, ToolImportPlanItem> {
  return new Map<string, ToolImportPlanItem>(
    plan.items.map((item: ToolImportPlanItem): [string, ToolImportPlanItem] => {
      return [item.key, item];
    }),
  );
}

// Whether anyone ticked would be sent an invitation.
export function hasTickedInvites(
  plan: ToolImportPlan,
  selection: ReadonlySet<string>,
): boolean {
  return plan.items.some((item: ToolImportPlanItem): boolean => {
    return item.action === ToolImportAction.Invite && selection.has(item.key);
  });
}

/*
 * The selection the start request sends: only keys of items that can be
 * ticked, in the plan's order.
 */
export function getSelectedKeys(
  plan: ToolImportPlan,
  selection: ReadonlySet<string>,
): Array<string> {
  return plan.items
    .filter((item: ToolImportPlanItem): boolean => {
      return item.isSelectable && selection.has(item.key);
    })
    .map((item: ToolImportPlanItem): string => {
      return item.key;
    });
}

/*
 * The team new people are invited to at first: the plan's pick when it is
 * one of the teams offered, else the first of them, else none.
 */
export function getInitialInviteTeamId(plan: ToolImportPlan): string | null {
  const offered: Array<string> = plan.inviteTeams.map(
    (team: { id: string }): string => {
      return team.id;
    },
  );

  if (plan.defaultInviteTeamId && offered.includes(plan.defaultInviteTeamId)) {
    return plan.defaultInviteTeamId;
  }

  return offered[0] || null;
}

// ---- The report.

export interface ToolImportReportSection {
  kind: ToolImportResourceKind;
  items: Array<ToolImportReportItem>;
}

const OUTCOME_ORDER: Record<ToolImportOutcome, number> = {
  [ToolImportOutcome.Failed]: 0,
  [ToolImportOutcome.Created]: 1,
  [ToolImportOutcome.Invited]: 1,
  [ToolImportOutcome.Matched]: 2,
  [ToolImportOutcome.AlreadyImported]: 3,
  [ToolImportOutcome.Skipped]: 4,
};

/*
 * The report, one section per kind in the order the import built them,
 * failures first in each, then what was created, then the rest.
 */
export function getToolImportReportSections(
  report: ToolImportReport,
): Array<ToolImportReportSection> {
  const sections: Array<ToolImportReportSection> = [];

  for (const kind of ToolImportResourceKindOrder) {
    const items: Array<ToolImportReportItem> = report.items
      .filter((item: ToolImportReportItem): boolean => {
        return item.kind === kind;
      })
      .sort((a: ToolImportReportItem, b: ToolImportReportItem): number => {
        const byOutcome: number =
          OUTCOME_ORDER[a.outcome] - OUTCOME_ORDER[b.outcome];

        return byOutcome !== 0 ? byOutcome : a.name.localeCompare(b.name);
      });

    if (items.length > 0) {
      sections.push({ kind: kind, items: items });
    }
  }

  return sections;
}

// The outcomes the report's top line counts, in the order it says them.
export const TOOL_IMPORT_REPORT_COUNT_ORDER: ReadonlyArray<ToolImportOutcome> =
  [
    ToolImportOutcome.Created,
    ToolImportOutcome.Invited,
    ToolImportOutcome.Matched,
    ToolImportOutcome.AlreadyImported,
    ToolImportOutcome.Skipped,
    ToolImportOutcome.Failed,
  ];

// ---- Which run the page shows.

const IN_FLIGHT_STATUSES: ReadonlyArray<ToolImportRunStatus> = [
  ToolImportRunStatus.Reading,
  ToolImportRunStatus.ReadyToReview,
  ToolImportRunStatus.Importing,
];

export function isToolImportRunInFlight(status: ToolImportRunStatus): boolean {
  return IN_FLIGHT_STATUSES.includes(status);
}

// Whether the page should ask the server again soon: the run is working.
export function isToolImportRunWorking(status: ToolImportRunStatus): boolean {
  return (
    status === ToolImportRunStatus.Reading ||
    status === ToolImportRunStatus.Importing
  );
}

/*
 * The run the page opens on: the one the address names, when it is listed;
 * else the newest of the person's own that is still in flight (reading,
 * waiting for them, or importing); else one of someone else's that is
 * reading or importing now - only one runs at a time, so it is what a new
 * import waits for. Null opens the tool picker.
 */
export function pickToolImportRunToShow(data: {
  runs: ReadonlyArray<{
    id: string;
    status: ToolImportRunStatus;
    isMine: boolean;
  }>;
  requestedRunId: string | null;
}): string | null {
  if (
    data.requestedRunId &&
    data.runs.some((run: { id: string }): boolean => {
      return run.id === data.requestedRunId;
    })
  ) {
    return data.requestedRunId;
  }

  const ownInFlight: { id: string } | undefined = data.runs.find(
    (run: { status: ToolImportRunStatus; isMine: boolean }): boolean => {
      return run.isMine && isToolImportRunInFlight(run.status);
    },
  );

  if (ownInFlight) {
    return ownInFlight.id;
  }

  const othersWorking: { id: string } | undefined = data.runs.find(
    (run: { status: ToolImportRunStatus; isMine: boolean }): boolean => {
      return !run.isMine && isToolImportRunWorking(run.status);
    },
  );

  return othersWorking ? othersWorking.id : null;
}

/*
 * Someone else's import that is reading or importing now: only one import
 * of a project runs at a time, so a new one waits for it.
 */
export function getOtherRunningImport<
  T extends { status: ToolImportRunStatus; isMine: boolean },
>(runs: ReadonlyArray<T>): T | null {
  return (
    runs.find((run: T): boolean => {
      return !run.isMine && isToolImportRunWorking(run.status);
    }) || null
  );
}

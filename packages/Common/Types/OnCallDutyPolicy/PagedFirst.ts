import { getOnCallPolicyFirstLevel } from "./OnCallRunLevel";
import ObjectID from "../ObjectID";

/*
 * WHO A POLICY PAGES FIRST, ON THE LIST OF POLICIES (#9701).
 *
 * The On-Call Policies list said each policy's name, description, labels
 * and owners, and nothing of who it pages: to see whether "Payments" woke
 * the payments team or nobody, people opened each policy in turn. The list
 * now says who each one pages first, in a column of its own: the people,
 * teams and schedules of its first escalation rule, and for a schedule who
 * is on call in it now.
 *
 * Its first rule is the one a run starts with and the policy's Escalation
 * Rules page lists first: the lowest place, which need not be 1 - rules
 * written through the API keep the place they are given, a deleted rule
 * leaves its gap - and of two rules at that place the one read first, by
 * id (OnCallRunLevel.getOnCallPolicyFirstLevel, which the run's advance and
 * the test page read too; OnCallDutyPolicyEscalationRuleService
 * .findFirstOfPolicy reads the same rule from the database).
 *
 * A schedule says who is on call in it now as the schedule keeps it
 * (currentUserOnRoster, which the RefreshHandoffTime worker refreshes every
 * minute, overrides included): free to read, and what the schedules list
 * shows. A schedule paged for the next person in its rotation is said as
 * that, without a name: the next person is worked out from its layers when
 * the page goes out. A team is said by its name.
 *
 * Where the chain breaks, the cell says so instead: a policy with no
 * escalation rules pages nobody, and a first rule that names nobody is
 * passed at once (OnCallEmptyLevel), so the list names both.
 *
 * Pure: the Dashboard reads the rows (Components/OnCallPolicy/PagedFirst),
 * and this decides what each policy's cell holds, so a test can hand it any
 * rows. The cell's words are the Dashboard's.
 */

export enum PagedFirstKind {
  // The policy has no escalation rules: it pages nobody.
  NoEscalationRules = "NoEscalationRules",
  // Its first rule names nobody: a run passes it at once.
  NoResponders = "NoResponders",
  // Its first rule names the people, teams and schedules below.
  Responders = "Responders",
}

export enum PagedFirstResponderKind {
  Schedule = "Schedule",
  Team = "Team",
  User = "User",
}

export interface PagedFirstResponder {
  kind: PagedFirstResponderKind;
  id: string;
  // As the project wrote it; a person with no name yet, by their email.
  name: string;
  // A schedule's: who is on call in it now, or null when nobody is.
  onCallUserName?: string | null | undefined;
  // A schedule's: the rule pages the next person in its rotation.
  isNextInRotation?: boolean | undefined;
}

export interface PagedFirst {
  kind: PagedFirstKind;
  // The first escalation rule, null when there is none.
  ruleId: string | null;
  ruleName: string;
  // Schedules, then teams, then people, each by name.
  responders: Array<PagedFirstResponder>;
}

// An escalation rule of a policy, as the list reads it.
export interface PagedFirstRuleRow {
  id: string;
  policyId: string;
  order: number | null;
  name: string;
}

// A person, a team or a schedule a rule names, as its join row reads.
export interface PagedFirstResponderRow {
  ruleId: string;
  id: string;
  name: string;
}

export interface PagedFirstScheduleRow extends PagedFirstResponderRow {
  isNextInRotation: boolean;
}

// What the list says while a schedule's on-call person is not read yet.
export interface PagedFirstOnCallNow {
  // By schedule id: who is on call now, or null for nobody.
  [scheduleId: string]: string | null;
}

/*
 * The most chips a cell draws before "+N more": a first rule names a
 * schedule or two as a rule, and a row of five names would push every
 * other column off a laptop's screen.
 */
export const PAGED_FIRST_CHIPS_SHOWN: number = 3;

// A rule as the engine reads a level: its id and its place, with its row.
interface PagedFirstLevel {
  id: ObjectID;
  order: number | null;
  row: PagedFirstRuleRow;
}

const idOf: (id: string) => string = (id: string): string => {
  return (id || "").toString().toLowerCase();
};

const KIND_ORDER: Record<PagedFirstResponderKind, number> = {
  [PagedFirstResponderKind.Schedule]: 0,
  [PagedFirstResponderKind.Team]: 1,
  [PagedFirstResponderKind.User]: 2,
};

/*
 * Each policy's first escalation rule, by policy id: of its rules, the one
 * a run starts with (getOnCallPolicyFirstLevel). A policy with no rules has
 * no entry.
 */
export const getFirstRuleOfEachPolicy: (
  rules: ReadonlyArray<PagedFirstRuleRow>,
) => Map<string, PagedFirstRuleRow> = (
  rules: ReadonlyArray<PagedFirstRuleRow>,
): Map<string, PagedFirstRuleRow> => {
  const byPolicy: Map<string, Array<PagedFirstRuleRow>> = new Map();

  for (const rule of rules) {
    const policyId: string = idOf(rule.policyId);

    if (!policyId || !rule.id) {
      continue;
    }

    byPolicy.set(policyId, [...(byPolicy.get(policyId) || []), rule]);
  }

  const firstRules: Map<string, PagedFirstRuleRow> = new Map();

  for (const [policyId, policyRules] of byPolicy) {
    const first: PagedFirstLevel | null = getOnCallPolicyFirstLevel(
      policyRules.map((row: PagedFirstRuleRow): PagedFirstLevel => {
        return { id: new ObjectID(row.id), order: row.order, row: row };
      }),
    );

    if (first) {
      firstRules.set(policyId, first.row);
    }
  }

  return firstRules;
};

/*
 * What each policy's cell holds, by policy id, for every policy listed:
 * its first rule's responders - each once, schedules first, then teams,
 * then people, each kind by name - or where its chain breaks.
 */
export const getPagedFirstOfPolicies: (data: {
  policyIds: ReadonlyArray<string>;
  rules: ReadonlyArray<PagedFirstRuleRow>;
  users: ReadonlyArray<PagedFirstResponderRow>;
  teams: ReadonlyArray<PagedFirstResponderRow>;
  schedules: ReadonlyArray<PagedFirstScheduleRow>;
  onCallNow: PagedFirstOnCallNow;
}) => Map<string, PagedFirst> = (data: {
  policyIds: ReadonlyArray<string>;
  rules: ReadonlyArray<PagedFirstRuleRow>;
  users: ReadonlyArray<PagedFirstResponderRow>;
  teams: ReadonlyArray<PagedFirstResponderRow>;
  schedules: ReadonlyArray<PagedFirstScheduleRow>;
  onCallNow: PagedFirstOnCallNow;
}): Map<string, PagedFirst> => {
  const firstRules: Map<string, PagedFirstRuleRow> = getFirstRuleOfEachPolicy(
    data.rules,
  );

  // Every responder of a first rule, by the rule's id.
  const respondersByRule: Map<string, Array<PagedFirstResponder>> = new Map();

  const add: (ruleId: string, responder: PagedFirstResponder) => void = (
    ruleId: string,
    responder: PagedFirstResponder,
  ): void => {
    const key: string = idOf(ruleId);
    const responders: Array<PagedFirstResponder> =
      respondersByRule.get(key) || [];

    // Each once: a schedule paged twice the same way is one chip.
    if (
      responders.some((existing: PagedFirstResponder): boolean => {
        return (
          existing.kind === responder.kind &&
          idOf(existing.id) === idOf(responder.id) &&
          Boolean(existing.isNextInRotation) ===
            Boolean(responder.isNextInRotation)
        );
      })
    ) {
      return;
    }

    respondersByRule.set(key, [...responders, responder]);
  };

  for (const user of data.users) {
    if (user.id) {
      add(user.ruleId, {
        kind: PagedFirstResponderKind.User,
        id: user.id,
        name: user.name,
      });
    }
  }

  for (const team of data.teams) {
    if (team.id) {
      add(team.ruleId, {
        kind: PagedFirstResponderKind.Team,
        id: team.id,
        name: team.name,
      });
    }
  }

  for (const schedule of data.schedules) {
    if (!schedule.id) {
      continue;
    }

    const onCallNow: string | null | undefined =
      data.onCallNow[idOf(schedule.id)];

    add(schedule.ruleId, {
      kind: PagedFirstResponderKind.Schedule,
      id: schedule.id,
      name: schedule.name,
      isNextInRotation: schedule.isNextInRotation,
      onCallUserName: schedule.isNextInRotation
        ? undefined
        : onCallNow === undefined
          ? undefined
          : onCallNow,
    });
  }

  const pagedFirst: Map<string, PagedFirst> = new Map();

  for (const policyId of data.policyIds) {
    const rule: PagedFirstRuleRow | undefined = firstRules.get(idOf(policyId));

    if (!rule) {
      pagedFirst.set(idOf(policyId), {
        kind: PagedFirstKind.NoEscalationRules,
        ruleId: null,
        ruleName: "",
        responders: [],
      });
      continue;
    }

    const responders: Array<PagedFirstResponder> = [
      ...(respondersByRule.get(idOf(rule.id)) || []),
    ].sort((left: PagedFirstResponder, right: PagedFirstResponder): number => {
      return (
        KIND_ORDER[left.kind] - KIND_ORDER[right.kind] ||
        left.name.localeCompare(right.name) ||
        idOf(left.id).localeCompare(idOf(right.id))
      );
    });

    pagedFirst.set(idOf(policyId), {
      kind:
        responders.length > 0
          ? PagedFirstKind.Responders
          : PagedFirstKind.NoResponders,
      ruleId: rule.id,
      ruleName: rule.name,
      responders: responders,
    });
  }

  return pagedFirst;
};

// What a policy's cell holds, read by its id however the id is cased.
export const getPagedFirstOfPolicy: (
  pagedFirst: Map<string, PagedFirst>,
  policyId: string | null | undefined,
) => PagedFirst | undefined = (
  pagedFirst: Map<string, PagedFirst>,
  policyId: string | null | undefined,
): PagedFirst | undefined => {
  return policyId ? pagedFirst.get(idOf(policyId)) : undefined;
};

/*
 * The chips a cell draws, and how many more there are: at most
 * PAGED_FIRST_CHIPS_SHOWN, the rest counted.
 */
export const getShownPagedFirstResponders: (
  responders: ReadonlyArray<PagedFirstResponder>,
) => { shown: Array<PagedFirstResponder>; moreCount: number } = (
  responders: ReadonlyArray<PagedFirstResponder>,
): { shown: Array<PagedFirstResponder>; moreCount: number } => {
  // Never "+1 more": the chip it would stand for fits in its place.
  if (responders.length <= PAGED_FIRST_CHIPS_SHOWN + 1) {
    return { shown: [...responders], moreCount: 0 };
  }

  return {
    shown: responders.slice(0, PAGED_FIRST_CHIPS_SHOWN),
    moreCount: responders.length - PAGED_FIRST_CHIPS_SHOWN,
  };
};

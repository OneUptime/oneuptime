import BaseModel, {
  DatabaseBaseModelType,
} from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import UserNotificationRule from "Common/Models/DatabaseModels/UserNotificationRule";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import URL from "Common/Types/API/URL";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import Select from "Common/Types/BaseDatabase/Select";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import { ErrorFunction, VoidFunction } from "Common/Types/FunctionTypes";
import IconProp from "Common/Types/Icon/IconProp";
import { JSONObject } from "Common/Types/JSON";
import NotificationRuleType from "Common/Types/NotificationRule/NotificationRuleType";
import ObjectID from "Common/Types/ObjectID";
import Permission from "Common/Types/Permission";
import ActionButtonSchema from "Common/UI/Components/ActionButton/ActionButtonSchema";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import Icon from "Common/UI/Components/Icon/Icon";
import ConfirmModal from "Common/UI/Components/Modal/ConfirmModal";
import { APP_API_URL } from "Common/UI/Config";
import API from "Common/UI/Utils/API/API";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import PermissionUtil from "Common/UI/Utils/Permission";
import ProjectUtil from "Common/UI/Utils/Project";
import UserUtil from "Common/UI/Utils/User";
import NotificationMethodUtil, {
  ColumnValueReader,
  NotificationMethodDisplayItem,
} from "Common/UI/Utils/NotificationMethodUtil";
import {
  ReadinessCoverageCellWire,
  ReadinessSummaryWire,
  ResponderSourceValue,
  UserReadinessWire,
  getCoverageCellLabel,
  getResponderSourceLabel,
  parseReadinessSummary,
} from "../OnCallPolicy/Readiness/ReadinessTypes";
import React, {
  FunctionComponent,
  ReactElement,
  useCallback,
  useEffect,
  useState,
} from "react";

export interface ComponentProps {
  item: BaseModel;
  modelType: DatabaseBaseModelType;
}

const NotificationMethodView: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const item: BaseModel = BaseModel.fromJSONObject(props.item, props.modelType);

  const displayItems: Array<NotificationMethodDisplayItem> =
    NotificationMethodUtil.getDisplayItems(item);

  return (
    <div>
      {displayItems.map((displayItem: NotificationMethodDisplayItem) => {
        return (
          <p key={displayItem.title}>
            {displayItem.title}: {displayItem.value}
          </p>
        );
      })}
    </div>
  );
};

export default NotificationMethodView;

/*
 * ============================================================================
 * DELETION IMPACT
 * ============================================================================
 *
 * Every notification method has `onDelete: "CASCADE"` on its foreign key from
 * UserNotificationRule, so deleting one email address silently destroys every
 * rule that pointed at it. The person doing the deleting is usually tidying up
 * an old phone number and has no idea that three severities just lost the only
 * rule they had - and nothing tells them, then or later.
 *
 * WHY THE NUMBERS ARE COMPUTED FROM THE USER'S OWN RULES rather than asked for.
 * "This may affect your on-call coverage" is a sentence that is true before
 * every delete and therefore carries no information; people learn to click
 * through it in a week. "Deleting this removes 3 notification rules and leaves
 * Incident - Sev1 and Alert - Sev2 with no rule" is a different kind of
 * sentence, and every number in it comes from rows the browser already has
 * permission to read - the caller's own notification rules, scoped server-side
 * by UserNotificationRule's `@CurrentUserCanAccessRecordBy("userId")`. There is
 * no round trip that can fail and leave the warning vague.
 *
 * WHERE THIS IS MOUNTED. At the moment of the delete and nowhere else.
 * DeletionImpactModal is the confirmation itself, and it replaces the generic
 * "are you sure" on all seven method tables - Email, SMS, Call, Push, WhatsApp,
 * Telegram and Webhook - each of which sets `isDeleteable={false}` and takes its
 * Delete action from useNotificationMethodDeleteGuard below. The shared
 * ModelTable confirmation takes a fixed description and so cannot carry any of
 * the numbers below, which is why the built-in delete is turned off rather than
 * decorated.
 *
 * A standing panel above the method tables used to say the same thing while
 * somebody was still just looking at the list. It was removed: it restated, on
 * every visit, what the confirmation already says at the one moment the person
 * can act on it, and a warning shown twice is a warning read once.
 *
 * WHAT DOES COME FROM THE SERVER, and what happens when it does not. "You are a
 * responder on N on-call policies" cannot be computed here: a user is an
 * effective responder through direct assignment, team membership, a schedule
 * layer or an override, and only the server resolves that set. So it is read
 * from the per-user readiness payload when that payload carries it, and the
 * sentence is OMITTED ENTIRELY when it does not. It is never rendered as "0
 * policies" - an undercount phrased as a fact is the most dangerous shape this
 * warning could take, because it reassures.
 */

/*
 * The relation names a rule can hang a notification method off, taken from the
 * shared util rather than restated. A second hardcoded list here is precisely
 * the drift NotificationMethodUtil was extracted to end: a method added there
 * and forgotten here would silently be a method whose deletion looks free.
 */
const METHOD_RELATION_NAMES: Array<string> = Object.keys(
  NotificationMethodUtil.getSelectForNotificationMethods<UserNotificationRule>(),
);

/*
 * Everything the impact maths needs from one rule, flattened.
 *
 * Read through ColumnValueReader (the interface a BaseModel already satisfies)
 * rather than typed model properties, so the same function serves a rule that
 * arrived as a model, a rule handed over by a table as JSON, and a fixture in a
 * test - without any of them having to construct a decorated entity.
 */
export interface NotificationRuleFacts {
  ruleId: string;
  ruleType: string;
  /* "" for the two lifecycle rule types, which carry no severity at all. */
  severityId: string;
  severityName: string;
  /* "" on an opt-out row, which by definition carries no method. */
  methodId: string;
  methodType: string;
  methodLabel: string;
  isOptOut: boolean;
}

/*
 * An id in any of the shapes a relation can arrive in: a hydrated model, the
 * `{ _id }` a table hands over, or ObjectID's own `{ value }` JSON envelope.
 * Guessing wrong here does not produce a wrong number, it produces no number at
 * all - a rule that appears to use no method - so all three are handled.
 */
const readEntityId: (value: unknown) => string = (value: unknown): string => {
  if (!value || typeof value !== "object") {
    return "";
  }

  const asRecord: Record<string, unknown> = value as Record<string, unknown>;

  const candidate: unknown =
    asRecord["_id"] ?? asRecord["id"] ?? asRecord["value"];

  if (candidate === null || candidate === undefined || candidate === "") {
    return "";
  }

  if (typeof candidate === "object") {
    return readEntityId(candidate);
  }

  return String(candidate);
};

/*
 * Which severity column scopes which rule type.
 *
 * This is the browser-side half of PAGING_RULE_TYPE_SCOPES in
 * UserNotificationRuleService, and it exists for the reason that file spells
 * out: at runtime an alert rule is only ever matched against an ALERT severity
 * id and an incident rule against an INCIDENT one, so the severity a rule
 * covers is the one in the column ITS RULE TYPE DICTATES - never "whichever of
 * the two columns happens to be populated".
 *
 * Reading it the loose way is not a cosmetic slip. A rule row can carry a
 * severity id in the column its type does not use (a stale write, a rule
 * retyped after the fact, the NULL-severity episode rows Gap G was about), and
 * a coverage cell built from that id claims an incident severity is covered by
 * a rule that can only ever fire for an alert. The whole point of this warning
 * is that its numbers can be trusted; a cell vouched for by a rule that cannot
 * fire for it is worse than no warning at all.
 *
 * The two handoff rule types are absent on purpose: they carry no severity, and
 * a missing entry here reads as "this rule type has no severity column".
 */
const SEVERITY_RELATION_BY_RULE_TYPE: Record<string, string> = {
  [NotificationRuleType.ON_CALL_EXECUTED_INCIDENT]: "incidentSeverity",
  [NotificationRuleType.ON_CALL_EXECUTED_INCIDENT_EPISODE]: "incidentSeverity",
  [NotificationRuleType.ON_CALL_EXECUTED_ALERT]: "alertSeverity",
  [NotificationRuleType.ON_CALL_EXECUTED_ALERT_EPISODE]: "alertSeverity",
};

const readEntityName: (value: unknown) => string = (value: unknown): string => {
  if (!value || typeof value !== "object") {
    return "";
  }

  const name: unknown = (value as Record<string, unknown>)["name"];

  return name === null || name === undefined ? "" : String(name);
};

export const readRuleFacts: (
  rule: ColumnValueReader,
) => NotificationRuleFacts = (
  rule: ColumnValueReader,
): NotificationRuleFacts => {
  const ruleTypeValue: unknown = rule.getColumnValue("ruleType");
  const ruleType: string =
    ruleTypeValue === null || ruleTypeValue === undefined
      ? ""
      : String(ruleTypeValue);

  /*
   * The rule type picks the column, and an unrecognised rule type picks
   * neither. A rule whose type this build has never heard of is read as
   * carrying no severity rather than as covering the first id we can find.
   */
  const severityRelationName: string | undefined =
    SEVERITY_RELATION_BY_RULE_TYPE[ruleType];

  const severity: unknown = severityRelationName
    ? rule.getColumnValue(severityRelationName)
    : null;

  const severityId: string = readEntityId(severity);
  const severityName: string = readEntityName(severity);

  let methodId: string = "";

  for (const relationName of METHOD_RELATION_NAMES) {
    const relationValue: unknown = rule.getColumnValue(relationName);
    const relationId: string = readEntityId(relationValue);

    if (relationId) {
      methodId = relationId;
      break;
    }
  }

  /*
   * The method's own words for itself ("Email", "jane@example.com") come from
   * the shared display helper, so the warning names the method exactly as the
   * table above it does. A person confirming a delete should not have to
   * translate between two spellings of the same thing.
   */
  const displayItems: Array<NotificationMethodDisplayItem> =
    NotificationMethodUtil.getDisplayItems(rule);
  const displayItem: NotificationMethodDisplayItem | undefined =
    displayItems[0];

  return {
    ruleId: readEntityId({ _id: rule.getColumnValue("_id") }),
    ruleType: ruleType,
    severityId: severityId,
    severityName: severityName,
    methodId: methodId,
    methodType: displayItem ? displayItem.title : "",
    methodLabel: displayItem
      ? `${displayItem.title}: ${displayItem.value}`
      : "",
    isOptOut: rule.getColumnValue("isOptOut") === true,
  };
};

/*
 * One (rule type, severity) cell of the user's coverage, and the rules that
 * currently deliver for it.
 *
 * An opt-out row is tracked separately from the delivering rules because it is
 * a rule that exists in order to send nothing: a cell the user has deliberately
 * muted must never produce a warning, or the product nags people for having
 * configured it correctly.
 */
export interface CoverageCell {
  key: string;
  ruleType: string;
  severityId: string;
  severityName: string;
  deliveringRuleIds: Array<string>;
  isOptOut: boolean;
}

export const getCellKey: (facts: NotificationRuleFacts) => string = (
  facts: NotificationRuleFacts,
): string => {
  return `${facts.ruleType}::${facts.severityId}`;
};

export const buildCoverageCells: (
  rules: Array<NotificationRuleFacts>,
) => Array<CoverageCell> = (
  rules: Array<NotificationRuleFacts>,
): Array<CoverageCell> => {
  const cells: Map<string, CoverageCell> = new Map<string, CoverageCell>();

  for (const facts of rules) {
    const key: string = getCellKey(facts);

    let cell: CoverageCell | undefined = cells.get(key);

    if (!cell) {
      cell = {
        key: key,
        ruleType: facts.ruleType,
        severityId: facts.severityId,
        severityName: facts.severityName,
        deliveringRuleIds: [],
        isOptOut: false,
      };
      cells.set(key, cell);
    }

    if (facts.isOptOut) {
      cell.isOptOut = true;
      continue;
    }

    if (facts.ruleId) {
      cell.deliveringRuleIds.push(facts.ruleId);
    }

    /*
     * The severity name can be absent on one row and present on another (a rule
     * fetched without the relation selected, say). Keeping the first non-empty
     * one means the cell can still be named in the copy.
     */
    if (!cell.severityName && facts.severityName) {
      cell.severityName = facts.severityName;
    }
  }

  return Array.from(cells.values());
};

// The label a cell wears in the copy: "Incident - Sev1", or "Goes on call".
export const getCellLabel: (cell: CoverageCell) => string = (
  cell: CoverageCell,
): string => {
  const wire: ReadinessCoverageCellWire = {
    ruleType: cell.ruleType as NotificationRuleType,
    severityId: cell.severityId || undefined,
    severityName: cell.severityName || undefined,
    hasRule: cell.deliveringRuleIds.length > 0,
    isOptOut: cell.isOptOut,
  };

  return getCoverageCellLabel(wire);
};

export interface DeletionImpact {
  /* Rules that this delete destroys. For a rule delete this is always 1. */
  ruleCount: number;
  /*
   * Cells that currently have at least one delivering rule and would have none
   * afterwards. Muted cells are excluded: silence there was the point.
   */
  orphanedCells: Array<CoverageCell>;
  /*
   * Cells that also lose their last delivering rule, but that the user has
   * muted with an opt-out row.
   *
   * These are NOT a warning - a cell somebody chose to silence stays silent and
   * nobody is worse off. They are tracked because the ABSENCE of a warning is
   * not the same fact as "something else still covers this", and the copy below
   * used to conflate the two. An opt-out is a rule that exists in order to
   * deliver nothing; treating it as cover is how a confirmation ends up
   * reassuring somebody that a severity is still handled when the only thing
   * left standing for it is deliberate silence.
   */
  mutedCells: Array<CoverageCell>;
}

/*
 * Every cell whose last delivering rule is in `doomedRuleIds`, split by whether
 * the user muted it.
 *
 * A cell with no delivering rule at all today is in neither list: this delete
 * is not what took its cover away.
 */
const getCellsLosingLastRule: (
  rules: Array<NotificationRuleFacts>,
  doomedRuleIds: Set<string>,
) => { orphanedCells: Array<CoverageCell>; mutedCells: Array<CoverageCell> } = (
  rules: Array<NotificationRuleFacts>,
  doomedRuleIds: Set<string>,
): { orphanedCells: Array<CoverageCell>; mutedCells: Array<CoverageCell> } => {
  const orphanedCells: Array<CoverageCell> = [];
  const mutedCells: Array<CoverageCell> = [];

  for (const cell of buildCoverageCells(rules)) {
    if (cell.deliveringRuleIds.length === 0) {
      continue;
    }

    const losesEveryRule: boolean = cell.deliveringRuleIds.every(
      (ruleId: string): boolean => {
        return doomedRuleIds.has(ruleId);
      },
    );

    if (!losesEveryRule) {
      continue;
    }

    if (cell.isOptOut) {
      mutedCells.push(cell);
      continue;
    }

    orphanedCells.push(cell);
  }

  return { orphanedCells: orphanedCells, mutedCells: mutedCells };
};

/*
 * What deleting one notification method costs. Every rule pointing at it goes
 * with it - that is the CASCADE on the foreign key, not a policy this file
 * chose - so the arithmetic is: which rules point here, and which cells does
 * that empty out.
 */
export const computeMethodDeletionImpact: (params: {
  rules: Array<NotificationRuleFacts>;
  methodId: string;
}) => DeletionImpact = (params: {
  rules: Array<NotificationRuleFacts>;
  methodId: string;
}): DeletionImpact => {
  const doomedRuleIds: Set<string> = new Set<string>(
    params.rules
      .filter((facts: NotificationRuleFacts): boolean => {
        return Boolean(params.methodId) && facts.methodId === params.methodId;
      })
      .map((facts: NotificationRuleFacts): string => {
        return facts.ruleId;
      }),
  );

  return {
    ruleCount: doomedRuleIds.size,
    ...getCellsLosingLastRule(params.rules, doomedRuleIds),
  };
};

/*
 * What deleting one rule costs. Narrower than a method delete and far easier to
 * do by accident: a user tidying a rule list has no way of knowing which of
 * them is the last one standing for a severity.
 */
export const computeRuleDeletionImpact: (params: {
  rules: Array<NotificationRuleFacts>;
  ruleId: string;
}) => DeletionImpact = (params: {
  rules: Array<NotificationRuleFacts>;
  ruleId: string;
}): DeletionImpact => {
  const doomedRuleIds: Set<string> = new Set<string>(
    params.rules
      .filter((facts: NotificationRuleFacts): boolean => {
        return Boolean(params.ruleId) && facts.ruleId === params.ruleId;
      })
      .map((facts: NotificationRuleFacts): string => {
        return facts.ruleId;
      }),
  );

  return {
    ruleCount: doomedRuleIds.size,
    ...getCellsLosingLastRule(params.rules, doomedRuleIds),
  };
};

/*
 * Whether anybody is relying on this person answering a page, and through which
 * door.
 *
 * "unknown" is a state and not a false. A user reaches on-call duty through four
 * different mechanisms - named on a rule, a member of a team that is, a layer of
 * a schedule, an override - and only the server resolves that set. If it did not
 * answer, this surface has not learnt that the stakes are low; it has learnt
 * nothing, and the sentence is dropped rather than softened into a reassuring
 * one.
 */
export interface OnCallExposure {
  isKnown: boolean;
  isOnCallResponder: boolean;
  sources: Array<ResponderSourceValue>;
}

export const UNKNOWN_ON_CALL_EXPOSURE: OnCallExposure = {
  isKnown: false,
  isOnCallResponder: false,
  sources: [],
};

/*
 * Reads exposure out of the per-user readiness payload.
 *
 * `reachedVia` is the field, and it is already on the wire: the readiness
 * service resolves the project's whole responder set to fill it, and reports an
 * empty array for a user no policy reaches. Deriving the sentence from it rather
 * than from a count of policies means this warning and the readiness page cannot
 * end up disagreeing about whether somebody is on call - which of the two an
 * admin would believe is not a question worth creating.
 *
 * The one-row wrapper around the summary parser is the same trick the
 * add-responder warning uses, and for the same reason: ReadinessTypes owns the
 * reading of this payload, and a second hand-rolled reader of it is how the two
 * drift apart.
 */
export const parseOnCallExposure: (json: JSONObject) => OnCallExposure = (
  json: JSONObject,
): OnCallExposure => {
  const summary: ReadinessSummaryWire = parseReadinessSummary({
    users: [json],
  } as JSONObject);

  const readiness: UserReadinessWire | undefined = summary.users[0];

  if (!readiness || !readiness.userId) {
    return UNKNOWN_ON_CALL_EXPOSURE;
  }

  return {
    isKnown: true,
    isOnCallResponder: readiness.reachedVia.length > 0,
    sources: readiness.reachedVia,
  };
};

const joinWithAnd: (items: Array<string>) => string = (
  items: Array<string>,
): string => {
  if (items.length === 0) {
    return "";
  }

  if (items.length === 1) {
    return items[0]!;
  }

  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
};

/*
 * "You are an on-call responder in this project, reached through a team." - or
 * nothing at all when the server did not say.
 *
 * The doors are named because they are what makes the sentence surprising, and
 * surprise is the whole job of this line. Plenty of people do not think of
 * themselves as on call: they were added to a team once, and the on-call duty
 * arrived with it.
 */
export const describeOnCallExposure: (exposure: OnCallExposure) => string = (
  exposure: OnCallExposure,
): string => {
  if (!exposure.isKnown) {
    return "";
  }

  if (!exposure.isOnCallResponder) {
    return "You are not currently a responder on any on-call policy in this project.";
  }

  const doors: string = joinWithAnd(
    exposure.sources.map((source: ResponderSourceValue): string => {
      return getResponderSourceLabel(source);
    }),
  );

  if (!doors) {
    return "You are an on-call responder in this project.";
  }

  return `You are an on-call responder in this project, reached through ${doors}.`;
};

const describeCells: (cells: Array<CoverageCell>) => string = (
  cells: Array<CoverageCell>,
): string => {
  if (cells.length === 0) {
    return "";
  }

  return joinWithAnd(
    cells.map((cell: CoverageCell): string => {
      return getCellLabel(cell);
    }),
  );
};

const describeOrphanedCells: (impact: DeletionImpact) => string = (
  impact: DeletionImpact,
): string => {
  return describeCells(impact.orphanedCells);
};

/*
 * The confirmation copy for deleting a notification method.
 *
 * Written as facts in descending order of how much they should change the
 * reader's mind: how exposed they are, what disappears, and what stops being
 * covered. When nothing depends on the method the copy says so plainly - a
 * warning that fires on a harmless delete is how the warning that matters gets
 * ignored.
 */
export const describeMethodDeletion: (params: {
  methodLabel: string;
  impact: DeletionImpact;
  exposure: OnCallExposure;
}) => string = (params: {
  methodLabel: string;
  impact: DeletionImpact;
  exposure: OnCallExposure;
}): string => {
  const sentences: Array<string> = [];
  const exposureSentence: string = describeOnCallExposure(params.exposure);

  if (exposureSentence) {
    sentences.push(exposureSentence);
  }

  if (params.impact.ruleCount === 0) {
    sentences.push(
      `No notification rules use ${params.methodLabel}, so deleting it does not change how you are paged.`,
    );

    return sentences.join(" ");
  }

  const orphaned: string = describeOrphanedCells(params.impact);
  const ruleWords: string = `${params.impact.ruleCount} notification ${
    params.impact.ruleCount === 1 ? "rule" : "rules"
  }`;

  if (orphaned) {
    sentences.push(
      `Deleting ${params.methodLabel} removes ${ruleWords} and leaves ${orphaned} with no rule.`,
    );
  } else {
    sentences.push(`Deleting ${params.methodLabel} removes ${ruleWords}.`);
  }

  return sentences.join(" ");
};

/*
 * The confirmation copy for deleting a single notification rule. The only
 * question worth answering is whether this rule is the last one covering its
 * cell, because that is the delete that turns a covered severity into a silent
 * one.
 *
 * THE "NO GAP" SENTENCE IS A CLAIM, and it is only made when it has been
 * earned. There are three ways for orphanedCells to come back empty and only
 * one of them means somebody else is still covering this:
 *
 *   - other rules deliver for the cell     -> "other rules still cover this";
 *   - the cell is muted by an opt-out row  -> nothing delivers for it afterwards
 *     and nothing was ever going to, which is a fact worth stating plainly
 *     rather than dressing up as coverage. An opt-out is deliberate silence;
 *     reading it as cover is how a confirmation reassures somebody about a
 *     severity that nothing will page for;
 *   - the rule is not among the ones we loaded -> we do not know, and saying so
 *     is the only honest answer. Claiming "no gap" about a rule we could not
 *     find is a guess with a confident sentence wrapped around it.
 */
export const describeRuleDeletion: (params: {
  impact: DeletionImpact;
  exposure: OnCallExposure;
}) => string = (params: {
  impact: DeletionImpact;
  exposure: OnCallExposure;
}): string => {
  const sentences: Array<string> = [];
  const exposureSentence: string = describeOnCallExposure(params.exposure);

  if (exposureSentence) {
    sentences.push(exposureSentence);
  }

  const orphaned: string = describeOrphanedCells(params.impact);

  if (orphaned) {
    sentences.push(
      `This is the last rule covering ${orphaned}. Deleting it leaves ${
        params.impact.orphanedCells.length === 1 ? "that" : "those"
      } with no rule.`,
    );

    return sentences.join(" ");
  }

  const muted: string = describeCells(params.impact.mutedCells);

  if (muted) {
    sentences.push(
      params.impact.mutedCells.length === 1
        ? `This is the last rule that delivers for ${muted}. The only rule left for it is an opt-out, so nothing will be sent for it once this is gone.`
        : `This is the last rule that delivers for ${muted}. The only rules left for them are opt-outs, so nothing will be sent for them once this is gone.`,
    );

    return sentences.join(" ");
  }

  if (params.impact.ruleCount === 0) {
    sentences.push(
      "We could not match this rule to your notification rules, so we cannot tell what deleting it leaves uncovered.",
    );

    return sentences.join(" ");
  }

  sentences.push(
    "Other rules still cover this severity and rule type, so deleting this one does not leave a gap.",
  );

  return sentences.join(" ");
};

/*
 * The select the impact maths needs.
 *
 * Derived from the shared method select rather than restated, with `_id` added
 * to every relation: the display columns alone say WHICH KIND of method a rule
 * uses but not WHICH ONE, and the whole calculation turns on matching a rule to
 * the exact method being deleted.
 */
export const getSelectForRuleImpact: () => Select<UserNotificationRule> =
  (): Select<UserNotificationRule> => {
    const methodSelect: Record<
      string,
      Record<string, boolean>
    > = NotificationMethodUtil.getSelectForNotificationMethods<UserNotificationRule>() as Record<
      string,
      Record<string, boolean>
    >;

    const select: Record<string, unknown> = {
      _id: true,
      ruleType: true,
      isOptOut: true,
      incidentSeverity: { _id: true, name: true },
      alertSeverity: { _id: true, name: true },
    };

    for (const relationName of Object.keys(methodSelect)) {
      select[relationName] = {
        ...methodSelect[relationName],
        _id: true,
      };
    }

    return select as Select<UserNotificationRule>;
  };

export interface NotificationRuleLoadState {
  isLoading: boolean;
  /* Set when the rules could not be read. The copy must then say so. */
  error: string;
  rules: Array<NotificationRuleFacts>;
  exposure: OnCallExposure;
}

/*
 * Loads everything the warnings need for one user: their notification rules
 * (for the counts) and their on-call exposure (for the stakes).
 *
 * The two are loaded independently and a failure of the second does not fail
 * the first. They answer different questions, and losing the policy count is a
 * quieter warning whereas losing the rules is no warning at all.
 */
export const useNotificationRuleImpactData: (params: {
  userId: ObjectID | null;
  projectId: ObjectID | null;
}) => NotificationRuleLoadState = (params: {
  userId: ObjectID | null;
  projectId: ObjectID | null;
}): NotificationRuleLoadState => {
  const userIdString: string = params.userId?.toString() || "";
  const projectIdString: string = params.projectId?.toString() || "";

  const [isLoading, setIsLoading] = useState<boolean>(
    Boolean(userIdString && projectIdString),
  );
  const [error, setError] = useState<string>("");
  const [rules, setRules] = useState<Array<NotificationRuleFacts>>([]);
  const [exposure, setExposure] = useState<OnCallExposure>(
    UNKNOWN_ON_CALL_EXPOSURE,
  );

  const load: () => Promise<void> = useCallback(async (): Promise<void> => {
    if (!userIdString || !projectIdString) {
      return;
    }

    setIsLoading(true);
    setError("");

    try {
      const result: ListResult<UserNotificationRule> =
        await ModelAPI.getList<UserNotificationRule>({
          modelType: UserNotificationRule,
          /*
           * `userId` here is a filter, not the access control. Row scoping for
           * this model comes from its table-level rules and
           * `@CurrentUserCanAccessRecordBy("userId")`; a column permission could
           * never restrict which ROWS come back, whatever it lists.
           */
          query: {
            projectId: params.projectId!,
            userId: params.userId!,
          },
          limit: LIMIT_PER_PROJECT,
          skip: 0,
          select: getSelectForRuleImpact(),
          sort: {
            createdAt: SortOrder.Ascending,
          },
        });

      setRules(
        result.data.map((rule: UserNotificationRule): NotificationRuleFacts => {
          return readRuleFacts(rule);
        }),
      );
    } catch (err) {
      setError(API.getFriendlyMessage(err));
      setRules([]);
    }

    try {
      const url: URL = URL.fromString(APP_API_URL.toString()).addRoute(
        `/on-call-readiness/user/${userIdString}`,
      );

      const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
        await API.get<JSONObject>({
          url: url,
          headers: ModelAPI.getCommonHeaders(),
        });

      if (response instanceof HTTPErrorResponse) {
        throw response;
      }

      setExposure(parseOnCallExposure(response.data));
    } catch {
      /*
       * Deliberately swallowed into "unknown". The policy sentence is the
       * optional half of this warning; the counts below it are the half that
       * has to be right, and they do not depend on this call.
       */
      setExposure(UNKNOWN_ON_CALL_EXPOSURE);
    }

    setIsLoading(false);
  }, [userIdString, projectIdString]);

  useEffect(() => {
    load().catch(() => {
      /* load() routes every failure it cares about into state. */
    });
  }, [load]);

  return {
    isLoading: isLoading,
    error: error,
    rules: rules,
    exposure: exposure,
  };
};

/*
 * What is about to be deleted. A method takes the whole cascade with it; a rule
 * takes only itself. They are different sentences, so they are different cases
 * rather than one function with a boolean.
 */
export type DeletionTarget =
  | { type: "method"; methodId: string; methodLabel: string }
  | { type: "rule"; ruleId: string };

export interface DeletionImpactModalProps {
  target: DeletionTarget;
  userId: ObjectID | null;
  projectId: ObjectID | null;
  title: string;
  submitButtonText: string;
  isDeleting?: boolean | undefined;
  /* The delete itself failing. Shown without taking the counts away. */
  error?: string | undefined;
  onClose: () => void;
  onConfirm: () => void;
}

/*
 * The confirmation itself: a drop-in replacement for the generic "are you sure"
 * that a delete action opens today.
 *
 * It is a CONFIRMATION AND NOT A GATE. Deleting an old phone number that three
 * rules point at is a perfectly reasonable thing to do; the person just has to
 * know that is what they are doing. The one moment the submit button is held is
 * while the counts are still loading, because a confirmation that resolves
 * before its own explanation arrives is the same as no explanation - and that
 * hold ends the instant the answer lands, including when the answer is that we
 * could not work it out.
 */
export const DeletionImpactModal: FunctionComponent<
  DeletionImpactModalProps
> = (props: DeletionImpactModalProps): ReactElement => {
  const state: NotificationRuleLoadState = useNotificationRuleImpactData({
    userId: props.userId,
    projectId: props.projectId,
  });

  const impact: DeletionImpact =
    props.target.type === "method"
      ? computeMethodDeletionImpact({
          rules: state.rules,
          methodId: props.target.methodId,
        })
      : computeRuleDeletionImpact({
          rules: state.rules,
          ruleId: props.target.ruleId,
        });

  const getDescription: () => string = (): string => {
    if (state.isLoading) {
      return "Checking what this deletes...";
    }

    if (state.error) {
      /*
       * Honest rather than reassuring. We know a delete is about to happen and
       * we do not know what it costs, and saying nothing would let the generic
       * "are you sure" imply we had checked.
       */
      return `We could not check what this deletes: ${state.error} Deleting a notification method also deletes every notification rule that uses it.`;
    }

    if (props.target.type === "method") {
      return describeMethodDeletion({
        methodLabel: props.target.methodLabel,
        impact: impact,
        exposure: state.exposure,
      });
    }

    return describeRuleDeletion({
      impact: impact,
      exposure: state.exposure,
    });
  };

  const getDetail: () => ReactElement = (): ReactElement => {
    if (state.isLoading || state.error || impact.orphanedCells.length === 0) {
      return <></>;
    }

    /*
     * The cells are listed as well as counted. "2 severities" is a number
     * somebody has to translate before they can decide; the names are the thing
     * they actually recognise.
     */
    return (
      <div
        data-testid="deletion-impact-cells"
        className="mt-3 rounded-lg bg-amber-50 px-3 py-2.5 ring-1 ring-inset ring-amber-200"
      >
        <div className="flex items-start gap-2">
          <Icon
            icon={IconProp.Alert}
            className="mt-0.5 h-4 w-4 shrink-0 text-amber-500"
          />
          <div>
            <p className="text-sm font-semibold text-amber-800">
              Left with no notification rule
            </p>
            <ul className="mt-1 space-y-0.5">
              {impact.orphanedCells.map((cell: CoverageCell): ReactElement => {
                return (
                  <li key={cell.key} className="text-sm text-amber-700">
                    {getCellLabel(cell)}
                  </li>
                );
              })}
            </ul>
          </div>
        </div>
      </div>
    );
  };

  return (
    <ConfirmModal
      title={props.title}
      description={getDescription()}
      submitButtonText={props.submitButtonText}
      submitButtonType={ButtonStyleType.DANGER}
      closeButtonText="Cancel"
      isLoading={props.isDeleting === true}
      error={props.error}
      disableSubmitButton={state.isLoading}
      onSubmit={props.onConfirm}
      onClose={props.onClose}
    >
      {getDetail()}
    </ConfirmModal>
  );
};

/*
 * ============================================================================
 * MOUNTING THE MODAL ON A METHOD TABLE
 * ============================================================================
 *
 * ModelTable's built-in delete (`isDeleteable`) opens a confirmation whose
 * description is a fixed string - "Are you sure you want to delete this user
 * email?" - and there is no seam that lets a caller change it. `onBeforeDelete`
 * runs BEFORE that modal and cannot replace it; it transforms the item and the
 * generic confirmation opens regardless. So the built-in delete is switched OFF
 * on every method table and this action button takes its place, which is the
 * one arrangement where the modal below is guaranteed to be what a delete goes
 * through. `isDeleteable={true}` next to an impact modal nobody opens is
 * exactly the failure this replaces.
 *
 * The button repeats ModelTable's own permission test rather than trusting the
 * table to have hidden the row: an action button is rendered for everyone, and
 * a Delete control that 403s on click is worse than no control.
 */

/*
 * The id of the method row a table handed us, whether it arrived as a hydrated
 * model (`id`, an ObjectID) or as the JSON a table row carries (`_id`).
 */
export const readNotificationMethodId: (item: unknown) => string = (
  item: unknown,
): string => {
  if (!item || typeof item !== "object") {
    return "";
  }

  const asRecord: Record<string, unknown> = item as Record<string, unknown>;

  return readEntityId({ _id: asRecord["_id"] ?? asRecord["id"] });
};

/*
 * "Email: jane@example.com" for the method row being deleted.
 *
 * Built through the same shared display helper the rules use, by presenting the
 * row as though it were the relation it hangs off. That is what makes the
 * confirmation name the method with the same words as the rule table above it -
 * a person confirming a delete should not have to translate between two
 * spellings of one thing - and it is why adding a method to
 * NotificationMethodUtil is still a one-place change.
 */
export const getNotificationMethodLabel: (params: {
  relationName: string;
  item: unknown;
  fallbackLabel: string;
}) => string = (params: {
  relationName: string;
  item: unknown;
  fallbackLabel: string;
}): string => {
  const displayItems: Array<NotificationMethodDisplayItem> =
    NotificationMethodUtil.getDisplayItems({
      getColumnValue: (columnName: string): unknown => {
        return columnName === params.relationName ? params.item : null;
      },
    });

  const displayItem: NotificationMethodDisplayItem | undefined =
    displayItems[0];

  if (!displayItem || !displayItem.value) {
    /*
     * A row with nothing to name itself with - a push device registered without
     * a name, say. The fallback is the method's own noun, so the sentence still
     * reads as English instead of "Deleting  removes 2 notification rules".
     */
    return params.fallbackLabel;
  }

  return `${displayItem.title}: ${displayItem.value}`;
};

export interface NotificationMethodDeleteGuardParams<
  TBaseModel extends BaseModel,
> {
  modelType: { new (): TBaseModel };
  /* The relation on UserNotificationRule that points at this model. */
  relationName: string;
  /* "Email", "Phone Number", "Device" - the noun in the modal title. */
  singularName: string;
  /* Bumped once a delete lands, so the table refetches. */
  onDeleted: () => void;
}

export interface NotificationMethodDeleteGuard<TBaseModel extends BaseModel> {
  /* Hand to ModelTable's `actionButtons`, alongside isDeleteable={false}. */
  deleteActionButton: ActionButtonSchema<TBaseModel>;
  /* Render next to the table. Empty until a delete is actually asked for. */
  deletionModal: ReactElement;
}

type CanDeleteFunction = <TBaseModel extends BaseModel>(modelType: {
  new (): TBaseModel;
}) => boolean;

const canDeleteModel: CanDeleteFunction = <
  TBaseModel extends BaseModel,
>(modelType: {
  new (): TBaseModel;
}): boolean => {
  if (UserUtil.isMasterAdmin()) {
    return true;
  }

  const permissions: Array<Permission> = PermissionUtil.getAllPermissions();

  return new modelType().hasDeletePermissions(permissions);
};

export function useNotificationMethodDeleteGuard<TBaseModel extends BaseModel>(
  params: NotificationMethodDeleteGuardParams<TBaseModel>,
): NotificationMethodDeleteGuard<TBaseModel> {
  const [itemToDelete, setItemToDelete] = useState<TBaseModel | null>(null);
  const [isDeleting, setIsDeleting] = useState<boolean>(false);
  const [deleteError, setDeleteError] = useState<string>("");

  const closeModal: () => void = (): void => {
    setItemToDelete(null);
    setDeleteError("");
  };

  const confirmDelete: () => Promise<void> = async (): Promise<void> => {
    if (!itemToDelete) {
      return;
    }

    const methodId: string = readNotificationMethodId(itemToDelete);

    if (!methodId) {
      setDeleteError(
        `This ${params.singularName.toLowerCase()} could not be identified, so it was not deleted. Please refresh and try again.`,
      );
      return;
    }

    setIsDeleting(true);
    setDeleteError("");

    try {
      await ModelAPI.deleteItem<TBaseModel>({
        modelType: params.modelType,
        id: new ObjectID(methodId),
      });

      setIsDeleting(false);
      setItemToDelete(null);
      params.onDeleted();
    } catch (err) {
      /*
       * The modal stays open on failure. Closing it would leave the row on
       * screen with no explanation of why it is still there.
       */
      setIsDeleting(false);
      setDeleteError(API.getFriendlyMessage(err));
    }
  };

  const deleteActionButton: ActionButtonSchema<TBaseModel> = {
    title: "Delete",
    icon: IconProp.Trash,
    buttonStyleType: ButtonStyleType.DANGER_OUTLINE,
    isVisible: (): boolean => {
      return canDeleteModel<TBaseModel>(params.modelType);
    },
    onClick: (
      item: TBaseModel,
      onCompleteAction: VoidFunction,
      onError: ErrorFunction,
    ): void => {
      try {
        setDeleteError("");
        setItemToDelete(item);
        onCompleteAction();
      } catch (err) {
        onCompleteAction();
        onError(err as Error);
      }
    },
  };

  const deletionModal: ReactElement = itemToDelete ? (
    <DeletionImpactModal
      target={{
        type: "method",
        methodId: readNotificationMethodId(itemToDelete),
        methodLabel: getNotificationMethodLabel({
          relationName: params.relationName,
          item: itemToDelete,
          fallbackLabel: `this ${params.singularName.toLowerCase()}`,
        }),
      }}
      userId={UserUtil.getUserId()}
      projectId={ProjectUtil.getCurrentProjectId()}
      title={`Delete ${params.singularName}`}
      submitButtonText="Delete"
      isDeleting={isDeleting}
      error={deleteError}
      onClose={closeModal}
      onConfirm={() => {
        confirmDelete().catch(() => {
          /* confirmDelete routes every failure it cares about into state. */
        });
      }}
    />
  ) : (
    <></>
  );

  return {
    deleteActionButton: deleteActionButton,
    deletionModal: deletionModal,
  };
}

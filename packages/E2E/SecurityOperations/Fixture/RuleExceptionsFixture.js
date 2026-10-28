/*
 * Detection rule exceptions and Run on Past Events on the fixture's
 * synthetic month: the exceptions Security Events > Rule Exceptions lists
 * (and a rule's count, View Exceptions and a case's Add Exception read),
 * and what POST /detection-rule/retrohunt answers for a rule - a saved one
 * by its id, or the rule as a form holds it.
 *
 * The exceptions, every state a row can be in:
 *
 *   Brute force from one IP address (rule 1)
 *     10.20.0.0/16       the vulnerability scanners' range, Maya, no expiry
 *     svc-backup         the backup job's account, Diego, until in 30 days
 *     tomorrow 09-13     the red team exercise's window, Priya: upcoming
 *   Password spraying (rule 2)
 *     processName backup.exe   Sam, expired two days ago
 *   Repeated failed sign-ins for one account (rule 3)
 *     last week's window       the penetration test, Maya: ended
 *   MFA push fatigue (rule 4)
 *     *.lab.acme-commerce.example   added through the API, no expiry
 *
 * So rule 1 has 2 active exceptions (the window is not under way yet), and
 * rules 2 and 3 none.
 *
 * Run on Past Events answers what the server's statement would, for the
 * week by default (fewer firings over a day, more over a month), with the
 * rule's exceptions when it is a saved rule that has active ones. A
 * correlation's YAML is answered as one: groups it would have matched,
 * each with what happened. ?retrohunt= picks another answer:
 *
 *   quiet  it would not have fired: 12 matching events, none in one run
 *          reaching the rule's threshold
 *   noisy  1,680 firings in the week for 64 addresses, the 50 that fired
 *          most listed: more than a person can look at
 *   fail   the YAML is refused (a 400), as a save refuses it
 */
import DetectionRule from "Common/Models/DatabaseModels/DetectionRule";
import DetectionRuleException from "Common/Models/DatabaseModels/DetectionRuleException";
import { SecurityEntityType } from "Common/Types/SecurityCase/SecurityEntity";
import {
  DETECTION_RETROHUNT_DEFAULT_PERIOD_IN_HOURS,
  DETECTION_RETROHUNT_MAX_GROUPS,
  detectionRetrohuntResultToJSON,
} from "Common/Types/SecurityEvent/DetectionRetrohunt";
import {
  DetectionRuleExceptionKind,
  DetectionRuleExceptionStatus,
  getDetectionRuleExceptionStatus,
} from "Common/Types/SecurityEvent/DetectionRuleException";

export const RETROHUNT_SCENARIOS = ["quiet", "noisy", "fail"];

export const RETROHUNT_FAIL_MESSAGE =
  'Unsupported Sigma modifier "nosuch" on field "statusName".';

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

// The addresses a rule fires for in the default answer, the busiest first.
const FIRED_FOR = [
  ["203.0.113.47", 30, 900],
  ["198.51.100.23", 10, 250],
  ["192.0.2.15", 2, 54],
];

export function createRuleExceptionsFixture(options) {
  const { insert, table, ID, ago, now, people, isEmpty, scenario } = options;

  function seed() {
    if (isEmpty) {
      return;
    }

    insert(DetectionRuleException, {
      _id: ID.exception(1),
      detectionRuleId: ID.rule(1),
      kind: DetectionRuleExceptionKind.Entity,
      entityType: SecurityEntityType.IpAddress,
      value: "10.20.0.0/16",
      reason:
        "Our vulnerability scanners. They probe every host on the network each night.",
      createdByUserId: people.maya._id,
      createdAt: ago(20 * DAY),
    });
    insert(DetectionRuleException, {
      _id: ID.exception(2),
      detectionRuleId: ID.rule(1),
      kind: DetectionRuleExceptionKind.Entity,
      entityType: SecurityEntityType.User,
      value: "svc-backup",
      reason: "The nightly backup job signs in from every host.",
      expiresAt: new Date(now.getTime() + 30 * DAY),
      createdByUserId: people.diego._id,
      createdAt: ago(6 * DAY),
    });
    insert(DetectionRuleException, {
      _id: ID.exception(3),
      detectionRuleId: ID.rule(1),
      kind: DetectionRuleExceptionKind.TimeWindow,
      startsAt: new Date(now.getTime() + 21 * HOUR),
      endsAt: new Date(now.getTime() + 25 * HOUR),
      reason: "The red team exercise. Scheduled with the CISO.",
      createdByUserId: people.priya._id,
      createdAt: ago(2 * DAY),
    });
    insert(DetectionRuleException, {
      _id: ID.exception(4),
      detectionRuleId: ID.rule(2),
      kind: DetectionRuleExceptionKind.Value,
      fieldName: "processName",
      value: "backup.exe",
      reason: "The old backup agent, while it was being replaced.",
      expiresAt: ago(2 * DAY),
      createdByUserId: people.sam._id,
      createdAt: ago(25 * DAY),
    });
    insert(DetectionRuleException, {
      _id: ID.exception(5),
      detectionRuleId: ID.rule(3),
      kind: DetectionRuleExceptionKind.TimeWindow,
      startsAt: ago(8 * DAY),
      endsAt: ago(8 * DAY - 4 * HOUR),
      reason: "The yearly penetration test by an outside firm.",
      createdByUserId: people.maya._id,
      createdAt: ago(10 * DAY),
    });
    insert(DetectionRuleException, {
      _id: ID.exception(6),
      detectionRuleId: ID.rule(4),
      kind: DetectionRuleExceptionKind.Entity,
      entityType: SecurityEntityType.Host,
      value: "*.lab.acme-commerce.example",
      reason: "Lab hosts are wiped every night.",
      createdAt: ago(40 * DAY),
    });
  }

  // A row as the list reads it: its rule and who added it, joined.
  function withRelations(record) {
    const ruleId = String(
      record.detectionRuleId || record.detectionRule?._id || "",
    );
    const rule = table(DetectionRule).find((item) => {
      return String(item._id) === ruleId;
    });
    const person = Object.values(people).find((member) => {
      return String(member._id) === String(record.createdByUserId || "");
    });

    return {
      ...record,
      detectionRuleId: ruleId || undefined,
      detectionRule: rule
        ? Object.assign(new DetectionRule(), { _id: rule._id, name: rule.name })
        : undefined,
      createdByUser: person,
    };
  }

  // A saved rule's exceptions that skip something now.
  function activeExceptions(ruleId) {
    return table(DetectionRuleException).filter((record) => {
      return (
        String(record.detectionRuleId || record.detectionRule?._id || "") ===
          String(ruleId) &&
        getDetectionRuleExceptionStatus(record, now) ===
          DetectionRuleExceptionStatus.Active
      );
    });
  }

  function ruleOf(body) {
    return table(DetectionRule).find((item) => {
      return String(item._id) === String(body.detectionRuleId || "");
    });
  }

  function group(value, firedCount, eventCount, entityType) {
    return {
      value,
      entityType,
      firedCount,
      eventCount,
      firstFiredAt: new Date(now.getTime() - 6 * DAY),
      lastFiredAt: new Date(now.getTime() - 2 * HOUR),
      sampleMessage: `Failed sign-in from ${value}`,
      summary: "",
    };
  }

  /*
   * POST /detection-rule/retrohunt: { status, body }, as the server would
   * answer the rule asked about.
   */
  function retrohunt(body) {
    const request = body || {};

    if (scenario === "fail") {
      return { status: 400, body: { message: RETROHUNT_FAIL_MESSAGE } };
    }

    const periodInHours = Number(
      request.periodInHours || DETECTION_RETROHUNT_DEFAULT_PERIOD_IN_HOURS,
    );
    const scale = periodInHours / DETECTION_RETROHUNT_DEFAULT_PERIOD_IN_HOURS;
    const rule = ruleOf(request);
    const yaml = String(request.sigmaRuleYaml || rule?.sigmaRuleYaml || "");
    const threshold = Number(
      request.matchCountThreshold || rule?.matchCountThreshold || 1,
    );
    const startTime = new Date(now.getTime() - periodInHours * HOUR);
    const exceptionCount = rule ? activeExceptions(rule._id).length : 0;

    const base = {
      startTime,
      endTime: now,
      periodInHours,
      isCorrelation: false,
      windowInMinutes: Number(
        request.evaluationIntervalInMinutes ||
          rule?.evaluationIntervalInMinutes ||
          5,
      ),
      threshold,
      exceptionCount,
      skippedEventCount: exceptionCount > 0 ? Math.round(310 * scale) : 0,
      preventedFiredCount: exceptionCount > 0 ? Math.round(12 * scale) : 0,
      hasMoreGroups: false,
      candidateLimit: null,
    };

    if (yaml.includes("correlation:")) {
      return {
        status: 200,
        body: detectionRetrohuntResultToJSON({
          ...base,
          isCorrelation: true,
          windowInMinutes: 0,
          threshold: null,
          firedCount: 1,
          groupCount: 1,
          eventCount: 11,
          matchedEventCount: null,
          skippedEventCount: null,
          preventedFiredCount: null,
          groups: [
            {
              ...group("203.0.113.47", 1, 11, SecurityEntityType.IpAddress),
              firstFiredAt: null,
              lastFiredAt: null,
              summary:
                "Ten failed sign-ins, then Successful sign-in, 4 minutes apart",
            },
          ],
        }),
      };
    }

    if (scenario === "quiet") {
      return {
        status: 200,
        body: detectionRetrohuntResultToJSON({
          ...base,
          threshold: Math.max(threshold, 5),
          firedCount: 0,
          groupCount: 0,
          eventCount: 0,
          matchedEventCount: 12,
          groups: [],
        }),
      };
    }

    if (scenario === "noisy") {
      const groups = [];

      for (let index = 0; index < DETECTION_RETROHUNT_MAX_GROUPS; index++) {
        groups.push(
          group(
            `198.51.100.${index + 1}`,
            Math.max(1, 80 - index),
            Math.max(3, 80 - index) * 12,
            SecurityEntityType.IpAddress,
          ),
        );
      }

      return {
        status: 200,
        body: detectionRetrohuntResultToJSON({
          ...base,
          firedCount: Math.round(1680 * scale),
          groupCount: 64,
          eventCount: Math.round(20160 * scale),
          matchedEventCount: Math.round(22000 * scale),
          groups,
          hasMoreGroups: true,
        }),
      };
    }

    const groups = FIRED_FOR.map(([value, fired, events]) => {
      return group(
        value,
        Math.max(1, Math.round(fired * scale)),
        Math.max(1, Math.round(events * scale)),
        SecurityEntityType.IpAddress,
      );
    });

    return {
      status: 200,
      body: detectionRetrohuntResultToJSON({
        ...base,
        firedCount: groups.reduce((sum, item) => {
          return sum + item.firedCount;
        }, 0),
        groupCount: groups.length,
        eventCount: groups.reduce((sum, item) => {
          return sum + item.eventCount;
        }, 0),
        matchedEventCount: Math.round(1204 * scale),
        groups,
      }),
    };
  }

  return { seed, withRelations, retrohunt };
}

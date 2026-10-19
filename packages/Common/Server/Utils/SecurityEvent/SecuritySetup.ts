import SecurityEvent from "../../../Models/AnalyticsModels/SecurityEvent";
import DetectionRule from "../../../Models/DatabaseModels/DetectionRule";
import SecurityCase from "../../../Models/DatabaseModels/SecurityCase";
import SecurityLogSource from "../../../Models/DatabaseModels/SecurityLogSource";
import SecurityPlaybook from "../../../Models/DatabaseModels/SecurityPlaybook";
import GreaterThan from "../../../Types/BaseDatabase/GreaterThan";
import Includes from "../../../Types/BaseDatabase/Includes";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import { LIMIT_PER_PROJECT } from "../../../Types/Database/LimitMax";
import OneUptimeDate from "../../../Types/Date";
import BadDataException from "../../../Types/Exception/BadDataException";
import { JSONArray, JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import { OPEN_SECURITY_CASE_STATUSES } from "../../../Types/SecurityCase/SecurityCaseStatus";
import {
  DetectionRuleLibraryEntry,
  SETUP_TEST_DETECTION_RULE_ID,
  getDetectionRuleLibraryEntry,
  getRecommendedDetectionRules,
} from "../../../Types/SecurityEvent/DetectionRuleLibrary";
import NormalizedSecurityEvent from "../../../Types/SecurityEvent/NormalizedSecurityEvent";
import OcsfSeverity, {
  OcsfSeverityId,
} from "../../../Types/SecurityEvent/OcsfSeverity";
import {
  ENRICH_NEW_CASES_TEMPLATE_KEY,
  SecurityPlaybookTemplateDefinition,
  getSecurityPlaybookTemplateDefinition,
} from "../../../Types/SecurityPlaybook/SecurityPlaybookTemplates";
import { resolveTelemetryRetentionInDays } from "../../../Types/Telemetry/TelemetryRetentionConfig";
import {
  SETUP_TEST_ATTRIBUTE,
  SETUP_TEST_EVENT_COUNT,
  SETUP_TEST_HOST,
  SETUP_TEST_PRODUCT_NAME,
  SETUP_TEST_SOURCE_IP,
  SETUP_TEST_USER,
  SETUP_TEST_VENDOR_NAME,
  SETUP_TEST_WINDOW_IN_MINUTES,
} from "../../../Types/SecurityEvent/SecuritySetupTest";
import DetectionRuleService from "../../Services/DetectionRuleService";
import OTelIngestService, {
  TelemetryServiceMetadata,
} from "../../Services/OpenTelemetryIngestService";
import SecurityCaseService from "../../Services/SecurityCaseService";
import SecurityEventConnectionService from "../../Services/SecurityEventConnectionService";
import SecurityEventDestinationService from "../../Services/SecurityEventDestinationService";
import SecurityEventService from "../../Services/SecurityEventService";
import SecurityLogSourceService from "../../Services/SecurityLogSourceService";
import SecurityPlaybookService from "../../Services/SecurityPlaybookService";
import ThreatIntelFeedService from "../../Services/ThreatIntelFeedService";
import { SQL } from "../AnalyticsDatabase/Statement";
import TableColumnType from "../../../Types/AnalyticsDatabase/TableColumnType";
import logger from "../Logger";
import CaptureSpan from "../Telemetry/CaptureSpan";
import { securityCaseGroupingKey } from "../SecurityCase/SecurityCaseIngest";
import DetectionRuleEvaluator from "./DetectionRuleEvaluator";
import { buildSecurityEventDbRow } from "./SecurityEventRow";

/*
 * Security in a few clicks: what the Overview's "Get started" reads and
 * does.
 *
 *   - getStatus: the project's security pipeline at a glance - where events
 *     come from, how many arrived, which rules and playbooks are on, what
 *     is open - read with the caller's own permissions.
 *   - turnOnRecommended: the one click. "Your logs" becomes a source, the
 *     recommended rules of the library are added (or turned back on) and
 *     the Enrich New Cases playbook is created - each only if it is not
 *     there yet, so clicking twice changes nothing.
 *   - runTest: a harmless simulated attack sent through the real pipeline -
 *     a dozen failed sign-ins from one documentation address, the brute
 *     force rule reading them, a case opening and its playbooks running -
 *     so a new project sees what a finding looks like before it has one.
 *     The test never raises an alert or an incident, never notifies, pages
 *     or contains anything (only playbooks that stay inside OneUptime run on
 *     its case), and its events are never sent to a SIEM.
 */

const SETUP_TEST_DETECTIONS_SERVICE_NAME: string = "OneUptime Detections";

export interface SecuritySetupStatus {
  // Where security events come from.
  connections: number;
  logsSourceEnabled: boolean;
  eventsLast24Hours: number;
  lastEventAt: string | null;
  // What finds threats in them.
  enabledRules: number;
  recommendedRules: number;
  recommendedRulesOn: number;
  threatIntelFeeds: number;
  // What needs someone.
  openCases: number;
  // What responds.
  enabledPlaybooks: number;
  // Where they are sent.
  destinations: number;
}

export interface TurnOnRecommendedOptions {
  logs: boolean;
  detections: boolean;
  playbook: boolean;
}

export interface TurnOnRecommendedResult {
  rulesAdded: number;
  rulesTurnedOn: number;
  logsTurnedOn: boolean;
  playbookAdded: boolean;
  // Enrich New Cases was there but switched off, and is on again.
  playbookTurnedOn: boolean;
}

export interface SecuritySetupTestResult {
  eventsSent: number;
  // The case the test opened or joined.
  caseId: string | null;
  caseNumber: string | null;
  // The test's rule was not in the project, so the test added it.
  ruleAdded: boolean;
}

function normalizeName(name: string | undefined): string {
  return (name || "").trim().toLowerCase();
}

/*
 * A project rule is a library rule when it carries the library rule's
 * Sigma id, or the library rule's name (what an added rule keeps; the
 * Rule Library marks rules the same way).
 */
export function isRuleFromLibraryEntry(
  rule: Pick<DetectionRule, "name" | "sigmaRuleYaml">,
  entry: Pick<DetectionRuleLibraryEntry, "id" | "title">,
): boolean {
  if ((rule.sigmaRuleYaml || "").indexOf(`id: ${entry.id}`) !== -1) {
    return true;
  }

  return normalizeName(rule.name) === normalizeName(entry.title);
}

// A library entry as a detection rule of the project: on, opening cases rather than alerts.
export function buildDetectionRuleFromLibrary(data: {
  projectId: ObjectID;
  entry: DetectionRuleLibraryEntry;
}): DetectionRule {
  const rule: DetectionRule = new DetectionRule();
  rule.projectId = data.projectId;
  rule.name = data.entry.title;
  rule.description = data.entry.description;
  rule.sigmaRuleYaml = data.entry.sigmaRuleYaml;
  rule.isEnabled = true;
  rule.evaluationIntervalInMinutes = data.entry.evaluationIntervalInMinutes;
  rule.matchCountThreshold = data.entry.matchCountThreshold;
  rule.shouldCreateCase = true;
  rule.shouldCreateAlert = false;
  rule.shouldCreateIncident = false;
  rule.shouldWriteDetectionFinding = true;

  if (data.entry.groupByField) {
    rule.groupByField = data.entry.groupByField;
  }

  if (data.entry.distinctCountField) {
    rule.distinctCountField = data.entry.distinctCountField;
  }

  return rule;
}

// The simulated sign-in failures the setup test sends.
export function buildSetupTestEvents(
  now: Date,
): Array<NormalizedSecurityEvent> {
  const events: Array<NormalizedSecurityEvent> = [];

  for (let index: number = 0; index < SETUP_TEST_EVENT_COUNT; index++) {
    events.push({
      // Spread over the last minute, oldest first.
      time: OneUptimeDate.addRemoveSeconds(
        now,
        -(SETUP_TEST_EVENT_COUNT - index) * 5,
      ),
      eventUid: `oneuptime-setup-test:${now.getTime()}:${index}`,
      categoryUid: 3,
      categoryName: "Identity & Access Management",
      classUid: 3002,
      className: "Authentication",
      activityName: "Logon",
      severityId: OcsfSeverityId[OcsfSeverity.Low],
      severityName: OcsfSeverity.Low,
      statusName: "Failure",
      message: `Simulated failed sign-in for ${SETUP_TEST_USER} from ${SETUP_TEST_SOURCE_IP} (OneUptime setup test)`,
      vendorName: SETUP_TEST_VENDOR_NAME,
      productName: SETUP_TEST_PRODUCT_NAME,
      ruleId: "",
      ruleName: "",
      mitreTactics: [],
      mitreTechniques: [],
      principalUser: SETUP_TEST_USER,
      principalHost: "",
      principalIp: SETUP_TEST_SOURCE_IP,
      principalProcess: "",
      targetUser: "",
      targetHost: SETUP_TEST_HOST,
      targetIp: "",
      targetPort: 0,
      targetResource: "",
      observables: [SETUP_TEST_USER, SETUP_TEST_HOST, SETUP_TEST_SOURCE_IP],
      attributes: {
        [SETUP_TEST_ATTRIBUTE]: "true",
      },
    });
  }

  return events;
}

export default class SecuritySetup {
  @CaptureSpan()
  public static async getStatus(data: {
    projectId: ObjectID;
    props: DatabaseCommonInteractionProps;
  }): Promise<SecuritySetupStatus> {
    const { projectId, props } = data;
    const since: Date = OneUptimeDate.addRemoveHours(
      OneUptimeDate.getCurrentDate(),
      -24,
    );

    const [
      connections,
      logSource,
      eventsLast24Hours,
      lastEventAt,
      rules,
      threatIntelFeeds,
      openCases,
      enabledPlaybooks,
      destinations,
    ] = await Promise.all([
      this.count(async (): Promise<number> => {
        return (
          await SecurityEventConnectionService.countBy({
            query: { projectId, isEnabled: true },
            props,
          })
        ).toNumber();
      }),
      this.read(async (): Promise<SecurityLogSource | null> => {
        return SecurityLogSourceService.findOneBy({
          query: { projectId },
          select: { _id: true, isEnabled: true },
          props,
        });
      }, null),
      this.count(async (): Promise<number> => {
        return (
          await SecurityEventService.countBy({
            query: { projectId, time: new GreaterThan(since) },
            props,
          })
        ).toNumber();
      }),
      this.read(async (): Promise<string | null> => {
        const latest: Array<SecurityEvent> = await SecurityEventService.findBy({
          query: { projectId },
          select: { time: true },
          sort: { time: SortOrder.Descending },
          skip: 0,
          limit: 1,
          props,
        });
        const time: Date | undefined = latest[0]?.time;

        return time ? new Date(time).toISOString() : null;
      }, null),
      this.read(async (): Promise<Array<DetectionRule>> => {
        return DetectionRuleService.findBy({
          query: { projectId },
          select: {
            _id: true,
            name: true,
            sigmaRuleYaml: true,
            isEnabled: true,
          },
          skip: 0,
          limit: LIMIT_PER_PROJECT,
          props,
        });
      }, []),
      this.count(async (): Promise<number> => {
        return (
          await ThreatIntelFeedService.countBy({
            query: { projectId, isEnabled: true },
            props,
          })
        ).toNumber();
      }),
      this.count(async (): Promise<number> => {
        return (
          await SecurityCaseService.countBy({
            query: {
              projectId,
              status: new Includes([...OPEN_SECURITY_CASE_STATUSES]),
            },
            props,
          })
        ).toNumber();
      }),
      this.count(async (): Promise<number> => {
        return (
          await SecurityPlaybookService.countBy({
            query: { projectId, isEnabled: true },
            props,
          })
        ).toNumber();
      }),
      this.count(async (): Promise<number> => {
        return (
          await SecurityEventDestinationService.countBy({
            query: { projectId, isEnabled: true },
            props,
          })
        ).toNumber();
      }),
    ]);

    const recommended: Array<DetectionRuleLibraryEntry> =
      getRecommendedDetectionRules();

    const recommendedRulesOn: number = recommended.filter(
      (entry: DetectionRuleLibraryEntry): boolean => {
        return rules.some((rule: DetectionRule): boolean => {
          return rule.isEnabled === true && isRuleFromLibraryEntry(rule, entry);
        });
      },
    ).length;

    return {
      connections,
      logsSourceEnabled: logSource?.isEnabled === true,
      eventsLast24Hours,
      lastEventAt,
      enabledRules: rules.filter((rule: DetectionRule): boolean => {
        return rule.isEnabled === true;
      }).length,
      recommendedRules: recommended.length,
      recommendedRulesOn,
      threatIntelFeeds,
      openCases,
      enabledPlaybooks,
      destinations,
    };
  }

  // A count the caller may not be allowed to make reads as 0.
  private static async count(read: () => Promise<number>): Promise<number> {
    return this.read(read, 0);
  }

  private static async read<T>(
    read: () => Promise<T>,
    fallback: T,
  ): Promise<T> {
    try {
      return await read();
    } catch (error) {
      logger.debug("SecuritySetup: a status figure could not be read:");
      logger.debug(error);
      return fallback;
    }
  }

  @CaptureSpan()
  public static async turnOnRecommended(data: {
    projectId: ObjectID;
    props: DatabaseCommonInteractionProps;
    options: TurnOnRecommendedOptions;
  }): Promise<TurnOnRecommendedResult> {
    const { projectId, props, options } = data;
    const result: TurnOnRecommendedResult = {
      rulesAdded: 0,
      rulesTurnedOn: 0,
      logsTurnedOn: false,
      playbookAdded: false,
      playbookTurnedOn: false,
    };

    if (options.logs) {
      const source: SecurityLogSource | null =
        await SecurityLogSourceService.findOneBy({
          query: { projectId },
          select: { _id: true, isEnabled: true },
          props,
        });

      if (!source) {
        const created: SecurityLogSource = new SecurityLogSource();
        created.projectId = projectId;
        created.isEnabled = true;
        await SecurityLogSourceService.create({ data: created, props });
        result.logsTurnedOn = true;
      } else if (source.isEnabled !== true) {
        await SecurityLogSourceService.updateOneById({
          id: source.id!,
          data: { isEnabled: true },
          props,
        });
        result.logsTurnedOn = true;
      }
    }

    if (options.detections) {
      const rules: Array<DetectionRule> = await DetectionRuleService.findBy({
        query: { projectId },
        select: { _id: true, name: true, sigmaRuleYaml: true, isEnabled: true },
        skip: 0,
        limit: LIMIT_PER_PROJECT,
        props,
      });

      for (const entry of getRecommendedDetectionRules()) {
        const existing: DetectionRule | undefined = rules.find(
          (rule: DetectionRule): boolean => {
            return isRuleFromLibraryEntry(rule, entry);
          },
        );

        if (!existing) {
          await DetectionRuleService.create({
            data: buildDetectionRuleFromLibrary({ projectId, entry }),
            props,
          });
          result.rulesAdded++;
          continue;
        }

        if (existing.isEnabled !== true && existing.id) {
          await DetectionRuleService.updateOneById({
            id: existing.id,
            data: { isEnabled: true },
            props,
          });
          result.rulesTurnedOn++;
        }
      }
    }

    if (options.playbook) {
      const template: SecurityPlaybookTemplateDefinition | undefined =
        getSecurityPlaybookTemplateDefinition(ENRICH_NEW_CASES_TEMPLATE_KEY);

      if (!template) {
        throw new BadDataException("The Enrich New Cases template is missing.");
      }

      const existing: Array<SecurityPlaybook> =
        await SecurityPlaybookService.findBy({
          query: { projectId },
          select: { _id: true, name: true, isEnabled: true },
          skip: 0,
          limit: LIMIT_PER_PROJECT,
          props,
        });

      const match: SecurityPlaybook | undefined = existing.find(
        (playbook: SecurityPlaybook): boolean => {
          return normalizeName(playbook.name) === normalizeName(template.title);
        },
      );

      if (match) {
        // Turned off by someone: "turn on" turns it back on, never a copy.
        if (match.isEnabled !== true && match.id) {
          await SecurityPlaybookService.updateOneById({
            id: match.id,
            data: { isEnabled: true },
            props,
          });
          result.playbookTurnedOn = true;
        }
      } else {
        const playbook: SecurityPlaybook = new SecurityPlaybook();
        playbook.projectId = projectId;
        playbook.name = template.title;
        playbook.description = template.description;
        playbook.isEnabled = true;
        playbook.trigger = template.trigger;
        playbook.steps = template.getSteps() as unknown as JSONArray;

        await SecurityPlaybookService.create({ data: playbook, props });
        result.playbookAdded = true;
      }
    }

    return result;
  }

  @CaptureSpan()
  public static async runTest(data: {
    projectId: ObjectID;
    props: DatabaseCommonInteractionProps;
  }): Promise<SecuritySetupTestResult> {
    const { projectId, props } = data;
    const entry: DetectionRuleLibraryEntry | undefined =
      getDetectionRuleLibraryEntry(SETUP_TEST_DETECTION_RULE_ID);

    if (!entry) {
      throw new BadDataException("The setup test's rule is missing.");
    }

    // The project's own brute force rule, added (as the caller) if it has none.
    const rules: Array<DetectionRule> = await DetectionRuleService.findBy({
      query: { projectId },
      select: {
        _id: true,
        projectId: true,
        name: true,
        description: true,
        sigmaRuleYaml: true,
        groupByField: true,
        distinctCountField: true,
        matchCountThreshold: true,
        evaluationIntervalInMinutes: true,
      },
      skip: 0,
      limit: LIMIT_PER_PROJECT,
      props,
    });

    let rule: DetectionRule | undefined = rules.find(
      (candidate: DetectionRule): boolean => {
        return isRuleFromLibraryEntry(candidate, entry);
      },
    );
    let ruleAdded: boolean = false;

    if (!rule) {
      rule = await DetectionRuleService.create({
        data: buildDetectionRuleFromLibrary({ projectId, entry }),
        props,
      });
      ruleAdded = true;
    }

    const now: Date = OneUptimeDate.getCurrentDate();
    const events: Array<NormalizedSecurityEvent> = buildSetupTestEvents(now);

    const serviceMetadata: TelemetryServiceMetadata =
      await OTelIngestService.telemetryServiceFromName({
        serviceName: SETUP_TEST_DETECTIONS_SERVICE_NAME,
        projectId,
      });

    const retentionDays: number = resolveTelemetryRetentionInDays({
      pillar: "securityEvents",
      serviceConfig: serviceMetadata.serviceRetentionConfig,
      serviceRetentionInDays: serviceMetadata.serviceRetentionInDays,
      projectConfig: serviceMetadata.projectRetentionConfig,
      projectRetentionInDays: serviceMetadata.projectRetentionInDays,
    });

    const rows: Array<JSONObject> = events.map(
      (normalized: NormalizedSecurityEvent): JSONObject => {
        return buildSecurityEventDbRow({
          normalized,
          projectId,
          serviceMetadata,
          retentionDays,
        });
      },
    );

    // Readable before the rule reads them, a moment later.
    await SecurityEventService.insertJsonRows(rows, {
      clickhouseSettings: { wait_for_async_insert: 1 },
    });

    await DetectionRuleEvaluator.evaluateRule(rule, {
      setupTest: {
        restrictTo: SQL`productName = ${{
          type: TableColumnType.Text,
          value: SETUP_TEST_PRODUCT_NAME,
        }}`,
        startTime: OneUptimeDate.addRemoveMinutes(
          now,
          -SETUP_TEST_WINDOW_IN_MINUTES,
        ),
        endTime: OneUptimeDate.addRemoveMinutes(now, 1),
      },
    });

    const opened: SecurityCase | null = await SecurityCaseService.findOneBy({
      query: {
        projectId,
        groupingKey: securityCaseGroupingKey({
          groupValue: SETUP_TEST_SOURCE_IP,
          fingerprint: "",
        }),
        status: new Includes([...OPEN_SECURITY_CASE_STATUSES]),
      },
      select: { _id: true, caseNumberWithPrefix: true },
      props: { isRoot: true },
    });

    return {
      eventsSent: rows.length,
      caseId: opened?.id ? opened.id.toString() : null,
      caseNumber: opened?.caseNumberWithPrefix || null,
      ruleAdded,
    };
  }
}

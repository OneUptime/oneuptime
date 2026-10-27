import SecurityEvent from "../../../Models/AnalyticsModels/SecurityEvent";
import DetectionRule from "../../../Models/DatabaseModels/DetectionRule";
import SecurityCase from "../../../Models/DatabaseModels/SecurityCase";
import SecurityLogSource from "../../../Models/DatabaseModels/SecurityLogSource";
import SecurityTelemetrySource from "../../../Models/DatabaseModels/SecurityTelemetrySource";
import {
  SECURITY_TELEMETRY_SOURCE_KINDS,
  SecurityTelemetrySourceKind,
} from "../../../Types/SecurityEvent/SecurityTelemetrySource";
import SecurityTelemetrySourceService from "../../Services/SecurityTelemetrySourceService";
import EnterpriseEdition from "../../Enterprise/EnterpriseEdition";
import SecurityPlaybook from "../../../Models/DatabaseModels/SecurityPlaybook";
import GreaterThan from "../../../Types/BaseDatabase/GreaterThan";
import Includes from "../../../Types/BaseDatabase/Includes";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import { LIMIT_PER_PROJECT } from "../../../Types/Database/LimitMax";
import OneUptimeDate from "../../../Types/Date";
import BadDataException from "../../../Types/Exception/BadDataException";
import BadRequestException from "../../../Types/Exception/BadRequestException";
import ForbiddenException from "../../../Types/Exception/ForbiddenException";
import NotAuthenticatedException from "../../../Types/Exception/NotAuthenticatedException";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import PaymentRequiredException from "../../../Types/Exception/PaymentRequiredException";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import SecurityCaseValues, {
  ProjectSecurityCaseValues,
} from "../SecurityCase/SecurityCaseValues";
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
import {
  TurnOnRecommendedAction,
  TurnOnRecommendedPart,
  TurnOnRecommendedProblem,
  TurnOnRecommendedReason,
  TurnOnRecommendedResult,
} from "../../../Types/SecurityEvent/TurnOnRecommended";
import {
  buildDetectionRuleFromLibrary,
  buildSecurityPlaybookFromTemplate,
  findRuleOfLibraryEntry,
  isPlaybookFromTemplate,
  isRuleFromLibraryEntry,
} from "../../../Utils/SecurityEvent/SecurityTemplateRecords";
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
 *   - turnOnRecommended: the one click. "Your logs" becomes a source, and
 *     so does the rest of your OneUptime data (traces, network flows, the
 *     audit log, session replays), the
 *     recommended rules of the library are added (or turned back on) and
 *     the Enrich New Cases playbook is created - each only if it is not
 *     there yet, so clicking twice changes nothing. Each is done on its
 *     own: one that cannot be done is reported with its reason and the
 *     rest are still done, so clicking again picks up only what is left.
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
  // "Your OneUptime data": the telemetry sources beyond logs that are on.
  telemetrySourcesEnabled: number;
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

export type { TurnOnRecommendedProblem, TurnOnRecommendedResult };

export interface SecuritySetupTestResult {
  eventsSent: number;
  // The case the test opened or joined.
  caseId: string | null;
  caseNumber: string | null;
  // The test's rule was not in the project, so the test added it.
  ruleAdded: boolean;
}

// One place builds and recognizes the records (Utils/SecurityEvent/SecurityTemplateRecords).
export { buildDetectionRuleFromLibrary, isRuleFromLibraryEntry };

/*
 * Why a part of Turn on recommended could not be done, in the terms the
 * Overview words it in: the role, the plan, a record OneUptime would not
 * save (with the server's own sentence), or a failure on OneUptime's side -
 * whose message, a database's or a network's, is logged and never shown.
 */
export function describeTurnOnRecommendedFailure(error: unknown): {
  reason: TurnOnRecommendedReason;
  detail: string;
} {
  if (
    error instanceof NotAuthorizedException ||
    error instanceof ForbiddenException ||
    error instanceof NotAuthenticatedException
  ) {
    return { reason: TurnOnRecommendedReason.NotAllowed, detail: "" };
  }

  if (error instanceof PaymentRequiredException) {
    return { reason: TurnOnRecommendedReason.Plan, detail: error.message };
  }

  if (
    error instanceof BadDataException ||
    error instanceof BadRequestException
  ) {
    return { reason: TurnOnRecommendedReason.Refused, detail: error.message };
  }

  return { reason: TurnOnRecommendedReason.Failed, detail: "" };
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
      processName: "",
      processPath: "",
      processCommandLine: "",
      parentProcessName: "",
      parentProcessPath: "",
      parentProcessCommandLine: "",
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
      telemetrySourcesEnabled,
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
          await SecurityTelemetrySourceService.countBy({
            query: { projectId, isEnabled: true },
            props,
          })
        ).toNumber();
      }),
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
              securityCaseStatusId: new Includes(
                await SecurityCaseValues.getOpenStatusIds(projectId),
              ),
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
      telemetrySourcesEnabled,
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

  /*
   * The one click: your logs, then each recommended rule in the library's
   * order, then Enrich New Cases - each written as the caller, and each
   * only if it is not there yet (a rule turned off is turned back on, never
   * copied).
   *
   * Each part is done on its own. One that fails goes into the answer's
   * problems with why - the role, the plan, a record OneUptime would not
   * save, or a failure on its side - and the parts after it are still done:
   * a rule that cannot be added does not keep your logs, the other rules
   * and the playbook off. Nothing is undone either, since each part works
   * by itself. So the reader is told exactly what is missing, and clicking
   * again does only that.
   */
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
      telemetrySourcesTurnedOn: 0,
      playbookAdded: false,
      playbookTurnedOn: false,
      problems: [],
    };

    // Your logs, and the rest of your OneUptime data beside them.
    if (options.logs) {
      await this.turnOnLogs({ projectId, props, result });
      await this.turnOnTelemetrySources({ projectId, props, result });
    }

    if (options.detections) {
      await this.turnOnRecommendedRules({ projectId, props, result });
    }

    if (options.playbook) {
      await this.turnOnEnrichNewCases({ projectId, props, result });
    }

    return result;
  }

  // A part that could not be done: into the answer, and into the log with what failed.
  private static recordProblem(data: {
    result: TurnOnRecommendedResult;
    projectId: ObjectID;
    part: TurnOnRecommendedPart;
    action: TurnOnRecommendedAction;
    name: string;
    error: unknown;
  }): void {
    const failure: { reason: TurnOnRecommendedReason; detail: string } =
      describeTurnOnRecommendedFailure(data.error);
    const message: string = `Turn on recommended: could not ${data.action} ${data.part}${
      data.name ? ` "${data.name}"` : ""
    } in project ${data.projectId.toString()} (${failure.reason})`;

    // A role, a plan or a record refused is the product working; anything else is a fault.
    if (failure.reason === TurnOnRecommendedReason.Failed) {
      logger.error(message);
      logger.error(data.error as Error);
    } else {
      logger.warn(message);
    }

    const problem: TurnOnRecommendedProblem = {
      part: data.part,
      action: data.action,
      name: data.name,
      reason: failure.reason,
      detail: failure.detail,
    };

    data.result.problems.push(problem);
  }

  private static async turnOnLogs(data: {
    projectId: ObjectID;
    props: DatabaseCommonInteractionProps;
    result: TurnOnRecommendedResult;
  }): Promise<void> {
    const { projectId, props, result } = data;
    let action: TurnOnRecommendedAction = TurnOnRecommendedAction.Check;

    try {
      const source: SecurityLogSource | null =
        await SecurityLogSourceService.findOneBy({
          query: { projectId },
          select: { _id: true, isEnabled: true },
          props,
        });

      if (!source) {
        action = TurnOnRecommendedAction.Add;
        const created: SecurityLogSource = new SecurityLogSource();
        created.projectId = projectId;
        created.isEnabled = true;
        await SecurityLogSourceService.create({ data: created, props });
        result.logsTurnedOn = true;
      } else if (source.isEnabled !== true) {
        action = TurnOnRecommendedAction.TurnOn;
        await SecurityLogSourceService.updateOneById({
          id: source.id!,
          data: { isEnabled: true },
          props,
        });
        result.logsTurnedOn = true;
      }
    } catch (error) {
      this.recordProblem({
        result,
        projectId,
        part: TurnOnRecommendedPart.Logs,
        action,
        name: "",
        error,
      });
    }
  }

  /*
   * Your OneUptime data: each kind of telemetry beyond logs that the project
   * does not read yet - traces, network flows, the audit log, session
   * replays - added, or turned back on. The audit log is left alone where
   * nothing writes it (OneUptime Community), so no switch says it watches
   * what is not there. Each kind on its own, as the rules are.
   */
  private static async turnOnTelemetrySources(data: {
    projectId: ObjectID;
    props: DatabaseCommonInteractionProps;
    result: TurnOnRecommendedResult;
  }): Promise<void> {
    const { projectId, props, result } = data;
    let sources: Array<SecurityTelemetrySource>;

    try {
      sources = await SecurityTelemetrySourceService.findBy({
        query: { projectId },
        select: { _id: true, kind: true, isEnabled: true },
        skip: 0,
        limit: LIMIT_PER_PROJECT,
        props,
      });
    } catch (error) {
      this.recordProblem({
        result,
        projectId,
        part: TurnOnRecommendedPart.TelemetrySources,
        action: TurnOnRecommendedAction.Check,
        name: "",
        error,
      });
      return;
    }

    for (const kind of SECURITY_TELEMETRY_SOURCE_KINDS) {
      if (
        kind === SecurityTelemetrySourceKind.AuditLog &&
        !EnterpriseEdition.isLoaded()
      ) {
        continue;
      }

      const source: SecurityTelemetrySource | undefined = sources.find(
        (item: SecurityTelemetrySource): boolean => {
          return item.kind === kind;
        },
      );
      let action: TurnOnRecommendedAction = TurnOnRecommendedAction.Add;

      try {
        if (!source) {
          const created: SecurityTelemetrySource =
            new SecurityTelemetrySource();
          created.projectId = projectId;
          created.kind = kind;
          created.isEnabled = true;
          await SecurityTelemetrySourceService.create({ data: created, props });
          result.telemetrySourcesTurnedOn += 1;
        } else if (source.isEnabled !== true) {
          action = TurnOnRecommendedAction.TurnOn;
          await SecurityTelemetrySourceService.updateOneById({
            id: source.id!,
            data: { isEnabled: true },
            props,
          });
          result.telemetrySourcesTurnedOn += 1;
        }
      } catch (error) {
        this.recordProblem({
          result,
          projectId,
          part: TurnOnRecommendedPart.TelemetrySources,
          action,
          name: kind,
          error,
        });
      }
    }
  }

  private static async turnOnRecommendedRules(data: {
    projectId: ObjectID;
    props: DatabaseCommonInteractionProps;
    result: TurnOnRecommendedResult;
  }): Promise<void> {
    const { projectId, props, result } = data;
    let rules: Array<DetectionRule>;

    try {
      rules = await DetectionRuleService.findBy({
        query: { projectId },
        select: { _id: true, name: true, sigmaRuleYaml: true, isEnabled: true },
        skip: 0,
        limit: LIMIT_PER_PROJECT,
        props,
      });
    } catch (error) {
      /*
       * Without what the project has, adding would copy the rules it has
       * already: nothing is added, and the answer says so.
       */
      this.recordProblem({
        result,
        projectId,
        part: TurnOnRecommendedPart.Rule,
        action: TurnOnRecommendedAction.Check,
        name: "",
        error,
      });
      return;
    }

    for (const entry of getRecommendedDetectionRules()) {
      const existing: DetectionRule | undefined = findRuleOfLibraryEntry(
        rules,
        entry,
      );

      if (existing && existing.isEnabled === true) {
        continue;
      }

      const action: TurnOnRecommendedAction = existing
        ? TurnOnRecommendedAction.TurnOn
        : TurnOnRecommendedAction.Add;

      try {
        if (!existing) {
          await DetectionRuleService.create({
            data: buildDetectionRuleFromLibrary({ projectId, entry }),
            props,
          });
          result.rulesAdded++;
        } else if (existing.id) {
          await DetectionRuleService.updateOneById({
            id: existing.id,
            data: { isEnabled: true },
            props,
          });
          result.rulesTurnedOn++;
        }
      } catch (error) {
        this.recordProblem({
          result,
          projectId,
          part: TurnOnRecommendedPart.Rule,
          action,
          // The name the project's lists show: a renamed rule keeps its own.
          name: existing?.name || entry.title,
          error,
        });
      }
    }
  }

  private static async turnOnEnrichNewCases(data: {
    projectId: ObjectID;
    props: DatabaseCommonInteractionProps;
    result: TurnOnRecommendedResult;
  }): Promise<void> {
    const { projectId, props, result } = data;
    const template: SecurityPlaybookTemplateDefinition | undefined =
      getSecurityPlaybookTemplateDefinition(ENRICH_NEW_CASES_TEMPLATE_KEY);

    if (!template) {
      // Never so (SecurityTemplatesCreatable); said, rather than thrown, if it ever is.
      this.recordProblem({
        result,
        projectId,
        part: TurnOnRecommendedPart.Playbook,
        action: TurnOnRecommendedAction.Add,
        name: "",
        error: new Error("The Enrich New Cases template is missing."),
      });
      return;
    }

    let action: TurnOnRecommendedAction = TurnOnRecommendedAction.Check;
    let name: string = template.title;

    try {
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
          return isPlaybookFromTemplate(playbook, template);
        },
      );

      if (!match) {
        action = TurnOnRecommendedAction.Add;

        // The template's priorities and statuses, as the project names them.
        const values: ProjectSecurityCaseValues =
          await SecurityCaseValues.getForProject(projectId);

        await SecurityPlaybookService.create({
          data: buildSecurityPlaybookFromTemplate({
            projectId,
            template,
            priorities: values.priorities,
            statuses: values.statuses,
          }),
          props,
        });
        result.playbookAdded = true;
      } else if (match.isEnabled !== true && match.id) {
        // Turned off by someone: "turn on" turns it back on, never a copy.
        action = TurnOnRecommendedAction.TurnOn;
        name = match.name || template.title;
        await SecurityPlaybookService.updateOneById({
          id: match.id,
          data: { isEnabled: true },
          props,
        });
        result.playbookTurnedOn = true;
      }
    } catch (error) {
      this.recordProblem({
        result,
        projectId,
        part: TurnOnRecommendedPart.Playbook,
        action,
        name,
        error,
      });
    }
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
        securityCaseStatusId: new Includes(
          await SecurityCaseValues.getOpenStatusIds(projectId),
        ),
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

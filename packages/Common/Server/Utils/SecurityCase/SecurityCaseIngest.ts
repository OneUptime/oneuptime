import SecurityCase from "../../../Models/DatabaseModels/SecurityCase";
import { SecurityCaseFeedEventType } from "../../../Models/DatabaseModels/SecurityCaseFeed";
import SecurityDetection from "../../../Models/DatabaseModels/SecurityDetection";
import Semaphore, { SemaphoreMutex } from "../../Infrastructure/Semaphore";
import SecurityCaseFeedService from "../../Services/SecurityCaseFeedService";
import SecurityCaseService, {
  SECURITY_CASE_OPENED_BY_DETECTION_KEY,
  normalizeMitreIds,
} from "../../Services/SecurityCaseService";
import SecurityDetectionService from "../../Services/SecurityDetectionService";
import logger from "../Logger";
import SecurityPlaybookLauncher from "../SecurityPlaybook/SecurityPlaybookLauncher";
import SecurityCaseTriage from "../AI/Security/SecurityCaseTriage";
import CaptureSpan from "../Telemetry/CaptureSpan";
import SecurityCaseValues, {
  ProjectSecurityCaseValues,
} from "./SecurityCaseValues";
import SecurityCasePriority from "../../../Models/DatabaseModels/SecurityCasePriority";
import SecurityCaseStatus from "../../../Models/DatabaseModels/SecurityCaseStatus";
import Includes from "../../../Types/BaseDatabase/Includes";
import { Blue500, Red500 } from "../../../Types/BrandColors";
import { LIMIT_PER_PROJECT } from "../../../Types/Database/LimitMax";
import { JSONArray } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import SecurityCaseStage from "../../../Types/SecurityCase/SecurityCaseStage";
import SecurityDetectionSource from "../../../Types/SecurityCase/SecurityDetectionSource";
import {
  SecurityEntity,
  mergeSecurityEntities,
} from "../../../Types/SecurityCase/SecurityEntity";
import OcsfSeverity, {
  OcsfSeverityId,
} from "../../../Types/SecurityEvent/OcsfSeverity";
import SecurityPlaybookTrigger from "../../../Types/SecurityPlaybook/SecurityPlaybookTrigger";
import { getEntityCaseGroupingKey } from "../../../Utils/SecurityCase/SecurityEntityRiskScore";
import {
  caseOpenedFromDetectionMarkdown,
  detectionAddedMarkdown,
} from "../../../Utils/SecurityCase/SecurityCaseMarkdown";
import PartialEntity from "../../../Types/Database/PartialEntity";
import SecurityCasePriorities from "../../../Utils/SecurityCase/SecurityCasePriorities";
import SecurityCaseStatuses from "../../../Utils/SecurityCase/SecurityCaseStatuses";

/*
 * One signal a detection source raised: a rule's match for one group, a
 * threat-intel hit on one indicator, an alert a connected product raised.
 */
export interface SecurityDetectionSignal {
  projectId: ObjectID;
  source: SecurityDetectionSource;
  // Stable for "the same signal": the source and what it fired for.
  fingerprint: string;
  title: string;
  // Markdown OneUptime wrote around the source's text.
  description?: string | undefined;
  severity: OcsfSeverity;
  // Security events behind this firing.
  eventCount: number;
  // The value the source grouped on - the entity the signal is about - if any.
  groupValue?: string | undefined;
  entities: Array<SecurityEntity>;
  mitreTactics: Array<string>;
  mitreTechniques: Array<string>;
  ruleName?: string | undefined;
  detectionRuleId?: ObjectID | undefined;
  threatIntelFeedId?: ObjectID | undefined;
  securityEventConnectionId?: ObjectID | undefined;
  sampleMessage?: string | undefined;
  // The security event that records it (a Detection Finding, or the imported alert).
  eventUid?: string | undefined;
  seenAt: Date;
  /*
   * Raised by the setup test (SecuritySetup.runTest): its case runs only
   * the playbooks that stay inside OneUptime - nobody is told, paged or
   * contained over a test.
   */
  isSetupTest?: boolean | undefined;
}

export interface SecurityCaseIngestResult {
  casesOpened: number;
  detectionsAdded: number;
  detectionsRepeated: number;
}

const LONG_TEXT_LIMIT: number = 480;

function clamp(text: string, limit: number): string {
  return text.length > limit ? `${text.slice(0, limit - 1)}…` : text;
}

/*
 * What a signal is matched on to join an open case: the entity it is about,
 * so that a brute force, a password spray and a threat-intel hit on the same
 * address land in one case; or, for a signal about no particular entity, its
 * own fingerprint, so the same rule firing again joins its own case. The
 * entity's key is the one its risk is kept under (getEntityCaseGroupingKey:
 * the value case folded, hashed past 200 characters), so an entity's page
 * finds the case about it, and its risk joins that case.
 */
export function securityCaseGroupingKey(signal: {
  groupValue?: string | undefined;
  fingerprint: string;
}): string {
  const value: string = (signal.groupValue || "").trim();

  if (value) {
    return getEntityCaseGroupingKey(value);
  }

  return clamp(`detection:${signal.fingerprint}`, LONG_TEXT_LIMIT);
}

// The worse of two OCSF severities.
export function worseSeverity(
  a: OcsfSeverity | string | undefined,
  b: OcsfSeverity,
): OcsfSeverity {
  const rank: (severity: string | undefined) => number = (
    severity: string | undefined,
  ): number => {
    if (!severity || severity === OcsfSeverity.Other) {
      return 0;
    }

    return OcsfSeverityId[severity as OcsfSeverity] || 0;
  };

  return rank(b) > rank(a) ? b : (a as OcsfSeverity) || b;
}

/*
 * THE BRIDGE FROM DETECTIONS TO CASES.
 *
 * Every detection source - detection rules, the threat-intel matcher, the
 * alerts of connected products - hands its signals here, and here they
 * become work for a person:
 *
 *  1. A signal whose detection is already in an open case (same
 *     fingerprint) is a repeat: the detection's counts and last-seen time go
 *     up, and nothing else happens. A rule matching every minute is one line
 *     on a case.
 *  2. A new signal about an entity that an open case is already about joins
 *     that case: one compromised host is one case, however many rules see
 *     it. The case's priority rises to the new detection's, and the
 *     Detection Added playbooks run.
 *  3. Anything else opens a case, and the Case Opened playbooks run.
 *
 * A closed case takes nothing new: the next signal opens a fresh case. One
 * project's signals are recorded under one lock, so two workers recording
 * signals about the same host at the same moment cannot open two cases.
 */
export default class SecurityCaseIngest {
  @CaptureSpan()
  public static async recordDetections(
    signals: Array<SecurityDetectionSignal>,
  ): Promise<SecurityCaseIngestResult> {
    const result: SecurityCaseIngestResult = {
      casesOpened: 0,
      detectionsAdded: 0,
      detectionsRepeated: 0,
    };

    const byProject: Map<string, Array<SecurityDetectionSignal>> = new Map();

    for (const signal of signals) {
      const key: string = signal.projectId.toString();
      byProject.set(key, [...(byProject.get(key) || []), signal]);
    }

    for (const projectSignals of byProject.values()) {
      const projectResult: SecurityCaseIngestResult =
        await this.recordProjectDetections(projectSignals);

      result.casesOpened += projectResult.casesOpened;
      result.detectionsAdded += projectResult.detectionsAdded;
      result.detectionsRepeated += projectResult.detectionsRepeated;
    }

    return result;
  }

  private static async recordProjectDetections(
    signals: Array<SecurityDetectionSignal>,
  ): Promise<SecurityCaseIngestResult> {
    const projectId: ObjectID = signals[0]!.projectId;

    const mutex: SemaphoreMutex = await Semaphore.lock({
      key: projectId.toString(),
      namespace: "SecurityCaseIngest",
      lockTimeout: 120000,
      acquireTimeout: 120000,
    });

    const launches: Array<() => Promise<unknown>> = [];

    try {
      const result: SecurityCaseIngestResult = await this.recordUnderLock(
        projectId,
        signals,
        launches,
      );

      return result;
    } finally {
      await Semaphore.release(mutex);

      /*
       * Playbooks start once the lock is given back: starting one reads the
       * case it runs on, and nothing a playbook does should hold up the next
       * project's detections.
       */
      for (const launch of launches) {
        try {
          await launch();
        } catch (error) {
          logger.error("SecurityCaseIngest: could not start playbooks:");
          logger.error(error);
        }
      }
    }
  }

  private static async recordUnderLock(
    projectId: ObjectID,
    signals: Array<SecurityDetectionSignal>,
    launches: Array<() => Promise<unknown>>,
  ): Promise<SecurityCaseIngestResult> {
    const result: SecurityCaseIngestResult = {
      casesOpened: 0,
      detectionsAdded: 0,
      detectionsRepeated: 0,
    };

    const fingerprints: Array<string> = Array.from(
      new Set(
        signals.map((signal: SecurityDetectionSignal): string => {
          return clamp(signal.fingerprint, LONG_TEXT_LIMIT);
        }),
      ),
    );

    const existingDetections: Array<SecurityDetection> =
      await SecurityDetectionService.findBy({
        query: {
          projectId: projectId,
          fingerprint: new Includes(fingerprints),
        },
        select: {
          _id: true,
          fingerprint: true,
          securityCaseId: true,
          severity: true,
          entities: true,
        },
        skip: 0,
        limit: LIMIT_PER_PROJECT,
        props: {
          isRoot: true,
        },
      });

    const groupingKeys: Array<string> = Array.from(
      new Set(signals.map(securityCaseGroupingKey)),
    );

    const caseIdsOfDetections: Array<string> = Array.from(
      new Set(
        existingDetections
          .map((detection: SecurityDetection): string => {
            return detection.securityCaseId?.toString() || "";
          })
          .filter((id: string): boolean => {
            return Boolean(id);
          }),
      ),
    );

    /*
     * The project's case priorities and statuses, read once for the batch:
     * a detection opens its case at the priority of its severity, in the
     * new status, and joins only a case still open.
     */
    const values: ProjectSecurityCaseValues =
      await SecurityCaseValues.getForProject(projectId);

    // Every open case a signal could land in: by its detections, or by its grouping key.
    const openCases: Map<string, SecurityCase> = new Map();

    const caseSelect: {
      _id: true;
      securityCasePriorityId: true;
      groupingKey: true;
      entities: true;
      mitreTactics: true;
      mitreTechniques: true;
      firstDetectedAt: true;
    } = {
      _id: true,
      securityCasePriorityId: true,
      groupingKey: true,
      entities: true,
      mitreTactics: true,
      mitreTechniques: true,
      firstDetectedAt: true,
    };

    for (const query of [
      caseIdsOfDetections.length > 0
        ? { _id: new Includes(caseIdsOfDetections) }
        : null,
      { groupingKey: new Includes(groupingKeys) },
    ]) {
      if (!query) {
        continue;
      }

      const cases: Array<SecurityCase> = await SecurityCaseService.findBy({
        query: {
          projectId: projectId,
          securityCaseStatusId: new Includes(
            SecurityCaseStatuses.getOpenStatusIds(values.statuses),
          ),
          ...query,
        },
        select: caseSelect,
        skip: 0,
        limit: LIMIT_PER_PROJECT,
        props: {
          isRoot: true,
        },
      });

      for (const securityCase of cases) {
        if (securityCase.id) {
          openCases.set(securityCase.id.toString(), securityCase);
        }
      }
    }

    for (const signal of signals) {
      try {
        const fingerprint: string = clamp(signal.fingerprint, LONG_TEXT_LIMIT);

        const repeated: SecurityDetection | undefined = existingDetections.find(
          (detection: SecurityDetection): boolean => {
            return (
              detection.fingerprint === fingerprint &&
              Boolean(detection.securityCaseId) &&
              openCases.has(detection.securityCaseId!.toString())
            );
          },
        );

        if (repeated) {
          await this.recordRepeat({
            signal,
            detection: repeated,
            securityCase: openCases.get(repeated.securityCaseId!.toString())!,
            values,
          });
          result.detectionsRepeated++;
          continue;
        }

        const groupingKey: string = securityCaseGroupingKey(signal);
        const joined: SecurityCase | undefined = Array.from(
          openCases.values(),
        ).find((securityCase: SecurityCase): boolean => {
          return securityCase.groupingKey === groupingKey;
        });

        if (joined) {
          const detection: SecurityDetection = await this.addDetection({
            signal,
            securityCase: joined,
            isOpeningDetection: false,
            values,
          });
          existingDetections.push(detection);
          result.detectionsAdded++;

          launches.push((): Promise<number> => {
            return SecurityPlaybookLauncher.launchForCase({
              projectId,
              securityCaseId: joined.id!,
              trigger: SecurityPlaybookTrigger.DetectionAdded,
              detection: {
                source: signal.source,
                detectionRuleId: signal.detectionRuleId,
              },
              onlyPlaybooksThatStayInside: signal.isSetupTest === true,
            });
          });
          continue;
        }

        const opened: SecurityCase = await this.openCase({
          signal,
          groupingKey,
          values,
        });
        openCases.set(opened.id!.toString(), opened);

        const detection: SecurityDetection = await this.addDetection({
          signal,
          securityCase: opened,
          isOpeningDetection: true,
          values,
        });
        existingDetections.push(detection);
        result.casesOpened++;
        result.detectionsAdded++;

        launches.push((): Promise<number> => {
          return SecurityPlaybookLauncher.launchForCase({
            projectId,
            securityCaseId: opened.id!,
            trigger: SecurityPlaybookTrigger.CaseOpened,
            detection: {
              source: signal.source,
              detectionRuleId: signal.detectionRuleId,
            },
            onlyPlaybooksThatStayInside: signal.isSetupTest === true,
          });
        });

        /*
         * OneUptime AI triages the new case when the project triages new
         * cases (SecurityCaseTriage). A setup test's case is not: the test
         * sends nothing outside OneUptime, and an LLM provider is outside.
         * Its card still offers Triage with AI.
         */
        if (signal.isSetupTest !== true) {
          launches.push((): Promise<ObjectID | null> => {
            return SecurityCaseTriage.triageNewCase({
              projectId,
              securityCaseId: opened.id!,
            });
          });
        }
      } catch (error) {
        logger.error(
          `SecurityCaseIngest: could not record the detection "${signal.title}" for project ${projectId.toString()}:`,
        );
        logger.error(error);
      }
    }

    return result;
  }

  private static async openCase(data: {
    signal: SecurityDetectionSignal;
    groupingKey: string;
    values: ProjectSecurityCaseValues;
  }): Promise<SecurityCase> {
    const { signal } = data;

    /*
     * At the project's priority for the detection's severity - whatever it
     * calls it - and in its new status. The case service gives a case it
     * is handed none of the two its defaults.
     */
    const priority: SecurityCasePriority | null =
      SecurityCasePriorities.getPriorityForSeverity(
        data.values.priorities,
        signal.severity,
      );
    const status: SecurityCaseStatus | null =
      SecurityCaseStatuses.getStatusOfStage(
        data.values.statuses,
        SecurityCaseStage.New,
      );

    const securityCase: SecurityCase = new SecurityCase();
    securityCase.projectId = signal.projectId;
    securityCase.title = clamp(signal.title, LONG_TEXT_LIMIT);
    securityCase.description = signal.description || "";

    if (priority?.id) {
      securityCase.securityCasePriorityId = priority.id;
    }

    if (status?.id) {
      securityCase.securityCaseStatusId = status.id;
    }

    securityCase.source = signal.source;
    securityCase.entities = mergeSecurityEntities(
      signal.entities,
    ) as unknown as JSONArray;
    securityCase.mitreTactics = normalizeMitreIds(
      signal.mitreTactics,
      "tactic",
    );
    securityCase.mitreTechniques = normalizeMitreIds(
      signal.mitreTechniques,
      "technique",
    );
    securityCase.firstDetectedAt = signal.seenAt;
    securityCase.lastDetectedAt = signal.seenAt;
    securityCase.groupingKey = data.groupingKey;
    securityCase.detectionCount = 0;

    const created: SecurityCase = await SecurityCaseService.create({
      data: securityCase,
      miscDataProps: {
        [SECURITY_CASE_OPENED_BY_DETECTION_KEY]: true,
      },
      props: {
        isRoot: true,
      },
    });

    await SecurityCaseFeedService.createSecurityCaseFeedItem({
      projectId: signal.projectId,
      securityCaseId: created.id!,
      feedInfoInMarkdown: caseOpenedFromDetectionMarkdown({
        detectionTitle: signal.title,
        source: signal.source,
      }).toString(),
      eventType: SecurityCaseFeedEventType.CaseOpened,
      displayColor: Red500,
    });

    return created;
  }

  private static async addDetection(data: {
    signal: SecurityDetectionSignal;
    securityCase: SecurityCase;
    isOpeningDetection: boolean;
    values: ProjectSecurityCaseValues;
  }): Promise<SecurityDetection> {
    const { signal, securityCase } = data;

    const detection: SecurityDetection = new SecurityDetection();
    detection.projectId = signal.projectId;
    detection.securityCaseId = securityCase.id!;
    detection.title = clamp(signal.title, LONG_TEXT_LIMIT);
    detection.description = signal.description || "";
    detection.severity = signal.severity;
    detection.source = signal.source;
    detection.fingerprint = clamp(signal.fingerprint, LONG_TEXT_LIMIT);
    detection.entities = mergeSecurityEntities(
      signal.entities,
    ) as unknown as JSONArray;
    detection.mitreTactics = normalizeMitreIds(signal.mitreTactics, "tactic");
    detection.mitreTechniques = normalizeMitreIds(
      signal.mitreTechniques,
      "technique",
    );
    detection.eventCount = Math.max(0, Math.trunc(signal.eventCount || 0));
    detection.fireCount = 1;
    detection.firstSeenAt = signal.seenAt;
    detection.lastSeenAt = signal.seenAt;

    if (signal.ruleName) {
      detection.ruleName = clamp(signal.ruleName, LONG_TEXT_LIMIT);
    }

    if (signal.groupValue) {
      detection.groupValue = clamp(signal.groupValue, LONG_TEXT_LIMIT);
    }

    if (signal.detectionRuleId) {
      detection.detectionRuleId = signal.detectionRuleId;
    }

    if (signal.threatIntelFeedId) {
      detection.threatIntelFeedId = signal.threatIntelFeedId;
    }

    if (signal.securityEventConnectionId) {
      detection.securityEventConnectionId = signal.securityEventConnectionId;
    }

    if (signal.sampleMessage) {
      detection.sampleMessage = signal.sampleMessage;
    }

    if (signal.eventUid) {
      detection.eventUid = clamp(signal.eventUid, LONG_TEXT_LIMIT);
    }

    const created: SecurityDetection = await SecurityDetectionService.create({
      data: detection,
      props: {
        isRoot: true,
      },
    });

    await SecurityCaseService.atomicAddToColumnsByIdWithoutHooks({
      id: securityCase.id!,
      add: {
        detectionCount: 1,
      },
      set: {
        lastDetectedAt: signal.seenAt,
      },
    });

    if (!data.isOpeningDetection) {
      await SecurityCaseFeedService.createSecurityCaseFeedItem({
        projectId: signal.projectId,
        securityCaseId: securityCase.id!,
        feedInfoInMarkdown: detectionAddedMarkdown({
          detectionTitle: signal.title,
          severity: signal.severity,
        }).toString(),
        eventType: SecurityCaseFeedEventType.DetectionAdded,
        displayColor: Blue500,
      });

      await this.widenCase({ securityCase, signal, values: data.values });
    }

    return created;
  }

  /*
   * A case takes in what a joining or repeating detection adds: its
   * entities and ATT&CK ids, and its severity when that is worse than the
   * case's priority. The priority change goes through the case service, so
   * the feed says why the case went up.
   */
  private static async widenCase(data: {
    securityCase: SecurityCase;
    signal: SecurityDetectionSignal;
    values: ProjectSecurityCaseValues;
  }): Promise<void> {
    const { securityCase, signal } = data;

    const entities: Array<SecurityEntity> = mergeSecurityEntities(
      (securityCase.entities || []) as unknown as Array<SecurityEntity>,
      signal.entities,
    );
    const mitreTactics: Array<string> = normalizeMitreIds(
      [...(securityCase.mitreTactics || []), ...signal.mitreTactics],
      "tactic",
    );
    const mitreTechniques: Array<string> = normalizeMitreIds(
      [...(securityCase.mitreTechniques || []), ...signal.mitreTechniques],
      "technique",
    );

    /*
     * The priority of the detection's severity, when it ranks above the
     * case's in the project's list: a case only ever rises with a detection.
     */
    const signalPriority: SecurityCasePriority | null =
      SecurityCasePriorities.getPriorityForSeverity(
        data.values.priorities,
        signal.severity,
      );
    const raisesPriority: boolean = Boolean(
      signalPriority?.id &&
        SecurityCasePriorities.isMoreUrgent(
          data.values.priorities,
          signalPriority.id,
          securityCase.securityCasePriorityId,
        ),
    );

    // Typed as the update's own payload type, which the compiler need not unfold.
    const update: PartialEntity<SecurityCase> = {};

    if (
      JSON.stringify(entities) !== JSON.stringify(securityCase.entities || [])
    ) {
      update.entities = entities as unknown as NonNullable<
        PartialEntity<SecurityCase>["entities"]
      >;
    }

    if (
      JSON.stringify(mitreTactics) !==
      JSON.stringify(securityCase.mitreTactics || [])
    ) {
      update.mitreTactics = mitreTactics;
    }

    if (
      JSON.stringify(mitreTechniques) !==
      JSON.stringify(securityCase.mitreTechniques || [])
    ) {
      update.mitreTechniques = mitreTechniques;
    }

    if (raisesPriority && signalPriority?.id) {
      update.securityCasePriorityId = signalPriority.id;
    }

    if (Object.keys(update).length === 0) {
      return;
    }

    await SecurityCaseService.updateOneById({
      id: securityCase.id!,
      data: update,
      props: {
        isRoot: true,
      },
    });

    // Keep the in-memory copy current for the next signal of this batch.
    securityCase.entities = entities as unknown as JSONArray;
    securityCase.mitreTactics = mitreTactics;
    securityCase.mitreTechniques = mitreTechniques;

    if (raisesPriority && signalPriority?.id) {
      securityCase.securityCasePriorityId = signalPriority.id;
    }
  }

  private static async recordRepeat(data: {
    signal: SecurityDetectionSignal;
    detection: SecurityDetection;
    securityCase: SecurityCase;
    values: ProjectSecurityCaseValues;
  }): Promise<void> {
    const { signal, detection } = data;

    const severity: OcsfSeverity = worseSeverity(
      detection.severity,
      signal.severity,
    );

    const set: PartialEntity<SecurityDetection> = {
      lastSeenAt: signal.seenAt,
      severity: severity,
      entities: mergeSecurityEntities(
        (detection.entities || []) as unknown as Array<SecurityEntity>,
        signal.entities,
      ) as unknown as NonNullable<PartialEntity<SecurityDetection>["entities"]>,
    };

    if (signal.eventUid) {
      set.eventUid = clamp(signal.eventUid, LONG_TEXT_LIMIT);
    }

    if (signal.sampleMessage) {
      set.sampleMessage = signal.sampleMessage;
    }

    await SecurityDetectionService.atomicAddToColumnsByIdWithoutHooks({
      id: detection.id!,
      add: {
        eventCount: Math.max(0, Math.trunc(signal.eventCount || 0)),
        fireCount: 1,
      },
      set: set,
    });

    await SecurityCaseService.updateColumnsByIdWithoutHooks({
      id: data.securityCase.id!,
      data: {
        lastDetectedAt: signal.seenAt,
      },
    });

    await this.widenCase({
      securityCase: data.securityCase,
      signal,
      values: data.values,
    });
  }
}

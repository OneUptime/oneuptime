import ProjectReferencesService from "./ProjectReferencesService";
import Model from "../../Models/DatabaseModels/DetectionRule";
import CreateBy from "../Types/Database/CreateBy";
import UpdateBy from "../Types/Database/UpdateBy";
import { OnCreate, OnUpdate } from "../Types/Database/Hooks";
import QueryHelper from "../Types/Database/QueryHelper";
import BadDataException from "../../Types/Exception/BadDataException";
import OneUptimeDate from "../../Types/Date";
import { JSONObject, JSONValue } from "../../Types/JSON";
import ObjectID from "../../Types/ObjectID";
import PositiveNumber from "../../Types/PositiveNumber";
import SortOrder from "../../Types/BaseDatabase/SortOrder";
import {
  DETECTION_EVALUATION_DELAY_IN_SECONDS,
  DETECTION_EVALUATION_INTERVAL_MAX_IN_MINUTES,
  DETECTION_EVALUATION_INTERVAL_MIN_IN_MINUTES,
  DETECTION_MATCH_COUNT_THRESHOLD_MAX,
  DETECTION_MATCH_COUNT_THRESHOLD_MIN,
} from "../../Types/SecurityEvent/DetectionFindingConstants";
import {
  DETECTION_REAL_TIME_RULES_MAX,
  getRealTimeDetectionProblem,
} from "../../Types/SecurityEvent/RealTimeDetection";
import { fitDetectionRuleName } from "../../Types/SecurityEvent/DetectionRuleName";
import {
  ENTITY_RISK_POINTS_MAX,
  ENTITY_RISK_POINTS_MIN,
} from "../../Types/SecurityCase/SecurityEntityRisk";
import {
  DetectionRuleDefinition,
  SigmaRuleReferenceResolver,
} from "../../Types/SecurityEvent/SigmaCorrelation";
import SigmaRuleSetParser, {
  detectionRuleHeader,
  sigmaRulesOf,
} from "../../Utils/SecurityEvent/Sigma/SigmaRuleSetParser";
import {
  SigmaRuleSource,
  indexSigmaRules,
} from "../../Utils/SecurityEvent/Sigma/SigmaRuleIndex";
import SigmaClickhouseCompiler from "../Utils/SecurityEvent/Sigma/SigmaClickhouseCompiler";
import SecurityWatchlists from "../Utils/SecurityEvent/Watchlists/SecurityWatchlists";
import { assertDetectionReadFits } from "../Utils/SecurityEvent/Watchlists/SecurityWatchlistMatch";
import { getDetectionRuleWatchlistReferences } from "../../Utils/SecurityEvent/Sigma/SigmaWatchlists";
import RealTimeJobs, {
  getRealTimeHandoverWindow,
} from "../Utils/SecurityEvent/RealTime/RealTimeJobs";
import logger from "../Utils/Logger";

// A rule that starts to check events as they arrive, and the window its handover reads.
interface RealTimeStart {
  id: ObjectID;
  projectId: ObjectID;
  startTime: Date;
  endTime: Date;
}

// What an update does to real time, carried from before it to after it.
interface RealTimeChanges {
  leavingRealTime?: Array<ObjectID> | undefined;
  enteringRealTime?: Array<RealTimeStart> | undefined;
}

// A switch as a write may carry it: true, or Postgres's "true".
function readSwitch(value: JSONValue | undefined): boolean {
  return value === true || value === "true";
}

export class Service extends ProjectReferencesService<Model> {
  public constructor() {
    super(Model);
  }

  /*
   * REAL TIME (Types/SecurityEvent/RealTimeDetection): a rule may check
   * each event as it arrives only when it fires on one event - and a
   * project runs at most DETECTION_REAL_TIME_RULES_MAX rules so, since
   * every event it writes is checked against each. Both are asked whenever
   * a write turns real time on or changes what a real-time rule reads.
   */
  private static assertRealTimeFits(data: {
    ruleYaml: string | undefined;
    matchCountThreshold: unknown;
    distinctCountField: unknown;
  }): void {
    const problem: string | null = getRealTimeDetectionProblem({
      definition: SigmaRuleSetParser.parse(data.ruleYaml || ""),
      matchCountThreshold:
        typeof data.matchCountThreshold === "number"
          ? data.matchCountThreshold
          : Number(data.matchCountThreshold) || undefined,
      distinctCountField:
        typeof data.distinctCountField === "string"
          ? data.distinctCountField
          : undefined,
    });

    if (problem) {
      throw new BadDataException(
        `This rule cannot run in real time. ${problem}`,
      );
    }
  }

  private async assertRealTimeRoom(
    projectId: ObjectID,
    exceptRuleId?: ObjectID | undefined,
  ): Promise<void> {
    const count: PositiveNumber = await this.countBy({
      query: {
        projectId,
        isRealTime: true,
        ...(exceptRuleId ? { _id: QueryHelper.notEquals(exceptRuleId) } : {}),
      },
      props: {
        isRoot: true,
      },
    });

    if (count.toNumber() >= DETECTION_REAL_TIME_RULES_MAX) {
      throw new BadDataException(
        `A project runs at most ${DETECTION_REAL_TIME_RULES_MAX} rules in real time, since every event it receives is checked against each. Turn real time off on another rule first.`,
      );
    }
  }

  /*
   * Whether an update that leaves real time as it is could still stop a
   * real-time rule from running so: a rule a correlation or a regular
   * expression now, a threshold above 1, a distinct count field. Anything
   * else keeps a real-time rule able to, and reads no row.
   */
  private static mayEndRealTime(data: JSONObject): boolean {
    if (data["sigmaRuleYaml"] !== undefined) {
      try {
        if (
          getRealTimeDetectionProblem({
            definition: SigmaRuleSetParser.parse(
              String(data["sigmaRuleYaml"] || ""),
            ),
          })
        ) {
          return true;
        }
      } catch {
        return true;
      }
    }

    if (
      data["matchCountThreshold"] !== undefined &&
      data["matchCountThreshold"] !== null &&
      Number(data["matchCountThreshold"]) > 1
    ) {
      return true;
    }

    return (
      typeof data["distinctCountField"] === "string" &&
      data["distinctCountField"].trim().length > 0
    );
  }

  /*
   * An update that turns real time on or off, turns a rule on, or could
   * stop a real-time rule from running so, held to the rules above for
   * every row it writes, as the row will be. Returns what changes
   * (onUpdateSuccess acts on it once the rows are written):
   *
   *   - the rows that go back to their schedule, which start it from now:
   *     from their last scheduled run, they would read again what real
   *     time already did;
   *   - the rows that start to check events as they arrive - off their
   *     schedule, or turned back on - each with the window its handover
   *     reads (RealTimeJobs): from the last scheduled run, or from now for
   *     a real-time rule turned back on, until every process screens for it.
   */
  private async checkRealTimeUpdate(
    updateBy: UpdateBy<Model>,
  ): Promise<RealTimeChanges> {
    const data: JSONObject = updateBy.data as unknown as JSONObject;

    if (
      data["isRealTime"] === undefined &&
      !Service.mayEndRealTime(data) &&
      !readSwitch(data["isEnabled"])
    ) {
      return {};
    }

    const rows: Array<Model> = await this.findRowsAndHoldUpdateToThem(
      updateBy,
      {
        _id: true,
        projectId: true,
        isRealTime: true,
        isEnabled: true,
        sigmaRuleYaml: true,
        matchCountThreshold: true,
        distinctCountField: true,
        lastEvaluatedAt: true,
        evaluationIntervalInMinutes: true,
      },
    );

    const leaving: Array<ObjectID> = [];
    const entering: Array<RealTimeStart> = [];
    const now: Date = OneUptimeDate.getCurrentDate();

    for (const row of rows) {
      const isRealTime: boolean =
        data["isRealTime"] !== undefined
          ? readSwitch(data["isRealTime"])
          : row.isRealTime === true;
      const isEnabled: boolean =
        data["isEnabled"] !== undefined
          ? readSwitch(data["isEnabled"])
          : row.isEnabled !== false;

      if (!isRealTime) {
        if (row.isRealTime === true && row.id) {
          leaving.push(row.id);
        }

        continue;
      }

      if (
        isEnabled &&
        (row.isRealTime !== true || row.isEnabled === false) &&
        row.id &&
        row.projectId
      ) {
        entering.push({
          id: row.id,
          projectId: row.projectId,
          ...getRealTimeHandoverWindow({
            now,
            // A real-time rule turned back on reads from now: its schedule stopped long ago.
            lastEvaluatedAt:
              row.isRealTime === true
                ? OneUptimeDate.addRemoveSeconds(
                    now,
                    -DETECTION_EVALUATION_DELAY_IN_SECONDS,
                  )
                : row.lastEvaluatedAt,
            evaluationIntervalInMinutes: row.evaluationIntervalInMinutes,
          }),
        });
      }

      Service.assertRealTimeFits({
        ruleYaml:
          data["sigmaRuleYaml"] !== undefined
            ? String(data["sigmaRuleYaml"] || "")
            : row.sigmaRuleYaml,
        matchCountThreshold:
          data["matchCountThreshold"] !== undefined
            ? data["matchCountThreshold"]
            : row.matchCountThreshold,
        distinctCountField:
          data["distinctCountField"] !== undefined
            ? data["distinctCountField"]
            : row.distinctCountField,
      });

      if (row.isRealTime !== true && row.projectId) {
        await this.assertRealTimeRoom(row.projectId, row.id || undefined);
      }
    }

    return {
      ...(leaving.length > 0 ? { leavingRealTime: leaving } : {}),
      ...(entering.length > 0 ? { enteringRealTime: entering } : {}),
    };
  }

  /*
   * The handovers of rules that start to run in real time (RealTimeJobs).
   * Never throws: the rule is saved, and a handover that cannot be queued
   * is logged.
   */
  private async handOverToRealTime(
    starts: Array<RealTimeStart>,
  ): Promise<void> {
    for (const start of starts) {
      try {
        await RealTimeJobs.enqueueHandover({
          projectId: start.projectId,
          ruleId: start.id,
          startTime: start.startTime,
          endTime: start.endTime,
        });
      } catch (error) {
        logger.error(
          `DetectionRuleService: the handover of rule ${start.id.toString()} to real time could not be queued:`,
        );
        logger.error(error);
      }
    }
  }

  /*
   * Parse AND compile at save time, so a rule that stores is a rule the
   * engine can evaluate — a YAML typo surfaces to the person editing it,
   * not as a cron-side lastError hours later.
   *
   * A correlation is checked whole: its type, its timespan and condition,
   * every rule it reads - from its own YAML or, by Sigma id or name, from
   * the project's other detection rules - and each of those rules compiled.
   *
   * A rule that reads watchlists (`field|expand: '%vip_users%'`) is
   * compiled with the project's lists, so a list the project does not have
   * is refused by name, and a rule whose lists one read could not carry is
   * refused with what to do. Returns what was parsed.
   */
  private async validateSigmaRule(data: {
    ruleYaml: string | undefined;
    // Where references to other rules are looked up; read only when the YAML names one it does not hold.
    projectIds: () => Promise<Array<ObjectID>>;
    excludeRuleId?: ObjectID | undefined;
  }): Promise<DetectionRuleDefinition> {
    const ruleYaml: string | undefined = data.ruleYaml;

    if (!ruleYaml || !ruleYaml.trim()) {
      throw new BadDataException("Sigma rule YAML is required.");
    }

    let definition: DetectionRuleDefinition =
      SigmaRuleSetParser.parse(ruleYaml);

    if (
      definition.kind === "correlation" &&
      definition.unresolvedReferences.length > 0
    ) {
      const projectIds: Array<ObjectID> = await data.projectIds();

      if (projectIds.length === 0) {
        throw new BadDataException(
          "A correlation that reads your other detection rules needs the project it belongs to.",
        );
      }

      // Every project the write reaches must hold the rules it names.
      for (const projectId of projectIds) {
        definition = SigmaRuleSetParser.parse(ruleYaml, {
          resolveReference: await this.loadProjectRules(
            projectId,
            data.excludeRuleId,
          ),
        });
      }
    }

    if (getDetectionRuleWatchlistReferences(definition).length === 0) {
      for (const rule of sigmaRulesOf(definition)) {
        SigmaClickhouseCompiler.compile(rule);
      }

      return definition;
    }

    const projectIds: Array<ObjectID> = await data.projectIds();

    if (projectIds.length === 0) {
      throw new BadDataException(
        "A rule that reads watchlists needs the project it belongs to.",
      );
    }

    // Every project the write reaches must hold the lists it names.
    for (const projectId of projectIds) {
      const bound: DetectionRuleDefinition =
        await SecurityWatchlists.readerFor(projectId).bind(definition);

      for (const rule of sigmaRulesOf(bound)) {
        assertDetectionReadFits(SigmaClickhouseCompiler.compile(rule));
      }
    }

    return definition;
  }

  // The project's single Sigma rules, by Sigma id and name (SigmaRuleIndex).
  private async loadProjectRules(
    projectId: ObjectID,
    excludeRuleId: ObjectID | undefined,
  ): Promise<SigmaRuleReferenceResolver> {
    const rules: Array<Model> = await this.findAllBy({
      query: {
        projectId,
      },
      select: {
        _id: true,
        sigmaRuleYaml: true,
      },
      sort: {
        _id: SortOrder.Ascending,
      },
      props: {
        isRoot: true,
      },
    });

    return indexSigmaRules(
      rules.map((rule: Model): SigmaRuleSource => {
        return {
          id: rule._id?.toString(),
          sigmaRuleYaml: rule.sigmaRuleYaml,
        };
      }),
      { excludeRuleId: excludeRuleId?.toString() },
    );
  }

  // undefined always passes: an omitted field means "keep the default".
  private validateIntegerInRange(data: {
    value: number | undefined;
    min: number;
    max: number;
    message: string;
  }): void {
    if (data.value === undefined) {
      return;
    }

    if (
      !Number.isInteger(data.value) ||
      data.value < data.min ||
      data.value > data.max
    ) {
      throw new BadDataException(data.message);
    }
  }

  private validateEvaluationInterval(interval: number | undefined): void {
    this.validateIntegerInRange({
      value: interval,
      min: DETECTION_EVALUATION_INTERVAL_MIN_IN_MINUTES,
      max: DETECTION_EVALUATION_INTERVAL_MAX_IN_MINUTES,
      message: `Evaluation interval must be a whole number of minutes between ${DETECTION_EVALUATION_INTERVAL_MIN_IN_MINUTES} and ${DETECTION_EVALUATION_INTERVAL_MAX_IN_MINUTES}.`,
    });
  }

  private validateMatchCountThreshold(threshold: number | undefined): void {
    this.validateIntegerInRange({
      value: threshold,
      min: DETECTION_MATCH_COUNT_THRESHOLD_MIN,
      max: DETECTION_MATCH_COUNT_THRESHOLD_MAX,
      message: `Match count threshold must be a whole number between ${DETECTION_MATCH_COUNT_THRESHOLD_MIN} and ${DETECTION_MATCH_COUNT_THRESHOLD_MAX}.`,
    });
  }

  /*
   * A rule's own Risk Points: a whole number from 0 to 100, or empty (null)
   * for the points of its level (Types/SecurityCase/SecurityEntityRisk).
   */
  private validateRiskScore(riskScore: unknown): void {
    if (riskScore === null) {
      return;
    }

    this.validateIntegerInRange({
      value: riskScore as number | undefined,
      min: ENTITY_RISK_POINTS_MIN,
      max: ENTITY_RISK_POINTS_MAX,
      message: `Risk points must be a whole number between ${ENTITY_RISK_POINTS_MIN} and ${ENTITY_RISK_POINTS_MAX}, or empty for the points of the rule's level.`,
    });
  }

  protected override async onBeforeCreate(
    createBy: CreateBy<Model>,
  ): Promise<OnCreate<Model>> {
    await super.onBeforeCreate(createBy);

    const definition: DetectionRuleDefinition = await this.validateSigmaRule({
      ruleYaml: createBy.data.sigmaRuleYaml,
      projectIds: async (): Promise<Array<ObjectID>> => {
        const projectId: ObjectID | undefined =
          createBy.data.projectId ||
          (createBy.props.tenantId as ObjectID | undefined);
        return projectId ? [projectId] : [];
      },
    });
    this.validateEvaluationInterval(createBy.data.evaluationIntervalInMinutes);
    this.validateMatchCountThreshold(createBy.data.matchCountThreshold);
    this.validateRiskScore(createBy.data.riskScore);

    if (
      readSwitch(
        (createBy.data as unknown as JSONObject)["isRealTime"] as JSONValue,
      )
    ) {
      Service.assertRealTimeFits({
        ruleYaml: createBy.data.sigmaRuleYaml,
        matchCountThreshold: createBy.data.matchCountThreshold,
        distinctCountField: createBy.data.distinctCountField,
      });

      const projectId: ObjectID | undefined =
        createBy.data.projectId ||
        (createBy.props.tenantId as ObjectID | undefined);

      if (projectId) {
        await this.assertRealTimeRoom(projectId);
      }
    }

    /*
     * groupByField / distinctCountField are looked up verbatim: an
     * unknown name silently becomes an attributes[] lookup that yields
     * '' on every row, and for a distinct-count rule that means it never
     * fires again with no error anywhere. Trimming here kills the whole
     * whitespace-from-a-paste class of that outage; '' is preserved as
     * the documented "feature off" value so clearing the field still
     * works.
     */
    if (createBy.data.groupByField !== undefined) {
      createBy.data.groupByField = createBy.data.groupByField.trim();
    }

    if (createBy.data.distinctCountField !== undefined) {
      createBy.data.distinctCountField =
        createBy.data.distinctCountField.trim();
    }

    /*
     * Default the rule name from the Sigma title - a correlation's own
     * title - so pasting a rule is a one-field operation. Cut to fit the
     * name when the title is longer (Sigma allows 256 characters): a name
     * nobody typed never fails the save.
     */
    if (!createBy.data.name && createBy.data.sigmaRuleYaml) {
      createBy.data.name = fitDetectionRuleName(
        detectionRuleHeader(definition).title,
      );
    }

    return { createBy, carryForward: null };
  }

  protected override async onBeforeUpdate(
    updateBy: UpdateBy<Model>,
  ): Promise<OnUpdate<Model>> {
    await super.onBeforeUpdate(updateBy);

    if (updateBy.data.sigmaRuleYaml !== undefined) {
      await this.validateSigmaRule({
        ruleYaml: updateBy.data.sigmaRuleYaml as string,
        /*
         * A correlation naming other rules is checked against the rules of
         * the project each written row is in - read with the rows the
         * update writes, and the update held to them.
         */
        projectIds: async (): Promise<Array<ObjectID>> => {
          const rows: Array<Model> = await this.findRowsAndHoldUpdateToThem(
            updateBy,
            {
              _id: true,
              projectId: true,
            },
          );

          const ids: Map<string, ObjectID> = new Map();

          for (const row of rows) {
            if (row.projectId) {
              ids.set(row.projectId.toString(), row.projectId);
            }
          }

          return Array.from(ids.values());
        },
        excludeRuleId: Service.getOneRowIdNamedBy(updateBy.query) || undefined,
      });
    }

    this.validateEvaluationInterval(
      updateBy.data.evaluationIntervalInMinutes as number | undefined,
    );

    this.validateMatchCountThreshold(
      updateBy.data.matchCountThreshold as number | undefined,
    );

    this.validateRiskScore(
      (updateBy.data as unknown as { riskScore?: unknown }).riskScore,
    );

    // Same trim as onBeforeCreate — see the rationale there.
    if (updateBy.data.groupByField !== undefined) {
      updateBy.data.groupByField = (
        updateBy.data.groupByField as string
      ).trim();
    }

    if (updateBy.data.distinctCountField !== undefined) {
      updateBy.data.distinctCountField = (
        updateBy.data.distinctCountField as string
      ).trim();
    }

    const changes: RealTimeChanges = await this.checkRealTimeUpdate(updateBy);

    return {
      updateBy,
      carryForward: Object.keys(changes).length > 0 ? changes : null,
    };
  }

  /*
   * A rule created to run in real time gets its handover: the interval a
   * scheduled rule's first run reads, until every process screens for it.
   */
  protected override async onCreateSuccess(
    onCreate: OnCreate<Model>,
    createdItem: Model,
  ): Promise<Model> {
    const created: Model = await super.onCreateSuccess(onCreate, createdItem);

    if (
      created.isRealTime === true &&
      created.isEnabled !== false &&
      created.id &&
      created.projectId
    ) {
      await this.handOverToRealTime([
        {
          id: created.id,
          projectId: created.projectId,
          ...getRealTimeHandoverWindow({
            now: OneUptimeDate.getCurrentDate(),
            evaluationIntervalInMinutes: created.evaluationIntervalInMinutes,
          }),
        },
      ]);
    }

    return created;
  }

  /*
   * A rule back on its schedule starts it from now, two minutes behind the
   * clock as every run reads: what it would have read since its last
   * scheduled run, real time already did. Written after the update, as
   * OneUptime: nobody writes when a rule last ran.
   *
   * A rule that starts to run in real time gets its handover.
   */
  protected override async onUpdateSuccess(
    onUpdate: OnUpdate<Model>,
    updatedItemIds: Array<ObjectID>,
  ): Promise<OnUpdate<Model>> {
    const carried: RealTimeChanges | null =
      onUpdate.carryForward as RealTimeChanges | null;
    const leaving: Array<ObjectID> = carried?.leavingRealTime || [];
    const updated: Set<string> = new Set<string>(
      updatedItemIds.map((id: ObjectID): string => {
        return id.toString();
      }),
    );

    await this.handOverToRealTime(
      (carried?.enteringRealTime || []).filter(
        (start: RealTimeStart): boolean => {
          return updated.has(start.id.toString());
        },
      ),
    );

    if (leaving.length === 0) {
      return onUpdate;
    }

    const resumeFrom: Date = OneUptimeDate.addRemoveSeconds(
      OneUptimeDate.getCurrentDate(),
      -DETECTION_EVALUATION_DELAY_IN_SECONDS,
    );

    for (const id of leaving) {
      if (updated.has(id.toString())) {
        await this.updateColumnsByIdWithoutHooks({
          id,
          data: {
            lastEvaluatedAt: resumeFrom,
          },
        });
      }
    }

    return onUpdate;
  }
}

export default new Service();

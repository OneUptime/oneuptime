import ProjectReferencesService from "./ProjectReferencesService";
import Model from "../../Models/DatabaseModels/DetectionRule";
import CreateBy from "../Types/Database/CreateBy";
import UpdateBy from "../Types/Database/UpdateBy";
import { OnCreate, OnUpdate } from "../Types/Database/Hooks";
import BadDataException from "../../Types/Exception/BadDataException";
import ObjectID from "../../Types/ObjectID";
import SortOrder from "../../Types/BaseDatabase/SortOrder";
import {
  DETECTION_EVALUATION_INTERVAL_MAX_IN_MINUTES,
  DETECTION_EVALUATION_INTERVAL_MIN_IN_MINUTES,
  DETECTION_MATCH_COUNT_THRESHOLD_MAX,
  DETECTION_MATCH_COUNT_THRESHOLD_MIN,
} from "../../Types/SecurityEvent/DetectionFindingConstants";
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

export class Service extends ProjectReferencesService<Model> {
  public constructor() {
    super(Model);
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

    return { updateBy, carryForward: null };
  }
}

export default new Service();

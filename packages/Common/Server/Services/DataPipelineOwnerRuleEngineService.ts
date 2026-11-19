import DataPipeline from "../../Models/DatabaseModels/DataPipeline";
import DataPipelineOwnerRule from "../../Models/DatabaseModels/DataPipelineOwnerRule";
import DataPipelineOwnerTeam from "../../Models/DatabaseModels/DataPipelineOwnerTeam";
import DataPipelineOwnerUser from "../../Models/DatabaseModels/DataPipelineOwnerUser";
import DataPipelineOwnerRuleService from "./DataPipelineOwnerRuleService";
import DataPipelineOwnerTeamService from "./DataPipelineOwnerTeamService";
import DataPipelineOwnerUserService from "./DataPipelineOwnerUserService";
import DataPipelineService from "./DataPipelineService";
import ObjectID from "../../Types/ObjectID";
import Select from "../Types/Database/Select";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import logger, { LogAttributes } from "../Utils/Logger";
import { MAX_RULES_EVALUATED_PER_PROJECT } from "../../Utils/Rules/RuleEngineLimits";
import { RuleCriteriaMatcher } from "../../Utils/Rules/RuleCriteriaMatcher";
import logIfRuleReadWasTruncated from "../Utils/Rules/RuleEngineRuleRead";
import OwnerRuleAssignment, {
  OwnersAdded,
  OwnersToAssign,
} from "../Utils/Rules/OwnerRuleAssignment";
import OwnerRuleFeed from "../Utils/Rules/OwnerRuleFeed";
import {
  ApplyRulesToExistingResourceData,
  RuleApplicationResult,
  RuleApplicationResultUtil,
  RuleRunEngine,
  RuleRunWriteProps,
} from "../Utils/Rules/RuleRun/RuleApplication";
import DatabaseCommonInteractionProps from "../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import RulePatternMatchUtil from "../../Utils/Rules/RulePatternMatchUtil";
import { RuleEvaluation } from "../Utils/PatternWorkScope";

/*
 * PIPELINE OWNER RULES, APPLIED (#9527).
 *
 * The same evaluation as every owner rule (DataAssetOwnerRuleEngineService),
 * for a data pipeline: a rule matches a pipeline by a pattern of its name
 * and of its namespace - or by its conditions, which take those fields over
 * - and adds its people and teams as the pipeline's owners:
 *
 *   - when OneUptime first sees the pipeline (DataPipelineService's
 *     onCreateSuccess, from whichever ingest names it first: OpenLineage,
 *     dbt, Fivetran, Airbyte or a traced job), with every enabled rule of
 *     the project. A rule that cannot be read or applied is logged, and the
 *     pipeline is still recorded: ingestion never stops at a rule;
 *   - on Run Now (applyRulesToExistingResource), for the pipelines that
 *     already exist and only the rules being run, reporting what it did.
 *
 * An owner already on the pipeline is never added twice, and a rule's
 * Notify Owners decides whether the owners it adds are told. A pipeline has
 * no feed of its own, so who added an owner is in the pipeline's Audit Logs.
 */
class DataPipelineOwnerRuleEngineServiceClass
  implements RuleRunEngine<DataPipeline, DataPipelineOwnerRule>
{
  public readonly ruleSelect: Select<DataPipelineOwnerRule> = {
    _id: true,
    name: true,
    criteria: true,
    notifyOwners: true,
    nameRegexPattern: true,
    namespaceRegexPattern: true,
    ownerUsers: { _id: true },
    ownerTeams: { _id: true },
  };

  // Evaluation re-reads the pipeline, so a run only has to name it.
  public readonly resourceSelectForRuleRun: Select<DataPipeline> = {
    _id: true,
    projectId: true,
  };

  // The project's enabled rules, for a pipeline OneUptime has just seen.
  @CaptureSpan()
  public async applyRulesToDataPipeline(
    dataPipeline: DataPipeline,
  ): Promise<void> {
    if (!dataPipeline.id || !dataPipeline.projectId) {
      return;
    }

    try {
      const rules: Array<DataPipelineOwnerRule> =
        await DataPipelineOwnerRuleService.findBy({
          query: {
            projectId: dataPipeline.projectId,
            isEnabled: true,
          },
          props: { isRoot: true },
          select: this.ruleSelect,
          limit: MAX_RULES_EVALUATED_PER_PROJECT,
          skip: 0,
        });

      logIfRuleReadWasTruncated({
        ruleKind: "DataPipelineOwnerRule",
        projectId: dataPipeline.projectId,
        rulesRead: rules.length,
      });

      if (rules.length === 0) {
        return;
      }

      await this.applyRules({
        dataPipeline: dataPipeline,
        rules: rules,
        allowOwnerNotification: true,
      });
    } catch (error) {
      logger.error(`Error applying pipeline owner rules: ${error}`, {
        projectId: dataPipeline.projectId?.toString(),
        dataPipelineId: dataPipeline.id?.toString(),
      } as LogAttributes);
    }
  }

  /*
   * "Run now": the same evaluation, for a pipeline that already exists
   * and only the rules being run.
   */
  @CaptureSpan()
  public async applyRulesToExistingResource(
    data: ApplyRulesToExistingResourceData<DataPipeline, DataPipelineOwnerRule>,
  ): Promise<RuleApplicationResult> {
    try {
      return await this.applyRules({
        dataPipeline: data.resource,
        rules: data.rules,
        allowOwnerNotification: data.allowOwnerNotification,
        props: data.props,
      });
    } catch (error) {
      logger.error(`Error running pipeline owner rules: ${error}`, {
        projectId: data.resource.projectId?.toString(),
        dataPipelineId: data.resource.id?.toString(),
      } as LogAttributes);

      return RuleApplicationResultUtil.failed();
    }
  }

  @RuleEvaluation()
  private async applyRules(data: {
    dataPipeline: DataPipeline;
    rules: Array<DataPipelineOwnerRule>;
    allowOwnerNotification: boolean;
    // Who ran the rule (Run now); none for a rule applied when the pipeline is first seen.
    props?: DatabaseCommonInteractionProps | undefined;
  }): Promise<RuleApplicationResult> {
    const { dataPipeline, rules } = data;

    if (!dataPipeline.id || !dataPipeline.projectId || rules.length === 0) {
      return RuleApplicationResultUtil.noMatch();
    }

    const pipelineWithDetails: DataPipeline | null =
      await DataPipelineService.findOneById({
        id: dataPipeline.id,
        select: {
          jobName: true,
          jobNamespace: true,
        },
        props: { isRoot: true },
      });

    if (!pipelineWithDetails) {
      return RuleApplicationResultUtil.noMatch();
    }

    const usersByNotify: Map<boolean, Set<string>> = new Map([
      [true, new Set()],
      [false, new Set()],
    ]);
    const teamsByNotify: Map<boolean, Set<string>> = new Map([
      [true, new Set()],
      [false, new Set()],
    ]);

    const allUserIds: Set<string> = new Set();
    const allTeamIds: Set<string> = new Set();
    let anyRuleMatched: boolean = false;
    let anyOwnerToAdd: boolean = false;

    for (const rule of rules) {
      if (!this.doesMatchRule(pipelineWithDetails, rule)) {
        continue;
      }

      anyRuleMatched = true;

      const notify: boolean =
        rule.notifyOwners !== false && data.allowOwnerNotification;

      for (const user of rule.ownerUsers || []) {
        if (user.id) {
          usersByNotify.get(notify)!.add(user.id.toString());
          allUserIds.add(user.id.toString());
          anyOwnerToAdd = true;
        }
      }

      for (const team of rule.ownerTeams || []) {
        if (team.id) {
          teamsByNotify.get(notify)!.add(team.id.toString());
          allTeamIds.add(team.id.toString());
          anyOwnerToAdd = true;
        }
      }
    }

    if (!anyRuleMatched) {
      return RuleApplicationResultUtil.noMatch();
    }

    // The rules that matched name no owners, so there is nothing to add.
    if (!anyOwnerToAdd) {
      return RuleApplicationResultUtil.alreadyApplied();
    }

    // Owners already on the pipeline are skipped rather than duplicated.
    const notYetAssigned: OwnersToAssign =
      await OwnerRuleAssignment.getOwnersNotYetAssigned({
        ownerUserService: DataPipelineOwnerUserService,
        ownerTeamService: DataPipelineOwnerTeamService,
        resourceIdColumn: "dataPipelineId",
        resourceId: dataPipeline.id,
        userIds: Array.from(allUserIds),
        teamIds: Array.from(allTeamIds),
      });

    const userIdsToAdd: Set<string> = new Set(
      notYetAssigned.userIds.map((id: ObjectID): string => {
        return id.toString();
      }),
    );
    const teamIdsToAdd: Set<string> = new Set(
      notYetAssigned.teamIds.map((id: ObjectID): string => {
        return id.toString();
      }),
    );

    /*
     * What the adds did: the owners written, and the ones skipped and why -
     * a user who has left the project, a team that is not one of its teams
     * (#9933). The count, the result and the rules credited are made from
     * these.
     */
    const outcome: OwnersAdded = OwnerRuleAssignment.noOwnersAdded();

    /*
     * The notifying set goes first, so an owner two matching rules disagree
     * about is added once, and notified.
     */
    for (const notify of [true, false]) {
      const userIds: Array<string> = Array.from(
        usersByNotify.get(notify)!,
      ).filter((id: string): boolean => {
        return userIdsToAdd.delete(id);
      });
      const teamIds: Array<string> = Array.from(
        teamsByNotify.get(notify)!,
      ).filter((id: string): boolean => {
        return teamIdsToAdd.delete(id);
      });

      for (const userId of userIds) {
        const owner: DataPipelineOwnerUser = new DataPipelineOwnerUser();
        owner.dataPipelineId = dataPipeline.id;
        owner.projectId = dataPipeline.projectId;
        owner.userId = new ObjectID(userId);
        owner.isOwnerNotified = !notify;

        OwnerRuleAssignment.recordOutcome({
          into: outcome,
          ownerColumn: "userId",
          id: new ObjectID(userId),
          outcome: await OwnerRuleAssignment.createOwnerWithOutcome({
            ownerService: DataPipelineOwnerUserService,
            owner: owner,
            props: RuleRunWriteProps.get(data.props),
          }),
        });
      }

      for (const teamId of teamIds) {
        const owner: DataPipelineOwnerTeam = new DataPipelineOwnerTeam();
        owner.dataPipelineId = dataPipeline.id;
        owner.projectId = dataPipeline.projectId;
        owner.teamId = new ObjectID(teamId);
        owner.isOwnerNotified = !notify;

        OwnerRuleAssignment.recordOutcome({
          into: outcome,
          ownerColumn: "teamId",
          id: new ObjectID(teamId),
          outcome: await OwnerRuleAssignment.createOwnerWithOutcome({
            ownerService: DataPipelineOwnerTeamService,
            owner: owner,
            props: RuleRunWriteProps.get(data.props),
          }),
        });
      }
    }

    const ownersAdded: number = outcome.userIds.length + outcome.teamIds.length;

    OwnerRuleFeed.logSkipped({
      engine: "DataPipelineOwnerRuleEngine",
      record: `data pipeline ${dataPipeline.id.toString()}`,
      outcome: outcome,
      logAttributes: {
        projectId: dataPipeline.projectId.toString(),
      } as LogAttributes,
    });

    /*
     * Nothing added. When every owner its rules name was skipped, the run
     * could not update this resource: never "already applied", which would
     * say it has owners it does not (OwnerRuleFeed.getResult).
     */
    if (ownersAdded === 0) {
      return OwnerRuleFeed.getResult(outcome);
    }

    return RuleApplicationResultUtil.updated(ownersAdded);
  }

  private doesMatchRule(
    dataPipeline: DataPipeline,
    rule: DataPipelineOwnerRule,
  ): boolean {
    return RuleCriteriaMatcher.matchesWithLegacySync({
      rule,
      legacyFields: ["nameRegexPattern", "namespaceRegexPattern"],
      emptyResult: true,
      matchesLegacyRule: (legacyRule: DataPipelineOwnerRule): boolean => {
        return this.doesMatchLegacyRule(dataPipeline, legacyRule);
      },
    });
  }

  // Every pattern the rule sets must match; a rule that sets none matches every pipeline.
  private doesMatchLegacyRule(
    dataPipeline: DataPipeline,
    rule: DataPipelineOwnerRule,
  ): boolean {
    if (
      rule.nameRegexPattern &&
      (!dataPipeline.jobName ||
        !this.testRegex(rule.nameRegexPattern, dataPipeline.jobName))
    ) {
      return false;
    }

    if (
      rule.namespaceRegexPattern &&
      (!dataPipeline.jobNamespace ||
        !this.testRegex(rule.namespaceRegexPattern, dataPipeline.jobNamespace))
    ) {
      return false;
    }

    return true;
  }

  private testRegex(pattern: string, value: string): boolean {
    try {
      return RulePatternMatchUtil.testRegex(pattern, value);
    } catch {
      logger.warn(`Invalid regex in pipeline owner rule: ${pattern}`);
      return false;
    }
  }
}

export default new DataPipelineOwnerRuleEngineServiceClass();

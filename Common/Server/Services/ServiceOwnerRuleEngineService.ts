import Label from "../../Models/DatabaseModels/Label";
import Service from "../../Models/DatabaseModels/Service";
import ServiceOwnerRule from "../../Models/DatabaseModels/ServiceOwnerRule";
import ServiceOwnerUser from "../../Models/DatabaseModels/ServiceOwnerUser";
import ServiceOwnerTeam from "../../Models/DatabaseModels/ServiceOwnerTeam";
import ServiceOwnerRuleService from "./ServiceOwnerRuleService";
import ServiceOwnerUserService from "./ServiceOwnerUserService";
import ServiceOwnerTeamService from "./ServiceOwnerTeamService";
import ServiceService from "./ServiceService";
import ServiceFeedService from "./ServiceFeedService";
import { ServiceFeedEventType } from "../../Models/DatabaseModels/ServiceFeed";
import { Purple500 } from "../../Types/BrandColors";
import ObjectID from "../../Types/ObjectID";
import Select from "../Types/Database/Select";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import logger, { LogAttributes } from "../Utils/Logger";
import { MAX_RULES_EVALUATED_PER_PROJECT } from "../../Utils/Rules/RuleEngineLimits";
import { RuleCriteriaMatcher } from "../../Utils/Rules/RuleCriteriaMatcher";
import logIfRuleReadWasTruncated from "../Utils/Rules/RuleEngineRuleRead";
import OwnerRuleAssignment, {
  OwnersToAssign,
} from "../Utils/Rules/OwnerRuleAssignment";
import {
  ApplyRulesToExistingResourceData,
  RuleApplicationResult,
  RuleApplicationResultUtil,
  RuleRunEngine,
} from "../Utils/Rules/RuleRun/RuleApplication";

class ServiceOwnerRuleEngineServiceClass
  implements RuleRunEngine<Service, ServiceOwnerRule>
{
  public readonly ruleSelect: Select<ServiceOwnerRule> = {
    _id: true,
    name: true,
    criteria: true,
    notifyOwners: true,
    serviceLabels: { _id: true },
    serviceNamePattern: true,
    serviceDescriptionPattern: true,
    ownerUsers: { _id: true },
    ownerTeams: { _id: true },
  };

  // Evaluation re-reads the service, so a run only has to name it.
  public readonly resourceSelectForRuleRun: Select<Service> = {
    _id: true,
    projectId: true,
  };

  /**
   * Evaluates ServiceOwnerRule rows for the given service and adds matched
   * owner users / teams via ServiceOwnerUserService / ServiceOwnerTeamService. Rules
   * with notifyOwners set notify the added owners; rules with notifyOwners off
   * add silently.
   */
  @CaptureSpan()
  public async applyRulesToService(service: Service): Promise<void> {
    if (!service.id || !service.projectId) {
      return;
    }

    try {
      const rules: Array<ServiceOwnerRule> =
        await ServiceOwnerRuleService.findBy({
          query: {
            projectId: service.projectId,
            isEnabled: true,
          },
          props: { isRoot: true },
          select: this.ruleSelect,
          limit: MAX_RULES_EVALUATED_PER_PROJECT,
          skip: 0,
        });

      logIfRuleReadWasTruncated({
        ruleKind: "ServiceOwnerRule",
        projectId: service.projectId,
        rulesRead: rules.length,
      });

      if (rules.length === 0) {
        return;
      }

      await this.applyRules({
        service: service,
        rules: rules,
        allowOwnerNotification: true,
      });
    } catch (error) {
      logger.error(`Error applying service owner rules: ${error}`, {
        projectId: service.projectId?.toString(),
        serviceId: service.id?.toString(),
      } as LogAttributes);
    }
  }

  /*
   * "Run now": the same evaluation, for a service that already exists and
   * only the rules being run.
   */
  @CaptureSpan()
  public async applyRulesToExistingResource(
    data: ApplyRulesToExistingResourceData<Service, ServiceOwnerRule>,
  ): Promise<RuleApplicationResult> {
    try {
      return await this.applyRules({
        service: data.resource,
        rules: data.rules,
        allowOwnerNotification: data.allowOwnerNotification,
      });
    } catch (error) {
      logger.error(`Error running service owner rules: ${error}`, {
        projectId: data.resource.projectId?.toString(),
        serviceId: data.resource.id?.toString(),
      } as LogAttributes);

      return RuleApplicationResultUtil.failed();
    }
  }

  private async applyRules(data: {
    service: Service;
    rules: Array<ServiceOwnerRule>;
    allowOwnerNotification: boolean;
  }): Promise<RuleApplicationResult> {
    const { service, rules } = data;

    if (!service.id || !service.projectId || rules.length === 0) {
      return RuleApplicationResultUtil.noMatch();
    }

    const serviceWithDetails: Service | null = await ServiceService.findOneById(
      {
        id: service.id,
        select: {
          name: true,
          description: true,
          labels: { _id: true },
        },
        props: { isRoot: true },
      },
    );

    if (!serviceWithDetails) {
      return RuleApplicationResultUtil.noMatch();
    }

    /*
     * Service owner rows carry no notification flag and nothing notifies a
     * service owner on add, so the notify split below only decides which
     * rule an owner is attributed to - it changes nothing that is written.
     */
    const usersByNotify: Map<boolean, Set<string>> = new Map([
      [true, new Set()],
      [false, new Set()],
    ]);
    const teamsByNotify: Map<boolean, Set<string>> = new Map([
      [true, new Set()],
      [false, new Set()],
    ]);

    const matchedRules: Array<ServiceOwnerRule> = [];
    const allUserIds: Set<string> = new Set();
    const allTeamIds: Set<string> = new Set();
    let anyRuleMatched: boolean = false;

    for (const rule of rules) {
      const matches: boolean = this.doesServiceMatchRule(
        serviceWithDetails,
        rule,
      );
      if (!matches) {
        continue;
      }
      anyRuleMatched = true;
      let ruleAddedAny: boolean = false;
      const notify: boolean =
        rule.notifyOwners !== false && data.allowOwnerNotification;
      for (const user of rule.ownerUsers || []) {
        if (user.id) {
          usersByNotify.get(notify)!.add(user.id.toString());
          allUserIds.add(user.id.toString());
          ruleAddedAny = true;
        }
      }
      for (const team of rule.ownerTeams || []) {
        if (team.id) {
          teamsByNotify.get(notify)!.add(team.id.toString());
          allTeamIds.add(team.id.toString());
          ruleAddedAny = true;
        }
      }
      if (ruleAddedAny) {
        matchedRules.push(rule);
      }
    }

    if (!anyRuleMatched) {
      return RuleApplicationResultUtil.noMatch();
    }

    if (
      matchedRules.length === 0 ||
      (allUserIds.size === 0 && allTeamIds.size === 0)
    ) {
      return RuleApplicationResultUtil.alreadyApplied();
    }

    // Owners already on the service are skipped rather than duplicated.
    const notYetAssigned: OwnersToAssign =
      await OwnerRuleAssignment.getOwnersNotYetAssigned({
        ownerUserService: ServiceOwnerUserService,
        ownerTeamService: ServiceOwnerTeamService,
        resourceIdColumn: "serviceId",
        resourceId: service.id,
        userIds: Array.from(allUserIds),
        teamIds: Array.from(allTeamIds),
      });

    const userIdsToAdd: Set<string> = new Set(
      notYetAssigned.userIds.map((id: ObjectID) => {
        return id.toString();
      }),
    );
    const teamIdsToAdd: Set<string> = new Set(
      notYetAssigned.teamIds.map((id: ObjectID) => {
        return id.toString();
      }),
    );

    let ownersAdded: number = 0;

    for (const notify of [true, false]) {
      const userIds: Array<string> = Array.from(
        usersByNotify.get(notify)!,
      ).filter((id: string) => {
        return userIdsToAdd.delete(id);
      });
      const teamIds: Array<string> = Array.from(
        teamsByNotify.get(notify)!,
      ).filter((id: string) => {
        return teamIdsToAdd.delete(id);
      });

      for (const userId of userIds) {
        const owner: ServiceOwnerUser = new ServiceOwnerUser();
        owner.serviceId = service.id;
        owner.projectId = service.projectId;
        owner.userId = new ObjectID(userId);
        await ServiceOwnerUserService.create({
          data: owner,
          props: { isRoot: true },
        });
        ownersAdded++;
      }

      for (const teamId of teamIds) {
        const owner: ServiceOwnerTeam = new ServiceOwnerTeam();
        owner.serviceId = service.id;
        owner.projectId = service.projectId;
        owner.teamId = new ObjectID(teamId);
        await ServiceOwnerTeamService.create({
          data: owner,
          props: { isRoot: true },
        });
        ownersAdded++;
      }
    }

    if (ownersAdded === 0) {
      return RuleApplicationResultUtil.alreadyApplied();
    }

    logger.debug(
      `ServiceOwnerRuleEngine added owners to service ${service.id}`,
      { projectId: service.projectId.toString() } as LogAttributes,
    );
    /*
     * The individual OwnerUserAdded / OwnerTeamAdded items say who was added;
     * this one says which rule is responsible, which is what somebody asking
     * "why am I on the hook for this?" actually needs.
     */
    await ServiceFeedService.createServiceFeedItem({
      serviceId: service.id,
      projectId: service.projectId,
      serviceFeedEventType: ServiceFeedEventType.OwnerRuleExecuted,
      displayColor: Purple500,
      feedInfoInMarkdown: `👥 Owners were added to ${await ServiceService.getServiceMarkdownLink(
        service.projectId,
        service.id,
      )} by ${matchedRules.length} owner ${matchedRules.length === 1 ? "rule" : "rules"}.`,
      moreInformationInMarkdown: `**Owner rules that matched**: ${matchedRules
        .map((rule: ServiceOwnerRule) => {
          return rule.name || rule.id?.toString() || "Unnamed rule";
        })
        .map((name: string) => {
          return `\`${name}\``;
        })
        .join(", ")}`,
    });

    return RuleApplicationResultUtil.updated(ownersAdded);
  }

  private doesServiceMatchRule(
    service: Service,
    rule: ServiceOwnerRule,
  ): boolean {
    return RuleCriteriaMatcher.matchesWithLegacySync({
      rule: rule,
      legacyFields: [
        "serviceLabels",
        "serviceNamePattern",
        "serviceDescriptionPattern",
      ],
      emptyResult: true,
      matchesLegacyRule: (serviceRule: ServiceOwnerRule): boolean => {
        return this.doesServiceMatchRuleLegacy(service, serviceRule);
      },
    });
  }

  private doesServiceMatchRuleLegacy(
    service: Service,
    rule: ServiceOwnerRule,
  ): boolean {
    if (rule.serviceLabels && rule.serviceLabels.length > 0) {
      if (!service.labels || service.labels.length === 0) {
        return false;
      }
      const ruleLabelIds: Array<string> = rule.serviceLabels.map((l: Label) => {
        return l.id?.toString() || "";
      });
      const labelIds: Array<string> = service.labels.map((l: Label) => {
        return l.id?.toString() || "";
      });
      if (
        !ruleLabelIds.some((id: string) => {
          return labelIds.includes(id);
        })
      ) {
        return false;
      }
    }

    if (
      rule.serviceNamePattern &&
      (!service.name ||
        !this.testRegex(rule.serviceNamePattern, service.name, rule))
    ) {
      return false;
    }

    if (
      rule.serviceDescriptionPattern &&
      (!service.description ||
        !this.testRegex(
          rule.serviceDescriptionPattern,
          service.description,
          rule,
        ))
    ) {
      return false;
    }

    return true;
  }

  private testRegex(
    pattern: string,
    value: string,
    rule: ServiceOwnerRule,
  ): boolean {
    try {
      const regex: RegExp = new RegExp(pattern, "i");
      return regex.test(value);
    } catch {
      logger.warn(`Invalid regex in service owner rule ${rule.id}: ${pattern}`);
      return false;
    }
  }
}

export default new ServiceOwnerRuleEngineServiceClass();

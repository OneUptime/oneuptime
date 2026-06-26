import Label from "../../Models/DatabaseModels/Label";
import Service from "../../Models/DatabaseModels/Service";
import ServiceOwnerRule from "../../Models/DatabaseModels/ServiceOwnerRule";
import ServiceOwnerUser from "../../Models/DatabaseModels/ServiceOwnerUser";
import ServiceOwnerTeam from "../../Models/DatabaseModels/ServiceOwnerTeam";
import ServiceOwnerRuleService from "./ServiceOwnerRuleService";
import ServiceOwnerUserService from "./ServiceOwnerUserService";
import ServiceOwnerTeamService from "./ServiceOwnerTeamService";
import ServiceService from "./ServiceService";
import ObjectID from "../../Types/ObjectID";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import logger, { LogAttributes } from "../Utils/Logger";

class ServiceOwnerRuleEngineServiceClass {
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
          select: {
            _id: true,
            name: true,
            notifyOwners: true,
            serviceLabels: { _id: true },
            serviceNamePattern: true,
            serviceDescriptionPattern: true,
            ownerUsers: { _id: true },
            ownerTeams: { _id: true },
          },
          limit: 100,
          skip: 0,
        });

      if (rules.length === 0) {
        return;
      }

      const serviceWithDetails: Service | null =
        await ServiceService.findOneById({
          id: service.id,
          select: {
            name: true,
            description: true,
            labels: { _id: true },
          },
          props: { isRoot: true },
        });

      if (!serviceWithDetails) {
        return;
      }

      const usersByNotify: Map<boolean, Set<string>> = new Map([
        [true, new Set()],
        [false, new Set()],
      ]);
      const teamsByNotify: Map<boolean, Set<string>> = new Map([
        [true, new Set()],
        [false, new Set()],
      ]);

      const matchedRules: Array<ServiceOwnerRule> = [];

      for (const rule of rules) {
        const matches: boolean = this.doesServiceMatchRule(
          serviceWithDetails,
          rule,
        );
        if (!matches) {
          continue;
        }
        let ruleAddedAny: boolean = false;
        const notify: boolean = rule.notifyOwners !== false;
        for (const user of rule.ownerUsers || []) {
          if (user.id) {
            usersByNotify.get(notify)!.add(user.id.toString());
            ruleAddedAny = true;
          }
        }
        for (const team of rule.ownerTeams || []) {
          if (team.id) {
            teamsByNotify.get(notify)!.add(team.id.toString());
            ruleAddedAny = true;
          }
        }
        if (ruleAddedAny) {
          matchedRules.push(rule);
        }
      }

      if (matchedRules.length === 0) {
        return;
      }

      for (const notify of [true, false]) {
        const userIds: Set<string> = usersByNotify.get(notify)!;
        const teamIds: Set<string> = teamsByNotify.get(notify)!;

        for (const userId of userIds) {
          const owner: ServiceOwnerUser = new ServiceOwnerUser();
          owner.serviceId = service.id;
          owner.projectId = service.projectId;
          owner.userId = new ObjectID(userId);
          await ServiceOwnerUserService.create({
            data: owner,
            props: { isRoot: true },
          });
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
        }
      }

      logger.debug(
        `ServiceOwnerRuleEngine added owners to service ${service.id}`,
        { projectId: service.projectId.toString() } as LogAttributes,
      );
    } catch (error) {
      logger.error(`Error applying service owner rules: ${error}`, {
        projectId: service.projectId?.toString(),
        serviceId: service.id?.toString(),
      } as LogAttributes);
    }
  }

  private doesServiceMatchRule(
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

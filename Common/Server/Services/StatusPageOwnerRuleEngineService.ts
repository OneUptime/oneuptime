import Label from "../../Models/DatabaseModels/Label";
import StatusPage from "../../Models/DatabaseModels/StatusPage";
import StatusPageOwnerRule from "../../Models/DatabaseModels/StatusPageOwnerRule";
import StatusPageOwnerRuleService from "./StatusPageOwnerRuleService";
import StatusPageService from "./StatusPageService";
import ObjectID from "../../Types/ObjectID";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import logger, { LogAttributes } from "../Utils/Logger";

class StatusPageOwnerRuleEngineServiceClass {
  /**
   * Evaluates StatusPageOwnerRule rows for the given status page and adds
   * matched owner users / teams via StatusPageService.addOwners. Rules with
   * notifyOwners set notify the added owners; rules with notifyOwners off
   * add silently.
   */
  @CaptureSpan()
  public async applyRulesToStatusPage(statusPage: StatusPage): Promise<void> {
    if (!statusPage.id || !statusPage.projectId) {
      return;
    }

    try {
      const rules: Array<StatusPageOwnerRule> =
        await StatusPageOwnerRuleService.findBy({
          query: {
            projectId: statusPage.projectId,
            isEnabled: true,
          },
          props: { isRoot: true },
          select: {
            _id: true,
            name: true,
            notifyOwners: true,
            statusPageLabels: { _id: true },
            statusPageNamePattern: true,
            statusPageDescriptionPattern: true,
            ownerUsers: { _id: true },
            ownerTeams: { _id: true },
          },
          limit: 100,
          skip: 0,
        });

      if (rules.length === 0) {
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

      const matchedRules: Array<StatusPageOwnerRule> = [];
      const allUserIds: Set<string> = new Set();
      const allTeamIds: Set<string> = new Set();

      const statusPageWithDetails: StatusPage | null =
        await StatusPageService.findOneById({
          id: statusPage.id,
          select: {
            name: true,
            description: true,
            labels: { _id: true },
          },
          props: { isRoot: true },
        });

      if (!statusPageWithDetails) {
        return;
      }

      for (const rule of rules) {
        const matches: boolean = this.doesStatusPageMatchRule(
          statusPageWithDetails,
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

      if (matchedRules.length === 0) {
        return;
      }

      if (allUserIds.size === 0 && allTeamIds.size === 0) {
        return;
      }

      for (const notify of [true, false]) {
        const userIds: Array<ObjectID> = Array.from(
          usersByNotify.get(notify)!,
        ).map((id: string) => {
          return new ObjectID(id);
        });
        const teamIds: Array<ObjectID> = Array.from(
          teamsByNotify.get(notify)!,
        ).map((id: string) => {
          return new ObjectID(id);
        });

        if (userIds.length === 0 && teamIds.length === 0) {
          continue;
        }

        await StatusPageService.addOwners(
          statusPage.projectId,
          statusPage.id,
          userIds,
          teamIds,
          notify,
          { isRoot: true },
        );
      }

      logger.debug(
        `StatusPageOwnerRuleEngine added owners to status page ${statusPage.id}`,
        { projectId: statusPage.projectId.toString() } as LogAttributes,
      );
    } catch (error) {
      logger.error(`Error applying status page owner rules: ${error}`, {
        projectId: statusPage.projectId?.toString(),
        statusPageId: statusPage.id?.toString(),
      } as LogAttributes);
    }
  }

  private doesStatusPageMatchRule(
    statusPage: StatusPage,
    rule: StatusPageOwnerRule,
  ): boolean {
    if (rule.statusPageLabels && rule.statusPageLabels.length > 0) {
      if (!statusPage.labels || statusPage.labels.length === 0) {
        return false;
      }
      const ruleLabelIds: Array<string> = rule.statusPageLabels.map(
        (l: Label) => {
          return l.id?.toString() || "";
        },
      );
      const statusPageLabelIds: Array<string> = statusPage.labels.map(
        (l: Label) => {
          return l.id?.toString() || "";
        },
      );
      if (
        !ruleLabelIds.some((id: string) => {
          return statusPageLabelIds.includes(id);
        })
      ) {
        return false;
      }
    }

    if (
      rule.statusPageNamePattern &&
      (!statusPage.name ||
        !this.testRegex(rule.statusPageNamePattern, statusPage.name, rule))
    ) {
      return false;
    }

    if (
      rule.statusPageDescriptionPattern &&
      (!statusPage.description ||
        !this.testRegex(
          rule.statusPageDescriptionPattern,
          statusPage.description,
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
    rule: StatusPageOwnerRule,
  ): boolean {
    try {
      const regex: RegExp = new RegExp(pattern, "i");
      return regex.test(value);
    } catch {
      logger.warn(
        `Invalid regex in status page owner rule ${rule.id}: ${pattern}`,
      );
      return false;
    }
  }
}

export default new StatusPageOwnerRuleEngineServiceClass();

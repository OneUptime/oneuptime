import { AlertFeedEventType } from "../../../Models/DatabaseModels/AlertFeed";
import { IncidentFeedEventType } from "../../../Models/DatabaseModels/IncidentFeed";
import Label from "../../../Models/DatabaseModels/Label";
import OpenStackCloudLabelRule from "../../../Models/DatabaseModels/OpenStackCloudLabelRule";
import OpenStackCloudOwnerRule from "../../../Models/DatabaseModels/OpenStackCloudOwnerRule";
import Team from "../../../Models/DatabaseModels/Team";
import User from "../../../Models/DatabaseModels/User";
import { Indigo500 } from "../../../Types/BrandColors";
import LIMIT_MAX from "../../../Types/Database/LimitMax";
import ObjectID from "../../../Types/ObjectID";
import {
  OpenStackReachedProject,
  doesOpenStackRuleReach,
} from "../../../Types/OpenStack/OpenStackScopedRule";
import FeedMarkdown, {
  MarkdownText,
  mdText,
} from "../../../Utils/Markdown/FeedMarkdown";
import AlertFeedService from "../../Services/AlertFeedService";
import AlertOwnerTeamService from "../../Services/AlertOwnerTeamService";
import AlertOwnerUserService from "../../Services/AlertOwnerUserService";
import AlertService from "../../Services/AlertService";
import IncidentFeedService from "../../Services/IncidentFeedService";
import IncidentOwnerTeamService from "../../Services/IncidentOwnerTeamService";
import IncidentOwnerUserService from "../../Services/IncidentOwnerUserService";
import IncidentService from "../../Services/IncidentService";
import LabelService from "../../Services/LabelService";
import OpenStackCloudLabelRuleEngineService from "../../Services/OpenStackCloudLabelRuleEngineService";
import OpenStackCloudOwnerRuleEngineService from "../../Services/OpenStackCloudOwnerRuleEngineService";
import TeamService from "../../Services/TeamService";
import UserService from "../../Services/UserService";
import QueryHelper from "../../Types/Database/QueryHelper";
import logger, { LogAttributes } from "../Logger";
import OwnerRuleAssignment, {
  OwnersToAssign,
} from "../Rules/OwnerRuleAssignment";
import RuleFeedMarkdown from "../Rules/RuleFeedMarkdown";
import RuleRecordScope from "../Rules/RuleRecordScope";

/*
 * WHAT THE RULES ON A PROJECT OR DOMAIN ADD TO WHAT OPENS THERE.
 *
 * An owner or label rule of an OpenStack cloud that names a project or domain
 * (OpenStackScopedRule) adds to each alert and incident reaching it. Only a monitor's
 * series can say what an alert reaches, so this runs where a monitor opens one, in two
 * steps around the create: the labels go on the new row, so a rule further along that
 * matches on labels sees them, and the owners go on after, as the owners a monitor's
 * criteria names do.
 *
 * Never in the way of the alert: if any of this fails, it opens without them.
 */

export interface OpenStackScopedRuleOwners {
  notify: boolean;
  userIds: Array<string>;
  teamIds: Array<string>;
}

export interface OpenStackScopedRulesMatch {
  labelIds: Array<string>;
  labelRuleNames: Array<string>;
  // The notifying set first, so an owner two rules disagree about is told.
  owners: Array<OpenStackScopedRuleOwners>;
  ownerRuleNames: Array<string>;
}

function emptyMatch(): OpenStackScopedRulesMatch {
  return { labelIds: [], labelRuleNames: [], owners: [], ownerRuleNames: [] };
}

function idsOf(rows: Array<User | Team | Label> | undefined): Array<string> {
  return (rows || [])
    .map((row: User | Team | Label): string => {
      return row.id?.toString() || "";
    })
    .filter(Boolean);
}

function ruleName(rule: { name?: string | undefined }): string {
  return rule.name || "Unnamed Rule";
}

export default class OpenStackScopedRules {
  public static async read(data: {
    projectId: ObjectID;
    openStackCloudId: ObjectID | null;
    reached: ReadonlyArray<OpenStackReachedProject>;
  }): Promise<OpenStackScopedRulesMatch> {
    if (!data.openStackCloudId || data.reached.length === 0) {
      return emptyMatch();
    }

    const logAttributes: LogAttributes = {
      projectId: data.projectId.toString(),
      openStackCloudId: data.openStackCloudId.toString(),
    } as LogAttributes;

    try {
      const scope: { projectId: ObjectID; openStackCloudId: ObjectID } = {
        projectId: data.projectId,
        openStackCloudId: data.openStackCloudId,
      };

      const [allLabelRules, allOwnerRules]: [
        Array<OpenStackCloudLabelRule>,
        Array<OpenStackCloudOwnerRule>,
      ] = await Promise.all([
        OpenStackCloudLabelRuleEngineService.getScopedRulesForCloud(scope),
        OpenStackCloudOwnerRuleEngineService.getScopedRulesForCloud(scope),
      ]);

      const labelRules: Array<OpenStackCloudLabelRule> = allLabelRules.filter(
        (rule: OpenStackCloudLabelRule): boolean => {
          return (
            (rule.labelsToAdd || []).length > 0 &&
            doesOpenStackRuleReach(rule, data.reached)
          );
        },
      );
      const ownerRules: Array<OpenStackCloudOwnerRule> = allOwnerRules.filter(
        (rule: OpenStackCloudOwnerRule): boolean => {
          return (
            (rule.ownerUsers || []).length + (rule.ownerTeams || []).length >
              0 && doesOpenStackRuleReach(rule, data.reached)
          );
        },
      );

      const owners: Array<OpenStackScopedRuleOwners> = [true, false]
        .map((notify: boolean): OpenStackScopedRuleOwners => {
          const rules: Array<OpenStackCloudOwnerRule> = ownerRules.filter(
            (rule: OpenStackCloudOwnerRule): boolean => {
              return (rule.notifyOwners !== false) === notify;
            },
          );
          return {
            notify,
            userIds: Array.from(
              new Set(
                rules.flatMap(
                  (rule: OpenStackCloudOwnerRule): Array<string> => {
                    return idsOf(rule.ownerUsers);
                  },
                ),
              ),
            ),
            teamIds: Array.from(
              new Set(
                rules.flatMap(
                  (rule: OpenStackCloudOwnerRule): Array<string> => {
                    return idsOf(rule.ownerTeams);
                  },
                ),
              ),
            ),
          };
        })
        .filter((set: OpenStackScopedRuleOwners): boolean => {
          return set.userIds.length + set.teamIds.length > 0;
        });

      /*
       * Only the project's own labels. A rule's list is checked when it is saved, but one
       * saved before that can still name another project's, and an alert with such a label
       * would be refused.
       */
      const labelIds: Array<string> = await RuleRecordScope.keepIdsInProject({
        projectId: data.projectId,
        ids: Array.from(
          new Set(
            labelRules.flatMap(
              (rule: OpenStackCloudLabelRule): Array<string> => {
                return idsOf(rule.labelsToAdd);
              },
            ),
          ),
        ),
        modelType: Label,
        description: "labels of OpenStack cloud label rules",
        logAttributes,
      });

      return {
        labelIds,
        labelRuleNames: labelRules.map(ruleName),
        owners,
        ownerRuleNames: ownerRules.map(ruleName),
      };
    } catch (error) {
      logger.error(
        `Could not read the rules on an OpenStack project or domain: ${error instanceof Error ? error.message : String(error)}`,
        logAttributes,
      );
      return emptyMatch();
    }
  }

  // Beside what a monitor's criteria already put on the row it is about to create.
  public static addLabels(
    model: { labels?: Array<Label> | undefined },
    match: OpenStackScopedRulesMatch,
  ): void {
    if (match.labelIds.length === 0) {
      return;
    }

    const existing: Array<string> = idsOf(model.labels);
    const toAdd: Array<string> = match.labelIds.filter(
      (id: string): boolean => {
        return !existing.includes(id);
      },
    );

    model.labels = [
      ...(model.labels || []),
      ...toAdd.map((id: string): Label => {
        const label: Label = new Label();
        label._id = id;
        label.id = new ObjectID(id);
        return label;
      }),
    ];
  }

  public static async finishAlert(data: {
    projectId: ObjectID;
    alertId: ObjectID;
    match: OpenStackScopedRulesMatch;
  }): Promise<void> {
    if (!OpenStackScopedRules.hasAnything(data.match)) {
      return;
    }

    try {
      const { projectId, alertId, match } = data;

      const addedOwners: OwnersToAssign =
        await OwnerRuleAssignment.getOwnersNotYetAssigned({
          ownerUserService: AlertOwnerUserService,
          ownerTeamService: AlertOwnerTeamService,
          resourceIdColumn: "alertId",
          resourceId: alertId,
          userIds: match.owners.flatMap(
            (set: OpenStackScopedRuleOwners): Array<string> => {
              return set.userIds;
            },
          ),
          teamIds: match.owners.flatMap(
            (set: OpenStackScopedRuleOwners): Array<string> => {
              return set.teamIds;
            },
          ),
        });

      for (const set of match.owners) {
        await AlertService.addOwners(
          projectId,
          alertId,
          set.userIds.map((id: string): ObjectID => {
            return new ObjectID(id);
          }),
          set.teamIds.map((id: string): ObjectID => {
            return new ObjectID(id);
          }),
          set.notify,
          { isRoot: true },
        );
      }

      const said: {
        labels: MarkdownText | null;
        owners: MarkdownText | null;
      } = await OpenStackScopedRules.getFeedLines({
        subject: "alert",
        match,
        addedOwners,
      });

      if (said.labels) {
        await AlertFeedService.createAlertFeedItem({
          alertId,
          projectId,
          alertFeedEventType: AlertFeedEventType.LabelRuleExecuted,
          displayColor: Indigo500,
          feedInfoInMarkdown: said.labels.toString(),
        });
      }

      if (said.owners) {
        await AlertFeedService.createAlertFeedItem({
          alertId,
          projectId,
          alertFeedEventType: AlertFeedEventType.OwnerRuleExecuted,
          displayColor: Indigo500,
          feedInfoInMarkdown: said.owners.toString(),
        });
      }
    } catch (error) {
      logger.error(
        `Could not add what the rules on an OpenStack project or domain add to an alert: ${error instanceof Error ? error.message : String(error)}`,
        {
          projectId: data.projectId.toString(),
          alertId: data.alertId.toString(),
        } as LogAttributes,
      );
    }
  }

  public static async finishIncident(data: {
    projectId: ObjectID;
    incidentId: ObjectID;
    match: OpenStackScopedRulesMatch;
  }): Promise<void> {
    if (!OpenStackScopedRules.hasAnything(data.match)) {
      return;
    }

    try {
      const { projectId, incidentId, match } = data;

      const addedOwners: OwnersToAssign =
        await OwnerRuleAssignment.getOwnersNotYetAssigned({
          ownerUserService: IncidentOwnerUserService,
          ownerTeamService: IncidentOwnerTeamService,
          resourceIdColumn: "incidentId",
          resourceId: incidentId,
          userIds: match.owners.flatMap(
            (set: OpenStackScopedRuleOwners): Array<string> => {
              return set.userIds;
            },
          ),
          teamIds: match.owners.flatMap(
            (set: OpenStackScopedRuleOwners): Array<string> => {
              return set.teamIds;
            },
          ),
        });

      for (const set of match.owners) {
        await IncidentService.addOwners(
          projectId,
          incidentId,
          set.userIds.map((id: string): ObjectID => {
            return new ObjectID(id);
          }),
          set.teamIds.map((id: string): ObjectID => {
            return new ObjectID(id);
          }),
          set.notify,
          { isRoot: true },
        );
      }

      const said: {
        labels: MarkdownText | null;
        owners: MarkdownText | null;
      } = await OpenStackScopedRules.getFeedLines({
        subject: "incident",
        match,
        addedOwners,
      });

      if (said.labels) {
        await IncidentFeedService.createIncidentFeedItem({
          incidentId,
          projectId,
          incidentFeedEventType: IncidentFeedEventType.LabelRuleExecuted,
          displayColor: Indigo500,
          feedInfoInMarkdown: said.labels.toString(),
        });
      }

      if (said.owners) {
        await IncidentFeedService.createIncidentFeedItem({
          incidentId,
          projectId,
          incidentFeedEventType: IncidentFeedEventType.OwnerRuleExecuted,
          displayColor: Indigo500,
          feedInfoInMarkdown: said.owners.toString(),
        });
      }
    } catch (error) {
      logger.error(
        `Could not add what the rules on an OpenStack project or domain add to an incident: ${error instanceof Error ? error.message : String(error)}`,
        {
          projectId: data.projectId.toString(),
          incidentId: data.incidentId.toString(),
        } as LogAttributes,
      );
    }
  }

  private static hasAnything(match: OpenStackScopedRulesMatch): boolean {
    return match.labelIds.length > 0 || match.owners.length > 0;
  }

  // Which rules did this, and what they added: someone asking "why am I on this?" reads it.
  private static async getFeedLines(data: {
    subject: "alert" | "incident";
    match: OpenStackScopedRulesMatch;
    addedOwners: OwnersToAssign;
  }): Promise<{ labels: MarkdownText | null; owners: MarkdownText | null }> {
    const { subject, match, addedOwners } = data;

    const [labels, users, teams]: [Array<Label>, Array<User>, Array<Team>] =
      await Promise.all([
        match.labelIds.length > 0
          ? LabelService.findBy({
              query: { _id: QueryHelper.any(match.labelIds) },
              select: { name: true },
              props: { isRoot: true },
              limit: LIMIT_MAX,
              skip: 0,
            })
          : Promise.resolve([] as Array<Label>),
        addedOwners.userIds.length > 0
          ? UserService.findBy({
              query: { _id: QueryHelper.any(addedOwners.userIds) },
              select: { name: true, email: true },
              props: { isRoot: true },
              limit: LIMIT_MAX,
              skip: 0,
            })
          : Promise.resolve([] as Array<User>),
        addedOwners.teamIds.length > 0
          ? TeamService.findBy({
              query: { _id: QueryHelper.any(addedOwners.teamIds) },
              select: { name: true },
              props: { isRoot: true },
              limit: LIMIT_MAX,
              skip: 0,
            })
          : Promise.resolve([] as Array<Team>),
      ]);

    const labelNames: Array<MarkdownText> = labels.map(
      (label: Label): MarkdownText => {
        return mdText`${label.name || ""}`;
      },
    );

    return {
      labels:
        labelNames.length > 0
          ? mdText`${RuleFeedMarkdown.executedLine({
              emoji: "🏷️",
              ruleKind: "OpenStack Label Rule",
              ruleNames: match.labelRuleNames,
            })}\n\nAdded the following label${labelNames.length === 1 ? "" : "s"} to the ${subject}:\n${FeedMarkdown.bulletList(labelNames)}`
          : null,
      owners:
        users.length + teams.length > 0
          ? mdText`${RuleFeedMarkdown.executedLine({
              emoji: "🛡️",
              ruleKind: "OpenStack Owner Rule",
              ruleNames: match.ownerRuleNames,
            })}\n\nAssigned the following owner${users.length + teams.length === 1 ? "" : "s"} to the ${subject}:\n${RuleFeedMarkdown.ownersList({ users, teams })}`
          : null,
    };
  }
}

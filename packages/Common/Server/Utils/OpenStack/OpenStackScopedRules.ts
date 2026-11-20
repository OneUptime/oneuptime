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
import AlertService from "../../Services/AlertService";
import IncidentFeedService from "../../Services/IncidentFeedService";
import IncidentService from "../../Services/IncidentService";
import LabelService from "../../Services/LabelService";
import OpenStackCloudLabelRuleEngineService from "../../Services/OpenStackCloudLabelRuleEngineService";
import OpenStackCloudOwnerRuleEngineService from "../../Services/OpenStackCloudOwnerRuleEngineService";
import QueryHelper from "../../Types/Database/QueryHelper";
import logger, { LogAttributes } from "../Logger";
import OwnerRuleAssignment, { OwnersAdded } from "../Rules/OwnerRuleAssignment";
import OwnerRuleFeed from "../Rules/OwnerRuleFeed";
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
  /*
   * Which project brought each rule's owners in, and what it holds on the part: a hypervisor's
   * failure reaches many projects, and each owner wants to find their own among them.
   */
  ownersProjects?:
    | Array<{ ruleName: string; project: OpenStackReachedProject }>
    | undefined;
}

function emptyMatch(): OpenStackScopedRulesMatch {
  return {
    labelIds: [],
    labelRuleNames: [],
    owners: [],
    ownerRuleNames: [],
    ownersProjects: [],
  };
}

// Enough for a feed line. The incident's description has every project.
const OWNERS_PROJECTS_IN_A_FEED_LINE: number = 20;

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
        ownersProjects: ownerRules.flatMap(
          (
            rule: OpenStackCloudOwnerRule,
          ): Array<{ ruleName: string; project: OpenStackReachedProject }> => {
            return data.reached
              .filter((project: OpenStackReachedProject): boolean => {
                return doesOpenStackRuleReach(rule, [project]);
              })
              .map((project: OpenStackReachedProject) => {
                return { ruleName: ruleName(rule), project };
              });
          },
        ),
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

      /*
       * What addOwners actually did, set by set: the owners it wrote, and
       * the ones it skipped and why (#9933). One the alert has already is
       * in neither.
       */
      const outcome: OwnersAdded = OwnerRuleAssignment.noOwnersAdded();

      for (const set of match.owners) {
        OwnerRuleAssignment.addUp(
          outcome,
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
          ),
        );
      }

      OwnerRuleFeed.log({
        engine: "OpenStackScopedRules",
        record: `alert ${alertId.toString()}`,
        outcome: outcome,
        logAttributes: { projectId: projectId.toString() } as LogAttributes,
      });

      const said: {
        labels: MarkdownText | null;
        owners: MarkdownText | null;
      } = await OpenStackScopedRules.getFeedLines({
        projectId,
        subject: "alert",
        match,
        outcome,
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

      /*
       * What addOwners actually did, set by set: the owners it wrote, and
       * the ones it skipped and why (#9933). One the incident has already
       * is in neither.
       */
      const outcome: OwnersAdded = OwnerRuleAssignment.noOwnersAdded();

      for (const set of match.owners) {
        OwnerRuleAssignment.addUp(
          outcome,
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
          ),
        );
      }

      OwnerRuleFeed.log({
        engine: "OpenStackScopedRules",
        record: `incident ${incidentId.toString()}`,
        outcome: outcome,
        logAttributes: { projectId: projectId.toString() } as LogAttributes,
      });

      const said: {
        labels: MarkdownText | null;
        owners: MarkdownText | null;
      } = await OpenStackScopedRules.getFeedLines({
        projectId,
        subject: "incident",
        match,
        outcome,
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

  /*
   * Which rules did this, and what they added - and, apart, the owners they
   * name that were not added, and why (#9933): someone asking "why am I on
   * this?" reads it, and so does whoever keeps the rules.
   */
  private static async getFeedLines(data: {
    projectId: ObjectID;
    subject: "alert" | "incident";
    match: OpenStackScopedRulesMatch;
    outcome: OwnersAdded;
  }): Promise<{ labels: MarkdownText | null; owners: MarkdownText | null }> {
    const { subject, match, outcome } = data;

    const labels: Array<Label> =
      match.labelIds.length > 0
        ? await LabelService.findBy({
            query: { _id: QueryHelper.any(match.labelIds) },
            select: { name: true },
            props: { isRoot: true },
            limit: LIMIT_MAX,
            skip: 0,
          })
        : [];

    const labelNames: Array<MarkdownText> = labels.map(
      (label: Label): MarkdownText => {
        return mdText`${label.name || ""}`;
      },
    );

    const ownersProjects: Array<{
      ruleName: string;
      project: OpenStackReachedProject;
    }> = match.ownersProjects || [];

    const theirOwn: Array<MarkdownText> = ownersProjects
      .slice(0, OWNERS_PROJECTS_IN_A_FEED_LINE)
      .map(
        (one: {
          ruleName: string;
          project: OpenStackReachedProject;
        }): MarkdownText => {
          const name: string = one.project.name || one.project.projectId;

          return one.project.holdings
            ? mdText`${one.ruleName}: ${name}, ${one.project.holdings}`
            : mdText`${one.ruleName}: ${name}`;
        },
      );
    const left: number = ownersProjects.length - OWNERS_PROJECTS_IN_A_FEED_LINE;

    if (left > 0) {
      theirOwn.push(mdText`and ${left} more`);
    }

    return {
      labels:
        labelNames.length > 0
          ? mdText`${RuleFeedMarkdown.executedLine({
              emoji: "🏷️",
              ruleKind: "OpenStack Label Rule",
              ruleNames: match.labelRuleNames,
            })}\n\nAdded the following label${labelNames.length === 1 ? "" : "s"} to the ${subject}:\n${FeedMarkdown.bulletList(labelNames)}`
          : null,
      owners: OwnerRuleFeed.isEmpty(outcome)
        ? null
        : mdText`${RuleFeedMarkdown.executedLine({
            emoji: "🛡️",
            ruleKind: "OpenStack Owner Rule",
            ruleNames: match.ownerRuleNames,
          })}\n\n${await OwnerRuleFeed.readOutcome({
            projectId: data.projectId,
            recordNoun: subject,
            outcome: outcome,
          })}${
            theirOwn.length > 0
              ? mdText`\n\nWhich of this is each rule's own:\n${FeedMarkdown.bulletList(theirOwn)}`
              : FeedMarkdown.empty()
          }`,
    };
  }
}

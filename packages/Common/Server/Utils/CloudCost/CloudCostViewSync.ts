import CloudCostGroup from "../../../Models/DatabaseModels/CloudCostGroup";
import CloudCostView from "../../../Models/DatabaseModels/CloudCostView";
import Team from "../../../Models/DatabaseModels/Team";
import CloudCost from "../../../Models/AnalyticsModels/CloudCost";
import InBetween from "../../../Types/BaseDatabase/InBetween";
import Includes from "../../../Types/BaseDatabase/Includes";
import {
  CLOUD_COST_HISTORY_DAYS,
  addUtcDays,
  startOfUtcDay,
} from "../../../Types/Cloud/CloudCost";
import {
  CLOUD_COST_MAX_GROUPS_PER_VIEW,
  CloudCostViewGrouping,
} from "../../../Types/Cloud/CloudCostAllocation";
import {
  CloudCostRuleField,
  makeCloudCostRule,
} from "../../../Types/Cloud/CloudCostRules";
import { LIMIT_PER_PROJECT } from "../../../Types/Database/LimitMax";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import CloudCostGroupService from "../../Services/CloudCostGroupService";
import CloudCostService from "../../Services/CloudCostService";
import CloudCostViewService from "../../Services/CloudCostViewService";
import CloudResourceService from "../../Services/CloudResourceService";
import TeamService from "../../Services/TeamService";
import Query from "../../Types/AnalyticsDatabase/Query";
import { Statement } from "../AnalyticsDatabase/Statement";
import logger from "../Logger";
import CaptureSpan from "../Telemetry/CaptureSpan";
import { tagValuesStatement } from "./CloudCostAllocationQuery";

/*
 * THE GROUPS OF A VIEW ONEUPTIME MAKES, KEPT IN STEP WITH THE SPEND.
 *
 * A view made per tag value has a group for each value of its tag the
 * costs carry - the costliest first, as many as a view holds - and a view
 * made per owner team a group for each team that owns cloud resources,
 * linked to the team. Each group's rule is OneUptime's ("Tag team is
 * payments", "Owner team is Payments"), and what it was made for is kept
 * (CloudCostGroup.automaticKey), so a value or a team never gets a second
 * group. A group is never taken away: a value no longer seen keeps its
 * history, and a person may delete a group they do not want.
 *
 * Run when such a view is saved (CloudCostViewService), and every hour for
 * every such view (Workers' CloudCostViews job), as OneUptime.
 */

// Whether two keys name the same value: tag values compare as rules do.
function sameKey(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

// A name the view does not hold yet: the value's, then "(2)", "(3)"...
export function freeGroupName(data: {
  wanted: string;
  taken: Set<string>;
}): string {
  const base: string = data.wanted.trim().slice(0, 90) || "Untitled";

  if (!data.taken.has(base.toLowerCase())) {
    return base;
  }

  for (let number: number = 2; number < 1000; number++) {
    const candidate: string = `${base} (${number})`;

    if (!data.taken.has(candidate.toLowerCase())) {
      return candidate;
    }
  }

  return `${base} (${ObjectID.generate().toString().slice(0, 8)})`;
}

export class CloudCostViewSyncClass {
  // Each value the view's tag carries in the costs kept, the costliest first.
  @CaptureSpan()
  public async readTagValues(data: {
    projectId: ObjectID;
    tagKey: string;
    limit: number;
    now?: Date | undefined;
  }): Promise<Array<string>> {
    const today: Date = startOfUtcDay(data.now || new Date());
    const where: Statement = await CloudCostService.getScopedWhere({
      query: {
        projectId: data.projectId,
        day: new InBetween<Date>(
          addUtcDays(today, -CLOUD_COST_HISTORY_DAYS),
          addUtcDays(today, 1),
        ),
      } as Query<CloudCost>,
      props: { isRoot: true },
    });
    const result: { json: <T>() => Promise<T> } =
      (await CloudCostService.executeQuery(
        tagValuesStatement({
          ...CloudCostService.getTableReference(),
          where,
          tagKey: data.tagKey,
          limit: data.limit,
        }),
      )) as unknown as { json: <T>() => Promise<T> };
    const response: { data?: Array<JSONObject> } = await result.json<{
      data?: Array<JSONObject>;
    }>();

    return (response.data || [])
      .map((row: JSONObject): string => {
        return String(row["value"] ?? "").trim();
      })
      .filter((value: string): boolean => {
        return value.length > 0;
      });
  }

  // The teams that own a cloud resource of the project, by name.
  @CaptureSpan()
  public async readOwnerTeams(
    projectId: ObjectID,
  ): Promise<Array<{ id: string; name: string }>> {
    const rows: Array<{ teamId: string }> =
      await CloudResourceService.getRepository().manager.query(
        `SELECT DISTINCT o."teamId"::text AS "teamId"
           FROM "CloudResourceOwnerTeam" o
          WHERE o."projectId" = $1 AND o."deletedAt" IS NULL`,
        [projectId.toString()],
      );
    const ids: Array<string> = rows
      .map((row: { teamId: string }): string => {
        return String(row.teamId || "");
      })
      .filter((id: string): boolean => {
        return id.length > 0;
      });

    if (ids.length === 0) {
      return [];
    }

    const teams: Array<Team> = await TeamService.findBy({
      query: { projectId, _id: new Includes(ids) },
      select: { _id: true, name: true },
      props: { isRoot: true },
      skip: 0,
      limit: LIMIT_PER_PROJECT,
    });

    return teams
      .filter((team: Team): boolean => {
        return Boolean(team.id);
      })
      .map((team: Team) => {
        return { id: team.id!.toString().toLowerCase(), name: team.name || "" };
      })
      .sort((a: { name: string }, b: { name: string }): number => {
        return a.name.localeCompare(b.name);
      });
  }

  /*
   * Makes the groups a view made per tag value or owner team is missing,
   * and says how many it made. Nothing for a view written by hand.
   */
  @CaptureSpan()
  public async makeGroupsForView(
    viewId: ObjectID,
    now?: Date | undefined,
  ): Promise<number> {
    const view: CloudCostView | null = await CloudCostViewService.findOneById({
      id: viewId,
      select: { _id: true, projectId: true, grouping: true, tagKey: true },
      props: { isRoot: true },
    });

    if (
      !view?.id ||
      !view.projectId ||
      !view.grouping ||
      view.grouping === CloudCostViewGrouping.Rules
    ) {
      return 0;
    }

    const existing: Array<CloudCostGroup> = await CloudCostGroupService.findBy({
      query: { cloudCostViewId: view.id },
      select: { _id: true, name: true, automaticKey: true },
      props: { isRoot: true },
      skip: 0,
      limit: CLOUD_COST_MAX_GROUPS_PER_VIEW,
    });
    const takenNames: Set<string> = new Set(
      existing.map((group: CloudCostGroup): string => {
        return (group.name || "").trim().toLowerCase();
      }),
    );
    const madeFor: Array<string> = existing
      .map((group: CloudCostGroup): string => {
        return group.automaticKey || "";
      })
      .filter((key: string): boolean => {
        return key.length > 0;
      });
    const room: number = CLOUD_COST_MAX_GROUPS_PER_VIEW - existing.length;

    if (room <= 0) {
      return 0;
    }

    const wanted: Array<{
      key: string;
      name: string;
      field: CloudCostRuleField;
      teamId?: string | undefined;
      tagKey?: string | undefined;
    }> = [];

    if (view.grouping === CloudCostViewGrouping.TagValue && view.tagKey) {
      const values: Array<string> = await this.readTagValues({
        projectId: view.projectId,
        tagKey: view.tagKey,
        limit: CLOUD_COST_MAX_GROUPS_PER_VIEW,
        now,
      });

      for (const value of values) {
        wanted.push({
          key: value,
          name: value,
          field: CloudCostRuleField.Tag,
          tagKey: view.tagKey,
        });
      }
    }

    if (view.grouping === CloudCostViewGrouping.OwnerTeam) {
      for (const team of await this.readOwnerTeams(view.projectId)) {
        wanted.push({
          key: team.id,
          name: team.name || team.id,
          field: CloudCostRuleField.OwnerTeam,
          teamId: team.id,
        });
      }
    }

    let made: number = 0;

    for (const entry of wanted) {
      if (made >= room) {
        break;
      }

      if (
        madeFor.some((key: string): boolean => {
          return sameKey(key, entry.key);
        })
      ) {
        continue;
      }

      const group: CloudCostGroup = new CloudCostGroup();
      const name: string = freeGroupName({
        wanted: entry.name,
        taken: takenNames,
      });

      group.projectId = view.projectId;
      group.cloudCostViewId = view.id;
      group.name = name;
      group.automaticKey = entry.key;
      group.rules = [
        makeCloudCostRule({
          field: entry.field,
          value: entry.key,
          key: entry.tagKey,
        }),
      ];

      if (entry.teamId) {
        group.teamId = new ObjectID(entry.teamId);
      }

      try {
        await CloudCostGroupService.create({
          data: group,
          props: { isRoot: true },
        });
        takenNames.add(name.toLowerCase());
        madeFor.push(entry.key);
        made++;
      } catch (error) {
        logger.error(
          `A group for ${entry.key} could not be made in cost view ${view.id.toString()}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }

    await CloudCostViewService.updateOneById({
      id: view.id,
      data: { groupsMadeAt: now || new Date() },
      props: { isRoot: true },
    });

    return made;
  }

  // Every view made per tag value or owner team, kept in step (the hourly job).
  @CaptureSpan()
  public async makeGroupsForAllViews(): Promise<number> {
    const views: Array<CloudCostView> = await CloudCostViewService.findBy({
      query: {
        grouping: new Includes([
          CloudCostViewGrouping.TagValue,
          CloudCostViewGrouping.OwnerTeam,
        ]),
      },
      select: { _id: true },
      props: { isRoot: true },
      skip: 0,
      limit: 10000,
    });
    let made: number = 0;

    for (const view of views) {
      if (!view.id) {
        continue;
      }

      try {
        made += await this.makeGroupsForView(view.id);
      } catch (error) {
        logger.error(
          `Cost view ${view.id.toString()}'s groups could not be made: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }

    return made;
  }
}

export default new CloudCostViewSyncClass();

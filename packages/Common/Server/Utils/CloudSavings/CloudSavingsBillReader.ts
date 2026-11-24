import CloudResource from "../../../Models/DatabaseModels/CloudResource";
import CloudSavingsAction from "../../../Models/DatabaseModels/CloudSavingsAction";
import Includes from "../../../Types/BaseDatabase/Includes";
import AnalyticsTableName from "../../../Types/AnalyticsDatabase/AnalyticsTableName";
import TableColumnType from "../../../Types/AnalyticsDatabase/TableColumnType";
import {
  addUtcDays,
  getCloudCostResourceKey,
} from "../../../Types/Cloud/CloudCost";
import {
  CloudSavingsActionStatus,
  CloudSavingsMeasurement,
  CloudSavingsTarget,
} from "../../../Types/Cloud/CloudSavingsAction";
import {
  CloudSavingsCostRead,
  CloudSavingsJudgement,
  CloudSavingsMeasureWindows,
  getCloudSavingsMeasureWindows,
  judgeCloudSavings,
} from "../../../Types/Cloud/CloudSavingsMeasure";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import {
  DbJSONResponse,
  Results,
} from "../../Services/AnalyticsDatabaseService";
import CloudCostService from "../../Services/CloudCostService";
import CloudResourceService from "../../Services/CloudResourceService";
import CloudSavingsActionService from "../../Services/CloudSavingsActionService";
import { getQuerySettings } from "../AnalyticsDatabase/QuerySettingsHelper";
import { SQL, Statement } from "../AnalyticsDatabase/Statement";
import logger from "../Logger";

/*
 * PROVED BY THE BILL (#11010): after each read of a project's costs
 * (CloudConnectionLanes' cost lane), every change still being measured is
 * read against what its cloud billed its resource before and after it
 * (Types/Cloud/CloudSavingsMeasure). The Savings page's Saved this month
 * adds up only what the bill showed.
 *
 * A resource is billed under the id its cloud's bill names it by - an
 * ARN, an instance id, an ARM id, a full resource name - so each change is
 * looked for under each of those it has: the saving's own id, the bare id
 * its change was made to, and the id OneUptime holds the resource by.
 */

const COST_TABLE: string = AnalyticsTableName.CloudCost;

const COST_QUERY_SETTINGS: string = getQuerySettings({
  maxExecutionTimeInSeconds: 60,
  timeoutOverflowMode: "throw",
});

// The changes measured in one project in one run, at most.
export const CLOUD_SAVINGS_MEASURED_PER_RUN: number = 100;

export default class CloudSavingsBillReader {
  // The ids a change's resource may be billed under.
  public static getCostKeys(data: {
    action: CloudSavingsAction;
    providerResourceId?: string | undefined;
  }): Array<string> {
    const provider: string = String(data.action.provider || "");
    const target: CloudSavingsTarget | undefined = data.action.target as
      | CloudSavingsTarget
      | undefined;

    return Array.from(
      new Set<string>(
        [
          data.action.resourceId || "",
          target?.armId || "",
          target?.id || "",
          data.providerResourceId || "",
        ]
          .map((id: string): string => {
            return getCloudCostResourceKey(provider, id);
          })
          .filter((key: string): boolean => {
            return key.length > 0;
          }),
      ),
    );
  }

  public static buildCostStatement(data: {
    projectId: ObjectID;
    cloudAccountId: ObjectID;
    keys: Array<string>;
    windows: CloudSavingsMeasureWindows;
  }): Statement {
    const lastDay: Date = addUtcDays(data.windows.afterEnd, -1);
    const statement: Statement = SQL`SELECT sumIf(cost, resourceId IN ${{
      type: TableColumnType.Text,
      value: new Includes(data.keys),
    }} AND day >= ${{
      type: TableColumnType.Date,
      value: data.windows.beforeStart,
    }} AND day < ${{
      type: TableColumnType.Date,
      value: data.windows.beforeEnd,
    }}) AS beforeTotal, uniqExactIf(toDate(day, 'UTC'), resourceId IN ${{
      type: TableColumnType.Text,
      value: new Includes(data.keys),
    }} AND day >= ${{
      type: TableColumnType.Date,
      value: data.windows.beforeStart,
    }} AND day < ${{
      type: TableColumnType.Date,
      value: data.windows.beforeEnd,
    }} AND cost != 0) AS beforeDays, sumIf(cost, resourceId IN ${{
      type: TableColumnType.Text,
      value: new Includes(data.keys),
    }} AND day >= ${{
      type: TableColumnType.Date,
      value: data.windows.afterStart,
    }} AND day < ${{
      type: TableColumnType.Date,
      value: data.windows.afterEnd,
    }}) AS afterTotal, countIf(day >= ${{
      type: TableColumnType.Date,
      value: lastDay,
    }} AND day < ${{
      type: TableColumnType.Date,
      value: data.windows.afterEnd,
    }}) AS lastDayRows FROM ${COST_TABLE} WHERE projectId = ${{
      type: TableColumnType.ObjectID,
      value: data.projectId,
    }} AND cloudAccountId = ${{
      type: TableColumnType.ObjectID,
      value: data.cloudAccountId,
    }} AND day >= ${{
      type: TableColumnType.Date,
      value: data.windows.beforeStart,
    }}`;

    statement.append(COST_QUERY_SETTINGS);

    return statement;
  }

  public static readCostRow(
    row: JSONObject | undefined,
    windows: CloudSavingsMeasureWindows,
  ): CloudSavingsCostRead {
    const number: (value: unknown) => number = (value: unknown): number => {
      const parsed: number = Number(value);
      return Number.isFinite(parsed) ? parsed : 0;
    };

    return {
      beforeTotal: number(row?.["beforeTotal"]),
      beforeDays: Math.round(number(row?.["beforeDays"])),
      afterTotal: number(row?.["afterTotal"]),
      isAccountReadThrough:
        windows.afterDays > 0 && number(row?.["lastDayRows"]) > 0,
    };
  }

  // The changes of a project still being measured, measured. Never throws.
  public static async measureProject(data: {
    projectId: ObjectID;
    now: Date;
  }): Promise<number> {
    let measured: number = 0;

    try {
      const actions: Array<CloudSavingsAction> =
        await CloudSavingsActionService.findBy({
          query: {
            projectId: data.projectId,
            measurement: CloudSavingsMeasurement.Measuring,
            status: new Includes([
              CloudSavingsActionStatus.Applied,
              CloudSavingsActionStatus.AppliedWithoutAsking,
              CloudSavingsActionStatus.Undone,
            ]),
          },
          select: {
            _id: true,
            cloudAccountId: true,
            cloudResourceId: true,
            provider: true,
            resourceId: true,
            target: true,
            monthlySavings: true,
            appliedAt: true,
            undoneAt: true,
          },
          skip: 0,
          limit: CLOUD_SAVINGS_MEASURED_PER_RUN,
          props: { isRoot: true },
        });

      for (const action of actions) {
        if (await CloudSavingsBillReader.measure({ action, now: data.now })) {
          measured++;
        }
      }
    } catch (error) {
      logger.error(
        `Cloud savings: the changes of project ${data.projectId.toString()} could not be read against the bill: ${error}`,
      );
    }

    return measured;
  }

  public static async measure(data: {
    action: CloudSavingsAction;
    now: Date;
  }): Promise<boolean> {
    const action: CloudSavingsAction = data.action;

    if (!action.id || !action.appliedAt || !action.cloudAccountId) {
      return false;
    }

    const resource: CloudResource | null = action.cloudResourceId
      ? await CloudResourceService.findOneById({
          id: action.cloudResourceId,
          select: { providerResourceId: true },
          props: { isRoot: true },
        })
      : null;
    const keys: Array<string> = CloudSavingsBillReader.getCostKeys({
      action,
      providerResourceId: resource?.providerResourceId,
    });
    const appliedAt: Date = new Date(action.appliedAt);
    const windows: CloudSavingsMeasureWindows = getCloudSavingsMeasureWindows({
      appliedAt,
      now: data.now,
      undoneAt: action.undoneAt,
    });
    let row: JSONObject | undefined = undefined;

    if (keys.length > 0) {
      const result: Results = await CloudCostService.executeQuery(
        CloudSavingsBillReader.buildCostStatement({
          projectId: action.projectId || new ObjectID(""),
          cloudAccountId: action.cloudAccountId,
          keys,
          windows,
        }),
      );
      const response: DbJSONResponse = await result.json<{
        data?: Array<JSONObject>;
      }>();

      row = ((response.data || []) as Array<JSONObject>)[0];
    }

    const judgement: CloudSavingsJudgement = judgeCloudSavings({
      windows,
      costs: CloudSavingsBillReader.readCostRow(row, windows),
      promisedMonthly: Number(action.monthlySavings) || 0,
      appliedAt,
      now: data.now,
    });

    await CloudSavingsActionService.updateOneById({
      id: action.id,
      data: {
        measurement: judgement.measurement,
        measuredAt: data.now,
        ...(judgement.costBeforeDaily !== undefined
          ? { costBeforeDaily: judgement.costBeforeDaily }
          : {}),
        ...(judgement.costAfterDaily !== undefined
          ? { costAfterDaily: judgement.costAfterDaily }
          : {}),
        ...(judgement.realisedMonthlySavings !== undefined
          ? { realisedMonthlySavings: judgement.realisedMonthlySavings }
          : {}),
      } as never,
      props: { isRoot: true, ignoreHooks: true },
    });

    return judgement.measurement !== CloudSavingsMeasurement.Measuring;
  }
}

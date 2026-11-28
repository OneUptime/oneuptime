import type DatabaseService from "../../../../Server/Services/DatabaseService";
import MonitorService from "../../../../Server/Services/MonitorService";
import OpenStackBudgetService from "../../../../Server/Services/OpenStackBudgetService";
import OpenStackCloudService from "../../../../Server/Services/OpenStackCloudService";
import WorkspaceNotificationSummaryService from "../../../../Server/Services/WorkspaceNotificationSummaryService";
import RecordPageFieldsReader from "../../../../Server/Utils/Database/RecordPageFieldsReader";
import BaseModel from "../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import OpenStackBudget from "../../../../Models/DatabaseModels/OpenStackBudget";
import OpenStackCloud from "../../../../Models/DatabaseModels/OpenStackCloud";
import WorkspaceNotificationSummary from "../../../../Models/DatabaseModels/WorkspaceNotificationSummary";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { RecordPageFields } from "../../../../Types/Database/RecordPageFields";
import NotAuthorizedException from "../../../../Types/Exception/NotAuthorizedException";
import ObjectID from "../../../../Types/ObjectID";
import WorkspaceNotificationSummaryType from "../../../../Types/Workspace/NotificationSummary/WorkspaceNotificationSummaryType";
import WorkspaceType from "../../../../Types/Workspace/WorkspaceType";
import { getJestSpyOn } from "../../../Spy";
import { afterEach, describe, expect, jest, test } from "@jest/globals";

/*
 * WHAT THE PAGES OF THE RECORDS A ROUTE NAMES NEED, READ FOR ONE READER
 * (#11020, RecordPageFieldsReader).
 *
 *   - An OpenStack budget's page is its cloud's Spend page: its
 *     openStackCloudId, sent only when the reader may read that cloud.
 *   - A workspace summary's page is its workspace's: its workspaceType and
 *     summaryType.
 *   - Read with the reader's own props, in the request's project: a column
 *     they may not read is refused, and nothing is sent; a cloud they may
 *     not read is never named, so the budget has no link.
 *   - A kind whose page needs only its id reads nothing; an id that is not
 *     one is never asked for; nothing here throws.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111011020",
);

const READER: DatabaseCommonInteractionProps = {
  userId: new ObjectID("22222222-2222-4222-8222-222222011020"),
  tenantId: PROJECT_ID,
} as DatabaseCommonInteractionProps;

const BUDGET: string = "b0000000-0000-4000-8000-000000011020";
const SECOND_BUDGET: string = "b1111111-0000-4000-8000-000000011020";
const CLOUD: string = "c0000000-0000-4000-8000-000000011020";
const HIDDEN_CLOUD: string = "c1111111-0000-4000-8000-000000011020";
const SUMMARY: string = "50000000-0000-4000-8000-000000011020";

interface RawOperator {
  objectLiteralParameters: Record<string, unknown>;
}

interface RecordedFind {
  query: Record<string, unknown>;
  select: Record<string, unknown>;
  limit: number;
  props: DatabaseCommonInteractionProps;
}

function askedIds(find: RecordedFind): Array<string> {
  const ids: unknown = Object.values(
    (find.query["_id"] as RawOperator).objectLiteralParameters,
  )[0];

  return (Array.isArray(ids) ? ids : []).map((value: unknown): string => {
    return String(value).toLowerCase();
  });
}

function stubFind<T>(
  service: unknown,
  answer: Array<T> | Error,
): Array<RecordedFind> {
  const finds: Array<RecordedFind> = [];

  getJestSpyOn(service as typeof MonitorService, "findBy").mockImplementation(
    (async (findBy: RecordedFind): Promise<Array<T>> => {
      finds.push(findBy);

      if (answer instanceof Error) {
        throw answer;
      }

      return answer;
    }) as never,
  );

  return finds;
}

function budget(id: string, cloudId: string | null): OpenStackBudget {
  const model: OpenStackBudget = new OpenStackBudget(new ObjectID(id));
  if (cloudId) {
    model.openStackCloudId = new ObjectID(cloudId);
  }
  return model;
}

const getServiceOfTable: (
  tableName: string,
) => DatabaseService<BaseModel> | null = (
  tableName: string,
): DatabaseService<BaseModel> | null => {
  return tableName === "OpenStackCloud"
    ? (OpenStackCloudService as unknown as DatabaseService<BaseModel>)
    : null;
};

function read(
  service: unknown,
  ids: Array<string>,
): Promise<Map<string, RecordPageFields>> {
  return RecordPageFieldsReader.read({
    service: service as DatabaseService<BaseModel>,
    projectId: PROJECT_ID,
    ids: ids,
    props: READER,
    getServiceOfTable: getServiceOfTable,
  });
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("an OpenStack budget", () => {
  test("is sent its cloud's id, when the reader may read that cloud", async () => {
    const budgetFinds: Array<RecordedFind> = stubFind(OpenStackBudgetService, [
      budget(BUDGET, CLOUD.toUpperCase()),
    ]);
    const cloudFinds: Array<RecordedFind> = stubFind(OpenStackCloudService, [
      new OpenStackCloud(new ObjectID(CLOUD)),
    ]);

    const fields: Map<string, RecordPageFields> = await read(
      OpenStackBudgetService,
      [BUDGET.toUpperCase()],
    );

    expect(Object.fromEntries(fields)).toEqual({
      [BUDGET]: { openStackCloudId: CLOUD },
    });

    // The budget, read with the reader's own props, in the project.
    expect(budgetFinds).toHaveLength(1);
    expect(budgetFinds[0]!.props).toBe(READER);
    expect(budgetFinds[0]!.query["projectId"]).toEqual(PROJECT_ID);
    expect(budgetFinds[0]!.select).toEqual({
      _id: true,
      openStackCloudId: true,
    });
    expect(askedIds(budgetFinds[0]!)).toEqual([BUDGET]);

    // Then its cloud, the same way: only its id.
    expect(cloudFinds).toHaveLength(1);
    expect(cloudFinds[0]!.props).toBe(READER);
    expect(cloudFinds[0]!.query["projectId"]).toEqual(PROJECT_ID);
    expect(cloudFinds[0]!.select).toEqual({ _id: true });
    expect(askedIds(cloudFinds[0]!)).toEqual([CLOUD]);
  });

  test("a cloud the reader may not read is never named: its budget has no link", async () => {
    stubFind(OpenStackBudgetService, [
      budget(BUDGET, CLOUD),
      budget(SECOND_BUDGET, HIDDEN_CLOUD),
    ]);
    // The reader reads one of the two clouds.
    const cloudFinds: Array<RecordedFind> = stubFind(OpenStackCloudService, [
      new OpenStackCloud(new ObjectID(CLOUD)),
    ]);

    const fields: Map<string, RecordPageFields> = await read(
      OpenStackBudgetService,
      [BUDGET, SECOND_BUDGET],
    );

    expect(Object.fromEntries(fields)).toEqual({
      [BUDGET]: { openStackCloudId: CLOUD },
    });
    expect(JSON.stringify(Object.fromEntries(fields))).not.toContain(
      HIDDEN_CLOUD,
    );
    // Both clouds asked about, each once.
    expect(askedIds(cloudFinds[0]!).sort()).toEqual([CLOUD, HIDDEN_CLOUD]);
  });

  test("a reader who may not read clouds at all links no budget", async () => {
    stubFind(OpenStackBudgetService, [budget(BUDGET, CLOUD)]);
    stubFind(
      OpenStackCloudService,
      new NotAuthorizedException("You may not read OpenStack clouds."),
    );

    expect((await read(OpenStackBudgetService, [BUDGET])).size).toBe(0);
  });

  test("a reader who may not read the budget's cloud column is sent nothing", async () => {
    stubFind(
      OpenStackBudgetService,
      new NotAuthorizedException(
        "You do not have permissions to select on - openStackCloudId.",
      ),
    );
    const cloudFinds: Array<RecordedFind> = stubFind(OpenStackCloudService, []);

    expect((await read(OpenStackBudgetService, [BUDGET])).size).toBe(0);
    expect(cloudFinds).toHaveLength(0);
  });

  test("a budget with no cloud has no link, and no cloud is read for it", async () => {
    stubFind(OpenStackBudgetService, [budget(BUDGET, null)]);
    const cloudFinds: Array<RecordedFind> = stubFind(OpenStackCloudService, []);

    expect((await read(OpenStackBudgetService, [BUDGET])).size).toBe(0);
    expect(cloudFinds).toHaveLength(0);
  });

  test("with no service for the parent's kind, nothing is linked", async () => {
    stubFind(OpenStackBudgetService, [budget(BUDGET, CLOUD)]);

    const fields: Map<string, RecordPageFields> =
      await RecordPageFieldsReader.read({
        service:
          OpenStackBudgetService as unknown as DatabaseService<BaseModel>,
        projectId: PROJECT_ID,
        ids: [BUDGET],
        props: READER,
        getServiceOfTable: (): null => {
          return null;
        },
      });

    expect(fields.size).toBe(0);
  });
});

describe("a workspace notification summary", () => {
  test("is sent its workspace and its type", async () => {
    const summary: WorkspaceNotificationSummary =
      new WorkspaceNotificationSummary(new ObjectID(SUMMARY));
    summary.workspaceType = WorkspaceType.MicrosoftTeams;
    summary.summaryType = WorkspaceNotificationSummaryType.AlertEpisode;

    const finds: Array<RecordedFind> = stubFind(
      WorkspaceNotificationSummaryService,
      [summary],
    );

    const fields: Map<string, RecordPageFields> = await read(
      WorkspaceNotificationSummaryService,
      [SUMMARY],
    );

    expect(Object.fromEntries(fields)).toEqual({
      [SUMMARY]: {
        workspaceType: "MicrosoftTeams",
        summaryType: "Alert Episode",
      },
    });
    expect(finds[0]!.props).toBe(READER);
    expect(finds[0]!.select).toEqual({
      _id: true,
      workspaceType: true,
      summaryType: true,
    });
  });

  test("one whose fields are not all there has no link", async () => {
    const summary: WorkspaceNotificationSummary =
      new WorkspaceNotificationSummary(new ObjectID(SUMMARY));
    summary.workspaceType = WorkspaceType.Slack;

    stubFind(WorkspaceNotificationSummaryService, [summary]);

    expect(
      (await read(WorkspaceNotificationSummaryService, [SUMMARY])).size,
    ).toBe(0);
  });
});

describe("what is never read", () => {
  test("a kind whose page needs only its id reads nothing", async () => {
    const finds: Array<RecordedFind> = stubFind(MonitorService, []);

    expect((await read(MonitorService, [BUDGET])).size).toBe(0);
    expect(finds).toHaveLength(0);
  });

  test("no ids, or none that is an id, reads nothing", async () => {
    const finds: Array<RecordedFind> = stubFind(OpenStackBudgetService, []);

    expect((await read(OpenStackBudgetService, [])).size).toBe(0);
    expect(
      (await read(OpenStackBudgetService, ["", "not-an-id", "1 OR 1=1"])).size,
    ).toBe(0);
    expect(finds).toHaveLength(0);
  });

  test("an id given twice is asked for once", async () => {
    const finds: Array<RecordedFind> = stubFind(OpenStackBudgetService, []);
    stubFind(OpenStackCloudService, []);

    await read(OpenStackBudgetService, [BUDGET, BUDGET.toUpperCase()]);

    expect(askedIds(finds[0]!)).toEqual([BUDGET]);
    expect(finds[0]!.limit).toBe(1);
  });
});

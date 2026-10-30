import DataSecurityIssueService from "../../../Server/Services/DataSecurityIssueService";
import DataStoreService, {
  DELETED_STORE_WHY,
} from "../../../Server/Services/DataStoreService";
import DatabaseService from "../../../Server/Services/DatabaseService";
import DataSecurityIssueAlerts from "../../../Server/Utils/DataSecurity/DataSecurityIssueAlerts";
import logger from "../../../Server/Utils/Logger";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import DataSecurityIssueStatus from "../../../Types/DataSecurity/DataSecurityIssueStatus";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import SecuritySeverity from "../../../Types/SecuritySeverity";
import { customDomainCaller } from "../API/CustomDomainCallers";
import {
  InMemoryTable,
  useInMemoryTable,
} from "../TestingUtils/InMemoryRepository";
import { ON_HIGHEST_PLAN } from "../TestingUtils/RequestPlan";
import { stubProjectDirectory } from "../TestingUtils/ProjectDirectory";
import { getJestSpyOn } from "../../Spy";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { SpyInstance } from "jest-mock";

/*
 * A DELETED STORE'S ALERTS END WITH ITS ISSUES.
 *
 * A Critical issue can raise an alert that pages whoever is on call, and
 * the alert ends with the issue (DataSecurityIssueAlerts). A store a
 * person deletes takes its issues with it, so an open one's alert would
 * page on for an issue nobody can see: the delete resolves it. The issues
 * are read before the delete, as they go with the store, and their alerts
 * are resolved after it, for the stores it removed. These run the whole
 * delete, as a person who may make it.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const STORE_ID: string = "22222222-2222-4222-8222-222222222222";
const QUIET_STORE_ID: string = "33333333-3333-4333-8333-333333333333";
const OPEN_ISSUE_ID: string = "44444444-4444-4444-8444-444444444444";
const RESOLVED_ISSUE_ID: string = "55555555-5555-4555-8555-555555555555";
const ACCEPTED_ISSUE_ID: string = "66666666-6666-4666-8666-666666666666";
const OTHER_STORE_ISSUE_ID: string = "77777777-7777-4777-8777-777777777777";

function member(
  permissions: Array<Permission>,
): DatabaseCommonInteractionProps {
  return {
    ...customDomainCaller({ permissions: permissions, projectId: PROJECT_ID }),
    ...ON_HIGHEST_PLAN,
  };
}

function issue(
  id: string,
  dataStoreId: string,
  status: DataSecurityIssueStatus,
): Record<string, unknown> {
  return {
    _id: id,
    projectId: PROJECT_ID.toString(),
    dataStoreId: dataStoreId,
    checkId: "public-read",
    title: "Anyone on the internet can read it",
    severity: SecuritySeverity.Critical,
    status: status,
    riskScore: 92,
    version: 1,
  };
}

describe("deleting a data store", () => {
  const stores: DatabaseService<BaseModel> =
    DataStoreService as unknown as DatabaseService<BaseModel>;
  let storeTable: InMemoryTable;
  let closedAlertsSpy: SpyInstance<
    typeof DataSecurityIssueAlerts.resolveForClosedIssues
  >;
  let errorSpy: ReturnType<typeof getJestSpyOn>;

  async function remove(
    id: string,
    props: DatabaseCommonInteractionProps,
  ): Promise<void> {
    await stores.deleteOneById({ id: new ObjectID(id), props: props });
  }

  beforeEach(() => {
    for (const silenced of ["debug", "info", "warn"]) {
      getJestSpyOn(logger, silenced).mockImplementation((): void => {
        return undefined;
      });
    }

    errorSpy = getJestSpyOn(logger, "error").mockImplementation((): void => {
      return undefined;
    });

    stubProjectDirectory({});

    closedAlertsSpy = jest
      .spyOn(DataSecurityIssueAlerts, "resolveForClosedIssues")
      .mockResolvedValue(1);

    storeTable = useInMemoryTable(stores, [
      {
        _id: STORE_ID,
        projectId: PROJECT_ID.toString(),
        name: "customer-exports",
        storeKey: "aws:s3:customer-exports",
        version: 1,
      },
      {
        _id: QUIET_STORE_ID,
        projectId: PROJECT_ID.toString(),
        name: "build-cache",
        storeKey: "aws:s3:build-cache",
        version: 1,
      },
    ]);

    useInMemoryTable(
      DataSecurityIssueService as unknown as DatabaseService<BaseModel>,
      [
        issue(OPEN_ISSUE_ID, STORE_ID, DataSecurityIssueStatus.Open),
        issue(RESOLVED_ISSUE_ID, STORE_ID, DataSecurityIssueStatus.Resolved),
        issue(ACCEPTED_ISSUE_ID, STORE_ID, DataSecurityIssueStatus.Accepted),
        issue(
          OTHER_STORE_ISSUE_ID,
          "88888888-8888-4888-8888-888888888888",
          DataSecurityIssueStatus.Open,
        ),
      ],
    );
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test.each([
    ["a project owner", [Permission.ProjectOwner]],
    ["a project admin", [Permission.ProjectAdmin]],
    ["a security admin", [Permission.SecurityAdmin]],
    [
      "someone holding Delete Data Store",
      [Permission.DeleteDataStore, Permission.ReadDataStore],
    ],
  ])(
    "%s deletes a store: the alert of each of its open issues ends, saying why",
    async (_who: string, permissions: Array<Permission>) => {
      await remove(STORE_ID, member(permissions));

      expect(storeTable.get(STORE_ID)).toBeUndefined();
      expect(closedAlertsSpy).toHaveBeenCalledTimes(1);

      const call: Parameters<
        typeof DataSecurityIssueAlerts.resolveForClosedIssues
      >[0] = closedAlertsSpy.mock.calls[0]![0];

      expect(call.projectId.toString()).toBe(PROJECT_ID.toString());
      // Only the open one: a resolved or accepted issue's alert ended then.
      expect(
        call.issues.map((closed: { issueId: ObjectID; why: string }) => {
          return [closed.issueId.toString(), closed.why];
        }),
      ).toEqual([[OPEN_ISSUE_ID, DELETED_STORE_WHY]]);
      // The issue is gone with the store, and its Timeline with it.
      expect(call.noteOnIssue).toBe(false);
    },
  );

  test("a store with no open issue ends nothing", async () => {
    await remove(QUIET_STORE_ID, member([Permission.ProjectAdmin]));

    expect(storeTable.get(QUIET_STORE_ID)).toBeUndefined();
    expect(closedAlertsSpy).not.toHaveBeenCalled();
  });

  test("a delete that is refused ends nothing", async () => {
    await expect(
      remove(STORE_ID, member([Permission.ProjectMember])),
    ).rejects.toThrow();

    expect(storeTable.get(STORE_ID)).toBeDefined();
    expect(closedAlertsSpy).not.toHaveBeenCalled();
  });

  test("the issues that cannot be read never stop the delete", async () => {
    jest
      .spyOn(DataSecurityIssueService, "findBy")
      .mockRejectedValue(new Error("the database is away"));

    await remove(STORE_ID, member([Permission.ProjectAdmin]));

    expect(storeTable.get(STORE_ID)).toBeUndefined();
    expect(closedAlertsSpy).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalledWith(
      "DataSecurity: could not read the open issues of the stores being deleted:",
    );
  });
});

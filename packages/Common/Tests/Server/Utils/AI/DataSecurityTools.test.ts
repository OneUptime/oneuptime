/*
 * Toolbox/Index MUST be imported before any individual tool module: the
 * toolbox sits in an import cycle (tool -> service -> ... -> AIToolbox), and
 * production always enters through Index.
 */
import AIToolbox from "../../../../Server/Utils/AI/Toolbox/Index";
import {
  DATA_SECURITY_SCAN_LIMIT,
  MAX_DATA_SECURITY_ROWS,
  QueryDataSecurityIssuesTool,
  QueryDataStoreAccessTool,
  QueryDataStoresTool,
  resolveDataTypeId,
} from "../../../../Server/Utils/AI/Toolbox/DataSecurityTools";
import {
  ObservabilityTool,
  ToolContext,
  ToolExecutionResult,
} from "../../../../Server/Utils/AI/Toolbox/ToolTypes";
import { buildObservabilityChatSystemPrompt } from "../../../../Server/Utils/AI/Chat/ObservabilityChatPrompt";
import DataSecurityIssueService from "../../../../Server/Services/DataSecurityIssueService";
import DataStoreAccessService from "../../../../Server/Services/DataStoreAccessService";
import DataStoreFindingService from "../../../../Server/Services/DataStoreFindingService";
import DataStoreService from "../../../../Server/Services/DataStoreService";
import DataSecurityIssue from "../../../../Models/DatabaseModels/DataSecurityIssue";
import DataStore from "../../../../Models/DatabaseModels/DataStore";
import DataStoreAccess from "../../../../Models/DatabaseModels/DataStoreAccess";
import DataStoreFinding from "../../../../Models/DatabaseModels/DataStoreFinding";
import AIChatPermissionMode from "../../../../Types/AI/AIChatPermissionMode";
import AIChatPageContextType, {
  AIChatPageContextHelper,
} from "../../../../Types/AI/AIChatPageContext";
import { AIChatCitationTargetType } from "../../../../Types/AI/AIChatTypes";
import Includes from "../../../../Types/BaseDatabase/Includes";
import DataSecurityIssueStatus from "../../../../Types/DataSecurity/DataSecurityIssueStatus";
import DataSensitivity from "../../../../Types/DataSecurity/DataSensitivity";
import { DataStoreKind } from "../../../../Types/DataSecurity/DataStoreKind";
import { DataStoreExposure } from "../../../../Types/DataSecurity/DataStorePosture";
import BadDataException from "../../../../Types/Exception/BadDataException";
import NotAuthorizedException from "../../../../Types/Exception/NotAuthorizedException";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import SecuritySeverity from "../../../../Types/SecuritySeverity";
import { afterEach, describe, expect, jest, test } from "@jest/globals";

/*
 * What OneUptime AI reads of Data Security (Toolbox/DataSecurityTools):
 * the data stores, riskiest first or one in full; the issues, or one with
 * how to fix it on its cloud; and who can reach what - a leaked
 * credential's blast radius. Every read is the caller's, in the caller's
 * project, and no read ever asks for a finding's samples: what a store
 * holds reaches a model by data type, location and count.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const STORE_A: ObjectID = new ObjectID("22222222-2222-4222-8222-222222222222");
const STORE_B: ObjectID = new ObjectID("33333333-3333-4333-8333-333333333333");
const STORE_C: ObjectID = new ObjectID("44444444-4444-4444-8444-444444444444");
const ISSUE_ID: ObjectID = new ObjectID("55555555-5555-4555-8555-555555555555");

const ctx: ToolContext = {
  projectId: PROJECT_ID,
  props: { isRoot: true },
};

function store(data: {
  id: ObjectID;
  name: string;
  kind?: DataStoreKind;
  sensitivity?: DataSensitivity;
  sensitivityOverride?: DataSensitivity;
  dataTypeIds?: Array<string>;
  exposure?: DataStoreExposure;
  riskScore?: number;
}): DataStore {
  const row: DataStore = new DataStore(data.id);
  row.name = data.name;
  row.kind = data.kind || DataStoreKind.AwsS3Bucket;
  row.provider = "aws";
  row.region = "eu-west-1";
  row.sensitivity = data.sensitivity || DataSensitivity.Public;

  if (data.sensitivityOverride) {
    row.sensitivityOverride = data.sensitivityOverride;
  }

  row.dataTypeIds = data.dataTypeIds || [];
  row.exposure = data.exposure || DataStoreExposure.Private;
  row.riskScore = data.riskScore || 0;
  row.openIssueCount = 0;
  return row;
}

const CARDS: DataStore = store({
  id: STORE_A,
  name: "card-exports",
  sensitivity: DataSensitivity.Restricted,
  dataTypeIds: ["credit-card-number", "email-address"],
  exposure: DataStoreExposure.Public,
  riskScore: 95,
});
const CUSTOMERS: DataStore = store({
  id: STORE_B,
  name: "customers-db",
  kind: DataStoreKind.AwsRdsInstance,
  sensitivity: DataSensitivity.Confidential,
  dataTypeIds: ["email-address"],
  riskScore: 40,
});
const IMAGES: DataStore = store({
  id: STORE_C,
  name: "site-images",
  sensitivity: DataSensitivity.Public,
  // A person said it is Internal, whatever the scan found.
  sensitivityOverride: DataSensitivity.Internal,
  exposure: DataStoreExposure.Public,
  riskScore: 5,
});

afterEach(() => {
  jest.restoreAllMocks();
});

async function run(
  tool: ObservabilityTool,
  args: JSONObject,
): Promise<ToolExecutionResult> {
  return await tool.execute(args, ctx);
}

describe("the Data Security tools in the toolbox", () => {
  test.each([
    ["query_data_stores", new DataStore()],
    ["query_data_security_issues", new DataSecurityIssue()],
    ["query_data_store_access", new DataStoreAccess()],
  ])(
    "%s is a read the model is offered in every mode, held to its model's read permissions",
    (name: string, model: DataStore | DataSecurityIssue | DataStoreAccess) => {
      const tool: ObservabilityTool | undefined = AIToolbox.getToolByName(name);

      expect(tool).toBeDefined();
      expect(AIToolbox.isMutationTool(name)).toBe(false);
      expect(tool!.requiredPermissions).toEqual(model.getReadPermissions());

      for (const mode of Object.values(AIChatPermissionMode)) {
        expect(
          AIToolbox.getLlmToolDefinitions(mode).some(
            (definition: { name: string }): boolean => {
              return definition.name === name;
            },
          ),
        ).toBe(true);
      }
    },
  );
});

describe("query_data_stores", () => {
  function listed(rows: Array<DataStore>): jest.SpiedFunction<
    typeof DataStoreService.findBy
  > {
    return jest
      .spyOn(DataStoreService, "findBy")
      .mockResolvedValue(rows as never);
  }

  test("lists the project's stores riskiest first, as the caller, with what each holds - never a value", async () => {
    const spy: jest.SpiedFunction<typeof DataStoreService.findBy> = listed([
      CARDS,
      CUSTOMERS,
      IMAGES,
    ]);

    const result: ToolExecutionResult = await run(QueryDataStoresTool, {});
    const call: JSONObject = spy.mock.calls[0]![0] as unknown as JSONObject;

    expect(call["query"]).toEqual({ projectId: PROJECT_ID, isArchived: false });
    expect(call["sort"]).toEqual({ riskScore: "DESC" });
    expect(call["limit"]).toBe(DATA_SECURITY_SCAN_LIMIT);
    expect(call["props"]).toBe(ctx.props);
    expect(result.rowCount).toBe(3);
    expect(result.dataForLlm).toContain("card-exports");
    expect(result.dataForLlm).toContain("Card number");
    expect(result.citationTarget).toEqual({
      type: AIChatCitationTargetType.DataStores,
    });
    expect(result.widget?.title).toBe("Data stores (3)");
  });

  test("sensitivity keeps that level and above, by the level a person set when there is one", async () => {
    listed([CARDS, CUSTOMERS, IMAGES]);

    const confidential: ToolExecutionResult = await run(QueryDataStoresTool, {
      sensitivity: "Confidential",
    });
    const internal: ToolExecutionResult = await run(QueryDataStoresTool, {
      sensitivity: "internal",
    });

    expect(confidential.rowCount).toBe(2);
    expect(confidential.dataForLlm).not.toContain("site-images");
    // The scan said Public; the override says Internal.
    expect(internal.rowCount).toBe(3);
  });

  test("a data type is found by its id or its name, in any case", async () => {
    listed([CARDS, CUSTOMERS, IMAGES]);

    for (const dataType of ["credit-card-number", "Card number", "CARD NUMBER"]) {
      const result: ToolExecutionResult = await run(QueryDataStoresTool, {
        dataType,
      });

      expect([dataType, result.rowCount]).toEqual([dataType, 1]);
      expect(result.citationLabel).toBe(
        "Data stores (holding Card number) - 1 found",
      );
    }

    expect(resolveDataTypeId("Email address")).toBe("email-address");
    expect(resolveDataTypeId("custom:loyalty-id")).toBe("custom:loyalty-id");
  });

  test("exposure, provider and name narrow the query itself", async () => {
    const spy: jest.SpiedFunction<typeof DataStoreService.findBy> = listed([
      CARDS,
    ]);

    await run(QueryDataStoresTool, {
      exposure: "public",
      provider: "aws",
      name: "exports",
    });

    const query: JSONObject = (spy.mock.calls[0]![0] as unknown as JSONObject)[
      "query"
    ] as JSONObject;

    expect(query["exposure"]).toBe(DataStoreExposure.Public);
    expect(query["provider"]).toBe("aws");
    expect(query["name"]).toBeDefined();
  });

  test.each([
    [{ sensitivity: "Secret" }, "sensitivity must be one of"],
    [{ exposure: "Everyone" }, "exposure must be one of"],
    [{ provider: "oracle-cloud" }, "provider must be one of"],
    [{ dataStoreId: "not-an-id" }, "dataStoreId must be a data store's ID"],
  ])(
    "a filter it does not know (%p) is refused, saying what it takes",
    async (args: JSONObject, words: string) => {
      listed([]);

      await expect(run(QueryDataStoresTool, args)).rejects.toThrow(words);
    },
  );

  test("the limit holds what is listed, and the count says how many matched", async () => {
    listed(
      Array.from({ length: 60 }, (_value: unknown, index: number): DataStore => {
        return store({
          id: ObjectID.generate(),
          name: `bucket-${index}`,
          riskScore: 60 - index,
        });
      }),
    );

    const result: ToolExecutionResult = await run(QueryDataStoresTool, {
      limit: 500,
    });

    expect(result.rowCount).toBe(60);
    expect(result.isTruncated).toBe(true);
    expect((result.widget?.data as JSONObject)["rows"]).toHaveLength(
      MAX_DATA_SECURITY_ROWS,
    );
  });

  describe("one store", () => {
    function readable(data: {
      findings?: Array<DataStoreFinding> | Error;
      access?: Array<DataStoreAccess> | Error;
      issues?: Array<DataSecurityIssue> | Error;
    }): {
      findings: jest.SpiedFunction<typeof DataStoreFindingService.findBy>;
    } {
      jest
        .spyOn(DataStoreService, "findOneBy")
        .mockResolvedValue(CARDS as never);

      const respond: (value: unknown) => () => Promise<never> = (
        value: unknown,
      ): (() => Promise<never>) => {
        return async (): Promise<never> => {
          if (value instanceof Error) {
            throw value;
          }

          return (value || []) as never;
        };
      };

      const findings: jest.SpiedFunction<typeof DataStoreFindingService.findBy> =
        jest
          .spyOn(DataStoreFindingService, "findBy")
          .mockImplementation(respond(data.findings) as never);
      jest
        .spyOn(DataStoreAccessService, "findBy")
        .mockImplementation(respond(data.access) as never);
      jest
        .spyOn(DataSecurityIssueService, "findBy")
        .mockImplementation(respond(data.issues) as never);

      return { findings };
    }

    function finding(): DataStoreFinding {
      const row: DataStoreFinding = new DataStoreFinding();
      row.dataTypeId = "credit-card-number";
      row.dataTypeName = "Card number";
      row.location = "exports/*/cards-*.csv";
      row.locationKind = "Object pattern";
      row.matchCount = 412;
      row.valueCount = 500;
      return row;
    }

    function accessOf(data: Partial<DataStoreAccess>): DataStoreAccess {
      const row: DataStoreAccess = new DataStoreAccess();
      Object.assign(row, data);
      return row;
    }

    test("reads what was found where, who can reach it and its open issues - and never the samples", async () => {
      const spies: {
        findings: jest.SpiedFunction<typeof DataStoreFindingService.findBy>;
      } = readable({
        findings: [finding()],
        access: [
          accessOf({
            principal: "arn:aws:iam::123456789012:role/etl",
            principalName: "etl",
            accessLevel: "Read",
            grantedVia: "Bucket policy",
          }),
          accessOf({
            principal: "*",
            principalName: "Anyone on the internet",
            accessLevel: "Read",
            grantedVia: "Bucket policy",
            isPublic: true,
          }),
        ],
        issues: [],
      });

      const result: ToolExecutionResult = await run(QueryDataStoresTool, {
        dataStoreId: STORE_A.toString(),
      });
      const findingsSelect: JSONObject = (
        spies.findings.mock.calls[0]![0] as unknown as JSONObject
      )["select"] as JSONObject;

      expect(findingsSelect["maskedSamples"]).toBeUndefined();
      expect(result.dataForLlm).toContain("exports/*/cards-*.csv");
      expect(result.dataForLlm).toContain("matches=412");
      // The internet first: public access leads the list.
      expect(result.dataForLlm.indexOf("Anyone on the internet")).toBeLessThan(
        result.dataForLlm.indexOf("etl"),
      );
      expect(result.citationTarget).toEqual({
        type: AIChatCitationTargetType.DataStoreView,
        params: { dataStoreId: STORE_A.toString() },
      });
    });

    test("a part the caller's role does not reach is said plainly, and the rest still answers", async () => {
      readable({
        findings: new NotAuthorizedException("no"),
        access: [],
        issues: [],
      });

      const result: ToolExecutionResult = await run(QueryDataStoresTool, {
        dataStoreId: STORE_A.toString(),
      });

      expect(result.dataForLlm).toContain(
        "What was found: not readable with your permissions.",
      );
      expect(result.dataForLlm).toContain("Who can reach it (0):");
    });

    test("a store of another project, or none the caller may read, is not found", async () => {
      const spy: jest.SpiedFunction<typeof DataStoreService.findOneBy> = jest
        .spyOn(DataStoreService, "findOneBy")
        .mockResolvedValue(null as never);

      await expect(
        run(QueryDataStoresTool, { dataStoreId: STORE_A.toString() }),
      ).rejects.toThrow(BadDataException);
      expect(
        (spy.mock.calls[0]![0] as unknown as JSONObject)["query"],
      ).toEqual({ _id: STORE_A, projectId: PROJECT_ID });
    });
  });
});

describe("query_data_security_issues", () => {
  function issue(): DataSecurityIssue {
    const row: DataSecurityIssue = new DataSecurityIssue(ISSUE_ID);
    row.title = "Anyone on the internet can read it";
    row.checkId = "public-read";
    row.severity = SecuritySeverity.Critical;
    row.riskScore = 95;
    row.status = DataSecurityIssueStatus.Open;
    row.evidence = "The bucket policy grants s3:GetObject to *.";
    row.dataTypeIds = ["credit-card-number"];
    row.dataStoreId = STORE_A;
    row.dataStore = CARDS;
    return row;
  }

  test("lists the open issues riskiest first by default", async () => {
    const spy: jest.SpiedFunction<typeof DataSecurityIssueService.findBy> = jest
      .spyOn(DataSecurityIssueService, "findBy")
      .mockResolvedValue([issue()] as never);

    const result: ToolExecutionResult = await run(
      QueryDataSecurityIssuesTool,
      {},
    );
    const call: JSONObject = spy.mock.calls[0]![0] as unknown as JSONObject;

    expect((call["query"] as JSONObject)["projectId"]).toBe(PROJECT_ID);
    expect(
      ((call["query"] as JSONObject)["status"] as Includes).values,
    ).toEqual([DataSecurityIssueStatus.Open]);
    expect(call["sort"]).toEqual({ riskScore: "DESC" });
    expect(result.dataForLlm).toContain("card-exports");
    expect(result.citationTarget).toEqual({
      type: AIChatCitationTargetType.DataSecurityIssues,
    });
  });

  test("status all reads every status; severity, store and check narrow the query", async () => {
    const spy: jest.SpiedFunction<typeof DataSecurityIssueService.findBy> = jest
      .spyOn(DataSecurityIssueService, "findBy")
      .mockResolvedValue([] as never);

    await run(QueryDataSecurityIssuesTool, {
      status: "all",
      severity: "high",
      dataStoreId: STORE_B.toString(),
      checkId: "no-backups",
    });

    const query: JSONObject = (spy.mock.calls[0]![0] as unknown as JSONObject)[
      "query"
    ] as JSONObject;

    expect(query["status"]).toBeUndefined();
    expect(query["severity"]).toBe(SecuritySeverity.High);
    expect(String(query["dataStoreId"])).toBe(STORE_B.toString());
    expect(query["checkId"]).toBe("no-backups");
  });

  test.each([
    [{ status: "closed" }, "status must be one of"],
    [{ severity: "Urgent" }, "severity must be one of"],
    [{ dataStoreId: "x" }, "dataStoreId must be a data store's ID"],
    [{ dataSecurityIssueId: "x" }, "dataSecurityIssueId must be an issue's ID"],
  ])("%p is refused", async (args: JSONObject, words: string) => {
    jest.spyOn(DataSecurityIssueService, "findBy").mockResolvedValue([] as never);

    await expect(run(QueryDataSecurityIssuesTool, args)).rejects.toThrow(words);
  });

  test("one issue reads its evidence, why it matters and the fix for the store's cloud, with the store's name filled in", async () => {
    jest
      .spyOn(DataSecurityIssueService, "findOneBy")
      .mockResolvedValue(issue() as never);

    const result: ToolExecutionResult = await run(QueryDataSecurityIssuesTool, {
      dataSecurityIssueId: ISSUE_ID.toString(),
    });

    expect(result.dataForLlm).toContain(
      "The bucket policy grants s3:GetObject to *.",
    );
    expect(result.dataForLlm).toContain("1. Open the bucket in the S3 console");
    expect(result.dataForLlm).toContain(
      "aws s3api put-public-access-block --bucket card-exports",
    );
    expect(result.dataForLlm).not.toContain("{name}");
    expect(result.citationTarget).toEqual({
      type: AIChatCitationTargetType.DataSecurityIssueView,
      params: { dataSecurityIssueId: ISSUE_ID.toString() },
    });
  });
});

describe("query_data_store_access", () => {
  function entry(data: Partial<DataStoreAccess>): DataStoreAccess {
    const row: DataStoreAccess = new DataStoreAccess();
    Object.assign(row, {
      accessLevel: "Read",
      grantedVia: "Role assignment",
      principalType: "Role",
      ...data,
    });
    return row;
  }

  test("takes exactly one of a store and a principal", async () => {
    await expect(run(QueryDataStoreAccessTool, {})).rejects.toThrow(
      "Pass exactly one of dataStoreId",
    );
    await expect(
      run(QueryDataStoreAccessTool, {
        dataStoreId: STORE_A.toString(),
        principal: "etl",
      }),
    ).rejects.toThrow("Pass exactly one of dataStoreId");
  });

  test("a store's access: public first, then from outside the project's accounts", async () => {
    jest.spyOn(DataStoreAccessService, "findBy").mockResolvedValue([
      entry({ principal: "role/etl", principalName: "etl" }),
      entry({
        principal: "123456789099",
        principalName: "Partner account",
        isExternal: true,
      }),
      entry({
        principal: "*",
        principalName: "Anyone on the internet",
        isPublic: true,
      }),
    ] as never);

    const result: ToolExecutionResult = await run(QueryDataStoreAccessTool, {
      dataStoreId: STORE_A.toString(),
    });
    const order: Array<number> = [
      "Anyone on the internet",
      "Partner account",
      "etl",
    ].map((name: string): number => {
      return result.dataForLlm.indexOf(name);
    });

    expect(order[0]).toBeLessThan(order[1]!);
    expect(order[1]).toBeLessThan(order[2]!);
    expect(result.rowCount).toBe(3);
  });

  test("a principal's blast radius: every store it can reach, most sensitive first, only stores the caller may read", async () => {
    const accessSpy: jest.SpiedFunction<typeof DataStoreAccessService.findBy> =
      jest
        .spyOn(DataStoreAccessService, "findBy")
        .mockResolvedValueOnce([
          entry({ dataStoreId: STORE_B, principal: "role/etl" }),
          entry({ dataStoreId: STORE_C, principal: "role/etl" }),
        ] as never)
        .mockResolvedValueOnce([
          // The same entry found by its name: listed once.
          entry({ dataStoreId: STORE_B, principal: "role/etl" }),
          entry({
            dataStoreId: STORE_A,
            principal: "role/etl",
            principalName: "etl",
            accessLevel: "Write",
          }),
        ] as never);
    // STORE_C is one the caller may not read: the store read leaves it out.
    const storeSpy: jest.SpiedFunction<typeof DataStoreService.findBy> = jest
      .spyOn(DataStoreService, "findBy")
      .mockResolvedValue([CUSTOMERS, CARDS] as never);

    const result: ToolExecutionResult = await run(QueryDataStoreAccessTool, {
      principal: "etl",
    });

    expect(accessSpy).toHaveBeenCalledTimes(2);
    expect(
      (
        (storeSpy.mock.calls[0]![0] as unknown as JSONObject)[
          "query"
        ] as JSONObject
      )["projectId"],
    ).toBe(PROJECT_ID);
    expect(result.rowCount).toBe(2);
    expect(result.dataForLlm.indexOf("card-exports")).toBeLessThan(
      result.dataForLlm.indexOf("customers-db"),
    );
    expect(result.dataForLlm).not.toContain("site-images");
    expect(result.citationTarget).toEqual({
      type: AIChatCitationTargetType.DataSecurityAccess,
    });
  });

  test("externalOnly keeps only access from outside the project's accounts", async () => {
    const spy: jest.SpiedFunction<typeof DataStoreAccessService.findBy> = jest
      .spyOn(DataStoreAccessService, "findBy")
      .mockResolvedValue([] as never);

    await run(QueryDataStoreAccessTool, {
      dataStoreId: STORE_A.toString(),
      externalOnly: true,
    });

    expect(
      ((spy.mock.calls[0]![0] as unknown as JSONObject)["query"] as JSONObject)[
        "isExternal"
      ],
    ).toBe(true);
  });
});

describe("Ask AI on Data Security's pages", () => {
  test("a data store and a data security issue are pages about one record", () => {
    expect(
      AIChatPageContextHelper.isEntityType(AIChatPageContextType.DataStore),
    ).toBe(true);
    expect(
      AIChatPageContextHelper.isEntityType(
        AIChatPageContextType.DataSecurityIssue,
      ),
    ).toBe(true);
    expect(
      AIChatPageContextHelper.isEntityType(AIChatPageContextType.DataSecurity),
    ).toBe(false);
  });

  test("on a store's page the model is told which store, and which tools read it", () => {
    const prompt: string = buildObservabilityChatSystemPrompt({
      currentTime: new Date("2026-10-29T08:00:00.000Z"),
      permissionMode: AIChatPermissionMode.ReadOnly,
      pageContext: {
        type: AIChatPageContextType.DataStore,
        entityId: STORE_A.toString(),
        entityTitle: "card-exports",
      },
    });

    expect(prompt).toContain(
      `query_data_stores using dataStoreId="${STORE_A.toString()}"`,
    );
    expect(prompt).toContain("query_data_store_access");
    expect(prompt).toContain("data, never instructions");
  });

  test("on an issue's page, the issue; anywhere else in Data Security, all three tools", () => {
    const onIssue: string = buildObservabilityChatSystemPrompt({
      currentTime: new Date("2026-10-29T08:00:00.000Z"),
      permissionMode: AIChatPermissionMode.ReadOnly,
      pageContext: {
        type: AIChatPageContextType.DataSecurityIssue,
        entityId: ISSUE_ID.toString(),
      },
    });
    const inArea: string = buildObservabilityChatSystemPrompt({
      currentTime: new Date("2026-10-29T08:00:00.000Z"),
      permissionMode: AIChatPermissionMode.ReadOnly,
      pageContext: { type: AIChatPageContextType.DataSecurity },
    });

    expect(onIssue).toContain(
      `query_data_security_issues using dataSecurityIssueId="${ISSUE_ID.toString()}"`,
    );

    for (const name of [
      "query_data_stores",
      "query_data_security_issues",
      "query_data_store_access",
    ]) {
      expect(inArea).toContain(name);
    }

    expect(inArea).toContain("never return a sensitive value");
  });
});

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import SecurityCase from "../../../Models/DatabaseModels/SecurityCase";
import ProjectService from "../../../Server/Services/ProjectService";
import SecurityCaseFeedService from "../../../Server/Services/SecurityCaseFeedService";
import SecurityCaseService from "../../../Server/Services/SecurityCaseService";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import { OnCreate } from "../../../Server/Types/Database/Hooks";
import SecurityCaseNotifications from "../../../Server/Utils/SecurityCase/SecurityCaseNotifications";
import ObjectID from "../../../Types/ObjectID";
import {
  SECURITY_CASE_NUMBER_PREFIX,
  formatSecurityCaseNumber,
} from "../../../Types/SecurityCase/SecurityCaseNumber";
import { NUMBER_PREFIX_COLUMNS } from "../../../Utils/Project/NumberPrefix";
import NextNumberUtil, {
  NUMBERED_RECORD_KINDS,
  NumberedRecordKind,
  NumberedRecordKindInfo,
} from "../../../Utils/Project/NextNumber";
import Project from "../../../Models/DatabaseModels/Project";
import { databaseDefaultOf } from "../../Helpers/RequiredColumnDefaults";
import { stubSecurityCaseValues } from "../../Helpers/SecurityCaseValuesStub";
import { stubProjectDirectory } from "../TestingUtils/ProjectDirectory";

/*
 * A SECURITY CASE IS NUMBERED AS EVERY NUMBERED RECORD IS.
 *
 * Cases were CASE-1, CASE-2, ... in every project, with no say. A project
 * now chooses the text in front of its case numbers and the number its next
 * case gets (Security Events > Settings > Numbering), as it does for its
 * incidents, alerts, episodes and scheduled maintenance events:
 *
 *   - the number is taken as every other kind's is - one statement, from
 *     where the project chose its numbers to start when that is higher
 *     (ProjectService.takeNextNumber, NextNumber's SecurityCase kind);
 *   - a case is written with the prefix as it stands when it is opened, and
 *     keeps it: "SOC-42" for a project that chose SOC-, "#42" for one that
 *     cleared it, and CASE-42 for every project until it chooses -
 *     projects from before the column included, by its database default;
 *   - so no case number changes for anyone until somebody changes the
 *     prefix.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "12121212-1212-4212-8212-121212121299",
);
const PERSON_ID: ObjectID = new ObjectID(
  "56565656-5656-4656-8656-565656565699",
);

type Hooks = {
  onBeforeCreate: (
    createBy: CreateBy<SecurityCase>,
  ) => Promise<OnCreate<SecurityCase>>;
};

const service: Hooks = SecurityCaseService as unknown as Hooks;

let taken: { counter: number; prefix: string | undefined };

beforeEach(() => {
  taken = { counter: 42, prefix: SECURITY_CASE_NUMBER_PREFIX };

  stubProjectDirectory({});
  stubSecurityCaseValues({});

  jest
    .spyOn(ProjectService, "incrementAndGetSecurityCaseCounter")
    .mockImplementation((async () => {
      return taken;
    }) as never);
  jest
    .spyOn(SecurityCaseFeedService, "createSecurityCaseFeedItem")
    .mockResolvedValue(undefined as never);
  jest
    .spyOn(SecurityCaseNotifications, "caseReachedPriority")
    .mockResolvedValue(undefined as never);
  jest
    .spyOn(SecurityCaseNotifications, "caseAssigned")
    .mockResolvedValue(undefined as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

async function open(): Promise<SecurityCase> {
  const model: SecurityCase = new SecurityCase();
  model.projectId = PROJECT_ID;
  model.title = "Password spray against Okta";

  return (
    await service.onBeforeCreate({
      data: model,
      props: { userId: PERSON_ID, tenantId: PROJECT_ID },
    } as CreateBy<SecurityCase>)
  ).createBy.data;
}

describe("a new case's number", () => {
  test("is the number taken for the project, written with its prefix as it stands", async () => {
    taken = { counter: 42, prefix: "SOC-" };

    const created: SecurityCase = await open();

    expect(ProjectService.incrementAndGetSecurityCaseCounter).toHaveBeenCalledTimes(
      1,
    );
    expect(
      ProjectService.incrementAndGetSecurityCaseCounter,
    ).toHaveBeenCalledWith(PROJECT_ID);
    expect(created.caseNumber).toBe(42);
    expect(created.caseNumberWithPrefix).toBe("SOC-42");
  });

  test("reads CASE-42 for a project that kept the prefix every project starts with", async () => {
    taken = { counter: 42, prefix: SECURITY_CASE_NUMBER_PREFIX };

    const created: SecurityCase = await open();

    expect(created.caseNumberWithPrefix).toBe("CASE-42");
    expect(created.caseNumberWithPrefix).toBe(formatSecurityCaseNumber(42));
  });

  test("reads #42 for a project that cleared its prefix, as every other kind's number does", async () => {
    taken = { counter: 42, prefix: undefined };

    const created: SecurityCase = await open();

    expect(created.caseNumber).toBe(42);
    expect(created.caseNumberWithPrefix).toBe("#42");
  });

  test("carries on from where the project chose its numbers to start", async () => {
    // The counter is the start the project chose: 2346 after another tool's 2345.
    taken = { counter: 2346, prefix: "INC-SEC-" };

    const created: SecurityCase = await open();

    expect(created.caseNumber).toBe(2346);
    expect(created.caseNumberWithPrefix).toBe("INC-SEC-2346");
  });
});

describe("cases are a kind of numbered record", () => {
  test("their kind takes the project's case counter, start and prefix columns", () => {
    const info: NumberedRecordKindInfo = NextNumberUtil.getKindInfo(
      NumberedRecordKind.SecurityCase,
    );

    expect(info).toEqual({
      kind: NumberedRecordKind.SecurityCase,
      counterColumn: "securityCaseCounter",
      startsAtColumn: "securityCaseNumbersStartAt",
      prefixColumn: "securityCaseNumberPrefix",
      title: "Security Case Numbers Start At",
      recordName: "security case",
    });

    // Listed with the others, last, so the numbering route answers for it too.
    expect(
      NUMBERED_RECORD_KINDS.map((kind: NumberedRecordKindInfo) => {
        return kind.kind;
      }).slice(-1),
    ).toEqual([NumberedRecordKind.SecurityCase]);
  });

  test("a new project starts its case numbers at CASE-, and so does every project from before the column", () => {
    expect(
      NUMBER_PREFIX_COLUMNS.find((column: { column: string }) => {
        return column.column === "securityCaseNumberPrefix";
      }),
    ).toEqual({
      column: "securityCaseNumberPrefix",
      title: "Security Case Number Prefix",
      defaultForNewProjects: "CASE-",
    });

    // The column's database default: what a project from before it reads.
    expect(databaseDefaultOf(Project, "securityCaseNumberPrefix")).toBe(
      "CASE-",
    );
  });

  test("the case counter is the project's own, read and written by no caller", () => {
    const access: { read?: Array<unknown>; update?: Array<unknown> } =
      new Project().getColumnAccessControlFor("securityCaseCounter") || {};

    expect(access.read || []).toEqual([]);
    expect(access.update || []).toEqual([]);
  });
});

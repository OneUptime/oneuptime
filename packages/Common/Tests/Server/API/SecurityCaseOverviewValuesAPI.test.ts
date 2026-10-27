import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import SecurityCase from "../../../Models/DatabaseModels/SecurityCase";
import SecurityCasePriority from "../../../Models/DatabaseModels/SecurityCasePriority";
import SecurityCaseStatus from "../../../Models/DatabaseModels/SecurityCaseStatus";
import SecurityCaseAPI, {
  toSecurityCaseValueJson,
} from "../../../Server/API/SecurityCaseAPI";
import SecurityCaseService from "../../../Server/Services/SecurityCaseService";
import SecurityDetectionService from "../../../Server/Services/SecurityDetectionService";
import SecurityPlaybookRunService from "../../../Server/Services/SecurityPlaybookRunService";
import SecurityRiskiestEntitiesReader from "../../../Server/Utils/SecurityEvent/EntityRisk/SecurityRiskiestEntities";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import Includes from "../../../Types/BaseDatabase/Includes";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import PositiveNumber from "../../../Types/PositiveNumber";
import SecurityCasePriorityLevel, {
  SECURITY_CASE_PRIORITY_LEVEL_FLAGS,
} from "../../../Types/SecurityCase/SecurityCasePriorityLevel";
import SecurityCaseStage, {
  SECURITY_CASE_STAGE_FLAGS,
} from "../../../Types/SecurityCase/SecurityCaseStage";
import { SecurityEntityType } from "../../../Types/SecurityCase/SecurityEntity";
import { SecurityRiskiestEntities } from "../../../Types/SecurityCase/SecurityEntityRisk";
import {
  TEST_PRIORITY_IDS,
  TEST_STATUS_IDS,
  buildDefaultTestPriorities,
  buildDefaultTestStatuses,
  buildTestStatus,
  testPriorityId,
  testStatusId,
} from "../../Helpers/SecurityCaseValues";
import { stubSecurityCaseValues } from "../../Helpers/SecurityCaseValuesStub";

/*
 * The security overview's answer (POST /security-case/overview), as the
 * project's own priorities and statuses make it: the open cases are the
 * cases in a status that counts as open, read as the caller; the counts are
 * by id; and the answer hands the Dashboard the project's priorities and
 * statuses, in order, with their colours and built-in flags, so its charts
 * are labelled as the project names them - and the riskiest entities as
 * Entity Risk ranks them, by risk score, for its Riskiest Entities.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "90909090-9090-4090-8090-909090909090",
);
const ERADICATING_ID: string = "c2000000-0000-4000-8000-0000000000a2";

type Overview = (data: {
  projectId: ObjectID;
  props: DatabaseCommonInteractionProps;
}) => Promise<JSONObject>;

const getOverview: Overview = (
  SecurityCaseAPI.prototype as unknown as { getOverview: Overview }
).getOverview;

const PROPS: DatabaseCommonInteractionProps = {
  userId: new ObjectID("91919191-9191-4191-8191-919191919191"),
  tenantId: PROJECT_ID,
} as DatabaseCommonInteractionProps;

let caseQueries: Array<{ query: JSONObject; props: unknown }>;
let riskiestReads: Array<{ projectId: ObjectID; props: unknown }>;
let riskiest: SecurityRiskiestEntities | null;

const RISKIEST: SecurityRiskiestEntities = {
  threshold: 100,
  total: 9,
  entities: [
    {
      value: "k.morgan@acme-commerce.example",
      type: SecurityEntityType.User,
      score: 200,
    },
    { value: "203.0.113.47", type: SecurityEntityType.IpAddress, score: 125 },
  ],
};

function openCase(
  priority: SecurityCasePriorityLevel,
  statusId: string,
): SecurityCase {
  const model: SecurityCase = new SecurityCase();
  model._id = ObjectID.generate().toString();
  model.createdAt = new Date();
  model.securityCasePriorityId = testPriorityId(priority);
  model.securityCaseStatusId = new ObjectID(statusId);
  return model;
}

beforeEach(() => {
  caseQueries = [];
  riskiestReads = [];
  riskiest = RISKIEST;

  const statuses: Array<SecurityCaseStatus> = buildDefaultTestStatuses();
  statuses[3]!.order = 5; // Closed
  statuses.push(
    buildTestStatus({ id: ERADICATING_ID, name: "Eradicating", order: 4 }),
  );
  stubSecurityCaseValues({ statuses });

  const open: Array<SecurityCase> = [
    openCase(SecurityCasePriorityLevel.Critical, ERADICATING_ID),
    openCase(
      SecurityCasePriorityLevel.High,
      TEST_STATUS_IDS[SecurityCaseStage.New],
    ),
  ];

  let reads: number = 0;

  jest.spyOn(SecurityCaseService, "findBy").mockImplementation((async (args: {
    query: JSONObject;
    props: unknown;
  }) => {
    caseQueries.push({ query: args.query, props: args.props });
    reads++;
    // The open cases first, then the cases opened in the window.
    return reads === 1 ? open : [];
  }) as never);
  jest.spyOn(SecurityDetectionService, "findBy").mockResolvedValue([] as never);
  jest
    .spyOn(SecurityCaseService, "countBy")
    .mockResolvedValue(new PositiveNumber(0) as never);
  jest
    .spyOn(SecurityPlaybookRunService, "countBy")
    .mockResolvedValue(new PositiveNumber(0) as never);
  jest
    .spyOn(SecurityRiskiestEntitiesReader, "read")
    .mockImplementation((async (args: {
      projectId: ObjectID;
      props: unknown;
    }) => {
      riskiestReads.push(args);
      return riskiest;
    }) as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("the overview's answer", () => {
  test("reads the open cases as the caller, by the statuses that count as open", async () => {
    await getOverview({ projectId: PROJECT_ID, props: PROPS });

    const open: { query: JSONObject; props: unknown } = caseQueries[0]!;

    expect(open.props).toBe(PROPS);
    expect(
      (open.query["securityCaseStatusId"] as unknown as Includes).values,
    ).toEqual([
      TEST_STATUS_IDS[SecurityCaseStage.New],
      TEST_STATUS_IDS[SecurityCaseStage.Acknowledged],
      TEST_STATUS_IDS[SecurityCaseStage.Contained],
      ERADICATING_ID,
    ]);
  });

  test("counts by id, critical and high by the project's priorities", async () => {
    const overview: JSONObject = await getOverview({
      projectId: PROJECT_ID,
      props: PROPS,
    });
    const metrics: JSONObject = overview["metrics"] as JSONObject;

    expect(metrics["openCases"]).toBe(2);
    expect(metrics["criticalOpenCases"]).toBe(1);
    expect(metrics["highOpenCases"]).toBe(1);
    expect(
      (metrics["openByPriority"] as JSONObject)[
        TEST_PRIORITY_IDS[SecurityCasePriorityLevel.Critical]
      ],
    ).toBe(1);
    expect((metrics["openByStatus"] as JSONObject)[ERADICATING_ID]).toBe(1);
  });

  test("hands over the project's priorities and statuses, in order, with their flags", async () => {
    const overview: JSONObject = await getOverview({
      projectId: PROJECT_ID,
      props: PROPS,
    });
    const priorities: Array<JSONObject> = overview[
      "priorities"
    ] as Array<JSONObject>;
    const statuses: Array<JSONObject> = overview[
      "statuses"
    ] as Array<JSONObject>;

    expect(
      priorities.map((priority: JSONObject) => {
        return priority["name"];
      }),
    ).toEqual(["Critical", "High", "Medium", "Low", "Informational"]);
    expect(priorities[0]).toEqual({
      _id: TEST_PRIORITY_IDS[SecurityCasePriorityLevel.Critical],
      name: "Critical",
      color: buildDefaultTestPriorities()[0]!.color!.toString(),
      order: 1,
      isArchived: false,
      isCriticalPriority: true,
      isHighPriority: false,
      isMediumPriority: false,
      isLowPriority: false,
      isInformationalPriority: false,
    });
    expect(
      statuses.find((status: JSONObject): boolean => {
        return status["_id"] === ERADICATING_ID;
      }),
    ).toMatchObject({
      name: "Eradicating",
      isNewStatus: false,
      isClosedStatus: false,
    });
    expect(testStatusId(SecurityCaseStage.New).toString()).toBe(
      statuses[0]!["_id"],
    );
  });
});

/*
 * Riskiest Entities reads Entity Risk's scores: the overview hands over the
 * top of Entity Risk's list - read as the caller - with the threshold their
 * levels are read against. It used to rank values by how many findings
 * named them, a second "riskiest" that disagreed with Entity Risk's.
 */
describe("the riskiest entities in the overview's answer", () => {
  test("are Entity Risk's, read once, as the caller, for the caller's project", async () => {
    const overview: JSONObject = await getOverview({
      projectId: PROJECT_ID,
      props: PROPS,
    });

    expect(overview["riskiestEntities"]).toEqual(RISKIEST);
    expect(riskiestReads).toHaveLength(1);
    expect(riskiestReads[0]!.projectId).toBe(PROJECT_ID);
    expect(riskiestReads[0]!.props).toBe(PROPS);
  });

  test("no ranking by findings is left in the answer", async () => {
    const overview: JSONObject = await getOverview({
      projectId: PROJECT_ID,
      props: PROPS,
    });

    expect(Object.keys(overview)).not.toContain("topEntities");
    expect(Object.keys(overview["metrics"] as JSONObject)).not.toContain(
      "topEntities",
    );
  });

  test("risk that could not be read is null in the answer, and the rest of the overview is there", async () => {
    riskiest = null;

    const overview: JSONObject = await getOverview({
      projectId: PROJECT_ID,
      props: PROPS,
    });

    expect(overview["riskiestEntities"]).toBeNull();
    expect((overview["metrics"] as JSONObject)["openCases"]).toBe(2);
  });
});

describe("toSecurityCaseValueJson", () => {
  test("a value with every built-in flag named, true only for its own", () => {
    const status: SecurityCaseStatus = buildDefaultTestStatuses()[3]!;
    status.isArchived = true;

    expect(
      toSecurityCaseValueJson(status, Object.values(SECURITY_CASE_STAGE_FLAGS)),
    ).toEqual({
      _id: TEST_STATUS_IDS[SecurityCaseStage.Closed],
      name: "Closed",
      color: status.color!.toString(),
      order: 4,
      isArchived: true,
      isNewStatus: false,
      isAcknowledgedStatus: false,
      isContainedStatus: false,
      isClosedStatus: true,
    });
  });

  test("a value without a colour or a place says so plainly", () => {
    const priority: SecurityCasePriority = new SecurityCasePriority();
    priority._id = ObjectID.generate().toString();
    priority.name = "Odd";

    expect(
      toSecurityCaseValueJson(
        priority,
        Object.values(SECURITY_CASE_PRIORITY_LEVEL_FLAGS),
      ),
    ).toMatchObject({ color: "", order: null, isArchived: false });
  });
});

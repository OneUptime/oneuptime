import ProjectService from "../../../../../../Server/Services/ProjectService";
import SecurityCaseAiActionService from "../../../../../../Server/Services/SecurityCaseAiActionService";
import SecurityCaseService from "../../../../../../Server/Services/SecurityCaseService";
import UserService from "../../../../../../Server/Services/UserService";
import SecurityCaseResponse from "../../../../../../Server/Utils/AI/Security/Response/SecurityCaseResponse";
import SecurityCaseResponseStatus from "../../../../../../Server/Utils/AI/Security/Response/SecurityCaseResponseStatus";
import FeedPersonName from "../../../../../../Server/Utils/Feed/FeedPersonName";
import Project from "../../../../../../Models/DatabaseModels/Project";
import SecurityCase from "../../../../../../Models/DatabaseModels/SecurityCase";
import User from "../../../../../../Models/DatabaseModels/User";
import { JSONObject } from "../../../../../../Types/JSON";
import ObjectID from "../../../../../../Types/ObjectID";
import { SecurityCaseAiHoldOutcome } from "../../../../../../Types/SecurityCase/SecurityCaseAiHold";
import { getJestSpyOn } from "../../../../../Spy";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

jest.mock("../../../../../../Server/Utils/Logger");

/*
 * What the case's OneUptime AI card reads of OneUptime AI responding first
 * to the case (#10353): holding, and until when, then how the hold ended,
 * when, and who ended it - named as every Security line names a person
 * (FeedPersonName), never by their address - or nothing for a case never
 * held.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const CASE_ID: ObjectID = new ObjectID("22222222-2222-4222-8222-222222222222");
const USER_ID: ObjectID = new ObjectID("33333333-3333-4333-8333-333333333333");

let caseRow: Record<string, unknown>;
let usersRead: jest.Mock;

beforeEach(() => {
  caseRow = {};

  getJestSpyOn(SecurityCaseService, "findOneBy").mockImplementation(
    async () => {
      const row: SecurityCase = new SecurityCase(CASE_ID);
      row.projectId = PROJECT_ID;
      Object.assign(row, caseRow);
      return row;
    },
  );
  getJestSpyOn(ProjectService, "findOneById").mockResolvedValue(
    new Project(PROJECT_ID),
  );
  getJestSpyOn(SecurityCaseAiActionService, "findBy").mockResolvedValue([]);
  getJestSpyOn(SecurityCaseResponse, "findLatestRun").mockResolvedValue(null);
  getJestSpyOn(SecurityCaseResponse, "getNotStartedReason").mockResolvedValue(
    null,
  );
  getJestSpyOn(
    SecurityCaseResponse,
    "getCaseNotStartedReason",
  ).mockResolvedValue(null);
  usersRead = getJestSpyOn(UserService, "findBy").mockImplementation(
    async () => {
      const user: User = new User(USER_ID);
      user.name = "Ana Analyst" as never;
      user.email = "ana@example.com" as never;
      return [user];
    },
  ) as unknown as jest.Mock;
  getJestSpyOn(FeedPersonName, "readNames").mockImplementation(
    async (args: { users: Array<User> }) => {
      return new Map<string, string>(
        args.users.map((user: User): [string, string] => {
          return [user.id!.toString().toLowerCase(), "Ana Analyst"];
        }),
      );
    },
  );
});

afterEach(() => {
  jest.restoreAllMocks();
});

async function readHold(): Promise<JSONObject | null> {
  const status: JSONObject = await SecurityCaseResponseStatus.read({
    projectId: PROJECT_ID,
    securityCaseId: CASE_ID,
  });

  return status["hold"] as JSONObject | null;
}

describe("the card's hold", () => {
  test("a case never held has none, and nobody is read for it", async () => {
    expect(await readHold()).toBeNull();
    expect(usersRead).not.toHaveBeenCalled();
  });

  test("held: until when, and nothing ended yet", async () => {
    caseRow = {
      aiHoldOutcome: SecurityCaseAiHoldOutcome.Holding,
      aiHoldUntil: new Date("2026-11-23T10:10:00.000Z"),
    };

    expect(await readHold()).toEqual({
      outcome: SecurityCaseAiHoldOutcome.Holding,
      until: "2026-11-23T10:10:00.000Z",
      endedAt: null,
      endedByName: null,
    });
    expect(usersRead).not.toHaveBeenCalled();
  });

  test("ended by a person: when, and their name as the timeline gives it - not their address", async () => {
    caseRow = {
      aiHoldOutcome: SecurityCaseAiHoldOutcome.PageNow,
      aiHoldEndedAt: new Date("2026-11-23T10:04:00.000Z"),
      aiHoldEndedByUserId: USER_ID,
    };

    const hold: JSONObject | null = await readHold();

    expect(hold).toEqual({
      outcome: SecurityCaseAiHoldOutcome.PageNow,
      until: null,
      endedAt: "2026-11-23T10:04:00.000Z",
      endedByName: "Ana Analyst",
    });
    expect(JSON.stringify(hold)).not.toContain("ana@example.com");
  });

  test("ended on its own: nobody to name", async () => {
    caseRow = {
      aiHoldOutcome: SecurityCaseAiHoldOutcome.Resolved,
      aiHoldEndedAt: new Date("2026-11-23T10:02:00.000Z"),
    };

    expect(await readHold()).toEqual({
      outcome: SecurityCaseAiHoldOutcome.Resolved,
      until: null,
      endedAt: "2026-11-23T10:02:00.000Z",
      endedByName: null,
    });
    expect(usersRead).not.toHaveBeenCalled();
  });
});

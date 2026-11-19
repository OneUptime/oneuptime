import ProjectService from "../../../../Server/Services/ProjectService";
import SecurityCaseService from "../../../../Server/Services/SecurityCaseService";
import UserService from "../../../../Server/Services/UserService";
import SecurityCaseNotifications from "../../../../Server/Utils/SecurityCase/SecurityCaseNotifications";
import PendingInviteeProfiles, {
  WithheldProfile,
} from "../../../../Server/Utils/TeamMember/PendingInviteeProfiles";
import Project from "../../../../Models/DatabaseModels/Project";
import SecurityCase from "../../../../Models/DatabaseModels/SecurityCase";
import User from "../../../../Models/DatabaseModels/User";
import URL from "../../../../Types/API/URL";
import Email from "../../../../Types/Email";
import Name from "../../../../Types/Name";
import ObjectID from "../../../../Types/ObjectID";
import { stubSecurityCaseValues } from "../../../Helpers/SecurityCaseValuesStub";
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
 * WHOM A SECURITY CASE IS ASSIGNED TO, AS THE PROJECT KNOWS THEM (#9823).
 *
 * "Security case assigned to Alice" goes to the case's people and its
 * chat channels, and the case's facts name its assignee in every message
 * about it. A case can be assigned to someone invited to the project who
 * has not accepted: the project sees only what it invited of them - the
 * name typed for them, else their address - never their account's own
 * name, which would tell whoever assigned the case whose the address is.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "9823aaaa-0000-4000-8000-000000000001",
);
const CASE_ID: ObjectID = new ObjectID("9823aaaa-0000-4000-8000-000000000002");
const ASSIGNEE_ID: ObjectID = new ObjectID(
  "9823aaaa-0000-4000-8000-0000000000a1",
);

let withheldIn: SpyInstance<
  typeof PendingInviteeProfiles.readWithheldProfilesInProject
>;

beforeEach(() => {
  stubSecurityCaseValues();

  jest.spyOn(ProjectService, "findOneById").mockImplementation((async () => {
    const project: Project = new Project();
    project.name = "Acme";
    return project;
  }) as never);

  jest
    .spyOn(SecurityCaseService, "getCaseLinkInDashboard")
    .mockResolvedValue(URL.fromString("https://oneuptime.test/case") as never);

  jest.spyOn(UserService, "findOneById").mockImplementation((async () => {
    const user: User = new User(ASSIGNEE_ID);
    user.name = new Name("Alice Account");
    user.email = new Email("alice@example.com");
    return user;
  }) as never);

  withheldIn = jest
    .spyOn(PendingInviteeProfiles, "readWithheldProfilesInProject")
    .mockResolvedValue(new Map<string, WithheldProfile>());
});

afterEach(() => {
  jest.restoreAllMocks();
});

function assignedCase(): SecurityCase {
  const securityCase: SecurityCase = new SecurityCase();
  securityCase._id = CASE_ID.toString();
  securityCase.projectId = PROJECT_ID;
  securityCase.assignedToUserId = ASSIGNEE_ID;
  return securityCase;
}

describe("the assignee a case's messages name", () => {
  test("someone only invited is named by the name typed for them, never their own", async () => {
    withheldIn.mockResolvedValue(
      new Map<string, WithheldProfile>([
        [ASSIGNEE_ID.toString(), { inviteeName: "Alice from Security" }],
      ]),
    );

    const facts: Awaited<
      ReturnType<typeof SecurityCaseNotifications.getFacts>
    > = await SecurityCaseNotifications.getFacts(assignedCase());

    expect(facts.assignee).toBe("Alice from Security");
    expect(withheldIn).toHaveBeenCalledTimes(1);
    expect(withheldIn.mock.calls[0]![0].projectId).toBe(PROJECT_ID);
  });

  test("someone only invited with no name typed is named by their address", async () => {
    withheldIn.mockResolvedValue(
      new Map<string, WithheldProfile>([
        [ASSIGNEE_ID.toString(), { inviteeName: null }],
      ]),
    );

    const facts: Awaited<
      ReturnType<typeof SecurityCaseNotifications.getFacts>
    > = await SecurityCaseNotifications.getFacts(assignedCase());

    expect(facts.assignee).toBe("alice@example.com");
  });

  test("a member is named by their own name", async () => {
    const facts: Awaited<
      ReturnType<typeof SecurityCaseNotifications.getFacts>
    > = await SecurityCaseNotifications.getFacts(assignedCase());

    expect(facts.assignee).toBe("Alice Account");
  });
});

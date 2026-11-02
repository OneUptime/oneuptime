import { ApiRequestOptions } from "../Core/ApiClient";

const mockExecuteApiRequest: jest.Mock = jest.fn();
jest.mock("../Core/ApiClient", () => {
  return {
    ...jest.requireActual("../Core/ApiClient"),
    executeApiRequest: (...args: unknown[]): unknown => {
      return mockExecuteApiRequest(...args);
    },
  };
});

import { discoverResources } from "../Commands/ResourceCommands";
import { ResourceInfo } from "../Types/CLITypes";
import {
  clearTestCredentials,
  CliRun,
  INCIDENT_ID,
  runCli,
  TEAM_ID,
  TEST_API_KEY,
  TEST_URL,
  USER_ID,
  useTestCredentials,
} from "./Helpers/RunCli";
import { normalizePersonEmail } from "Common/Utils/DeveloperDocs/PeopleByEmail";

/*
 * People named by email address (Utils/People.ts, by the rules of
 * Common/Utils/DeveloperDocs/PeopleByEmail): found among the API key's own
 * project's members and invitees, through its team members, and sent by
 * ID - or, for a team member nobody in the project has the address of,
 * invited by it.
 */

const OTHER_USER_ID: string = "8e4c7d0f-9b1a-4c3d-9e6f-7a8b9c0d1e2f";

function commandOf(tableName: string): string {
  return (
    discoverResources().find((resource: ResourceInfo): boolean => {
      return resource.tableName === tableName;
    }) as ResourceInfo
  ).name;
}

// Answers like OneUptime: the project's members, by address.
function projectMembers(members: Record<string, string>): void {
  mockExecuteApiRequest.mockImplementation(
    async (options: ApiRequestOptions): Promise<unknown> => {
      if (options.apiPath === "/team-member" && options.operation === "list") {
        const email: string = String(
          (options.query?.["user"] as Record<string, unknown>)?.["email"] || "",
        );
        const id: string | undefined = members[email];

        return id
          ? [
              {
                _id: TEAM_ID,
                userId: { _type: "ObjectID", value: id },
                user: { _id: id, email: { _type: "Email", value: email } },
              },
            ]
          : [];
      }

      return { _id: INCIDENT_ID };
    },
  );
}

function requests(): Array<ApiRequestOptions> {
  return mockExecuteApiRequest.mock.calls.map(
    (call: Array<unknown>): ApiRequestOptions => {
      return call[0] as ApiRequestOptions;
    },
  );
}

function writes(): Array<ApiRequestOptions> {
  return requests().filter((request: ApiRequestOptions): boolean => {
    return request.operation === "create" || request.operation === "update";
  });
}

describe("people named by email address", () => {
  beforeEach(() => {
    mockExecuteApiRequest.mockReset();
    useTestCredentials();
  });

  afterEach(() => {
    clearTestCredentials();
  });

  it("are found among the project's members, by the whole address in any case, and sent by ID", async () => {
    projectMembers({ "alice@example.com": USER_ID });

    const run: CliRun = await runCli([
      commandOf("IncidentOwnerUser"),
      "create",
      "--incident-id",
      INCIDENT_ID,
      "--user-email",
      "  Alice@Example.com ",
      "--json",
    ]);

    expect(run.exitCode).toBeUndefined();

    const lookup: ApiRequestOptions = requests()[0] as ApiRequestOptions;

    expect(lookup).toEqual(
      expect.objectContaining({
        apiUrl: TEST_URL,
        apiKey: TEST_API_KEY,
        apiPath: "/team-member",
        operation: "list",
        query: { user: { email: "alice@example.com" } },
      }),
    );
    expect(lookup.select).toEqual(
      expect.objectContaining({ userId: true, user: { _id: true, email: true } }),
    );
    expect(writes()).toHaveLength(1);
    expect(writes()[0]?.data).toEqual({ incidentId: INCIDENT_ID, userId: USER_ID });
    expect(writes()[0]?.miscDataProps).toEqual({});
  });

  it("invite a team member nobody in the project has the address of, as the dashboard's Invite does", async () => {
    projectMembers({});

    const run: CliRun = await runCli([
      "team-member",
      "create",
      "--team-id",
      TEAM_ID,
      "--user-email",
      "New.Person@Example.com",
    ]);

    expect(run.exitCode).toBeUndefined();
    expect(writes()).toHaveLength(1);
    // No ID: the server invites the address, and makes the member.
    expect(writes()[0]?.data).toEqual({ teamId: TEAM_ID });
    expect(writes()[0]?.miscDataProps).toEqual({
      email: normalizePersonEmail("New.Person@Example.com"),
    });
  });

  it("add someone already in the project to a team by their ID, without an invitation", async () => {
    projectMembers({ "bob@example.com": USER_ID });

    await runCli([
      "team-member",
      "create",
      "--team-id",
      TEAM_ID,
      "--user-email",
      "bob@example.com",
    ]);

    expect(writes()[0]?.data).toEqual({ teamId: TEAM_ID, userId: USER_ID });
    expect(writes()[0]?.miscDataProps).toEqual({});
  });

  it("refuse an address nobody in the project has where nobody is invited, saying how to invite them", async () => {
    projectMembers({});

    const run: CliRun = await runCli([
      commandOf("IncidentOwnerUser"),
      "create",
      "--incident-id",
      INCIDENT_ID,
      "--user-email",
      "stranger@example.com",
    ]);

    expect(run.exitCode).toBe(1);
    expect(writes()).toHaveLength(0);
    expect(run.errors.join("\n")).toContain(
      "No one in this project, or invited to it, has the email address stranger@example.com. Invite them with `oneuptime team-member create --team-id <team-id> --user-email stranger@example.com`",
    );
  });

  it("take a list of people by address, every one found, in the order given", async () => {
    projectMembers({ "alice@example.com": USER_ID, "bob@example.com": OTHER_USER_ID });

    await runCli([
      commandOf("IncidentOwnerRule"),
      "update",
      INCIDENT_ID,
      "--owner-user-emails",
      "bob@example.com, alice@example.com",
    ]);

    expect(writes()).toHaveLength(1);
    expect(writes()[0]?.data).toEqual({
      ownerUsers: [{ _id: OTHER_USER_ID }, { _id: USER_ID }],
    });
  });

  it("refuse a list with anyone the project does not have", async () => {
    projectMembers({ "alice@example.com": USER_ID });

    const run: CliRun = await runCli([
      commandOf("IncidentOwnerRule"),
      "update",
      INCIDENT_ID,
      "--owner-user-emails",
      "alice@example.com,nobody@example.com",
    ]);

    expect(run.exitCode).toBe(1);
    expect(writes()).toHaveLength(0);
    expect(run.errors.join("\n")).toContain("nobody@example.com");
  });

  it("take the address in --data under its companion's name, as the Terraform provider names it", async () => {
    projectMembers({ "alice@example.com": USER_ID });

    await runCli([
      "team-member",
      "create",
      "--data",
      JSON.stringify({ teamId: TEAM_ID, userEmail: "alice@example.com" }),
    ]);

    expect(writes()[0]?.data).toEqual({ teamId: TEAM_ID, userId: USER_ID });
  });

  it("refuse a person named twice, by ID and by address", async () => {
    projectMembers({ "alice@example.com": USER_ID });

    const run: CliRun = await runCli([
      "team-member",
      "create",
      "--team-id",
      TEAM_ID,
      "--user-id",
      USER_ID,
      "--user-email",
      "alice@example.com",
    ]);

    expect(run.exitCode).toBe(1);
    expect(mockExecuteApiRequest).not.toHaveBeenCalled();
    expect(run.errors.join("\n")).toContain(
      "Give --user-id or --user-email, not both: each names the same person.",
    );
  });

  it("say what the key needs when it may not read the project's members", async () => {
    mockExecuteApiRequest.mockRejectedValue(
      new Error("API error (422): You do not have permissions to read Team Member."),
    );

    const run: CliRun = await runCli([
      "team-member",
      "create",
      "--team-id",
      TEAM_ID,
      "--user-email",
      "alice@example.com",
    ]);

    expect(run.exitCode).toBe(1);
    expect(run.errors.join("\n")).toContain(
      "The CLI finds alice@example.com among this project's members and invitees, and could not:",
    );
    expect(run.errors.join("\n")).toContain(
      "the key needs a permission that may read those, such as Project Member, Project Admin or Read Teams. Or name the person by user ID instead.",
    );
  });

  it("leave a person named by ID as it is, without a lookup", async () => {
    projectMembers({});

    await runCli(["team-member", "create", "--team-id", TEAM_ID, "--user-id", USER_ID]);

    expect(requests()).toHaveLength(1);
    expect(writes()[0]?.data).toEqual({ teamId: TEAM_ID, userId: USER_ID });
  });
});

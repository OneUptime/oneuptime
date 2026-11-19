import { Command, Option } from "commander";
import { getCustomRoleDeleteWorkflowEditRefusedMessage, getCustomRoleDeleteWorkflowsMessage } from "Common/Types/Workflow/WorkflowRunAs";
import { getDeleteChoices } from "Common/Utils/DeveloperDocs/DeleteChoices";
import { ResourceInfo } from "../Types/CLITypes";

/*
 * DELETING A CUSTOM ROLE THAT WORKFLOWS RUN AS, FROM THE COMMAND LINE (#9949)
 *
 * OneUptime deletes such a role only when the delete says what the
 * workflows run as instead, in miscDataProps, and refuses one that does not,
 * naming the workflows. `oneuptime custom-role delete` sent no body, so it
 * could not delete one at all. These run the CLI's real program
 * (Helpers/RunCli) with the request it makes stood in for: its flags, their
 * help, what they send, what is refused before anything is sent, and what a
 * refusal from OneUptime says. DeleteChoicesOverTheWire sends the requests.
 */

const mockExecuteApiRequest: jest.Mock = jest.fn();

jest.mock("../Core/ApiClient", () => {
  return {
    ...jest.requireActual("../Core/ApiClient"),
    executeApiRequest: (...args: Array<unknown>): unknown => {
      return mockExecuteApiRequest(...args);
    },
  };
});

import { buildProgram } from "../Program";
import {
  addAllResourceSubcommands,
  discoverResources,
} from "../Commands/ResourceCommands";
import { ApiRequestOptions } from "../Core/ApiClient";
import {
  clearTestCredentials,
  CliRun,
  printedJson,
  runCli,
  useTestCredentials,
} from "./Helpers/RunCli";
import {
  getDeleteChoiceExamples,
  getDeleteChoiceFlagWays,
} from "../Utils/DeleteChoiceFlags";

const ROLE_ID: string = "5a0e0000-0000-4000-8000-0000000000aa";
const OTHER_ROLE_ID: string = "5a0e0000-0000-4000-8000-0000000000bb";

// The words OneUptime refuses a delete with that says nothing.
const REFUSAL: string = getCustomRoleDeleteWorkflowsMessage({
  roleNames: ["Incident Responder"],
  workflowNames: ["Close stale incidents", "Page the database team"],
  workflowCount: 2,
});

const HINT: string =
  "Run it again with --workflows-run-as Default, or with --workflows-run-as CustomRole --workflows-run-as-custom-role-id <custom-role-id>. Find <custom-role-id> with `oneuptime custom-role list`.";

function deleteCommandOf(program: Command, resource: string): Command {
  const resourceCommand: Command | undefined = program.commands.find(
    (command: Command): boolean => {
      return command.name() === resource;
    },
  );
  const deleteCommand: Command | undefined = resourceCommand?.commands.find(
    (command: Command): boolean => {
      return command.name() === "delete";
    },
  );

  expect(deleteCommand).toBeDefined();

  return deleteCommand!;
}

function flagsOf(command: Command): Array<string> {
  return command.options.map((option: Option): string => {
    return option.flags;
  });
}

// What the one request a run made sent.
function sent(): ApiRequestOptions {
  expect(mockExecuteApiRequest).toHaveBeenCalledTimes(1);

  return mockExecuteApiRequest.mock.calls[0][0] as ApiRequestOptions;
}

async function deleteRole(...flags: Array<string>): Promise<CliRun> {
  return runCli(["custom-role", "delete", ROLE_ID, ...flags]);
}

describe("oneuptime custom-role delete", () => {
  let program: Command;

  beforeAll(() => {
    program = addAllResourceSubcommands(buildProgram());
  });

  beforeEach(() => {
    mockExecuteApiRequest.mockReset();
    mockExecuteApiRequest.mockResolvedValue({});
    useTestCredentials();
  });

  afterEach(() => {
    clearTestCredentials();
  });

  describe("its flags", () => {
    test("say what the workflows run as instead, named for what the API takes", () => {
      expect(flagsOf(deleteCommandOf(program, "custom-role"))).toEqual([
        "--force",
        "--workflows-run-as <value>",
        "--workflows-run-as-custom-role-id <id>",
        "-o, --output <format>",
        "--json",
      ]);
    });

    test("say what each is, naming the other by its flag, never miscDataProps", () => {
      const options: ReadonlyArray<Option> = deleteCommandOf(
        program,
        "custom-role",
      ).options;
      const help: Record<string, string> = Object.fromEntries(
        options.map((option: Option): [string, string] => {
          return [option.long || "", option.description];
        }),
      );

      expect(help["--workflows-run-as"]).toBe(
        'What the workflows that run as this custom role run as once it is deleted: "Default", the default permissions, or "CustomRole", another custom role you could give a team, named in --workflows-run-as-custom-role-id. Never Project Owner: deleting a role never raises what a workflow can do.',
      );
      expect(help["--workflows-run-as-custom-role-id"]).toBe(
        'The ID of the other custom role the workflows run as, when --workflows-run-as is "CustomRole": one you could give a team, and not the role being deleted. An ID from `oneuptime custom-role list`.',
      );

      for (const option of options) {
        expect(option.description).not.toContain("miscDataProps");
      }
    });

    test("only a custom role's delete has them: every other resource's delete is as it was", () => {
      const others: Array<ResourceInfo> = discoverResources().filter(
        (resource: ResourceInfo): boolean => {
          return (
            resource.operations.includes("delete" as never) &&
            !getDeleteChoices(resource.tableName)
          );
        },
      );

      expect(others.length).toBeGreaterThan(100);

      for (const resource of others) {
        expect({
          resource: resource.name,
          flags: flagsOf(deleteCommandOf(program, resource.name)),
        }).toEqual({
          resource: resource.name,
          flags: ["--force", "-o, --output <format>", "--json"],
        });
      }
    });

    test("its help says when they are needed, with an example of each way", async () => {
      const run: CliRun = await runCli(["custom-role", "delete", "--help"]);
      const help: string = run.printed.join("\n").replace(/\s+/g, " ");

      expect(run.exitCode).toBe(0);
      expect(help).toContain("--workflows-run-as <value>");
      expect(help).toContain("--workflows-run-as-custom-role-id <id>");
      expect(help).toContain(
        "OneUptime deletes a custom role that workflows run as only when the delete says what they run as instead, and refuses one that does not, naming the workflows.",
      );
      expect(help).toContain(
        "Examples: oneuptime custom-role delete <id> --workflows-run-as Default oneuptime custom-role delete <id> --workflows-run-as CustomRole --workflows-run-as-custom-role-id <custom-role-id>",
      );
      expect(mockExecuteApiRequest).not.toHaveBeenCalled();
    });

    test("another resource's delete help says nothing of them", async () => {
      const run: CliRun = await runCli(["team", "delete", "--help"]);
      const help: string = run.printed.join("\n");

      expect(run.exitCode).toBe(0);
      expect(help).not.toContain("workflows");
      expect(help).not.toContain("Examples:");
    });

    test("each way the help shows is the one the refusal's hint names", () => {
      const roleResource: ResourceInfo = discoverResources().find(
        (resource: ResourceInfo): boolean => {
          return resource.name === "custom-role";
        },
      )!;

      expect(getDeleteChoiceFlagWays("CustomRole")).toEqual([
        "--workflows-run-as Default",
        "--workflows-run-as CustomRole --workflows-run-as-custom-role-id <custom-role-id>",
      ]);
      expect(getDeleteChoiceExamples(roleResource)).toEqual([
        "oneuptime custom-role delete <id> --workflows-run-as Default",
        "oneuptime custom-role delete <id> --workflows-run-as CustomRole --workflows-run-as-custom-role-id <custom-role-id>",
      ]);
      expect(getDeleteChoiceFlagWays("Team")).toEqual([]);
    });
  });

  describe("what it sends", () => {
    test("nothing besides the record when no flag is given, as before", async () => {
      const run: CliRun = await deleteRole();

      expect(run.exitCode).toBeUndefined();
      expect(sent()).toEqual(
        expect.objectContaining({
          apiPath: "/custom-role",
          operation: "delete",
          id: ROLE_ID,
          miscDataProps: {},
        }),
      );
      expect(run.printed).toEqual([
        `Custom Role ${ROLE_ID} deleted successfully.`,
      ]);
    });

    test.each([["Default"], ["default"], ["DEFAULT"]])(
      "--workflows-run-as %s: Default",
      async (written: string) => {
        const run: CliRun = await deleteRole("--workflows-run-as", written);

        expect(run.exitCode).toBeUndefined();
        expect(sent().miscDataProps).toEqual({ workflowsRunAs: "Default" });
      },
    );

    test.each([["CustomRole"], ["custom-role"], ["customrole"]])(
      "--workflows-run-as %s with the other role's ID: CustomRole and the role",
      async (written: string) => {
        const run: CliRun = await deleteRole(
          "--workflows-run-as",
          written,
          "--workflows-run-as-custom-role-id",
          OTHER_ROLE_ID,
        );

        expect(run.exitCode).toBeUndefined();
        expect(sent().miscDataProps).toEqual({
          workflowsRunAs: "CustomRole",
          workflowsRunAsCustomRoleId: OTHER_ROLE_ID,
        });
      },
    );

    test("the flags may come before the ID, and with =", async () => {
      await runCli([
        "custom-role",
        "delete",
        `--workflows-run-as=CustomRole`,
        `--workflows-run-as-custom-role-id=${OTHER_ROLE_ID}`,
        ROLE_ID,
      ]);

      expect(sent().id).toBe(ROLE_ID);
      expect(sent().miscDataProps).toEqual({
        workflowsRunAs: "CustomRole",
        workflowsRunAsCustomRoleId: OTHER_ROLE_ID,
      });
    });

    test("answers as every delete does, in JSON too", async () => {
      const run: CliRun = await deleteRole(
        "--workflows-run-as",
        "Default",
        "--json",
      );

      expect(run.exitCode).toBeUndefined();
      expect(printedJson(run)).toEqual({ _id: ROLE_ID, deleted: true });
    });

    test("another resource's delete sends nothing besides the record", async () => {
      await runCli(["team", "delete", OTHER_ROLE_ID]);

      expect(sent()).toEqual(
        expect.objectContaining({
          apiPath: "/team",
          operation: "delete",
          id: OTHER_ROLE_ID,
          miscDataProps: {},
        }),
      );
    });

    test("another resource's delete has no such flag", async () => {
      const run: CliRun = await runCli([
        "team",
        "delete",
        OTHER_ROLE_ID,
        "--workflows-run-as",
        "Default",
      ]);

      expect(run.exitCode).toBe(1);
      expect(run.errors.join("\n")).toContain(
        "unknown option '--workflows-run-as'",
      );
      expect(mockExecuteApiRequest).not.toHaveBeenCalled();
    });
  });

  describe("what it refuses before anything is sent", () => {
    test.each([
      [
        ["--workflows-run-as", "ProjectOwner"],
        'Error: --workflows-run-as can\'t be "ProjectOwner": deleting a role never raises what a workflow can do. Choose "Default", or "CustomRole" with --workflows-run-as-custom-role-id.',
      ],
      [
        ["--workflows-run-as", "project-owner"],
        'Error: --workflows-run-as can\'t be "project-owner": deleting a role never raises what a workflow can do. Choose "Default", or "CustomRole" with --workflows-run-as-custom-role-id.',
      ],
      [
        [
          "--workflows-run-as",
          "ProjectOwner",
          "--workflows-run-as-custom-role-id",
          OTHER_ROLE_ID,
        ],
        'Error: --workflows-run-as can\'t be "ProjectOwner": deleting a role never raises what a workflow can do. Choose "Default", or "CustomRole" with --workflows-run-as-custom-role-id.',
      ],
      [
        ["--workflows-run-as", "Admin"],
        'Error: --workflows-run-as takes "Default" or "CustomRole", and "Admin" is neither.',
      ],
      [
        ["--workflows-run-as", "CustomRole"],
        'Error: --workflows-run-as is "CustomRole", which needs --workflows-run-as-custom-role-id too. Add --workflows-run-as-custom-role-id, or set --workflows-run-as to "Default".',
      ],
      [
        ["--workflows-run-as-custom-role-id", OTHER_ROLE_ID],
        'Error: --workflows-run-as-custom-role-id goes with --workflows-run-as set to "CustomRole", and --workflows-run-as isn\'t given. Set --workflows-run-as to "CustomRole", or leave --workflows-run-as-custom-role-id out.',
      ],
      [
        [
          "--workflows-run-as",
          "Default",
          "--workflows-run-as-custom-role-id",
          OTHER_ROLE_ID,
        ],
        'Error: --workflows-run-as-custom-role-id goes with --workflows-run-as set to "CustomRole", and --workflows-run-as is "Default". Set --workflows-run-as to "CustomRole", or leave --workflows-run-as-custom-role-id out.',
      ],
      [
        [
          "--workflows-run-as",
          "CustomRole",
          "--workflows-run-as-custom-role-id",
          "responders",
        ],
        'Error: --workflows-run-as-custom-role-id takes an ID, such as 6f1c2a40-3b1e-4c55-9a0b-3e2f8d7c1a11, and "responders" is not one.',
      ],
      [
        [
          "--workflows-run-as",
          "CustomRole",
          "--workflows-run-as-custom-role-id",
          ROLE_ID.toUpperCase(),
        ],
        'Error: --workflows-run-as-custom-role-id names the custom role being deleted. Name another custom role, or set --workflows-run-as to "Default".',
      ],
    ])(
      "%j",
      async (flags: Array<string>, expected: string) => {
        const run: CliRun = await deleteRole(...flags);

        expect(run.exitCode).toBe(1);
        expect(run.errors).toEqual([expected]);
        expect(mockExecuteApiRequest).not.toHaveBeenCalled();
      },
    );

    test("before it needs a key", async () => {
      clearTestCredentials();

      const run: CliRun = await deleteRole("--workflows-run-as", "ProjectOwner");

      expect(run.exitCode).toBe(1);
      expect(run.errors[0]).toContain("can't be \"ProjectOwner\"");
      expect(mockExecuteApiRequest).not.toHaveBeenCalled();
    });

    test("asked for JSON, as one error object on standard error", async () => {
      const run: CliRun = await deleteRole(
        "--workflows-run-as",
        "ProjectOwner",
        "--json",
      );

      expect(run.exitCode).toBe(1);
      expect(run.printed).toEqual([]);
      expect(JSON.parse(run.errors.join("\n"))).toEqual({
        error: {
          message:
            '--workflows-run-as can\'t be "ProjectOwner": deleting a role never raises what a workflow can do. Choose "Default", or "CustomRole" with --workflows-run-as-custom-role-id.',
          status: null,
          exitCode: 1,
          hint: null,
        },
      });
    });
  });

  describe("a delete OneUptime refuses", () => {
    test("for what the workflows run as: its words name them, and the hint names the flags", async () => {
      mockExecuteApiRequest.mockRejectedValue(
        new Error(`API error (400): ${REFUSAL}`),
      );

      const run: CliRun = await deleteRole();

      expect(run.exitCode).toBe(1);
      expect(run.errors).toEqual([`API error (400): ${REFUSAL}`, HINT]);
      expect(REFUSAL).toContain(
        'The workflows "Close stale incidents" and "Page the database team" run as the custom role "Incident Responder".',
      );
    });

    test("asked for JSON, the hint goes with the API's words", async () => {
      mockExecuteApiRequest.mockRejectedValue(
        new Error(`API error (400): ${REFUSAL}`),
      );

      const run: CliRun = await deleteRole("--json");

      expect(run.exitCode).toBe(1);
      expect(JSON.parse(run.errors.join("\n"))).toEqual({
        error: {
          message: `API error (400): ${REFUSAL}`,
          status: 400,
          exitCode: 1,
          hint: HINT,
        },
      });
    });

    test("for something else, once the flags said what they run as: its own words, and no hint about the flags", async () => {
      const refusal: string = getCustomRoleDeleteWorkflowEditRefusedMessage({
        workflowName: "Close stale incidents",
      });

      mockExecuteApiRequest.mockRejectedValue(
        new Error(`API error (403): ${refusal}`),
      );

      const run: CliRun = await deleteRole("--workflows-run-as", "Default");

      expect(run.exitCode).toBe(1);
      expect(run.errors[0]).toBe(`API error (403): ${refusal}`);
      expect(run.errors.join("\n")).not.toContain("Run it again with");
    });

    test("another resource's delete gets no hint about the flags, whatever the API says", async () => {
      mockExecuteApiRequest.mockRejectedValue(
        new Error(`API error (400): ${REFUSAL}`),
      );

      const run: CliRun = await runCli(["team", "delete", OTHER_ROLE_ID]);

      expect(run.exitCode).toBe(1);
      expect(run.errors.join("\n")).not.toContain("--workflows-run-as");
    });

    test("a role that is not found is still not found", async () => {
      mockExecuteApiRequest.mockRejectedValue(
        new Error("API error (404): Custom Role not found."),
      );

      const run: CliRun = await deleteRole();

      expect(run.exitCode).toBe(3);
      expect(run.errors.join("\n")).toContain("custom-role list");
      expect(run.errors.join("\n")).not.toContain("--workflows-run-as");
    });
  });
});

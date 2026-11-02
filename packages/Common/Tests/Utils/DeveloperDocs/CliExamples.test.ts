import { describe, expect, test } from "@jest/globals";
import Incident from "../../../Models/DatabaseModels/Incident";
import Label from "../../../Models/DatabaseModels/Label";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import TeamMember from "../../../Models/DatabaseModels/TeamMember";
import { CliAction, CliOperation } from "../../../Utils/DeveloperDocs/CliCommands";
import {
  CLI_EXAMPLE_LINE_LIMIT,
  CliExample,
  formatCliCommand,
  getCliActionExample,
  getCliConnectCommands,
  getCliCountExample,
  getCliCreateExample,
  getCliDeleteExample,
  getCliFieldsExample,
  getCliGetExample,
  getCliInstallScriptCommands,
  getCliListExample,
  getCliLoginCommand,
  getCliNpmInstallCommand,
  getCliUpdateExample,
  getCliWriteArgs,
} from "../../../Utils/DeveloperDocs/CliExamples";
import { SETUP_GUIDE_URL_PLACEHOLDER } from "../../../../App/FeatureSet/Dashboard/src/Components/SetupGuide/SetupGuide";

/*
 * The CLI's commands as the Developer > CLI pages show them: the words the
 * CLI is given, and the line a reader copies - quoted for a POSIX shell,
 * on one line when short, a flag a line when long. packages/CLI/Tests/
 * DeveloperDocsCommands runs them through the CLI's real program.
 */

const ID: string = "6f1c2a40-3b1e-4c55-9a0b-3e2f8d7c1a11";
const OTHER: string = "1d7b0c3e-2a4f-4b6c-8d9e-0f1a2b3c4d5e";
const USER: string = "0aa1b2c3-d4e5-4f60-8a7b-9c0d1e2f3a4b";
const ORIGIN: string = "https://oneuptime.example.com";

describe("a command's line", () => {
  test("is one line when it fits", () => {
    expect(formatCliCommand(["incident", "list", "--json"])).toBe(
      "oneuptime incident list --json",
    );
  });

  test("goes a flag a line, with its value, when it does not", () => {
    const line: string = formatCliCommand([
      "incident",
      "create",
      "--title",
      "Checkout requests are failing for every customer",
      "--incident-severity-id",
      ID,
      "--json",
    ]);

    expect(line).toBe(
      [
        "oneuptime incident create \\",
        "  --title 'Checkout requests are failing for every customer' \\",
        `  --incident-severity-id ${ID} \\`,
        "  --json",
      ].join("\n"),
    );
    expect(line.split("\n")[0]?.length).toBeLessThanOrEqual(CLI_EXAMPLE_LINE_LIMIT);
  });

  test("quotes a word a shell would split or read: spaces, quotes, JSON", () => {
    expect(formatCliCommand(["label", "create", "--name", "Bob's API"])).toBe(
      "oneuptime label create --name 'Bob'\\''s API'",
    );
    expect(
      formatCliCommand(["incident", "list", "--query", '{"title":"x"}']),
    ).toBe(`oneuptime incident list --query '{"title":"x"}'`);
  });
});

describe("a create's and an update's fields, as flags", () => {
  test("write each value as its flag takes it", () => {
    expect(
      getCliWriteArgs({
        modelType: Incident,
        operation: CliOperation.Create,
        values: {
          title: "Checkout is down",
          incidentSeverityId: ID,
          monitors: [{ _id: ID }, { _id: OTHER }],
          isVisibleOnStatusPage: false,
          customFields: { region: "eu" },
        },
      }),
    ).toEqual([
      "--title",
      "Checkout is down",
      "--incident-severity-id",
      ID,
      "--monitors",
      `${ID},${OTHER}`,
      "--is-visible-on-status-page",
      "false",
      "--custom-fields",
      '{"region":"eu"}',
    ]);
  });

  test("take an ID the API wraps, and a color", () => {
    expect(
      getCliWriteArgs({
        modelType: Label,
        operation: CliOperation.Create,
        values: { name: "production", color: { _type: "Color", value: "#ff0000" } },
      }),
    ).toEqual(["--name", "production", "--color", "#ff0000"]);
  });

  test("put a field no flag carries in --data, whole", () => {
    expect(
      getCliWriteArgs({
        modelType: Monitor,
        operation: CliOperation.Update,
        values: { name: "Website", projectId: ID },
      }),
    ).toEqual(["--name", "Website", "--data", JSON.stringify({ projectId: ID })]);
  });

  test("name the viewer by their address, and anyone else by ID", () => {
    expect(
      getCliWriteArgs({
        modelType: TeamMember,
        operation: CliOperation.Create,
        values: { teamId: ID, userId: USER },
        emailsById: { [USER]: "you@acme.example" },
      }),
    ).toEqual(["--team-id", ID, "--user-email", "you@acme.example"]);
    expect(
      getCliWriteArgs({
        modelType: TeamMember,
        operation: CliOperation.Create,
        values: { teamId: ID, userId: OTHER },
        emailsById: { [USER]: "you@acme.example" },
      }),
    ).toEqual(["--team-id", ID, "--user-id", OTHER]);
  });

  test("end with --json, for what the page shows the CLI printing", () => {
    expect(
      getCliCreateExample({ modelType: Label, values: { name: "a", color: "#000000" } }).args,
    ).toEqual(["label", "create", "--name", "a", "--color", "#000000", "--json"]);
    expect(
      getCliUpdateExample({ modelType: Label, id: ID, values: { name: "b" } }).args,
    ).toEqual(["label", "update", ID, "--name", "b", "--json"]);
  });
});

describe("reads", () => {
  test("a list: its query and fields, its page; newest first is the CLI's own order", () => {
    const list: CliExample = getCliListExample({
      modelType: Incident,
      query: { title: { _type: "Search", value: "checkout" } },
      select: { _id: true, title: true, createdAt: true },
      sort: { createdAt: "DESC" },
      limit: 10,
    });

    expect(list.args).toEqual([
      "incident",
      "list",
      "--query",
      '{"title":{"_type":"Search","value":"checkout"}}',
      "--fields",
      "title,createdAt",
      "--limit",
      "10",
      "--json",
    ]);
  });

  test("a list in another order says so", () => {
    expect(
      getCliListExample({ modelType: Label, sort: { name: "ASC" } }).args,
    ).toEqual(["label", "list", "--sort", '{"name":"ASC"}', "--json"]);
  });

  test("a get, a count, a delete and a resource's fields", () => {
    expect(getCliGetExample({ modelType: Incident, id: ID }).command).toBe(
      `oneuptime incident get ${ID} --json`,
    );
    expect(getCliCountExample({ modelType: Incident }).command).toBe(
      "oneuptime incident count",
    );
    expect(
      getCliCountExample({ modelType: Incident, query: { title: "x" } }).args,
    ).toEqual(["incident", "count", "--query", '{"title":"x"}']);
    expect(getCliDeleteExample({ modelType: Incident, id: ID }).command).toBe(
      `oneuptime incident delete ${ID}`,
    );
    expect(getCliFieldsExample(Incident).command).toBe("oneuptime incident fields");
  });

  test("a dashboard button: acknowledge, and a public note", () => {
    expect(
      getCliActionExample({ modelType: Incident, action: CliAction.Acknowledge, id: ID }).args,
    ).toEqual(["incident", "acknowledge", ID]);
    expect(
      getCliActionExample({
        modelType: Incident,
        action: CliAction.AddNote,
        id: ID,
        note: "Fixed.",
        isPublic: true,
      }).args,
    ).toEqual(["incident", "add-note", ID, "--note", "Fixed.", "--public"]);
  });
});

describe("installing and connecting", () => {
  test("downloads the installer from this OneUptime, then runs it with this OneUptime's address", () => {
    expect(getCliInstallScriptCommands(ORIGIN)).toBe(
      [
        `curl -fsSL ${ORIGIN}/install/cli -o install.sh`,
        `ONEUPTIME_URL=${ORIGIN} bash install.sh`,
      ].join("\n"),
    );
  });

  test("quotes an address the dashboard does not know, so a shell never reads it as a redirection", () => {
    expect(getCliInstallScriptCommands(SETUP_GUIDE_URL_PLACEHOLDER)).toBe(
      [
        `curl -fsSL '${SETUP_GUIDE_URL_PLACEHOLDER}/install/cli' -o install.sh`,
        `ONEUPTIME_URL='${SETUP_GUIDE_URL_PLACEHOLDER}' bash install.sh`,
      ].join("\n"),
    );
  });

  test.each([
    ["14.0.101", "npm install -g @oneuptime/cli@14.0.101"],
    [" 14.0.101 ", "npm install -g @oneuptime/cli@14.0.101"],
    ["1.0.0", "npm install -g @oneuptime/cli"],
    ["unknown", "npm install -g @oneuptime/cli"],
    [null, "npm install -g @oneuptime/cli"],
  ])("installs with npm for OneUptime %j: %s", (version: string | null, command: string) => {
    expect(getCliNpmInstallCommand(version)).toBe(command);
  });

  test("connects with the key and the address in the environment, then checks them", () => {
    expect(getCliConnectCommands(ORIGIN)).toBe(
      [
        'export ONEUPTIME_API_KEY="your-api-key"',
        `export ONEUPTIME_URL=${ORIGIN}`,
        "oneuptime whoami --check",
      ].join("\n"),
    );
    expect(getCliLoginCommand(ORIGIN)).toBe(`oneuptime login <api-key> ${ORIGIN}`);
  });
});

import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * AN INCIDENT DECLARED FROM A CHAT IS LINKED TO WHAT IT IS ABOUT (#5303
 * follow-up).
 *
 * OneUptime AI investigates and fixes only what an incident is linked to,
 * and Slack's and Microsoft Teams' Declare Incident forms linked nothing.
 * Each piece that fixed that lives in its own chat's code, so a new form,
 * or a rewrite of one, could quietly drop it again. This holds every place
 * to it:
 *
 *   - every Slack or Teams file that creates an incident reads the picks
 *     again as the member (WorkspaceAffectedResources.readPicked) and puts
 *     them on the incident (setOnIncident), and reads the alert a form was
 *     declared from again (WorkspaceIncidentFromAlert.checkLink);
 *   - each chat's form offers the field the way only it can - Slack's
 *     external select, Teams' typeahead - and asks first whether there is
 *     anything to offer (isOffered);
 *   - each chat answers the field's search where the chat asks: Slack's
 *     Options Load URL, and Teams' "application/search" invoke, which is no
 *     button's press and is answered before any button handler sees it;
 *   - and no form ever starts with a monitor picked: a monitor linked to an
 *     incident a person declares pauses its checks.
 */

const COMMON_ROOT: string = path.resolve(__dirname, "../../../..");
const WORKSPACE_DIR: string = path.join(COMMON_ROOT, "Server/Utils/Workspace");

function readSource(relativePath: string): string {
  return fs.readFileSync(path.join(COMMON_ROOT, relativePath), "utf8");
}

// Every .ts file under a folder, as a path from Common's root.
function sourcesUnder(directory: string): Array<string> {
  const files: Array<string> = [];

  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const full: string = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      files.push(...sourcesUnder(full));
    } else if (entry.name.endsWith(".ts")) {
      files.push(path.relative(COMMON_ROOT, full));
    }
  }

  return files;
}

const DECLARE_FILES: Array<string> = [
  "Server/Utils/Workspace/Slack/Actions/Incident.ts",
  "Server/Utils/Workspace/MicrosoftTeams/Actions/Incident.ts",
];

describe("every chat that declares an incident links it", () => {
  test("the files that create an incident from a chat are the two Declare Incident forms'", () => {
    const creators: Array<string> = sourcesUnder(WORKSPACE_DIR).filter(
      (file: string): boolean => {
        return readSource(file).includes("IncidentService.create(");
      },
    );

    expect(creators.sort()).toEqual([...DECLARE_FILES].sort());
  });

  test.each(DECLARE_FILES)(
    "%s reads the picks again as the member, links them, and reads the alert of its channel again",
    (file: string) => {
      const source: string = readSource(file);

      expect(source).toContain("WorkspaceAffectedResources.readPicked(");
      expect(source).toContain("WORKSPACE_AFFECTED_RESOURCES_FIELD");
      expect(source).toContain("WorkspaceIncidentFromAlert.readValue(");
      expect(source).toContain("WorkspaceIncidentFromAlert.checkLink(");
      expect(source).toContain("WorkspaceAffectedResources.setOnIncident(");
    },
  );
});

describe("each chat's form offers the field, the way only it can", () => {
  test("Slack: the external select, after asking whether there is anything to offer", () => {
    const source: string = readSource(
      "Server/Utils/Workspace/Slack/Actions/Incident.ts",
    );

    expect(source).toContain("SlackAffectedResources.getField(");
    expect(source).toContain("WorkspaceAffectedResources.isOffered(");
    expect(source).toContain("WorkspaceIncidentFromAlert.readChannelAlert(");
  });

  test("Microsoft Teams: the typeahead, after asking whether there is anything to offer", () => {
    expect(
      readSource("Server/Utils/Workspace/MicrosoftTeams/Actions/Incident.ts"),
    ).toContain("MicrosoftTeamsAffectedResources.getInputElements(");

    const command: string = readSource(
      "Server/Utils/Workspace/MicrosoftTeams/MicrosoftTeamsCreateCommands.ts",
    );

    expect(command).toContain("WorkspaceAffectedResources.isOffered(");
    expect(command).toContain("WorkspaceIncidentFromAlert.readChannelAlert(");
  });
});

describe("each chat answers the field's search where the chat asks", () => {
  test("Slack's Options Load URL is answered by SlackAffectedResources", () => {
    const source: string = readSource("Server/API/SlackAPI.ts");
    const route: number = source.indexOf('"/slack/options-load"');

    expect(route).toBeGreaterThan(-1);

    const handler: string = source.substring(route, route + 600);

    expect(handler).toContain("SlackAuthorization.isAuthorizedSlackRequest");
    expect(handler).toContain("SlackAffectedResources.answerOptionsRequest(");
  });

  test("Slack's request reader takes a block_suggestion, read as the form's own submission", () => {
    expect(
      readSource("Server/Utils/Workspace/Slack/Actions/Auth.ts"),
    ).toContain('payload["type"] !== "block_suggestion"');
  });

  test("Teams' search invoke is answered by MicrosoftTeamsAffectedResources, before any button handler", () => {
    const source: string = readSource(
      "Server/Utils/Workspace/MicrosoftTeams/MicrosoftTeams.ts",
    );
    const onInvoke: number = source.indexOf(
      "protected override async onInvokeActivity(",
    );

    expect(onInvoke).toBeGreaterThan(-1);

    const body: string = source.substring(onInvoke);
    const search: number = body.indexOf(
      "MicrosoftTeamsAffectedResources.isSearch(",
    );
    const buttons: number = body.indexOf(
      "MicrosoftTeamsUtil.handleBotInvokeActivity(",
    );

    expect(search).toBeGreaterThan(-1);
    expect(buttons).toBeGreaterThan(-1);
    expect(search).toBeLessThan(buttons);
    expect(body.substring(search, buttons)).toContain(
      "MicrosoftTeamsAffectedResources.answerSearch(",
    );
  });
});

describe("no chat form starts with a monitor picked", () => {
  test("the alert's resources a form starts with leave its monitor out", () => {
    const source: string = readSource(
      "Server/Utils/Workspace/WorkspaceAffectedResources.ts",
    );
    const start: number = source.indexOf(
      "public static async readAlertResources(",
    );
    const end: number = source.indexOf("public static describe(", start);
    const reader: string = source.substring(start, end);

    // Only the kinds OneUptime AI links - never LinkedAffectedResourceType.Monitor.
    expect(reader).toContain("AI_AFFECTED_RESOURCE_KINDS");
    expect(reader).not.toContain("Monitor");
  });
});

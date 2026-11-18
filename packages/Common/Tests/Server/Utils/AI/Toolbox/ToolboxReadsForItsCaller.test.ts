import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import Monitor from "../../../../../Models/DatabaseModels/Monitor";
import Alert from "../../../../../Models/DatabaseModels/Alert";
import BasePermission from "../../../../../Server/Types/Database/Permissions/BasePermission";
import DatabaseRequestType from "../../../../../Server/Types/BaseDatabase/DatabaseRequestType";
import ReadAudience from "../../../../../Types/BaseDatabase/ReadAudience";
import ObjectID from "../../../../../Types/ObjectID";
import Permission from "../../../../../Types/Permission";
import {
  readAudienceOf,
  readAudienceProps,
} from "../../../../Helpers/ReadAudienceFixtures";

/*
 * EVERY TOOL READS FOR ITS CALLER (#9576). A tool reads with the props of
 * the run that calls it (ToolContext.props): a person's own, in Ask AI,
 * Slack or Microsoft Teams; an investigation's - root, narrowed for
 * everyone who may see its incident or alert (ReadAudience) - when an
 * investigation calls it. So the permission layer narrows a tool's reads
 * for the investigation's readers with no code of the tool's own, as long
 * as the tool reads with ctx.props.
 *
 * A read as OneUptime alone ({ isRoot: true }) escapes that, so each one
 * left in a tool is listed here, with why it reads nothing an
 * investigation's report could name that its readers may not read. A new
 * one fails this suite until it is weighed and listed.
 */

const TOOLBOX: string = path.resolve(
  __dirname,
  "../../../../../Server/Utils/AI/Toolbox",
);

const ROOT_READS_ALLOWED: Record<string, { count: number; why: string }> = {
  "AIMetaTools.ts": {
    count: 3,
    why: "get_ai_investigation and start_investigation read AI runs, which carry no owners or labels, of a subject read with ctx.props first - and an investigation is never offered them (AIInvestigationEngine.excludeToolNames).",
  },
  "AIActionTools.ts": {
    count: 1,
    why: "a write tool's own lookup: write tools run only for a signed-in person, never for an investigation (AIToolbox.executeTool).",
  },
  "AlertWriteTools.ts": {
    count: 2,
    why: "a write tool's states and links: write tools run only for a signed-in person.",
  },
  "IncidentWriteTools.ts": {
    count: 2,
    why: "a write tool's states and links: write tools run only for a signed-in person.",
  },
  "CodeWriteTools.ts": {
    count: 1,
    why: "a write tool's pull request record: write tools run only for a signed-in person.",
  },
  "SetupTools.ts": {
    count: 5,
    why: "Ask AI's setup actions, which wait for a person's approval and never run for an investigation.",
  },
  "StatusPageTools.ts": {
    count: 2,
    why: "the monitors a status page's resources name, and the project's monitor statuses: read through a status page read with ctx.props, as a person's read of the page names its monitors.",
  },
  "CodeTools.ts": {
    count: 1,
    why: "the GitHub installations of repositories already read with ctx.props (findReadableRepositories).",
  },
  "WorkflowProbeTools.ts": {
    count: 1,
    why: "OneUptime's global probes, which belong to no project.",
  },
};

function rootReadCount(source: string): number {
  return (source.match(/isRoot:\s*true/g) || []).length;
}

describe("the toolbox reads with its caller's props", () => {
  const files: Array<string> = fs
    .readdirSync(TOOLBOX)
    .filter((file: string): boolean => {
      return file.endsWith(".ts");
    });

  test.each(files)(
    "%s reads as OneUptime alone only where it is weighed",
    (file: string) => {
      const source: string = fs.readFileSync(path.join(TOOLBOX, file), "utf8");
      const allowed: { count: number; why: string } | undefined =
        ROOT_READS_ALLOWED[file];

      expect({ file, rootReads: rootReadCount(source) }).toEqual({
        file,
        rootReads: allowed ? allowed.count : 0,
      });
    },
  );

  test("every weighed file still exists, so the list never outlives its reason", () => {
    for (const file of Object.keys(ROOT_READS_ALLOWED)) {
      expect(files).toContain(file);
    }
  });
});

describe("a tool's read for an investigation is narrowed for its readers", () => {
  const PROJECT: ObjectID = new ObjectID(
    "11111111-1111-4111-8111-111111111111",
  );

  test("a read of monitors with the props an investigation hands its tools leaves out those set apart", async () => {
    const readers: ReadAudience = readAudienceOf({
      projectId: PROJECT,
      ownedOnlyPermissions: [Permission.ProjectMember],
    });
    const { query } = (await BasePermission.checkPermissions(
      Monitor,
      { projectId: PROJECT } as never,
      null,
      readAudienceProps(readers),
      DatabaseRequestType.Read,
    )) as unknown as { query: Record<string, unknown> };

    expect(query["_id"]).toBeDefined();
  });

  test("a read of alerts leaves out the private ones, whatever else narrows nobody", async () => {
    const { query } = (await BasePermission.checkPermissions(
      Alert,
      { projectId: PROJECT } as never,
      null,
      readAudienceProps(readAudienceOf({ projectId: PROJECT })),
      DatabaseRequestType.Read,
    )) as unknown as { query: Record<string, unknown> };

    expect(query["_id"]).toBeDefined();
  });
});

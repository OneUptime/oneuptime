import { REPOSITORY_DIRECTORY } from "../../../../Helpers/TagStripScan";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import ts from "typescript";

/*
 * NO MICROSOFT TEAMS CODE SPELLS OUT A MICROSOFT CLOUD'S HOST.
 *
 * A server's Microsoft Teams runs in one of Microsoft's clouds - the
 * commercial one, GCC, GCC High or DoD (MICROSOFT_TEAMS_CLOUD) - and its
 * bot, its sign-ins and its Teams meetings app must all go to that cloud's
 * hosts. Every one of them used to be written out as the commercial
 * cloud's, so a government tenant's sign-in went to login.microsoftonline
 * .com and its Graph reads to graph.microsoft.com, which do not know it.
 * Now Types/Workspace/MicrosoftTeamsCloud.ts is the one place that names
 * them, and MicrosoftTeamsHosts the one way the server builds an address.
 *
 * So no string the Teams code holds - a literal, a part of a template, a
 * JSX text - names a sign-in, Graph, Teams, Bot Framework or Teams-service
 * host, outside the table and MicrosoftTeamsServiceUrl's allowlist of
 * where a stored service URL may point (a check, not an address built).
 * Comments may name them.
 */

// The hosts, as any string naming one contains them.
const MICROSOFT_CLOUD_HOSTS: ReadonlyArray<string> = [
  "login.microsoftonline.",
  "graph.microsoft.",
  "dod-graph.microsoft.",
  "teams.microsoft.com",
  "teams.microsoft.us",
  "botframework.",
  "smba.",
];

// Where the Microsoft Teams code is: the bot, the sign-ins, the meetings app, the links.
const TEAMS_CODE: ReadonlyArray<string> = [
  "packages/Common/Server/Utils/Workspace/MicrosoftTeams",
  "packages/Common/Server/API/MicrosoftTeamsAPI.ts",
  "packages/Common/Server/API/VideoCallOAuthAPI.ts",
  "packages/Common/Server/Utils/VideoCall",
  "packages/Common/Server/Utils/Workspace/WorkspaceChannelLinks.ts",
  "packages/Common/Types/Workspace",
  "packages/Common/Types/VideoCall",
  "packages/App/FeatureSet/Dashboard/src/Components/MicrosoftTeams",
];

// The files that may name them, each with why.
const NAMES_THE_HOSTS: Record<string, string> = {
  "packages/Common/Types/Workspace/MicrosoftTeamsCloud.ts":
    "the table of every Microsoft cloud's hosts",
  "packages/Common/Server/Utils/Workspace/MicrosoftTeams/MicrosoftTeamsServiceUrl.ts":
    "the allowlist a stored Bot Framework service URL is checked against before the bot's token is sent to it",
};

const SOURCE_EXTENSIONS: ReadonlyArray<string> = [".ts", ".tsx"];

const filesUnder: (relative: string) => Array<string> = (
  relative: string,
): Array<string> => {
  const absolute: string = path.join(REPOSITORY_DIRECTORY, relative);

  if (!fs.statSync(absolute).isDirectory()) {
    return [relative];
  }

  const files: Array<string> = [];

  for (const entry of fs.readdirSync(absolute, { withFileTypes: true })) {
    const child: string = path.posix.join(relative, entry.name);

    if (entry.isDirectory()) {
      files.push(...filesUnder(child));
    } else if (
      SOURCE_EXTENSIONS.includes(path.extname(entry.name)) &&
      !entry.name.endsWith(".d.ts")
    ) {
      files.push(child);
    }
  }

  return files;
};

interface HostInString {
  file: string;
  line: number;
  host: string;
}

// Every string a source holds that names a host, where it is.
const hostsInSource: (file: string, text: string) => Array<HostInString> = (
  file: string,
  text: string,
): Array<HostInString> => {
  const source: ts.SourceFile = ts.createSourceFile(
    file,
    text,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const found: Array<HostInString> = [];

  const visit: (node: ts.Node) => void = (node: ts.Node): void => {
    let value: string | null = null;

    if (
      ts.isStringLiteral(node) ||
      ts.isNoSubstitutionTemplateLiteral(node) ||
      ts.isTemplateHead(node) ||
      ts.isTemplateMiddle(node) ||
      ts.isTemplateTail(node)
    ) {
      value = node.text;
    } else if (ts.isJsxText(node)) {
      value = node.getText(source);
    }

    if (value !== null) {
      const lower: string = value.toLowerCase();

      for (const host of MICROSOFT_CLOUD_HOSTS) {
        if (lower.indexOf(host) !== -1) {
          found.push({
            file: file,
            line:
              source.getLineAndCharacterOfPosition(node.getStart(source)).line +
              1,
            host: host,
          });
        }
      }
    }

    ts.forEachChild(node, visit);
  };

  visit(source);

  return found;
};

// Every string `file` holds that names a host, where it is.
const hostsInStrings: (file: string) => Array<HostInString> = (
  file: string,
): Array<HostInString> => {
  return hostsInSource(
    file,
    fs.readFileSync(path.join(REPOSITORY_DIRECTORY, file), "utf8"),
  );
};

const teamsFiles: Array<string> = TEAMS_CODE.flatMap(filesUnder).sort();

describe("Microsoft cloud hosts in the Microsoft Teams code", () => {
  test("the code scanned is there: dozens of files, the table among them", () => {
    expect(teamsFiles.length).toBeGreaterThan(40);

    for (const file of Object.keys(NAMES_THE_HOSTS)) {
      expect(teamsFiles).toContain(file);
    }
  });

  test("no string outside the table names one", () => {
    const named: Array<string> = teamsFiles
      .filter((file: string): boolean => {
        return !(file in NAMES_THE_HOSTS);
      })
      .flatMap(hostsInStrings)
      .map((found: HostInString): string => {
        return `${found.file}:${found.line} names ${found.host}`;
      });

    expect(named).toEqual([]);
  });

  test("each file allowed to name them still does, so the list holds no stale entry", () => {
    for (const file of Object.keys(NAMES_THE_HOSTS)) {
      expect({ file, names: hostsInStrings(file).length > 0 }).toEqual({
        file,
        names: true,
      });
    }
  });

  test("the guard sees a host written in a string, a template and JSX text, and not in a comment", () => {
    expect(
      hostsInSource(
        "probe.tsx",
        [
          "// https://graph.microsoft.com/v1.0/teams in a comment",
          'const a: string = "https://login.microsoftonline.com/x";',
          "const b: string = `https://graph.microsoft.us/v1.0/${a}`;",
          "const c = <p>Open teams.microsoft.com</p>;",
          "/* smba.trafficmanager.net in a block comment */",
        ].join("\n"),
      ).map((found: HostInString): string => {
        return `${found.line} ${found.host}`;
      }),
    ).toEqual([
      "2 login.microsoftonline.",
      "3 graph.microsoft.",
      "4 teams.microsoft.com",
    ]);
  });
});

import {
  ChangeEventAttribute,
  ChangeEventSource,
  ChangeEventType,
} from "Common/Utils/Telemetry/ChangeEventFields";
import { describe, expect, it } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * Deploys and Changes, on what a connected cloud account adds to it, held
 * to the code that records it: the two sources a cloud account writes
 * (ChangeEventSource), the types its changes get (classifyCloudChange), the
 * attributes a change is kept under (CloudChangeRecorder), and that a chart
 * filtered to no resource leaves the activity log out but keeps the health
 * events (getChangeEventFetchQuery). The recorder reaches a database and the
 * markers live in a React hook, so both are read as text. Every translation
 * keeps the cloud lines where the English page has them, with their code.
 */

const CONTENT: string = path.resolve(
  __dirname,
  "../../../FeatureSet/Docs/Content",
);
const RECORDER: string = path.resolve(
  __dirname,
  "../../../../Common/Server/Utils/CloudConnection/CloudChangeRecorder.ts",
);
const MARKERS: string = path.resolve(
  __dirname,
  "../../../FeatureSet/Dashboard/src/Components/Metrics/Utils/UseEventTimeReferenceLines.ts",
);
const PAGE: string = "telemetry/change-events.md";

function readPage(language: string, page: string): string {
  return fs.readFileSync(
    path.join(CONTENT, language, ...page.split("/")),
    "utf8",
  );
}

function languages(): Array<string> {
  return fs
    .readdirSync(CONTENT, { withFileTypes: true })
    .filter((entry: fs.Dirent): boolean => {
      return (
        entry.isDirectory() &&
        fs.existsSync(path.join(CONTENT, entry.name, ...PAGE.split("/")))
      );
    })
    .map((entry: fs.Dirent): string => {
      return entry.name;
    })
    .sort();
}

const english: string = readPage("en", PAGE);
const englishLines: Array<string> = english.split("\n");
const recorder: string = fs.readFileSync(RECORDER, "utf8");
const markers: string = fs.readFileSync(MARKERS, "utf8");

// The lines of the English page that are about a cloud account.
function lineIndex(predicate: (line: string) => boolean): number {
  const index: number = englishLines.findIndex(predicate);
  expect(index).toBeGreaterThan(-1);
  return index;
}

// The table of what OneUptime records on its own, as row cells.
function ownChangesTable(markdown: string): Array<Array<string>> {
  const lines: Array<string> = markdown.split("\n");
  const start: number = lines.findIndex((line: string): boolean => {
    return line.startsWith("| Change | Recorded when | Source |");
  });
  const rows: Array<Array<string>> = [];

  for (let index: number = start + 2; index < lines.length; index++) {
    const line: string = lines[index] as string;

    if (!line.startsWith("|")) {
      break;
    }

    rows.push(
      line
        .slice(1, -1)
        .split(" | ")
        .map((cell: string): string => {
          return cell.trim();
        }),
    );
  }

  return rows;
}

// The attributes the recorder writes on a cloud change, by enum member.
function attributesWritten(): Array<string> {
  const written: Set<string> = new Set();

  for (const match of recorder.matchAll(
    /\[ChangeEventAttribute\.([A-Za-z]+)\]/g,
  )) {
    written.add(match[1] as string);
  }

  return Array.from(written).sort();
}

/*
 * Attributes the recorder writes that the page leaves out, with why: the
 * provider's event id only writes a change once, and the Cloud Resource a
 * change is tied to is what draws it on the resource's charts, which the
 * page says in words.
 */
const NOT_NAMED: Record<string, string> = {
  CloudEventId: "writes each change once",
  ResourceType: "ties the change to its Cloud Resource",
  ResourceId: "ties the change to its Cloud Resource",
};

describe("Deploys and Changes, on a connected cloud account", () => {
  it("lists the two sources a cloud account writes, with every source OneUptime records itself", () => {
    const rows: Array<Array<string>> = ownChangesTable(english);
    const sources: Array<string> = rows.map((row: Array<string>): string => {
      return row[2] as string;
    });

    expect(sources).toEqual(
      Object.values(ChangeEventSource)
        .filter((source: string): boolean => {
          return source !== ChangeEventSource.Api;
        })
        .map((source: string): string => {
          return `\`${source}\``;
        }),
    );
    expect(rows.slice(-2)).toEqual([
      [
        "A cloud change",
        "A connected cloud account's activity log records a change: AWS CloudTrail, the Azure Activity Log or Google Cloud's Admin Activity audit log",
        "`cloud`",
      ],
      [
        "A provider event",
        "The cloud provider publishes a health event about the account: AWS Health, Azure Service Health or Resource Health, or Google Cloud Service Health",
        "`cloud-health`",
      ],
    ]);

    // A health event is cloud-health, everything else the log recorded cloud.
    expect(recorder).toContain(
      'change.kind === "health"\n        ? ChangeEventSource.CloudHealth\n        : ChangeEventSource.Cloud,',
    );
  });

  it("gives the types a cloud change gets, as the recorder classifies them", () => {
    for (const type of [
      ChangeEventType.ProviderEvent,
      ChangeEventType.Rollback,
      ChangeEventType.Scaling,
      ChangeEventType.Deployment,
      ChangeEventType.ConfigChange,
    ]) {
      const member: string = Object.keys(ChangeEventType).find(
        (key: string): boolean => {
          return ChangeEventType[key as keyof typeof ChangeEventType] === type;
        },
      ) as string;

      expect(recorder).toContain(`return ChangeEventType.${member};`);
    }

    expect(english).toContain(
      `Its type comes from the operation: \`${ChangeEventType.Deployment}\`, \`${ChangeEventType.Scaling}\` or \`${ChangeEventType.Rollback}\` when the operation's name says so, \`${ChangeEventType.ConfigChange}\` otherwise, and \`${ChangeEventType.ProviderEvent}\` for a health event.`,
    );

    // A health event is the provider's, whatever its words say.
    expect(recorder).toContain(
      'if (change.kind === "health") {\n    return ChangeEventType.ProviderEvent;\n  }',
    );
  });

  it("names every attribute the recorder keeps a cloud change under", () => {
    const written: Array<string> = attributesWritten();

    expect(written).toEqual(
      expect.arrayContaining([
        "Source",
        "CloudProvider",
        "CloudAccountId",
        "CloudRegion",
        "CloudResourceId",
        "CloudOperation",
        "CloudActor",
        "Status",
        "CloudAccountRecordId",
      ]),
    );

    const unnamed: Array<string> = written.filter((member: string): boolean => {
      const key: string =
        ChangeEventAttribute[member as keyof typeof ChangeEventAttribute];
      return !NOT_NAMED[member] && !english.includes(`\`${key}\``);
    });

    expect(unnamed).toEqual([]);

    for (const member of Object.keys(NOT_NAMED)) {
      expect({ member: member, written: written.includes(member) }).toEqual({
        member: member,
        written: true,
      });
    }

    expect(english).toContain(
      "A change read from a cloud account names the account and the resource under OpenTelemetry's names, `cloud.provider`, `cloud.account.id`, `cloud.region` and `cloud.resource_id`,",
    );
  });

  it("says a chart filtered to no resource leaves the activity log out and keeps the health events", () => {
    expect(markers).toContain(
      "if (Object.keys(query).length > 0) {\n    return query;\n  }",
    );
    expect(markers).toContain(
      "[ChangeEventAttribute.Source]: new IncludesNone([\n        ChangeEventSource.Cloud,\n      ]),",
    );
    expect(english).toContain(
      "Charts filtered to no resource leave a cloud account's activity log out, so a busy account cannot crowd out your deploys; the provider's health events stay on them.",
    );
  });

  it("draws a cloud account into the diagram, and links Connect a Cloud Account twice", () => {
    expect(english).toContain(
      '    D["A cloud account\'s<br/>activity log"] --> E',
    );
    expect(english).toContain(
      "A cloud change or a provider event needs a [connected cloud account](/docs/telemetry/cloud-accounts).",
    );
    expect(english).toContain(
      "- [Connect a Cloud Account](/docs/telemetry/cloud-accounts): The changes and health events of your AWS, Azure and Google Cloud accounts.",
    );
    expect(readPage("en", "telemetry/cloud-accounts.md").split("\n")[0]).toBe(
      "# Connect a Cloud Account",
    );
    expect(english).toContain(
      "The changes on the services, clusters, hosts and cloud resources the incident is linked to come first.",
    );
  });

  it("keeps the cloud lines in every translation where the English page has them, with their code", () => {
    const cloudRow: number = lineIndex((line: string): boolean => {
      return line.endsWith("| `cloud` |");
    });
    const healthRow: number = lineIndex((line: string): boolean => {
      return line.endsWith("| `cloud-health` |");
    });
    const paragraph: number = lineIndex((line: string): boolean => {
      return line.includes(
        "[connected cloud account](/docs/telemetry/cloud-accounts)",
      );
    });
    const attributes: number = lineIndex((line: string): boolean => {
      return line.includes("`oneuptime.cloud.operation`");
    });
    const diagram: number = lineIndex((line: string): boolean => {
      return line.startsWith('    D["');
    });
    const card: number = lineIndex((line: string): boolean => {
      return line.startsWith("- [Connect a Cloud Account]");
    });

    const codeOf: (line: string) => Array<string> = (
      line: string,
    ): Array<string> => {
      return (line.match(/`[^`]+`/g) || []).sort();
    };

    const found: Array<string> = languages();

    expect(found.length).toBe(17);

    for (const language of found) {
      const lines: Array<string> = readPage(language, PAGE).split("\n");

      expect({ language: language, lines: lines.length }).toEqual({
        language: language,
        lines: englishLines.length,
      });

      for (const index of [cloudRow, healthRow, paragraph, attributes]) {
        expect({
          language: language,
          line: index + 1,
          code: codeOf(lines[index] as string),
        }).toEqual({
          language: language,
          line: index + 1,
          code: codeOf(englishLines[index] as string),
        });
      }

      expect(lines[diagram]).toMatch(/^ {4}D\[".+"\] --> E$/);
      expect(lines[card]).toMatch(
        /^- \[[^\]]+\]\(\/docs\/telemetry\/cloud-accounts\): /,
      );
      expect(lines[paragraph]).toContain("(/docs/telemetry/cloud-accounts)");

      if (language !== "en") {
        expect({ language: language, line: lines[paragraph] }).not.toEqual({
          language: language,
          line: englishLines[paragraph],
        });
      }
    }
  });
});

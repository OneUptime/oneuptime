import {
  AWS_SECURITY_HUB,
  CROWDSTRIKE,
  DEFENDER,
  ELASTIC,
  SPLUNK,
} from "./IntegrationsDocsPages";
import {
  codeIn,
  englishSection,
  tableWithHeader,
} from "./InventoryAndApiDocsSupport";
import { JSONObject } from "Common/Types/JSON";
import NormalizedSecurityEvent from "Common/Types/SecurityEvent/NormalizedSecurityEvent";
import AwsSecurityHubNormalizer from "Common/Utils/SecurityEvent/Connectors/AwsSecurityHubNormalizer";
import CrowdStrikeFalconNormalizer from "Common/Utils/SecurityEvent/Connectors/CrowdStrikeFalconNormalizer";
import ElasticSecurityNormalizer from "Common/Utils/SecurityEvent/Connectors/ElasticSecurityNormalizer";
import MicrosoftDefenderXdrNormalizer from "Common/Utils/SecurityEvent/Connectors/MicrosoftDefenderXdrNormalizer";
import SplunkNormalizer from "Common/Utils/SecurityEvent/Connectors/SplunkNormalizer";
import { describe, expect, it } from "@jest/globals";

/*
 * Every security connection page's "What is imported" table has a row for
 * the process an event is about: which of the source's own fields fill the
 * process's name, path and command line, and its parent's (the columns
 * #5148 added). This suite holds each row to the connection's normalizer:
 * every field the row names fills the column the row names it for, fields
 * that stand in for one another are read in the order the row writes them,
 * and a column the row says the source does not give stays empty.
 *
 * SplunkElasticAwsOktaDocsFacts and SecurityConnectionsDocsFacts hold the
 * rest of each table, and IntegrationsDocsTranslations the 16 translations
 * of every page, line for line.
 */

type ProcessColumn =
  | "processName"
  | "processPath"
  | "processCommandLine"
  | "parentProcessName"
  | "parentProcessPath"
  | "parentProcessCommandLine";

// The columns, in the order a process row names them: the process's, then its parent's.
const PROCESS_COLUMNS: ReadonlyArray<ProcessColumn> = [
  "processName",
  "processPath",
  "processCommandLine",
  "parentProcessName",
  "parentProcessPath",
  "parentProcessCommandLine",
];

// A Word macro that started PowerShell, as an endpoint reports it.
const VALUES: Readonly<Record<ProcessColumn, string>> = {
  processName: "powershell.exe",
  processPath: "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe",
  processCommandLine: "powershell.exe -NoProfile -EncodedCommand SQBFAFgA",
  parentProcessName: "WINWORD.EXE",
  parentProcessPath:
    "C:\\Program Files\\Microsoft Office\\root\\Office16\\WINWORD.EXE",
  parentProcessCommandLine: '"WINWORD.EXE" /n C:\\Users\\alice\\invoice.docm',
};

// What a value stands in for when another field is read first.
const ANOTHER_VALUE: string = "another.exe";

const WHOLE_ROW: string =
  "Process name, path and command line; parent process name, path and command line";

function processColumnsOf(
  event: NormalizedSecurityEvent,
): Record<ProcessColumn, string> {
  return {
    processName: event.processName,
    processPath: event.processPath,
    processCommandLine: event.processCommandLine,
    parentProcessName: event.parentProcessName,
    parentProcessPath: event.parentProcessPath,
    parentProcessCommandLine: event.parentProcessCommandLine,
  };
}

// Fields written as dotted paths, as the nested objects a source sends them in.
function nested(fields: Readonly<Record<string, string>>): JSONObject {
  const payload: JSONObject = {};

  for (const [path, value] of Object.entries(fields)) {
    const keys: Array<string> = path.split(".");
    let at: JSONObject = payload;

    for (const key of keys.slice(0, -1)) {
      const next: unknown = at[key];

      if (!next || typeof next !== "object" || Array.isArray(next)) {
        at[key] = {};
      }

      at = at[key] as JSONObject;
    }

    at[keys[keys.length - 1] as string] = value;
  }

  return payload;
}

/*
 * The source fields a process row names for each column, in the row's
 * order: "`a` or `b`, `c` and `d`; `e`, `f` and `g`" is the process's name,
 * path and command line, then, after the semicolon, its parent's; fields
 * joined by "or" stand in for one another, the first read first.
 */
function fieldsByColumn(cell: string): Array<Array<string>> {
  return cell
    .split(";")
    .flatMap((half: string): Array<string> => {
      return half.split(",");
    })
    .flatMap((part: string): Array<string> => {
      return part.split(" and ");
    })
    .map((group: string): Array<string> => {
      return codeIn(group);
    });
}

// The row of a page's What is imported table whose second cell is `says`.
function importRow(page: string, header: string, says: string): Array<string> {
  const row: Array<string> | undefined = tableWithHeader(
    englishSection(page, "## What is imported"),
    header,
  ).find((candidate: Array<string>): boolean => {
    return candidate[1] === says;
  });

  if (!row) {
    throw new Error(`${page} has no What is imported row for "${says}"`);
  }

  return row;
}

interface ProcessRowCase {
  connection: string;
  page: string;
  // The first cell of the table's header.
  header: string;
  // What the row's second cell says.
  says: string;
  // The fields the row names for each column, in PROCESS_COLUMNS' order.
  fields: Array<Array<string>>;
  // The connection's normalizer, given a payload that carries `fields`.
  normalize: (
    fields: Readonly<Record<string, string>>,
  ) => NormalizedSecurityEvent;
}

const ROWS: Array<ProcessRowCase> = [
  {
    connection: "Splunk Enterprise Security",
    page: SPLUNK,
    header: "Splunk field",
    says: WHOLE_ROW,
    fields: [
      ["process_name", "process_exec"],
      ["process_path"],
      ["process"],
      ["parent_process_name", "parent_process_exec"],
      ["parent_process_path"],
      ["parent_process"],
    ],
    normalize: (
      fields: Readonly<Record<string, string>>,
    ): NormalizedSecurityEvent => {
      // A notable event: its fields are the row's own, flat.
      return SplunkNormalizer.normalize({
        _time: "2026-09-14T08:12:44.000+00:00",
        event_id: "B3C1B5FC@@notable@@0123abcd",
        rule_name: "Endpoint - Office Spawning PowerShell - Rule",
        ...fields,
      });
    },
  },
  {
    connection: "Elastic Security",
    page: ELASTIC,
    header: "Alert field",
    says: WHOLE_ROW,
    fields: [
      ["process.name"],
      ["process.executable"],
      ["process.command_line"],
      ["process.parent.name"],
      ["process.parent.executable"],
      ["process.parent.command_line"],
    ],
    normalize: (
      fields: Readonly<Record<string, string>>,
    ): NormalizedSecurityEvent => {
      return ElasticSecurityNormalizer.normalize({
        _id: "7f1c0b0e2d1a4f6c9b3e5d7a1c2b4e6f",
        _source: {
          "@timestamp": "2026-09-14T08:12:44.000Z",
          "kibana.alert.rule.name": "Suspicious PowerShell",
          ...nested(fields),
        },
      });
    },
  },
  {
    connection: "CrowdStrike Falcon",
    page: CROWDSTRIKE,
    header: "Falcon field",
    says: WHOLE_ROW,
    fields: [
      ["filename"],
      ["filepath"],
      ["cmdline"],
      ["parent_details.filename"],
      ["parent_details.filepath"],
      ["parent_details.cmdline"],
    ],
    normalize: (
      fields: Readonly<Record<string, string>>,
    ): NormalizedSecurityEvent => {
      return CrowdStrikeFalconNormalizer.normalize({
        composite_id: "cid:ind:abc",
        created_timestamp: "2026-09-14T08:12:44.995Z",
        name: "SuspiciousPowerShell",
        severity: 70,
        ...nested(fields),
      });
    },
  },
  {
    connection: "AWS Security Hub",
    page: AWS_SECURITY_HUB,
    header: "Finding field",
    says: "Process name and path. A finding names neither a command line nor a parent.",
    fields: [["Process.Name"], ["Process.Path"]],
    normalize: (
      fields: Readonly<Record<string, string>>,
    ): NormalizedSecurityEvent => {
      return AwsSecurityHubNormalizer.normalize({
        Id: "arn:aws:guardduty:us-east-1:123456789012:detector/d1/finding/f1",
        ProductArn: "arn:aws:securityhub:us-east-1::product/aws/guardduty",
        AwsAccountId: "123456789012",
        CreatedAt: "2026-09-14T08:12:44.000Z",
        Title: "Execution:Runtime/SuspiciousCommand",
        Severity: { Label: "HIGH" },
        ...nested(fields),
      });
    },
  },
];

describe.each(ROWS)(
  "$connection's process row",
  (row: ProcessRowCase): void => {
    it("names the source's fields for each column, as the page's table lists them", () => {
      const cells: Array<string> = importRow(row.page, row.header, row.says);

      expect(fieldsByColumn(cells[0] as string)).toEqual(row.fields);
    });

    it("fills each column from every field the row names for it", () => {
      row.fields.forEach((fields: Array<string>, index: number): void => {
        const column: ProcessColumn = PROCESS_COLUMNS[index]!;

        for (const field of fields) {
          expect({
            field,
            [column]: processColumnsOf(
              row.normalize({ [field]: VALUES[column] }),
            )[column],
          }).toEqual({ field, [column]: VALUES[column] });
        }
      });
    });

    it("reads the fields that stand in for one another in the order the row writes them", () => {
      row.fields.forEach((fields: Array<string>, index: number): void => {
        const column: ProcessColumn = PROCESS_COLUMNS[index]!;

        fields.forEach((field: string, position: number): void => {
          const payload: Record<string, string> = {};

          // Every field the row reads before this one is absent; every one after it says something else.
          for (const later of fields.slice(position + 1)) {
            payload[later] = ANOTHER_VALUE;
          }

          payload[field] = VALUES[column];

          expect({
            field,
            [column]: processColumnsOf(row.normalize(payload))[column],
          }).toEqual({ field, [column]: VALUES[column] });
        });
      });
    });

    it("fills exactly the columns the row names, and leaves the others empty", () => {
      const payload: Record<string, string> = {};

      row.fields.forEach((fields: Array<string>, index: number): void => {
        payload[fields[0]!] = VALUES[PROCESS_COLUMNS[index]!];
      });

      const expected: Record<ProcessColumn, string> = {
        processName: "",
        processPath: "",
        processCommandLine: "",
        parentProcessName: "",
        parentProcessPath: "",
        parentProcessCommandLine: "",
      };

      row.fields.forEach((_fields: Array<string>, index: number): void => {
        const column: ProcessColumn = PROCESS_COLUMNS[index]!;
        expected[column] = VALUES[column];
      });

      expect(processColumnsOf(row.normalize(payload))).toEqual(expected);
    });
  },
);

describe("Microsoft Defender XDR's process row", () => {
  const says: string =
    "The process evidence `principalProcess` comes from: its `imageFile`, `processCommandLine` and `parentProcessImageFile`. Graph gives no parent command line.";

  // A process evidence item of an alert, as Graph's alerts_v2 returns it.
  function processEvidence(data: {
    roles: Array<string>;
    folder: string;
    name: string;
    commandLine?: string;
    parentFolder?: string;
    parentName?: string;
  }): JSONObject {
    const evidence: JSONObject = {
      "@odata.type": "#microsoft.graph.security.processEvidence",
      roles: data.roles,
      imageFile: { fileName: data.name, filePath: data.folder },
    };

    if (data.commandLine) {
      evidence["processCommandLine"] = data.commandLine;
    }

    if (data.parentName) {
      evidence["parentProcessImageFile"] = {
        fileName: data.parentName,
        filePath: data.parentFolder || "",
      };
    }

    return evidence;
  }

  function alertWith(evidence: Array<JSONObject>): NormalizedSecurityEvent {
    return MicrosoftDefenderXdrNormalizer.normalize({
      "@odata.type": "#microsoft.graph.security.alert",
      id: "da637551227677560813_-961444813",
      title: "Suspicious PowerShell command line",
      severity: "high",
      status: "new",
      createdDateTime: "2026-09-14T08:12:44Z",
      evidence,
    });
  }

  const explorer: JSONObject = processEvidence({
    roles: [],
    folder: "C:\\Windows",
    name: "explorer.exe",
    commandLine: "C:\\Windows\\explorer.exe",
  });
  const powershell: JSONObject = processEvidence({
    roles: ["attacker"],
    folder: "C:\\Windows\\System32\\WindowsPowerShell\\v1.0",
    name: VALUES.processName,
    commandLine: VALUES.processCommandLine,
    parentFolder: "C:\\Program Files\\Microsoft Office\\root\\Office16",
    parentName: VALUES.parentProcessName,
  });

  it("names the columns the evidence fills, and where each comes from", () => {
    const row: Array<string> = importRow(DEFENDER, "OCSF column", says);

    expect(codeIn(row[0] as string)).toEqual([
      "processName",
      "processPath",
      "processCommandLine",
      "parentProcessName",
      "parentProcessPath",
    ]);
  });

  it("fills them from the process evidence principalProcess comes from: the one with the attacker's role", () => {
    const event: NormalizedSecurityEvent = alertWith([explorer, powershell]);

    expect(event.principalProcess).toBe(VALUES.processCommandLine);
    expect(processColumnsOf(event)).toEqual({
      ...VALUES,
      // Graph gives no parent command line.
      parentProcessCommandLine: "",
    });
  });

  it("fills exactly the columns the row names: never a parent command line", () => {
    const columns: Record<ProcessColumn, string> = processColumnsOf(
      alertWith([powershell]),
    );

    expect(
      PROCESS_COLUMNS.filter((column: ProcessColumn): boolean => {
        return columns[column] !== "";
      }),
    ).toEqual([
      "processName",
      "processPath",
      "processCommandLine",
      "parentProcessName",
      "parentProcessPath",
    ]);
  });

  it("takes the first process evidence when none has a principal's role, as principalProcess does", () => {
    const event: NormalizedSecurityEvent = alertWith([
      explorer,
      processEvidence({
        roles: [],
        folder: "C:\\Windows\\System32",
        name: "cmd.exe",
        commandLine: "cmd.exe /c whoami",
      }),
    ]);

    expect(event.principalProcess).toBe("C:\\Windows\\explorer.exe");
    expect(processColumnsOf(event)).toEqual({
      processName: "explorer.exe",
      processPath: "C:\\Windows\\explorer.exe",
      processCommandLine: "C:\\Windows\\explorer.exe",
      parentProcessName: "",
      parentProcessPath: "",
      parentProcessCommandLine: "",
    });
  });
});

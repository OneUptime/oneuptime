import fs from "fs";
import path from "path";
import {
  OpenStackLogStamp,
  stampOpenStackLogRecord,
} from "../../Utils/OpenStack/OpenStackLogs";
import { RecordedJournalEntry } from "./OpenStackJournalEntry";

export * from "./OpenStackJournalEntry";

/*
 * What real DevStacks' services wrote, as the rig recorded it and import-log-recording.py kept it:
 * packages/Common/Tests/Fixtures/OpenStack/service-logs/<release>/. These read it, and hand each
 * record to the ingest's own stamp as the agent's collector would have.
 */

const ROOT: string = path.resolve(
  __dirname,
  "..",
  "Fixtures",
  "OpenStack",
  "service-logs",
);

export const OPENSTACK_LOG_RELEASES: Array<string> = fs.existsSync(ROOT)
  ? fs.readdirSync(ROOT).filter((name: string): boolean => {
      return fs.statSync(path.join(ROOT, name)).isDirectory();
    })
  : [];

export type OpenStackLogPhase =
  | "devstack"
  | "oslo-default"
  | "json"
  | "journal-native"
  | "keystone-defaults";

// A line of a service's log file.
export interface RecordedFileLine {
  file: string;
  line: string;
}

// A record a real collector sent, one to a line, with the resource it came under.
export interface RecordedOtlpRecord {
  resource: {
    attributes: Array<{ key: string; value: { stringValue?: string } }>;
  };
  record: {
    timeUnixNano?: string;
    severityNumber?: number;
    attributes?: Array<{
      key: string;
      value: { stringValue?: string; intValue?: string };
    }>;
    body?: { stringValue?: string };
  };
}

// A failure a real collector sent, its body cut to what says what it is.
export interface RecordedFailure {
  time: string;
  attributes: Record<string, string>;
  body: string;
}

export interface RecordedScene {
  scene: string;
  startedAt: string;
  endedAt: string;
  exitCode: number;
}

export interface RecordedIds {
  ids: Record<string, Record<string, string>>;
  scenes: Record<string, Array<RecordedScene>>;
}

function fileOf(release: string, ...parts: Array<string>): string {
  return path.join(ROOT, release, ...parts);
}

function readJsonLines<T>(file: string): Array<T> {
  if (!fs.existsSync(file)) {
    return [];
  }

  return fs
    .readFileSync(file, "utf8")
    .split("\n")
    .filter((line: string): boolean => {
      return line.trim() !== "";
    })
    .map((line: string): T => {
      return JSON.parse(line) as T;
    });
}

export function readRecordedIds(release: string): RecordedIds {
  return JSON.parse(
    fs.readFileSync(fileOf(release, "ids.json"), "utf8"),
  ) as RecordedIds;
}

export function readRecordedJournal(
  release: string,
  phase: OpenStackLogPhase,
): Array<RecordedJournalEntry> {
  return readJsonLines<RecordedJournalEntry>(
    fileOf(release, "journal", `${phase}.jsonl`),
  );
}

export function readRecordedNotifications(
  release: string,
  phase: OpenStackLogPhase,
): Array<RecordedJournalEntry> {
  return readJsonLines<RecordedJournalEntry>(
    fileOf(release, "notifications", `${phase}.jsonl`),
  );
}

export function readRecordedFiles(
  release: string,
  phase: OpenStackLogPhase = "oslo-default",
): Array<RecordedFileLine> {
  return readJsonLines<RecordedFileLine>(
    fileOf(release, "files", `${phase}.jsonl`),
  );
}

export function readRecordedFileNotifications(
  release: string,
  phase: OpenStackLogPhase = "oslo-default",
): Array<RecordedFileLine> {
  return readJsonLines<RecordedFileLine>(
    fileOf(release, "notifications", `${phase}-files.jsonl`),
  );
}

export function readRecordedOtlp(
  release: string,
  phase: OpenStackLogPhase,
): Array<RecordedOtlpRecord> {
  return readJsonLines<RecordedOtlpRecord>(
    fileOf(release, "otlp", `${phase}.jsonl`),
  );
}

export function readRecordedFailures(
  release: string,
  phase: OpenStackLogPhase = "devstack",
): Array<RecordedFailure> {
  return readJsonLines<RecordedFailure>(
    fileOf(release, "failures", `${phase}.jsonl`),
  );
}

export function readRecordedApi(
  release: string,
  phase: OpenStackLogPhase,
  name: string,
): unknown {
  const file: string = fileOf(release, "api", phase, `${name}.json`);

  return fs.existsSync(file)
    ? JSON.parse(fs.readFileSync(file, "utf8"))
    : undefined;
}

// As the agent's files profile hands over a line, from Kolla-Ansible's folder.
export function stampFileLine(line: RecordedFileLine): OpenStackLogStamp {
  return stampOpenStackLogRecord({
    attributes: {
      "resource.openstack.cloud.name": "devstack",
      "resource.openstack.node.name": "devstack-host",
      /*
       * The name a real one has: oslo.log calls a file after its program, and a recording's
       * artifact cannot hold < and > in a file's name.
       */
      "log.file.path": `/var/log/kolla/${line.file.replace(/\.gz$/, "").replace("_frozen importlib._bootstrap_", "<frozen importlib._bootstrap>")}`,
    },
    body: line.line,
    severityNumber: 0,
  });
}

export function stampOtlpRecord(
  recorded: RecordedOtlpRecord,
): OpenStackLogStamp {
  const attributes: Record<string, unknown> = {};

  for (const item of recorded.resource.attributes) {
    attributes[`resource.${item.key}`] = item.value.stringValue;
  }

  for (const item of recorded.record.attributes || []) {
    attributes[item.key] = item.value.stringValue ?? item.value.intValue;
  }

  return stampOpenStackLogRecord({
    attributes,
    body: recorded.record.body?.stringValue || "",
    severityNumber: recorded.record.severityNumber || 0,
  });
}

export function stampFailure(failure: RecordedFailure): OpenStackLogStamp {
  return stampOpenStackLogRecord({
    attributes: {
      "resource.openstack.cloud.name": "devstack",
      ...failure.attributes,
    },
    body: failure.body,
    severityNumber: 0,
  });
}

// When a failure's collector says it was written, in milliseconds.
export function failureTime(failure: RecordedFailure): number {
  return Number(failure.time.slice(0, -6));
}

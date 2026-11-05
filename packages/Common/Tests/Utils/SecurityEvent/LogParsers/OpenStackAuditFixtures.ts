import fs from "fs";
import path from "path";
import { JSONObject } from "../../../../Types/JSON";
import NormalizedSecurityEvent from "../../../../Types/SecurityEvent/NormalizedSecurityEvent";
import {
  OpenStackLogStamp,
  stampOpenStackLogRecord,
} from "../../../../Utils/OpenStack/OpenStackLogs";
import { OpenStackAuditAttribute } from "../../../../Utils/SecurityEvent/LogParsers/OpenStackAuditLogParser";
import SecurityLogParser from "../../../../Utils/SecurityEvent/LogParsers/SecurityLogParser";

/*
 * WHAT REAL CLOUDS WROTE, AS OneUptime STORES IT. Tests/Ops/openstack-e2e/logs-record.sh makes
 * each thing happen on a real DevStack, and import-log-recording.py keeps the lines an audit
 * trail is read from. These read them back the way ingest does: what the agent's profile sends
 * beside a line, then the stamp every line of a cloud goes through. Not a test file itself.
 */

const ROOT: string = path.resolve(
  __dirname,
  "../../../Fixtures/OpenStack/service-logs",
);

export const OPENSTACK_AUDIT_RECORDED_RELEASES: Array<string> = fs
  .readdirSync(ROOT)
  .filter((release: string): boolean => {
    return fs.existsSync(path.join(ROOT, release, "audit", "ids.json"));
  })
  .sort();

export const OPENSTACK_AUDIT_RECORDED_CLOUD: string = "devstack";

export interface RecordedLine {
  raw: string;
  body: string;
  attributes: JSONObject;
  stamp: OpenStackLogStamp;
  events: Array<NormalizedSecurityEvent>;
}

export interface RecordedScene {
  scene: string;
  exitCode: number;
}

export interface PhaseFacts {
  ids: Record<string, string>;
  scenes: Array<RecordedScene>;
}

export function readRecordedFacts(release: string): Record<string, PhaseFacts> {
  const facts: {
    ids: Record<string, Record<string, string>>;
    scenes: Record<string, Array<RecordedScene>>;
  } = JSON.parse(
    fs.readFileSync(path.join(ROOT, release, "audit", "ids.json"), "utf8"),
  );
  const phases: Record<string, PhaseFacts> = {};

  for (const phase of Object.keys(facts.ids)) {
    phases[phase] = {
      ids: facts.ids[phase] || {},
      scenes: facts.scenes[phase] || [],
    };
  }

  return phases;
}

function collectorAttributes(record: JSONObject): JSONObject {
  const attributes: JSONObject = {
    "resource.openstack.cloud.name": OPENSTACK_AUDIT_RECORDED_CLOUD,
  };

  // What the agent's two logs profiles write beside each line, as they write it.
  if (typeof record["file"] === "string") {
    attributes["log.file.path"] = `/var/log/kolla/${record["file"]}`;
    return attributes;
  }

  const moved: ReadonlyArray<[string, string]> = [
    ["_SYSTEMD_UNIT", "journald.unit"],
    ["_HOSTNAME", "journald.hostname"],
    ["SYSLOG_IDENTIFIER", "journald.identifier"],
    ["PRIORITY", "journald.priority"],
    ["LOGGER_NAME", "journald.logger_name"],
    ["LOGGER_LEVEL", "journald.logger_level"],
    ["REQUEST_ID", "journald.request_id"],
    ["GLOBAL_REQUEST_ID", "journald.global_request_id"],
    ["PROJECT_ID", "journald.project_id"],
    ["PROJECT_NAME", "journald.project_name"],
    ["USER_ID", "journald.user_id"],
    ["USER_NAME", "journald.user_name"],
  ];

  for (const [from, to] of moved) {
    if (record[from] !== undefined) {
      attributes[to] = record[from] as string;
    }
  }

  return attributes;
}

export function readRecordedPhase(
  release: string,
  phase: string,
): Array<RecordedLine> {
  const file: string = path.join(ROOT, release, "audit", `${phase}.jsonl`);

  if (!fs.existsSync(file)) {
    return [];
  }

  return fs
    .readFileSync(file, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((text: string, index: number): RecordedLine => {
      const record: JSONObject = JSON.parse(text);
      const raw: string = record["MESSAGE"] as string;
      const attributes: JSONObject = collectorAttributes(record);
      const stamp: OpenStackLogStamp = stampOpenStackLogRecord({
        attributes,
        body: raw,
        severityNumber: 0,
      });
      const stored: JSONObject = { ...attributes, ...stamp.attributes };

      return {
        raw,
        body: stamp.body,
        attributes: stored,
        stamp,
        events: SecurityLogParser.parse({
          body: stamp.body,
          attributes: stored,
          time: new Date("2026-11-04T00:00:00.000Z"),
          logId: `${phase}-${index}`,
        }).filter((event: NormalizedSecurityEvent): boolean => {
          return (
            typeof event.attributes[OpenStackAuditAttribute.Cloud] === "string"
          );
        }),
      };
    });
}

/*
 * What a real collector sent, attributes and all, read the way ingest reads it. Not always what
 * the service wrote: the agent's journal profile joins lines.
 */
export function readRecordedCollector(
  release: string,
  phase: string,
): Array<RecordedLine> {
  const file: string = path.join(
    ROOT,
    release,
    "audit",
    `collector-${phase}.jsonl`,
  );

  if (!fs.existsSync(file)) {
    return [];
  }

  return fs
    .readFileSync(file, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((text: string, index: number): RecordedLine => {
      const record: JSONObject = JSON.parse(text);
      const raw: string = record["body"] as string;
      const attributes: JSONObject = record["attributes"] as JSONObject;
      const stamp: OpenStackLogStamp = stampOpenStackLogRecord({
        attributes,
        body: raw,
        severityNumber: 0,
      });
      const stored: JSONObject = { ...attributes, ...stamp.attributes };

      return {
        raw,
        body: stamp.body,
        attributes: stored,
        stamp,
        events: SecurityLogParser.parse({
          body: stamp.body,
          attributes: stored,
          time: new Date("2026-11-04T00:00:00.000Z"),
          logId: `collector-${phase}-${index}`,
        }).filter((event: NormalizedSecurityEvent): boolean => {
          return (
            typeof event.attributes[OpenStackAuditAttribute.Cloud] === "string"
          );
        }),
      };
    });
}

export function eventsOf(
  lines: Array<RecordedLine>,
): Array<NormalizedSecurityEvent> {
  return lines.flatMap((line: RecordedLine): Array<NormalizedSecurityEvent> => {
    return line.events;
  });
}

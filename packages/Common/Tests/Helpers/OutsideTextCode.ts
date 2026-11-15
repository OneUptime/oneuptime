import fs from "fs";
import path from "path";
import { listSourceFiles } from "../ForeignHiddenRuleGuard";

/*
 * THE CODE THAT READS TEXT FROM OUTSIDE ONEUPTIME, by directory or file
 * (packages-relative, with "/").
 *
 * What other products write - a severity, a tactic's name, a log line's
 * fields, an exporter's labels - and what somebody types into a search box,
 * a PromQL query or a grok pattern reaches these as keys and words.
 * TextLookupTablesGuard keeps tables read by such text answering only for
 * their own keys; CopiedKeysWrittenAsOwnGuard keeps a source's keys, copied
 * onto another object, written as that object's own.
 */
export const OUTSIDE_TEXT_CODE: ReadonlyArray<string> = [
  "Common/Utils/SecurityEvent",
  "Common/Server/Utils/SecurityEvent",
  "Common/Types/SecurityEvent",
  "Common/Types/Telemetry/TelemetrySearchQuery.ts",
  "Common/UI/Components/LogsViewer/components/LogSearchBar.tsx",
  "Common/UI/Components/TelemetryViewer/components/TelemetrySearchBar.tsx",
  "App/FeatureSet/Dashboard/src/Utils/ExceptionsSearchQuery.ts",
  // A PromQL query, as the dashboards, Grafana and the metric monitors write it.
  "Common/Utils/PromQL",
  "Common/Server/Utils/PromQL",
  // A grok pattern a project's people write, and the log lines it parses.
  "Common/Utils/Grok",
  // The keys a log line's key=value pairs name.
  "Common/Utils/Log",
  /*
   * Telemetry ingest (issue #8221): a level, a severity, a trap's OID, a
   * resource type, a service name and a libvirt domain, as a sender wrote
   * them. Fluent's severity table, Vercel's levels, the SNMP trap names,
   * the syslog service cache, GCP's resource types and the OpenStack
   * domains were read plainly here.
   */
  "App/FeatureSet/Telemetry/Services",
  "App/FeatureSet/Telemetry/Utils",
  "Common/Server/Utils/Telemetry",
];

// The source files of OUTSIDE_TEXT_CODE, under the packages directory.
export function listOutsideTextFiles(packagesRoot: string): Array<string> {
  const files: Array<string> = [];

  for (const entry of OUTSIDE_TEXT_CODE) {
    const full: string = path.join(packagesRoot, entry);

    if (fs.existsSync(full) && fs.statSync(full).isFile()) {
      files.push(full);
      continue;
    }

    files.push(...listSourceFiles(full));
  }

  return files;
}

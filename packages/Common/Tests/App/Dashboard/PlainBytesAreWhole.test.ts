import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import { formatBytes as formatTelemetryBytes } from "../../../../App/FeatureSet/Dashboard/src/Components/TelemetryResource/telemetryFormat";
import { formatOpenStackBytes } from "../../../../App/FeatureSet/Dashboard/src/Pages/OpenStack/Utils/OpenStackFigures";
import { formatHostBytes } from "../../../../App/FeatureSet/Dashboard/src/Pages/Host/Utils/HostFacts";
import { formatDatabaseBytes } from "../../../../App/FeatureSet/Dashboard/src/Pages/Database/Utils/DatabaseServerPresentation";
import { formatStorageBytes } from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Components/StorageArrayWidgetData";
import { formatTrafficBytes } from "../../../../App/FeatureSet/Dashboard/src/Components/NetworkTraffic/NetworkTrafficFormat";
import { formatSize as formatDataObservabilitySize } from "../../../../App/FeatureSet/Dashboard/src/Components/DataObservability/DataObservabilityFormat";
import { formatCloudBytes } from "../../../../App/FeatureSet/Dashboard/src/Components/Cloud/CloudHeadlineTiles";
import { formatTopologyBytes } from "../../../../App/FeatureSet/Dashboard/src/Components/ResourceTopology/ResourceTopologyFormat";
import { formatMemoryValue } from "../../../../App/FeatureSet/Dashboard/src/Components/Infrastructure/ResourceTable";
import { formatBytes as formatDockerWidgetBytes } from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Components/DashboardDockerContainerListComponent";
import { formatBytes as formatPodmanWidgetBytes } from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Components/DashboardPodmanContainerListComponent";
import { formatBytes as formatDockerSwarmBytes } from "../../../../App/FeatureSet/Dashboard/src/Pages/DockerSwarm/Utils/DockerSwarmResourceUtils";
import { formatBytes as formatProxmoxBytes } from "../../../../App/FeatureSet/Dashboard/src/Pages/Proxmox/Utils/ProxmoxResourceUtils";
import { formatBytes as formatVMwareBytes } from "../../../../App/FeatureSet/Dashboard/src/Pages/VMware/Utils/VMwareResourceUtils";
import { formatVMwareReasonBytes } from "../../../../App/FeatureSet/Dashboard/src/Pages/VMware/Utils/VMwareHealth";
import { formatBytes as formatStorageArrayBytes } from "../../../../App/FeatureSet/Dashboard/src/Pages/StorageArray/Utils/StorageArrayResourceUtils";
import { formatBytes as formatCephBytes } from "../../../../App/FeatureSet/Dashboard/src/Pages/Ceph/Utils/CephResourceUtils";
import { formatBytes as formatIoTBytes } from "../../../../App/FeatureSet/Dashboard/src/Pages/IoT/Utils/IoTDeviceUtils";
import { formatBytes as formatFlowBytes } from "../../../Utils/SecurityEvent/TelemetryScan/FlowSignals";
import MonitorCriteriaMessageFormatter from "../../../Server/Utils/Monitor/MonitorCriteriaMessageFormatter";
import { formatFileSize } from "../../../Types/File/FileSize";
import { Translator } from "../../../Types/Translator";
import { dashboardTranslator } from "../../Helpers/DashboardLocales";

/*
 * A COUNT OF BYTES IS WHOLE (issue #7417).
 *
 * A size in plain bytes is a whole number, yet the telemetry pages wrote
 * one decimal under ten whatever the unit: an empty volume read "0.0 B",
 * a 5-byte object "5.0 B" - "۰٫۰ B" on a Persian OpenStack page. The host
 * pages, the Kubernetes overview, the process list ("512.0 B"), database
 * servers, the Docker and Podman container widgets ("0.00 B"), a session
 * recording's payload and the server's monitor messages ("0.00 B") each
 * did the same in a formatter of their own.
 *
 * Every formatter below now writes plain bytes whole - "0 B", "5 B",
 * "999 B" - and keeps its own rounding from KiB (or KB) up. The second
 * half of the suite finds every byte formatter of the frontends and of
 * Common - a list of units that starts at "B" - and holds each to this
 * suite: called here, or, for one inside a page that a test cannot load
 * alone, its whole-byte rule pinned as it is written, so a change to it
 * comes back here to be checked.
 */

// What a formatter is handed: zero, a few bytes and the most under a kilobyte.
const PLAIN_BYTES: ReadonlyArray<number> = [0, 1, 5, 9, 42, 512, 999];

const ENGLISH: Translator = dashboardTranslator("en");

type ByteFormatter = (bytes: number) => string | null;

interface NamedFormatter {
  name: string;
  format: ByteFormatter;
}

// Each formatter by name, as its pages call it.
const FORMATTERS: ReadonlyArray<NamedFormatter> = [
  {
    name: "telemetryFormat formatBytes (telemetry and App Platforms)",
    format: formatTelemetryBytes,
  },
  {
    name: "formatOpenStackBytes",
    format: (bytes: number): string => {
      return formatOpenStackBytes(bytes, { language: "en" });
    },
  },
  {
    name: "formatHostBytes (host pages and the process list)",
    format: formatHostBytes,
  },
  { name: "formatDatabaseBytes", format: formatDatabaseBytes },
  {
    name: "formatStorageBytes (storage array widgets)",
    format: (bytes: number): string => {
      return formatStorageBytes(bytes);
    },
  },
  { name: "formatTrafficBytes (network traffic)", format: formatTrafficBytes },
  {
    name: "Data Observability formatSize",
    format: formatDataObservabilitySize,
  },
  {
    name: "formatCloudBytes",
    format: (bytes: number): string => {
      return formatCloudBytes(bytes, ENGLISH);
    },
  },
  { name: "formatTopologyBytes", format: formatTopologyBytes },
  { name: "formatMemoryValue (resource tables)", format: formatMemoryValue },
  { name: "the Docker container list widget", format: formatDockerWidgetBytes },
  { name: "the Podman container list widget", format: formatPodmanWidgetBytes },
  { name: "Docker Swarm formatBytes", format: formatDockerSwarmBytes },
  { name: "Proxmox formatBytes", format: formatProxmoxBytes },
  { name: "VMware formatBytes", format: formatVMwareBytes },
  { name: "formatVMwareReasonBytes", format: formatVMwareReasonBytes },
  { name: "storage array formatBytes", format: formatStorageArrayBytes },
  { name: "Ceph formatBytes", format: formatCephBytes },
  { name: "IoT formatBytes", format: formatIoTBytes },
  {
    name: "flow signals formatBytes (security events)",
    format: formatFlowBytes,
  },
  {
    name: "monitor criteria messages",
    format: (bytes: number): string | null => {
      return MonitorCriteriaMessageFormatter.formatBytes(bytes);
    },
  },
  {
    name: "formatFileSize (files)",
    format: (bytes: number): string => {
      return formatFileSize(bytes, { language: "en" });
    },
  },
];

describe("every byte formatter writes plain bytes whole", () => {
  test.each(
    FORMATTERS.map((formatter: NamedFormatter): [string, ByteFormatter] => {
      return [formatter.name, formatter.format];
    }),
  )("%s", (_name: string, format: ByteFormatter) => {
    for (const bytes of PLAIN_BYTES) {
      expect([bytes, format(bytes)]).toEqual([bytes, `${bytes} B`]);
    }
  });

  test("a size from a kilobyte up keeps its decimal where it had one", () => {
    expect(formatTelemetryBytes(1536)).toBe("1.5 KiB");
    expect(formatOpenStackBytes(1536, { language: "en" })).toBe("1.5 KiB");
    expect(formatHostBytes(8 * 1024 ** 3)).toBe("8.0 GiB");
    expect(formatDatabaseBytes(1536)).toBe("1.5 KiB");
    expect(formatDockerWidgetBytes(1.25 * 1024 ** 3)).toBe("1.25 GiB");
    expect(formatPodmanWidgetBytes(12.5 * 1024 ** 2)).toBe("12.5 MiB");
    expect(MonitorCriteriaMessageFormatter.formatBytes(1536)).toBe("1.50 KB");
  });

  test("in Persian, zero bytes is a whole Persian zero", () => {
    expect(formatOpenStackBytes(0, { language: "fa" })).toBe("۰ B");
    expect(formatOpenStackBytes(5, { language: "fa" })).toBe("۵ B");
    expect(formatOpenStackBytes(1536, { language: "fa" })).toBe("۱٫۵ KiB");
  });

  // The rule as it was, which the first test fails on: the negative control.
  test("negative control: one decimal under ten whatever the unit fails", () => {
    const oldRule: (bytes: number) => string = (bytes: number): string => {
      return `${bytes.toFixed(bytes < 10 ? 1 : 0)} B`;
    };

    expect(oldRule(0)).not.toBe("0 B");
    expect(oldRule(5)).not.toBe("5 B");
  });
});

/*
 * EVERY BYTE FORMATTER IS HELD HERE.
 *
 * A file of the frontends or of Common with a list of byte units that
 * starts at "B" writes plain bytes with the same toFixed as a gigabyte - the
 * shape that wrote "0.0 B". Each is named below: by the formatter this
 * suite calls above, or - a formatter inside a page a test cannot load on
 * its own - by the words that keep its plain bytes whole, which its file
 * must still hold. A new formatter must join FORMATTERS, or better, write
 * its sizes with telemetryFormat's formatBytes / getBytesReading or the
 * host pages' formatHostBytes.
 */

const PACKAGES: string = path.resolve(__dirname, "../../../..");

const SCANNED_FOLDERS: ReadonlyArray<string> = [
  "App/FeatureSet/Dashboard/src",
  "App/FeatureSet/AdminDashboard/src",
  "App/FeatureSet/Accounts/src",
  "App/FeatureSet/StatusPage/src",
  "App/FeatureSet/PublicDashboard/src",
  "Common/UI",
  "Common/Utils",
  "Common/Types",
  "Common/Server",
];

// A list of byte units that starts at plain bytes: ["B", "KiB", ...], ["B", "KB", ...].
const BYTE_UNITS_FROM_B: RegExp = /\[\s*"B"\s*,\s*"[Kk]i?B"/;

type Held =
  | { calledAs: string }
  | { wholeBytesRule: string; provenBy?: string };

const HELD: Readonly<Record<string, Held>> = {
  "App/FeatureSet/Dashboard/src/Components/TelemetryResource/telemetryFormat.ts":
    { calledAs: "telemetryFormat formatBytes (telemetry and App Platforms)" },
  "App/FeatureSet/Dashboard/src/Pages/Host/Utils/HostFacts.ts": {
    calledAs: "formatHostBytes (host pages and the process list)",
  },
  "App/FeatureSet/Dashboard/src/Pages/Database/Utils/DatabaseServerPresentation.ts":
    { calledAs: "formatDatabaseBytes" },
  "App/FeatureSet/Dashboard/src/Components/Dashboard/Components/StorageArrayWidgetData.ts":
    { calledAs: "formatStorageBytes (storage array widgets)" },
  "App/FeatureSet/Dashboard/src/Components/NetworkTraffic/NetworkTrafficFormat.ts":
    { calledAs: "formatTrafficBytes (network traffic)" },
  "App/FeatureSet/Dashboard/src/Components/DataObservability/DataObservabilityFormat.ts":
    { calledAs: "Data Observability formatSize" },
  "App/FeatureSet/Dashboard/src/Components/Cloud/CloudHeadlineTiles.ts": {
    calledAs: "formatCloudBytes",
  },
  "App/FeatureSet/Dashboard/src/Components/Dashboard/Components/DashboardDockerContainerListComponent.tsx":
    { calledAs: "the Docker container list widget" },
  "App/FeatureSet/Dashboard/src/Components/Dashboard/Components/DashboardPodmanContainerListComponent.tsx":
    { calledAs: "the Podman container list widget" },
  "Common/Utils/SecurityEvent/TelemetryScan/FlowSignals.ts": {
    calledAs: "flow signals formatBytes (security events)",
  },
  "Common/Server/Utils/Monitor/MonitorCriteriaMessageFormatter.ts": {
    calledAs: "monitor criteria messages",
  },
  "App/FeatureSet/Dashboard/src/Components/SessionReplay/ReplayCorrelationPanel.tsx":
    {
      wholeBytesRule: "value.toFixed(index === 0 ? 0 : 1)",
      provenBy: "Common/Tests/UI/Rum/ReplayCorrelationPanel.test.tsx",
    },
  "App/FeatureSet/Dashboard/src/Pages/Docker/View/Containers.tsx": {
    wholeBytesRule: "value.toFixed(value >= 100 || idx === 0 ? 0 : 1)",
  },
  "App/FeatureSet/Dashboard/src/Pages/Podman/View/Containers.tsx": {
    wholeBytesRule: "value.toFixed(value >= 100 || idx === 0 ? 0 : 1)",
  },
  "App/FeatureSet/Dashboard/src/Components/ContainerHost/ContainerHostContainerOverview.tsx":
    { wholeBytesRule: "value.toFixed(value >= 100 || index === 0 ? 0 : 1)" },
  "App/FeatureSet/Dashboard/src/Components/Dashboard/Components/DashboardVMwareHostListComponent.tsx":
    { wholeBytesRule: "scaled.toFixed(unitIndex === 0 ? 0 : 1)" },
  "App/FeatureSet/Dashboard/src/Components/Dashboard/Components/DashboardHostListComponent.tsx":
    { wholeBytesRule: "value.toFixed(value >= 100 || i === 0 ? 0 : 1)" },
  "App/FeatureSet/Dashboard/src/Pages/DataObservability/Spend.tsx": {
    wholeBytesRule: "scaled >= 100 || unit === 0 ? Math.round(scaled)",
  },
  "App/FeatureSet/AdminDashboard/src/Pages/Health/ClickhouseCapacity.tsx": {
    wholeBytesRule: "scaled >= 10 || exponent === 0 ? 0 : 1",
  },
  "App/FeatureSet/AdminDashboard/src/Pages/Health/ClickhouseCapacitySummary.tsx":
    { wholeBytesRule: "scaled >= 10 || exponent === 0 ? 0 : 1" },
  "App/FeatureSet/AdminDashboard/src/Pages/Health/InstanceHealthLogs.tsx": {
    wholeBytesRule: "scaled >= 10 || exponent === 0 ? 0 : 1",
  },
};

const SKIPPED_FOLDERS: ReadonlyArray<string> = ["node_modules", "Locales"];

const SOURCE_FILE: RegExp = /\.(ts|tsx)$/;

const TYPE_DECLARATIONS: RegExp = /\.d\.ts$/;

function sourceFiles(folder: string): Array<string> {
  const found: Array<string> = [];

  for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
    const full: string = path.join(folder, entry.name);

    if (entry.isDirectory()) {
      if (!SKIPPED_FOLDERS.includes(entry.name)) {
        found.push(...sourceFiles(full));
      }
    } else if (
      SOURCE_FILE.test(entry.name) &&
      !TYPE_DECLARATIONS.test(entry.name)
    ) {
      found.push(full);
    }
  }

  return found;
}

function relative(file: string): string {
  return path.relative(PACKAGES, file).split(path.sep).join("/");
}

const BYTE_FORMATTER_FILES: Array<string> = SCANNED_FOLDERS.filter(
  (folder: string): boolean => {
    return fs.existsSync(path.join(PACKAGES, folder));
  },
)
  .flatMap((folder: string): Array<string> => {
    return sourceFiles(path.join(PACKAGES, folder));
  })
  .filter((file: string): boolean => {
    return BYTE_UNITS_FROM_B.test(fs.readFileSync(file, "utf8"));
  })
  .map(relative)
  .sort();

describe("every byte formatter is held by this suite", () => {
  test("the scan finds byte formatters to hold", () => {
    // The telemetry pages' own, so the scan is known to see what it looks for.
    expect(BYTE_FORMATTER_FILES).toContain(
      "App/FeatureSet/Dashboard/src/Components/TelemetryResource/telemetryFormat.ts",
    );
  });

  test("each file with byte units from B is named here", () => {
    const unheld: Array<string> = BYTE_FORMATTER_FILES.filter(
      (file: string): boolean => {
        return HELD[file] === undefined;
      },
    );

    expect(unheld).toEqual([]);
  });

  test("each formatter named as called is one this suite calls", () => {
    const called: Array<string> = FORMATTERS.map(
      (formatter: NamedFormatter): string => {
        return formatter.name;
      },
    );

    for (const [file, held] of Object.entries(HELD)) {
      if ("calledAs" in held) {
        expect([file, called.includes(held.calledAs)]).toEqual([file, true]);
      }
    }
  });

  test("each formatter held by its words still has them", () => {
    for (const [file, held] of Object.entries(HELD)) {
      if (!("wholeBytesRule" in held)) {
        continue;
      }

      const full: string = path.join(PACKAGES, file);

      expect([file, fs.existsSync(full)]).toEqual([file, true]);
      expect([
        file,
        fs.readFileSync(full, "utf8").includes(held.wholeBytesRule),
      ]).toEqual([file, true]);

      if (held.provenBy) {
        expect(fs.existsSync(path.join(PACKAGES, held.provenBy))).toBe(true);
      }
    }
  });

  test("no file is held here that no longer has byte units from B", () => {
    expect(
      Object.keys(HELD).filter((file: string): boolean => {
        return !BYTE_FORMATTER_FILES.includes(file);
      }),
    ).toEqual([]);
  });

  test("the host and Kubernetes pages write sizes with the shared formatters", () => {
    for (const file of [
      "App/FeatureSet/Dashboard/src/Pages/Host/View/Overview.tsx",
      "App/FeatureSet/Dashboard/src/Pages/Host/View/ProcessView.tsx",
      "App/FeatureSet/Dashboard/src/Pages/Host/View/Processes.tsx",
      "App/FeatureSet/Dashboard/src/Pages/Kubernetes/View/Index.tsx",
    ]) {
      expect([file, BYTE_FORMATTER_FILES.includes(file)]).toEqual([
        file,
        false,
      ]);
    }
  });
});

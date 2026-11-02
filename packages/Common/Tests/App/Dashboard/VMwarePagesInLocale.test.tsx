import "@testing-library/jest-dom";
import {
  afterEach,
  beforeAll,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { act, cleanup, render, screen } from "@testing-library/react";
import fs from "fs";
import i18next from "i18next";
import path from "path";
import React, { ReactElement } from "react";
import { initReactI18next } from "react-i18next";
import { MemoryRouter } from "react-router-dom";
// The Metrics tab's charts: what they are handed is what is checked.
const mockMetricsTabProps: Array<Record<string, unknown>> = [];

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Infrastructure/ResourceMetricsTab",
  () => {
    return {
      __esModule: true,
      default: (props: Record<string, unknown>): ReactElement => {
        mockMetricsTabProps.push(props);
        return <div data-testid="metrics-tab" />;
      },
    };
  },
);

import VMwarePartHero from "../../../../App/FeatureSet/Dashboard/src/Components/VMware/Part/VMwarePartHero";
import VMwareHostMetricsTab from "../../../../App/FeatureSet/Dashboard/src/Components/VMware/Host/VMwareHostMetricsTab";
import VMwareHostReportNotice from "../../../../App/FeatureSet/Dashboard/src/Components/VMware/Host/VMwareHostReportNotice";
import { VMwareHostReportState } from "../../../../App/FeatureSet/Dashboard/src/Pages/VMware/Utils/VMwareHostData";
import VMwareResource from "../../../Models/DatabaseModels/VMwareResource";
import { VMwareResourceKind } from "../../../Types/Monitor/MonitorStepVMwareMonitor";
import Route from "../../../Types/API/Route";

/*
 * A vCenter's pages in every language the Dashboard ships - its Overview,
 * its lists, and the page of each ESXi host, VM, datastore and cluster -
 * read from the locale files themselves:
 *
 *   - every sentence the pages add is the language's own (or recorded as
 *     reading the same in it), and every sentence listed for a part of a
 *     page is still in that part;
 *   - a time in a sentence ("vCenter last reported this host 2 hours ago")
 *     is written in the sentence's language: the reader's when their
 *     language words the sentence, English when it does not - never a
 *     German time inside an English sentence.
 */

const DASHBOARD_SRC: string = path.resolve(
  __dirname,
  "../../../../App/FeatureSet/Dashboard/src",
);

const LOCALES_DIR: string = path.join(DASHBOARD_SRC, "Locales");

const PROGRESS_DIR: string = path.resolve(DASHBOARD_SRC, "../i18n/Progress");

const LANGUAGES: Array<string> = [
  "de",
  "fr",
  "es",
  "it",
  "pt",
  "nl",
  "da",
  "no",
  "sv",
  "ru",
  "ja",
  "ko",
  "zh-CN",
  "zh-TW",
  "hi",
  "fa",
];

function readJson<T>(file: string): T {
  return JSON.parse(fs.readFileSync(file, "utf8")) as T;
}

function readLocale(locale: string): Record<string, string> {
  return readJson<Record<string, string>>(
    path.join(LOCALES_DIR, `${locale}.json`),
  );
}

// The locale's own list of English that reads the same in it.
function sameAsEnglish(locale: string): Set<string> {
  return new Set<string>(
    readJson<{ sameAsEnglish: Array<string> }>(
      path.join(PROGRESS_DIR, `${locale}.json`),
    ).sameAsEnglish,
  );
}

// Where a "//" comment starts on a line: not the "//" of a URL's "://".
function lineCommentStart(line: string): number {
  let at: number = line.indexOf("//");

  while (at > 0 && line[at - 1] === ":") {
    at = line.indexOf("//", at + 2);
  }

  return at;
}

/*
 * A source file without its comments, so a comment cannot stand in for a
 * use. Scanned line by line with indexOf rather than matched with a pattern.
 */
function readCode(relativePath: string): string {
  const source: string = fs.readFileSync(
    path.join(DASHBOARD_SRC, ...relativePath.split("/")),
    "utf8",
  );
  const kept: Array<string> = [];
  let inBlock: boolean = false;

  for (const line of source.split("\n")) {
    let rest: string = line;
    let out: string = "";

    while (rest.length > 0) {
      if (inBlock) {
        const end: number = rest.indexOf("*/");

        if (end < 0) {
          rest = "";
        } else {
          rest = rest.slice(end + 2);
          inBlock = false;
        }

        continue;
      }

      const block: number = rest.indexOf("/*");
      const comment: number = lineCommentStart(rest);

      if (block >= 0 && (comment < 0 || block < comment)) {
        out += rest.slice(0, block);
        rest = rest.slice(block + 2);
        inBlock = true;
      } else if (comment >= 0) {
        out += rest.slice(0, comment);
        rest = "";
      } else {
        out += rest;
        rest = "";
      }
    }

    kept.push(out);
  }

  return kept.join("\n");
}

/*
 * The sentences the host page adds, by the part of the page that shows them.
 * Written out so a language that lost one is caught; the first test holds
 * each to its part, so a reworded page is caught too. A count-dependent
 * sentence is listed by its general form; its one form follows below.
 */
const PART_SENTENCES: Record<string, Array<string>> = {
  // The top of every part's page: where it sits, its size and its VMs.
  "Components/VMware/Part/VMwarePartHero.tsx": [
    "ESXi host",
    "ESXi host in cluster {{cluster}}",
    "ESXi host in cluster {{cluster}}, datacenter {{datacenter}}",
    "ESXi host in datacenter {{datacenter}}",
    "Standalone ESXi host in datacenter {{datacenter}}",
    "On host {{host}}",
    "On host {{host}} in cluster {{cluster}}, datacenter {{datacenter}}",
    "On host {{host}} in datacenter {{datacenter}}",
    "Datastore in datacenter {{datacenter}}",
    "Cluster in datacenter {{datacenter}}",
    "Not in inventory",
    "vCenter has not reported this for more than 15 minutes, so it left the inventory.",
    "{{capacity}} CPU",
    "{{capacity}} memory",
    "{{capacity}} provisioned",
    "{{capacity}} capacity",
    "{{poweredOn}}/{{count}} VMs powered on",
    "{{effective}}/{{count}} ESXi hosts effective",
    "{{count}} ESXi hosts",
    "{{count}} templates",
    "Pool {{name}}",
    "vApp {{name}}",
  ],
  "Components/ResourcePart/ResourcePartHero.tsx": ["Last reported {{time}}"],
  "Components/VMware/Part/VMwarePartReadError.tsx": [
    "Couldn't load this ESXi host",
    "Couldn't load this virtual machine",
    "Couldn't load this datastore",
    "Couldn't load this cluster",
  ],
  // What needs attention, and each part's state, in vCenter's words.
  "Pages/VMware/Utils/VMwareHealth.ts": [
    "Connected",
    "Not responding",
    "Powered off",
    "In standby",
    "Powered off or in standby",
    "No usage reported",
    "Not reporting",
    "No data yet",
    "Running",
    "Disconnected",
    "Template",
    "{{percent}} used",
    "Healthy",
    "Degraded",
    "Unhealthy",
    "vCenter has lost contact with this host: it crashed, lost power or its management network, or was disconnected.",
    "Someone powered this host off through vCenter.",
    "vSphere DPM put this host in standby to save power. It wakes when the cluster needs it.",
    "vCenter reports no CPU or memory use on this host, and its datacenter has hosts powered off and in standby.",
    "vCenter reports no CPU or memory use on this host: it is not responding, powered off or in standby.",
    "vCenter has not reported this for more than 15 minutes.",
    "vCenter cannot reach the ESXi host this VM runs on, so it does not know what the VM is doing.",
    "No CPU or memory use reported",
    "CPU at {{percent}}",
    "Memory at {{percent}}",
    "{{percent}} full",
    "{{amount}} of memory swapped by the host",
    "{{amount}} of memory ballooned",
    "CPU ready {{percent}}",
    "Not enough memory to lose a host",
    "{{count}} hosts not effective",
    "{{count}} hosts not responding",
    "{{count}} hosts with a critical alarm",
    "{{count}} hosts with a warning alarm",
    "{{count}} VMs with a critical alarm",
    "{{count}} clusters with a critical alarm",
    "Datacenter",
    "Cluster",
    "ESXi host",
    "Datastore",
    "VM",
    "Resource pool",
  ],
  "Pages/VMware/Utils/VMwarePartFacts.ts": [
    "{{count}} not responding",
    "{{count}} in maintenance mode",
    "{{count}} reporting no usage",
    "{{count}} off or in standby",
  ],
  "Components/VMware/Part/VMwareVirtualMachineOverview.tsx": [
    "This VM",
    "What about this virtual machine is broken or needs a look.",
    "waits for a free CPU",
    "Open on this VM",
    "Unresolved incidents and alerts about this virtual machine, incidents first.",
    "VM alerts",
    "The vCenter's alerts that watch every virtual machine, this one included: each is one monitor that fires for any VM that crosses it.",
    "What vCenter reports about this virtual machine.",
    "Instance UUID",
    "Inventory Path",
    "vCenter ID",
    "Last report",
  ],
  "Components/VMware/Part/VMwareDatastoreOverview.tsx": [
    "This datastore",
    "What about this datastore is broken or needs a look.",
    "Growth Forecast",
    "Full now",
    "Open on this datastore",
    "Unresolved incidents and alerts about this datastore, incidents first.",
    "Datastore alerts",
    "The vCenter's alerts that watch every datastore, this one included: each is one monitor that fires for any datastore that crosses it.",
    "What vCenter reports about this datastore.",
  ],
  "Components/VMware/Part/VMwareClusterOverview.tsx": [
    "This cluster",
    "What in this cluster is broken or needs a look: the cluster, its hosts and the VMs on them.",
    "Effective hosts",
    "Host failure",
    "Covered",
    "Not covered",
    "{{spare}} of memory to spare without the largest host",
    "{{short}} of memory short without the largest host",
    "This cluster's hosts: each one's state and load at vCenter's latest report, the ones that need attention first.",
    "Open in this cluster",
    "Unresolved incidents and alerts about this cluster, its hosts and its VMs, incidents first.",
    "Cluster alerts",
    "The vCenter's alerts that watch every cluster, this one included: each is one monitor that fires for any cluster that crosses it.",
    "What vCenter reports about this cluster.",
    "CPU (Effective / Total)",
    "Memory (Effective / Total)",
  ],
  "Components/VMware/VMwareHostsCard.tsx": [
    "ESXi Hosts",
    "Each host's state and load at vCenter's latest report, the ones that need attention first.",
    "View all {{count}} hosts",
    "Cluster {{cluster}}",
    "Standalone",
  ],
  "Components/VMware/VMwareResourceTables.tsx": [
    "ESXi hosts managed by this vCenter, whether vCenter can reach each one, and how busy it is.",
    "Virtual machines (and VM templates) in this vCenter, their state, and their current resource usage. CPU is reported only for powered-on VMs.",
    "CPU Capacity",
    "Resource Pool",
  ],
  "Pages/VMware/View/ClusterDetail.tsx": [
    "The ESXi hosts of this cluster, whether vCenter can reach each one, and how busy it is.",
    "The virtual machines (and VM templates) in this cluster, their state, and their current resource usage. CPU is reported only for powered-on VMs.",
    "This cluster runs no virtual machines.",
  ],
  "Pages/VMware/View/Clusters.tsx": [
    "vSphere compute clusters in this vCenter, whether each one needs attention, its host and VM counts and how much of its effective capacity its hosts use. A standalone ESXi host has no cluster.",
  ],
  // The Overview's hero: how many hosts vCenter reaches.
  "Pages/VMware/View/Index.tsx": [
    "{{connected}}/{{count}} ESXi hosts connected",
    "Effective hosts",
  ],
  "Components/VMware/Host/VMwareHostReportNotice.tsx": [
    "Check the vCenter",
    "See all hosts",
    "This host is not in the vCenter's inventory",
    "Waiting for this host's first metrics",
    "vCenter has not reported it for more than 15 minutes, so it left the inventory until a collection reports it again. Its earlier metrics are kept: pick a longer time range to see them.",
    "vCenter lists this host but has sent no metrics for it yet. They arrive with the next collection, every 2 minutes by default.",
    "Its numbers stop there. The host may be disconnected from vCenter, in maintenance mode or powered off - or the vCenter itself stopped reporting.",
    "vCenter last reported this host {{time}}",
    "vCenter stopped reporting this host",
  ],
  "Components/VMware/Host/VMwareHostOverviewTab.tsx": [
    "This host",
    "What about this host and the VMs it runs is broken or needs a look.",
    "As vCenter reports this host, over the selected time range",
    "Disk latency",
    "Slowest disk",
    "of {{capacity}}",
    "slowest disk",
    "Open on this host",
    "Unresolved incidents and alerts about this host and the VMs on it, incidents first.",
    "Host alerts",
    "The vCenter's alerts that watch every ESXi host, this one included: each is one monitor that fires for any host that crosses it.",
  ],
  "Components/VMware/Host/VMwareHostBusiestVirtualMachines.tsx": [
    "Busiest virtual machines",
    "CPU Ready {{percent}}",
    "No running virtual machine has reported its CPU in the last 15 minutes.",
    "No virtual machine is running on this host.",
    "The running VMs on this host using the most CPU in the latest inventory.",
    "View all {{count}} virtual machines",
    "{{used}} memory",
    "{{used}} of {{total}} memory",
  ],
  "Components/VMware/Host/VMwareHostDeviceTables.tsx": [
    "Adapter",
    "Network adapters",
    "Read latency",
    "Storage devices",
    "The disks and LUNs this host reads and writes, each averaged over the selected range.",
    "The host's physical network adapters, each averaged over the selected range.",
    "Write latency",
  ],
  // The shared cards every part's page draws its alerts and what is open in.
  "Components/ResourcePart/ResourcePartAlertsCard.tsx": [
    "Turn on {{count}} alerts",
  ],
  "Components/ResourcePart/ResourcePartOpenEventsCard.tsx": [
    "{{count}} more alerts",
    "{{count}} more incidents",
  ],
  "Components/VMware/Host/VMwareHostDetailsCard.tsx": [
    "CPU capacity",
    "Host name",
    "How vCenter knows this host. vCenter owns these: change them there.",
    "Inventory ID",
    "None - a standalone host",
    "VM templates",
    "Virtual machines",
    "{{total}} ({{running}} running, {{off}} off)",
  ],
  "Components/VMware/Host/VMwareHostVirtualMachinesTab.tsx": [
    "The virtual machines (and VM templates) on this host, their state, and their current resource usage. CPU is reported only for powered-on VMs.",
    "This host runs no virtual machines.",
  ],
  "Components/VMware/Host/VMwareHostLogsTab.tsx": [
    "A probe collects this vCenter, and a probe reads the vSphere API only: it does not receive the syslog ESXi sends. The VMware agent has a syslog listener that brings this host's logs here.",
    "ESXi sends its logs - vmkernel, hostd, vpxa and the rest - as syslog. Two steps bring them here:",
    "Every host of cluster {{cluster}} at once:",
    "It is off until you turn it on: uncomment the syslog receivers in the agent's config and open port 5514.",
    "Lines show here when the host names itself {{hostName}} in them. If it uses another name, see it with {{command}} on the host.",
    "No logs from this host",
    "No logs from this host yet",
    "Or with PowerCLI, signed in to this vCenter:",
    "Point this host at the agent",
    "Probe or agent?",
    "Replace <agent-host> with the agent machine's address. On the host itself (ESXi Shell or SSH):",
    "Shipping ESXi syslog",
    "Turn on the VMware agent's syslog listener",
  ],
  "Components/VMware/Host/VMwareHostMetricsTab.tsx": [
    "CPU Utilization",
    "CPU, memory, network, disk throughput, disk latency and NIC errors for this ESXi host over the selected time range.",
    "Disk Latency (max)",
    "Disk Throughput",
    "Host Metrics: {{hostName}}",
    "Memory Usage",
    "Network Packet Drops",
    "Network Packet Errors",
    "Network Throughput",
  ],
  /*
   * Shared parts the host page draws, whose words were English in every
   * language until its review: an empty chart, and the refresh control.
   */
  "Components/TelemetryResource/ChartCard.tsx": ["No data in this time range"],
  "Components/TelemetryResource/AutoRefreshControl.tsx": [
    "Every {{interval}}",
    "Off",
    "Refresh",
    "Refresh now",
  ],
  "Components/MetricDescriptions/VMwareMetricDescriptions.ts": [
    "CPU in use in each interval of the selected range, as a share of this host's CPU capacity.",
    "Data read from and written to the device per second, averaged over the selected range.",
    "Data received and sent per second by this host's physical network adapters in each interval of the selected range.",
    "Data the adapter received and sent per second, averaged over the selected range.",
    "Data this host's physical network adapters received and sent per second, together, averaged over the last 5 minutes of the selected range (often the whole range on ranges over 12 hours or without recent data).",
    "How long a read or a write took on the device, on average over the selected range, in milliseconds. Amber from 20 ms, red from 50 ms.",
    "Packets dropped per second, averaged over the selected range: usually a saturated uplink or a full receive buffer.",
    "Packets received or sent with errors per second, averaged over the selected range. Anything above zero points at a cable, transceiver or switch port.",
    "Packets the adapter received and sent per second, together, averaged over the selected range.",
    "RAM in use in each interval of the selected range, as a share of this host's RAM.",
    "Share of this host's CPU capacity in use, averaged over the last 5 minutes of the selected range (often the whole range on ranges over 12 hours or without recent data). The chart below covers the whole range.",
    "Share of this host's RAM in use, averaged over the last 5 minutes of the selected range (often the whole range on ranges over 12 hours or without recent data).",
    "The highest latency of any of this host's storage devices in each interval of the selected range, in milliseconds.",
    "The powered-on VMs on this host with a CPU reading from the last 15 minutes, busiest first: each VM's CPU as a share of its own vCPUs, from the latest inventory rather than the selected range. A CPU Ready badge marks a VM waiting for a physical CPU (amber from 5%, red from 10%).",
    "The highest latency any of this host's storage devices reported in the last 5 minutes of the selected range (often the whole range on ranges over 12 hours or without recent data). Amber from 20 ms; full at 50 ms, where the Host Disk Latency High alert fires.",
    "This host's total CPU: all its cores added together, in MHz or GHz, from the latest report.",
    // What the reworked pages say about a host's, a cluster's and a list's state.
    "Connected while vCenter reports the host's CPU and memory use, amber when something on it needs a look. Not responding when vCenter has lost contact with it; Powered off or In standby when someone or vSphere DPM turned it off; No usage reported when vCenter does not say which.",
    "Unhealthy when a host of the cluster is not responding; Degraded when hosts are not effective (often maintenance mode) or the cluster could not take the VMs of its largest host; Healthy otherwise.",
    "Running, Powered off or Template, inferred from whether the VM sent CPU data in the latest collection. Running turns amber or red, with why under it, while the host swaps, balloons or makes the VM wait for a CPU.",
    "Unhealthy while something needs someone now (an ESXi host vCenter cannot reach, a critical alarm, a datastore more than 90% full, a VM the host swaps to disk), Degraded while something needs a look. Needs attention lists each, the most urgent first; unknown while the vCenter is disconnected.",
    "Hosts in this cluster that vSphere can place VMs on (effective), out of all its hosts, from the latest report. A host in maintenance mode, not responding, powered off or in standby is not effective.",
    "CPU the cluster's running hosts use, against the CPU the cluster can give its VMs (effective), from their latest reports. Amber past 90%.",
    "Memory the cluster's running hosts use, against the memory the cluster can give its VMs (effective), from their latest reports. Amber past 90%.",
    "Whether the cluster's other hosts could take the VMs of its largest host if it failed: the memory its running hosts use, against what the others have. vSphere HA restarts a failed host's VMs on the hosts left, and some may not fit.",
    "How many datacenters, clusters, ESXi hosts (connected out of all), VMs (powered on out of all, templates excluded) and datastores this vCenter has, from the latest inventory rather than the selected range. A kind with none is left out.",
  ],
};

// The one forms of the counts above, as their parts write them.
const ONE_FORMS: Record<string, string> = {
  "View all {{count}} virtual machines": "View {{count}} virtual machine",
  "Turn on {{count}} alerts": "Turn on {{count}} alert",
  "{{count}} more alerts": "{{count}} more alert",
  "{{count}} more incidents": "{{count}} more incident",
  "{{poweredOn}}/{{count}} VMs powered on":
    "{{poweredOn}}/{{count}} VM powered on",
  "{{effective}}/{{count}} ESXi hosts effective":
    "{{effective}}/{{count}} ESXi host effective",
  "{{count}} ESXi hosts": "{{count}} ESXi host",
  "{{count}} templates": "{{count}} template",
  "{{count}} hosts not effective": "{{count}} host not effective",
  "{{count}} hosts not responding": "{{count}} host not responding",
  "{{count}} hosts with a critical alarm":
    "{{count}} host with a critical alarm",
  "{{count}} hosts with a warning alarm": "{{count}} host with a warning alarm",
  "{{count}} VMs with a critical alarm": "{{count}} VM with a critical alarm",
  "{{count}} clusters with a critical alarm":
    "{{count}} cluster with a critical alarm",
  "View all {{count}} hosts": "View {{count}} host",
  "{{connected}}/{{count}} ESXi hosts connected":
    "{{connected}}/{{count}} ESXi host connected",
};

// Languages without a "one" form never show a _one key.
const NO_ONE_FORM: Array<string> = ["ja", "ko", "zh-CN", "zh-TW"];

function everyKey(): Array<string> {
  const keys: Array<string> = [];

  for (const sentences of Object.values(PART_SENTENCES)) {
    for (const sentence of sentences) {
      keys.push(sentence);

      if (ONE_FORMS[sentence]) {
        keys.push(`${sentence}_one`);
      }
    }
  }

  return keys;
}

const HOURS_AGO_2: () => Date = (): Date => {
  return new Date(Date.now() - 2 * 60 * 60 * 1000 - 60 * 1000);
};

/*
 * An ESXi host's hero, reported two hours ago, in a datacenter that lost
 * contact with one host and has none off: a host that reports no usage
 * there is the one vCenter cannot reach.
 */
function heroOfAHost(fields: Record<string, unknown> = {}): ReactElement {
  const reportedAt: Date = HOURS_AGO_2();
  const now: Date = new Date(reportedAt.getTime() + 2 * 60 * 1000);
  const row: VMwareResource = Object.assign(new VMwareResource(), {
    kind: VMwareResourceKind.Host,
    externalId: "host/dc-east/esx01.acme.example",
    name: "esx01.acme.example",
    hostName: "esx01.acme.example",
    clusterName: "prod",
    datacenterName: "dc-east",
    cpuCapacityMhz: 48000,
    maxMemoryBytes: 256 * 1024 * 1024 * 1024,
    latestCpuMhz: 12000,
    latestCpuPercent: 25,
    latestMemoryBytes: 64 * 1024 * 1024 * 1024,
    latestMemoryPercent: 25,
    metricsUpdatedAt: reportedAt,
    ...fields,
  });
  const datacenter: VMwareResource = Object.assign(new VMwareResource(), {
    kind: VMwareResourceKind.Datacenter,
    externalId: "datacenter/dc-east",
    name: "dc-east",
    metricsUpdatedAt: reportedAt,
    hostCount: 4,
    poweredOnHostCount: 3,
    notRespondingHostCount: 1,
    standbyHostCount: 0,
  });
  return (
    <VMwarePartHero
      kind={VMwareResourceKind.Host}
      row={row}
      externalId="host/dc-east/esx01.acme.example"
      datacenters={[datacenter]}
      hosts={[row]}
      now={now}
    />
  );
}

async function readIn(language: string): Promise<void> {
  await act(async () => {
    await i18next.changeLanguage(language);
  });
}

function renderInRouter(element: ReactElement): void {
  render(<MemoryRouter>{element}</MemoryRouter>);
}

beforeAll(async () => {
  const resources: Record<string, { translation: Record<string, string> }> = {
    en: { translation: readLocale("en") },
  };

  for (const language of LANGUAGES) {
    resources[language] = { translation: readLocale(language) };
  }

  await i18next.use(initReactI18next).init({
    lng: "en",
    fallbackLng: "en",
    resources: resources,
    interpolation: { escapeValue: false },
  });
});

afterEach(async () => {
  cleanup();
  await readIn("en");
});

describe("a vCenter's pages in every language", () => {
  test("every listed sentence is still in its part of the page", () => {
    const missing: Array<string> = [];

    for (const [part, sentences] of Object.entries(PART_SENTENCES)) {
      const code: string = readCode(part);

      for (const sentence of sentences) {
        if (!code.includes(JSON.stringify(sentence))) {
          missing.push(`${part}: ${sentence}`);
        }

        const one: string | undefined = ONE_FORMS[sentence];

        if (one && !code.includes(JSON.stringify(one))) {
          missing.push(`${part}: ${one}`);
        }
      }
    }

    expect(missing).toEqual([]);
  });

  test("en.json holds every sentence and its one form as the parts write them", () => {
    const english: Record<string, string> = readLocale("en");

    for (const key of everyKey()) {
      expect(english[key]).toBeDefined();
    }

    for (const [sentence, one] of Object.entries(ONE_FORMS)) {
      expect(english[`${sentence}_one`]).toBe(one);
    }
  });

  test.each(LANGUAGES)(
    "%s words every sentence of the page itself",
    (language: string) => {
      const english: Record<string, string> = readLocale("en");
      const locale: Record<string, string> = readLocale(language);
      const excused: Set<string> = sameAsEnglish(language);
      const stillEnglish: Array<string> = everyKey().filter(
        (key: string): boolean => {
          if (key.endsWith("_one") && NO_ONE_FORM.includes(language)) {
            return false;
          }

          return (
            locale[key] === english[key] && !excused.has(english[key] || "")
          );
        },
      );

      expect(stillEnglish).toEqual([]);
    },
  );
});

describe("the Metrics tab in the reader's language", () => {
  test("hands its charts their titles and legends in German", async () => {
    await readIn("de");
    mockMetricsTabProps.length = 0;

    renderInRouter(
      <VMwareHostMetricsTab
        hostName="esx01.acme.example"
        attributes={{ "resource.vcenter.host.name": "esx01.acme.example" }}
      />,
    );

    const german: Record<string, string> = readLocale("de");
    const configs: Array<{
      metricAliasData: { title: string; legend: string };
    }> = mockMetricsTabProps[mockMetricsTabProps.length - 1]![
      "queryConfigs"
    ] as Array<{ metricAliasData: { title: string; legend: string } }>;

    /*
     * The charts draw a title as they are handed it: English titles stayed
     * English in every language although every locale words them.
     */
    expect(
      configs.map((config: { metricAliasData: { title: string } }) => {
        return config.metricAliasData.title;
      }),
    ).toEqual(
      [
        "CPU Utilization",
        "Memory Usage",
        "Network Throughput",
        "Disk Throughput",
        "Disk Latency (max)",
        "Network Packet Errors",
        "Network Packet Drops",
      ].map((title: string): string => {
        expect(german[title]).not.toBe(title);
        return german[title]!;
      }),
    );
    expect(configs[1]!.metricAliasData.legend).toBe(german["Memory"]);
    expect(
      screen.getByText("Host-Metriken: esx01.acme.example"),
    ).toBeInTheDocument();
  });
});

describe("a time inside a sentence", () => {
  test("is the reader's when their language words the sentence", async () => {
    await readIn("de");

    renderInRouter(
      <VMwareHostReportNotice
        reportState={VMwareHostReportState.NotReporting}
        lastReportAt={HOURS_AGO_2()}
        vcenterRoute={new Route("/dashboard/p/vmware/v")}
        hostsRoute={new Route("/dashboard/p/vmware/v/hosts")}
      />,
    );

    expect(
      screen.getByText(
        "vCenter hat diesen Host zuletzt vor 2 Stunden gemeldet",
      ),
    ).toBeInTheDocument();
  });

  test("reads in Japanese with a Japanese time", async () => {
    await readIn("ja");

    renderInRouter(
      <VMwareHostReportNotice
        reportState={VMwareHostReportState.NotReporting}
        lastReportAt={HOURS_AGO_2()}
        vcenterRoute={new Route("/dashboard/p/vmware/v")}
        hostsRoute={new Route("/dashboard/p/vmware/v/hosts")}
      />,
    );

    expect(
      screen.getByText(
        "vCenter がこのホストを最後に報告したのは 2 時間前 です",
      ),
    ).toBeInTheDocument();
  });

  test("the hero's last report reads in German, time and all", async () => {
    await readIn("de");

    renderInRouter(heroOfAHost());

    /*
     * Its own sentence, "Last reported", not the heroes' shared "Last seen
     * {{time}}": vCenter reports a host, it is not seen.
     */
    expect(screen.getByTestId("vmware-host-hero-last-report")).toHaveTextContent(
      /^Zuletzt gemeldet vor 2 Stunden$/,
    );
    expect(readLocale("de")["Last seen {{time}}"]).not.toBe(
      readLocale("de")["Last reported {{time}}"],
    );
    // Its state in German, what it means on hover.
    const status: HTMLElement = screen.getByTestId("vmware-host-hero-status");
    expect(status).toHaveTextContent(readLocale("de")["Connected"]!);
  });

  test("stays English, time and all, where a language has no wording for the sentence", async () => {
    /*
     * A language with every word of the hero but its "Last reported"
     * sentence: German without it, under a code with no base language
     * for i18next to fall back to.
     */
    const partial: Record<string, string> = { ...readLocale("de") };
    delete partial["Last reported {{time}}"];
    i18next.addResourceBundle("xx", "translation", partial);

    await readIn("xx");

    renderInRouter(heroOfAHost());

    expect(screen.getByTestId("vmware-host-hero-last-report")).toHaveTextContent(
      /^Last reported 2 hours ago$/,
    );
    // The rest of the hero is German.
    expect(
      screen.getByText("ESXi-Host im Cluster", { exact: false }),
    ).toBeInTheDocument();
  });

  test("a host vCenter lost reads Not responding in Persian, its meaning in Persian too", async () => {
    await readIn("fa");

    renderInRouter(
      heroOfAHost({
        latestCpuMhz: 0,
        latestCpuPercent: 0,
        latestMemoryBytes: 0,
        latestMemoryPercent: 0,
      }),
    );

    const persian: Record<string, string> = readLocale("fa");
    const status: HTMLElement = screen.getByTestId("vmware-host-hero-status");
    expect(status).toHaveTextContent(persian["Not responding"]!);
    expect(status).toHaveAttribute(
      "title",
      persian[
        "vCenter has lost contact with this host: it crashed, lost power or its management network, or was disconnected."
      ],
    );
  });

  test("is English in English", async () => {
    renderInRouter(
      <VMwareHostReportNotice
        reportState={VMwareHostReportState.NotReporting}
        lastReportAt={HOURS_AGO_2()}
        vcenterRoute={new Route("/dashboard/p/vmware/v")}
        hostsRoute={new Route("/dashboard/p/vmware/v/hosts")}
      />,
    );

    expect(
      screen.getByText("vCenter last reported this host 2 hours ago"),
    ).toBeInTheDocument();
  });
});

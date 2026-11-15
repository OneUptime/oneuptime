import "@testing-library/jest-dom";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "@jest/globals";
import { cleanup, render, screen } from "@testing-library/react";
import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import fs from "fs";
import path from "path";
import * as React from "react";
import NetworkTopology, {
  NetworkTopologyNode,
} from "../../../Types/Monitor/SnmpMonitor/NetworkTopology";
import MonitorNotCheckedReason from "../../../Types/Monitor/MonitorNotCheckedReason";
import NetworkDeviceGraph from "../../../../App/FeatureSet/Dashboard/src/Components/Topology/NetworkDeviceGraph";
import { accessibleLabelForNode } from "../../../../App/FeatureSet/Dashboard/src/Components/Topology/NetworkTopologyMeta";
import {
  MONITOR_ARCHIVED_QUALIFIER,
  MONITORING_OFF_QUALIFIER,
} from "../../../../App/FeatureSet/Dashboard/src/Components/NetworkDevice/DeviceStatusUtil";

/*
 * A NETWORK MAP NODE'S TOOLTIP SAYS WHY IT READS "UNKNOWN" (issue #7346),
 * RENDERED.
 *
 * Hovering a node shows its tooltip (the SVG title): its name, status and
 * interfaces. A monitor-backed device whose bound monitor nothing checks is
 * drawn "unknown", and its tooltip now says why on a line of its own - the
 * device pages' Pending sentence for it, in the reader's language - without
 * opening the drawer. A node whose monitor is checked keeps its one line.
 */

const LOCALES_DIR: string = path.resolve(
  __dirname,
  "../../../../App/FeatureSet/Dashboard/src/Locales",
);

function readLocale(locale: string): Record<string, string> {
  return JSON.parse(
    fs.readFileSync(path.join(LOCALES_DIR, `${locale}.json`), "utf8"),
  ) as Record<string, string>;
}

const EN: Record<string, string> = readLocale("en");
const DE: Record<string, string> = readLocale("de");
const AR: Record<string, string> = readLocale("ar");

const MONITOR_ID: string = "99999999-9999-4999-8999-999999999999";

const NODES: Array<NetworkTopologyNode> = [
  {
    id: "ap-off",
    name: "branch-ap-off",
    isManaged: true,
    kind: "device",
    status: "unknown",
    monitorNotChecked: {
      monitorId: MONITOR_ID,
      reason: MonitorNotCheckedReason.MonitoringOff,
    },
  },
  {
    id: "ap-archived",
    name: "branch-ap-archived",
    isManaged: true,
    kind: "device",
    status: "unknown",
    monitorNotChecked: {
      monitorId: MONITOR_ID,
      reason: MonitorNotCheckedReason.MonitorArchived,
    },
  },
  {
    id: "ap-checked",
    name: "branch-ap-checked",
    isManaged: true,
    kind: "device",
    status: "up",
  },
  {
    id: "ap-never-polled",
    name: "branch-ap-never-polled",
    isManaged: true,
    kind: "device",
    status: "unknown",
  },
];

const TOPOLOGY: NetworkTopology = {
  nodes: NODES,
  edges: [],
} as unknown as NetworkTopology;

function tooltipLines(nodeId: string): Array<string> {
  const node: HTMLElement = screen.getByTestId(
    `network-topology-node-${nodeId}`,
  );
  const title: Element | null = node.querySelector("title");

  expect(title).not.toBeNull();

  return (title!.textContent || "").split("\n");
}

beforeAll(async () => {
  await i18next.use(initReactI18next).init({
    lng: "en",
    fallbackLng: "en",
    resources: {
      de: { translation: DE },
      ar: { translation: AR },
      en: { translation: EN },
    },
    interpolation: { escapeValue: false },
  });
});

beforeEach(async () => {
  await i18next.changeLanguage("en");
});

afterEach(() => {
  cleanup();
});

describe("a Network Map node's tooltip", () => {
  test("monitoring off: a second line with the device pages' Pending sentence", () => {
    render(<NetworkDeviceGraph topology={TOPOLOGY} />);

    const lines: Array<string> = tooltipLines("ap-off");
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain("branch-ap-off");
    expect(lines[1]).toBe(MONITORING_OFF_QUALIFIER.pendingTooltip);
  });

  test("archived: a second line that says archived", () => {
    render(<NetworkDeviceGraph topology={TOPOLOGY} />);

    const lines: Array<string> = tooltipLines("ap-archived");
    expect(lines).toHaveLength(2);
    expect(lines[1]).toBe(MONITOR_ARCHIVED_QUALIFIER.pendingTooltip);
  });

  test("a checked device, and an unknown one with no reason, keep their one line", () => {
    render(<NetworkDeviceGraph topology={TOPOLOGY} />);

    expect(tooltipLines("ap-checked")).toHaveLength(1);
    expect(tooltipLines("ap-never-polled")).toHaveLength(1);
  });

  test.each([
    ["de", DE],
    ["ar", AR],
  ])(
    "%s: the second line is the locale's sentence",
    async (language: string, locale: Record<string, string>) => {
      await i18next.changeLanguage(language);
      render(<NetworkDeviceGraph topology={TOPOLOGY} />);

      const sentence: string | undefined =
        locale[MONITORING_OFF_QUALIFIER.pendingTooltip];
      expect(sentence).toBeTruthy();
      expect(sentence).not.toBe(MONITORING_OFF_QUALIFIER.pendingTooltip);
      expect(tooltipLines("ap-off")[1]).toBe(sentence);
      expect(tooltipLines("ap-archived")[1]).toBe(
        locale[MONITOR_ARCHIVED_QUALIFIER.pendingTooltip],
      );
    },
  );
});

/*
 * A screen reader hears the node's label, not its tooltip: it says the
 * reason too, after what the label always said, so the reason is heard
 * without opening the drawer.
 */
describe("a Network Map node's spoken label", () => {
  function spokenLabel(nodeId: string): string {
    return (
      screen
        .getByTestId(`network-topology-node-${nodeId}`)
        .getAttribute("aria-label") || ""
    );
  }

  function nodeById(nodeId: string): NetworkTopologyNode {
    return NODES.find((node: NetworkTopologyNode): boolean => {
      return node.id === nodeId;
    })!;
  }

  test("monitoring off and archived: the label, then the reason", () => {
    render(<NetworkDeviceGraph topology={TOPOLOGY} />);

    expect(spokenLabel("ap-off")).toBe(
      [
        accessibleLabelForNode(nodeById("ap-off")),
        MONITORING_OFF_QUALIFIER.pendingTooltip,
      ].join(". "),
    );
    expect(spokenLabel("ap-archived")).toBe(
      [
        accessibleLabelForNode(nodeById("ap-archived")),
        MONITOR_ARCHIVED_QUALIFIER.pendingTooltip,
      ].join(". "),
    );
  });

  test("a checked device, and an unknown one with no reason, keep the label they had", () => {
    render(<NetworkDeviceGraph topology={TOPOLOGY} />);

    expect(spokenLabel("ap-checked")).toBe(
      accessibleLabelForNode(nodeById("ap-checked")),
    );
    expect(spokenLabel("ap-never-polled")).toBe(
      accessibleLabelForNode(nodeById("ap-never-polled")),
    );
  });

  test("German: the reason in the locale's words", async () => {
    await i18next.changeLanguage("de");
    render(<NetworkDeviceGraph topology={TOPOLOGY} />);

    const sentence: string | undefined =
      DE[MONITORING_OFF_QUALIFIER.pendingTooltip];
    expect(sentence).toBeTruthy();
    expect(sentence).not.toBe(MONITORING_OFF_QUALIFIER.pendingTooltip);
    expect(spokenLabel("ap-off").endsWith(`. ${sentence}`)).toBe(true);
  });
});

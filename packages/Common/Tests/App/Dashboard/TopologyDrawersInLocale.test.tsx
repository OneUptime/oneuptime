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
import { MemoryRouter } from "react-router-dom";
import {
  NetworkTopologyEdge,
  NetworkTopologyNode,
} from "../../../Types/Monitor/SnmpMonitor/NetworkTopology";
import NetworkDeviceDetailPanel from "../../../../App/FeatureSet/Dashboard/src/Components/Topology/NetworkDeviceDetailPanel";
import NetworkLinkDetailPanel from "../../../../App/FeatureSet/Dashboard/src/Components/Topology/NetworkLinkDetailPanel";

/*
 * THE NETWORK MAP'S TWO DRAWERS IN THE READER'S LANGUAGE (#6658, UI review
 * of #6680).
 *
 * The device drawer's facts (Type, MAC address, VLAN, Interfaces ...) and
 * the link drawer's (Operational status, In rate ...) are looked up in the
 * Dashboard's locale files. The Interfaces row used to be written in code as
 * "40 up / 2 down" whatever the language; it is now the locale's own
 * "{{count}} up" and "{{count}} down", and still exactly that for an English
 * reader.
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

// The locale's own words for `key`, which must differ from the English.
function worded(
  locale: Record<string, string>,
  key: string,
  count?: number,
): string {
  const text: string | undefined = locale[key];

  expect({ key, translated: Boolean(text) && text !== EN[key] }).toEqual({
    key,
    translated: true,
  });

  return count === undefined
    ? (text as string)
    : (text as string).split("{{count}}").join(String(count));
}

const DEVICE_NODE: NetworkTopologyNode = {
  id: "switch-1",
  name: "core-sw-01",
  isManaged: true,
  kind: "device",
  role: "switch",
  status: "up",
  macAddress: "aa:bb:cc:dd:ee:01",
  ipAddress: "10.0.0.2",
  hostname: "core-sw-01.example",
  vlanId: 42,
  sysName: "core-sw-01",
  vendor: "Cisco",
  deviceModel: "C9300-48P",
  interfacesUp: 40,
  interfacesDown: 2,
};

const PEER_NODE: NetworkTopologyNode = {
  id: "switch-2",
  name: "access-sw-02",
  isManaged: true,
  kind: "device",
  role: "switch",
  status: "up",
};

const LINK: NetworkTopologyEdge = {
  fromNodeId: DEVICE_NODE.id,
  toNodeId: PEER_NODE.id,
  fromPort: "Gi1/0/48",
  toPort: "Gi1/0/1",
  fromInterface: {
    interfaceIndex: 48,
    isOperationallyUp: true,
    isAdministrativelyUp: true,
    utilizationPercent: 12,
    inRateMbps: 120,
    outRateMbps: 80,
    errorsPerSecond: 0,
  },
  protocols: ["lldp"],
};

const NODE_BY_ID: Map<string, NetworkTopologyNode> = new Map<
  string,
  NetworkTopologyNode
>([
  [DEVICE_NODE.id, DEVICE_NODE],
  [PEER_NODE.id, PEER_NODE],
]);

const DEVICE_LABELS: Array<string> = [
  "Type",
  "MAC address",
  "IP address",
  "Hostname",
  "VLAN",
  "System name",
  "Vendor",
  "Model",
  "Interfaces",
];

// The labels a language rightly writes as English does.
const SAME_IN: Array<string> = ["de:VLAN", "de:Hostname", "ar:VLAN"];

const LINK_LABELS: Array<string> = [
  "Operational status",
  "Admin status",
  "Utilization",
  "In rate",
  "Out rate",
  "Errors",
];

function renderDevicePanel(): void {
  render(
    <MemoryRouter>
      <NetworkDeviceDetailPanel
        node={DEVICE_NODE}
        edges={[LINK]}
        nodeById={NODE_BY_ID}
        onClose={() => {}}
        onSelectEdge={() => {}}
      />
    </MemoryRouter>,
  );
}

function renderLinkPanel(): void {
  render(
    <MemoryRouter>
      <NetworkLinkDetailPanel
        edge={LINK}
        fromNode={DEVICE_NODE}
        toNode={PEER_NODE}
        onClose={() => {}}
      />
    </MemoryRouter>,
  );
}

// The value written beside a fact's label in a drawer.
function valueBeside(label: string): string {
  const labelElement: HTMLElement = screen.getByText(label, {
    selector: "dt, span, p, div",
  });
  const row: HTMLElement = labelElement.parentElement as HTMLElement;

  return (row.textContent || "").replace(label, "").trim();
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

describe("the network device drawer in the reader's language", () => {
  test("English reads as it always did: 40 up / 2 down", () => {
    renderDevicePanel();

    for (const label of DEVICE_LABELS) {
      expect(screen.getAllByText(label).length).toBeGreaterThan(0);
    }
    expect(valueBeside("Interfaces")).toBe("40 up / 2 down");
  });

  test.each([
    ["de", DE],
    ["ar", AR],
  ])(
    "%s words every fact's label and counts the interfaces its own way",
    async (language: string, locale: Record<string, string>) => {
      await i18next.changeLanguage(language);
      renderDevicePanel();

      for (const label of DEVICE_LABELS) {
        if (SAME_IN.includes(`${language}:${label}`)) {
          // Written as in English: "VLAN", and German's "Hostname".
          expect(locale[label]).toBe(EN[label]);
          expect(screen.getAllByText(label).length).toBeGreaterThan(0);
          continue;
        }
        expect(screen.queryByText(label)).toBeNull();
        expect(
          screen.getAllByText(worded(locale, label)).length,
        ).toBeGreaterThan(0);
      }

      const interfaces: string = valueBeside(worded(locale, "Interfaces"));

      expect(interfaces).toBe(
        `${worded(locale, "{{count}} up", 40)} / ${worded(
          locale,
          "{{count}} down",
          2,
        )}`,
      );
      expect(interfaces).not.toMatch(/\b(up|down)\b/);
    },
  );

  test("the status beside the dot is the locale's word, not the raw up", async () => {
    renderDevicePanel();
    expect(
      screen.getByTestId("network-topology-device-status").textContent,
    ).toBe("Up");
    cleanup();

    await i18next.changeLanguage("ar");
    renderDevicePanel();
    expect(
      screen.getByTestId("network-topology-device-status").textContent,
    ).toBe(worded(AR, "Up"));
  });

  test("each fact's value is set apart, so a MAC or a port keeps its order on an Arabic page", async () => {
    await i18next.changeLanguage("ar");
    renderDevicePanel();

    for (const value of ["aa:bb:cc:dd:ee:01", "10.0.0.2", "VLAN 42"]) {
      expect(screen.getByText(value).tagName).toBe("BDI");
    }
  });

  test("German reads 40 aktiv / 2 ausgefallen", async () => {
    await i18next.changeLanguage("de");
    renderDevicePanel();

    expect(valueBeside(worded(DE, "Interfaces"))).toBe(
      "40 aktiv / 2 ausgefallen",
    );
  });
});

describe("the network link drawer in the reader's language", () => {
  test("a rate and an error count keep their order on an Arabic page", async () => {
    await i18next.changeLanguage("ar");
    renderLinkPanel();

    for (const value of ["120 Mbps", "80 Mbps", "0/s"]) {
      expect(screen.getByText(value).tagName).toBe("BDI");
    }
  });

  test("English labels are unchanged", () => {
    renderLinkPanel();

    for (const label of LINK_LABELS) {
      expect(screen.getAllByText(label).length).toBeGreaterThan(0);
    }
    expect(screen.getAllByText("Network link").length).toBeGreaterThan(0);
  });

  test.each([
    ["de", DE],
    ["ar", AR],
  ])(
    "%s words every metric's label and the kind of link",
    async (language: string, locale: Record<string, string>) => {
      await i18next.changeLanguage(language);
      renderLinkPanel();

      for (const label of LINK_LABELS) {
        expect(screen.queryByText(label)).toBeNull();
        expect(
          screen.getAllByText(worded(locale, label)).length,
        ).toBeGreaterThan(0);
      }
      expect(screen.queryByText("Network link")).toBeNull();
      expect(
        screen.getAllByText(worded(locale, "Network link")).length,
      ).toBeGreaterThan(0);
    },
  );
});

/*
 * From sm up the side-over leaves the top spacing of its body to what it
 * draws (sm:pt-0, for a panel whose sticky search box sits at the very
 * top). The map's drawers drew their first row - the device's status and a
 * "Monitoring off" pill beside it, the link's kind - on the header's edge.
 */
describe("the map's drawers keep their top spacing beside the header", () => {
  // The element the side-over's body draws first.
  function drawnFirst(): HTMLElement {
    const body: HTMLElement | null =
      document.querySelector<HTMLElement>("div.sm\\:pt-0");

    expect(body).not.toBeNull();

    return body!.firstElementChild as HTMLElement;
  }

  test("the device drawer", () => {
    renderDevicePanel();

    const content: HTMLElement = drawnFirst();
    expect(content).toHaveClass("space-y-6", "sm:pt-6");
    expect(content).toContainElement(
      screen.getByTestId("network-topology-device-status"),
    );
  });

  test("the link drawer", () => {
    renderLinkPanel();

    const content: HTMLElement = drawnFirst();
    expect(content).toHaveClass("space-y-6", "sm:pt-6");
    // The link's state pill first, then its facts.
    expect(content.firstElementChild).toHaveClass("flex", "flex-wrap");
    expect(content).toContainElement(
      screen.getAllByText("Operational status")[0]!,
    );
  });
});

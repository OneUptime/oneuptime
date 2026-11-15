import "@testing-library/jest-dom";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "@jest/globals";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import fs from "fs";
import path from "path";
import * as React from "react";
import { MemoryRouter } from "react-router-dom";
import { NetworkTopologyNode } from "../../../Types/Monitor/SnmpMonitor/NetworkTopology";
import NetworkDeviceDetailPanel from "../../../../App/FeatureSet/Dashboard/src/Components/Topology/NetworkDeviceDetailPanel";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * ISSUE #6606: "SHOW ONLY THIS BRANCH", FROM THE DEVICE DRAWER.
 *
 * Clicking a device on the parent-and-child map opens its drawer, and for a
 * device with something below it the drawer offers to narrow the map to it
 * and everything below it - saying how many devices that is, in the
 * reader's language. Without the action from the map, the drawer offers
 * nothing of the kind.
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

const SWITCH: NetworkTopologyNode = {
  id: "switch-1",
  name: "access-switch-01",
  isManaged: true,
  kind: "device",
  role: "switch",
  status: "up",
};

let onShowOnlyBranch: MockFunction;

function renderDrawer(withAction: boolean, branchDeviceCount: number): void {
  render(
    <MemoryRouter>
      <NetworkDeviceDetailPanel
        node={SWITCH}
        edges={[]}
        nodeById={new Map<string, NetworkTopologyNode>([[SWITCH.id, SWITCH]])}
        onClose={() => {}}
        onSelectEdge={() => {}}
        onShowOnlyBranch={
          withAction
            ? () => {
                onShowOnlyBranch();
              }
            : undefined
        }
        branchDeviceCount={branchDeviceCount}
      />
    </MemoryRouter>,
  );
}

beforeAll(async () => {
  await i18next.use(initReactI18next).init({
    lng: "en",
    fallbackLng: "en",
    resources: {
      de: { translation: readLocale("de") },
      en: { translation: readLocale("en") },
    },
    interpolation: { escapeValue: false },
  });
});

beforeEach(async () => {
  onShowOnlyBranch = getJestMockFunction();
  await i18next.changeLanguage("en");
});

afterEach(() => {
  cleanup();
});

describe("the device drawer narrows the map to the device's branch", () => {
  test("it says how many devices the branch holds, and narrows the map", () => {
    renderDrawer(true, 24);
    const button: HTMLElement = screen.getByTestId(
      "network-topology-show-only-branch",
    );
    expect(button).toHaveTextContent("Show only this branch");
    expect(
      screen.getByText(
        "Narrows the map to this device and the 24 devices below it.",
      ),
    ).toBeVisible();
    fireEvent.click(button);
    expect(onShowOnlyBranch).toHaveBeenCalledTimes(1);
  });

  test("one device below reads as one", () => {
    renderDrawer(true, 1);
    expect(
      screen.getByText(
        "Narrows the map to this device and the 1 device below it.",
      ),
    ).toBeVisible();
  });

  test("without the action from the map, the drawer offers nothing of the kind", () => {
    renderDrawer(false, 24);
    expect(
      screen.queryByTestId("network-topology-branch-actions"),
    ).not.toBeInTheDocument();
  });

  test("in German", async () => {
    await act(async () => {
      await i18next.changeLanguage("de");
    });
    renderDrawer(true, 24);
    expect(
      screen.getByTestId("network-topology-show-only-branch"),
    ).toHaveTextContent("Nur diesen Zweig anzeigen");
    expect(
      screen.getByText(
        "Zeigt auf der Karte nur dieses Gerät und die 24 Geräte darunter.",
      ),
    ).toBeVisible();
  });
});

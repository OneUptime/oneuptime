import "@testing-library/jest-dom";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { cleanup, render, screen, within } from "@testing-library/react";
import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import fs from "fs";
import path from "path";
import * as React from "react";
import PacketCaptureReadinessNotice from "../../../../App/FeatureSet/Dashboard/src/Components/PacketCapture/PacketCaptureReadinessNotice";
import StartPacketCaptureModal from "../../../../App/FeatureSet/Dashboard/src/Components/PacketCapture/StartPacketCaptureModal";
import { PacketCaptureReadiness } from "../../../../App/FeatureSet/Dashboard/src/Components/PacketCapture/PacketCaptureViewModel";
import ObjectID from "../../../Types/ObjectID";
import PacketCaptureCapabilityUtil, {
  PacketCaptureCapability,
} from "../../../Types/PacketCapture/PacketCaptureCapability";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";

/*
 * Packet capture in the reader's language, from the shipped locale files:
 * the notice that says why a probe cannot capture, and the Start form with
 * its warning, fields, limits summary and buttons. Japanese, which
 * translates every one of them; the BPF expressions, the settings and the
 * interface names stay as written - they are code.
 *
 * The Dashboard sets i18next up once, globally, with react-i18next; so does
 * this file. Each jest file has its own module registry, so it reaches no
 * other suite.
 */

const LOCALES_DIR: string = path.resolve(
  __dirname,
  "../../../../App/FeatureSet/Dashboard/src/Locales",
);

const JA: Record<string, string> = JSON.parse(
  fs.readFileSync(path.join(LOCALES_DIR, "ja.json"), "utf8"),
) as Record<string, string>;

function capability(): PacketCaptureCapability {
  return PacketCaptureCapabilityUtil.sanitize({
    isEnabled: true,
    isToolAvailable: true,
    interfaces: [
      { name: "any", addresses: [], isUp: true },
      { name: "eth0", addresses: ["10.0.0.2/24"], isUp: true },
    ],
    limits: {
      maxDurationInSeconds: 1800,
      maxPackets: 1000000,
      maxFileSizeInMB: 25,
    },
  }) as PacketCaptureCapability;
}

beforeAll(async () => {
  await i18next.use(initReactI18next).init({
    lng: "ja",
    fallbackLng: "ja",
    resources: { ja: { translation: JA } },
    interpolation: { escapeValue: false },
    keySeparator: false,
    nsSeparator: false,
  });
});

afterAll(async () => {
  await i18next.changeLanguage("en");
});

beforeEach(() => {
  jest.spyOn(ModelAPI, "create").mockResolvedValue({} as never);
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("in Japanese", () => {
  test("the notice says captures are off, and how to turn them on", () => {
    render(
      <PacketCaptureReadinessNotice
        readiness={PacketCaptureReadiness.TurnedOff}
      />,
    );

    expect(
      screen.getByText(JA["Packet capture is off on this probe"]!),
    ).toBeInTheDocument();
    expect(screen.getByText(JA["turns captures on"]!)).toBeInTheDocument();
    expect(
      screen.getByRole("link", {
        name: JA["How to turn on packet capture"]!,
      }),
    ).toBeInTheDocument();
    // The settings are code and stay as written.
    expect(
      screen.getByText("PROBE_PACKET_CAPTURE_ENABLED=true"),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("Packet capture is off on this probe"),
    ).not.toBeInTheDocument();
  });

  test("the Start form, its warning, its limits and its button", () => {
    render(
      <StartPacketCaptureModal
        probeId={new ObjectID("11111111-1111-4111-8111-111111111111")}
        capability={capability()}
        defaultHost="10.0.0.9"
        onClose={() => {}}
        onStarted={() => {}}
      />,
    );

    const modal: HTMLElement = screen.getByTestId("modal");

    expect(
      within(modal).getByText(JA["Start Packet Capture"]!),
    ).toBeInTheDocument();
    expect(
      within(modal).getByTestId("modal-footer-submit-button"),
    ).toHaveTextContent(JA["Start Capture"]!);
    expect(
      screen.getByTestId("packet-capture-sensitive-data"),
    ).toHaveTextContent(JA["A capture holds the traffic itself."]!);
    expect(
      within(modal).getByText(JA["All interfaces (any)"]!),
    ).toBeInTheDocument();
    expect(within(modal).getByText(JA["Host or network"]!)).toBeInTheDocument();
    expect(
      within(modal).getByText(
        "1 分、100,000 パケット、10 MB のいずれかに先に達した時点で停止します。",
      ),
    ).toBeInTheDocument();
    expect(
      within(modal).getByText(JA["Write a BPF filter instead"]!),
    ).toBeInTheDocument();

    // The expression is code, after the translated "Filter:".
    expect(
      screen.getByTestId("packet-capture-filter-preview"),
    ).toHaveTextContent(`${JA["Filter:"]!} host 10.0.0.9`);

    for (const english of [
      "Start Packet Capture",
      "A capture holds the traffic itself.",
      "Host or network",
      "Write a BPF filter instead",
    ]) {
      expect(within(modal).queryByText(english)).not.toBeInTheDocument();
    }
  });
});

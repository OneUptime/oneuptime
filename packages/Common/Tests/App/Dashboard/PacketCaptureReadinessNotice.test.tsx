import "@testing-library/jest-dom";
import { afterEach, describe, expect, test } from "@jest/globals";
import { cleanup, render, screen, within } from "@testing-library/react";
import * as React from "react";
import PacketCaptureReadinessNotice from "../../../../App/FeatureSet/Dashboard/src/Components/PacketCapture/PacketCaptureReadinessNotice";
import {
  PacketCaptureReadiness,
  PacketCaptureReadinessCopy,
  TURN_ON_SETTINGS,
} from "../../../../App/FeatureSet/Dashboard/src/Components/PacketCapture/PacketCaptureViewModel";

/*
 * Why a probe cannot capture yet, and what turns it on. Captures are the
 * probe operator's decision, so the notice never offers a switch: it says
 * what to set where the probe runs - the three settings, when they are what
 * is missing - and links to the docs section that shows them for Docker,
 * Docker Compose and Kubernetes.
 */

type NotReady = Exclude<PacketCaptureReadiness, PacketCaptureReadiness.Ready>;

const NOT_READY: Array<NotReady> = [
  PacketCaptureReadiness.GlobalProbe,
  PacketCaptureReadiness.NotReported,
  PacketCaptureReadiness.TurnedOff,
  PacketCaptureReadiness.NoTool,
  PacketCaptureReadiness.NoInterfaces,
];

afterEach(() => {
  cleanup();
});

describe("the readiness notice", () => {
  test.each(NOT_READY)(
    "%s says what it is and what to do",
    (readiness: NotReady) => {
      render(<PacketCaptureReadinessNotice readiness={readiness} />);

      const notice: HTMLElement = screen.getByTestId(
        "packet-capture-readiness",
      );

      expect(notice).toHaveAttribute("data-readiness", readiness);
      expect(
        within(notice).getByText(PacketCaptureReadinessCopy[readiness].title),
      ).toBeInTheDocument();
      expect(
        within(notice).getByText(PacketCaptureReadinessCopy[readiness].body),
      ).toBeInTheDocument();
    },
  );

  test.each(NOT_READY)(
    "%s lists the settings only where they are what is missing",
    (readiness: NotReady) => {
      render(<PacketCaptureReadinessNotice readiness={readiness} />);

      const settings: HTMLElement | null = screen.queryByTestId(
        "packet-capture-turn-on-settings",
      );

      if (!PacketCaptureReadinessCopy[readiness].showsTurnOnSettings) {
        expect(settings).not.toBeInTheDocument();
        return;
      }

      expect(settings).toBeInTheDocument();

      for (const setting of TURN_ON_SETTINGS) {
        expect(within(settings!).getByText(setting.code)).toBeInTheDocument();
        expect(
          within(settings!).getByText(setting.description),
        ).toBeInTheDocument();
      }
    },
  );

  test("captures that are off: the probe operator's three settings, and no switch", () => {
    render(
      <PacketCaptureReadinessNotice
        readiness={PacketCaptureReadiness.TurnedOff}
      />,
    );

    expect(
      screen.getByText("Packet capture is off on this probe"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("PROBE_PACKET_CAPTURE_ENABLED=true"),
    ).toBeInTheDocument();
    expect(screen.getByText("--network host")).toBeInTheDocument();
    expect(screen.getByText("--cap-add NET_RAW")).toBeInTheDocument();
    expect(screen.queryByRole("switch")).not.toBeInTheDocument();
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
  });

  test("links to the docs section on turning captures on, in a new tab", () => {
    render(
      <PacketCaptureReadinessNotice
        readiness={PacketCaptureReadiness.NotReported}
      />,
    );

    const link: HTMLElement = screen.getByRole("link", {
      name: "How to turn on packet capture",
    });

    expect(link.getAttribute("href")).toMatch(
      /\/probe\/packet-capture#turn-on-packet-capture$/,
    );
    expect(link).toHaveAttribute("target", "_blank");
  });
});

import "@testing-library/jest-dom";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import React from "react";

/*
 * The agents' install commands name this OneUptime as its settings name it
 * (HOST and HTTP_PROTOCOL): https://oneuptime.com on OneUptime Cloud, a
 * self-hosted install's own domain, port and scheme - never a hardcoded
 * oneuptime.com, and never GitHub. Every OneUptime serves its agents'
 * install scripts and files at /install/<agent> for its own release.
 *
 * Only the settings are stubbed; the URL, the upgrade guides and the dialog
 * are the real ones.
 */

jest.mock("../../../UI/Config", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "../../../UI/Config",
  ) as Record<string, unknown>;

  return {
    ...actual,
    __esModule: true,
    AppVersion: "14.0.14",
    HOST: "",
  };
});

import * as UIConfig from "../../../UI/Config";
import Protocol from "../../../Types/API/Protocol";
import { getConfiguredOneUptimeUrl } from "../../../../App/FeatureSet/Dashboard/src/Components/SetupGuide/ConfiguredOneUptimeUrl";
import { SETUP_GUIDE_URL_PLACEHOLDER } from "../../../../App/FeatureSet/Dashboard/src/Components/SetupGuide/SetupGuide";
import AgentVersion from "../../../../App/FeatureSet/Dashboard/src/Components/AgentVersion/AgentVersion";
import { AgentKind } from "../../../../App/FeatureSet/Dashboard/src/Components/AgentVersion/AgentKind";

/*
 * The component reads the settings off the (mocked) module when it runs, so
 * a test sets them by writing them there, as AgentVersion.test.tsx does.
 */
function setSettings(host: string, protocol: Protocol): void {
  const config: { HOST: string; HTTP_PROTOCOL: Protocol } =
    UIConfig as unknown as { HOST: string; HTTP_PROTOCOL: Protocol };
  config.HOST = host;
  config.HTTP_PROTOCOL = protocol;
}

afterEach(() => {
  cleanup();
  setSettings("", Protocol.HTTP);
});

function codeBlocks(element: HTMLElement): Array<string> {
  return Array.from(element.querySelectorAll("pre code")).map(
    (code: Element): string => {
      return (code.textContent || "").trim();
    },
  );
}

describe("this OneUptime's address, as its settings name it", () => {
  test.each([
    ["oneuptime.com", Protocol.HTTPS, "https://oneuptime.com"],
    ["test.oneuptime.com", Protocol.HTTPS, "https://test.oneuptime.com"],
    [
      "oneuptime.acme.internal:8443",
      Protocol.HTTPS,
      "https://oneuptime.acme.internal:8443",
    ],
    ["10.0.0.5", Protocol.HTTP, "http://10.0.0.5"],
    ["localhost:8080", Protocol.HTTP, "http://localhost:8080"],
  ])(
    "HOST %p over %p is %p",
    (host: string, protocol: Protocol, expected: string) => {
      setSettings(host, protocol);
      expect(getConfiguredOneUptimeUrl()).toBe(expected);
    },
  );

  test("a OneUptime that does not know its host says so, with the placeholder", () => {
    setSettings("", Protocol.HTTPS);
    expect(getConfiguredOneUptimeUrl()).toBe(SETUP_GUIDE_URL_PLACEHOLDER);
  });
});

describe("the upgrade dialog's commands", () => {
  async function openCephDialog(): Promise<HTMLElement> {
    render(<AgentVersion kind={AgentKind.CephAgent} version="0.154.0" />);
    fireEvent.click(
      screen.getByRole("button", {
        name: "Agent 0.154.0 is outdated. A newer agent is available: 0.161.0. Show how to upgrade.",
      }),
    );
    return screen.findByRole("dialog");
  }

  test("on a self-hosted domain, download from that domain", async () => {
    setSettings("oneuptime.acme.internal:8443", Protocol.HTTPS);
    const dialog: HTMLElement = await openCephDialog();

    expect(codeBlocks(dialog)).toEqual([
      "curl -fsSL https://oneuptime.acme.internal:8443/install/ceph-agent -o install.sh\nbash install.sh",
    ]);

    fireEvent.click(screen.getByRole("tab", { name: "Docker Compose" }));
    expect(codeBlocks(dialog)[0]).toBe(
      [
        "curl -fsSLO https://oneuptime.acme.internal:8443/install/ceph-agent/docker-compose.yml",
        "curl -fsSLO https://oneuptime.acme.internal:8443/install/ceph-agent/otel-collector-config.yaml",
      ].join("\n"),
    );
  });

  test("over plain HTTP, download over plain HTTP", async () => {
    setSettings("10.0.0.5", Protocol.HTTP);
    const dialog: HTMLElement = await openCephDialog();

    expect(codeBlocks(dialog)[0]).toBe(
      "curl -fsSL http://10.0.0.5/install/ceph-agent -o install.sh\nbash install.sh",
    );
  });

  test("on OneUptime Cloud, download from oneuptime.com, never GitHub", async () => {
    setSettings("oneuptime.com", Protocol.HTTPS);
    const dialog: HTMLElement = await openCephDialog();

    for (const block of codeBlocks(dialog)) {
      expect(block).not.toContain("githubusercontent");
    }
    expect(codeBlocks(dialog)[0]).toBe(
      "curl -fsSL https://oneuptime.com/install/ceph-agent -o install.sh\nbash install.sh",
    );
  });
});

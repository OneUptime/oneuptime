import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import * as React from "react";
import CustomProbeDocumentation, {
  CUSTOM_PROBE_SETUP_TEST_ID,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Probe/CustomProbeDocumentation";
import ObjectID from "../../../Types/ObjectID";

/*
 * The "Set up your Custom Probe" card on a probe's page: the commands that
 * run the probe, with its ID and key filled in.
 *
 * They were the card's description, which the card draws inside a <p>: a
 * code block (<pre>) and a heading (<h4>) inside a paragraph are invalid
 * HTML, and React warned of it on every visit. They are the card's body
 * now, the first command in view, and the same command through a proxy in
 * a fold - most probes reach OneUptime without one.
 */

const PROBE_ID: ObjectID = new ObjectID("4d0c1a5e-6b0c-4f4e-9d3a-2b1c0d9e8f71");
const PROBE_KEY: string = "probe-key-7f3a";

let consoleError: jest.SpiedFunction<typeof console.error>;

beforeEach(() => {
  consoleError = jest.spyOn(console, "error").mockImplementation(() => {
    return undefined;
  });
});

afterEach(() => {
  cleanup();
  consoleError.mockRestore();
});

function renderCard(): HTMLElement {
  render(<CustomProbeDocumentation probeKey={PROBE_KEY} probeId={PROBE_ID} />);

  return screen.getByTestId(CUSTOM_PROBE_SETUP_TEST_ID);
}

function nestingWarnings(): Array<string> {
  return consoleError.mock.calls
    .map((call: Array<unknown>): string => {
      return call.map(String).join(" ");
    })
    .filter((message: string): boolean => {
      return (
        message.includes("validateDOMNesting") ||
        message.includes("cannot be a descendant of") ||
        message.includes("cannot contain a nested")
      );
    });
}

describe("the custom probe setup card", () => {
  test("keeps its title, and says in one line what to do", () => {
    renderCard();

    expect(
      screen.getByRole("heading", { name: "Set up your Custom Probe" }),
    ).toBeInTheDocument();
    expect(screen.getByTestId("card-description")).toHaveTextContent(
      "Run this command where the probe should run. Its ID and key are already in it.",
    );
  });

  test("draws the commands in its body, never inside the description's paragraph", () => {
    const body: HTMLElement = renderCard();
    const description: HTMLElement = screen.getByTestId("card-description");

    expect(description.querySelector("pre")).toBeNull();
    expect(description.querySelector("h4")).toBeNull();
    expect(description.contains(body)).toBe(false);

    for (const paragraph of Array.from(document.querySelectorAll("p"))) {
      expect(paragraph.querySelector("pre, div, h1, h2, h3, h4")).toBeNull();
    }

    expect(nestingWarnings()).toEqual([]);
  });

  test("the first command runs this probe, with its ID and key", () => {
    const body: HTMLElement = renderCard();
    const firstCommand: HTMLElement | null = body.querySelector("pre");

    expect(firstCommand).not.toBeNull();
    expect(firstCommand!.textContent).toContain(
      `docker run --name oneuptime-probe --network host -e PROBE_KEY=${PROBE_KEY} -e PROBE_ID=${PROBE_ID.toString()}`,
    );
    expect(firstCommand!.textContent).toContain("-d oneuptime/probe:release");
  });

  test("links IPv6 to its section of the custom probe docs", () => {
    renderCard();

    const link: HTMLElement = screen.getByRole("link", {
      name: "Monitoring IPv6 destinations",
    });

    expect(new URL(link.getAttribute("href") || "", "http://x").hash).toBe(
      "#monitoring-ipv6-destinations",
    );
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
  });

  test("folds the proxy commands away until asked for", () => {
    const body: HTMLElement = renderCard();
    const fold: HTMLElement = screen.getByRole("button", {
      name: "Connecting through a proxy",
    });

    expect(fold).toHaveAttribute("aria-expanded", "false");
    expect(body.querySelectorAll("pre")).toHaveLength(2);

    fireEvent.click(fold);

    expect(fold).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText(/With HTTP\/HTTPS proxy/)).toBeVisible();
  });

  test("every line of a proxy command but the last ends with a backslash", () => {
    const body: HTMLElement = renderCard();
    const proxyCommands: string =
      Array.from(body.querySelectorAll("pre"))[1]?.textContent || "";

    for (const command of proxyCommands
      .split("docker run")
      .slice(1)
      .map((rest: string): Array<string> => {
        return `docker run${rest}`
          .split("\n")
          .map((line: string): string => {
            return line.trim();
          })
          .filter((line: string): boolean => {
            return line.length > 0 && !line.startsWith("#");
          });
      })) {
      expect(command[command.length - 1]).toBe("-d oneuptime/probe:release");

      for (const line of command.slice(0, -1)) {
        expect({ line, continued: line.endsWith("\\") }).toEqual({
          line,
          continued: true,
        });
      }

      expect(command.join(" ")).toContain(
        "-e NO_PROXY=localhost,.internal.example.com \\",
      );
    }
  });
});

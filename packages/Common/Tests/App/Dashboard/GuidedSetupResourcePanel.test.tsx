// UX rule: Docs/ux/README.md#a-products-first-page
import { afterEach, describe, expect, test } from "@jest/globals";
import "@testing-library/jest-dom";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import * as React from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";
import GuidedSetupResourcePanel, {
  GUIDED_SETUP_PANEL_COPY,
  GUIDED_SETUP_PANEL_TEST_IDS,
  GuidedSetupPanelGroup,
} from "../../../../App/FeatureSet/Dashboard/src/Components/GuidedSetup/GuidedSetupResourcePanel";
import {
  GuidedSetupRunSync,
  GuidedSetupStepState,
} from "../../../../App/FeatureSet/Dashboard/src/Components/GuidedSetup/GuidedSetupProgress";
import { GuidedSetupResourceRow } from "../../../../App/FeatureSet/Dashboard/src/Components/GuidedSetup/GuidedSetupResources";
import { GuidedSetupResourceStatus } from "../../../Types/GuidedSetup/GuidedSetupRun";
import Route from "../../../Types/API/Route";

/*
 * THE PANEL BESIDE A GUIDED SETUP'S STEPS (#10276): what the setup sets up,
 * each record under the step that makes it with how it is getting on -
 * waiting, being made, made or in use with Open, skipped, or failed with
 * why and Try again - then whether the run is saved to the person's account
 * (#7253) and about how long the setup takes.
 */

afterEach(() => {
  cleanup();
});

const row: (
  status: GuidedSetupResourceStatus,
  extra?: Partial<GuidedSetupResourceRow>,
) => GuidedSetupResourceRow = (
  status: GuidedSetupResourceStatus,
  extra: Partial<GuidedSetupResourceRow> = {},
): GuidedSetupResourceRow => {
  return {
    key: "monitor",
    stepKey: "check",
    kind: "Monitor",
    status: status,
    ...extra,
  };
};

const group: (
  resources: Array<GuidedSetupResourceRow>,
  state?: GuidedSetupStepState,
) => GuidedSetupPanelGroup = (
  resources: Array<GuidedSetupResourceRow>,
  state: GuidedSetupStepState = GuidedSetupStepState.Open,
): GuidedSetupPanelGroup => {
  return {
    stepKey: "check",
    outcome: "OneUptime checks your website or API around the clock.",
    state: state,
    resources: resources,
  };
};

describe("each record, by how it is getting on", () => {
  test("waiting: a hollow mark, and no chip - a screen reader still hears it", () => {
    render(
      <GuidedSetupResourcePanel
        groups={[group([row(GuidedSetupResourceStatus.Waiting)])]}
      />,
    );

    const status: HTMLElement = screen.getByTestId(
      "guided-setup-resource-monitor-status",
    );

    expect(status).toHaveTextContent("Waiting");
    expect(status.className).toContain("sr-only");
  });

  test("being made: its chip says so, with a dot that pulses", () => {
    render(
      <GuidedSetupResourcePanel
        groups={[
          group([
            row(GuidedSetupResourceStatus.Creating, { name: "acme.example" }),
          ]),
        ]}
      />,
    );

    expect(
      screen.getByTestId("guided-setup-resource-monitor-status"),
    ).toHaveTextContent("Creating…");
    expect(
      screen.getByTestId("guided-setup-resource-monitor-name"),
    ).toHaveTextContent("acme.example");
  });

  test("made: Created, with its detail and Open in a new tab, so the setup keeps its place", () => {
    render(
      <GuidedSetupResourcePanel
        groups={[
          group([
            row(GuidedSetupResourceStatus.Created, {
              name: "acme.example",
              detail: "Every 5 minutes",
              route: new Route("/dashboard/p/monitors/m-1"),
            }),
          ]),
        ]}
      />,
    );

    expect(
      screen.getByTestId("guided-setup-resource-monitor-status"),
    ).toHaveTextContent("Created");
    expect(
      screen.getByTestId("guided-setup-resource-monitor-detail"),
    ).toHaveTextContent("Every 5 minutes");

    const open: HTMLElement = screen.getByTestId(
      "guided-setup-resource-monitor-open",
    );

    expect(open).toHaveTextContent("Open");
    expect(open).toHaveAttribute("href", "/dashboard/p/monitors/m-1");
    expect(open).toHaveAttribute("target", "_blank");
    expect(open).toHaveAttribute("rel", "noopener noreferrer");
  });

  test("there already: In use", () => {
    render(
      <GuidedSetupResourcePanel
        groups={[group([row(GuidedSetupResourceStatus.Existing)])]}
      />,
    );

    expect(
      screen.getByTestId("guided-setup-resource-monitor-status"),
    ).toHaveTextContent("In use");
  });

  test("skipped: Skipped, and no Try again - the person chose it", () => {
    render(
      <GuidedSetupResourcePanel
        groups={[
          group([
            row(GuidedSetupResourceStatus.Skipped, {
              onRetry: () => {},
            }),
          ]),
        ]}
      />,
    );

    expect(
      screen.getByTestId("guided-setup-resource-monitor-status"),
    ).toHaveTextContent("Skipped");
    expect(
      screen.queryByTestId("guided-setup-resource-monitor-retry"),
    ).toBeNull();
  });

  test("failed: why, and Try again, which reruns the step's request", () => {
    const retry: MockFunction = getJestMockFunction();

    render(
      <GuidedSetupResourcePanel
        groups={[
          group([
            row(GuidedSetupResourceStatus.Failed, {
              error: "OneUptime is busy and could not save this.",
              onRetry: () => {
                retry();
              },
            }),
          ]),
        ]}
      />,
    );

    expect(
      screen.getByTestId("guided-setup-resource-monitor-status"),
    ).toHaveTextContent("Failed");
    expect(
      screen.getByTestId("guided-setup-resource-monitor-error"),
    ).toHaveTextContent("OneUptime is busy and could not save this.");

    fireEvent.click(screen.getByTestId("guided-setup-resource-monitor-retry"));

    expect(retry).toHaveBeenCalledTimes(1);
  });

  test("a word that says more than the status - a test page Sent, then Acknowledged", () => {
    const { rerender } = render(
      <GuidedSetupResourcePanel
        groups={[
          group([
            row(GuidedSetupResourceStatus.Creating, {
              key: "test_page",
              kind: "Test page",
              statusText: "Sent",
            }),
          ]),
        ]}
      />,
    );

    expect(
      screen.getByTestId("guided-setup-resource-test_page-status"),
    ).toHaveTextContent("Sent");

    rerender(
      <GuidedSetupResourcePanel
        groups={[
          group([
            row(GuidedSetupResourceStatus.Created, {
              key: "test_page",
              kind: "Test page",
              statusText: "Acknowledged",
            }),
          ]),
        ]}
      />,
    );

    expect(
      screen.getByTestId("guided-setup-resource-test_page-status"),
    ).toHaveTextContent("Acknowledged");
  });

  test("what a record is and how it is doing are said together, as either changes", () => {
    render(
      <GuidedSetupResourcePanel
        groups={[group([row(GuidedSetupResourceStatus.Created)])]}
      />,
    );

    const live: HTMLElement | null = screen
      .getByTestId("guided-setup-resource-monitor")
      .querySelector("[aria-live]");

    expect(live).toHaveAttribute("aria-live", "polite");
    expect(live).toHaveAttribute("aria-atomic", "true");
    expect(live).toHaveTextContent("MonitorCreated");
  });
});

describe("the panel's heading and its foot", () => {
  test("a landmark named for what it holds, counting what is ready", () => {
    render(
      <GuidedSetupResourcePanel
        groups={[
          group([
            row(GuidedSetupResourceStatus.Created),
            row(GuidedSetupResourceStatus.Waiting, { key: "policy" }),
          ]),
        ]}
      />,
    );

    const panel: HTMLElement = screen.getByTestId(
      GUIDED_SETUP_PANEL_TEST_IDS.panel,
    );

    expect(panel.tagName).toBe("ASIDE");
    expect(panel).toHaveAttribute("aria-label", GUIDED_SETUP_PANEL_COPY.title);
    expect(
      screen.getByTestId(GUIDED_SETUP_PANEL_TEST_IDS.ready),
    ).toHaveTextContent("1 of 2 ready");
    expect(panel).toHaveTextContent(GUIDED_SETUP_PANEL_COPY.description);
  });

  test("a setup that lists no records says its outcomes alone, with no count", () => {
    render(<GuidedSetupResourcePanel groups={[group([])]} minutes={3} />);

    expect(screen.queryByTestId(GUIDED_SETUP_PANEL_TEST_IDS.ready)).toBeNull();
    expect(screen.getByTestId("guided-setup-outcome-check")).toHaveTextContent(
      "OneUptime checks your website or API around the clock.",
    );
    expect(
      screen.getByTestId(GUIDED_SETUP_PANEL_TEST_IDS.minutes),
    ).toHaveTextContent(/^About 3\sminutes$/);
  });

  test("where the run stands with the server, each way it can", () => {
    const words: Record<GuidedSetupRunSync, string> = {
      [GuidedSetupRunSync.Idle]:
        "Your progress is saved to your account as you go, so you can pick up on any device.",
      [GuidedSetupRunSync.Saving]: "Saving your progress…",
      [GuidedSetupRunSync.Saved]:
        "Saved to your account. Pick up where you left off on any device.",
      [GuidedSetupRunSync.NotSaved]:
        "Not saved to your account yet: OneUptime could not be reached. This browser keeps your progress until it can.",
    };

    for (const sync of Object.values(GuidedSetupRunSync)) {
      render(<GuidedSetupResourcePanel groups={[group([])]} sync={sync} />);

      const line: HTMLElement = screen.getByTestId(
        GUIDED_SETUP_PANEL_TEST_IDS.sync,
      );

      expect(line).toHaveAttribute("data-sync", sync);
      expect(line).toHaveTextContent(words[sync]);
      expect(line).toHaveAttribute("aria-live", "polite");
      cleanup();
    }
  });

  test("not saved: Try again sends it once more", () => {
    const retry: MockFunction = getJestMockFunction();

    render(
      <GuidedSetupResourcePanel
        groups={[group([])]}
        sync={GuidedSetupRunSync.NotSaved}
        onRetrySync={() => {
          retry();
        }}
      />,
    );

    fireEvent.click(screen.getByTestId(GUIDED_SETUP_PANEL_TEST_IDS.syncRetry));

    expect(retry).toHaveBeenCalledTimes(1);
  });

  test("saved, or saving: nothing to try again", () => {
    render(
      <GuidedSetupResourcePanel
        groups={[group([])]}
        sync={GuidedSetupRunSync.Saved}
        onRetrySync={() => {}}
      />,
    );

    expect(
      screen.queryByTestId(GUIDED_SETUP_PANEL_TEST_IDS.syncRetry),
    ).toBeNull();
  });

  test("a setup that says nothing of the server or the time has no foot", () => {
    render(<GuidedSetupResourcePanel groups={[group([])]} />);

    expect(screen.queryByTestId(GUIDED_SETUP_PANEL_TEST_IDS.sync)).toBeNull();
    expect(
      screen.queryByTestId(GUIDED_SETUP_PANEL_TEST_IDS.minutes),
    ).toBeNull();
  });
});

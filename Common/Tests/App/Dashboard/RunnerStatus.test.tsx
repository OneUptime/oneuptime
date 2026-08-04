import "@testing-library/jest-dom";
import { render, screen } from "@testing-library/react";
import React from "react";
import { describe, expect, test } from "@jest/globals";
import RunnerStatusElement from "../../../../App/FeatureSet/Dashboard/src/Components/Runner/RunnerStatus";
import Runner, {
  RunnerConnectionStatus,
} from "../../../Models/DatabaseModels/Runner";
import OneUptimeDate from "../../../Types/Date";
import { JSONObject } from "../../../Types/JSON";

/*
 * The one component every Runner connection indicator in the dashboard now
 * renders through. Three call sites used to hand-roll this, and all three read
 * the persisted connectionStatus column — which is written on create and on
 * the first heartbeat and never again. A Runner that died months ago still has
 * it set to "connected".
 *
 * So the assertions that matter most here are the ones proving the rendered
 * status tracks lastAlive and IGNORES connectionStatus, in both directions.
 */

type RenderRunnerFunction = (
  runner: Runner | JSONObject,
  showLastSeen?: boolean,
) => void;

const renderRunner: RenderRunnerFunction = (
  runner: Runner | JSONObject,
  showLastSeen?: boolean,
): void => {
  render(
    showLastSeen === undefined ? (
      <RunnerStatusElement runner={runner} />
    ) : (
      <RunnerStatusElement runner={runner} showLastSeen={showLastSeen} />
    ),
  );
};

type MinutesAgoFunction = (minutes: number) => Date;

const minutesAgo: MinutesAgoFunction = (minutes: number): Date => {
  return OneUptimeDate.getSomeMinutesAgo(minutes);
};

type StatusTextFunction = () => string;

/*
 * Statusbubble renders role="status" with aria-label "Status: <text>", so the
 * accessible name is the assertion surface — it is what a screen reader
 * announces, not just what happens to be in a div.
 */
const statusText: StatusTextFunction = (): string => {
  return screen.getByRole("status").getAttribute("aria-label") || "";
};

describe("RunnerStatusElement", () => {
  describe("never connected", () => {
    test("a Runner with no lastAlive reads 'Never connected'", () => {
      renderRunner({ lastAlive: null });

      expect(screen.getByText("Never connected")).toBeInTheDocument();
      expect(statusText()).toBe("Status: Never connected");
    });

    test("a Runner with lastAlive absent entirely reads 'Never connected'", () => {
      renderRunner({});

      expect(screen.getByText("Never connected")).toBeInTheDocument();
    });

    /*
     * The whole point of the third state. A Runner created ten seconds ago
     * whose container has not been started is not a failure, and must not be
     * dressed as one — it used to render the same red "Disconnected" as a
     * Runner that crashed in production.
     */
    test("it is not called Disconnected", () => {
      renderRunner({ lastAlive: null });

      expect(screen.queryByText("Disconnected")).not.toBeInTheDocument();
      expect(statusText()).not.toContain("Disconnected");
    });

    test("it is grey, not red", () => {
      const { container } = render(
        <RunnerStatusElement runner={{ lastAlive: null }} />,
      );

      const html: string = container.innerHTML;

      // Gray500 #6b7280, Red #fd625e.
      expect(html).toContain("107, 114, 128");
      expect(html).not.toContain("253, 98, 94");
    });

    test("it does not animate", () => {
      const { container } = render(
        <RunnerStatusElement runner={{ lastAlive: null }} />,
      );

      expect(container.innerHTML).not.toContain("animate-ping");
    });
  });

  describe("connected", () => {
    test("a heartbeat right now reads 'Connected'", () => {
      renderRunner({ lastAlive: OneUptimeDate.getCurrentDate() });

      expect(screen.getByText("Connected")).toBeInTheDocument();
      expect(statusText()).toBe("Status: Connected");
    });

    test("a heartbeat four minutes ago still reads 'Connected'", () => {
      renderRunner({ lastAlive: minutesAgo(4) });

      expect(screen.getByText("Connected")).toBeInTheDocument();
    });

    test("it is green and animating", () => {
      const { container } = render(
        <RunnerStatusElement
          runner={{ lastAlive: OneUptimeDate.getCurrentDate() }}
        />,
      );

      // Green #2ab57d.
      expect(container.innerHTML).toContain("42, 181, 125");
      expect(container.innerHTML).toContain("animate-ping");
    });
  });

  describe("disconnected", () => {
    test("a heartbeat an hour ago reads 'Disconnected'", () => {
      renderRunner({ lastAlive: minutesAgo(60) });

      expect(statusText()).toContain("Disconnected");
    });

    /*
     * "How long has it been gone" is the entire question when a Runner drops,
     * and the detail card has no other column carrying it.
     */
    test("it appends how long ago the last heartbeat was", () => {
      renderRunner({ lastAlive: minutesAgo(60) });

      expect(statusText()).toBe("Status: Disconnected · an hour ago");
    });

    test("a day-old heartbeat says a day ago", () => {
      renderRunner({ lastAlive: minutesAgo(60 * 24) });

      expect(statusText()).toBe("Status: Disconnected · a day ago");
    });

    /*
     * In the Runners table a Last Seen column sits directly beside this one,
     * so repeating the relative time would be noise.
     */
    test("showLastSeen={false} suppresses the relative time", () => {
      renderRunner({ lastAlive: minutesAgo(60) }, false);

      expect(statusText()).toBe("Status: Disconnected");
    });

    test("showLastSeen={true} is the same as the default", () => {
      renderRunner({ lastAlive: minutesAgo(60) }, true);

      expect(statusText()).toBe("Status: Disconnected · an hour ago");
    });

    test("it is red and does not animate", () => {
      const { container } = render(
        <RunnerStatusElement runner={{ lastAlive: minutesAgo(60) }} />,
      );

      // Red #fd625e.
      expect(container.innerHTML).toContain("253, 98, 94");
      expect(container.innerHTML).not.toContain("animate-ping");
    });
  });

  /*
   * The regression suite. Each of these is a shape the old inline
   * implementations got wrong.
   */
  describe("connectionStatus is ignored", () => {
    test("stale lastAlive reads Disconnected even when connectionStatus says Connected", () => {
      renderRunner({
        connectionStatus: RunnerConnectionStatus.Connected,
        lastAlive: minutesAgo(60 * 24 * 90),
      });

      expect(statusText()).toContain("Disconnected");
      expect(screen.queryByText("Connected")).not.toBeInTheDocument();
    });

    test("fresh lastAlive reads Connected even when connectionStatus says Disconnected", () => {
      renderRunner({
        connectionStatus: RunnerConnectionStatus.Disconnected,
        lastAlive: OneUptimeDate.getCurrentDate(),
      });

      expect(statusText()).toBe("Status: Connected");
    });

    /*
     * Exactly what RunnerService.onBeforeCreate produces: connectionStatus
     * defaulted to Disconnected, lastAlive still null. The user has not
     * failed at anything yet — they have not run the Docker command.
     */
    test("a freshly created Runner reads Never connected, not Disconnected", () => {
      renderRunner({
        connectionStatus: RunnerConnectionStatus.Disconnected,
        lastAlive: null,
      });

      expect(statusText()).toBe("Status: Never connected");
    });

    test("connectionStatus alone never produces a Connected bubble", () => {
      renderRunner({ connectionStatus: RunnerConnectionStatus.Connected });

      expect(statusText()).toBe("Status: Never connected");
    });
  });

  describe("input shapes", () => {
    /*
     * The table hands over a hydrated model; ModelDetail's getElement hands
     * over the same. The API layer hands over a plain object with an ISO
     * string. All three have to work.
     */
    test("accepts a hydrated Runner model", () => {
      const runner: Runner = new Runner();
      runner.lastAlive = OneUptimeDate.getCurrentDate();

      renderRunner(runner);

      expect(statusText()).toBe("Status: Connected");
    });

    test("accepts a hydrated Runner model that never connected", () => {
      renderRunner(new Runner());

      expect(statusText()).toBe("Status: Never connected");
    });

    test("accepts an ISO string lastAlive", () => {
      renderRunner({ lastAlive: new Date().toISOString() });

      expect(statusText()).toBe("Status: Connected");
    });

    test("accepts a stale ISO string lastAlive", () => {
      renderRunner({ lastAlive: minutesAgo(60).toISOString() });

      expect(statusText()).toContain("Disconnected");
    });

    /*
     * An unparseable timestamp must not be rendered as a healthy Runner. It
     * falls to Disconnected, and the appended relative time is suppressed
     * rather than printed as "Invalid date".
     */
    test("an unparseable lastAlive is Disconnected and prints no garbage time", () => {
      renderRunner({ lastAlive: "not-a-date" });

      expect(statusText()).toContain("Disconnected");
      expect(statusText()).not.toContain("Invalid");
    });
  });
});

import "@testing-library/jest-dom";
import { render, screen } from "@testing-library/react";
import React from "react";
import { describe, expect, test } from "@jest/globals";
import RunnerInstallInstructions from "../../../../App/FeatureSet/Dashboard/src/Components/Runner/InstallInstructions";
import ObjectID from "../../../Types/ObjectID";

/*
 * The setup card renders the docker run command with the Runner's secret key
 * embedded in it. Reading that key is restricted to Project Owner, Project
 * Admin and Runbook Admin (see the ColumnAccessControl on Runner.key), so for
 * a Member or a Viewer the field simply is not in the API response.
 *
 * The Runners table asked for the key and passed `(item.key as string) || ""`
 * straight through, so those users were handed a command ending in
 * ONEUPTIME_RUNNER_KEY= with nothing after it — which copies cleanly, runs on
 * the host, and fails there with an authentication error. These tests pin that
 * no command is ever rendered without a key.
 */

const RUNNER_ID: ObjectID = new ObjectID("abc-123");

type RenderWithKeyFunction = (key: string) => HTMLElement;

const renderWithKey: RenderWithKeyFunction = (key: string): HTMLElement => {
  const { container } = render(
    <RunnerInstallInstructions runnerId={RUNNER_ID} runnerKey={key} />,
  );

  return container;
};

describe("RunnerInstallInstructions", () => {
  describe("when the key is readable", () => {
    test("renders the docker run command", () => {
      const container: HTMLElement = renderWithKey("super-secret-key");

      expect(container.textContent).toContain("docker run");
      expect(container.textContent).toContain("oneuptime/runner:release");
    });

    test("embeds the Runner id and key", () => {
      const container: HTMLElement = renderWithKey("super-secret-key");

      expect(container.textContent).toContain("ONEUPTIME_RUNNER_ID=abc-123");
      expect(container.textContent).toContain(
        "ONEUPTIME_RUNNER_KEY=super-secret-key",
      );
    });

    test("does not render the permission warning", () => {
      renderWithKey("super-secret-key");

      expect(
        screen.queryByText(/do not have permission/i),
      ).not.toBeInTheDocument();
    });

    /*
     * The container needs outbound HTTPS only; saying so here is what stops
     * someone opening an inbound hole for it.
     */
    test("states that the Runner needs no inbound connections", () => {
      const container: HTMLElement = renderWithKey("super-secret-key");

      expect(container.textContent).toContain(
        "does not accept inbound connections",
      );
    });

    /*
     * Added because "I ran the command and it still says Never connected" is
     * the obvious next confusion once the never-connected state exists.
     */
    test("explains that the first heartbeat takes up to a minute", () => {
      const container: HTMLElement = renderWithKey("super-secret-key");

      expect(container.textContent).toContain("every 60 seconds");
      expect(container.textContent).toContain("Connected");
    });
  });

  describe("when the key is not readable", () => {
    test("renders the permission warning instead", () => {
      renderWithKey("");

      expect(
        screen.getByText(
          "You do not have permission to view this Runner's key",
        ),
      ).toBeInTheDocument();
    });

    /*
     * The load-bearing assertion: no command at all, rather than a command
     * that is silently broken.
     */
    test("renders no docker command at all", () => {
      const container: HTMLElement = renderWithKey("");

      expect(container.textContent).not.toContain("docker run");
      expect(container.textContent).not.toContain("ONEUPTIME_RUNNER_KEY");
    });

    test("never emits an empty ONEUPTIME_RUNNER_KEY=", () => {
      const container: HTMLElement = renderWithKey("");

      expect(container.textContent).not.toMatch(/ONEUPTIME_RUNNER_KEY=\s/);
    });

    test("says who can supply the command", () => {
      const container: HTMLElement = renderWithKey("");

      expect(container.textContent).toContain("Project Owner");
      expect(container.textContent).toContain("Project Admin");
      expect(container.textContent).toContain("Runbook Admin");
    });
  });
});

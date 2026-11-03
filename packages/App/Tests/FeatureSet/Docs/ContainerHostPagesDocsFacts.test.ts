import { describe, expect, test } from "@jest/globals";
import { readPage } from "./DocsContentSupport";
import {
  CONTAINER_FORGOTTEN_AFTER_MINUTES,
  CONTAINER_LONG_RUNNING_MS,
  CONTAINER_MEMORY_WARNING_PERCENT,
  CONTAINER_RESTART_LOOP_RESTARTS,
  CONTAINER_RESTART_WINDOW_MINUTES,
} from "../../../FeatureSet/Dashboard/src/Components/ContainerHost/ContainerHostHealth";

/*
 * The Docker and Podman agent pages' "What the host's pages show"
 * (telemetry/docker-host and telemetry/podman-host) say the rules the
 * host's pages judge containers by (Components/ContainerHost/
 * ContainerHostHealth): change a line there, and these words go stale. The
 * translations hold the same numbers line for line
 * (InfrastructureAgentDocsTranslations).
 */

const PAGES: Array<string> = ["telemetry/docker-host", "telemetry/podman-host"];

function section(page: string): string {
  const text: string = readPage("en", page);
  const start: number = text.indexOf("## What the host's pages show");
  expect(start).toBeGreaterThan(-1);
  const end: number = text.indexOf("\n## ", start + 1);
  return text.slice(start, end);
}

describe.each(PAGES)("%s: what the host's pages show", (page: string) => {
  test("sits after What the agent collects, before the log driver section", () => {
    const text: string = readPage("en", page);
    const collects: number = text.indexOf("## What the agent collects");
    const pages: number = text.indexOf("## What the host's pages show");
    const logs: number = text.indexOf("## Container logs need the");
    expect(collects).toBeGreaterThan(-1);
    expect(pages).toBeGreaterThan(collects);
    expect(logs).toBeGreaterThan(pages);
  });

  test("says the restart loop's line as the rules draw it", () => {
    expect(section(page)).toContain(
      `restarted more than ${CONTAINER_RESTART_LOOP_RESTARTS} times in ${CONTAINER_RESTART_WINDOW_MINUTES} minutes is in a restart loop`,
    );
  });

  test("says the memory line and the stopped service's run as the rules draw them", () => {
    const text: string = section(page);
    expect(text).toContain(
      `uses more than ${CONTAINER_MEMORY_WARNING_PERCENT}% of its memory`,
    );
    expect(text).toContain(
      `ran for ${CONTAINER_LONG_RUNNING_MS / 60000} minutes or more and then stopped reporting`,
    );
  });

  test("says how long a stopped container stays listed", () => {
    expect(section(page)).toContain(
      `stays listed for ${CONTAINER_FORGOTTEN_AFTER_MINUTES} minutes after its last reading`,
    );
  });

  test("names the Dashboard's own words, in bold", () => {
    const text: string = section(page);
    for (const label of [
      "**Overview**",
      "**Needs attention**",
      "**Containers**",
      "**Stopped reporting**",
      "**Not reporting**",
    ]) {
      expect({ label, found: text.includes(label) }).toEqual({
        label,
        found: true,
      });
    }
  });

  test("says what the agent cannot see: stopped containers, exit codes, health checks", () => {
    expect(section(page)).toContain(
      "a container that was already stopped when the agent started, an exit code and a health check's verdict do not show",
    );
  });
});

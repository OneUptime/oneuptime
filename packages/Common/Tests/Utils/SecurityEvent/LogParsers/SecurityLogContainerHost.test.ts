import { describe, expect, test } from "@jest/globals";
import { JSONObject } from "../../../../Types/JSON";
import NormalizedSecurityEvent from "../../../../Types/SecurityEvent/NormalizedSecurityEvent";
import {
  SECURITY_LOG_DOCKER_HOST_ATTRIBUTE,
  SECURITY_LOG_PODMAN_HOST_ATTRIBUTE,
  SECURITY_LOG_RESOURCE_ID_ATTRIBUTE,
  SECURITY_LOG_RESOURCE_TYPE_ATTRIBUTE,
} from "../../../../Types/SecurityCase/SecurityConnection";
import ServiceType from "../../../../Types/Telemetry/ServiceType";
import SecurityLogParser from "../../../../Utils/SecurityEvent/LogParsers/SecurityLogParser";
import { readLogContainerHost } from "../../../../Utils/SecurityEvent/LogParsers/SecurityLogLine";
import { SSH_LINES, WEB_LINES, logLine } from "./LogParserFixtures";

/*
 * A DOCKER OR PODMAN HOST'S OWN SECURITY EVENTS (#9628).
 *
 * A container's logs are filed under the container's own service, so the
 * log resource an event carries names the service, never the host it ran
 * on. The host's Logs page reads its containers' lines by the host name the
 * agent stamps on each (resource.host.name, beside resource.container.runtime),
 * and every event read from such a line carries that host name under its
 * runtime's attribute, which puts it on the host's Security Events page.
 */

const SERVICE_ID: string = "0192f1a0-0000-7000-8000-0000000000aa";

// A container's line as the Docker or Podman agent sends it.
function containerLine(
  body: string,
  runtime: string,
  host: string = "build-1",
  attributes: JSONObject = {},
): Array<NormalizedSecurityEvent> {
  return SecurityLogParser.parse({
    ...logLine(body, {
      "resource.host.name": host,
      "resource.container.runtime": runtime,
      "resource.container.name": "nginx",
      ...attributes,
    }),
    resourceId: SERVICE_ID,
    resourceType: ServiceType.OpenTelemetry,
  });
}

describe("readLogContainerHost", () => {
  test("a Docker container's line names its Docker host", () => {
    expect(
      readLogContainerHost({
        "resource.host.name": "build-1",
        "resource.container.runtime": "docker",
      }),
    ).toEqual({ [SECURITY_LOG_DOCKER_HOST_ATTRIBUTE]: "build-1" });
  });

  test("a Podman container's line names its Podman host", () => {
    expect(
      readLogContainerHost({
        "resource.host.name": "edge-1",
        "resource.container.runtime": "podman",
      }),
    ).toEqual({ [SECURITY_LOG_PODMAN_HOST_ATTRIBUTE]: "edge-1" });
  });

  test("reads the attributes a line sent without the resource prefix, and any casing of the runtime", () => {
    expect(
      readLogContainerHost({
        "host.name": "build-1",
        "container.runtime": "Docker",
      }),
    ).toEqual({ [SECURITY_LOG_DOCKER_HOST_ATTRIBUTE]: "build-1" });
  });

  test("trims the host name", () => {
    expect(
      readLogContainerHost({
        "resource.host.name": "  build-1  ",
        "resource.container.runtime": "docker",
      }),
    ).toEqual({ [SECURITY_LOG_DOCKER_HOST_ATTRIBUTE]: "build-1" });
  });

  test.each([
    ["no runtime: a host's own line", { "resource.host.name": "web-1" }],
    [
      "another runtime",
      {
        "resource.host.name": "node-1",
        "resource.container.runtime": "containerd",
      },
    ],
    [
      "a runtime that only starts like one",
      {
        "resource.host.name": "node-1",
        "resource.container.runtime": "docker-desktop",
      },
    ],
    ["no host name", { "resource.container.runtime": "docker" }],
    [
      "an empty host name",
      { "resource.host.name": " ", "resource.container.runtime": "docker" },
    ],
    [
      "a runtime named like an object's own property",
      {
        "resource.host.name": "build-1",
        "resource.container.runtime": "constructor",
      },
    ],
  ])(
    "names no container host for %s",
    (_case: string, attributes: JSONObject) => {
      expect(readLogContainerHost(attributes)).toEqual({});
    },
  );

  test("names none for a line with no attributes", () => {
    expect(readLogContainerHost(undefined)).toEqual({});
    expect(readLogContainerHost(null)).toEqual({});
  });
});

describe("an event read from a container's line carries its host", () => {
  test.each([
    ["a SQL injection in an access log", WEB_LINES.sqlInjectionEncoded],
    ["a path traversal in an access log", WEB_LINES.pathTraversal],
    ["a failed SSH sign-in", SSH_LINES.failedPasswordInvalidUser],
  ])("%s on a Docker host", (_case: string, body: string) => {
    const events: Array<NormalizedSecurityEvent> = containerLine(
      body,
      "docker",
    );

    expect(events.length).toBeGreaterThan(0);

    for (const event of events) {
      expect(event.attributes[SECURITY_LOG_DOCKER_HOST_ATTRIBUTE]).toBe(
        "build-1",
      );
      expect(event.attributes[SECURITY_LOG_PODMAN_HOST_ATTRIBUTE]).toBe(
        undefined,
      );
    }
  });

  test("on a Podman host, under Podman's attribute", () => {
    const events: Array<NormalizedSecurityEvent> = containerLine(
      WEB_LINES.sqlInjectionEncoded,
      "podman",
      "edge-1",
    );

    expect(events.length).toBeGreaterThan(0);
    expect(events[0]!.attributes[SECURITY_LOG_PODMAN_HOST_ATTRIBUTE]).toBe(
      "edge-1",
    );
    expect(events[0]!.attributes[SECURITY_LOG_DOCKER_HOST_ATTRIBUTE]).toBe(
      undefined,
    );
  });

  test("keeps the service the line was filed under too", () => {
    const event: NormalizedSecurityEvent = containerLine(
      WEB_LINES.sqlInjectionEncoded,
      "docker",
    )[0]!;

    expect(event.attributes[SECURITY_LOG_RESOURCE_ID_ATTRIBUTE]).toBe(
      SERVICE_ID,
    );
    expect(event.attributes[SECURITY_LOG_RESOURCE_TYPE_ATTRIBUTE]).toBe(
      ServiceType.OpenTelemetry,
    );
  });

  test("names the host in its attributes, never among what the event names", () => {
    const event: NormalizedSecurityEvent = containerLine(
      WEB_LINES.sqlInjectionEncoded,
      "docker",
      "build-1",
    )[0]!;

    expect(event.observables).not.toContain("build-1");
  });

  test("a line of no container carries no container host", () => {
    const events: Array<NormalizedSecurityEvent> = SecurityLogParser.parse(
      logLine(WEB_LINES.sqlInjectionEncoded, { "host.name": "web-1" }),
    );

    expect(events.length).toBeGreaterThan(0);
    expect(events[0]!.attributes[SECURITY_LOG_DOCKER_HOST_ATTRIBUTE]).toBe(
      undefined,
    );
    expect(events[0]!.attributes[SECURITY_LOG_PODMAN_HOST_ATTRIBUTE]).toBe(
      undefined,
    );
  });
});

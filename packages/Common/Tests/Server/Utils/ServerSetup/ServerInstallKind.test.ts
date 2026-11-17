import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import yaml from "js-yaml";
import {
  DOCKER_COMPOSE_INSTALL_MARK,
  getServerInstallKind,
} from "../../../../Server/Utils/ServerSetup/ServerInstallKind";
import { ServerInstallKind } from "../../../../Types/ServerSetup/ServerSetupChecklist";

/*
 * HOW THE SERVER KNOWS HOW IT WAS INSTALLED (#9378).
 *
 * Server Setup's "How to back up" sent a Kubernetes install to the Docker
 * Compose steps (npm run backup), which it cannot run. The server now tells
 * the two apart by a sign only each gives - Kubernetes' own address in every
 * pod, or the Helm chart's POD_NAME; Docker Compose's INSTALLED_WITH - and
 * says unknown, never a guess, when it has neither or both.
 */

const REPOSITORY: string = path.join(__dirname, "../../../../../..");

describe("how the server was installed", () => {
  test("in a Kubernetes pod: Kubernetes, from the address every pod is handed or the chart's POD_NAME", () => {
    expect(getServerInstallKind({ KUBERNETES_SERVICE_HOST: "10.96.0.1" })).toBe(
      ServerInstallKind.Kubernetes,
    );
    expect(
      getServerInstallKind({ POD_NAME: "oneuptime-app-6d4f8b9c7d-x2k9p" }),
    ).toBe(ServerInstallKind.Kubernetes);
  });

  test("with Docker Compose's mark: Docker Compose", () => {
    expect(getServerInstallKind({ INSTALLED_WITH: "docker-compose" })).toBe(
      ServerInstallKind.DockerCompose,
    );
    expect(getServerInstallKind({ INSTALLED_WITH: " Docker-Compose " })).toBe(
      ServerInstallKind.DockerCompose,
    );
  });

  test("neither, both, or a mark it does not know: unknown - never a guess", () => {
    expect(getServerInstallKind({})).toBe(ServerInstallKind.Unknown);
    // A docker-compose.yml from before the mark, or the images run by hand.
    expect(getServerInstallKind({ HOSTNAME: "a1b2c3d4e5f6" })).toBe(
      ServerInstallKind.Unknown,
    );
    expect(
      getServerInstallKind({
        INSTALLED_WITH: "docker-compose",
        KUBERNETES_SERVICE_HOST: "10.96.0.1",
      }),
    ).toBe(ServerInstallKind.Unknown);
    expect(getServerInstallKind({ INSTALLED_WITH: "podman" })).toBe(
      ServerInstallKind.Unknown,
    );
    expect(getServerInstallKind({ KUBERNETES_SERVICE_HOST: "  " })).toBe(
      ServerInstallKind.Unknown,
    );
  });

  test("Docker Compose sets its mark on the app, and on nothing else", () => {
    const base: {
      services: Record<string, { environment?: Record<string, unknown> }>;
    } = yaml.load(
      fs.readFileSync(path.join(REPOSITORY, "docker-compose.base.yml"), "utf8"),
    ) as {
      services: Record<string, { environment?: Record<string, unknown> }>;
    };

    expect(
      base.services["app"]!.environment![DOCKER_COMPOSE_INSTALL_MARK.name],
    ).toBe(DOCKER_COMPOSE_INSTALL_MARK.value);

    const marked: Array<string> = Object.keys(base.services).filter(
      (name: string): boolean => {
        return Boolean(
          base.services[name]!.environment?.[DOCKER_COMPOSE_INSTALL_MARK.name],
        );
      },
    );

    expect(marked).toEqual(["app"]);
    // And docker-compose.yml's app is the base's.
    expect(
      fs.readFileSync(path.join(REPOSITORY, "docker-compose.yml"), "utf8"),
    ).toMatch(
      /\n {2}app:\n(?: {4}.*\n)*? {4}extends:\n {6}file: \.\/docker-compose\.base\.yml\n {6}service: app\n/,
    );
  });

  test("the Helm chart's app pod is handed POD_NAME, the sign the server reads", () => {
    const helpers: string = fs.readFileSync(
      path.join(
        REPOSITORY,
        "HelmChart/Public/oneuptime/templates/_helpers.tpl",
      ),
      "utf8",
    );
    const app: string = fs.readFileSync(
      path.join(REPOSITORY, "HelmChart/Public/oneuptime/templates/app.yaml"),
      "utf8",
    );

    expect(app).toContain('include "oneuptime.env.telemetryIdentity"');
    expect(helpers).toMatch(
      /define "oneuptime\.env\.telemetryIdentity"[\s\S]*?include "oneuptime\.env\.pod"/,
    );
    expect(helpers).toMatch(
      /define "oneuptime\.env\.pod"[\s\S]*?- name: POD_NAME\n/,
    );
    // Nothing in the chart says Docker Compose.
    expect(app).not.toContain(DOCKER_COMPOSE_INSTALL_MARK.name);
    expect(helpers).not.toContain(DOCKER_COMPOSE_INSTALL_MARK.name);
  });
});

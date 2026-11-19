"use strict";

/**
 * Docker Compose hands config.env's NGINX_HTTP2 to the ingress (#9846).
 *
 * The ingress turns HTTP/2 off for HOST when NGINX_HTTP2 is off
 * (packages/Nginx/envsubst-on-templates.sh; PrimaryServerHttp2.test.js holds
 * it). On Docker Compose the setting is a line of config.env, which
 * docker-compose.base.yml's ingress service passes on, and the stacks
 * OneUptime starts take their ingress from there through `extends`. So:
 *
 *   - config.example.env ships it on, and a config.env made from it gives
 *     the ingress "on";
 *   - a config.env from before the setting, which `npm run update` has not
 *     merged yet, gives "on" too, and Compose warns of nothing
 *     (${NGINX_HTTP2:-on});
 *   - off in config.env reaches the ingress as off, in every stack, and no
 *     other service gets the setting.
 *
 * Read from `docker compose config` where the Docker CLI is installed (the
 * Ops Config Test workflow has it), and from the files themselves elsewhere.
 */

const path = require("path");
const { spawnSync } = require("child_process");
const {
  REPO_ROOT,
  configExampleSettings,
  hasDockerCompose,
  readCompose,
  renderCompose,
} = require("./Utils/ComposePorts");

const SETTING = "NGINX_HTTP2";

// The stacks OneUptime starts, as `npm start` and `npm run dev` name them.
const STACKS = [
  { name: "npm start", files: ["docker-compose.yml"] },
  { name: "npm run dev", files: ["Scripts/Dev/docker-compose.dev.yml"] },
];

const describeWithCompose = hasDockerCompose() ? describe : describe.skip;

describe("the compose files hand the ingress NGINX_HTTP2", () => {
  test("docker-compose.base.yml's ingress passes config.env's value on, on when it is unset or empty", () => {
    const base = readCompose("docker-compose.base.yml");

    expect(base.services.ingress.environment[SETTING]).toBe(
      `\${${SETTING}:-on}`,
    );
  });

  test("no other service of docker-compose.base.yml gets it", () => {
    const base = readCompose("docker-compose.base.yml");
    const others = Object.entries(base.services)
      .filter(([name, service]) => {
        return (
          name !== "ingress" &&
          service &&
          service.environment &&
          !Array.isArray(service.environment) &&
          Object.prototype.hasOwnProperty.call(service.environment, SETTING)
        );
      })
      .map(([name]) => {
        return name;
      });

    expect(others).toEqual([]);
  });

  test.each(STACKS)(
    "$name runs the ingress from docker-compose.base.yml's, which sets it",
    ({ files }) => {
      const ingress = readCompose(files[0]).services.ingress;

      expect(path.posix.basename(ingress.extends.file)).toBe(
        "docker-compose.base.yml",
      );
      expect(ingress.extends.service).toBe("ingress");
      // An environment of its own would have to keep the setting.
      expect(ingress.environment).toBeUndefined();
    },
  );

  test("config.example.env ships it on, so a new config.env says so", () => {
    expect(configExampleSettings().get(SETTING)).toBe("on");
  });
});

describeWithCompose(
  "docker compose config hands the ingress NGINX_HTTP2",
  () => {
    // The value the ingress gets in `stack`, with `extraEnv` over config.example.env.
    function ingressSetting(stack, extraEnv) {
      return renderCompose(stack.files, extraEnv).services.ingress.environment[
        SETTING
      ];
    }

    test.each(STACKS)(
      "$name: on from config.example.env, off from NGINX_HTTP2=off",
      (stack) => {
        expect(ingressSetting(stack)).toBe("on");
        expect(ingressSetting(stack, { [SETTING]: "off" })).toBe("off");
        expect(ingressSetting(stack, { [SETTING]: "false" })).toBe("false");
      },
    );

    test.each(STACKS)(
      "$name: on for a config.env that predates the setting, or leaves it empty",
      (stack) => {
        expect(ingressSetting(stack, { [SETTING]: undefined })).toBe("on");
        expect(ingressSetting(stack, { [SETTING]: "" })).toBe("on");
      },
    );

    test("says nothing of the setting when config.env predates it", () => {
      const result = spawnSync(
        "docker",
        [
          "compose",
          "--project-directory",
          REPO_ROOT,
          "-f",
          path.join(REPO_ROOT, "docker-compose.yml"),
          "config",
          "--quiet",
        ],
        {
          cwd: REPO_ROOT,
          env: Object.fromEntries(
            Object.entries({
              ...process.env,
              ...Object.fromEntries(configExampleSettings()),
            }).filter(([name]) => {
              return name !== SETTING;
            }),
          ),
          encoding: "utf8",
        },
      );

      expect(result.status).toBe(0);
      expect(result.stderr).not.toContain(SETTING);
    });

    test("only the ingress gets it", () => {
      const services = renderCompose(["docker-compose.yml"], {
        [SETTING]: "off",
      }).services;
      const withIt = Object.keys(services).filter((name) => {
        return Boolean(
          services[name].environment &&
            Object.prototype.hasOwnProperty.call(
              services[name].environment,
              SETTING,
            ),
        );
      });

      expect(withIt).toEqual(["ingress"]);
    });
  },
);

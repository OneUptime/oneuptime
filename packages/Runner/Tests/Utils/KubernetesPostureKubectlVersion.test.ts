/*
 * ---------------------------------------------------------------------------
 * The kubectl version probe runs kubectl too, so it gets a closed
 * environment like every AI command: kubectl 1.33+ reads a kuberc
 * preferences file (aliases, default flags) from HOME or from $KUBERC, and
 * nothing on the host may shape what kubectl reports about itself.
 * ---------------------------------------------------------------------------
 */

import type { EventEmitter as NodeEventEmitter } from "events";

jest.mock("Common/Server/Utils/Logger", () => {
  return {
    __esModule: true,
    default: {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    },
  };
});

jest.mock("child_process", () => {
  /* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires */
  const { EventEmitter } = require("events");
  /* eslint-enable @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires */

  const spawn: jest.Mock = jest.fn(() => {
    const child: NodeEventEmitter & { stdout: NodeEventEmitter } =
      Object.assign(new EventEmitter(), { stdout: new EventEmitter() });

    process.nextTick(() => {
      child.stdout.emit(
        "data",
        Buffer.from(
          JSON.stringify({ clientVersion: { gitVersion: "v1.36.4" } }),
        ),
      );
      child.emit("close", 0, null);
    });

    return child;
  });

  return { __esModule: true, spawn };
});

/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires */
const childProcessMock: { spawn: jest.Mock } = require("child_process");
/* eslint-enable @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires */

import KubernetesPosture from "../../Utils/KubernetesPosture";

describe("KubernetesPosture.detectKubectlVersion", () => {
  const saved: Record<string, string | undefined> = {};
  const POLLUTED: Record<string, string> = {
    KUBERC: "/tmp/evil-kuberc",
    KUBECTL_KUBERC: "true",
    KUBECONFIG: "/root/.kube/config",
    HOME: "/root",
    AWS_PROFILE: "prod-admin",
  };

  beforeEach(() => {
    KubernetesPosture.resetCache();
    childProcessMock.spawn.mockClear();
    for (const [key, value] of Object.entries(POLLUTED)) {
      saved[key] = process.env[key];
      process.env[key] = value;
    }
  });

  afterEach(() => {
    KubernetesPosture.resetCache();
    for (const key of Object.keys(POLLUTED)) {
      if (saved[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = saved[key];
      }
    }
  });

  test("reads the version with kuberc switched off and nothing else from the host", async () => {
    await expect(KubernetesPosture.detectKubectlVersion()).resolves.toBe(
      "v1.36.4",
    );

    expect(childProcessMock.spawn).toHaveBeenCalledTimes(1);

    const [command, args, options] = childProcessMock.spawn.mock.calls[0] as [
      string,
      Array<string>,
      { env: Record<string, string> },
    ];

    expect(command).toBe("kubectl");
    expect(args).toEqual(["version", "--client", "-o", "json"]);
    expect(options.env["KUBERC"]).toBe("off");
    expect(options.env["KUBECTL_KUBERC"]).toBe("false");
    expect(options.env["HOME"]).not.toBe("/root");
    expect(options.env["KUBECONFIG"]).toBeUndefined();
    expect(options.env["AWS_PROFILE"]).toBeUndefined();
    expect(Object.keys(options.env).sort()).toEqual(
      ["HOME", "KUBECTL_KUBERC", "KUBERC", "PATH"].sort(),
    );
  });

  test("caches the answer for the life of the process", async () => {
    await KubernetesPosture.detectKubectlVersion();
    await KubernetesPosture.detectKubectlVersion();

    expect(childProcessMock.spawn).toHaveBeenCalledTimes(1);
  });
});

import {
  CODE_FIX_PIPELINE_ENVIRONMENT_NAMES,
  RUNNER_OWN_ENVIRONMENT_NAMES,
  RUNNER_OWN_ENVIRONMENT_PREFIX,
  getCodeFixCommandEnvironment,
  isRunnerOwnEnvironmentName,
  withoutRunnerOwnEnvironment,
} from "../../Utils/RunnerOwnEnvironment";
import { describe, expect, test } from "@jest/globals";

/*
 * What a command a Runner runs for a project is handed of the Runner's
 * environment: all of it but the Runner's own - every ONEUPTIME_RUNNER_
 * setting (its key and id above all), the Kubernetes agent Runner's
 * ingestion key and the server's secret - and, for a command run while AI
 * works in a repository, but the pipeline's git credentials too.
 *
 * ProjectCommandsWithoutRunnerKey runs real processes with it.
 */

// A Runner's environment, as an operator starts one.
const RUNNER_ENVIRONMENT: NodeJS.ProcessEnv = {
  PATH: "/usr/local/bin:/usr/bin:/bin",
  HOME: "/home/runner",
  HTTPS_PROXY: "http://proxy.internal:3128",
  NO_PROXY: "localhost,.internal",
  NPM_CONFIG_REGISTRY: "https://npm.internal",
  ACME_REGISTRY_TOKEN: "registry-token-the-build-needs",
  AWS_PROFILE: "deploy",
  KUBECONFIG: "/home/runner/.kube/config",
  ONEUPTIME_URL: "https://oneuptime.example.com",
  ONEUPTIME_RUNNER_ID: "6f1e2d3c-0000-4000-8000-0000000000aa",
  ONEUPTIME_RUNNER_KEY: "8c1f2a4e-6b7d-4e9f-a0b1-c2d3e4f5a6b7",
  ONEUPTIME_RUNNER_NAME: "prod-eu-west-1",
  ONEUPTIME_RUNNER_DESCRIPTION: "Reaches the production network",
  ONEUPTIME_RUNNER_ENABLE_CODE_FIXES: "true",
  ONEUPTIME_RUNNER_POLL_INTERVAL_MS: "5000",
  ONEUPTIME_RUNNER_POD_NAMESPACE: "oneuptime",
  ONEUPTIME_INGESTION_KEY: "telemetry-ingestion-key-of-the-project",
  ONEUPTIME_SECRET: "the-servers-cluster-secret",
  ONEUPTIME_KUBERNETES_CLUSTER_NAME: "prod",
  GIT_ASKPASS: "/opt/oneuptime/askpass.sh",
  ONEUPTIME_GIT_ACCESS_TOKEN: "ghs_repositorytoken0123456789",
};

const RUNNER_OWN_NAMES: Array<string> = [
  "ONEUPTIME_RUNNER_ID",
  "ONEUPTIME_RUNNER_KEY",
  "ONEUPTIME_RUNNER_NAME",
  "ONEUPTIME_RUNNER_DESCRIPTION",
  "ONEUPTIME_RUNNER_ENABLE_CODE_FIXES",
  "ONEUPTIME_RUNNER_POLL_INTERVAL_MS",
  "ONEUPTIME_RUNNER_POD_NAMESPACE",
  "ONEUPTIME_INGESTION_KEY",
  "ONEUPTIME_SECRET",
];

describe("the Runner's own variables", () => {
  test("are every ONEUPTIME_RUNNER_ setting, the ingestion key and the server's secret", () => {
    expect(RUNNER_OWN_ENVIRONMENT_PREFIX).toBe("ONEUPTIME_RUNNER_");
    expect([...RUNNER_OWN_ENVIRONMENT_NAMES]).toEqual([
      "ONEUPTIME_INGESTION_KEY",
      "ONEUPTIME_SECRET",
    ]);

    for (const name of RUNNER_OWN_NAMES) {
      expect({ name, isOwn: isRunnerOwnEnvironmentName(name) }).toEqual({
        name,
        isOwn: true,
      });
    }
  });

  test("a setting added later under the prefix is one too", () => {
    expect(isRunnerOwnEnvironmentName("ONEUPTIME_RUNNER_SOMETHING_NEW")).toBe(
      true,
    );
  });

  test("a name in other letters is the same name, as Windows reads it", () => {
    expect(isRunnerOwnEnvironmentName("oneuptime_runner_key")).toBe(true);
    expect(isRunnerOwnEnvironmentName("OneUptime_Ingestion_Key")).toBe(true);
  });

  test.each([
    "PATH",
    "HOME",
    "HTTPS_PROXY",
    "ACME_REGISTRY_TOKEN",
    "KUBECONFIG",
    "ONEUPTIME_URL",
    "ONEUPTIME_KUBERNETES_CLUSTER_NAME",
    // A run's inputs reach a Bash step under ONEUPTIME_INPUT_ (RunbookInputs).
    "ONEUPTIME_INPUT_HOST",
    "ONEUPTIME_INPUTS",
    "ONEUPTIME_TRIGGER",
    // Close, but not the prefix.
    "ONEUPTIME_RUNNERS",
    "MY_ONEUPTIME_RUNNER_KEY",
  ])("%s is not", (name: string) => {
    expect(isRunnerOwnEnvironmentName(name)).toBe(false);
  });
});

describe("withoutRunnerOwnEnvironment", () => {
  test("takes the Runner's own out and keeps everything an operator put there for a command", () => {
    const environment: NodeJS.ProcessEnv =
      withoutRunnerOwnEnvironment(RUNNER_ENVIRONMENT);

    for (const name of RUNNER_OWN_NAMES) {
      expect(environment[name]).toBeUndefined();
    }

    expect(environment).toEqual({
      PATH: "/usr/local/bin:/usr/bin:/bin",
      HOME: "/home/runner",
      HTTPS_PROXY: "http://proxy.internal:3128",
      NO_PROXY: "localhost,.internal",
      NPM_CONFIG_REGISTRY: "https://npm.internal",
      ACME_REGISTRY_TOKEN: "registry-token-the-build-needs",
      AWS_PROFILE: "deploy",
      KUBECONFIG: "/home/runner/.kube/config",
      ONEUPTIME_URL: "https://oneuptime.example.com",
      ONEUPTIME_KUBERNETES_CLUSTER_NAME: "prod",
      GIT_ASKPASS: "/opt/oneuptime/askpass.sh",
      ONEUPTIME_GIT_ACCESS_TOKEN: "ghs_repositorytoken0123456789",
    });
  });

  test("is a copy: the Runner's own environment is left as it is", () => {
    const base: NodeJS.ProcessEnv = { ...RUNNER_ENVIRONMENT };

    withoutRunnerOwnEnvironment(base);

    expect(base).toEqual(RUNNER_ENVIRONMENT);
  });

  test("keeps a run's inputs, which a step built from the Runner's", () => {
    expect(
      withoutRunnerOwnEnvironment({
        ...RUNNER_ENVIRONMENT,
        ONEUPTIME_INPUT_HOST: "web-1",
        ONEUPTIME_INPUTS: '{"host":"web-1"}',
        ONEUPTIME_TRIGGER: "Webhook",
      }),
    ).toEqual(
      expect.objectContaining({
        ONEUPTIME_INPUT_HOST: "web-1",
        ONEUPTIME_INPUTS: '{"host":"web-1"}',
        ONEUPTIME_TRIGGER: "Webhook",
      }),
    );
  });

  test("a name in other letters is taken out too", () => {
    expect(
      withoutRunnerOwnEnvironment({
        oneuptime_runner_key: "lower-case-key-0123456789",
        PATH: "/bin",
      }),
    ).toEqual({ PATH: "/bin" });
  });

  test("reads this process's environment when given none", () => {
    const saved: string | undefined = process.env["ONEUPTIME_RUNNER_KEY"];
    process.env["ONEUPTIME_RUNNER_KEY"] = "key-of-this-process-0123456789";
    process.env["OPERATOR_SETTING_FOR_A_TEST"] = "kept";

    try {
      const environment: NodeJS.ProcessEnv = withoutRunnerOwnEnvironment();

      expect(environment["ONEUPTIME_RUNNER_KEY"]).toBeUndefined();
      expect(environment["ONEUPTIME_RUNNER_ID"]).toBeUndefined();
      expect(environment["OPERATOR_SETTING_FOR_A_TEST"]).toBe("kept");
      expect(environment["PATH"]).toBe(process.env["PATH"]);
    } finally {
      if (saved === undefined) {
        delete process.env["ONEUPTIME_RUNNER_KEY"];
      } else {
        process.env["ONEUPTIME_RUNNER_KEY"] = saved;
      }
      delete process.env["OPERATOR_SETTING_FOR_A_TEST"];
    }
  });
});

describe("getCodeFixCommandEnvironment", () => {
  test("takes the Runner's own and the pipeline's git credentials out, and says CI", () => {
    const environment: NodeJS.ProcessEnv =
      getCodeFixCommandEnvironment(RUNNER_ENVIRONMENT);

    for (const name of [
      ...RUNNER_OWN_NAMES,
      ...CODE_FIX_PIPELINE_ENVIRONMENT_NAMES,
    ]) {
      expect(environment[name]).toBeUndefined();
    }

    expect(environment["CI"]).toBe("true");
    expect(environment["PATH"]).toBe(RUNNER_ENVIRONMENT["PATH"]);
    expect(environment["ACME_REGISTRY_TOKEN"]).toBe(
      "registry-token-the-build-needs",
    );
    expect(environment["NPM_CONFIG_REGISTRY"]).toBe("https://npm.internal");
  });

  test("CI=true wins over an operator's CI=false: nothing may wait on a prompt", () => {
    expect(
      getCodeFixCommandEnvironment({ ...RUNNER_ENVIRONMENT, CI: "false" })[
        "CI"
      ],
    ).toBe("true");
  });

  test("the pipeline's git credentials in other letters are taken out too", () => {
    const environment: NodeJS.ProcessEnv = getCodeFixCommandEnvironment({
      git_askpass: "/tmp/askpass",
      PATH: "/bin",
    });

    expect(environment).toEqual({ PATH: "/bin", CI: "true" });
  });
});

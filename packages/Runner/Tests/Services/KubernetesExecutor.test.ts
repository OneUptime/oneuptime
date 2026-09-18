import https from "https";
import axios from "axios";
import KubernetesExecutor, {
  KubernetesAction,
  KubernetesExecResult,
} from "../../Services/KubernetesExecutor";
import { JSONObject } from "Common/Types/JSON";

/*
 * KubernetesExecutor is the only thing standing between an auto-remediation
 * rule and a cluster's API server, so the tests here are as much about what it
 * refuses to do as about what it sends. Every case asserts on the request that
 * axios was handed — never on a live cluster — so the executor's contract with
 * the API server (path, verb, patch type, TLS posture) is pinned in one place.
 */
jest.mock("axios");

const patchMock: jest.Mock = axios.patch as unknown as jest.Mock;

// The shape KubernetesExecutor actually passes as axios' third argument.
interface PatchConfig {
  headers: Record<string, string>;
  httpsAgent: https.Agent;
  timeout: number;
  validateStatus: (status: number) => boolean;
}

interface PatchCall {
  url: string;
  body: JSONObject;
  config: PatchConfig;
}

const API_SERVER: string = "https://k8s.example.com:6443";
const TOKEN: string = "sa-token-abc123";

function credential(overrides?: JSONObject): JSONObject {
  return {
    apiServerUrl: API_SERVER,
    token: TOKEN,
    ...(overrides || {}),
  };
}

/*
 * The executor sets validateStatus to always-true, so axios resolves on 4xx
 * and 5xx too and the executor gets to read the API server's own message.
 * A fake response is therefore all a failure test needs.
 */
function apiResponse(status: number, data?: JSONObject | null): JSONObject {
  return {
    status: status,
    statusText: "",
    data: data === undefined ? {} : data,
    headers: {},
    config: {},
  } as JSONObject;
}

function patchCall(index: number = 0): PatchCall {
  const call: Array<unknown> | undefined = patchMock.mock.calls[index] as
    | Array<unknown>
    | undefined;

  if (!call) {
    throw new Error(
      `axios.patch was called ${patchMock.mock.calls.length} time(s); expected at least ${index + 1}.`,
    );
  }

  return {
    url: call[0] as string,
    body: call[1] as JSONObject,
    config: call[2] as PatchConfig,
  };
}

// https.Agent keeps the options it was constructed with; that is the TLS posture.
function agentOptions(agent: https.Agent): https.AgentOptions {
  return (agent as unknown as { options: https.AgentOptions }).options;
}

function nested(value: unknown, ...keys: Array<string>): unknown {
  let current: unknown = value;

  for (const key of keys) {
    current = (current as JSONObject)[key];
  }

  return current;
}

describe("KubernetesExecutor", () => {
  beforeEach(() => {
    patchMock.mockReset();
    patchMock.mockResolvedValue(apiResponse(200));
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("RestartWorkload", () => {
    test("PATCHes the workload with a pod-template restart stamp", async () => {
      const before: number = Date.now();

      const result: KubernetesExecResult = await KubernetesExecutor.execute({
        payload: {
          action: KubernetesAction.RestartWorkload,
          workloadKind: "Deployment",
          namespace: "prod",
          workloadName: "checkout-api",
        },
        credential: credential(),
        timeoutInMs: 30000,
      });

      expect(result.success).toBe(true);
      expect(patchMock).toHaveBeenCalledTimes(1);

      const call: PatchCall = patchCall();

      /*
       * There is no restart verb in the Kubernetes API — `kubectl rollout
       * restart` changes a pod-template annotation and lets the controller
       * recreate pods. Anything else here would be a no-op against a real
       * cluster while still returning 200.
       */
      expect(call.body).toEqual({
        spec: {
          template: {
            metadata: {
              annotations: {
                "oneuptime.com/restartedAt": expect.any(String),
              },
            },
          },
        },
      });

      const stamp: string = nested(
        call.body,
        "spec",
        "template",
        "metadata",
        "annotations",
        "oneuptime.com/restartedAt",
      ) as string;

      /*
       * The stamp must be a real, current timestamp — a constant would not
       * change the template on a second run and so would not restart anything.
       */
      const stampedAt: number = new Date(stamp).getTime();
      expect(Number.isNaN(stampedAt)).toBe(false);
      expect(stampedAt).toBeGreaterThanOrEqual(before - 1000);
      expect(stampedAt).toBeLessThanOrEqual(Date.now() + 1000);
      expect(stamp).toBe(new Date(stampedAt).toISOString());

      expect(result.output).toContain("prod/checkout-api");
      expect(result.errorMessage).toBeUndefined();
    });

    test("targets the apps/v1 deployments path for the given namespace and name", async () => {
      await KubernetesExecutor.execute({
        payload: {
          action: KubernetesAction.RestartWorkload,
          workloadKind: "Deployment",
          namespace: "prod",
          workloadName: "checkout-api",
        },
        credential: credential(),
        timeoutInMs: 30000,
      });

      expect(patchCall().url).toBe(
        "https://k8s.example.com:6443/apis/apps/v1/namespaces/prod/deployments/checkout-api",
      );
    });

    test("uses the statefulsets plural for a StatefulSet", async () => {
      await KubernetesExecutor.execute({
        payload: {
          action: KubernetesAction.RestartWorkload,
          workloadKind: "StatefulSet",
          namespace: "data",
          workloadName: "postgres",
        },
        credential: credential(),
        timeoutInMs: 30000,
      });

      expect(patchCall().url).toBe(
        "https://k8s.example.com:6443/apis/apps/v1/namespaces/data/statefulsets/postgres",
      );
    });

    /*
     * A DaemonSet cannot be scaled but it can absolutely be restarted — the
     * refusal in scale() must not leak into the restart path.
     */
    test("restarts a DaemonSet via the daemonsets plural", async () => {
      const result: KubernetesExecResult = await KubernetesExecutor.execute({
        payload: {
          action: KubernetesAction.RestartWorkload,
          workloadKind: "DaemonSet",
          namespace: "kube-system",
          workloadName: "node-exporter",
        },
        credential: credential(),
        timeoutInMs: 30000,
      });

      expect(result.success).toBe(true);
      expect(patchCall().url).toBe(
        "https://k8s.example.com:6443/apis/apps/v1/namespaces/kube-system/daemonsets/node-exporter",
      );
    });

    test("does not double up the slash when the API server URL has a trailing one", async () => {
      await KubernetesExecutor.execute({
        payload: {
          action: KubernetesAction.RestartWorkload,
          workloadKind: "Deployment",
          namespace: "prod",
          workloadName: "checkout-api",
        },
        credential: credential({ apiServerUrl: `${API_SERVER}///` }),
        timeoutInMs: 30000,
      });

      expect(patchCall().url).toBe(
        "https://k8s.example.com:6443/apis/apps/v1/namespaces/prod/deployments/checkout-api",
      );
    });

    /*
     * Namespace and name arrive from a runbook step, which a project member
     * edits. Un-encoded, a name containing "../" would walk out of the
     * namespace path and PATCH a different object entirely.
     */
    test("URL-encodes the namespace and workload name", async () => {
      await KubernetesExecutor.execute({
        payload: {
          action: KubernetesAction.RestartWorkload,
          workloadKind: "Deployment",
          namespace: "prod/../kube-system",
          workloadName: "../../secrets/db creds",
        },
        credential: credential(),
        timeoutInMs: 30000,
      });

      const url: string = patchCall().url;

      expect(url).toBe(
        "https://k8s.example.com:6443/apis/apps/v1/namespaces/prod%2F..%2Fkube-system/deployments/..%2F..%2Fsecrets%2Fdb%20creds",
      );
      // Nothing after the plural may re-open the path.
      expect(url).not.toContain("/../");
      expect(url).not.toContain(" ");
    });

    test("sends the bearer token and the strategic-merge-patch content type", async () => {
      await KubernetesExecutor.execute({
        payload: {
          action: KubernetesAction.RestartWorkload,
          workloadKind: "Deployment",
          namespace: "prod",
          workloadName: "checkout-api",
        },
        credential: credential(),
        timeoutInMs: 12345,
      });

      const call: PatchCall = patchCall();

      expect(call.config.headers["Authorization"]).toBe(`Bearer ${TOKEN}`);
      /*
       * A plain application/json PATCH is a merge patch that would replace the
       * whole annotations map; strategic merge is what keeps the workload's
       * existing annotations intact.
       */
      expect(call.config.headers["Content-Type"]).toBe(
        "application/strategic-merge-patch+json",
      );
      expect(call.config.timeout).toBe(12345);

      // The token is a cluster credential: it belongs in the header only.
      expect(call.url).not.toContain(TOKEN);
      expect(JSON.stringify(call.body)).not.toContain(TOKEN);
    });

    /*
     * validateStatus is always-true on purpose: axios must resolve on 4xx/5xx
     * so describeFailure can surface the API server's own message. If this
     * ever reverts to axios' default, every permission error becomes a bare
     * "Request failed with status code 403".
     */
    test("resolves rather than throws on non-2xx by accepting every status", async () => {
      await KubernetesExecutor.execute({
        payload: {
          action: KubernetesAction.RestartWorkload,
          workloadKind: "Deployment",
          namespace: "prod",
          workloadName: "checkout-api",
        },
        credential: credential(),
        timeoutInMs: 30000,
      });

      const validateStatus: (status: number) => boolean =
        patchCall().config.validateStatus;

      expect(validateStatus(200)).toBe(true);
      expect(validateStatus(403)).toBe(true);
      expect(validateStatus(500)).toBe(true);
    });
  });

  describe("ScaleWorkload", () => {
    test("PATCHes the /scale subresource with the replica count", async () => {
      const result: KubernetesExecResult = await KubernetesExecutor.execute({
        payload: {
          action: KubernetesAction.ScaleWorkload,
          workloadKind: "Deployment",
          namespace: "prod",
          workloadName: "checkout-api",
          replicas: 5,
        },
        credential: credential(),
        timeoutInMs: 30000,
      });

      expect(result.success).toBe(true);
      expect(patchMock).toHaveBeenCalledTimes(1);

      const call: PatchCall = patchCall();

      expect(call.url).toBe(
        "https://k8s.example.com:6443/apis/apps/v1/namespaces/prod/deployments/checkout-api/scale",
      );
      expect(call.body).toEqual({ spec: { replicas: 5 } });
      expect(call.config.headers["Authorization"]).toBe(`Bearer ${TOKEN}`);
      expect(call.config.headers["Content-Type"]).toBe(
        "application/strategic-merge-patch+json",
      );
      expect(result.output).toContain("5 replica(s)");
    });

    test("scales a StatefulSet through its own scale subresource", async () => {
      const result: KubernetesExecResult = await KubernetesExecutor.execute({
        payload: {
          action: KubernetesAction.ScaleWorkload,
          workloadKind: "StatefulSet",
          namespace: "data",
          workloadName: "postgres",
          replicas: 3,
        },
        credential: credential(),
        timeoutInMs: 30000,
      });

      expect(result.success).toBe(true);
      expect(patchCall().url).toBe(
        "https://k8s.example.com:6443/apis/apps/v1/namespaces/data/statefulsets/postgres/scale",
      );
    });

    /*
     * A DaemonSet runs one pod per node and has no scale subresource. Sending
     * the PATCH anyway earns a 404 that reads like the workload is missing,
     * which sends an operator hunting for the wrong problem.
     */
    test("refuses to scale a DaemonSet, without calling the API server", async () => {
      const result: KubernetesExecResult = await KubernetesExecutor.execute({
        payload: {
          action: KubernetesAction.ScaleWorkload,
          workloadKind: "DaemonSet",
          namespace: "kube-system",
          workloadName: "node-exporter",
          replicas: 3,
        },
        credential: credential(),
        timeoutInMs: 30000,
      });

      expect(result.success).toBe(false);
      expect(result.output).toBe("");
      expect(result.errorMessage).toBe(
        "A DaemonSet cannot be scaled — it runs one pod per node. Restart it instead.",
      );
      expect(patchMock).not.toHaveBeenCalled();
    });

    /*
     * Draining a workload to zero is a legitimate remediation (a stuck consumer
     * that must stop reading a queue), so zero must not be swallowed by a
     * falsy check.
     */
    test("accepts replicas: 0 for a Deployment", async () => {
      const result: KubernetesExecResult = await KubernetesExecutor.execute({
        payload: {
          action: KubernetesAction.ScaleWorkload,
          workloadKind: "Deployment",
          namespace: "prod",
          workloadName: "queue-consumer",
          replicas: 0,
        },
        credential: credential(),
        timeoutInMs: 30000,
      });

      expect(result.success).toBe(true);
      expect(patchMock).toHaveBeenCalledTimes(1);
      expect(patchCall().body).toEqual({ spec: { replicas: 0 } });
      expect(result.output).toContain("0 replica(s)");
    });

    test("refuses a negative replica count, without calling the API server", async () => {
      const result: KubernetesExecResult = await KubernetesExecutor.execute({
        payload: {
          action: KubernetesAction.ScaleWorkload,
          workloadKind: "Deployment",
          namespace: "prod",
          workloadName: "checkout-api",
          replicas: -1,
        },
        credential: credential(),
        timeoutInMs: 30000,
      });

      expect(result.success).toBe(false);
      expect(result.errorMessage).toBe(
        "Scale action needs a replica count of zero or more.",
      );
      expect(patchMock).not.toHaveBeenCalled();
    });

    test("refuses a missing or non-numeric replica count", async () => {
      for (const replicas of [undefined, "3", null, true]) {
        patchMock.mockClear();

        const payload: JSONObject = {
          action: KubernetesAction.ScaleWorkload,
          workloadKind: "Deployment",
          namespace: "prod",
          workloadName: "checkout-api",
        };

        if (replicas !== undefined) {
          payload["replicas"] = replicas as never;
        }

        const result: KubernetesExecResult = await KubernetesExecutor.execute({
          payload: payload,
          credential: credential(),
          timeoutInMs: 30000,
        });

        expect(result.success).toBe(false);
        expect(result.errorMessage).toBe(
          "Scale action needs a replica count of zero or more.",
        );
        expect(patchMock).not.toHaveBeenCalled();
      }
    });
  });

  describe("refusals that never reach the network", () => {
    test("refuses an unsupported workload kind", async () => {
      const result: KubernetesExecResult = await KubernetesExecutor.execute({
        payload: {
          action: KubernetesAction.RestartWorkload,
          workloadKind: "CronJob",
          namespace: "prod",
          workloadName: "nightly-report",
        },
        credential: credential(),
        timeoutInMs: 30000,
      });

      expect(result.success).toBe(false);
      expect(result.output).toBe("");
      expect(result.errorMessage).toBe("Unsupported workload kind: CronJob");
      expect(patchMock).not.toHaveBeenCalled();
    });

    test("refuses a missing workload kind rather than guessing Deployment", async () => {
      const result: KubernetesExecResult = await KubernetesExecutor.execute({
        payload: {
          action: KubernetesAction.RestartWorkload,
          namespace: "prod",
          workloadName: "checkout-api",
        },
        credential: credential(),
        timeoutInMs: 30000,
      });

      expect(result.success).toBe(false);
      expect(result.errorMessage).toContain("Unsupported workload kind");
      expect(patchMock).not.toHaveBeenCalled();
    });

    /*
     * The verb set is closed on purpose: a step that could PATCH or DELETE
     * anything would be a cluster-admin shell wearing a runbook's clothes.
     */
    test("refuses an unsupported action", async () => {
      const result: KubernetesExecResult = await KubernetesExecutor.execute({
        payload: {
          action: "DeleteNamespace",
          workloadKind: "Deployment",
          namespace: "prod",
          workloadName: "checkout-api",
        },
        credential: credential(),
        timeoutInMs: 30000,
      });

      expect(result.success).toBe(false);
      expect(result.output).toBe("");
      expect(result.errorMessage).toBe(
        "Unsupported Kubernetes action: DeleteNamespace",
      );
      expect(patchMock).not.toHaveBeenCalled();
    });

    test("refuses a missing action", async () => {
      const result: KubernetesExecResult = await KubernetesExecutor.execute({
        payload: {
          workloadKind: "Deployment",
          namespace: "prod",
          workloadName: "checkout-api",
        },
        credential: credential(),
        timeoutInMs: 30000,
      });

      expect(result.success).toBe(false);
      expect(result.errorMessage).toContain("Unsupported Kubernetes action");
      expect(patchMock).not.toHaveBeenCalled();
    });

    test("refuses a credential with no API server URL", async () => {
      const result: KubernetesExecResult = await KubernetesExecutor.execute({
        payload: {
          action: KubernetesAction.RestartWorkload,
          workloadKind: "Deployment",
          namespace: "prod",
          workloadName: "checkout-api",
        },
        credential: { token: TOKEN },
        timeoutInMs: 30000,
      });

      expect(result.success).toBe(false);
      expect(result.errorMessage).toBe(
        "Kubernetes credential is missing an API server URL or token.",
      );
      expect(patchMock).not.toHaveBeenCalled();
    });

    /*
     * An empty token would otherwise be sent as "Bearer " and the API server
     * would answer 401 as the anonymous user — a confusing way to learn that
     * the credential never decrypted.
     */
    test("refuses a credential with no token", async () => {
      for (const token of ["", undefined]) {
        patchMock.mockClear();

        const cred: JSONObject = { apiServerUrl: API_SERVER };

        if (token !== undefined) {
          cred["token"] = token;
        }

        const result: KubernetesExecResult = await KubernetesExecutor.execute({
          payload: {
            action: KubernetesAction.RestartWorkload,
            workloadKind: "Deployment",
            namespace: "prod",
            workloadName: "checkout-api",
          },
          credential: cred,
          timeoutInMs: 30000,
        });

        expect(result.success).toBe(false);
        expect(result.errorMessage).toBe(
          "Kubernetes credential is missing an API server URL or token.",
        );
        expect(patchMock).not.toHaveBeenCalled();
      }
    });

    test("refuses an entirely empty credential", async () => {
      const result: KubernetesExecResult = await KubernetesExecutor.execute({
        payload: {
          action: KubernetesAction.RestartWorkload,
          workloadKind: "Deployment",
          namespace: "prod",
          workloadName: "checkout-api",
        },
        credential: {},
        timeoutInMs: 30000,
      });

      expect(result.success).toBe(false);
      expect(result.errorMessage).toBe(
        "Kubernetes credential is missing an API server URL or token.",
      );
      expect(patchMock).not.toHaveBeenCalled();
    });
  });

  describe("API server failures", () => {
    /*
     * "cannot patch resource deployments" names the exact RBAC verb an
     * operator has to grant. A bare 403 does not, so the API server's own
     * message has to survive into the step's error.
     */
    test("surfaces the Kubernetes message on a 403", async () => {
      const message: string =
        'deployments.apps "checkout-api" is forbidden: User "system:serviceaccount:oneuptime:runner" cannot patch resource "deployments" in API group "apps"';

      patchMock.mockResolvedValue(
        apiResponse(403, {
          kind: "Status",
          status: "Failure",
          message: message,
        }),
      );

      const result: KubernetesExecResult = await KubernetesExecutor.execute({
        payload: {
          action: KubernetesAction.RestartWorkload,
          workloadKind: "Deployment",
          namespace: "prod",
          workloadName: "checkout-api",
        },
        credential: credential(),
        timeoutInMs: 30000,
      });

      expect(result.success).toBe(false);
      expect(result.output).toBe("");
      expect(result.errorMessage).toBe(`Kubernetes API 403: ${message}`);
      expect(result.errorMessage).toContain("cannot patch resource");
    });

    test("surfaces the Kubernetes message on a failed scale too", async () => {
      patchMock.mockResolvedValue(
        apiResponse(404, {
          message: 'deployments.apps "checkout-api" not found',
        }),
      );

      const result: KubernetesExecResult = await KubernetesExecutor.execute({
        payload: {
          action: KubernetesAction.ScaleWorkload,
          workloadKind: "Deployment",
          namespace: "prod",
          workloadName: "checkout-api",
          replicas: 2,
        },
        credential: credential(),
        timeoutInMs: 30000,
      });

      expect(result.success).toBe(false);
      expect(result.errorMessage).toBe(
        'Kubernetes API 404: deployments.apps "checkout-api" not found',
      );
    });

    test("still reports the status when the body carries no message", async () => {
      for (const body of [
        {},
        null,
        { kind: "Status" },
        { message: "" },
        { message: 42 },
      ]) {
        patchMock.mockReset();
        patchMock.mockResolvedValue(
          apiResponse(500, body as JSONObject | null),
        );

        const result: KubernetesExecResult = await KubernetesExecutor.execute({
          payload: {
            action: KubernetesAction.RestartWorkload,
            workloadKind: "Deployment",
            namespace: "prod",
            workloadName: "checkout-api",
          },
          credential: credential(),
          timeoutInMs: 30000,
        });

        expect(result.success).toBe(false);
        expect(result.errorMessage).toBe("Kubernetes API returned 500.");
      }
    });

    test("treats a 2xx that is not 200 as success and a 3xx as failure", async () => {
      patchMock.mockResolvedValue(apiResponse(201));

      const created: KubernetesExecResult = await KubernetesExecutor.execute({
        payload: {
          action: KubernetesAction.RestartWorkload,
          workloadKind: "Deployment",
          namespace: "prod",
          workloadName: "checkout-api",
        },
        credential: credential(),
        timeoutInMs: 30000,
      });

      expect(created.success).toBe(true);

      patchMock.mockResolvedValue(apiResponse(302));

      const redirected: KubernetesExecResult = await KubernetesExecutor.execute(
        {
          payload: {
            action: KubernetesAction.RestartWorkload,
            workloadKind: "Deployment",
            namespace: "prod",
            workloadName: "checkout-api",
          },
          credential: credential(),
          timeoutInMs: 30000,
        },
      );

      expect(redirected.success).toBe(false);
      expect(redirected.errorMessage).toBe("Kubernetes API returned 302.");
    });

    /*
     * A network failure must come back as a failed step, not an exception:
     * the job runner reports the step's result, and an escaping throw would
     * crash the poll loop instead of failing the run.
     */
    test("returns a failed result when axios throws", async () => {
      patchMock.mockRejectedValue(
        new Error("connect ECONNREFUSED 10.0.0.1:6443"),
      );

      const result: KubernetesExecResult = await KubernetesExecutor.execute({
        payload: {
          action: KubernetesAction.RestartWorkload,
          workloadKind: "Deployment",
          namespace: "prod",
          workloadName: "checkout-api",
        },
        credential: credential(),
        timeoutInMs: 30000,
      });

      expect(result.success).toBe(false);
      expect(result.output).toBe("");
      expect(result.errorMessage).toBe("connect ECONNREFUSED 10.0.0.1:6443");
    });

    test("returns a failed result when the scale call times out", async () => {
      patchMock.mockRejectedValue(new Error("timeout of 30000ms exceeded"));

      const result: KubernetesExecResult = await KubernetesExecutor.execute({
        payload: {
          action: KubernetesAction.ScaleWorkload,
          workloadKind: "Deployment",
          namespace: "prod",
          workloadName: "checkout-api",
          replicas: 4,
        },
        credential: credential(),
        timeoutInMs: 30000,
      });

      expect(result.success).toBe(false);
      expect(result.errorMessage).toBe("timeout of 30000ms exceeded");
    });

    test("stringifies a non-Error rejection instead of crashing on err.message", async () => {
      patchMock.mockRejectedValue("socket hang up");

      const result: KubernetesExecResult = await KubernetesExecutor.execute({
        payload: {
          action: KubernetesAction.RestartWorkload,
          workloadKind: "Deployment",
          namespace: "prod",
          workloadName: "checkout-api",
        },
        credential: credential(),
        timeoutInMs: 30000,
      });

      expect(result.success).toBe(false);
      expect(result.errorMessage).toBe("socket hang up");
    });
  });

  describe("TLS posture", () => {
    test("passes the cluster CA to an https agent rather than ignoring it", async () => {
      const ca: string =
        "-----BEGIN CERTIFICATE-----\nMIIBcluster\n-----END CERTIFICATE-----";

      await KubernetesExecutor.execute({
        payload: {
          action: KubernetesAction.RestartWorkload,
          workloadKind: "Deployment",
          namespace: "prod",
          workloadName: "checkout-api",
        },
        credential: credential({ caCertificate: ca }),
        timeoutInMs: 30000,
      });

      const agent: https.Agent = patchCall().config.httpsAgent;

      expect(agent).toBeInstanceOf(https.Agent);
      expect(agentOptions(agent).ca).toBe(ca);
      // Supplying a CA must pin trust, never stand in for turning checks off.
      expect(agentOptions(agent).rejectUnauthorized).not.toBe(false);
    });

    test("passes the CA on the scale path too", async () => {
      const ca: string =
        "-----BEGIN CERTIFICATE-----\nca\n-----END CERTIFICATE-----";

      await KubernetesExecutor.execute({
        payload: {
          action: KubernetesAction.ScaleWorkload,
          workloadKind: "Deployment",
          namespace: "prod",
          workloadName: "checkout-api",
          replicas: 2,
        },
        credential: credential({ caCertificate: ca }),
        timeoutInMs: 30000,
      });

      const agent: https.Agent = patchCall().config.httpsAgent;

      expect(agent).toBeInstanceOf(https.Agent);
      expect(agentOptions(agent).ca).toBe(ca);
    });

    /*
     * The tempting shortcut when a self-signed cluster CA is missing is
     * rejectUnauthorized: false, which turns a bearer token that grants
     * workload mutation into something any man in the middle can harvest.
     * An operator who omits the CA must get a connection error instead.
     */
    test("never disables verification when no CA is supplied", async () => {
      await KubernetesExecutor.execute({
        payload: {
          action: KubernetesAction.RestartWorkload,
          workloadKind: "Deployment",
          namespace: "prod",
          workloadName: "checkout-api",
        },
        credential: credential(),
        timeoutInMs: 30000,
      });

      const agent: https.Agent = patchCall().config.httpsAgent;

      expect(agent).toBeInstanceOf(https.Agent);
      expect(agentOptions(agent).rejectUnauthorized).toBe(true);
      expect(agentOptions(agent).rejectUnauthorized).not.toBe(false);
      expect(agentOptions(agent).ca).toBeUndefined();
    });

    test("an empty CA string falls back to the host trust store, still verified", async () => {
      await KubernetesExecutor.execute({
        payload: {
          action: KubernetesAction.RestartWorkload,
          workloadKind: "Deployment",
          namespace: "prod",
          workloadName: "checkout-api",
        },
        credential: credential({ caCertificate: "" }),
        timeoutInMs: 30000,
      });

      const agent: https.Agent = patchCall().config.httpsAgent;

      expect(agentOptions(agent).rejectUnauthorized).toBe(true);
      expect(agentOptions(agent).ca).toBeUndefined();
    });
  });
});

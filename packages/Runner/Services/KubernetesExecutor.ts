import https from "https";
import axios, { AxiosResponse } from "axios";
import { JSONObject } from "Common/Types/JSON";

export interface KubernetesExecResult {
  success: boolean;
  output: string;
  errorMessage?: string | undefined;
}

export enum KubernetesAction {
  RestartWorkload = "RestartWorkload",
  ScaleWorkload = "ScaleWorkload",
}

/*
 * Kubernetes workload actions, over the API server's REST interface.
 *
 * Deliberately not the official client library: the two actions here are one
 * PATCH each, and a service-account token plus the cluster CA is the whole
 * credential — no kubeconfig parsing, no exec plugins, no dependency the
 * image has to carry and depcheck has to justify.
 *
 * The verbs are a closed set on purpose. A step that could PATCH arbitrary
 * objects would be a cluster-admin shell wearing a runbook's clothes; what
 * makes this safe to hand to auto-remediation is that "restart" and "scale"
 * are all it can ever express.
 */
const API_PATHS: Record<string, string> = {
  Deployment: "apis/apps/v1",
  StatefulSet: "apis/apps/v1",
  DaemonSet: "apis/apps/v1",
};

const PLURALS: Record<string, string> = {
  Deployment: "deployments",
  StatefulSet: "statefulsets",
  DaemonSet: "daemonsets",
};

function buildAgent(caCertificate?: string | undefined): https.Agent {
  /*
   * Verify the API server against the cluster CA when one was supplied.
   * Without it we fall back to the host's trust store rather than disabling
   * verification — an operator who omits the CA gets a connection error, not
   * a silently unauthenticated one.
   */
  return new https.Agent(
    caCertificate ? { ca: caCertificate } : { rejectUnauthorized: true },
  );
}

function resourceUrl(data: {
  apiServerUrl: string;
  workloadKind: string;
  namespace: string;
  workloadName: string;
  subresource?: string | undefined;
}): string {
  const base: string = data.apiServerUrl.replace(/\/+$/, "");
  const apiPath: string = API_PATHS[data.workloadKind] || "apis/apps/v1";
  const plural: string = PLURALS[data.workloadKind] || "deployments";

  return `${base}/${apiPath}/namespaces/${encodeURIComponent(
    data.namespace,
  )}/${plural}/${encodeURIComponent(data.workloadName)}${
    data.subresource ? `/${data.subresource}` : ""
  }`;
}

export default class KubernetesExecutor {
  public static async execute(data: {
    payload: JSONObject;
    credential: JSONObject;
    timeoutInMs: number;
  }): Promise<KubernetesExecResult> {
    const apiServerUrl: string = String(data.credential["apiServerUrl"] || "");
    const token: string = String(data.credential["token"] || "");
    const caCertificate: string | undefined = data.credential["caCertificate"]
      ? String(data.credential["caCertificate"])
      : undefined;

    if (!apiServerUrl || !token) {
      return {
        success: false,
        output: "",
        errorMessage:
          "Kubernetes credential is missing an API server URL or token.",
      };
    }

    const action: string = String(data.payload["action"] || "");
    const workloadKind: string = String(data.payload["workloadKind"] || "");
    const namespace: string = String(data.payload["namespace"] || "");
    const workloadName: string = String(data.payload["workloadName"] || "");

    if (!PLURALS[workloadKind]) {
      return {
        success: false,
        output: "",
        errorMessage: `Unsupported workload kind: ${workloadKind}`,
      };
    }

    try {
      if (action === KubernetesAction.RestartWorkload) {
        return await this.restart({
          apiServerUrl,
          token,
          caCertificate,
          workloadKind,
          namespace,
          workloadName,
          timeoutInMs: data.timeoutInMs,
        });
      }

      if (action === KubernetesAction.ScaleWorkload) {
        const replicas: unknown = data.payload["replicas"];

        if (typeof replicas !== "number" || replicas < 0) {
          return {
            success: false,
            output: "",
            errorMessage: "Scale action needs a replica count of zero or more.",
          };
        }

        return await this.scale({
          apiServerUrl,
          token,
          caCertificate,
          workloadKind,
          namespace,
          workloadName,
          replicas,
          timeoutInMs: data.timeoutInMs,
        });
      }

      return {
        success: false,
        output: "",
        errorMessage: `Unsupported Kubernetes action: ${action}`,
      };
    } catch (err) {
      return {
        success: false,
        output: "",
        errorMessage: err instanceof Error ? err.message : String(err),
      };
    }
  }

  /*
   * A rolling restart is a pod-template annotation change — the same thing
   * `kubectl rollout restart` does. There is no restart verb in the API; the
   * controller recreates pods because the template changed.
   */
  private static async restart(data: {
    apiServerUrl: string;
    token: string;
    caCertificate?: string | undefined;
    workloadKind: string;
    namespace: string;
    workloadName: string;
    timeoutInMs: number;
  }): Promise<KubernetesExecResult> {
    const restartedAt: string = new Date().toISOString();

    const response: AxiosResponse = await axios.patch(
      resourceUrl(data),
      {
        spec: {
          template: {
            metadata: {
              annotations: {
                "oneuptime.com/restartedAt": restartedAt,
              },
            },
          },
        },
      },
      {
        headers: {
          Authorization: `Bearer ${data.token}`,
          "Content-Type": "application/strategic-merge-patch+json",
        },
        httpsAgent: buildAgent(data.caCertificate),
        timeout: data.timeoutInMs,
        validateStatus: () => {
          return true;
        },
      },
    );

    if (response.status >= 200 && response.status < 300) {
      return {
        success: true,
        output: `Restarted ${data.workloadKind.toLowerCase()} ${data.namespace}/${data.workloadName} at ${restartedAt}.`,
      };
    }

    return {
      success: false,
      output: "",
      errorMessage: describeFailure(response),
    };
  }

  private static async scale(data: {
    apiServerUrl: string;
    token: string;
    caCertificate?: string | undefined;
    workloadKind: string;
    namespace: string;
    workloadName: string;
    replicas: number;
    timeoutInMs: number;
  }): Promise<KubernetesExecResult> {
    /*
     * DaemonSets run one pod per node — they have no replica count and no
     * scale subresource, so this would be a 404 with a confusing message.
     */
    if (data.workloadKind === "DaemonSet") {
      return {
        success: false,
        output: "",
        errorMessage:
          "A DaemonSet cannot be scaled — it runs one pod per node. Restart it instead.",
      };
    }

    const response: AxiosResponse = await axios.patch(
      resourceUrl({ ...data, subresource: "scale" }),
      { spec: { replicas: data.replicas } },
      {
        headers: {
          Authorization: `Bearer ${data.token}`,
          "Content-Type": "application/strategic-merge-patch+json",
        },
        httpsAgent: buildAgent(data.caCertificate),
        timeout: data.timeoutInMs,
        validateStatus: () => {
          return true;
        },
      },
    );

    if (response.status >= 200 && response.status < 300) {
      return {
        success: true,
        output: `Scaled ${data.workloadKind.toLowerCase()} ${data.namespace}/${data.workloadName} to ${data.replicas} replica(s).`,
      };
    }

    return {
      success: false,
      output: "",
      errorMessage: describeFailure(response),
    };
  }
}

/*
 * The API server's own message is the useful part of a failure — "forbidden:
 * cannot patch deployments" tells an operator exactly which role binding to
 * widen, where a bare 403 does not.
 */
function describeFailure(response: AxiosResponse): string {
  const body: JSONObject = (response.data as JSONObject) || {};
  const message: unknown = body["message"];

  return typeof message === "string" && message
    ? `Kubernetes API ${response.status}: ${message}`
    : `Kubernetes API returned ${response.status}.`;
}

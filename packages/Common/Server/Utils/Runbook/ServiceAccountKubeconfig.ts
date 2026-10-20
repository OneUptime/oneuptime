/*
 * A kubeconfig for a cluster reached with a service account token: what a
 * Kubernetes runbook credential held (an API server URL, a token and the
 * cluster's CA), as the one file kubectl reads. A kubectl step takes a
 * kubeconfig from a secret runbook variable, and the data migration that
 * brought variables in writes each credential a step used as one
 * (RunbookVariablesMove).
 *
 * The CA, when there is one, verifies the API server; without it kubectl
 * uses the host's trust store, never no verification. Every value is
 * written as a JSON string, which YAML reads as it is, so no URL or token
 * can break the file's structure.
 */
export function buildServiceAccountKubeconfig(data: {
  apiServerUrl: string;
  token: string;
  caCertificate?: string | undefined;
  name?: string | undefined;
}): string {
  const name: string = JSON.stringify(data.name || "oneuptime");

  const lines: Array<string> = [
    "apiVersion: v1",
    "kind: Config",
    "clusters:",
    `- name: ${name}`,
    "  cluster:",
    `    server: ${JSON.stringify(data.apiServerUrl)}`,
  ];

  if (data.caCertificate && data.caCertificate.trim()) {
    lines.push(
      `    certificate-authority-data: ${Buffer.from(
        data.caCertificate,
        "utf8",
      ).toString("base64")}`,
    );
  }

  lines.push(
    "users:",
    `- name: ${name}`,
    "  user:",
    `    token: ${JSON.stringify(data.token)}`,
    "contexts:",
    `- name: ${name}`,
    "  context:",
    `    cluster: ${name}`,
    `    user: ${name}`,
    `current-context: ${name}`,
    "",
  );

  return lines.join("\n");
}

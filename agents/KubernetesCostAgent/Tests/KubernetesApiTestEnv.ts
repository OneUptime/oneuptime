import * as fs from "fs";
import * as os from "os";
import * as path from "path";

/*
 * Prologue for KubernetesApi.test.ts, imported before ./TestEnv: the agent
 * talks to a stub Kubernetes API on a port of its own (34576, used by no
 * other test file, since node --test runs files at once) as it would talk
 * to `kubectl proxy`, with a ServiceAccount token file it reads per request.
 */

export const KUBERNETES_API_PORT: number = 34576;

const directory: string = fs.mkdtempSync(
  path.join(os.tmpdir(), "kubernetes-cost-agent-api-"),
);

export const TOKEN_PATH: string = path.join(directory, "token");

fs.writeFileSync(TOKEN_PATH, "first-token\n");

process.env["KUBERNETES_API_URL"] = `http://127.0.0.1:${KUBERNETES_API_PORT}/`;
process.env["KUBERNETES_TOKEN_PATH"] = TOKEN_PATH;
process.env["KUBERNETES_CA_PATH"] = path.join(directory, "no-ca.crt");

import fs from "fs";
import http from "http";
import https from "https";
import net from "net";
import { USER_AGENT_PREFIX } from "../IngestClient";
import PrepareGuard, {
  DEFAULT_GUARD_POLICY,
  GuardResult,
  mergeTargets,
  refusalPrefix,
} from "./PrepareGuard";
import { RenderedData, renderProxmoxData } from "./ProxmoxExecutor";
import {
  ExecResult,
  ExecutorOptions,
  PrepareResult,
  ResourceCommandRequest,
  ResourceExecutor,
  ResourcePostureProbe,
} from "./ResourceExecutor";
import {
  formatResourceOutput,
  redactOutput,
  replaceNulCharacters,
} from "./SpawnSandbox";
import AiResourceType from "../Common/Types/ResourceAiAgent/AiResourceType";
import {
  MAX_RESOURCE_AGENT_OUTPUT_BYTES,
  RESOURCE_AI_OPENSTACK_WRITE_CREDENTIAL_ID_ENV,
  RESOURCE_AI_OPENSTACK_WRITE_CREDENTIAL_SECRET_ENV,
  ResourceCommandTier,
} from "../Common/Types/ResourceAiAgent/ResourceAiAccess";
import {
  OPENSTACK_MAX_LIST_LIMIT,
  OPENSTACK_PROGRAM,
  OpenStackApiRequest,
  OpenStackApiService,
  OpenStackChange,
  OpenStackCommandParseResult,
  OpenStackLiveTarget,
  OpenStackOutputFormat,
  getOpenStackLiveScopeRefusal,
  parseOpenStackCommand,
} from "../Common/Utils/AiRemediation/Resource/OpenStackCommandPolicy";
import {
  OpenStackChangeReach,
  OpenStackReachHost,
  OpenStackReachInstance,
  OPENSTACK_REACH_MAX_LISTED_PROJECTS,
  buildOpenStackChangeReach,
  describeOpenStackChangeReachCounts,
  renderOpenStackChangeReach,
} from "../Common/Utils/AiRemediation/Resource/OpenStackChangeReach";
import { ResourceCommandPolicyResult } from "../Common/Utils/AiRemediation/Resource/ResourceCommandPolicyCore";
import { RESOURCE_REDACTED_MARKER } from "../Common/Utils/AiRemediation/Resource/ResourceOutputRedactor";

/*
 * The executor for OpenStack clouds. There is no openstack client and no shell
 * in the agent: a command OneUptime AI composed —
 *
 *   openstack server list --all-projects --host compute-01 --limit 100
 *   openstack compute service list --service nova-compute
 *   openstack compute service set --enable compute-01 nova-compute
 *
 * — is turned by the policy copy's parseOpenStackCommand (the SAME analysis
 * that tiered it, so there is no second reading of the words) into the call it
 * is, on the service that answers it, found in the catalog of the agent's own
 * Keystone token. See ResourceExecutor for the contract every executor keeps; what
 * this one adds:
 *
 *   - prepare() runs PrepareGuard first, then asks parseOpenStackCommand for the
 *     request, then reads its own settings. Nothing is sent before run(). A Read
 *     must be a GET and a change must not be: should the two ever disagree, it
 *     stops here, whatever anything above said.
 *   - Two credentials. A read uses
 *     ONEUPTIME_AI_OPENSTACK_APPLICATION_CREDENTIAL_ID/_SECRET when set (a
 *     credential of the AI agent's own), else the clouds.yaml the collector's
 *     exporter reads, mounted read-only. A change uses
 *     ONEUPTIME_AI_OPENSTACK_WRITE_APPLICATION_CREDENTIAL_ID/_SECRET and nothing
 *     else: without it, or with the credential reads use, no change runs. The
 *     credentials' own roles and access rules are the hard limit, as RBAC is for the
 *     Kubernetes AI agent. A secret goes in Keystone's login body and nowhere else,
 *     and a token in the X-Auth-Token header of a call to a catalog endpoint: never
 *     in output, errors, logs or the posture.
 *   - Before a change, it reads what the change touches with the read credential,
 *     and holds that to ONEUPTIME_AI_PROTECTED_TARGETS and
 *     ONEUPTIME_AI_WRITE_TARGETS (getOpenStackLiveScopeRefusal): which project and
 *     host an instance is in is only known here. What it cannot read, it does not
 *     change. `openstack dry-run <change>` makes the same reads and stops there.
 *   - A dedicated connection per call: never the proxy the agent uses to reach
 *     OneUptime, never a redirect followed, so the token only ever goes where
 *     the catalog says.
 *   - What is printed: a list as the columns an investigation reads, so one
 *     command's rows fit, and one object whole. Everything goes through the
 *     secret mask here (by field name, on the parsed answer) and the policy
 *     copy's redactor (on the text), and is capped at
 *     MAX_RESOURCE_AGENT_OUTPUT_BYTES.
 *
 * How a failure reads on the server (KubectlJobRunner.getRunState rules): a call
 * that certainly never reached the service (a refusal, a bad setting, a login
 * that failed, connection refused, a TLS failure, a redirect) has no exit code
 * and no output: "never ran". An HTTP error answer is exit code 1: the service
 * said so, which an investigation can cite. A timeout after the request was sent
 * reads as "ran", as for every executor: on a change, it may have happened.
 */

// ---- Settings ------------------------------------------------------------------

// The clouds.yaml the collector's exporter reads, and which entry of it.
export const OPENSTACK_CLOUDS_FILE_ENV: string = "OS_CLIENT_CONFIG_FILE";
export const DEFAULT_OPENSTACK_CLOUDS_FILE: string =
  "/etc/openstack/clouds.yaml";
export const OPENSTACK_EXPORTER_CLOUDS_ENV: string =
  "OPENSTACK_EXPORTER_CLOUDS";
export const AI_OPENSTACK_CLOUD_ENV: string = "ONEUPTIME_AI_OPENSTACK_CLOUD";

// A credential of the AI agent's own; wins over clouds.yaml when set.
export const AI_OPENSTACK_CREDENTIAL_ID_ENV: string =
  "ONEUPTIME_AI_OPENSTACK_APPLICATION_CREDENTIAL_ID";
export const AI_OPENSTACK_CREDENTIAL_SECRET_ENV: string =
  "ONEUPTIME_AI_OPENSTACK_APPLICATION_CREDENTIAL_SECRET";
// The credential changes use, and nothing else does.
export const AI_OPENSTACK_WRITE_CREDENTIAL_ID_ENV: string =
  RESOURCE_AI_OPENSTACK_WRITE_CREDENTIAL_ID_ENV;
export const AI_OPENSTACK_WRITE_CREDENTIAL_SECRET_ENV: string =
  RESOURCE_AI_OPENSTACK_WRITE_CREDENTIAL_SECRET_ENV;
export const AI_OPENSTACK_AUTH_URL_ENV: string =
  "ONEUPTIME_AI_OPENSTACK_AUTH_URL";
// What install.sh keeps in the .env the agent shares with the collector.
export const OPENSTACK_AUTH_URL_ENV: string = "OPENSTACK_AUTH_URL";

export const AI_OPENSTACK_REGION_ENV: string = "ONEUPTIME_AI_OPENSTACK_REGION";
export const AI_OPENSTACK_INTERFACE_ENV: string =
  "ONEUPTIME_AI_OPENSTACK_INTERFACE";
export const AI_OPENSTACK_CA_FILE_ENV: string =
  "ONEUPTIME_AI_OPENSTACK_CA_FILE";

const ENDPOINT_INTERFACES: ReadonlyArray<string> = [
  "public",
  "internal",
  "admin",
];

/*
 * How much of an answer is read. It has to be parsed before it can be printed,
 * so this is well above the output cap; an answer larger than this is not
 * printed at all (a cut JSON could end in the middle of a secret).
 */
export const MAX_OPENSTACK_RESPONSE_BYTES: number = 8 * 1024 * 1024;

/*
 * How much of an answer is rendered, in whole rows, before it is redacted and
 * capped at the output limit.
 */
export const OPENSTACK_RENDER_BUDGET_BYTES: number =
  4 * MAX_RESOURCE_AGENT_OUTPUT_BYTES;

// Longer than any clouds.yaml someone wrote by hand.
const MAX_CLOUDS_FILE_BYTES: number = 1024 * 1024;

// A login gives up after this long, however long the command may take.
export const KEYSTONE_LOGIN_TIMEOUT_MS: number = 30_000;

// A token within this long of expiring is not used for another call.
export const TOKEN_EXPIRY_MARGIN_MS: number = 60_000;

/*
 * Each of the posture probe's requests gives up after this long, so the probe
 * ends inside the agent's own probe timeout (Posture's 15 s) with its own reason.
 */
export const POSTURE_REQUEST_TIMEOUT_MS: number = 5_000;

// What recordings hold. Nova is asked for no more than it speaks.
export const WANTED_COMPUTE_MICROVERSION: string = "2.90";
export const VOLUME_MICROVERSION: string = "3.50";
export const PLACEMENT_MICROVERSION: string = "1.14";

const MAX_API_MESSAGE_CHARS: number = 500;

const WHERE_TO_SET: string =
  "in the .env file the AI agent shares with the OpenStack collector (or the agent container's environment)";

const SCHEME_PATTERN: RegExp = /^https?:\/\//i;

// The catalog's name for each service, the one to prefer first.
export const OPENSTACK_CATALOG_TYPES: Readonly<
  Record<OpenStackApiService, ReadonlyArray<string>>
> = {
  compute: ["compute"],
  placement: ["placement"],
  network: ["network"],
  volume: ["block-storage", "volumev3"],
  image: ["image"],
  identity: ["identity"],
};

const SERVICE_NAMES: Readonly<Record<OpenStackApiService, string>> = {
  compute: "Nova",
  placement: "Placement",
  network: "Neutron",
  volume: "Cinder",
  image: "Glance",
  identity: "Keystone",
};

export type OpenStackCredential =
  | { kind: "applicationCredential"; id: string; secret: string }
  | {
      kind: "password";
      username: string;
      password: string;
      userDomainName: string | null;
      userDomainId: string | null;
      projectName: string | null;
      projectId: string | null;
      projectDomainName: string | null;
      projectDomainId: string | null;
    };

export interface OpenStackConnection {
  // Always ends in /v3.
  authUrl: string;
  credential: OpenStackCredential;
  // Where the credential came from, for messages.
  credentialSource: string;
  isAgentCredential: boolean;
  // The region a command that names none reads. Null: the catalog's first.
  regionName: string | null;
  endpointInterface: string;
  verifyTls: boolean;
  caFile: string | null;
}

export type OpenStackConnectionResult =
  | { connection: OpenStackConnection; problem: null }
  | { connection: null; problem: string };

function readTrimmed(env: NodeJS.ProcessEnv, name: string): string {
  const value: unknown = env[name];

  return typeof value === "string" ? value.trim() : "";
}

// ---- clouds.yaml ------------------------------------------------------------------

/*
 * One cloud's entry of a clouds.yaml, what the agent reads of it. The agent has
 * no YAML library, and needs none: the file is install.sh's, or written after the
 * same shape from the docs, so this reads block mappings and scalars, one line at
 * a time, and says so about anything else rather than guess. No secret is ever
 * in what it says.
 */
export interface CloudsYamlEntry {
  name: string;
  fields: Record<string, string>;
  auth: Record<string, string>;
}

export type CloudsYamlResult =
  | { entries: Array<CloudsYamlEntry>; problem: null }
  | { entries: null; problem: string };

function unquoteYamlScalar(raw: string): string | null {
  const value: string = raw.trim();

  if (value.startsWith('"')) {
    if (!value.endsWith('"') || value.length < 2) {
      return null;
    }

    try {
      const parsed: unknown = JSON.parse(value);

      return typeof parsed === "string" ? parsed : null;
    } catch {
      return null;
    }
  }

  if (value.startsWith("'")) {
    if (!value.endsWith("'") || value.length < 2) {
      return null;
    }

    return value.slice(1, -1).split("''").join("'");
  }

  // A plain scalar ends at " #": what follows is a comment.
  const comment: number = value.indexOf(" #");

  return (comment >= 0 ? value.slice(0, comment) : value).trim();
}

// Where a line's key ends: the first colon outside quotes that a space or the end follows.
function findKeyEnd(line: string): number {
  let quote: string = "";

  for (let i: number = 0; i < line.length; i++) {
    const ch: string = line.charAt(i);

    if (quote) {
      if (ch === "\\" && quote === '"') {
        i++;
      } else if (ch === quote) {
        quote = "";
      }
      continue;
    }

    if (i === 0 && (ch === '"' || ch === "'")) {
      quote = ch;
      continue;
    }

    if (ch === ":") {
      const next: string = line.charAt(i + 1);

      if (next === "" || next === " " || next === "\t") {
        return i;
      }
    }
  }

  return -1;
}

export function parseCloudsYaml(text: string): CloudsYamlResult {
  const entries: Array<CloudsYamlEntry> = [];
  const stack: Array<{ indent: number; key: string }> = [];
  let current: CloudsYamlEntry | null = null;
  let sawClouds: boolean = false;
  const lines: Array<string> = text.split("\n");

  for (let lineNumber: number = 0; lineNumber < lines.length; lineNumber++) {
    const raw: string = (lines[lineNumber] as string).replace(/\r$/, "");
    const body: string = raw.trimStart();

    if (body === "" || body.startsWith("#") || body === "---") {
      continue;
    }

    const indent: number = raw.length - body.length;

    if (raw.slice(0, indent).includes("\t")) {
      return {
        entries: null,
        problem: `clouds.yaml line ${lineNumber + 1} is indented with a tab, which YAML does not allow.`,
      };
    }

    while (
      stack.length > 0 &&
      (stack[stack.length - 1] as { indent: number }).indent >= indent
    ) {
      stack.pop();
    }

    const keyEnd: number = findKeyEnd(body);

    if (keyEnd < 0) {
      // A list item or a line of a block somewhere the agent does not read.
      if (stack.length >= 3) {
        continue;
      }

      return {
        entries: null,
        problem: `clouds.yaml line ${lineNumber + 1} is not a "key: value" line the agent can read. Write the file as the OpenStack agent's README shows.`,
      };
    }

    const key: string | null = unquoteYamlScalar(body.slice(0, keyEnd));
    const value: string = body.slice(keyEnd + 1).trim();

    if (key === null) {
      return {
        entries: null,
        problem: `clouds.yaml line ${lineNumber + 1} has a key the agent cannot read.`,
      };
    }

    const parents: Array<string> = stack.map(
      (level: { key: string }): string => {
        return level.key;
      },
    );

    if (parents.length === 0 && key === "clouds") {
      sawClouds = true;
    }

    const isMapping: boolean = value === "" || value.startsWith("#");

    // clouds: -> <entry>: -> a field, or auth: -> a field.
    if (parents.length === 1 && parents[0] === "clouds" && isMapping) {
      current = { name: key, fields: {}, auth: {} };
      entries.push(current);
    } else if (
      current &&
      parents.length >= 2 &&
      parents[0] === "clouds" &&
      parents[1] === current.name &&
      !isMapping
    ) {
      if (value.startsWith("{") || value.startsWith("[")) {
        if (parents.length === 2 && key === "auth") {
          return {
            entries: null,
            problem: `clouds.yaml line ${lineNumber + 1} writes auth on one line. Write it as a block, as the OpenStack agent's README shows.`,
          };
        }
      } else {
        const scalar: string | null = unquoteYamlScalar(value);

        if (scalar === null) {
          return {
            entries: null,
            problem: `clouds.yaml line ${lineNumber + 1} has a value the agent cannot read: its quotes do not close.`,
          };
        }

        if (parents.length === 2) {
          current.fields[key] = scalar;
        } else if (parents.length === 3 && parents[2] === "auth") {
          current.auth[key] = scalar;
        }
      }
    }

    if (isMapping) {
      stack.push({ indent, key });
    }
  }

  if (!sawClouds) {
    return { entries: null, problem: 'clouds.yaml has no "clouds:" section.' };
  }

  return { entries, problem: null };
}

// The names in OPENSTACK_EXPORTER_CLOUDS, written [RegionOne,RegionTwo].
function readExporterClouds(value: string): Array<string> {
  return value
    .replace(/^\[/, "")
    .replace(/\]$/, "")
    .split(",")
    .map((name: string): string => {
      return name.trim().replace(/^["']/, "").replace(/["']$/, "");
    })
    .filter((name: string): boolean => {
      return name.length > 0;
    });
}

function chooseCloudEntry(
  entries: Array<CloudsYamlEntry>,
  env: NodeJS.ProcessEnv,
): CloudsYamlEntry | string {
  const named: string = readTrimmed(env, AI_OPENSTACK_CLOUD_ENV);

  if (named) {
    return (
      entries.find((entry: CloudsYamlEntry): boolean => {
        return entry.name === named;
      }) ||
      `${AI_OPENSTACK_CLOUD_ENV}="${named}" names no entry of clouds.yaml. It holds ${
        entries
          .map((entry: CloudsYamlEntry): string => {
            return entry.name;
          })
          .join(", ") || "none"
      }.`
    );
  }

  for (const name of readExporterClouds(
    readTrimmed(env, OPENSTACK_EXPORTER_CLOUDS_ENV),
  )) {
    const found: CloudsYamlEntry | undefined = entries.find(
      (entry: CloudsYamlEntry): boolean => {
        return entry.name === name;
      },
    );

    if (found) {
      return found;
    }
  }

  return entries[0] || "clouds.yaml holds no cloud.";
}

function readCredentialFromEntry(
  entry: CloudsYamlEntry,
): OpenStackCredential | string {
  const auth: Record<string, string> = entry.auth;
  const read: (name: string) => string | null = (
    name: string,
  ): string | null => {
    return auth[name] || null;
  };

  if (
    auth["application_credential_id"] ||
    auth["application_credential_secret"]
  ) {
    if (
      !auth["application_credential_id"] ||
      !auth["application_credential_secret"]
    ) {
      return `Entry "${entry.name}" of clouds.yaml has half an application credential: it needs application_credential_id and application_credential_secret.`;
    }

    return {
      kind: "applicationCredential",
      id: auth["application_credential_id"],
      secret: auth["application_credential_secret"],
    };
  }

  if (auth["username"] && auth["password"]) {
    return {
      kind: "password",
      username: auth["username"],
      password: auth["password"],
      userDomainName: read("user_domain_name") || read("domain_name"),
      userDomainId: read("user_domain_id") || read("domain_id"),
      projectName: read("project_name") || read("tenant_name"),
      projectId: read("project_id") || read("tenant_id"),
      projectDomainName: read("project_domain_name") || read("domain_name"),
      projectDomainId: read("project_domain_id") || read("domain_id"),
    };
  }

  if (entry.fields["auth_type"] === "v3oidcpassword" || auth["token"]) {
    return `Entry "${entry.name}" of clouds.yaml uses a login the AI agent does not read. Give the agent an application credential of its own in ${AI_OPENSTACK_CREDENTIAL_ID_ENV} and ${AI_OPENSTACK_CREDENTIAL_SECRET_ENV}.`;
  }

  return `Entry "${entry.name}" of clouds.yaml names no credential: it needs application_credential_id and application_credential_secret, or username and password.`;
}

/*
 * The Keystone URL a login goes to, ending in /v3. A clouds.yaml can say it with
 * or without the version, and with a path a load balancer gives it.
 */
export function normalizeAuthUrl(raw: string): string | null {
  const value: string = raw.trim();

  if (!SCHEME_PATTERN.test(value)) {
    return null;
  }

  let url: URL;

  try {
    url = new URL(value);
  } catch {
    return null;
  }

  // Never echoed by the caller: what is here may be a password.
  if (url.username || url.password || url.search || url.hash) {
    return null;
  }

  const path: string = url.pathname.replace(/\/+$/, "");

  return `${url.protocol}//${url.host}${
    path.endsWith("/v3") ? path : `${path}/v3`
  }`;
}

/*
 * Everything the agent needs to reach the cloud, from its own environment (the
 * executor's options.env, never process.env directly) and the file it names, or
 * the first problem in words an operator can act on. Secrets are never in them.
 */
export function resolveOpenStackConnection(
  env: NodeJS.ProcessEnv,
): OpenStackConnectionResult {
  const agentId: string = readTrimmed(env, AI_OPENSTACK_CREDENTIAL_ID_ENV);
  const agentSecret: string = readTrimmed(
    env,
    AI_OPENSTACK_CREDENTIAL_SECRET_ENV,
  );
  const usesAgentCredential: boolean = Boolean(agentId || agentSecret);

  const cloudsFile: string =
    readTrimmed(env, OPENSTACK_CLOUDS_FILE_ENV) ||
    DEFAULT_OPENSTACK_CLOUDS_FILE;
  let entry: CloudsYamlEntry | null = null;

  /*
   * The file also says the region, the certificate authority and the endpoint
   * interface, so it is read when it is there, whichever credential is used. It
   * is required only when it is what holds the credential.
   */
  let text: string | null = null;
  let readProblem: string | null = null;

  try {
    const stat: fs.Stats = fs.statSync(cloudsFile);

    if (!stat.isFile()) {
      readProblem = `${cloudsFile} is not a file. Mount the OpenStack agent's clouds.yaml there (the compose file's service does).`;
    } else if (stat.size > MAX_CLOUDS_FILE_BYTES) {
      readProblem = `${cloudsFile} is larger than a clouds.yaml should be, so the agent does not read it.`;
    } else {
      text = fs.readFileSync(cloudsFile, "utf8");
    }
  } catch (err: unknown) {
    const code: unknown = (err as { code?: unknown } | null)?.code;

    readProblem =
      code === "EACCES"
        ? `The agent may not read ${cloudsFile}, whose owner alone can. Run it as the file's owner (OPENSTACK_EXPORTER_USER in the .env), as the exporter does.`
        : `The agent cannot read ${cloudsFile} (${String(code || "unreadable")}). Mount the OpenStack agent's clouds.yaml there, or set ${AI_OPENSTACK_CREDENTIAL_ID_ENV} and ${AI_OPENSTACK_CREDENTIAL_SECRET_ENV} ${WHERE_TO_SET}.`;
  }

  if (text !== null) {
    const parsed: CloudsYamlResult = parseCloudsYaml(text);

    if (parsed.entries === null) {
      readProblem = parsed.problem;
    } else {
      const chosen: CloudsYamlEntry | string = chooseCloudEntry(
        parsed.entries,
        env,
      );

      if (typeof chosen === "string") {
        readProblem = chosen;
      } else {
        entry = chosen;
      }
    }
  }

  if (!usesAgentCredential && readProblem) {
    return { connection: null, problem: readProblem };
  }

  let credential: OpenStackCredential;
  let authUrlSetting: string;
  let credentialSource: string;

  if (usesAgentCredential) {
    if (!agentId || !agentSecret) {
      const missing: string = agentId
        ? AI_OPENSTACK_CREDENTIAL_SECRET_ENV
        : AI_OPENSTACK_CREDENTIAL_ID_ENV;
      const present: string = agentId
        ? AI_OPENSTACK_CREDENTIAL_ID_ENV
        : AI_OPENSTACK_CREDENTIAL_SECRET_ENV;

      return {
        connection: null,
        problem: `${present} is set but ${missing} is not. Set both ${WHERE_TO_SET}, or neither, to use the credential in clouds.yaml.`,
      };
    }

    credential = {
      kind: "applicationCredential",
      id: agentId,
      secret: agentSecret,
    };
    authUrlSetting =
      readTrimmed(env, AI_OPENSTACK_AUTH_URL_ENV) ||
      readTrimmed(env, OPENSTACK_AUTH_URL_ENV) ||
      entry?.auth["auth_url"] ||
      "";
    credentialSource = AI_OPENSTACK_CREDENTIAL_ID_ENV;

    if (!authUrlSetting) {
      return {
        connection: null,
        problem: `${AI_OPENSTACK_CREDENTIAL_ID_ENV} needs a Keystone to log in to: set ${OPENSTACK_AUTH_URL_ENV} ${WHERE_TO_SET}.`,
      };
    }
  } else {
    const fromFile: OpenStackCredential | string = readCredentialFromEntry(
      entry as CloudsYamlEntry,
    );

    if (typeof fromFile === "string") {
      return { connection: null, problem: fromFile };
    }

    credential = fromFile;
    authUrlSetting =
      entry?.auth["auth_url"] || readTrimmed(env, OPENSTACK_AUTH_URL_ENV) || "";
    credentialSource = `entry "${entry?.name}" of ${cloudsFile}`;

    if (!authUrlSetting) {
      return {
        connection: null,
        problem: `Entry "${entry?.name}" of clouds.yaml has no auth_url: say which Keystone to log in to.`,
      };
    }
  }

  const authUrl: string | null = normalizeAuthUrl(authUrlSetting);

  if (!authUrl) {
    return {
      connection: null,
      problem: `The Keystone address the agent was given is not a plain http or https URL. Use what clouds.yaml calls auth_url, such as https://keystone.example.com:5000/v3, with no user name or password in it.`,
    };
  }

  const interfaceSetting: string =
    readTrimmed(env, AI_OPENSTACK_INTERFACE_ENV) ||
    entry?.fields["interface"] ||
    entry?.fields["endpoint_type"] ||
    "public";
  const endpointInterface: string = interfaceSetting
    .toLowerCase()
    .replace(/url$/, "");

  if (!ENDPOINT_INTERFACES.includes(endpointInterface)) {
    return {
      connection: null,
      problem: `The endpoint interface "${interfaceSetting}" is not one of ${ENDPOINT_INTERFACES.join(", ")}.`,
    };
  }

  const verify: string = (entry?.fields["verify"] || "").toLowerCase();
  const caFile: string =
    readTrimmed(env, AI_OPENSTACK_CA_FILE_ENV) || entry?.fields["cacert"] || "";

  return {
    connection: {
      authUrl,
      credential,
      credentialSource,
      isAgentCredential: usesAgentCredential,
      regionName:
        readTrimmed(env, AI_OPENSTACK_REGION_ENV) ||
        entry?.fields["region_name"] ||
        null,
      endpointInterface,
      // As the openstack client reads it: on, unless clouds.yaml says false.
      verifyTls: caFile !== "" || !["false", "no", "off", "0"].includes(verify),
      caFile: caFile || null,
    },
    problem: null,
  };
}

/*
 * The connection a change goes through: the same cloud, region and certificate
 * authority as a read, and its own credential. There is no falling back to the
 * read credential, and the read credential is refused if it is given here too: a
 * credential that can both read everything and change something is what keeping
 * two was meant to avoid. Secrets are never in what this says.
 */
export function resolveOpenStackWriteConnection(data: {
  env: NodeJS.ProcessEnv;
  read: OpenStackConnection;
}): OpenStackConnectionResult {
  const id: string = readTrimmed(
    data.env,
    AI_OPENSTACK_WRITE_CREDENTIAL_ID_ENV,
  );
  const secret: string = readTrimmed(
    data.env,
    AI_OPENSTACK_WRITE_CREDENTIAL_SECRET_ENV,
  );

  if (!id || !secret) {
    return {
      connection: null,
      problem: `A change uses a credential of its own, and this agent has none: set ${AI_OPENSTACK_WRITE_CREDENTIAL_ID_ENV} and ${AI_OPENSTACK_WRITE_CREDENTIAL_SECRET_ENV} ${WHERE_TO_SET}. The OpenStack agent's README says how to make one with the least it needs.`,
    };
  }

  const reads: OpenStackCredential = data.read.credential;

  if (reads.kind === "applicationCredential" && reads.id === id) {
    return {
      connection: null,
      problem: `${AI_OPENSTACK_WRITE_CREDENTIAL_ID_ENV} names the credential the agent reads with (${data.read.credentialSource}). A change uses a credential of its own: make one with the least it needs, as the OpenStack agent's README says.`,
    };
  }

  return {
    connection: {
      ...data.read,
      credential: { kind: "applicationCredential", id, secret },
      credentialSource: AI_OPENSTACK_WRITE_CREDENTIAL_ID_ENV,
      isAgentCredential: true,
    },
    problem: null,
  };
}

// ---- The transport ------------------------------------------------------------------

export interface OpenStackHttpRequest {
  method: "GET" | "POST" | "PUT";
  // Absolute, http or https.
  url: string;
  headers: Record<string, string>;
  body: string | null;
  verifyTls: boolean;
  ca: string | null;
  timeoutInMs: number;
  maxResponseBytes: number;
}

export interface OpenStackHttpResponse {
  statusCode: number;
  statusMessage: string;
  // Header names in lower case.
  headers: Record<string, string>;
  body: string;
  truncated: boolean;
}

/*
 * Why a call got no answer:
 *   connect          no connection (refused, unresolvable, unreachable);
 *   connect-timeout  no connection within the budget;
 *   tls              the TLS handshake failed;
 *   timeout          connected and sent, no (complete) answer in time;
 *   reset            connected and sent, the connection closed first.
 */
export type OpenStackTransportFailureKind =
  | "connect"
  | "connect-timeout"
  | "tls"
  | "timeout"
  | "reset";

export class OpenStackTransportError extends Error {
  public readonly kind: OpenStackTransportFailureKind;
  public readonly code: string | null;

  public constructor(data: {
    kind: OpenStackTransportFailureKind;
    message: string;
    code?: string | null | undefined;
  }) {
    super(data.message);
    this.name = "OpenStackTransportError";
    this.kind = data.kind;
    this.code = data.code ?? null;
  }

  public get mayHaveBeenSent(): boolean {
    return this.kind === "timeout" || this.kind === "reset";
  }
}

// Sends one request. Tests inject a fake with the same shape.
export type OpenStackTransport = (
  request: OpenStackHttpRequest,
) => Promise<OpenStackHttpResponse>;

const TLS_ERROR_CODES: ReadonlyArray<string> = [
  "DEPTH_ZERO_SELF_SIGNED_CERT",
  "SELF_SIGNED_CERT_IN_CHAIN",
  "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
  "UNABLE_TO_GET_ISSUER_CERT",
  "UNABLE_TO_GET_ISSUER_CERT_LOCALLY",
  "CERT_HAS_EXPIRED",
  "CERT_NOT_YET_VALID",
  "CERT_UNTRUSTED",
  "CERT_REJECTED",
  "CERT_SIGNATURE_FAILURE",
  "HOSTNAME_MISMATCH",
  "EPROTO",
];

function errorCode(err: unknown): string | null {
  const code: unknown =
    err && typeof err === "object"
      ? (err as Record<string, unknown>)["code"]
      : undefined;

  return typeof code === "string" ? code : null;
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function isTlsErrorCode(code: string | null): boolean {
  return Boolean(
    code &&
      (TLS_ERROR_CODES.includes(code) ||
        code.startsWith("ERR_TLS_") ||
        code.startsWith("ERR_SSL_") ||
        code.startsWith("CERT_")),
  );
}

/*
 * The real transport: node's http and https modules, one connection per call
 * through an agent of its own (never the global agent, which the agent's proxy
 * support may have pointed at the proxy it uses to reach OneUptime), no redirect
 * followed, the whole call bounded by timeoutInMs, the answer read up to
 * maxResponseBytes.
 */
export function nodeTransport(
  request: OpenStackHttpRequest,
): Promise<OpenStackHttpResponse> {
  return new Promise<OpenStackHttpResponse>(
    (
      resolve: (value: OpenStackHttpResponse) => void,
      reject: (reason: OpenStackTransportError) => void,
    ): void => {
      const url: URL = new URL(request.url);
      const isSecure: boolean = url.protocol === "https:";
      const agent: http.Agent = isSecure
        ? new https.Agent({ keepAlive: false, maxSockets: 1 })
        : new http.Agent({ keepAlive: false, maxSockets: 1 });
      let settled: boolean = false;
      // The connection is up (and secured), so the request is being sent.
      let connected: boolean = false;
      let timer: ReturnType<typeof setTimeout> | null = null;
      let clientRequest: http.ClientRequest | null = null;

      const settle: (outcome: () => void) => void = (
        outcome: () => void,
      ): void => {
        if (settled) {
          return;
        }

        settled = true;

        if (timer) {
          clearTimeout(timer);
        }

        outcome();
        agent.destroy();
      };

      const fail: (
        kind: OpenStackTransportFailureKind,
        err: unknown,
      ) => void = (kind: OpenStackTransportFailureKind, err: unknown): void => {
        settle((): void => {
          reject(
            new OpenStackTransportError({
              kind,
              message: errorText(err),
              code: errorCode(err),
            }),
          );
        });

        clientRequest?.destroy();
      };

      const options: https.RequestOptions = {
        method: request.method,
        hostname: url.hostname.replace(/^\[/, "").replace(/\]$/, ""),
        port: url.port || (isSecure ? 443 : 80),
        path: `${url.pathname}${url.search}`,
        headers: request.headers,
        agent,
      };

      if (isSecure) {
        options.rejectUnauthorized = request.verifyTls;

        if (request.verifyTls && request.ca !== null) {
          options.ca = request.ca;
        }
      }

      const onResponse: (response: http.IncomingMessage) => void = (
        response: http.IncomingMessage,
      ): void => {
        const chunks: Array<Buffer> = [];
        let received: number = 0;
        let truncated: boolean = false;

        const done: () => void = (): void => {
          settle((): void => {
            const headers: Record<string, string> = {};

            for (const [name, value] of Object.entries(response.headers)) {
              if (typeof value === "string") {
                headers[name.toLowerCase()] = value;
              } else if (Array.isArray(value) && value[0]) {
                headers[name.toLowerCase()] = value[0];
              }
            }

            resolve({
              statusCode: response.statusCode || 0,
              statusMessage: response.statusMessage || "",
              headers,
              body: Buffer.concat(chunks).toString("utf8"),
              truncated,
            });
          });
        };

        response.on("data", (chunk: Buffer): void => {
          if (settled) {
            return;
          }

          const room: number = Math.max(0, request.maxResponseBytes - received);

          if (chunk.length > room) {
            chunks.push(chunk.subarray(0, room));
            received += room;
            truncated = true;
            done();
            response.destroy();
            clientRequest?.destroy();
            return;
          }

          chunks.push(chunk);
          received += chunk.length;
        });

        response.on("end", done);

        response.on("error", (err: Error): void => {
          fail("reset", err);
        });

        response.on("close", (): void => {
          if (!settled) {
            fail(
              "reset",
              new Error(
                "the connection closed before the whole answer arrived",
              ),
            );
          }
        });
      };

      try {
        clientRequest = isSecure
          ? https.request(options, onResponse)
          : http.request(options, onResponse);
      } catch (err: unknown) {
        // Invalid options (a header Node refuses): nothing was sent.
        fail("connect", err);
        return;
      }

      clientRequest.on("socket", (socket: net.Socket): void => {
        socket.once(isSecure ? "secureConnect" : "connect", (): void => {
          connected = true;
        });
      });

      clientRequest.on("error", (err: Error): void => {
        const code: string | null = errorCode(err);

        if (!connected) {
          fail(isTlsErrorCode(code) ? "tls" : "connect", err);
          return;
        }

        fail("reset", err);
      });

      timer = setTimeout(
        (): void => {
          fail(
            connected ? "timeout" : "connect-timeout",
            new Error(`no answer within ${request.timeoutInMs}ms`),
          );
        },
        Math.max(1, Math.floor(request.timeoutInMs)),
      );

      clientRequest.end(request.body === null ? undefined : request.body);
    },
  );
}

// ---- Keystone ------------------------------------------------------------------

export interface OpenStackCatalogEndpoint {
  url: string;
  interfaceName: string;
  regionName: string;
}

export interface OpenStackCatalogService {
  type: string;
  endpoints: Array<OpenStackCatalogEndpoint>;
}

export interface OpenStackToken {
  // Sent in X-Auth-Token and nowhere else.
  id: string;
  expiresAtMs: number | null;
  catalog: Array<OpenStackCatalogService>;
  projectName: string | null;
  roleNames: Array<string>;
  hasAccessRules: boolean;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function readString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

export function buildKeystoneAuthBody(credential: OpenStackCredential): string {
  if (credential.kind === "applicationCredential") {
    return JSON.stringify({
      auth: {
        identity: {
          methods: ["application_credential"],
          application_credential: {
            id: credential.id,
            secret: credential.secret,
          },
        },
      },
    });
  }

  const userDomain: Record<string, string> = credential.userDomainId
    ? { id: credential.userDomainId }
    : { name: credential.userDomainName || "Default" };
  const projectDomain: Record<string, string> = credential.projectDomainId
    ? { id: credential.projectDomainId }
    : { name: credential.projectDomainName || "Default" };

  return JSON.stringify({
    auth: {
      identity: {
        methods: ["password"],
        password: {
          user: {
            name: credential.username,
            domain: userDomain,
            password: credential.password,
          },
        },
      },
      ...(credential.projectId
        ? { scope: { project: { id: credential.projectId } } }
        : credential.projectName
          ? {
              scope: {
                project: {
                  name: credential.projectName,
                  domain: projectDomain,
                },
              },
            }
          : {}),
    },
  });
}

// A token's answer, what the agent reads of it. Never its id's value in a message.
export function parseKeystoneToken(data: {
  tokenId: string;
  body: Record<string, unknown>;
}): OpenStackToken {
  const token: Record<string, unknown> = isPlainObject(data.body["token"])
    ? data.body["token"]
    : {};
  const expires: number = Date.parse(readString(token["expires_at"]));
  const project: unknown = token["project"];
  const application: unknown = token["application_credential"];
  const catalog: Array<OpenStackCatalogService> = [];

  for (const service of Array.isArray(token["catalog"])
    ? token["catalog"]
    : []) {
    if (!isPlainObject(service)) {
      continue;
    }

    const endpoints: Array<OpenStackCatalogEndpoint> = [];

    for (const endpoint of Array.isArray(service["endpoints"])
      ? service["endpoints"]
      : []) {
      if (!isPlainObject(endpoint) || !readString(endpoint["url"])) {
        continue;
      }

      endpoints.push({
        url: readString(endpoint["url"]),
        interfaceName: readString(endpoint["interface"]),
        regionName:
          readString(endpoint["region_id"]) || readString(endpoint["region"]),
      });
    }

    catalog.push({ type: readString(service["type"]), endpoints });
  }

  return {
    id: data.tokenId,
    expiresAtMs: Number.isNaN(expires) ? null : expires,
    catalog,
    projectName: isPlainObject(project) ? readString(project["name"]) : null,
    roleNames: (Array.isArray(token["roles"]) ? token["roles"] : [])
      .map((role: unknown): string => {
        return isPlainObject(role) ? readString(role["name"]) : "";
      })
      .filter((name: string): boolean => {
        return name.length > 0;
      }),
    hasAccessRules:
      isPlainObject(application) &&
      Array.isArray(application["access_rules"]) &&
      application["access_rules"].length > 0,
  };
}

// Every region the catalog names, for messages.
export function getCatalogRegions(
  catalog: ReadonlyArray<OpenStackCatalogService>,
): Array<string> {
  const regions: Set<string> = new Set<string>();

  for (const service of catalog) {
    for (const endpoint of service.endpoints) {
      if (endpoint.regionName) {
        regions.add(endpoint.regionName);
      }
    }
  }

  return Array.from(regions).sort();
}

/*
 * The URL of a service in a region, on one interface, as the catalog wrote it,
 * or null when it has none there. The interface asked for is what is used: an
 * agent told to use internal is not quietly sent anywhere else.
 */
export function findCatalogEndpoint(data: {
  catalog: ReadonlyArray<OpenStackCatalogService>;
  service: OpenStackApiService;
  regionName: string;
  endpointInterface: string;
}): string | null {
  for (const type of OPENSTACK_CATALOG_TYPES[data.service]) {
    for (const service of data.catalog) {
      if (service.type !== type) {
        continue;
      }

      for (const endpoint of service.endpoints) {
        if (
          endpoint.regionName === data.regionName &&
          endpoint.interfaceName === data.endpointInterface
        ) {
          return endpoint.url;
        }
      }
    }
  }

  return null;
}

function withoutTrailingSlash(url: string): string {
  let end: number = url.length;

  while (end > 0 && url.charAt(end - 1) === "/") {
    end--;
  }

  return url.substring(0, end);
}

function lastSegment(url: string): string {
  const slash: number = url.lastIndexOf("/");

  return slash >= 0 ? url.slice(slash + 1) : url;
}

/*
 * The URL under which a service's own paths live, given what the catalog says.
 * Nova's says /v2.1, or a legacy /v2/<project>; Cinder's /v3 and maybe a project
 * id; Neutron's, Glance's and Keystone's often say no version at all.
 */
export function toServiceBaseUrl(
  service: OpenStackApiService,
  catalogUrl: string,
): string {
  const url: string = withoutTrailingSlash(catalogUrl);

  switch (service) {
    case "compute": {
      if (url.includes("/v2.1")) {
        return url;
      }

      const legacy: number = url.lastIndexOf("/v2");

      return legacy >= 0 ? `${url.substring(0, legacy)}/v2.1` : `${url}/v2.1`;
    }
    case "network":
      return lastSegment(url) === "v2.0" ? url : `${url}/v2.0`;
    case "image":
      return lastSegment(url) === "v2" ? url : `${url}/v2`;
    case "volume":
      return url.includes("/v3") ? url : `${url}/v3`;
    case "identity":
      return lastSegment(url) === "v3" ? url : `${url}/v3`;
    default:
      return url;
  }
}

// Where Nova says which microversions it speaks: its root, above /v2.1.
export function getComputeRootUrl(computeBaseUrl: string): string {
  const at: number = computeBaseUrl.lastIndexOf("/v2.1");

  return `${withoutTrailingSlash(
    at >= 0 ? computeBaseUrl.substring(0, at) : computeBaseUrl,
  )}/`;
}

function parseMicroversion(text: string): [number, number] | null {
  const match: RegExpMatchArray | null = text.match(/^(\d{1,3})\.(\d{1,4})$/);

  return match ? [Number(match[1]), Number(match[2])] : null;
}

function compareMicroversions(left: string, right: string): number {
  const a: [number, number] | null = parseMicroversion(left);
  const b: [number, number] | null = parseMicroversion(right);

  if (!a || !b) {
    return 0;
  }

  return a[0] !== b[0] ? a[0] - b[0] : a[1] - b[1];
}

// What to speak, from Nova's own list, and the newest it says it speaks.
export function chooseComputeMicroversion(body: unknown): {
  microversion: string | null;
  newest: string | null;
} {
  const versions: unknown = isPlainObject(body) ? body["versions"] : null;

  for (const version of Array.isArray(versions) ? versions : []) {
    if (!isPlainObject(version) || version["id"] !== "v2.1") {
      continue;
    }

    const max: string = readString(version["version"]);
    const min: string = readString(version["min_version"]);

    if (!parseMicroversion(max)) {
      return { microversion: null, newest: null };
    }

    if (compareMicroversions(max, WANTED_COMPUTE_MICROVERSION) < 0) {
      return { microversion: max, newest: max };
    }

    if (
      parseMicroversion(min) &&
      compareMicroversions(min, WANTED_COMPUTE_MICROVERSION) > 0
    ) {
      return { microversion: min, newest: max };
    }

    return { microversion: WANTED_COMPUTE_MICROVERSION, newest: max };
  }

  return { microversion: null, newest: null };
}

// ---- Requests ------------------------------------------------------------------

export function buildOpenStackUrl(data: {
  baseUrl: string;
  request: OpenStackApiRequest;
}): string {
  const path: string = data.request.path
    .split("/")
    .filter((segment: string): boolean => {
      return segment.length > 0;
    })
    .map((segment: string): string => {
      return encodeURIComponent(segment);
    })
    .join("/");
  const query: string = Object.entries(data.request.query)
    .map(([name, value]: [string, string]): string => {
      return `${encodeURIComponent(name)}=${encodeURIComponent(value)}`;
    })
    .join("&");

  return `${withoutTrailingSlash(data.baseUrl)}/${path}${
    query ? `?${query}` : ""
  }`;
}

// ---- What a list prints ------------------------------------------------------------

type Row = Record<string, unknown>;

// A list's columns: what an investigation reads, in fewer bytes than each row.
type RowProjection = (row: Row) => Row;

function pick(row: Row, names: ReadonlyArray<string>): Row {
  const picked: Row = {};

  for (const name of names) {
    if (row[name] !== undefined) {
      picked[name] = row[name];
    }
  }

  return picked;
}

const POWER_STATES: Readonly<Record<string, string>> = {
  "0": "NOSTATE",
  "1": "Running",
  "3": "Paused",
  "4": "Shutdown",
  "6": "Crashed",
  "7": "Suspended",
};

function describeAddresses(addresses: unknown): string {
  if (!isPlainObject(addresses)) {
    return "";
  }

  return Object.entries(addresses)
    .map(([network, list]: [string, unknown]): string => {
      const ips: Array<string> = (Array.isArray(list) ? list : []).map(
        (entry: unknown): string => {
          return isPlainObject(entry) ? readString(entry["addr"]) : "";
        },
      );

      return `${network}=${ips.join(",")}`;
    })
    .join("; ");
}

function readObjectField(row: Row, name: string, field: string): unknown {
  const value: unknown = row[name];

  return isPlainObject(value) ? value[field] : undefined;
}

function projectServer(row: Row): Row {
  const power: unknown = row["OS-EXT-STS:power_state"];

  return {
    ...pick(row, ["id", "name", "status"]),
    task_state: row["OS-EXT-STS:task_state"] ?? null,
    power_state: POWER_STATES[String(power)] ?? power ?? null,
    host: row["OS-EXT-SRV-ATTR:host"] ?? null,
    hypervisor: row["OS-EXT-SRV-ATTR:hypervisor_hostname"] ?? null,
    ...pick(row, ["host_status"]),
    availability_zone: row["OS-EXT-AZ:availability_zone"] ?? null,
    project_id: row["tenant_id"] ?? null,
    flavor:
      readObjectField(row, "flavor", "original_name") ??
      readObjectField(row, "flavor", "id") ??
      null,
    addresses: describeAddresses(row["addresses"]),
    ...pick(row, ["updated", "locked"]),
    fault: readObjectField(row, "fault", "message") ?? null,
  };
}

function projectVolume(row: Row): Row {
  const attachments: Array<string> = (
    Array.isArray(row["attachments"]) ? row["attachments"] : []
  ).map((attachment: unknown): string => {
    return isPlainObject(attachment) ? readString(attachment["server_id"]) : "";
  });

  return {
    ...pick(row, ["id", "name", "status", "size", "volume_type", "bootable"]),
    attached_to: attachments.join(","),
    ...pick(row, ["availability_zone", "migration_status", "updated_at"]),
    host: row["os-vol-host-attr:host"] ?? null,
    project_id: row["os-vol-tenant-attr:tenant_id"] ?? null,
  };
}

function projectPool(row: Row): Row {
  const capabilities: Row = isPlainObject(row["capabilities"])
    ? row["capabilities"]
    : {};

  return {
    ...pick(row, ["name"]),
    ...pick(capabilities, [
      "total_capacity_gb",
      "free_capacity_gb",
      "allocated_capacity_gb",
      "provisioned_capacity_gb",
      "max_over_subscription_ratio",
      "reserved_percentage",
      "total_volumes",
      "backend_state",
      "volume_backend_name",
    ]),
  };
}

function projectHypervisor(row: Row): Row {
  const uptime: unknown = row["uptime"];

  return {
    ...pick(row, [
      "id",
      "hypervisor_hostname",
      "state",
      "status",
      "hypervisor_type",
      "host_ip",
    ]),
    service_host: readObjectField(row, "service", "host") ?? null,
    disabled_reason: readObjectField(row, "service", "disabled_reason") ?? null,
    // Null from microversion 2.88, when capacity moved to Placement.
    ...pick(row, [
      "vcpus",
      "vcpus_used",
      "memory_mb",
      "memory_mb_used",
      "local_gb",
      "local_gb_used",
      "running_vms",
    ]),
    ...(typeof uptime === "string" ? { uptime: uptime.trim() } : {}),
  };
}

const ROW_PROJECTIONS: Readonly<Record<string, RowProjection>> = {
  "server list": projectServer,
  "server event list": (row: Row): Row => {
    return pick(row, [
      "action",
      "request_id",
      "start_time",
      "updated_at",
      "message",
      "user_id",
    ]);
  },
  "compute service list": (row: Row): Row => {
    return pick(row, [
      "id",
      "binary",
      "host",
      "zone",
      "status",
      "state",
      "updated_at",
      "disabled_reason",
      "forced_down",
    ]);
  },
  "hypervisor list": projectHypervisor,
  "aggregate list": (row: Row): Row => {
    return pick(row, ["id", "name", "availability_zone", "hosts", "metadata"]);
  },
  "flavor list": (row: Row): Row => {
    return pick(row, [
      "id",
      "name",
      "vcpus",
      "ram",
      "disk",
      "OS-FLV-EXT-DATA:ephemeral",
      "swap",
      "os-flavor-access:is_public",
    ]);
  },
  "resource provider list": (row: Row): Row => {
    return {
      id: row["uuid"] ?? null,
      ...pick(row, [
        "name",
        "generation",
        "parent_provider_uuid",
        "root_provider_uuid",
      ]),
    };
  },
  "network agent list": (row: Row): Row => {
    return pick(row, [
      "id",
      "binary",
      "agent_type",
      "host",
      "availability_zone",
      "alive",
      "admin_state_up",
      "heartbeat_timestamp",
    ]);
  },
  "network list": (row: Row): Row => {
    return pick(row, [
      "id",
      "name",
      "status",
      "admin_state_up",
      "shared",
      "router:external",
      "project_id",
      "mtu",
      "subnets",
    ]);
  },
  "subnet list": (row: Row): Row => {
    return pick(row, [
      "id",
      "name",
      "network_id",
      "cidr",
      "ip_version",
      "gateway_ip",
      "enable_dhcp",
      "project_id",
    ]);
  },
  "router list": (row: Row): Row => {
    return {
      ...pick(row, ["id", "name", "status", "admin_state_up", "ha"]),
      external_network:
        readObjectField(row, "external_gateway_info", "network_id") ?? null,
      ...pick(row, ["project_id"]),
    };
  },
  "floating ip list": (row: Row): Row => {
    return pick(row, [
      "id",
      "floating_ip_address",
      "fixed_ip_address",
      "status",
      "port_id",
      "router_id",
      "floating_network_id",
      "project_id",
    ]);
  },
  "port list": (row: Row): Row => {
    const fixed: Array<string> = (
      Array.isArray(row["fixed_ips"]) ? row["fixed_ips"] : []
    ).map((entry: unknown): string => {
      return isPlainObject(entry) ? readString(entry["ip_address"]) : "";
    });

    return {
      ...pick(row, [
        "id",
        "name",
        "status",
        "admin_state_up",
        "mac_address",
        "network_id",
        "device_id",
        "device_owner",
      ]),
      host: row["binding:host_id"] ?? null,
      vif_type: row["binding:vif_type"] ?? null,
      fixed_ips: fixed.join(","),
      ...pick(row, ["project_id"]),
    };
  },
  "ip availability list": (row: Row): Row => {
    return pick(row, [
      "network_id",
      "network_name",
      "project_id",
      "used_ips",
      "total_ips",
    ]);
  },
  "volume list": projectVolume,
  "volume service list": (row: Row): Row => {
    return pick(row, [
      "binary",
      "host",
      "zone",
      "status",
      "state",
      "updated_at",
      "backend_state",
      "disabled_reason",
      "replication_status",
      "frozen",
    ]);
  },
  "volume backend pool list": projectPool,
  "volume snapshot list": (row: Row): Row => {
    return {
      ...pick(row, [
        "id",
        "name",
        "volume_id",
        "status",
        "size",
        "created_at",
        "updated_at",
      ]),
      project_id: row["os-extended-snapshot-attributes:project_id"] ?? null,
      progress: row["os-extended-snapshot-attributes:progress"] ?? null,
    };
  },
  "volume backup list": (row: Row): Row => {
    return pick(row, [
      "id",
      "name",
      "volume_id",
      "status",
      "size",
      "is_incremental",
      "fail_reason",
      "project_id",
      "created_at",
      "updated_at",
    ]);
  },
  "image list": (row: Row): Row => {
    return pick(row, [
      "id",
      "name",
      "status",
      "visibility",
      "disk_format",
      "container_format",
      "size",
      "owner",
      "created_at",
      "updated_at",
    ]);
  },
  "endpoint list": (row: Row): Row => {
    return pick(row, [
      "id",
      "region_id",
      "interface",
      "service_id",
      "url",
      "enabled",
    ]);
  },
  "service list": (row: Row): Row => {
    return pick(row, ["id", "name", "type", "enabled", "description"]);
  },
  "region list": (row: Row): Row => {
    return pick(row, ["id", "description", "parent_region_id"]);
  },
  "project list": (row: Row): Row => {
    return pick(row, [
      "id",
      "name",
      "domain_id",
      "enabled",
      "parent_id",
      "description",
    ]);
  },
  "domain list": (row: Row): Row => {
    return pick(row, ["id", "name", "enabled", "description"]);
  },
};

/*
 * Nova's zones hold their hosts and services as nested maps. One row per service
 * on a host, which is what the zone's health is made of.
 */
function flattenAvailabilityZones(rows: Array<unknown>): Array<Row> {
  const flat: Array<Row> = [];

  for (const zone of rows) {
    if (!isPlainObject(zone)) {
      continue;
    }

    const name: unknown = zone["zoneName"];
    const available: unknown = readObjectField(zone, "zoneState", "available");
    const hosts: unknown = zone["hosts"];
    let added: boolean = false;

    if (isPlainObject(hosts)) {
      for (const [host, services] of Object.entries(hosts)) {
        if (!isPlainObject(services)) {
          continue;
        }

        for (const [service, state] of Object.entries(services)) {
          flat.push({
            zone: name,
            zone_available: available,
            host,
            service,
            available: isPlainObject(state) ? state["available"] : null,
            active: isPlainObject(state) ? state["active"] : null,
            updated_at: isPlainObject(state) ? state["updated_at"] : null,
          });
          added = true;
        }
      }
    }

    if (!added) {
      flat.push({ zone: name, zone_available: available });
    }
  }

  return flat;
}

export function projectListRows(
  route: string,
  rows: Array<unknown>,
): Array<Row> {
  if (route === "availability zone list") {
    return flattenAvailabilityZones(rows);
  }

  const projection: RowProjection | undefined = ROW_PROJECTIONS[route];

  return rows
    .filter((row: unknown): row is Row => {
      return isPlainObject(row);
    })
    .map((row: Row): Row => {
      return projection ? projection(row) : row;
    });
}

// One object's answer: {"server": {...}} is the server, and Glance's is itself.
export function unwrapObjectAnswer(body: unknown): unknown {
  if (!isPlainObject(body)) {
    return body;
  }

  const keys: Array<string> = Object.keys(body);

  if (keys.length === 1 && isPlainObject(body[keys[0] as string])) {
    return body[keys[0] as string];
  }

  return body;
}

const MAX_MASK_DEPTH: number = 32;

/*
 * Every field whose name says it holds a secret, masked on the parsed answer: a
 * table cell sits under a header the text redactor never sees beside it. Null and
 * empty values stay, so an instance with no user data reads as having none.
 */
export function maskSecretFields(
  value: unknown,
  isSecretName: (name: string) => boolean,
  depth: number = 0,
): unknown {
  if (Array.isArray(value)) {
    return value.map((entry: unknown): unknown => {
      return maskSecretFields(entry, isSecretName, depth + 1);
    });
  }

  if (!isPlainObject(value)) {
    return value;
  }

  // Deeper than any real answer: nothing below this is printed whole.
  if (depth > MAX_MASK_DEPTH) {
    return RESOURCE_REDACTED_MARKER;
  }

  const masked: Row = {};

  for (const [name, field] of Object.entries(value)) {
    masked[name] =
      isSecretName(name) &&
      field !== null &&
      field !== "" &&
      field !== undefined
        ? RESOURCE_REDACTED_MARKER
        : maskSecretFields(field, isSecretName, depth + 1);
  }

  return masked;
}

// ---- Error descriptions -------------------------------------------------------

function shorten(text: string): string {
  const flat: string = text.replace(/\s+/g, " ").trim();

  return flat.length > MAX_API_MESSAGE_CHARS
    ? `${flat.slice(0, MAX_API_MESSAGE_CHARS)}...`
    : flat;
}

/*
 * What a service's error answer says. Nova and Cinder wrap it in the error's own
 * name, Neutron in NeutronError, Keystone in error and Placement in errors. An
 * answer that is not JSON (Apache's page for a stopped service) says nothing here.
 */
export function readApiErrorMessage(body: string): string | null {
  let parsed: unknown;

  try {
    parsed = JSON.parse(body);
  } catch {
    return null;
  }

  if (!isPlainObject(parsed)) {
    return null;
  }

  if (Array.isArray(parsed["errors"]) && isPlainObject(parsed["errors"][0])) {
    const first: Row = parsed["errors"][0];

    return shorten(
      [readString(first["title"]), readString(first["detail"])]
        .filter(Boolean)
        .join(": "),
    );
  }

  for (const value of Object.values(parsed)) {
    if (isPlainObject(value) && typeof value["message"] === "string") {
      return shorten(value["message"]);
    }
  }

  return typeof parsed["message"] === "string"
    ? shorten(parsed["message"])
    : null;
}

function isLoopbackHost(host: string): boolean {
  const name: string = host.toLowerCase();

  return (
    name === "localhost" ||
    name === "::1" ||
    name === "[::1]" ||
    name.startsWith("127.") ||
    name === "0.0.0.0"
  );
}

function describeTransportProblem(data: {
  err: unknown;
  what: string;
  url: string;
  connection: OpenStackConnection;
  timeoutInMs: number;
}): string {
  const host: string = (() => {
    try {
      return new URL(data.url).hostname;
    } catch {
      return data.url;
    }
  })();
  const err: unknown = data.err;

  if (!(err instanceof OpenStackTransportError)) {
    return `${data.what} failed: ${shorten(errorText(err))}.`;
  }

  const code: string = err.code ? ` (${err.code})` : "";

  if (err.kind === "tls") {
    return `The TLS handshake for ${data.what} failed${code}: ${shorten(err.message)}. ${
      data.connection.caFile
        ? `The certificate does not chain to the CA file ${data.connection.caFile}.`
        : `A cloud with its own certificate authority needs its CA: cacert in clouds.yaml (install.sh writes it), or ${AI_OPENSTACK_CA_FILE_ENV}.`
    }`;
  }

  if (err.kind === "connect" || err.kind === "connect-timeout") {
    let detail: string;

    if (err.kind === "connect-timeout") {
      detail = `no connection within ${data.timeoutInMs}ms`;
    } else if (err.code === "ECONNREFUSED") {
      detail = "nothing is listening there (connection refused)";
    } else if (err.code === "ENOTFOUND" || err.code === "EAI_AGAIN") {
      detail = `the name "${host}" does not resolve${code}`;
    } else if (err.code === "EHOSTUNREACH" || err.code === "ENETUNREACH") {
      detail = `there is no route to it${code}`;
    } else {
      detail = `${shorten(err.message)}${code}`;
    }

    return `Could not connect for ${data.what}: ${detail}. The agent needs a route to Keystone and to each service's endpoint.${
      isLoopbackHost(host)
        ? ` ${host} is, inside the agent's container, the container itself.`
        : ""
    }`;
  }

  return err.kind === "timeout"
    ? `Killed (timeout ${data.timeoutInMs}ms): no answer for ${data.what} in time.`
    : `The connection closed before ${data.what} was answered${code}.`;
}

// ---- The executor --------------------------------------------------------------

/*
 * Test seams, never set by the agent (ExecutorFactory constructs every executor
 * with its options alone).
 */
export interface OpenStackExecutorInternals {
  transport?: OpenStackTransport | undefined;
}

// A command every check allowed, with what run() sends.
interface OpenStackCall {
  displayCommand: string;
  argv: Array<string>;
  request: OpenStackApiRequest;
  connection: OpenStackConnection;
  // On a change: the credential that makes it. The connection above reads.
  writeConnection?: OpenStackConnection | undefined;
  timeoutInMs: number;
}

// A call that got an answer, or the result that says why it did not.
type OpenStackExchange =
  | {
      response: OpenStackHttpResponse;
      regionName: string;
      token: OpenStackToken;
      failure: null;
    }
  | { failure: ExecResult };

type OpenStackRead = { body: unknown; problem: null } | { problem: string };

// What a change names, as the agent just read it.
interface OpenStackChangeFacts {
  instances: Array<OpenStackReachInstance>;
  liveTargets: Array<OpenStackLiveTarget>;
  hosts: Array<OpenStackReachHost>;
  // What their host holds: everything, or only what the change does not name.
  onHost: Array<OpenStackReachInstance>;
  // The host a change that moves nothing is about, when there is one.
  isComplete: boolean;
  problems: Array<string>;
}

// How long one change may spend reading before it is made: the rest is the call's.
const CHANGE_READ_BUDGET_SHARE: number = 0.5;


class OpenStackLoginError extends Error {}

export default class OpenStackExecutor implements ResourceExecutor {
  private readonly transport: OpenStackTransport;
  private readonly secretNames: Map<string, boolean> = new Map<
    string,
    boolean
  >();
  // A token per credential: reads and changes each keep their own.
  private readonly cachedTokens: Map<string, OpenStackToken> = new Map<
    string,
    OpenStackToken
  >();
  // The token logged in for the command in progress: a 401 on it was not its age.
  private readonly freshTokenIds: Set<string> = new Set<string>();
  // Per compute endpoint: what Nova said it speaks. Empty when it would not say.
  private readonly computeVersions: Map<
    string,
    { microversion: string | null; newest: string | null }
  > = new Map<string, { microversion: string | null; newest: string | null }>();

  public constructor(
    private readonly options: ExecutorOptions,
    internals: OpenStackExecutorInternals = {},
  ) {
    this.transport = internals.transport || nodeTransport;
  }

  public prepare(request: ResourceCommandRequest): PrepareResult {
    const guarded: GuardResult = PrepareGuard.check({
      config: this.options.config,
      request,
      protectedTargets: [],
      policy: this.options.guardPolicy,
    });

    if (guarded.refusal !== null) {
      return { refusal: guarded.refusal };
    }

    const refused: string = refusalPrefix(guarded.resourceType);

    /*
     * The API request, from the same analysis that tiered the command: the guard
     * already asked the policy, so a refusal here means the two disagree (which
     * only an injected test policy can make happen).
     */
    const parsed: OpenStackCommandParseResult = parseOpenStackCommand(
      guarded.argv.slice(),
    );

    if (!parsed.request) {
      return {
        refusal: `${refused}: its openstack translation refuses "${guarded.displayCommand}": ${
          parsed.errorMessage || "it cannot be turned into an API call"
        }.`,
      };
    }

    /*
     * Tier and method go together. Should a Read ever not be a GET, or a change be
     * one, it stops here, whatever anything above said.
     */
    const isRead: boolean = guarded.tier === ResourceCommandTier.Read;

    if (isRead !== (parsed.request.method === "GET")) {
      return {
        refusal: `${refused}: its policy reads "${guarded.displayCommand}" as ${guarded.tier} and as a ${parsed.request.method}, which never go together, so it does not run.`,
      };
    }

    if (!isRead && !parsed.request.change) {
      return {
        refusal: `${refused}: "${guarded.displayCommand}" is ${guarded.tier}, and is none of the changes this agent makes, so it does not run.`,
      };
    }

    const resolved: OpenStackConnectionResult = resolveOpenStackConnection(
      this.options.env,
    );

    if (resolved.connection === null) {
      return { refusal: `${refused}: ${resolved.problem}` };
    }

    let writeConnection: OpenStackConnection | undefined = undefined;

    if (!isRead) {
      const write: OpenStackConnectionResult = resolveOpenStackWriteConnection({
        env: this.options.env,
        read: resolved.connection,
      });

      if (write.connection === null) {
        return { refusal: `${refused}: ${write.problem}` };
      }

      writeConnection = write.connection;
    }

    const call: OpenStackCall = {
      displayCommand: guarded.displayCommand,
      argv: guarded.argv.slice(),
      request: parsed.request,
      connection: resolved.connection,
      writeConnection,
      timeoutInMs: guarded.timeoutInMs,
    };

    return {
      refusal: null,
      displayCommand: guarded.displayCommand,
      tier: guarded.tier,
      run: (): Promise<ExecResult> => {
        return this.run(call);
      },
    };
  }

  public async probePosture(): Promise<ResourcePostureProbe> {
    try {
      return await this.probe();
    } catch (err: unknown) {
      return {
        toolVersion: null,
        reachable: false,
        reachError: `The OpenStack AI agent could not check the cloud: ${this.redactText(errorText(err))}`,
        details: {},
        protectedTargets: [],
      };
    }
  }

  // Nothing is written to disk: there are no job directories to remove.
  public sweepOrphanedJobDirs(): Promise<void> {
    return Promise.resolve();
  }

  public removeAllJobDirs(): Promise<void> {
    return Promise.resolve();
  }

  private nowMs(): number {
    return this.options.now ? this.options.now().getTime() : Date.now();
  }

  // ---- Running a command -------------------------------------------------------

  private async run(call: OpenStackCall): Promise<ExecResult> {
    try {
      if (call.request.change) {
        return await this.runChange(call);
      }

      if (call.request.dryRunOf) {
        return await this.runDryRun(call);
      }

      return await this.runCall(call);
    } catch (err: unknown) {
      /*
       * Not expected (every step below catches its own failures). The API may have
       * been called, so say so in the output: an empty output reads as "never ran".
       */
      const message: string = this.redactText(
        `The OpenStack AI agent failed while running "${call.displayCommand}": ${errorText(err)}`,
      );

      return {
        success: false,
        output: formatResourceOutput({ stdout: "", stderr: message }),
        errorMessage: message,
      };
    }
  }

  private async runCall(call: OpenStackCall): Promise<ExecResult> {
    const exchanged: OpenStackExchange = await this.exchange({
      call,
      connection: call.connection,
      deadlineMs: this.nowMs() + call.timeoutInMs,
    });

    if (exchanged.failure) {
      return exchanged.failure;
    }

    return this.describeAnswer({
      call,
      response: exchanged.response,
      regionName: exchanged.regionName,
      token: exchanged.token,
    });
  }

  /*
   * One call of a command, on this connection: a token, the service's URL, the
   * request, and one more try when a kept token meets a 401. A 401 means nothing
   * happened, on a change as on a read, so the second try can do no harm.
   */
  private async exchange(data: {
    call: OpenStackCall;
    connection: OpenStackConnection;
    deadlineMs: number;
  }): Promise<OpenStackExchange> {
    const { call, connection, deadlineMs } = data;

    let ca: string | null;

    try {
      ca = this.readCa(connection);
    } catch (err: unknown) {
      return {
        failure: {
          success: false,
          output: "",
          errorMessage: `Could not read the CA file ${connection.caFile} (${
            errorCode(err) || errorText(err)
          }). Mount the cloud's certificate authority into the agent where clouds.yaml says it is.`,
        },
      };
    }

    let token: OpenStackToken;

    try {
      token = await this.getToken({
        connection,
        ca,
        timeoutInMs: Math.min(
          KEYSTONE_LOGIN_TIMEOUT_MS,
          Math.max(1, deadlineMs - this.nowMs()),
        ),
      });
    } catch (err: unknown) {
      return {
        failure: {
          success: false,
          output: "",
          errorMessage: this.redactText(
            err instanceof OpenStackLoginError ? err.message : errorText(err),
          ),
        },
      };
    }

    const located: { baseUrl: string; regionName: string } | string =
      this.locate({ call, connection, token });

    if (typeof located === "string") {
      return {
        failure: { success: false, output: "", errorMessage: located },
      };
    }

    let answer: { response: OpenStackHttpResponse; url: string };

    try {
      answer = await this.send({
        call,
        connection,
        ca,
        token,
        baseUrl: located.baseUrl,
        deadlineMs,
      });
    } catch (err: unknown) {
      return {
        failure: this.describeSendFailure({
          call,
          connection,
          err,
          baseUrl: located.baseUrl,
        }),
      };
    }

    /*
     * A 401 on a token this agent kept: the token ended, or access rules do not
     * list this path, which read the same. So one fresh login and one more try.
     * A new token that meets a 401 was the path.
     */
    if (answer.response.statusCode === 401 && !this.isFresh(token)) {
      this.cachedTokens.delete(this.tokenKey(connection));

      try {
        token = await this.getToken({
          connection,
          ca,
          timeoutInMs: Math.min(
            KEYSTONE_LOGIN_TIMEOUT_MS,
            Math.max(1, deadlineMs - this.nowMs()),
          ),
        });
        answer = await this.send({
          call,
          connection,
          ca,
          token,
          baseUrl: located.baseUrl,
          deadlineMs,
        });
      } catch (err: unknown) {
        if (err instanceof OpenStackLoginError) {
          return {
            failure: {
              success: false,
              output: "",
              errorMessage: this.redactText(err.message),
            },
          };
        }

        return {
          failure: this.describeSendFailure({
            call,
            connection,
            err,
            baseUrl: located.baseUrl,
          }),
        };
      }
    }

    return {
      response: answer.response,
      regionName: located.regionName,
      token,
      failure: null,
    };
  }

  // ---- A change, and what it touches ----------------------------------------------

  // The answer of one read a change or a dry run needs, through the policy's own route.
  private async readForChange(data: {
    words: Array<string>;
    call: OpenStackCall;
    deadlineMs: number;
  }): Promise<OpenStackRead> {
    const regionName: string | null = (
      data.call.request.dryRunOf || data.call.request
    ).regionName;
    const argv: Array<string> = [
      OPENSTACK_PROGRAM,
      ...data.words,
      ...(regionName ? ["--os-region-name", regionName] : []),
    ];
    const parsed: OpenStackCommandParseResult = parseOpenStackCommand(argv);

    if (!parsed.request || parsed.request.method !== "GET") {
      return {
        problem:
          parsed.errorMessage || `"${argv.join(" ")}" is not a read it can make.`,
      };
    }

    const read: OpenStackCall = {
      displayCommand: argv.join(" "),
      argv,
      request: parsed.request,
      connection: data.call.connection,
      timeoutInMs: data.call.timeoutInMs,
    };
    const exchanged: OpenStackExchange = await this.exchange({
      call: read,
      connection: read.connection,
      deadlineMs: data.deadlineMs,
    });

    if (exchanged.failure) {
      return {
        problem:
          exchanged.failure.errorMessage ||
          `"${read.displayCommand}" got no answer.`,
      };
    }

    const status: number = exchanged.response.statusCode;

    if (status < 200 || status >= 300 || exchanged.response.truncated) {
      return {
        problem:
          status >= 200 && status < 300
            ? `The answer to "${read.displayCommand}" was too long to read.`
            : this.describeHttpFailure({
                call: read,
                connection: read.connection,
                response: exchanged.response,
                regionName: exchanged.regionName,
                token: exchanged.token,
              }).errorMessage ||
              `"${read.displayCommand}" answered HTTP ${status}.`,
      };
    }

    try {
      return { body: JSON.parse(exchanged.response.body), problem: null };
    } catch {
      return {
        problem: `The answer to "${read.displayCommand}" is not JSON.`,
      };
    }
  }

  private toReachInstance(row: Row): OpenStackReachInstance {
    return {
      id: readString(row["id"]),
      name: readString(row["name"]) || null,
      projectId: readString(row["tenant_id"]) || null,
      projectName: null,
      host: readString(row["OS-EXT-SRV-ATTR:host"]) || null,
      status: readString(row["status"]) || null,
    };
  }

  // The instances on one host, which is one read and may stop at its limit.
  private async readInstancesOnHost(data: {
    host: string;
    call: OpenStackCall;
    deadlineMs: number;
    problems: Array<string>;
  }): Promise<{ instances: Array<OpenStackReachInstance>; isComplete: boolean }> {
    const read: OpenStackRead = await this.readForChange({
      words: [
        "server",
        "list",
        "--all-projects",
        "--host",
        data.host,
        "--limit",
        String(OPENSTACK_MAX_LIST_LIMIT),
      ],
      call: data.call,
      deadlineMs: data.deadlineMs,
    });

    if (read.problem !== null) {
      data.problems.push(read.problem);
      return { instances: [], isComplete: false };
    }

    const rows: unknown = isPlainObject(read.body)
      ? read.body["servers"]
      : undefined;
    const instances: Array<OpenStackReachInstance> = (
      Array.isArray(rows) ? rows : []
    )
      .filter((row: unknown): row is Row => {
        return isPlainObject(row);
      })
      .map((row: Row): OpenStackReachInstance => {
        return this.toReachInstance(row);
      });

    return {
      instances,
      isComplete: instances.length < OPENSTACK_MAX_LIST_LIMIT,
    };
  }

  // What nova-compute on one host says of itself.
  private async readHost(data: {
    host: string;
    call: OpenStackCall;
    deadlineMs: number;
    problems: Array<string>;
  }): Promise<OpenStackReachHost> {
    const read: OpenStackRead = await this.readForChange({
      words: [
        "compute",
        "service",
        "list",
        "--host",
        data.host,
        "--service",
        "nova-compute",
      ],
      call: data.call,
      deadlineMs: data.deadlineMs,
    });
    const unread: OpenStackReachHost = {
      name: data.host,
      state: null,
      status: null,
      forcedDown: null,
      disabledReason: null,
    };

    if (read.problem !== null) {
      data.problems.push(read.problem);
      return unread;
    }

    const rows: unknown = isPlainObject(read.body)
      ? read.body["services"]
      : undefined;
    const row: unknown = Array.isArray(rows) ? rows[0] : undefined;

    if (!isPlainObject(row)) {
      data.problems.push(
        `Nova has no nova-compute on a host called ${data.host}.`,
      );
      return unread;
    }

    return {
      name: data.host,
      state: readString(row["state"]) || null,
      status: readString(row["status"]) || null,
      forcedDown:
        typeof row["forced_down"] === "boolean" ? row["forced_down"] : null,
      disabledReason: readString(row["disabled_reason"]) || null,
    };
  }

  /*
   * What a change names, read just now with the read credential. Everything a list
   * of targets could be compared with, and on a dry run also what a person approving
   * it should see: the state of the host an evacuation is about, and what else that
   * host holds. Never throws, and what it could not read it says.
   */
  private async readChangeFacts(data: {
    change: OpenStackChange;
    call: OpenStackCall;
    deadlineMs: number;
    forDryRun: boolean;
  }): Promise<OpenStackChangeFacts> {
    const { change, call, deadlineMs, forDryRun } = data;
    const facts: OpenStackChangeFacts = {
      instances: [],
      liveTargets: [],
      hosts: [],
      onHost: [],
      isComplete: true,
      problems: [],
    };

    for (const id of change.instanceIds) {
      const read: OpenStackRead = await this.readForChange({
        words: ["server", "show", id],
        call,
        deadlineMs,
      });
      const row: unknown =
        read.problem === null && isPlainObject(read.body)
          ? read.body["server"]
          : undefined;

      if (read.problem !== null || !isPlainObject(row)) {
        facts.problems.push(
          read.problem !== null
            ? read.problem
            : `Nova's answer about ${id} holds no instance.`,
        );
        facts.isComplete = false;
        facts.instances.push({
          id,
          name: null,
          projectId: null,
          projectName: null,
          host: null,
          status: null,
        });
        facts.liveTargets.push({
          target: `instance:${id}`,
          projectId: null,
          hosts: [],
        });
        continue;
      }

      const instance: OpenStackReachInstance = this.toReachInstance({
        ...row,
        id,
      });

      facts.instances.push(instance);
      facts.liveTargets.push({
        target: `instance:${id}`,
        projectId: instance.projectId,
        hosts: [
          instance.host || "",
          readString(row["OS-EXT-SRV-ATTR:hypervisor_hostname"]),
        ].filter((host: string): boolean => {
          return host.length > 0;
        }),
      });
    }

    if (change.serviceHost) {
      facts.liveTargets.push({
        target: `host:${change.serviceHost}`,
        projectId: null,
        hosts: [change.serviceHost],
      });

      if (forDryRun) {
        facts.hosts.push(
          await this.readHost({
            host: change.serviceHost,
            call,
            deadlineMs,
            problems: facts.problems,
          }),
        );

        const onHost: {
          instances: Array<OpenStackReachInstance>;
          isComplete: boolean;
        } = await this.readInstancesOnHost({
          host: change.serviceHost,
          call,
          deadlineMs,
          problems: facts.problems,
        });

        facts.onHost = onHost.instances;
        facts.isComplete = facts.isComplete && onHost.isComplete;
      }
    }

    if (change.agentId) {
      const read: OpenStackRead = await this.readForChange({
        words: ["network", "agent", "show", change.agentId],
        call,
        deadlineMs,
      });
      const row: unknown =
        read.problem === null && isPlainObject(read.body)
          ? read.body["agent"]
          : undefined;
      const host: string = isPlainObject(row) ? readString(row["host"]) : "";

      if (!host) {
        facts.problems.push(
          read.problem !== null
            ? read.problem
            : `Neutron's answer about ${change.agentId} names no host.`,
        );
        facts.isComplete = false;
      }

      facts.liveTargets.push({
        target: `agent:${change.agentId}`,
        projectId: null,
        hosts: host ? [host] : [],
      });

      if (forDryRun && host) {
        const onHost: {
          instances: Array<OpenStackReachInstance>;
          isComplete: boolean;
        } = await this.readInstancesOnHost({
          host,
          call,
          deadlineMs,
          problems: facts.problems,
        });

        facts.onHost = onHost.instances;
        facts.isComplete = facts.isComplete && onHost.isComplete;
      }
    }

    if (forDryRun && change.route === "server evacuate") {
      const sources: Array<string> = Array.from(
        new Set<string>(
          facts.instances
            .map((instance: OpenStackReachInstance): string => {
              return instance.host || "";
            })
            .filter((host: string): boolean => {
              return host.length > 0;
            }),
        ),
      );

      for (const host of sources) {
        facts.hosts.push(
          await this.readHost({
            host,
            call,
            deadlineMs,
            problems: facts.problems,
          }),
        );

        const onHost: {
          instances: Array<OpenStackReachInstance>;
          isComplete: boolean;
        } = await this.readInstancesOnHost({
          host,
          call,
          deadlineMs,
          problems: facts.problems,
        });

        facts.isComplete = facts.isComplete && onHost.isComplete;
        facts.onHost.push(
          ...onHost.instances.filter(
            (instance: OpenStackReachInstance): boolean => {
              return !change.instanceIds.includes(instance.id);
            },
          ),
        );
      }
    }

    return facts;
  }

  // Keystone's names for these projects, as far as it will say.
  private async readProjectNames(data: {
    projectIds: Array<string>;
    call: OpenStackCall;
    deadlineMs: number;
  }): Promise<Map<string, string>> {
    const names: Map<string, string> = new Map<string, string>();

    for (const id of data.projectIds.slice(
      0,
      OPENSTACK_REACH_MAX_LISTED_PROJECTS,
    )) {
      if (this.nowMs() >= data.deadlineMs) {
        break;
      }

      const read: OpenStackRead = await this.readForChange({
        words: ["project", "show", id],
        call: data.call,
        deadlineMs: data.deadlineMs,
      });
      const row: unknown =
        read.problem === null && isPlainObject(read.body)
          ? read.body["project"]
          : undefined;
      const name: string = isPlainObject(row) ? readString(row["name"]) : "";

      if (name) {
        names.set(id, name);
      }
    }

    return names;
  }

  private buildReach(data: {
    change: OpenStackChange;
    facts: OpenStackChangeFacts;
    projectNames: ReadonlyMap<string, string>;
    wouldBeRefused: string | null;
  }): OpenStackChangeReach {
    const { change, facts } = data;
    const isAboutInstances: boolean = change.instanceIds.length > 0;

    return buildOpenStackChangeReach({
      route: change.route,
      kind: isAboutInstances ? "changes" : "on-host",
      instances: isAboutInstances ? facts.instances : facts.onHost,
      projectNames: data.projectNames,
      hosts: facts.hosts,
      leftBehind: isAboutInstances ? facts.onHost : [],
      isComplete: facts.isComplete,
      problems: facts.problems,
      wouldBeRefused: data.wouldBeRefused,
    });
  }

  /*
   * Why this agent would not make this change, on what it just read, or null. The
   * write switch and the targets its words name are the guard's (PrepareGuard), and
   * a dry run is a Read that never met them, so they are asked here.
   */
  private getWouldBeRefused(data: {
    call: OpenStackCall;
    change: OpenStackChange;
    facts: OpenStackChangeFacts;
  }): string | null {
    const { call, change, facts } = data;
    const config: ExecutorOptions["config"] = this.options.config;
    const protectedTargets: Array<string> = mergeTargets(
      config.protectedTargets,
    );
    const argv: Array<string> = [
      OPENSTACK_PROGRAM,
      ...call.argv.slice(call.request.dryRunOf ? 2 : 1),
    ];
    const policy: ResourceCommandPolicyResult = (
      this.options.guardPolicy || DEFAULT_GUARD_POLICY
    ).evaluateArgv({
      resourceType: AiResourceType.OpenStackCloud,
      argv,
    });
    const refusal: string | null = PrepareGuard.describeWriteRefusal({
      config,
      result: policy,
      protectedTargets,
      policy: this.options.guardPolicy || DEFAULT_GUARD_POLICY,
      resourceType: AiResourceType.OpenStackCloud,
    });

    if (refusal) {
      return refusal;
    }

    const live: string | null = getOpenStackLiveScopeRefusal({
      displayCommand: policy.displayCommand,
      targets: facts.liveTargets,
      protectedTargets,
      writeTargets: config.writeTargets,
    });

    if (live) {
      return live;
    }

    const write: OpenStackConnectionResult = resolveOpenStackWriteConnection({
      env: this.options.env,
      read: call.connection,
    });

    if (write.connection === null) {
      return write.problem;
    }

    if (change.route === "server evacuate") {
      const running: OpenStackReachHost | undefined = facts.hosts.find(
        (host: OpenStackReachHost): boolean => {
          return host.state === "up";
        },
      );

      if (running) {
        return `Nova only takes an evacuation once the instance's host is down, and nova-compute on ${running.name} reads up. Evacuating a host that is alive would run an instance twice.`;
      }
    }

    return null;
  }

  // `openstack dry-run <change>`: every read a change makes first, and no change.
  private async runDryRun(call: OpenStackCall): Promise<ExecResult> {
    const inner: OpenStackApiRequest = call.request
      .dryRunOf as OpenStackApiRequest;
    const change: OpenStackChange = inner.change as OpenStackChange;
    const deadlineMs: number = this.nowMs() + call.timeoutInMs;
    const facts: OpenStackChangeFacts = await this.readChangeFacts({
      change,
      call,
      deadlineMs,
      forDryRun: true,
    });
    const projectIds: Array<string> = Array.from(
      new Set<string>(
        [...facts.instances, ...facts.onHost]
          .map((instance: OpenStackReachInstance): string => {
            return instance.projectId || "";
          })
          .filter((id: string): boolean => {
            return id.length > 0;
          }),
      ),
    );
    const reach: OpenStackChangeReach = this.buildReach({
      change,
      facts,
      projectNames: await this.readProjectNames({
        projectIds,
        call,
        deadlineMs,
      }),
      wouldBeRefused: this.getWouldBeRefused({ call, change, facts }),
    });

    return this.finish({
      success: true,
      exitCode: 0,
      stdout: `Nothing was changed. ${describeOpenStackChangeReachCounts(reach)}
${renderOpenStackChangeReach(reach)}`,
      stderr: "",
    });
  }

  /*
   * A change: what it touches read first with the read credential and held to the
   * protected and write targets, then the call or calls that make it with the write
   * credential. Nothing is sent when any of that says no: such a result has no exit
   * code and no output, which the server reads as "never ran".
   */
  private async runChange(call: OpenStackCall): Promise<ExecResult> {
    const change: OpenStackChange = call.request.change as OpenStackChange;
    const writeConnection: OpenStackConnection | undefined =
      call.writeConnection;
    const startedMs: number = this.nowMs();
    const deadlineMs: number = startedMs + call.timeoutInMs;
    const refused: string = refusalPrefix(AiResourceType.OpenStackCloud);

    if (!writeConnection) {
      return {
        success: false,
        output: "",
        errorMessage: `${refused}: a change uses a credential of its own, and none was found for "${call.displayCommand}".`,
      };
    }

    const facts: OpenStackChangeFacts = await this.readChangeFacts({
      change,
      call,
      deadlineMs: startedMs + call.timeoutInMs * CHANGE_READ_BUDGET_SHARE,
      forDryRun: false,
    });

    if (facts.problems.length > 0) {
      return {
        success: false,
        output: "",
        errorMessage: this.redactText(
          `${refused}: it could not read what "${call.displayCommand}" would touch, so it changed nothing. ${facts.problems[0]}`,
        ),
      };
    }

    const scope: string | null = getOpenStackLiveScopeRefusal({
      displayCommand: call.displayCommand,
      targets: facts.liveTargets,
      protectedTargets: mergeTargets(this.options.config.protectedTargets),
      writeTargets: this.options.config.writeTargets,
    });

    if (scope) {
      return {
        success: false,
        output: "",
        errorMessage: this.redactText(`${refused}: ${scope}`),
      };
    }

    const paths: ReadonlyArray<string> = call.request.paths || [
      call.request.path,
    ];
    const service: string = SERVICE_NAMES[call.request.service];
    const lines: Array<string> = [];
    let sentAny: boolean = false;
    let failure: string | null = null;
    let mayHaveHappened: boolean = false;

    this.options.logger.info("Making a change on the cloud", {
      route: change.route,
      calls: paths.length,
    });

    for (const path of paths) {
      const one: OpenStackCall = {
        ...call,
        request: { ...call.request, path },
      };
      const exchanged: OpenStackExchange = await this.exchange({
        call: one,
        connection: writeConnection,
        deadlineMs,
      });

      if (exchanged.failure) {
        /*
         * No answer: it may be the cloud in trouble, so the rest are not sent. Whether
         * this one happened is what its failure says: output means it may have.
         */
        mayHaveHappened =
          mayHaveHappened || Boolean(exchanged.failure.output);
        failure =
          exchanged.failure.errorMessage || `No answer to ${one.request.path}.`;
        lines.push(`${path}: no answer: ${failure}`);
        break;
      }

      sentAny = true;

      const status: number = exchanged.response.statusCode;

      if (status >= 200 && status < 300) {
        lines.push(`${path}: ${service} accepted it (HTTP ${status}).`);
        continue;
      }

      const failed: ExecResult = this.describeHttpFailure({
        call: one,
        connection: writeConnection,
        response: exchanged.response,
        regionName: exchanged.regionName,
        token: exchanged.token,
      });

      failure = failed.errorMessage || `HTTP ${status}`;
      lines.push(`${path}: refused: ${failure}`);

      /*
       * A credential that may not do it may not do the next one either. Anything
       * else is about this instance, and the others of an evacuation still need
       * a home.
       */
      if (status === 401 || status === 403) {
        break;
      }
    }

    if (!sentAny && !mayHaveHappened) {
      return {
        success: false,
        output: "",
        errorMessage: this.redactText(
          failure || `Nothing was sent for "${call.displayCommand}".`,
        ),
      };
    }

    const reach: OpenStackChangeReach = this.buildReach({
      change,
      facts,
      projectNames: new Map<string, string>(),
      wouldBeRefused: null,
    });
    const stdout: string = [
      describeOpenStackChangeReachCounts(reach),
      ...lines,
      failure
        ? ""
        : `The API took it, which is not the same as done: ${change.instanceIds.length > 0 ? "Nova works on an instance in the background, so read it again" : "read it again"} to see it took effect.`,
      renderOpenStackChangeReach(reach),
    ]
      .filter((line: string): boolean => {
        return line.length > 0;
      })
      .join("\n");

    if (failure) {
      return this.finish({
        success: false,
        exitCode: 1,
        stdout,
        stderr: failure,
        errorMessage: `Exit code 1: ${failure}`,
      });
    }

    return this.finish({ success: true, exitCode: 0, stdout, stderr: "" });
  }

  private readCa(connection: OpenStackConnection): string | null {
    if (!connection.verifyTls || !connection.caFile) {
      return null;
    }

    return fs.readFileSync(connection.caFile, "utf8");
  }

  private tokenKey(connection: OpenStackConnection): string {
    const credential: OpenStackCredential = connection.credential;

    return `${connection.authUrl}|${
      credential.kind === "applicationCredential"
        ? credential.id
        : `${credential.username}|${credential.projectId || credential.projectName || ""}`
    }`;
  }

  private isFresh(token: OpenStackToken): boolean {
    return this.freshTokenIds.has(token.id);
  }

  /*
   * A token good for this call, from Keystone or kept from the last one: a token
   * lasts an hour or so, its catalog says where everything answers, and a login
   * for every command is load a Keystone in trouble can least afford.
   */
  private async getToken(data: {
    connection: OpenStackConnection;
    ca: string | null;
    timeoutInMs: number;
  }): Promise<OpenStackToken> {
    const key: string = this.tokenKey(data.connection);
    const kept: OpenStackToken | undefined = this.cachedTokens.get(key);

    this.freshTokenIds.clear();

    if (
      kept &&
      (kept.expiresAtMs === null ||
        kept.expiresAtMs - TOKEN_EXPIRY_MARGIN_MS > this.nowMs())
    ) {
      return kept;
    }

    const token: OpenStackToken = await this.login(data);

    this.cachedTokens.set(key, token);
    this.freshTokenIds.add(token.id);

    return token;
  }

  // Keystone's login: a secret's one trip.
  private async login(data: {
    connection: OpenStackConnection;
    ca: string | null;
    timeoutInMs: number;
  }): Promise<OpenStackToken> {
    const body: string = buildKeystoneAuthBody(data.connection.credential);
    const url: string = `${data.connection.authUrl}/auth/tokens`;
    const where: string = data.connection.authUrl;
    const source: string = data.connection.credentialSource;
    let response: OpenStackHttpResponse;

    this.options.logger.debug("Logging in to Keystone", { where });

    try {
      response = await this.transport({
        method: "POST",
        url,
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          "User-Agent": this.userAgent(),
          "Content-Length": String(Buffer.byteLength(body, "utf8")),
        },
        body,
        verifyTls: data.connection.verifyTls,
        ca: data.ca,
        timeoutInMs: Math.max(1, Math.floor(data.timeoutInMs)),
        maxResponseBytes: MAX_OPENSTACK_RESPONSE_BYTES,
      });
    } catch (err: unknown) {
      throw new OpenStackLoginError(
        describeTransportProblem({
          err,
          what: `the login to Keystone at ${where}`,
          url,
          connection: data.connection,
          timeoutInMs: data.timeoutInMs,
        }),
      );
    }

    const status: number = response.statusCode;

    if (status >= 300 && status < 400) {
      throw new OpenStackLoginError(
        `Keystone at ${where} answered the login with a redirect (HTTP ${status}), which the agent never follows. Use the auth_url the cloud's clouds.yaml or openrc says.`,
      );
    }

    if (status === 401) {
      throw new OpenStackLoginError(
        `Keystone at ${where} refused the credential in ${source}: it is wrong, it has expired or been deleted, or its account lost its role on the project.`,
      );
    }

    if (status === 403) {
      throw new OpenStackLoginError(
        `Keystone at ${where} would not log in the credential in ${source}, and would not give it a token.${
          readApiErrorMessage(response.body)
            ? ` It said ${JSON.stringify(readApiErrorMessage(response.body))}.`
            : ""
        }`,
      );
    }

    if (status < 200 || status >= 300) {
      throw new OpenStackLoginError(
        `Keystone at ${where} answered the login with HTTP ${status}${
          readApiErrorMessage(response.body)
            ? `: ${readApiErrorMessage(response.body)}`
            : ""
        }. The agent reads nothing else of the cloud without a token.`,
      );
    }

    const tokenId: string = readString(response.headers["x-subject-token"]);
    let parsed: unknown = null;

    if (!response.truncated) {
      try {
        parsed = JSON.parse(response.body);
      } catch {
        parsed = null;
      }
    }

    if (!tokenId || !isPlainObject(parsed) || !isPlainObject(parsed["token"])) {
      throw new OpenStackLoginError(
        `${where} is not Keystone: it answered a login without a token. Use the auth_url the cloud's clouds.yaml or openrc says.`,
      );
    }

    return parseKeystoneToken({ tokenId, body: parsed });
  }

  // Which URL answers this call, or why none does (nothing was sent).
  private locate(data: {
    call: OpenStackCall;
    connection: OpenStackConnection;
    token: OpenStackToken;
  }): { baseUrl: string; regionName: string } | string {
    const { call, connection, token } = data;
    const regions: Array<string> = getCatalogRegions(token.catalog);
    const regionName: string | undefined =
      call.request.regionName ||
      connection.regionName ||
      regions[0] ||
      undefined;
    const service: string = SERVICE_NAMES[call.request.service];

    if (!regionName || regions.length === 0) {
      return `This credential's token has an empty catalog, so the agent does not know where ${service} answers. A token scoped to a project lists the services: give the credential a project.`;
    }

    const url: string | null = findCatalogEndpoint({
      catalog: token.catalog,
      service: call.request.service,
      regionName,
      endpointInterface: connection.endpointInterface,
    });

    if (!url) {
      return `The cloud's catalog has no ${connection.endpointInterface} endpoint for ${service} in region ${regionName}. Regions in the catalog: ${
        regions.join(", ") || "none"
      }. Name another with --os-region-name.`;
    }

    if (!SCHEME_PATTERN.test(url)) {
      return `The cloud's catalog names ${service} at a URL that is not http or https, so the agent sends it nothing.`;
    }

    return {
      baseUrl: toServiceBaseUrl(call.request.service, url),
      regionName,
    };
  }

  private userAgent(): string {
    return `${USER_AGENT_PREFIX}${this.options.config.agentVersion || "dev"}`;
  }

  /*
   * What Nova speaks, from its version document: one GET, once for each endpoint,
   * with no token. A Nova that will not say is asked with no microversion, which
   * every Nova answers. This is the one read beside a command's own call.
   */
  private async readComputeVersion(data: {
    baseUrl: string;
    connection: OpenStackConnection;
    ca: string | null;
    timeoutInMs: number;
  }): Promise<{ microversion: string | null; newest: string | null }> {
    const known:
      | { microversion: string | null; newest: string | null }
      | undefined = this.computeVersions.get(data.baseUrl);

    if (known) {
      return known;
    }

    let parsed: unknown = null;

    try {
      const response: OpenStackHttpResponse = await this.transport({
        method: "GET",
        url: getComputeRootUrl(data.baseUrl),
        headers: { Accept: "application/json", "User-Agent": this.userAgent() },
        body: null,
        verifyTls: data.connection.verifyTls,
        ca: data.ca,
        timeoutInMs: Math.max(1, Math.floor(data.timeoutInMs)),
        maxResponseBytes: MAX_OPENSTACK_RESPONSE_BYTES,
      });

      // A version document can come with 300 Multiple Choices, and is still the answer.
      if (
        (response.statusCode >= 200 && response.statusCode < 300) ||
        response.statusCode === 300
      ) {
        parsed = JSON.parse(response.body);
      } else {
        return { microversion: null, newest: null };
      }
    } catch {
      return { microversion: null, newest: null };
    }

    const chosen: { microversion: string | null; newest: string | null } =
      chooseComputeMicroversion(parsed);

    this.computeVersions.set(data.baseUrl, chosen);

    return chosen;
  }

  private async send(data: {
    call: OpenStackCall;
    connection: OpenStackConnection;
    ca: string | null;
    token: OpenStackToken;
    baseUrl: string;
    deadlineMs: number;
  }): Promise<{ response: OpenStackHttpResponse; url: string }> {
    const { call, connection } = data;
    const headers: Record<string, string> = {
      Accept: "application/json",
      "User-Agent": this.userAgent(),
      "X-Auth-Token": data.token.id,
    };
    const body: string | null =
      call.request.body === undefined ? null : JSON.stringify(call.request.body);

    if (body !== null) {
      headers["Content-Type"] = "application/json";
      headers["Content-Length"] = String(Buffer.byteLength(body, "utf8"));
    }

    if (call.request.service === "compute") {
      // A call that exists only up to some microversion says so itself.
      const version: { microversion: string | null } = call.request.microversion
        ? { microversion: call.request.microversion }
        : await this.readComputeVersion({
            baseUrl: data.baseUrl,
            connection,
            ca: data.ca,
            timeoutInMs: Math.max(1, data.deadlineMs - this.nowMs()),
          });

      if (version.microversion) {
        headers["OpenStack-API-Version"] = `compute ${version.microversion}`;
        headers["X-OpenStack-Nova-API-Version"] = version.microversion;
      }
    } else if (call.request.service === "volume") {
      headers["OpenStack-API-Version"] = `volume ${VOLUME_MICROVERSION}`;
    } else if (call.request.service === "placement") {
      headers["OpenStack-API-Version"] = `placement ${PLACEMENT_MICROVERSION}`;
    }

    const url: string = buildOpenStackUrl({
      baseUrl: data.baseUrl,
      request: call.request,
    });

    this.options.logger.debug("Calling the cloud's API", {
      service: call.request.service,
      path: call.request.path,
    });

    return {
      url,
      response: await this.transport({
        method: call.request.method,
        url,
        headers,
        body,
        verifyTls: connection.verifyTls,
        ca: data.ca,
        timeoutInMs: Math.max(1, Math.floor(data.deadlineMs - this.nowMs())),
        maxResponseBytes: MAX_OPENSTACK_RESPONSE_BYTES,
      }),
    };
  }

  private describeSendFailure(data: {
    call: OpenStackCall;
    connection: OpenStackConnection;
    err: unknown;
    baseUrl: string;
  }): ExecResult {
    const { call, err } = data;
    const service: string = SERVICE_NAMES[call.request.service];
    const message: string = this.redactText(
      describeTransportProblem({
        err,
        what: `${service}'s ${call.request.method} ${call.request.path}`,
        url: data.baseUrl,
        connection: data.connection,
        timeoutInMs: call.timeoutInMs,
      }),
    );

    // The request went out: it reads as "ran", and is said in the output.
    if (err instanceof OpenStackTransportError && err.mayHaveBeenSent) {
      return {
        success: false,
        output: formatResourceOutput({ stdout: "", stderr: message }),
        errorMessage: message,
      };
    }

    return { success: false, output: "", errorMessage: message };
  }

  // A service's answer, as a result.
  private describeAnswer(data: {
    call: OpenStackCall;
    response: OpenStackHttpResponse;
    regionName: string;
    token: OpenStackToken;
  }): ExecResult {
    const { call, response } = data;
    const status: number = response.statusCode;
    const service: string = SERVICE_NAMES[call.request.service];

    if (status >= 300 && status < 400) {
      // Nothing happened: a redirect is never followed, and the token stays here.
      return {
        success: false,
        output: "",
        errorMessage: `${service} answered GET ${call.request.path} with a redirect (HTTP ${status}), which the agent never follows, so its token stays with it. The cloud's catalog should name the API itself, not a proxy or a login page.`,
      };
    }

    if (status < 200 || status >= 300) {
      return this.describeHttpFailure({ ...data, connection: call.connection });
    }

    if (response.truncated) {
      return this.finish({
        success: true,
        exitCode: 0,
        stdout: `[${service}'s answer is larger than ${MAX_OPENSTACK_RESPONSE_BYTES} bytes, so the agent does not print it. Ask for less: --limit, or a filter.]`,
        stderr: "",
      });
    }

    let body: unknown;

    try {
      body = JSON.parse(response.body);
    } catch {
      return this.finish({
        success: false,
        exitCode: 1,
        stdout: this.limitRawText(response.body),
        stderr: `HTTP ${status}: the answer is not ${service}'s JSON`,
        errorMessage: `Exit code 1: the server at ${call.request.path} answered, but not as ${service} does (its answer is not JSON). Is the catalog's URL for it right?`,
      });
    }

    return this.finish({
      success: true,
      exitCode: 0,
      stdout: this.renderAnswer(call.request, body),
      stderr: "",
    });
  }

  private describeHttpFailure(data: {
    call: OpenStackCall;
    connection: OpenStackConnection;
    response: OpenStackHttpResponse;
    regionName: string;
    token: OpenStackToken;
  }): ExecResult {
    const { call, response, token } = data;
    const status: number = response.statusCode;
    const service: string = SERVICE_NAMES[call.request.service];
    const said: string =
      (response.truncated ? null : readApiErrorMessage(response.body)) ||
      shorten(response.statusMessage);
    const redactedSaid: string = this.redactText(said);
    const source: string = data.connection.credentialSource;
    const path: string = call.request.path;
    const isChange: boolean = call.request.method !== "GET";
    let advice: string = "";

    if (status === 401) {
      advice = token.hasAccessRules
        ? ` This credential is limited by access rules, and they do not list this path, or ${service} has no service_type set for keystonemiddleware. Make a new credential from the rules the OpenStack agent ships (access/${
            isChange
              ? "write-application-credential-access-rules.json"
              : "application-credential-access-rules.json"
          }), which list every ${isChange ? "change" : "read"} the AI agent makes.`
        : ` ${service} did not accept the token from ${source}: check that ${service}'s keystonemiddleware can validate tokens.`;
    } else if (status === 403) {
      advice = isChange
        ? ` The credential in ${source} may not make this change. The OpenStack agent's README says how to give the write credential the least it needs, on each way of deploying a cloud.`
        : ` The credential in ${source} may not read this. The OpenStack agent's README says what each level of access sees: hypervisors and services take level 1 or 2, and Cinder's services and pools level 1.`;
    } else if (status === 409 && isChange) {
      advice = ` ${service} will not do this while the thing it names is in the state it is in: read it again before trying anything else.`;
    } else if (status === 404) {
      advice = ` This cloud has no such thing, or ${service} here does not have this API.`;
    } else if (status === 300 || status === 406) {
      advice = ` This ${service} does not speak the API version the agent asked for.`;
    } else if (status >= 500) {
      advice = ` ${service} is failing in region ${data.regionName}, or something in front of it is: this is itself a finding.`;
    }

    return this.finish({
      success: false,
      exitCode: 1,
      stdout: "",
      stderr: `HTTP ${status}${redactedSaid ? ` ${redactedSaid}` : ""}`,
      errorMessage: `Exit code 1: ${service} answered ${call.request.method} ${path} with HTTP ${status}${
        redactedSaid ? ` (${redactedSaid})` : ""
      }.${advice}`,
    });
  }

  // ---- Output --------------------------------------------------------------------

  private renderAnswer(request: OpenStackApiRequest, body: unknown): string {
    const masked: unknown = maskSecretFields(body, (name: string): boolean => {
      return this.isSecretName(name);
    });
    const format: OpenStackOutputFormat = request.outputFormat || "table";
    const isSecretName: (name: string) => boolean = (name: string): boolean => {
      return this.isSecretName(name);
    };

    if (request.listKey === null) {
      return renderProxmoxData(
        unwrapObjectAnswer(masked),
        format === "json" ? "json-pretty" : "text",
        { budgetBytes: OPENSTACK_RENDER_BUDGET_BYTES, isSecretName },
      ).text;
    }

    const rows: unknown = isPlainObject(masked)
      ? masked[request.listKey]
      : undefined;

    if (!Array.isArray(rows)) {
      return `[The answer has no list of ${request.listKey}.]\n${
        renderProxmoxData(masked, "json-pretty", {
          budgetBytes: OPENSTACK_RENDER_BUDGET_BYTES,
          isSecretName,
        }).text
      }`;
    }

    const projected: Array<Row> = projectListRows(request.route, rows);

    if (projected.length === 0) {
      return format === "json"
        ? "[]"
        : `[No ${request.listKey} in this answer.]`;
    }

    const rendered: RenderedData = renderProxmoxData(
      projected,
      format === "json" ? "json-pretty" : "text",
      { budgetBytes: OPENSTACK_RENDER_BUDGET_BYTES, isSecretName },
    );
    const notes: Array<string> = [];

    if (rendered.omitted > 0) {
      notes.push(
        `... [${rendered.omitted} more rows not shown: the answer is longer than the agent prints. Ask for less with --limit or a filter.]`,
      );
    }

    const hasMore: boolean = this.saysThereIsMore({
      body: masked,
      listKey: request.listKey,
      rowCount: rows.length,
      limit: request.limit,
    });

    if (hasMore) {
      const last: Row | undefined = projected[projected.length - 1];
      const lastId: unknown = last ? last["id"] : undefined;

      notes.push(
        `... [There may be more than these ${rows.length} rows: this list stops at its limit. ${
          typeof lastId === "string" && lastId
            ? `Continue with --marker ${lastId}.`
            : "Narrow it with a filter."
        }]`,
      );
    }

    if (isPlainObject(masked) && masked["truncated"] === true) {
      notes.push(
        "... [Keystone cut this list at its own limit, and there are more rows than it answered. Narrow it with a filter.]",
      );
    }

    return [rendered.text, ...notes].join("\n");
  }

  // A next link says so, and a full page may mean it. Never followed: the agent makes one call.
  private saysThereIsMore(data: {
    body: unknown;
    listKey: string;
    rowCount: number;
    limit: number | null;
  }): boolean {
    if (isPlainObject(data.body)) {
      const links: unknown = data.body[`${data.listKey}_links`];

      if (
        Array.isArray(links) &&
        links.some((link: unknown): boolean => {
          return isPlainObject(link) && link["rel"] === "next";
        })
      ) {
        return true;
      }

      if (typeof data.body["next"] === "string" && data.body["next"]) {
        return true;
      }
    }

    return data.limit !== null && data.rowCount >= data.limit;
  }

  /*
   * Does the redactor mask a "<name>: value" line? The same judgement the redactor
   * makes, asked of it, so the parsed answer masks exactly the fields a key-value
   * rendering would have had masked.
   */
  private isSecretName(name: string): boolean {
    const cached: boolean | undefined = this.secretNames.get(name);

    if (cached !== undefined) {
      return cached;
    }

    const probe: string = `${name}: oneuptime-column-probe`;
    const secret: boolean = this.redactText(probe) !== probe;

    this.secretNames.set(name, secret);

    return secret;
  }

  private redactText(text: string): string {
    return redactOutput({
      resourceType: AiResourceType.OpenStackCloud,
      program: OPENSTACK_PROGRAM,
      text: replaceNulCharacters(text),
    });
  }

  // A body that is not the API's JSON, cut at a line before redaction.
  private limitRawText(text: string): string {
    if (Buffer.byteLength(text, "utf8") <= OPENSTACK_RENDER_BUDGET_BYTES) {
      return text;
    }

    const head: string = Buffer.from(text, "utf8")
      .subarray(0, OPENSTACK_RENDER_BUDGET_BYTES)
      .toString("utf8");
    const lastNewline: number = head.lastIndexOf("\n");

    return `${lastNewline > 0 ? head.slice(0, lastNewline) : ""}\n... [the rest of the answer is not shown]`;
  }

  /*
   * The job result: stdout and stderr each redacted, then formatted and capped at
   * MAX_RESOURCE_AGENT_OUTPUT_BYTES; the error message redacted too.
   */
  private finish(data: {
    success: boolean;
    exitCode: number;
    stdout: string;
    stderr: string;
    errorMessage?: string | undefined;
  }): ExecResult {
    const result: ExecResult = {
      success: data.success,
      exitCode: data.exitCode,
      output: formatResourceOutput({
        stdout: this.redactText(data.stdout),
        stderr: this.redactText(data.stderr),
        maxOutputBytes: MAX_RESOURCE_AGENT_OUTPUT_BYTES,
      }),
    };

    if (data.errorMessage) {
      result.errorMessage = this.redactText(data.errorMessage);
    }

    return result;
  }

  // ---- Posture -------------------------------------------------------------------

  /*
   * Whether an agent that may write has a credential that logs in. A credential for
   * changes that does not is found here, while a person can still fix it, rather
   * than on the night the fix is needed. A login is all this does with it.
   */
  private async probeWriteCredential(data: {
    connection: OpenStackConnection;
    ca: string | null;
    details: Record<string, string | number | boolean | null>;
  }): Promise<void> {
    if (!this.options.config.allowWrites) {
      return;
    }

    const write: OpenStackConnectionResult = resolveOpenStackWriteConnection({
      env: this.options.env,
      read: data.connection,
    });

    if (write.connection === null) {
      data.details["writeCredentialWorks"] = false;
      data.details["writeCredentialProblem"] = write.problem;
      return;
    }

    try {
      await this.getToken({
        connection: write.connection,
        ca: data.ca,
        timeoutInMs: POSTURE_REQUEST_TIMEOUT_MS,
      });
      data.details["writeCredentialWorks"] = true;
    } catch (err: unknown) {
      data.details["writeCredentialWorks"] = false;
      data.details["writeCredentialProblem"] = this.redactText(errorText(err));
    }
  }

  /*
   * A login (the credential works, and its catalog says where everything is), and
   * Nova's version document for what the cloud runs. Reachable means Keystone gave
   * a token. A cloud whose Nova is down is reachable, and its investigation is the
   * one that needs the agent most.
   */
  private async probe(): Promise<ResourcePostureProbe> {
    const resolved: OpenStackConnectionResult = resolveOpenStackConnection(
      this.options.env,
    );

    if (resolved.connection === null) {
      return {
        toolVersion: null,
        reachable: false,
        reachError: resolved.problem,
        details: {},
        protectedTargets: [],
      };
    }

    const connection: OpenStackConnection = resolved.connection;
    const details: Record<string, string | number | boolean | null> = {
      authUrl: connection.authUrl,
      credentialKind: connection.credential.kind,
      credentialSource: connection.isAgentCredential
        ? AI_OPENSTACK_CREDENTIAL_ID_ENV
        : "clouds.yaml",
      agentCredentialConfigured: connection.isAgentCredential,
      endpointInterface: connection.endpointInterface,
      tlsVerified: connection.authUrl.startsWith("https:")
        ? connection.verifyTls
        : false,
    };
    const unreachable: (reason: string) => ResourcePostureProbe = (
      reason: string,
    ): ResourcePostureProbe => {
      return {
        toolVersion: null,
        reachable: false,
        reachError: reason,
        details,
        protectedTargets: [],
      };
    };

    let ca: string | null;

    try {
      ca = this.readCa(connection);
    } catch (err: unknown) {
      return unreachable(
        `Could not read the CA file ${connection.caFile} (${
          errorCode(err) || errorText(err)
        }). Mount the cloud's certificate authority into the agent where clouds.yaml says it is.`,
      );
    }

    let token: OpenStackToken;

    try {
      token = await this.getToken({
        connection,
        ca,
        timeoutInMs: POSTURE_REQUEST_TIMEOUT_MS,
      });
    } catch (err: unknown) {
      return unreachable(this.redactText(errorText(err)));
    }

    const regions: Array<string> = getCatalogRegions(token.catalog);
    const regionName: string | null =
      connection.regionName || regions[0] || null;

    details["region"] = regionName;
    details["regions"] = regions.join(",");
    details["projectName"] = token.projectName;
    details["hasAccessRules"] = token.hasAccessRules;

    await this.probeWriteCredential({ connection, ca, details });

    let toolVersion: string | null = null;

    const compute: string | null = regionName
      ? findCatalogEndpoint({
          catalog: token.catalog,
          service: "compute",
          regionName,
          endpointInterface: connection.endpointInterface,
        })
      : null;

    if (compute) {
      const baseUrl: string = toServiceBaseUrl("compute", compute);
      const version: { newest: string | null } = await this.readComputeVersion({
        baseUrl,
        connection,
        ca,
        timeoutInMs: POSTURE_REQUEST_TIMEOUT_MS,
      });

      toolVersion = version.newest;
    } else {
      details["computeEndpoint"] = "not in the catalog";
    }

    return {
      toolVersion,
      reachable: true,
      reachError: null,
      details,
      protectedTargets: [],
    };
  }
}

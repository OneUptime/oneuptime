import RunbookVariableService from "../../Services/RunbookVariableService";
import RunnerService from "../../Services/RunnerService";
import Encryption from "../Encryption";
import logger from "../Logger";
import { buildServiceAccountKubeconfig } from "./ServiceAccountKubeconfig";
import RunbookVariable from "../../../Models/DatabaseModels/RunbookVariable";
import Runner from "../../../Models/DatabaseModels/Runner";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import {
  getKubectlScriptForLegacyKubernetesStep,
  isMovedKubernetesStepConfig,
  withoutLegacyKubernetesFields,
} from "../../../Types/Runbook/RunbookLegacySteps";
import {
  KubernetesStepConfig,
  SSHStepConfig,
  isLegacyKubernetesStepConfig,
  isLegacySSHStepConfig,
} from "../../../Types/Runbook/RunbookStep";
import RunbookStepType from "../../../Types/Runbook/RunbookStepType";
import {
  RUNBOOK_VARIABLE_NAME_MAX_LENGTH,
  RunbookVariableScope,
  formatRunbookVariableReference,
  isValidRunbookVariableName,
  rewriteLegacyRunbookSecretReferences,
} from "../../../Types/Runbook/RunbookVariableReference";

/*
 * RUNBOOK SECRETS AND THE CREDENTIALS RUNBOOK STEPS USED BECOME VARIABLES.
 *
 * Runbook variables took the place of runbook secrets, and of the
 * credentials SSH and Kubernetes steps named. This moves what a project had
 * into variables, once, so every runbook keeps running as it did:
 *
 *   - each runbook secret becomes a secret global variable of the same name
 *     (a name a variable cannot have is written with "_" for each character
 *     it may not hold), with the same value, description, Runners and
 *     global Runner switch; {{runbookSecrets.NAME}} in a Bash or JavaScript
 *     step becomes {{global.variables.NAME}} - the old spelling still reads
 *     the same, so a step written through the API later keeps working too;
 *   - each credential a runbook step names becomes secret global variables
 *     with the same Runners: an SSH credential's private key
 *     (<name>-ssh-key, and its passphrase, <name>-ssh-key-passphrase) or
 *     its password (<name>-ssh-password); a Kubernetes credential's API
 *     server URL, token and CA, as one kubeconfig (<name>-kubeconfig);
 *   - each SSH step that named a credential signs in to the credential's
 *     host, user and port with those variables, and runs its command as its
 *     script; each Kubernetes step runs the kubectl command that makes the
 *     change its action made - the same PATCH, so a service account allowed
 *     only "patch" still may (RunbookLegacySteps) - with the kubeconfig;
 *   - a Runner is updated on its owner's schedule. An SSH step's script is
 *     also sent as the command a Runner older than scripts runs, so a moved
 *     SSH step needs nothing more; a moved Kubernetes step needs a Runner
 *     that runs kubectl scripts, and an older one fails it, saying to
 *     update the Runner.
 *
 * The first release of this move kept each moved Kubernetes step's
 * credential and action beside its script, for a Runner older than kubectl
 * scripts. Runbook credentials are gone now, and that with them: a moved
 * step that still keeps them has them taken off (withoutLegacyKubernetesFields).
 *
 * A step whose credential is gone, or holds nothing to sign in with, is
 * left as it was: it fails as it would have. The secrets table
 * ("RunbookSecret" and "RunbookSecretRunner") stays; nothing writes to it any
 * more. The credentials table ("RunbookCredential" and
 * "RunbookCredentialRunner") stays too, emptied by the data migration that
 * removed runbook credentials (RunbookCredentialsRemoval) once it moved
 * what the steps still named.
 *
 * Read through statements written against the legacy tables, as the
 * migrations made them, since their models are gone; written through the
 * variable service (which encrypts the values) and, for the steps, one
 * statement per runbook - the runbook's own checks would refuse a runbook
 * that still names a credential. Safe to run twice: a variable whose name
 * is there already is taken as moved, and a step moved already takes a
 * script, so it is not moved again and its credential is not read. Never
 * throws for one project: its failure is logged, and the others go on.
 *
 * Run by the Workers' data migrations MoveRunbookSecretsAndCredentialsToVariables
 * (secrets and credentials) and RemoveRunbookCredentials (credentials only,
 * moveSecrets false: a secret variable deleted since the first move is never
 * made again), and tested against a migrated Postgres
 * (Tests/Server/Utils/Runbook/RunbookVariablesMovePostgres.test.ts).
 */

export type LegacyQuery = (
  sql: string,
  parameters?: Array<unknown>,
) => Promise<unknown>;

// A RunbookSecret row as the Postgres driver returns it.
export interface LegacyRunbookSecretRow {
  _id: string;
  projectId: string;
  name: string | null;
  description: string | null;
  secretValue: string | null;
  isAvailableToGlobalRunners: boolean | null;
  createdByUserId: string | null;
}

// A runbook whose steps may need moving, as the driver returns it.
export interface RunbookStepsRow {
  _id: string;
  projectId: string;
  steps: unknown;
}

export const LEGACY_SECRET_TABLE_SQL: string = `SELECT to_regclass('"RunbookSecret"') IS NOT NULL AS "hasSecretTable", to_regclass('"RunbookSecretRunner"') IS NOT NULL AS "hasSecretRunnerTable"`;

export const LEGACY_SECRETS_SQL: string = `SELECT "_id", "projectId", "name", "description", "secretValue", "isAvailableToGlobalRunners", "createdByUserId" FROM "RunbookSecret" WHERE "deletedAt" IS NULL ORDER BY "projectId", "createdAt", "_id"`;

export const LEGACY_SECRET_RUNNERS_SQL: string = `SELECT "runbookSecretId", "runnerId" FROM "RunbookSecretRunner"`;

export const LEGACY_CREDENTIAL_TABLE_SQL: string = `SELECT to_regclass('"RunbookCredential"') IS NOT NULL AS "hasCredentialTable", to_regclass('"RunbookCredentialRunner"') IS NOT NULL AS "hasCredentialRunnerTable"`;

// The credentials of one project ($1) a move needs ($2, an array of ids).
export const LEGACY_CREDENTIALS_SQL: string = `SELECT "_id", "name", "credentialType", "sshHostname", "sshPort", "sshUsername", "sshPrivateKey", "sshPassphrase", "sshPassword", "kubernetesApiServerUrl", "kubernetesServiceAccountToken", "kubernetesCaCertificate", "createdByUserId" FROM "RunbookCredential" WHERE "projectId" = $1 AND "_id" = ANY($2::uuid[]) AND "deletedAt" IS NULL`;

// The Runners those credentials ($1, an array of ids) were assigned to.
export const LEGACY_CREDENTIAL_RUNNERS_SQL: string = `SELECT "runbookCredentialId", "runnerId" FROM "RunbookCredentialRunner" WHERE "runbookCredentialId" = ANY($1::uuid[])`;

// A RunbookCredential row as the Postgres driver returns it.
export interface LegacyRunbookCredentialRow {
  _id: string;
  name: string | null;
  credentialType: string | null;
  sshHostname: string | null;
  sshPort: number | null;
  sshUsername: string | null;
  sshPrivateKey: string | null;
  sshPassphrase: string | null;
  sshPassword: string | null;
  kubernetesApiServerUrl: string | null;
  kubernetesServiceAccountToken: string | null;
  kubernetesCaCertificate: string | null;
  createdByUserId: string | null;
}

// Which legacy credential tables a database has.
export interface LegacyCredentialTables {
  hasCredentialTable: boolean;
  hasCredentialRunnerTable: boolean;
}

// The two kinds of credential, as the legacy table spells them.
export const LEGACY_SSH_CREDENTIAL_TYPE: string = "SSH";
export const LEGACY_KUBERNETES_CREDENTIAL_TYPE: string = "Kubernetes";

/*
 * What a password field wrote into an encrypted column before issue #3807
 * was fixed: the ciphertext inside '{"_type":"HashedString","value":"..."}'.
 * The model's service read through it (DatabaseService); a credential is
 * read here without the model, so the envelope is unwrapped here too.
 */
const HASHED_STRING_ENVELOPE_PREFIX: string =
  '{"_type":"HashedString","value":"';

/*
 * The runbooks whose steps may name a credential or a runbook secret. Read
 * as text and filtered there first, so a project's other runbooks are never
 * read at all; each one found is read in full below.
 */
export const RUNBOOKS_TO_MOVE_SQL: string = `SELECT "_id", "projectId", "steps" FROM "Runbook" WHERE "deletedAt" IS NULL AND "steps" IS NOT NULL AND ("steps"::text LIKE '%credentialId%' OR "steps"::text LIKE '%runbookSecrets.%') ORDER BY "projectId", "_id"`;

export const PROJECT_GLOBAL_VARIABLE_NAMES_SQL: string = `SELECT "name" FROM "RunbookVariable" WHERE "projectId" = $1 AND "runbookId" IS NULL AND "deletedAt" IS NULL`;

export const UPDATE_RUNBOOK_STEPS_SQL: string = `UPDATE "Runbook" SET "steps" = $1::jsonb, "updatedAt" = now(), "version" = "version" + 1 WHERE "_id" = $2 AND "projectId" = $3 AND "deletedAt" IS NULL`;

export interface RunbookVariablesMoveSummary {
  secretsMoved: number;
  secretsAlreadyMoved: number;
  secretsSkipped: number;
  credentialsMoved: number;
  stepsMoved: number;
  runbooksRewritten: number;
  projectsFailed: number;
}

// What one run of the move does.
export interface RunbookVariablesMoveOptions {
  /*
   * Move runbook secrets too (the first move did). Off for the move the
   * removal of runbook credentials runs: every secret moved the first time,
   * and a variable deleted since must not be made again from the legacy
   * table.
   */
  moveSecrets: boolean;
}

export const MOVED_FROM_CREDENTIAL_DESCRIPTION: string =
  'Moved from the runbook credential "{{name}}" when runbook steps started taking variables.';

/*
 * A name a variable can have, from what a secret or a credential was
 * called: every character a variable's name may not hold written as "_",
 * cut to the length a name may be, and `fallback` for one that is empty.
 */
export function toVariableName(name: string, fallback: string): string {
  let result: string = "";

  for (let index: number = 0; index < (name || "").trim().length; index++) {
    const character: string = (name || "").trim()[index]!;

    result += isValidRunbookVariableName(character) ? character : "_";
  }

  result = result.slice(0, RUNBOOK_VARIABLE_NAME_MAX_LENGTH);

  return isValidRunbookVariableName(result) ? result : fallback;
}

/*
 * The names one project's global variables take, so two things moved in
 * one run never share one, and a name that was there before the run is
 * known as moved already.
 */
export class VariableNames {
  private readonly existing: Set<string>;
  private readonly allocated: Set<string> = new Set<string>();

  public constructor(existingNames: Array<string>) {
    this.existing = new Set<string>(
      existingNames.map((name: string): string => {
        return name.toLowerCase();
      }),
    );
  }

  // Whether a variable of this name was there before this run.
  public existedBefore(name: string): boolean {
    return this.existing.has(name.toLowerCase());
  }

  /*
   * A free name for something new: `name`, or `name-2`, `name-3`, ... when
   * that one is taken (names are unique whatever their case).
   */
  public allocate(name: string): string {
    let candidate: string = name;
    let suffix: number = 2;

    while (
      this.existing.has(candidate.toLowerCase()) ||
      this.allocated.has(candidate.toLowerCase())
    ) {
      const tail: string = `-${suffix}`;
      candidate = `${name.slice(0, RUNBOOK_VARIABLE_NAME_MAX_LENGTH - tail.length)}${tail}`;
      suffix++;
    }

    this.allocated.add(candidate.toLowerCase());

    return candidate;
  }

  // Marks `name` as the project's, when something takes it as it is.
  public take(name: string): void {
    this.allocated.add(name.toLowerCase());
  }
}

function readRows<T>(rows: unknown): Array<T> {
  return Array.isArray(rows) ? (rows as Array<T>) : [];
}

function readSteps(value: unknown): Array<JSONObject> | null {
  let steps: unknown = value;

  if (typeof steps === "string") {
    try {
      steps = JSON.parse(steps);
    } catch {
      return null;
    }
  }

  return Array.isArray(steps) ? (steps as Array<JSONObject>) : null;
}

function reference(name: string): string {
  return formatRunbookVariableReference({
    scope: RunbookVariableScope.Global,
    name,
  });
}

// The variables one credential became, by what each holds.
export interface MovedCredential {
  // LEGACY_SSH_CREDENTIAL_TYPE or LEGACY_KUBERNETES_CREDENTIAL_TYPE.
  credentialType: string;
  // SSH
  host?: string | undefined;
  username?: string | undefined;
  port?: number | undefined;
  signInVariable?: string | undefined;
  passphraseVariable?: string | undefined;
  // Kubernetes
  kubeconfigVariable?: string | undefined;
}

/*
 * A step, moved: an SSH step that named a credential signs in with its
 * variables and runs its command as its script; a Kubernetes step runs the
 * kubectl command its action made, with the kubeconfig; a Kubernetes step
 * moved already that kept its credential and action for an older Runner
 * has them taken off; a Bash or JavaScript step names variables where it
 * named runbook secrets. Null when nothing about the step changes.
 */
export function moveStep(data: {
  step: JSONObject;
  credentials: Map<string, MovedCredential>;
  secretNames: Map<string, string>;
}): JSONObject | null {
  const type: unknown = data.step["type"];
  const config: unknown = data.step["config"];

  if (!config || typeof config !== "object" || Array.isArray(config)) {
    return null;
  }

  const values: JSONObject = config as JSONObject;

  if (type === RunbookStepType.Bash || type === RunbookStepType.JavaScript) {
    const script: unknown = values["script"];

    if (typeof script !== "string") {
      return null;
    }

    const rewritten: string = rewriteLegacyRunbookSecretReferences(
      script,
      (secretName: string): string | undefined => {
        return data.secretNames.get(secretName);
      },
    );

    return rewritten === script
      ? null
      : { ...data.step, config: { ...values, script: rewritten } };
  }

  if (type === RunbookStepType.SSH && isLegacySSHStepConfig(values)) {
    const legacy: SSHStepConfig = values as unknown as SSHStepConfig;
    const moved: MovedCredential | undefined = data.credentials.get(
      String(legacy.credentialId || "").toLowerCase(),
    );

    if (
      !moved ||
      moved.credentialType !== LEGACY_SSH_CREDENTIAL_TYPE ||
      !moved.signInVariable ||
      !moved.host ||
      !moved.username
    ) {
      return null;
    }

    const next: JSONObject = {
      host: moved.host,
      username: moved.username,
      ...(moved.port && moved.port !== 22 ? { port: moved.port } : {}),
      signIn: reference(moved.signInVariable),
      ...(moved.passphraseVariable
        ? { passphrase: reference(moved.passphraseVariable) }
        : {}),
      script: legacy.command || "",
      agentId: legacy.agentId || "",
      ...(legacy.timeoutInMs !== undefined
        ? { timeoutInMs: legacy.timeoutInMs }
        : {}),
      ...(legacy.claimTimeoutInMs !== undefined
        ? { claimTimeoutInMs: legacy.claimTimeoutInMs }
        : {}),
    };

    return { ...data.step, config: next };
  }

  /*
   * Moved already by the first release of this move, which kept the step's
   * credential and action for an older Runner: they are taken off, as
   * runbook credentials are gone.
   */
  if (
    type === RunbookStepType.Kubernetes &&
    isMovedKubernetesStepConfig(values)
  ) {
    return {
      ...data.step,
      config: withoutLegacyKubernetesFields(values),
    };
  }

  if (
    type === RunbookStepType.Kubernetes &&
    isLegacyKubernetesStepConfig(values)
  ) {
    const legacy: KubernetesStepConfig =
      values as unknown as KubernetesStepConfig;
    const moved: MovedCredential | undefined = data.credentials.get(
      String(legacy.credentialId || "").toLowerCase(),
    );

    if (
      !moved ||
      moved.credentialType !== LEGACY_KUBERNETES_CREDENTIAL_TYPE ||
      !moved.kubeconfigVariable
    ) {
      return null;
    }

    const next: JSONObject = {
      kubeconfig: reference(moved.kubeconfigVariable),
      script: getKubectlScriptForLegacyKubernetesStep(legacy),
      agentId: legacy.agentId || "",
      ...(legacy.timeoutInMs !== undefined
        ? { timeoutInMs: legacy.timeoutInMs }
        : {}),
      ...(legacy.claimTimeoutInMs !== undefined
        ? { claimTimeoutInMs: legacy.claimTimeoutInMs }
        : {}),
    };

    return { ...data.step, config: next };
  }

  return null;
}

/*
 * The credentials `steps` name, each once, in lower case: those of the
 * steps a move rewrites, which name a credential and take no script. A
 * step moved already (one that kept its credential beside its script) is
 * not moved again, and its credential is not read.
 */
export function getCredentialIdsInSteps(
  steps: Array<JSONObject>,
): Array<string> {
  const ids: Set<string> = new Set<string>();

  for (const step of steps) {
    const type: unknown = step["type"];
    const config: unknown = step["config"];

    if (
      (type !== RunbookStepType.SSH && type !== RunbookStepType.Kubernetes) ||
      !config ||
      typeof config !== "object" ||
      (type === RunbookStepType.SSH && !isLegacySSHStepConfig(config)) ||
      (type === RunbookStepType.Kubernetes &&
        !isLegacyKubernetesStepConfig(config))
    ) {
      continue;
    }

    const id: unknown = (config as JSONObject)["credentialId"];

    if (typeof id === "string" && ObjectID.isValidUUID(id.trim())) {
      ids.add(id.trim().toLowerCase());
    }
  }

  return [...ids];
}

export default class RunbookVariablesMove {
  public static async moveAll(
    query: LegacyQuery = RunbookVariablesMove.defaultQuery(),
    options: RunbookVariablesMoveOptions = { moveSecrets: true },
  ): Promise<RunbookVariablesMoveSummary> {
    const summary: RunbookVariablesMoveSummary = {
      secretsMoved: 0,
      secretsAlreadyMoved: 0,
      secretsSkipped: 0,
      credentialsMoved: 0,
      stepsMoved: 0,
      runbooksRewritten: 0,
      projectsFailed: 0,
    };

    const tables: Record<string, unknown> | undefined = options.moveSecrets
      ? readRows<Record<string, unknown>>(await query(LEGACY_SECRET_TABLE_SQL))[0]
      : undefined;

    const secrets: Array<LegacyRunbookSecretRow> = tables?.["hasSecretTable"]
      ? readRows<LegacyRunbookSecretRow>(await query(LEGACY_SECRETS_SQL))
      : [];

    const secretRunners: Map<string, Array<string>> = new Map<
      string,
      Array<string>
    >();

    if (tables?.["hasSecretRunnerTable"]) {
      for (const row of readRows<Record<string, unknown>>(
        await query(LEGACY_SECRET_RUNNERS_SQL),
      )) {
        const secretId: string = String(row["runbookSecretId"] || "");
        const runnerId: string = String(row["runnerId"] || "");

        if (
          !ObjectID.isValidUUID(secretId) ||
          !ObjectID.isValidUUID(runnerId)
        ) {
          continue;
        }

        const list: Array<string> = secretRunners.get(secretId) || [];
        list.push(runnerId);
        secretRunners.set(secretId, list);
      }
    }

    const credentialTables: Record<string, unknown> | undefined = readRows<
      Record<string, unknown>
    >(await query(LEGACY_CREDENTIAL_TABLE_SQL))[0];

    const legacyCredentialTables: LegacyCredentialTables = {
      hasCredentialTable: credentialTables?.["hasCredentialTable"] === true,
      hasCredentialRunnerTable:
        credentialTables?.["hasCredentialRunnerTable"] === true,
    };

    const runbooks: Array<RunbookStepsRow> = readRows<RunbookStepsRow>(
      await query(RUNBOOKS_TO_MOVE_SQL),
    );

    const projectIds: Array<string> = [
      ...new Set<string>([
        ...secrets.map((secret: LegacyRunbookSecretRow): string => {
          return String(secret.projectId);
        }),
        ...runbooks.map((runbook: RunbookStepsRow): string => {
          return String(runbook.projectId);
        }),
      ]),
    ].filter((id: string): boolean => {
      return ObjectID.isValidUUID(id);
    });

    for (const projectId of projectIds) {
      try {
        await RunbookVariablesMove.moveProject({
          projectId,
          secrets: secrets.filter((secret: LegacyRunbookSecretRow) => {
            return String(secret.projectId) === projectId;
          }),
          secretRunners,
          runbooks: runbooks.filter((runbook: RunbookStepsRow) => {
            return String(runbook.projectId) === projectId;
          }),
          legacyCredentialTables,
          query,
          summary,
        });
      } catch (err) {
        summary.projectsFailed++;
        logger.error(
          `RunbookVariablesMove: the runbook secrets and credentials of project ${projectId} could not be moved to variables:`,
        );
        logger.error(err);
      }
    }

    return summary;
  }

  public static async moveProject(data: {
    projectId: string;
    secrets: Array<LegacyRunbookSecretRow>;
    secretRunners: Map<string, Array<string>>;
    runbooks: Array<RunbookStepsRow>;
    // Which legacy credential tables there are; none read for none.
    legacyCredentialTables?: LegacyCredentialTables | undefined;
    query: LegacyQuery;
    summary: RunbookVariablesMoveSummary;
  }): Promise<void> {
    const projectId: ObjectID = new ObjectID(data.projectId);

    const names: VariableNames = new VariableNames(
      readRows<Record<string, unknown>>(
        await data.query(PROJECT_GLOBAL_VARIABLE_NAMES_SQL, [data.projectId]),
      ).map((row: Record<string, unknown>): string => {
        return String(row["name"] || "");
      }),
    );

    // What each secret's name is as a variable, for the steps that name it.
    const secretNames: Map<string, string> = new Map<string, string>();

    for (const secret of data.secrets) {
      const original: string = String(secret.name || "");
      const name: string = toVariableName(
        original,
        `secret-${String(secret._id).slice(0, 8)}`,
      );

      if (names.existedBefore(name)) {
        secretNames.set(original.trim(), name);
        names.take(name);
        data.summary.secretsAlreadyMoved++;
        continue;
      }

      const value: string = await RunbookVariablesMove.readSecret(
        secret.secretValue,
      );

      if (!value) {
        // A secret with no value filled nothing in; nothing to move.
        data.summary.secretsSkipped++;
        continue;
      }

      const allocated: string = names.allocate(name);

      await RunbookVariablesMove.createSecretVariable({
        projectId,
        name: allocated,
        description: secret.description || undefined,
        secretValue: value,
        runnerIds: data.secretRunners.get(String(secret._id)) || [],
        isAvailableToGlobalRunners: secret.isAvailableToGlobalRunners === true,
        createdByUserId: secret.createdByUserId || undefined,
      });

      secretNames.set(original.trim(), allocated);
      data.summary.secretsMoved++;
    }

    // The credentials the project's runbooks name.
    const stepsByRunbook: Array<{
      runbook: RunbookStepsRow;
      steps: Array<JSONObject>;
    }> = [];
    const credentialIds: Set<string> = new Set<string>();

    for (const runbook of data.runbooks) {
      const steps: Array<JSONObject> | null = readSteps(runbook.steps);

      if (!steps) {
        continue;
      }

      stepsByRunbook.push({ runbook, steps });

      for (const id of getCredentialIdsInSteps(steps)) {
        credentialIds.add(id);
      }
    }

    const credentials: Map<string, MovedCredential> =
      await RunbookVariablesMove.moveCredentials({
        projectId,
        credentialIds: [...credentialIds],
        names,
        tables: data.legacyCredentialTables || {
          hasCredentialTable: true,
          hasCredentialRunnerTable: true,
        },
        query: data.query,
        summary: data.summary,
      });

    for (const { runbook, steps } of stepsByRunbook) {
      let changed: number = 0;

      const next: Array<JSONObject> = steps.map(
        (step: JSONObject): JSONObject => {
          if (!step || typeof step !== "object") {
            return step;
          }

          const moved: JSONObject | null = moveStep({
            step,
            credentials,
            secretNames,
          });

          if (!moved) {
            return step;
          }

          changed++;
          return moved;
        },
      );

      if (changed === 0) {
        continue;
      }

      await data.query(UPDATE_RUNBOOK_STEPS_SQL, [
        JSON.stringify(next),
        runbook._id,
        data.projectId,
      ]);

      data.summary.stepsMoved += changed;
      data.summary.runbooksRewritten++;
    }
  }

  /*
   * The variables each credential the steps name becomes, by credential id
   * (lower case). A credential of another project, one that is gone, or one
   * with nothing to sign in with, becomes none - and so does every one when
   * the legacy table is gone. Read from the legacy table, as the migrations
   * made it (its model is gone), each secret decrypted here.
   */
  public static async moveCredentials(data: {
    projectId: ObjectID;
    credentialIds: Array<string>;
    names: VariableNames;
    tables: LegacyCredentialTables;
    query: LegacyQuery;
    summary: RunbookVariablesMoveSummary;
  }): Promise<Map<string, MovedCredential>> {
    const moved: Map<string, MovedCredential> = new Map<
      string,
      MovedCredential
    >();

    if (data.credentialIds.length === 0 || !data.tables.hasCredentialTable) {
      return moved;
    }

    const credentials: Array<LegacyRunbookCredentialRow> =
      readRows<LegacyRunbookCredentialRow>(
        await data.query(LEGACY_CREDENTIALS_SQL, [
          data.projectId.toString(),
          data.credentialIds,
        ]),
      );

    const credentialRunners: Map<string, Array<string>> =
      await RunbookVariablesMove.readCredentialRunners({
        credentialIds: credentials.map(
          (credential: LegacyRunbookCredentialRow): string => {
            return String(credential._id);
          },
        ),
        tables: data.tables,
        query: data.query,
      });

    for (const credential of credentials) {
      const id: string = String(credential._id || "").toLowerCase();

      if (!ObjectID.isValidUUID(id)) {
        continue;
      }

      const base: string = toVariableName(
        credential.name || "",
        `credential-${id.slice(0, 8)}`,
      ).slice(0, RUNBOOK_VARIABLE_NAME_MAX_LENGTH - 30);

      const description: string = MOVED_FROM_CREDENTIAL_DESCRIPTION.replace(
        "{{name}}",
        (credential.name || "").slice(0, 200),
      );

      const common: {
        projectId: ObjectID;
        description: string;
        runnerIds: Array<string>;
        isAvailableToGlobalRunners: boolean;
        createdByUserId?: string | undefined;
      } = {
        projectId: data.projectId,
        description,
        runnerIds: credentialRunners.get(id) || [],
        isAvailableToGlobalRunners: false,
        createdByUserId: credential.createdByUserId
          ? String(credential.createdByUserId)
          : undefined,
      };

      if (credential.credentialType === LEGACY_SSH_CREDENTIAL_TYPE) {
        const key: string = await RunbookVariablesMove.readSecret(
          credential.sshPrivateKey,
        );
        const password: string = await RunbookVariablesMove.readSecret(
          credential.sshPassword,
        );

        if (!key && !password) {
          continue;
        }

        const signInVariable: string =
          await RunbookVariablesMove.ensureVariable({
            names: data.names,
            name: `${base}-ssh-${key ? "key" : "password"}`,
            secretValue: key || password,
            ...common,
          });

        const passphrase: string = key
          ? await RunbookVariablesMove.readSecret(credential.sshPassphrase)
          : "";

        let passphraseVariable: string | undefined = undefined;

        if (passphrase) {
          passphraseVariable = await RunbookVariablesMove.ensureVariable({
            names: data.names,
            name: `${base}-ssh-key-passphrase`,
            secretValue: passphrase,
            ...common,
          });
        }

        moved.set(id, {
          credentialType: LEGACY_SSH_CREDENTIAL_TYPE,
          host: credential.sshHostname || "",
          username: credential.sshUsername || "",
          port: credential.sshPort || 22,
          signInVariable,
          passphraseVariable,
        });
        data.summary.credentialsMoved++;
        continue;
      }

      if (credential.credentialType === LEGACY_KUBERNETES_CREDENTIAL_TYPE) {
        const token: string = await RunbookVariablesMove.readSecret(
          credential.kubernetesServiceAccountToken,
        );

        if (!credential.kubernetesApiServerUrl || !token) {
          continue;
        }

        const kubeconfigVariable: string =
          await RunbookVariablesMove.ensureVariable({
            names: data.names,
            name: `${base}-kubeconfig`,
            secretValue: buildServiceAccountKubeconfig({
              apiServerUrl: credential.kubernetesApiServerUrl,
              token,
              caCertificate: credential.kubernetesCaCertificate || undefined,
              name: base,
            }),
            ...common,
          });

        moved.set(id, {
          credentialType: LEGACY_KUBERNETES_CREDENTIAL_TYPE,
          kubeconfigVariable,
        });
        data.summary.credentialsMoved++;
      }
    }

    return moved;
  }

  /*
   * The Runners each of these credentials was assigned to, by credential id
   * (lower case). None when the join table is gone.
   */
  private static async readCredentialRunners(data: {
    credentialIds: Array<string>;
    tables: LegacyCredentialTables;
    query: LegacyQuery;
  }): Promise<Map<string, Array<string>>> {
    const runners: Map<string, Array<string>> = new Map<
      string,
      Array<string>
    >();

    if (data.credentialIds.length === 0 || !data.tables.hasCredentialRunnerTable) {
      return runners;
    }

    for (const row of readRows<Record<string, unknown>>(
      await data.query(LEGACY_CREDENTIAL_RUNNERS_SQL, [data.credentialIds]),
    )) {
      const credentialId: string = String(
        row["runbookCredentialId"] || "",
      ).toLowerCase();
      const runnerId: string = String(row["runnerId"] || "");

      if (
        !ObjectID.isValidUUID(credentialId) ||
        !ObjectID.isValidUUID(runnerId)
      ) {
        continue;
      }

      const list: Array<string> = runners.get(credentialId) || [];
      list.push(runnerId);
      runners.set(credentialId, list);
    }

    return runners;
  }

  /*
   * The variable `name`: taken as it is when it was there before this run
   * (an earlier run made it), made otherwise - under a free name.
   */
  public static async ensureVariable(data: {
    names: VariableNames;
    name: string;
    projectId: ObjectID;
    description: string;
    secretValue: string;
    runnerIds: Array<string>;
    isAvailableToGlobalRunners: boolean;
    createdByUserId?: string | undefined;
  }): Promise<string> {
    if (data.names.existedBefore(data.name)) {
      data.names.take(data.name);
      return data.name;
    }

    const allocated: string = data.names.allocate(data.name);

    await RunbookVariablesMove.createSecretVariable({
      projectId: data.projectId,
      name: allocated,
      description: data.description,
      secretValue: data.secretValue,
      runnerIds: data.runnerIds,
      isAvailableToGlobalRunners: data.isAvailableToGlobalRunners,
      createdByUserId: data.createdByUserId,
    });

    return allocated;
  }

  public static async createSecretVariable(data: {
    projectId: ObjectID;
    name: string;
    description?: string | undefined;
    secretValue: string;
    runnerIds: Array<string>;
    isAvailableToGlobalRunners: boolean;
    createdByUserId?: string | undefined;
  }): Promise<void> {
    /*
     * A secret is never assigned to a kubernetes-agent Runner (its identity
     * the project's ingestion key can mint): one assigned before that rule
     * keeps its other Runners.
     */
    const agentRunners: Array<Runner> =
      data.runnerIds.length > 0
        ? await RunnerService.findKubernetesAgentRunners(
            data.runnerIds.map((id: string): JSONObject => {
              return { _id: id };
            }),
          )
        : [];

    const agentRunnerIds: Set<string> = new Set<string>(
      agentRunners.map((runner: Runner): string => {
        return runner.id?.toString() || "";
      }),
    );

    const variable: RunbookVariable = new RunbookVariable();
    variable.projectId = data.projectId;
    variable.name = data.name;
    variable.isSecret = true;
    variable.secretValue = data.secretValue;
    variable.isAvailableToGlobalRunners = data.isAvailableToGlobalRunners;

    if (data.description) {
      variable.description = data.description.slice(0, 500);
    }

    if (data.createdByUserId && ObjectID.isValidUUID(data.createdByUserId)) {
      variable.createdByUserId = new ObjectID(data.createdByUserId);
    }

    variable.runners = data.runnerIds
      .filter((id: string): boolean => {
        return !agentRunnerIds.has(id);
      })
      .map((id: string): Runner => {
        const runner: Runner = new Runner();
        runner._id = id;
        return runner;
      });

    await RunbookVariableService.create({
      data: variable,
      props: {
        isRoot: true,
        tenantId: data.projectId,
      },
    });
  }

  /*
   * A legacy secret's value, as stored (ciphertext) or as written before -
   * and, for a credential's password field, inside the HashedString
   * envelope issue #3807 left (HASHED_STRING_ENVELOPE_PREFIX).
   */
  public static async readSecret(
    value: string | null | undefined,
  ): Promise<string> {
    if (!value) {
      return "";
    }

    const stored: string = RunbookVariablesMove.unwrapHashedStringEnvelope(
      value,
    );

    return Encryption.looksEncrypted(stored)
      ? await Encryption.decrypt(stored)
      : stored;
  }

  // The string inside a HashedString envelope, or `value` as it is.
  public static unwrapHashedStringEnvelope(value: string): string {
    if (!value.startsWith(HASHED_STRING_ENVELOPE_PREFIX)) {
      return value;
    }

    try {
      const parsed: unknown = JSON.parse(value);

      if (
        parsed &&
        typeof parsed === "object" &&
        typeof (parsed as Record<string, unknown>)["value"] === "string"
      ) {
        return (parsed as Record<string, unknown>)["value"] as string;
      }
    } catch {
      // Not JSON after all: kept as it is.
    }

    return value;
  }

  private static defaultQuery(): LegacyQuery {
    return async (
      sql: string,
      parameters?: Array<unknown>,
    ): Promise<unknown> => {
      return await RunbookVariableService.getRepository().manager.query(
        sql,
        parameters,
      );
    };
  }
}

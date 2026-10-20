import RunbookJobVariables, {
  PreparedJobVariables,
} from "../../FeatureSet/Runbook/Utils/JobVariables";
import RunbookVariableService from "Common/Server/Services/RunbookVariableService";
import RunbookVariable from "Common/Models/DatabaseModels/RunbookVariable";
import Runner from "Common/Models/DatabaseModels/Runner";
import RunnerJob from "Common/Models/DatabaseModels/RunnerJob";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import RunbookStepType from "Common/Types/Runbook/RunbookStepType";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * A RUNBOOK STEP'S VARIABLES, FILLED IN FOR THE RUNNER THAT TOOK IT
 * (RunbookJobVariables.prepare), with the real rule for who may have what
 * (RunbookVariableResolver) over a stubbed table:
 *
 *   - a Bash or JavaScript step: its script, filled in;
 *   - an SSH step: its host, user, port and script filled in - the script
 *     also as `command`, which a Runner older than scripts runs - and its
 *     key (with its passphrase) or its password as the credential, told
 *     apart by the value;
 *   - a kubectl step: its script, and its kubeconfig as the credential;
 *     none when it uses the Runner's own access;
 *   - a step that names what it may not have is refused, with the reason
 *     and never a value.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const RUNNER_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);

const PRIVATE_KEY: string =
  "-----BEGIN OPENSSH PRIVATE KEY-----\nb3BlbnNzaC1rZXk=\n-----END OPENSSH PRIVATE KEY-----";

const KUBECONFIG: string = "apiVersion: v1\nkind: Config\n";

function secret(name: string, value: string): RunbookVariable {
  return Object.assign(new RunbookVariable(), {
    name,
    isSecret: true,
    secretValue: value,
    isAvailableToGlobalRunners: false,
    runners: [Object.assign(new Runner(), { _id: RUNNER_ID.toString() })],
  });
}

function plain(name: string, value: string): RunbookVariable {
  return Object.assign(new RunbookVariable(), {
    name,
    isSecret: false,
    value,
  });
}

let rows: Array<RunbookVariable>;

beforeEach(() => {
  rows = [
    plain("DB_HOST", "10.0.4.21"),
    plain("DB_USER", "deploy"),
    secret("DB_KEY", PRIVATE_KEY),
    secret("DB_KEY_PASSPHRASE", "open sesame"),
    secret("DB_PASSWORD", "hunter2-hunter2"),
    secret("PROD_KUBECONFIG", KUBECONFIG),
  ];

  jest
    .spyOn(RunbookVariableService, "findBy")
    .mockImplementation(async (): Promise<never> => {
      return rows as never;
    });
});

afterEach(() => {
  jest.restoreAllMocks();
});

function job(stepType: RunbookStepType, fields: JSONObject): RunnerJob {
  return Object.assign(new RunnerJob(), {
    _id: ObjectID.generate().toString(),
    projectId: PROJECT_ID,
    stepType,
    script: "",
    ...fields,
  });
}

function prepare(claimed: RunnerJob): Promise<PreparedJobVariables> {
  return RunbookJobVariables.prepare({
    job: claimed,
    projectId: PROJECT_ID,
    runbookId: null,
    access: { kind: "project-runner", runnerId: RUNNER_ID },
  });
}

function prepared(
  result: PreparedJobVariables,
): Extract<PreparedJobVariables, { isRefused: false }> {
  if (result.isRefused) {
    throw new Error(`Refused: ${result.refusal}`);
  }

  return result;
}

describe("a Bash step", () => {
  test("its script, filled in, and the secrets it was handed", async () => {
    const result: PreparedJobVariables = await prepare(
      job(RunbookStepType.Bash, {
        script:
          "PGPASSWORD='{{global.variables.DB_PASSWORD}}' psql -h {{global.variables.DB_HOST}}",
      }),
    );

    expect(prepared(result)).toEqual({
      isRefused: false,
      script: "PGPASSWORD='hunter2-hunter2' psql -h 10.0.4.21",
      secretValues: ["hunter2-hunter2"],
    });
  });
});

describe("an SSH step that takes a script", () => {
  function sshJob(payload: JSONObject): RunnerJob {
    return job(RunbookStepType.SSH, {
      payload: {
        host: "{{global.variables.DB_HOST}}",
        username: "{{global.variables.DB_USER}}",
        port: 2222,
        signIn: "{{global.variables.DB_KEY}}",
        passphrase: "{{global.variables.DB_KEY_PASSPHRASE}}",
        script: "psql -h localhost -c 'select 1'",
        ...payload,
      },
    });
  }

  test("a key signs in, with its passphrase; the script is sent as the command too", async () => {
    const result: Extract<PreparedJobVariables, { isRefused: false }> =
      prepared(await prepare(sshJob({})));

    expect(result.script).toBe("");
    expect(result.payload).toEqual({
      host: "10.0.4.21",
      username: "deploy",
      port: 2222,
      script: "psql -h localhost -c 'select 1'",
      command: "psql -h localhost -c 'select 1'",
    });
    expect(result.credential).toEqual({
      credentialType: "SSH",
      hostname: "10.0.4.21",
      port: 2222,
      username: "deploy",
      privateKey: PRIVATE_KEY,
      passphrase: "open sesame",
    });
    expect(result.secretValues.sort()).toEqual(
      [PRIVATE_KEY, "open sesame"].sort(),
    );
  });

  test("a password signs in as a password, and the passphrase is not asked for", async () => {
    const result: Extract<PreparedJobVariables, { isRefused: false }> =
      prepared(
        await prepare(
          sshJob({
            signIn: "{{global.variables.DB_PASSWORD}}",
            passphrase: "",
            port: undefined,
          }),
        ),
      );

    expect(result.credential).toEqual({
      credentialType: "SSH",
      hostname: "10.0.4.21",
      port: 22,
      username: "deploy",
      password: "hunter2-hunter2",
    });
  });

  test("a sign-in that is a plain variable is refused: keys and passwords are secrets", async () => {
    const result: PreparedJobVariables = await prepare(
      sshJob({ signIn: "{{global.variables.DB_HOST}}", passphrase: "" }),
    );

    expect(result).toEqual({
      isRefused: true,
      refusal:
        'This step names variables it cannot use, so it was not run: "DB_HOST" is not a secret variable (keep a key, a password or a kubeconfig in a secret variable).',
    });
  });

  test("a sign-in that is not one reference is refused", async () => {
    const result: PreparedJobVariables = await prepare(
      sshJob({ signIn: "hunter2", passphrase: "" }),
    );

    expect(result).toEqual({
      isRefused: true,
      refusal:
        "This step's key, password or kubeconfig is not one secret variable, so it was not run. Open the step and pick a secret variable.",
    });
  });

  test("a host that fills in empty is refused", async () => {
    rows.push(plain("EMPTY", " "));

    const result: PreparedJobVariables = await prepare(
      sshJob({ host: "{{global.variables.EMPTY}}" }),
    );

    expect(result).toEqual({
      isRefused: true,
      refusal:
        "This SSH step has no machine to sign in to: its host or user is empty. Open the step and fill in SSH to.",
    });
  });

  test("a secret its Runner may not use is refused, and its value is never handed over", async () => {
    rows = rows.map((row: RunbookVariable): RunbookVariable => {
      return row.name === "DB_KEY" ? Object.assign(row, { runners: [] }) : row;
    });

    const result: PreparedJobVariables = await prepare(sshJob({}));

    expect(result.isRefused).toBe(true);
    expect(JSON.stringify(result)).not.toContain("OPENSSH");
    expect((result as { refusal: string }).refusal).toContain(
      'this Runner may not use the secret "DB_KEY"',
    );
  });
});

describe("a kubectl step that takes a script", () => {
  test("its script, and its kubeconfig as the credential", async () => {
    const result: Extract<PreparedJobVariables, { isRefused: false }> =
      prepared(
        await prepare(
          job(RunbookStepType.Kubernetes, {
            payload: {
              kubeconfig: "{{global.variables.PROD_KUBECONFIG}}",
              script: "kubectl get pods -n {{global.variables.DB_USER}}",
            },
          }),
        ),
      );

    expect(result.payload).toEqual({
      script: "kubectl get pods -n deploy",
    });
    expect(result.credential).toEqual({
      credentialType: "Kubeconfig",
      kubeconfig: KUBECONFIG,
    });
    expect(result.secretValues).toEqual([KUBECONFIG]);
  });

  test("no kubeconfig: the Runner's own access, no credential", async () => {
    const result: Extract<PreparedJobVariables, { isRefused: false }> =
      prepared(
        await prepare(
          job(RunbookStepType.Kubernetes, {
            payload: { kubeconfig: "", script: "kubectl get nodes" },
          }),
        ),
      );

    expect(result).toEqual({
      isRefused: false,
      script: "",
      payload: { script: "kubectl get nodes" },
      secretValues: [],
    });
  });

  test("a kubeconfig that is not there is refused, saying where to add it", async () => {
    const result: PreparedJobVariables = await prepare(
      job(RunbookStepType.Kubernetes, {
        payload: {
          kubeconfig: "{{global.variables.STAGING_KUBECONFIG}}",
          script: "kubectl get nodes",
        },
      }),
    );

    expect(result).toEqual({
      isRefused: true,
      refusal:
        'This step names variables it cannot use, so it was not run: there is no global variable named "STAGING_KUBECONFIG" (Runbooks → Settings → Global Variables).',
    });
  });
});

describe("which jobs take variables", () => {
  test("script steps, and SSH and kubectl steps that take a script - never one written with a credential", () => {
    expect(
      RunbookJobVariables.usesVariables(job(RunbookStepType.Bash, {})),
    ).toBe(true);
    expect(
      RunbookJobVariables.usesVariables(
        job(RunbookStepType.SSH, { payload: { script: "ls" } }),
      ),
    ).toBe(true);
    expect(
      RunbookJobVariables.usesVariables(
        job(RunbookStepType.SSH, {
          payload: { credentialId: "c1", command: "ls" },
        }),
      ),
    ).toBe(false);
    expect(
      RunbookJobVariables.usesVariables(
        job(RunbookStepType.Kubectl, { payload: { argv: ["get", "pods"] } }),
      ),
    ).toBe(false);
  });
});

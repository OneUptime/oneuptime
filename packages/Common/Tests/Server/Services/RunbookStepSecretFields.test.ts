import RunbookService, {
  STEP_SECRET_IN_STEP_MESSAGE,
  Service as RunbookServiceType,
} from "../../../Server/Services/RunbookService";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import UpdateBy from "../../../Server/Types/Database/UpdateBy";
import Runbook from "../../../Models/DatabaseModels/Runbook";
import BadDataException from "../../../Types/Exception/BadDataException";
import ObjectID from "../../../Types/ObjectID";
import RunbookStepType from "../../../Types/Runbook/RunbookStepType";
import { afterEach, describe, expect, jest, test } from "@jest/globals";

jest.mock("../../../Server/Utils/Logger");

/*
 * A KEY, A PASSWORD OR A KUBECONFIG IS NEVER KEPT IN A STEP.
 *
 * A runbook's steps are a JSON column everyone who may read the runbook
 * reads. The fields an SSH step signs in with (signIn, passphrase) and a
 * kubectl step's kubeconfig hold one secret runbook variable's reference -
 * {{global.variables.NAME}} - or nothing. Anything else written there, by
 * the API or a form, is refused on create and on update, before anything
 * is stored, saying what to do instead.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "0193c0de-dddd-4aaa-8bbb-000000000001",
);

interface BeforeReferencesAccess {
  checkCreateBeforeReferences(createBy: CreateBy<Runbook>): Promise<void>;
  checkUpdateBeforeReferences(updateBy: UpdateBy<Runbook>): Promise<void>;
}

const hooks: BeforeReferencesAccess =
  RunbookService as unknown as BeforeReferencesAccess;

afterEach(() => {
  jest.restoreAllMocks();
});

// A step as the steps JSON column holds it.
type StepJson = Record<string, unknown>;

function ssh(
  config: Record<string, unknown>,
  title: string = "Restart nginx",
): StepJson {
  return {
    id: "s1",
    order: 0,
    type: RunbookStepType.SSH,
    title,
    config: {
      host: "10.0.4.21",
      username: "deploy",
      script: "uptime",
      ...config,
    },
  };
}

function kubectl(config: Record<string, unknown>): StepJson {
  return {
    id: "k1",
    order: 1,
    type: RunbookStepType.Kubernetes,
    title: "List pods",
    config: { script: "kubectl get pods", ...config },
  };
}

describe("getStepSecretFieldRefusal", () => {
  test.each([
    [
      "a secret variable to sign in with",
      [ssh({ signIn: "{{global.variables.KEY}}" })],
    ],
    [
      "a runbook's own one, and a passphrase",
      [
        ssh({
          signIn: " {{local.variables.KEY}} ",
          passphrase: "{{global.variables.KEY_PASSPHRASE}}",
        }),
      ],
    ],
    ["no sign-in yet", [ssh({ signIn: "" })]],
    [
      "a kubeconfig variable",
      [kubectl({ kubeconfig: "{{global.variables.KC}}" })],
    ],
    ["the Runner's own access", [kubectl({ kubeconfig: "" })]],
    [
      "a step written with a credential",
      [ssh({ credentialId: "c1", command: "ls" })],
    ],
    [
      "a step of another type with a field of that name",
      [
        {
          type: RunbookStepType.Bash,
          config: { signIn: "hunter2", script: "ls" },
        },
      ],
    ],
  ])("lets %s through", (_label: string, steps: Array<unknown>) => {
    expect(RunbookServiceType.getStepSecretFieldRefusal(steps)).toBeNull();
  });

  test.each([
    ["a password typed into the sign-in", ssh({ signIn: "hunter2" })],
    [
      "a private key pasted into it",
      ssh({ signIn: "-----BEGIN OPENSSH PRIVATE KEY-----\nb3Blbg==" }),
    ],
    [
      "a reference with text around it",
      ssh({ signIn: "x{{global.variables.KEY}}" }),
    ],
    ["a passphrase typed in", ssh({ passphrase: "open sesame" })],
    ["a sign-in that is not text", ssh({ signIn: { key: "k" } })],
  ])("refuses %s, naming the step", (_label: string, step: unknown) => {
    expect(RunbookServiceType.getStepSecretFieldRefusal([step])).toBe(
      `The step "Restart nginx" ${STEP_SECRET_IN_STEP_MESSAGE}`,
    );
  });

  test("refuses a kubeconfig pasted into a kubectl step", () => {
    expect(
      RunbookServiceType.getStepSecretFieldRefusal([
        kubectl({ kubeconfig: "apiVersion: v1\nkind: Config" }),
      ]),
    ).toBe(`The step "List pods" ${STEP_SECRET_IN_STEP_MESSAGE}`);
  });

  test("names a step with no title by its type", () => {
    expect(
      RunbookServiceType.getStepSecretFieldRefusal([
        { type: RunbookStepType.SSH, config: { signIn: "hunter2" } },
      ]),
    ).toBe(`The step of type SSH ${STEP_SECRET_IN_STEP_MESSAGE}`);
  });

  test("reads nothing from what is not a list of steps", () => {
    expect(RunbookServiceType.getStepSecretFieldRefusal(undefined)).toBeNull();
    expect(RunbookServiceType.getStepSecretFieldRefusal("steps")).toBeNull();
    expect(RunbookServiceType.getStepSecretFieldRefusal([null, 3])).toBeNull();
  });
});

describe("a write that keeps a secret in a step is refused before anything is stored", () => {
  test("on create", async () => {
    const createBy: CreateBy<Runbook> = {
      data: Object.assign(new Runbook(), {
        projectId: PROJECT_ID,
        steps: [ssh({ signIn: "hunter2" })],
      }),
      props: { isRoot: true },
    } as unknown as CreateBy<Runbook>;

    await expect(hooks.checkCreateBeforeReferences(createBy)).rejects.toEqual(
      new BadDataException(
        `The step "Restart nginx" ${STEP_SECRET_IN_STEP_MESSAGE}`,
      ),
    );
  });

  test("on update", async () => {
    const updateBy: UpdateBy<Runbook> = {
      query: { _id: ObjectID.generate() },
      data: { steps: [kubectl({ kubeconfig: "apiVersion: v1" })] },
      props: { isRoot: true },
    } as unknown as UpdateBy<Runbook>;

    await expect(hooks.checkUpdateBeforeReferences(updateBy)).rejects.toEqual(
      new BadDataException(
        `The step "List pods" ${STEP_SECRET_IN_STEP_MESSAGE}`,
      ),
    );
  });

  test("and a write that keeps references only goes on", async () => {
    const createBy: CreateBy<Runbook> = {
      data: Object.assign(new Runbook(), {
        projectId: PROJECT_ID,
        steps: [
          ssh({ signIn: "{{global.variables.KEY}}" }),
          kubectl({ kubeconfig: "" }),
        ],
      }),
      props: { isRoot: true },
    } as unknown as CreateBy<Runbook>;

    await expect(
      hooks.checkCreateBeforeReferences(createBy),
    ).resolves.toBeUndefined();
  });
});

import RunbookCredentialService from "../../../Server/Services/RunbookCredentialService";
import RunbookCredential from "../../../Models/DatabaseModels/RunbookCredential";
import RunbookCredentialType from "../../../Types/Runbook/RunbookCredentialType";
import BadDataException from "../../../Types/Exception/BadDataException";
import ObjectID from "../../../Types/ObjectID";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import { OnCreate } from "../../../Server/Types/Database/Hooks";
import { afterEach, describe, expect, it } from "@jest/globals";

/*
 * Contract under test — RunbookCredentialService.onBeforeCreate, the only
 * point at which a credential's shape is checked.
 *
 * A credential is write-only by design: once created, nobody can read the
 * secret columns back through the API to see what is wrong with them. So a
 * half-filled credential is not discovered when it is saved — it is
 * discovered when a runbook step tries to use it, which is on the far side of
 * an approval, during an incident. That makes creation the last honest
 * opportunity to reject it.
 *
 * The two things being pinned here:
 *
 *   - each credential type requires exactly the fields its executor will
 *     actually dereference (SSH: host + user + one of key/password;
 *     Kubernetes: API server + service account token),
 *   - the requirements do NOT bleed across types. The columns live on one
 *     shared table, so an SSH credential carries null Kubernetes columns and
 *     vice versa. If validation were written against the columns rather than
 *     against the type, every credential would be unsaveable.
 *
 * No database — the hook is pure, so it is called directly.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);

const PRIVATE_KEY: string =
  "-----BEGIN OPENSSH PRIVATE KEY-----\nnot-a-real-key\n-----END OPENSSH PRIVATE KEY-----";

/*
 * onBeforeCreate is protected, as every DatabaseService hook is. Reaching it
 * through a narrow interface (rather than `as any`) keeps the call
 * type-checked against the real signature, so a change to the hook's shape
 * breaks this file instead of silently passing.
 */
interface CreateHookAccess {
  onBeforeCreate(
    createBy: CreateBy<RunbookCredential>,
  ): Promise<OnCreate<RunbookCredential>>;
}

function onBeforeCreate(
  createBy: CreateBy<RunbookCredential>,
): Promise<OnCreate<RunbookCredential>> {
  return (
    RunbookCredentialService as unknown as CreateHookAccess
  ).onBeforeCreate(createBy);
}

/*
 * Every field optional and explicitly `| undefined`: Common runs with
 * exactOptionalPropertyTypes, so a test that wants to say "this field is
 * absent" has to be allowed to pass undefined for it.
 */
interface CredentialFields {
  credentialType?: RunbookCredentialType | undefined;
  sshHostname?: string | undefined;
  sshPort?: number | undefined;
  sshUsername?: string | undefined;
  sshPrivateKey?: string | undefined;
  sshPassphrase?: string | undefined;
  sshPassword?: string | undefined;
  kubernetesApiServerUrl?: string | undefined;
  kubernetesServiceAccountToken?: string | undefined;
  kubernetesCaCertificate?: string | undefined;
}

function makeCreateBy(fields: CredentialFields): CreateBy<RunbookCredential> {
  const model: RunbookCredential = new RunbookCredential();
  model.name = "prod-credential";
  model.projectId = PROJECT_ID;

  /*
   * Assigned by key rather than field-by-field so that "absent" really means
   * the property was never set, not that it was set to undefined.
   */
  for (const [key, value] of Object.entries(fields)) {
    if (value !== undefined) {
      (model as unknown as Record<string, unknown>)[key] = value;
    }
  }

  return {
    data: model,
    props: { isRoot: true },
  } as CreateBy<RunbookCredential>;
}

// A credential of each type that has everything it needs.
function completeSshFields(): CredentialFields {
  return {
    credentialType: RunbookCredentialType.SSH,
    sshHostname: "10.0.4.21",
    sshUsername: "deploy",
    sshPrivateKey: PRIVATE_KEY,
  };
}

function completeKubernetesFields(): CredentialFields {
  return {
    credentialType: RunbookCredentialType.Kubernetes,
    kubernetesApiServerUrl: "https://10.0.0.1:6443",
    kubernetesServiceAccountToken: "eyJhbGciOiJSUzI1NiJ9.token",
  };
}

describe("RunbookCredentialService.onBeforeCreate", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("credential type", () => {
    it("rejects a credential with no type", async () => {
      /*
       * The type decides which columns are meaningful. Without it there is
       * nothing to validate against and no executor knows what to do with the
       * row, so this must never reach the table.
       */
      await expect(onBeforeCreate(makeCreateBy({}))).rejects.toThrow(
        BadDataException,
      );
    });

    it("names the credential type in the rejection", async () => {
      await expect(onBeforeCreate(makeCreateBy({}))).rejects.toThrow(
        /credential type/i,
      );
    });

    it("rejects a blank type the same as a missing one", async () => {
      // A select left untouched posts "" rather than omitting the field.
      await expect(
        onBeforeCreate(
          makeCreateBy({
            ...completeSshFields(),
            credentialType: "" as RunbookCredentialType,
          }),
        ),
      ).rejects.toThrow(BadDataException);
    });

    it("rejects on the missing type before looking at any secret field", async () => {
      /*
       * A row carrying complete SSH material but no type is still rejected —
       * the type is not inferred from whichever columns happen to be filled
       * in, because guessing would let a typo choose an executor.
       */
      const fields: CredentialFields = completeSshFields();
      delete fields.credentialType;

      await expect(onBeforeCreate(makeCreateBy(fields))).rejects.toThrow(
        /credential type/i,
      );
    });

    it("has validation for every type the enum offers", () => {
      /*
       * The hook validates SSH and Kubernetes by name and lets anything else
       * through unchecked. That is safe only while those are the only two
       * members. Adding a third to the enum has to come with a branch here —
       * this assertion is the reminder.
       */
      expect(Object.values(RunbookCredentialType).sort()).toEqual(
        ["Kubernetes", "SSH"].sort(),
      );
    });
  });

  describe("SSH credentials", () => {
    it("rejects one with no hostname", async () => {
      const fields: CredentialFields = completeSshFields();
      delete fields.sshHostname;

      await expect(onBeforeCreate(makeCreateBy(fields))).rejects.toThrow(
        BadDataException,
      );
    });

    it("names the hostname in that rejection", async () => {
      const fields: CredentialFields = completeSshFields();
      delete fields.sshHostname;

      await expect(onBeforeCreate(makeCreateBy(fields))).rejects.toThrow(
        /hostname/i,
      );
    });

    it("treats a blank hostname as a missing one", async () => {
      await expect(
        onBeforeCreate(
          makeCreateBy({ ...completeSshFields(), sshHostname: "" }),
        ),
      ).rejects.toThrow(/hostname/i);
    });

    it("rejects one with no username", async () => {
      const fields: CredentialFields = completeSshFields();
      delete fields.sshUsername;

      await expect(onBeforeCreate(makeCreateBy(fields))).rejects.toThrow(
        BadDataException,
      );
    });

    it("names the username in that rejection", async () => {
      const fields: CredentialFields = completeSshFields();
      delete fields.sshUsername;

      await expect(onBeforeCreate(makeCreateBy(fields))).rejects.toThrow(
        /username/i,
      );
    });

    it("treats a blank username as a missing one", async () => {
      await expect(
        onBeforeCreate(
          makeCreateBy({ ...completeSshFields(), sshUsername: "" }),
        ),
      ).rejects.toThrow(/username/i);
    });

    it("rejects one carrying neither a private key nor a password", async () => {
      /*
       * Host and user without any authentication material is a credential
       * that cannot authenticate. The SSH executor would connect and be
       * refused, mid-incident.
       */
      const fields: CredentialFields = completeSshFields();
      delete fields.sshPrivateKey;

      await expect(onBeforeCreate(makeCreateBy(fields))).rejects.toThrow(
        BadDataException,
      );
    });

    it("names both accepted forms of authentication in that rejection", async () => {
      const fields: CredentialFields = completeSshFields();
      delete fields.sshPrivateKey;

      const error: unknown = await onBeforeCreate(makeCreateBy(fields)).catch(
        (thrown: unknown) => {
          return thrown;
        },
      );

      expect(error).toBeInstanceOf(BadDataException);
      expect((error as BadDataException).message).toMatch(/private key/i);
      expect((error as BadDataException).message).toMatch(/password/i);
    });

    it("treats blank key and blank password as no authentication at all", async () => {
      await expect(
        onBeforeCreate(
          makeCreateBy({
            ...completeSshFields(),
            sshPrivateKey: "",
            sshPassword: "",
          }),
        ),
      ).rejects.toThrow(BadDataException);
    });

    it("accepts a private key alone", async () => {
      await expect(
        onBeforeCreate(makeCreateBy(completeSshFields())),
      ).resolves.toBeDefined();
    });

    it("accepts a passphrase-protected private key", async () => {
      await expect(
        onBeforeCreate(
          makeCreateBy({
            ...completeSshFields(),
            sshPassphrase: "unlock-me",
          }),
        ),
      ).resolves.toBeDefined();
    });

    it("accepts a password alone", async () => {
      const fields: CredentialFields = completeSshFields();
      delete fields.sshPrivateKey;
      fields.sshPassword = "hunter2";

      await expect(onBeforeCreate(makeCreateBy(fields))).resolves.toBeDefined();
    });

    it("accepts both a private key and a password", async () => {
      await expect(
        onBeforeCreate(
          makeCreateBy({ ...completeSshFields(), sshPassword: "hunter2" }),
        ),
      ).resolves.toBeDefined();
    });

    it("does not require any Kubernetes field", async () => {
      /*
       * Both types share one table, so an SSH row's Kubernetes columns are
       * null by definition. Requiring them would make SSH credentials
       * impossible to create.
       */
      const fields: CredentialFields = completeSshFields();

      expect(fields.kubernetesApiServerUrl).toBeUndefined();
      expect(fields.kubernetesServiceAccountToken).toBeUndefined();

      await expect(onBeforeCreate(makeCreateBy(fields))).resolves.toBeDefined();
    });

    it("ignores Kubernetes fields that happen to be filled in", async () => {
      // Stray cross-type data is not this hook's business, and not an error.
      await expect(
        onBeforeCreate(
          makeCreateBy({
            ...completeSshFields(),
            ...completeKubernetesFields(),
            credentialType: RunbookCredentialType.SSH,
          }),
        ),
      ).resolves.toBeDefined();
    });

    it("is not rescued by Kubernetes fields when its own are missing", async () => {
      /*
       * The inverse of the case above, and the one that matters: filled-in
       * Kubernetes columns must not count towards an SSH credential's
       * requirements.
       */
      await expect(
        onBeforeCreate(
          makeCreateBy({
            ...completeKubernetesFields(),
            credentialType: RunbookCredentialType.SSH,
          }),
        ),
      ).rejects.toThrow(/hostname/i);
    });

    it("does not require a port — the executor defaults to 22", async () => {
      const fields: CredentialFields = completeSshFields();

      expect(fields.sshPort).toBeUndefined();

      await expect(onBeforeCreate(makeCreateBy(fields))).resolves.toBeDefined();
    });

    it("accepts an explicit port", async () => {
      await expect(
        onBeforeCreate(makeCreateBy({ ...completeSshFields(), sshPort: 2222 })),
      ).resolves.toBeDefined();
    });
  });

  describe("Kubernetes credentials", () => {
    it("rejects one with no API server URL", async () => {
      const fields: CredentialFields = completeKubernetesFields();
      delete fields.kubernetesApiServerUrl;

      await expect(onBeforeCreate(makeCreateBy(fields))).rejects.toThrow(
        BadDataException,
      );
    });

    it("names the API server URL in that rejection", async () => {
      const fields: CredentialFields = completeKubernetesFields();
      delete fields.kubernetesApiServerUrl;

      await expect(onBeforeCreate(makeCreateBy(fields))).rejects.toThrow(
        /api server url/i,
      );
    });

    it("treats a blank API server URL as a missing one", async () => {
      await expect(
        onBeforeCreate(
          makeCreateBy({
            ...completeKubernetesFields(),
            kubernetesApiServerUrl: "",
          }),
        ),
      ).rejects.toThrow(/api server url/i);
    });

    it("rejects one with no service account token", async () => {
      const fields: CredentialFields = completeKubernetesFields();
      delete fields.kubernetesServiceAccountToken;

      await expect(onBeforeCreate(makeCreateBy(fields))).rejects.toThrow(
        BadDataException,
      );
    });

    it("names the service account token in that rejection", async () => {
      const fields: CredentialFields = completeKubernetesFields();
      delete fields.kubernetesServiceAccountToken;

      await expect(onBeforeCreate(makeCreateBy(fields))).rejects.toThrow(
        /service account token/i,
      );
    });

    it("treats a blank service account token as a missing one", async () => {
      await expect(
        onBeforeCreate(
          makeCreateBy({
            ...completeKubernetesFields(),
            kubernetesServiceAccountToken: "",
          }),
        ),
      ).rejects.toThrow(/service account token/i);
    });

    it("accepts an API server URL and a token together", async () => {
      await expect(
        onBeforeCreate(makeCreateBy(completeKubernetesFields())),
      ).resolves.toBeDefined();
    });

    it("does not require a CA certificate", async () => {
      /*
       * Optional on purpose: some API servers present a certificate the
       * Runner's host trust store already accepts.
       */
      const fields: CredentialFields = completeKubernetesFields();

      expect(fields.kubernetesCaCertificate).toBeUndefined();

      await expect(onBeforeCreate(makeCreateBy(fields))).resolves.toBeDefined();
    });

    it("accepts a CA certificate when one is supplied", async () => {
      await expect(
        onBeforeCreate(
          makeCreateBy({
            ...completeKubernetesFields(),
            kubernetesCaCertificate:
              "-----BEGIN CERTIFICATE-----\nca\n-----END CERTIFICATE-----",
          }),
        ),
      ).resolves.toBeDefined();
    });

    it("does not require any SSH field", async () => {
      const fields: CredentialFields = completeKubernetesFields();

      expect(fields.sshHostname).toBeUndefined();
      expect(fields.sshUsername).toBeUndefined();
      expect(fields.sshPrivateKey).toBeUndefined();
      expect(fields.sshPassword).toBeUndefined();

      await expect(onBeforeCreate(makeCreateBy(fields))).resolves.toBeDefined();
    });

    it("ignores SSH fields that happen to be filled in", async () => {
      await expect(
        onBeforeCreate(
          makeCreateBy({
            ...completeKubernetesFields(),
            ...completeSshFields(),
            credentialType: RunbookCredentialType.Kubernetes,
          }),
        ),
      ).resolves.toBeDefined();
    });

    it("is not rescued by SSH fields when its own are missing", async () => {
      await expect(
        onBeforeCreate(
          makeCreateBy({
            ...completeSshFields(),
            credentialType: RunbookCredentialType.Kubernetes,
          }),
        ),
      ).rejects.toThrow(/api server url/i);
    });
  });

  describe("what a successful validation hands back", () => {
    it("returns the same createBy object it was given", async () => {
      const createBy: CreateBy<RunbookCredential> =
        makeCreateBy(completeSshFields());

      const result: OnCreate<RunbookCredential> =
        await onBeforeCreate(createBy);

      expect(result.createBy).toBe(createBy);
    });

    it("leaves every field on the model exactly as posted", async () => {
      /*
       * This hook validates; it does not normalise. If it ever started
       * defaulting a port or trimming a token, the value written to the
       * encrypted column would stop matching what the operator entered — and
       * because the column is write-only, nobody could ever see that it had.
       */
      const createBy: CreateBy<RunbookCredential> = makeCreateBy({
        ...completeSshFields(),
        sshPassphrase: "unlock-me",
        sshPassword: "hunter2",
      });

      const result: OnCreate<RunbookCredential> =
        await onBeforeCreate(createBy);
      const data: RunbookCredential = result.createBy.data;

      expect(data.credentialType).toBe(RunbookCredentialType.SSH);
      expect(data.name).toBe("prod-credential");
      expect(data.projectId).toBe(PROJECT_ID);
      expect(data.sshHostname).toBe("10.0.4.21");
      expect(data.sshUsername).toBe("deploy");
      expect(data.sshPrivateKey).toBe(PRIVATE_KEY);
      expect(data.sshPassphrase).toBe("unlock-me");
      expect(data.sshPassword).toBe("hunter2");
      expect(data.sshPort).toBeUndefined();
    });

    it("does not invent Kubernetes values on an SSH credential", async () => {
      const result: OnCreate<RunbookCredential> = await onBeforeCreate(
        makeCreateBy(completeSshFields()),
      );

      expect(result.createBy.data.kubernetesApiServerUrl).toBeUndefined();
      expect(
        result.createBy.data.kubernetesServiceAccountToken,
      ).toBeUndefined();
      expect(result.createBy.data.kubernetesCaCertificate).toBeUndefined();
    });

    it("does not invent SSH values on a Kubernetes credential", async () => {
      const result: OnCreate<RunbookCredential> = await onBeforeCreate(
        makeCreateBy(completeKubernetesFields()),
      );

      expect(result.createBy.data.sshHostname).toBeUndefined();
      expect(result.createBy.data.sshUsername).toBeUndefined();
      expect(result.createBy.data.sshPrivateKey).toBeUndefined();
      expect(result.createBy.data.sshPassword).toBeUndefined();
      expect(result.createBy.data.sshPort).toBeUndefined();
    });

    it("passes the caller's props through untouched", async () => {
      const createBy: CreateBy<RunbookCredential> = makeCreateBy(
        completeKubernetesFields(),
      );
      const props: unknown = createBy.props;

      const result: OnCreate<RunbookCredential> =
        await onBeforeCreate(createBy);

      expect(result.createBy.props).toBe(props);
    });

    it("carries nothing forward to the after-create hook", async () => {
      const result: OnCreate<RunbookCredential> = await onBeforeCreate(
        makeCreateBy(completeSshFields()),
      );

      expect(result.carryForward).toEqual([]);
    });
  });

  describe("every rejection is a BadDataException", () => {
    /*
     * Not cosmetic: the CRUD layer turns BadDataException into a 400 with the
     * message shown to the operator. Anything else surfaces as a 500 with no
     * explanation, and the operator is left guessing which field was wrong
     * while looking at a form whose secret fields never render their value.
     */
    const invalidCases: Array<{ name: string; fields: CredentialFields }> = [
      { name: "no type", fields: {} },
      {
        name: "SSH without a hostname",
        fields: {
          credentialType: RunbookCredentialType.SSH,
          sshUsername: "deploy",
          sshPrivateKey: PRIVATE_KEY,
        },
      },
      {
        name: "SSH without a username",
        fields: {
          credentialType: RunbookCredentialType.SSH,
          sshHostname: "10.0.4.21",
          sshPrivateKey: PRIVATE_KEY,
        },
      },
      {
        name: "SSH without any authentication",
        fields: {
          credentialType: RunbookCredentialType.SSH,
          sshHostname: "10.0.4.21",
          sshUsername: "deploy",
        },
      },
      {
        name: "Kubernetes without an API server URL",
        fields: {
          credentialType: RunbookCredentialType.Kubernetes,
          kubernetesServiceAccountToken: "eyJhbGciOiJSUzI1NiJ9.token",
        },
      },
      {
        name: "Kubernetes without a token",
        fields: {
          credentialType: RunbookCredentialType.Kubernetes,
          kubernetesApiServerUrl: "https://10.0.0.1:6443",
        },
      },
    ];

    it.each(invalidCases)(
      "$name is rejected with a message an operator can act on",
      async ({ fields }: { fields: CredentialFields }) => {
        const error: unknown = await onBeforeCreate(makeCreateBy(fields)).catch(
          (thrown: unknown) => {
            return thrown;
          },
        );

        expect(error).toBeInstanceOf(BadDataException);

        const message: string = (error as BadDataException).message;

        expect(message.length).toBeGreaterThan(0);
        // The message has to name a field, not just say "invalid".
        expect(message).toMatch(
          /hostname|username|private key|password|api server url|service account token|credential type/i,
        );
      },
    );

    it("rejects before the model is handed to the database layer", async () => {
      /*
       * onBeforeCreate throwing is the whole guard. If it resolved and left
       * enforcement to a later hook or a column constraint, an incomplete
       * credential could still land — and the constraint could not express
       * "one of key or password".
       */
      for (const invalidCase of invalidCases) {
        await expect(
          onBeforeCreate(makeCreateBy(invalidCase.fields)),
        ).rejects.toThrow(BadDataException);
      }
    });
  });
});

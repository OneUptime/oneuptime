import RunbookCredentialsUtil from "../../FeatureSet/Runbook/Utils/Credentials";
import RunbookCredential from "Common/Models/DatabaseModels/RunbookCredential";
import RunbookCredentialService from "Common/Server/Services/RunbookCredentialService";
import RunbookCredentialType from "Common/Types/Runbook/RunbookCredentialType";
import Dictionary from "Common/Types/Dictionary";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import logger from "Common/Server/Utils/Logger";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * ---------------------------------------------------------------------------
 * RunbookCredentialsUtil.resolveForJob — the credential security seam.
 *
 * This is the ONLY place a runbook credential's secret material is decrypted
 * and put on the wire. Everything that keeps that safe lives in one function
 * call, so everything that keeps that safe is pinned here:
 *
 *   - the read is scoped by credential id AND project AND "assigned to the
 *     claiming Runner", so a step author cannot name an arbitrary credential
 *     id and have the server hand it over;
 *   - the select asks for the encrypted columns and the read runs isRoot,
 *     because those columns carry `read: []` and are invisible otherwise;
 *   - the projection is per-credential-type and closed: an SSH credential can
 *     never carry a Kubernetes token out of this function, and an unknown
 *     type yields null rather than a half-populated object.
 *
 * The DB layer is mocked at RunbookCredentialService.findOneBy. That is
 * deliberate: the assertions are about the *query* this function builds and
 * the *shape* it returns, both of which are the actual security contract.
 * ---------------------------------------------------------------------------
 */

type FindOneByArgs = {
  query: Dictionary<unknown>;
  select: Dictionary<boolean>;
  props: Dictionary<unknown>;
};

describe("RunbookCredentialsUtil.resolveForJob", () => {
  let findOneBySpy: jest.SpyInstance;
  let agentId: ObjectID;
  let projectId: ObjectID;
  let credentialId: ObjectID;

  beforeEach(() => {
    agentId = ObjectID.generate();
    projectId = ObjectID.generate();
    credentialId = ObjectID.generate();

    findOneBySpy = jest
      .spyOn(RunbookCredentialService, "findOneBy")
      .mockResolvedValue(null);

    // The "not available" path logs a warning; keep the suite output clean.
    jest.spyOn(logger, "warn").mockImplementation((): void => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function returns(credential: JSONObject | null): void {
    findOneBySpy.mockResolvedValue(
      credential ? (credential as unknown as RunbookCredential) : null,
    );
  }

  function resolve(
    overrides: {
      credentialId?: string | undefined;
      agentId?: ObjectID | undefined;
      projectId?: ObjectID | undefined;
    } = {},
  ): Promise<JSONObject | null> {
    return RunbookCredentialsUtil.resolveForJob({
      credentialId: overrides.credentialId ?? credentialId.toString(),
      agentId: overrides.agentId ?? agentId,
      projectId: overrides.projectId ?? projectId,
    });
  }

  function findArgs(callIndex: number = 0): FindOneByArgs {
    expect(findOneBySpy.mock.calls.length).toBeGreaterThan(callIndex);
    return findOneBySpy.mock.calls[callIndex]![0] as FindOneByArgs;
  }

  function sshCredential(overrides: JSONObject = {}): JSONObject {
    return {
      _id: credentialId.toString(),
      credentialType: RunbookCredentialType.SSH,
      sshHostname: "10.0.4.21",
      sshUsername: "deploy",
      ...overrides,
    };
  }

  function kubernetesCredential(overrides: JSONObject = {}): JSONObject {
    return {
      _id: credentialId.toString(),
      credentialType: RunbookCredentialType.Kubernetes,
      kubernetesApiServerUrl: "https://10.0.0.1:6443",
      kubernetesServiceAccountToken: "sa-token-value",
      ...overrides,
    };
  }

  /*
   * ------------------------------------------------------------------ (1)
   * Malformed credential ids.
   *
   * The id is validated as a UUID BEFORE the query runs. That ordering is the
   * point: ObjectID's constructor does not parse or validate a string, so
   * without an explicit check a garbage id would reach Postgres as a uuid
   * comparison and raise a driver error — surfacing to the Runner as a 500
   * instead of the readable "this credential is not available" failure the
   * claim path exists to give.
   */
  describe("malformed credential id", () => {
    test.each([
      ["a non-UUID id", "definitely-not-a-uuid"],
      ["a SQL-ish id", "' OR 1=1 --"],
      ["an empty string", ""],
      ["a numeric string", "12345"],
      ["a UUID with a trailing space", "8f1e6c2a-0000-4000-8000-000000000000 "],
    ])(
      "%s resolves null without querying at all",
      async (_label: string, credentialId: string) => {
        returns(null);

        await expect(resolve({ credentialId })).resolves.toBeNull();

        // Never reaches the database, so it can never raise a uuid cast error.
        expect(findOneBySpy).not.toHaveBeenCalled();
      },
    );

    test("a well-formed id is accepted and does reach the scoped query", async () => {
      returns(null);

      await expect(
        resolve({ credentialId: credentialId.toString() }),
      ).resolves.toBeNull();

      expect(findOneBySpy).toHaveBeenCalledTimes(1);
      expect(findArgs().query["_id"]).toBe(credentialId.toString());
    });
  });

  /*
   * ------------------------------------------------------------------ (2)
   * The three-way scoping. This is the whole reason a step cannot name an
   * arbitrary credential id in the system and get secret material back.
   */
  describe("query scoping", () => {
    test("scopes by _id AND projectId AND runbookAgents containing the claiming agent", async () => {
      returns(sshCredential({ sshPassword: "hunter2" }));

      await resolve();

      expect(findOneBySpy).toHaveBeenCalledWith(
        expect.objectContaining({
          query: expect.objectContaining({
            _id: credentialId.toString(),
            projectId: projectId,
            runbookAgents: [agentId],
          }),
        }),
      );
    });

    test("the _id clause is the id the step asked for", async () => {
      returns(null);

      const other: ObjectID = ObjectID.generate();
      await resolve({ credentialId: other.toString() });

      expect(findArgs().query["_id"]).toBe(other.toString());
      expect(findArgs().query["_id"]).not.toBe(credentialId.toString());
    });

    test("the projectId clause is the CLAIMING job's project, not anything from the step", async () => {
      returns(null);

      const claimingProject: ObjectID = ObjectID.generate();
      await resolve({ projectId: claimingProject });

      expect(findArgs().query["projectId"]).toEqual(claimingProject);
      expect((findArgs().query["projectId"] as ObjectID).toString()).toBe(
        claimingProject.toString(),
      );
    });

    test("the runbookAgents clause is the AUTHENTICATED agent, as a relation-array match", async () => {
      returns(null);

      const claimingAgent: ObjectID = ObjectID.generate();
      await resolve({ agentId: claimingAgent });

      const relation: unknown = findArgs().query["runbookAgents"];

      expect(Array.isArray(relation)).toBe(true);
      expect(relation as Array<ObjectID>).toHaveLength(1);
      expect((relation as Array<ObjectID>)[0]!.toString()).toBe(
        claimingAgent.toString(),
      );
    });

    test("all three clauses are present simultaneously — none may be dropped", async () => {
      returns(sshCredential({ sshPrivateKey: "-----BEGIN KEY-----" }));

      await resolve();

      const query: Dictionary<unknown> = findArgs().query;

      expect(Object.keys(query).sort()).toEqual(
        ["_id", "projectId", "runbookAgents"].sort(),
      );
    });

    test("resolves with exactly one read — no unscoped second lookup", async () => {
      returns(sshCredential({ sshPassword: "hunter2" }));

      await resolve();

      expect(findOneBySpy).toHaveBeenCalledTimes(1);
    });
  });

  /*
   * ------------------------------------------------------------------ (3)
   * Nothing matched the scoped read: wrong project, deleted, or (the case
   * that matters) simply not assigned to this Runner.
   */
  describe("credential not available to the claiming Runner", () => {
    test("returns null when findOneBy matches nothing", async () => {
      returns(null);

      await expect(resolve()).resolves.toBeNull();
    });

    /*
     * The ingress spreads this value into the claim response, so "null" and
     * "an empty object" are different things on the wire: the second one
     * would hand the Runner a credential-shaped shell to authenticate with.
     */
    test("returns null (never an empty shell) even for a well-formed id", async () => {
      const result: JSONObject | null = await resolve();

      expect(result).toBeNull();
      expect(JSON.stringify(result)).toBe("null");
      expect(Object.keys(result || {})).toHaveLength(0);
    });

    test("logs why the credential was refused", async () => {
      returns(null);

      await resolve();

      expect(logger.warn as unknown as jest.Mock).toHaveBeenCalledTimes(1);

      const message: string = (logger.warn as unknown as jest.Mock).mock
        .calls[0]![0] as string;

      expect(message).toContain(credentialId.toString());
      expect(message).toContain(agentId.toString());
    });

    test("the refusal log carries no secret material", async () => {
      returns(null);

      await resolve();

      const message: string = (logger.warn as unknown as jest.Mock).mock
        .calls[0]![0] as string;

      expect(message).not.toContain("BEGIN");
      expect(message).not.toContain("hunter2");
    });
  });

  /*
   * ------------------------------------------------------------------ (4)
   * SSH projection.
   */
  describe("SSH credential projection", () => {
    test("returns hostname, port and username plus every secret that is present", async () => {
      returns(
        sshCredential({
          sshPort: 2222,
          sshPrivateKey: "-----BEGIN OPENSSH PRIVATE KEY-----",
          sshPassphrase: "key-passphrase",
          sshPassword: "hunter2",
        }),
      );

      await expect(resolve()).resolves.toEqual({
        credentialType: RunbookCredentialType.SSH,
        hostname: "10.0.4.21",
        port: 2222,
        username: "deploy",
        privateKey: "-----BEGIN OPENSSH PRIVATE KEY-----",
        passphrase: "key-passphrase",
        password: "hunter2",
      });
    });

    test("defaults port to 22 when the column is unset", async () => {
      returns(sshCredential({ sshPrivateKey: "pk" }));

      const result: JSONObject | null = await resolve();

      expect(result!["port"]).toBe(22);
    });

    test("defaults port to 22 when the column is null", async () => {
      returns(sshCredential({ sshPort: null, sshPrivateKey: "pk" }));

      expect((await resolve())!["port"]).toBe(22);
    });

    /*
     * `||` not `??`, so a stored 0 also becomes 22. Port 0 is not a usable
     * SSH port, so this is the right answer — pinned so a later `??` swap
     * has to be a deliberate decision.
     */
    test("port 0 falls back to 22 (|| semantics, and 0 is not a usable port)", async () => {
      returns(sshCredential({ sshPort: 0, sshPrivateKey: "pk" }));

      expect((await resolve())!["port"]).toBe(22);
    });

    test("keeps a non-default port verbatim", async () => {
      returns(sshCredential({ sshPort: 22022, sshPrivateKey: "pk" }));

      expect((await resolve())!["port"]).toBe(22022);
    });

    test("omits privateKey, passphrase and password entirely when absent", async () => {
      returns(sshCredential({ sshPort: 22 }));

      const result: JSONObject | null = await resolve();

      expect(Object.keys(result!).sort()).toEqual(
        ["credentialType", "hostname", "port", "username"].sort(),
      );
      expect(result).not.toHaveProperty("privateKey");
      expect(result).not.toHaveProperty("passphrase");
      expect(result).not.toHaveProperty("password");
    });

    test("key auth alone carries no password key", async () => {
      returns(sshCredential({ sshPrivateKey: "pk", sshPassphrase: "pp" }));

      const result: JSONObject | null = await resolve();

      expect(result!["privateKey"]).toBe("pk");
      expect(result!["passphrase"]).toBe("pp");
      expect(result).not.toHaveProperty("password");
    });

    test("password auth alone carries no privateKey or passphrase key", async () => {
      returns(sshCredential({ sshPassword: "hunter2" }));

      const result: JSONObject | null = await resolve();

      expect(result!["password"]).toBe("hunter2");
      expect(result).not.toHaveProperty("privateKey");
      expect(result).not.toHaveProperty("passphrase");
    });

    test("empty-string secrets are omitted rather than sent as empty auth", async () => {
      returns(
        sshCredential({
          sshPrivateKey: "",
          sshPassphrase: "",
          sshPassword: "",
        }),
      );

      const result: JSONObject | null = await resolve();

      expect(result).not.toHaveProperty("privateKey");
      expect(result).not.toHaveProperty("passphrase");
      expect(result).not.toHaveProperty("password");
    });

    test("missing hostname/username degrade to empty strings, not undefined keys", async () => {
      returns({
        _id: credentialId.toString(),
        credentialType: RunbookCredentialType.SSH,
        sshPassword: "hunter2",
      });

      const result: JSONObject | null = await resolve();

      expect(result!["hostname"]).toBe("");
      expect(result!["username"]).toBe("");
    });

    test("never echoes the credential's own _id back to the Runner", async () => {
      returns(sshCredential({ sshPassword: "hunter2" }));

      expect(await resolve()).not.toHaveProperty("_id");
    });
  });

  /*
   * ------------------------------------------------------------------ (5)
   * Kubernetes projection.
   */
  describe("Kubernetes credential projection", () => {
    test("returns apiServerUrl and token, plus caCertificate when present", async () => {
      returns(
        kubernetesCredential({
          kubernetesCaCertificate: "-----BEGIN CERTIFICATE-----",
        }),
      );

      await expect(resolve()).resolves.toEqual({
        credentialType: RunbookCredentialType.Kubernetes,
        apiServerUrl: "https://10.0.0.1:6443",
        token: "sa-token-value",
        caCertificate: "-----BEGIN CERTIFICATE-----",
      });
    });

    test("omits caCertificate entirely when unset", async () => {
      returns(kubernetesCredential());

      const result: JSONObject | null = await resolve();

      expect(Object.keys(result!).sort()).toEqual(
        ["apiServerUrl", "credentialType", "token"].sort(),
      );
      expect(result).not.toHaveProperty("caCertificate");
    });

    test("omits an empty-string caCertificate", async () => {
      returns(kubernetesCredential({ kubernetesCaCertificate: "" }));

      expect(await resolve()).not.toHaveProperty("caCertificate");
    });

    test("missing url/token degrade to empty strings, not undefined keys", async () => {
      returns({
        _id: credentialId.toString(),
        credentialType: RunbookCredentialType.Kubernetes,
      });

      const result: JSONObject | null = await resolve();

      expect(result!["apiServerUrl"]).toBe("");
      expect(result!["token"]).toBe("");
    });

    test("never echoes the credential's own _id back to the Runner", async () => {
      returns(kubernetesCredential());

      expect(await resolve()).not.toHaveProperty("_id");
    });
  });

  /*
   * ------------------------------------------------------------------ (6)
   * Unknown / missing type. A future credential type added to the model but
   * not to this switch must produce nothing, not a shell object that a Runner
   * would try to authenticate with.
   */
  describe("unrecognised credential type", () => {
    test("returns null for a type this resolver does not know", async () => {
      returns({
        _id: credentialId.toString(),
        credentialType: "AwsIamRole",
        sshHostname: "10.0.4.21",
        sshUsername: "deploy",
        sshPassword: "hunter2",
        kubernetesApiServerUrl: "https://10.0.0.1:6443",
        kubernetesServiceAccountToken: "sa-token-value",
      });

      await expect(resolve()).resolves.toBeNull();
    });

    test("returns null when credentialType is missing altogether", async () => {
      returns({
        _id: credentialId.toString(),
        sshHostname: "10.0.4.21",
        sshUsername: "deploy",
        sshPassword: "hunter2",
      });

      await expect(resolve()).resolves.toBeNull();
    });

    test("the type match is exact — case variants do not resolve", async () => {
      returns(
        sshCredential({
          credentialType: "ssh",
          sshPassword: "hunter2",
        }),
      );

      await expect(resolve()).resolves.toBeNull();
    });

    test("an empty-string type resolves null", async () => {
      returns(sshCredential({ credentialType: "", sshPassword: "hunter2" }));

      await expect(resolve()).resolves.toBeNull();
    });
  });

  /*
   * ------------------------------------------------------------------ (7)
   * Cross-type leakage. A row that carries BOTH families of columns (a
   * mis-provisioned or historically-edited credential) must still project
   * only what its declared type calls for.
   */
  describe("cross-type leakage", () => {
    test("an SSH credential carrying Kubernetes columns emits no Kubernetes fields", async () => {
      returns(
        sshCredential({
          sshPort: 22,
          sshPrivateKey: "pk",
          sshPassphrase: "pp",
          sshPassword: "hunter2",
          kubernetesApiServerUrl: "https://10.0.0.1:6443",
          kubernetesServiceAccountToken: "sa-token-value",
          kubernetesCaCertificate: "-----BEGIN CERTIFICATE-----",
        }),
      );

      const result: JSONObject | null = await resolve();

      expect(result).not.toHaveProperty("token");
      expect(result).not.toHaveProperty("apiServerUrl");
      expect(result).not.toHaveProperty("caCertificate");

      expect(JSON.stringify(result)).not.toContain("sa-token-value");
      expect(JSON.stringify(result)).not.toContain("BEGIN CERTIFICATE");
    });

    test("a Kubernetes credential carrying SSH columns emits no SSH fields", async () => {
      returns(
        kubernetesCredential({
          kubernetesCaCertificate: "-----BEGIN CERTIFICATE-----",
          sshHostname: "10.0.4.21",
          sshPort: 2222,
          sshUsername: "deploy",
          sshPrivateKey: "-----BEGIN OPENSSH PRIVATE KEY-----",
          sshPassphrase: "key-passphrase",
          sshPassword: "hunter2",
        }),
      );

      const result: JSONObject | null = await resolve();

      expect(result).not.toHaveProperty("hostname");
      expect(result).not.toHaveProperty("port");
      expect(result).not.toHaveProperty("username");
      expect(result).not.toHaveProperty("privateKey");
      expect(result).not.toHaveProperty("passphrase");
      expect(result).not.toHaveProperty("password");

      expect(JSON.stringify(result)).not.toContain("hunter2");
      expect(JSON.stringify(result)).not.toContain("OPENSSH PRIVATE KEY");
      expect(JSON.stringify(result)).not.toContain("key-passphrase");
    });

    test("the projected key set is closed for each type — no raw column names escape", async () => {
      returns(
        sshCredential({
          sshPort: 22,
          sshPrivateKey: "pk",
          sshPassphrase: "pp",
          sshPassword: "hunter2",
          kubernetesServiceAccountToken: "sa-token-value",
        }),
      );

      const ssh: JSONObject | null = await resolve();

      expect(Object.keys(ssh!).sort()).toEqual(
        [
          "credentialType",
          "hostname",
          "passphrase",
          "password",
          "port",
          "privateKey",
          "username",
        ].sort(),
      );

      returns(
        kubernetesCredential({
          kubernetesCaCertificate: "ca",
          sshPassword: "hunter2",
        }),
      );

      const k8s: JSONObject | null = await resolve();

      expect(Object.keys(k8s!).sort()).toEqual(
        ["apiServerUrl", "caCertificate", "credentialType", "token"].sort(),
      );
    });

    test("each projection stamps its own credentialType", async () => {
      returns(sshCredential({ sshPassword: "hunter2" }));
      expect((await resolve())!["credentialType"]).toBe(
        RunbookCredentialType.SSH,
      );

      returns(kubernetesCredential());
      expect((await resolve())!["credentialType"]).toBe(
        RunbookCredentialType.Kubernetes,
      );
    });
  });

  /*
   * ------------------------------------------------------------------ (8)
   * The read itself. The secret columns carry `read: []`, so they come back
   * ONLY when explicitly selected AND the read runs as root. Drop either and
   * every credential silently resolves with empty auth — a failure mode that
   * looks like a broken host rather than a broken query.
   */
  describe("select and props on the underlying read", () => {
    test("selects every encrypted secret column", async () => {
      returns(sshCredential({ sshPassword: "hunter2" }));

      await resolve();

      const select: Dictionary<boolean> = findArgs().select;

      expect(select["sshPrivateKey"]).toBe(true);
      expect(select["sshPassphrase"]).toBe(true);
      expect(select["sshPassword"]).toBe(true);
      expect(select["kubernetesServiceAccountToken"]).toBe(true);
    });

    test("selects the non-secret connection columns the projection reads", async () => {
      returns(sshCredential({ sshPassword: "hunter2" }));

      await resolve();

      const select: Dictionary<boolean> = findArgs().select;

      expect(select["credentialType"]).toBe(true);
      expect(select["sshHostname"]).toBe(true);
      expect(select["sshPort"]).toBe(true);
      expect(select["sshUsername"]).toBe(true);
      expect(select["kubernetesApiServerUrl"]).toBe(true);
      expect(select["kubernetesCaCertificate"]).toBe(true);
    });

    test("every field the projection can emit is covered by the select", async () => {
      returns(sshCredential({ sshPassword: "hunter2" }));

      await resolve();

      expect(findOneBySpy).toHaveBeenCalledWith(
        expect.objectContaining({
          select: expect.objectContaining({
            credentialType: true,
            sshHostname: true,
            sshPort: true,
            sshUsername: true,
            sshPrivateKey: true,
            sshPassphrase: true,
            sshPassword: true,
            kubernetesApiServerUrl: true,
            kubernetesServiceAccountToken: true,
            kubernetesCaCertificate: true,
          }),
        }),
      );
    });

    test("reads as root — the only way `read: []` columns are returned", async () => {
      returns(sshCredential({ sshPassword: "hunter2" }));

      await resolve();

      expect(findArgs().props["isRoot"]).toBe(true);
      expect(findOneBySpy).toHaveBeenCalledWith(
        expect.objectContaining({
          props: expect.objectContaining({ isRoot: true }),
        }),
      );
    });

    /*
     * isRoot bypasses tenant scoping, so the query must carry projectId
     * itself. Assert the pair together: root read + explicit project clause.
     */
    test("the root read still carries its own projectId clause (isRoot skips tenant scoping)", async () => {
      returns(sshCredential({ sshPassword: "hunter2" }));

      await resolve();

      expect(findArgs().props["isRoot"]).toBe(true);
      expect(findArgs().query["projectId"]).toEqual(projectId);
    });
  });
});

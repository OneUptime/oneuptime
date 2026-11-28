import { afterEach, describe, expect, jest, test } from "@jest/globals";
import CloudAccount from "../../../../../Models/DatabaseModels/CloudAccount";
import CloudConnection from "../../../../../Models/DatabaseModels/CloudConnection";
import CloudAccountService from "../../../../../Server/Services/CloudAccountService";
import CloudConnectionService from "../../../../../Server/Services/CloudConnectionService";
import {
  AwsIamCallOptions,
  AwsIamSession,
} from "../../../../../Server/Utils/CloudConnection/Aws/AwsIamUsers";
import {
  CloudConnectionSettings,
  CloudReadBudget,
} from "../../../../../Server/Utils/CloudConnection/CloudConnectorTypes";
import { AccountChangeAnswer } from "../../../../../Server/Utils/SecurityCase/StepChecks/Evidence/AccountChangesState";
import AwsAccountChanges, {
  AwsAccountChangesOptions,
} from "../../../../../Server/Utils/SecurityCase/StepChecks/Evidence/AwsAccountChanges";
import {
  AccountChangeFacts,
  AccountChangeState,
  AccountChangeUnknownReason,
} from "../../../../../Server/Utils/SecurityPlaybook/AccountChangeReadBack";
import { CloudProvider } from "../../../../../Types/Cloud/CloudPlatform";
import { JSONObject } from "../../../../../Types/JSON";
import ObjectID from "../../../../../Types/ObjectID";
import {
  AccountChange,
  AccountChangeKind,
  AccountChangeProvider,
  AccountChangeSubject,
} from "../../../../../Utils/SecurityCase/AttackAccountChanges";

/*
 * WHICH AWS CONNECTION READS A CHANGE BACK (#10900): only one that signs in
 * to the account the change was made in - the connection that read the
 * change's event, one whose role is in that account, an organization's
 * role in it, an access key of it - and only while its Security case
 * checks are on. A connection known to reach the account with them off
 * makes the change one to grant; none that reaches it, one to connect.
 * The project's Cloud Accounts say which connection found an account - an
 * organization's member account, an access key's own - so that connection
 * reaches it too, its checks on or off (#11039). Each answer names the
 * connection that reaches the account, and whether its checks are on: the
 * one the step's line links to, to edit. AWS itself is out of these tests:
 * sessions and reads are the reader's seams, and each one opened is
 * recorded.
 */

const ACCOUNT: string = "123456789012";
const MEMBER: string = "210987654321";
const ELSEWHERE: string = "111122223333";

interface Opened {
  connection: string;
  accountId: string;
}

function connection(data: {
  config: JSONObject;
  id?: ObjectID | undefined;
}): CloudConnection {
  const row: CloudConnection = new CloudConnection();
  row.id = data.id || ObjectID.generate();
  row.provider = CloudProvider.AWS;
  row.config = data.config;
  return row;
}

function role(
  account: string,
  data: { organization?: boolean; checks?: "on" | "off"; id?: ObjectID } = {},
): CloudConnection {
  return connection({
    id: data.id,
    config: {
      authMethod: "aws-role",
      roleArn: `arn:aws:iam::${account}:role/OneUptimeReadOnly-1a2b3c4d`,
      ...(data.organization ? { readScope: "organization" } : {}),
      securityCaseChecks: data.checks || "on",
    },
  });
}

function accessKey(data: { checks?: "on" | "off" } = {}): CloudConnection {
  return connection({
    config: {
      authMethod: "aws-access-key",
      accessKeyId: "AKIAEXAMPLEKEY01",
      securityCaseChecks: data.checks || "on",
    },
  });
}

function change(data: Partial<AccountChange> = {}): AccountChange {
  return {
    provider: AccountChangeProvider.Aws,
    kind: AccountChangeKind.Group,
    subject: AccountChangeSubject.Account,
    account: "deploy-bot",
    accountId: "",
    objectId: "",
    objectName: "Admins",
    detailId: "",
    ownerType: "",
    cloudAccountId: ACCOUNT,
    cloudConnectionId: "",
    policyDocuments: [],
    eventName: "AddUserToGroup",
    eventUid: "cloudtrail:1",
    time: "2026-11-17T19:30:00.000Z",
    ...data,
  };
}

const STILL_THERE: AccountChangeFacts = {
  provider: "AWS",
  state: AccountChangeState.StillThere,
};

// The project's AWS connections, as the reader finds them, and its seams.
function given(data: {
  connections: Array<CloudConnection>;
  facts?: AccountChangeFacts | undefined;
  failsToSignIn?: Array<string> | undefined;
  keyAccount?: string | undefined;
  readFails?: boolean | undefined;
  // The project's Cloud Accounts: which connection found each account (#11039).
  cloudAccounts?:
    | Array<{ accountId: string; connection: CloudConnection }>
    | undefined;
  cloudAccountsFail?: boolean | undefined;
}): {
  options: AwsAccountChangesOptions;
  opened: Array<Opened>;
  read: Array<string>;
  keyAsked: Array<string>;
  findBy: ReturnType<typeof jest.spyOn>;
  accountsFindBy: ReturnType<typeof jest.spyOn>;
} {
  const opened: Array<Opened> = [];
  const read: Array<string> = [];
  const keyAsked: Array<string> = [];
  const findBy: ReturnType<typeof jest.spyOn> = jest
    .spyOn(CloudConnectionService, "findBy")
    .mockResolvedValue(data.connections);
  const accountsFindBy: ReturnType<typeof jest.spyOn> = jest
    .spyOn(CloudAccountService, "findBy")
    .mockImplementation(async (): Promise<Array<CloudAccount>> => {
      if (data.cloudAccountsFail) {
        throw new Error("the database is down");
      }

      return (data.cloudAccounts || []).map(
        (found: {
          accountId: string;
          connection: CloudConnection;
        }): CloudAccount => {
          const row: CloudAccount = new CloudAccount();
          row.accountId = found.accountId;
          row.cloudConnectionId = found.connection.id!;
          return row;
        },
      );
    });

  jest
    .spyOn(CloudConnectionService, "getConnectorSettings")
    .mockImplementation(
      async (row: CloudConnection): Promise<CloudConnectionSettings> => {
        return {
          provider: CloudProvider.AWS,
          projectId: "project",
          config: row.config || {},
          secrets: {},
        };
      },
    );

  const options: AwsAccountChangesOptions = {
    openSession: async (
      settings: CloudConnectionSettings,
      sessionOptions: AwsIamCallOptions & {
        connectionId: ObjectID;
        accountId: string;
      },
    ): Promise<AwsIamSession> => {
      const id: string = sessionOptions.connectionId.toString();

      opened.push({ connection: id, accountId: sessionOptions.accountId });

      if ((data.failsToSignIn || []).includes(id)) {
        throw new Error("AWS refused sts:AssumeRole");
      }

      return {
        transport: async () => {
          throw new Error("no AWS in this test");
        },
        credentials: { accessKeyId: "ASIA", secretAccessKey: "s" },
        budget: new CloudReadBudget({ maxRequests: 1, maxDurationMs: 1 }),
        sleep: async (): Promise<void> => {
          // No waiting.
        },
        partition: "aws",
        accountId: sessionOptions.accountId,
        subject:
          settings.config["authMethod"] === "aws-role"
            ? "The role"
            : "The access key",
      };
    },
    readChange: async (input: {
      session: AwsIamSession;
      change: AccountChange;
    }): Promise<AccountChangeFacts> => {
      read.push(`${input.session.accountId} ${input.change.objectName}`);

      if (data.readFails) {
        throw new Error("IAM failed: ServiceFailure");
      }

      return data.facts || STILL_THERE;
    },
    readKeyAccount: async (input: {
      settings: CloudConnectionSettings;
      connectionId: ObjectID;
    }): Promise<string> => {
      keyAsked.push(input.connectionId.toString());

      if (data.keyAccount === "throws") {
        throw new Error("the key is refused");
      }

      return data.keyAccount || "";
    },
  };

  return { options, opened, read, keyAsked, findBy, accountsFindBy };
}

async function answer(
  options: AwsAccountChangesOptions,
  changes: Array<AccountChange> = [change()],
): Promise<Array<AccountChangeAnswer>> {
  return await AwsAccountChanges.read({
    projectId: ObjectID.generate(),
    changes,
    options,
  });
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("a connection whose role is in the account", () => {
  test("reads the change through its role there, and names it as the reader", async () => {
    const own: CloudConnection = role(ACCOUNT);
    const seams: ReturnType<typeof given> = given({ connections: [own] });

    expect(await answer(seams.options)).toEqual([
      {
        change: change(),
        facts: STILL_THERE,
        hasConnection: true,
        reader: { connectionId: own.id!.toString(), isChecking: true },
      },
    ]);
    expect(seams.opened).toEqual([
      { connection: own.id!.toString(), accountId: ACCOUNT },
    ]);
    expect(seams.read).toEqual([`${ACCOUNT} Admins`]);
  });

  test("with its Security case checks off, asks IAM nothing, and the change is one to grant on that connection", async () => {
    const off: CloudConnection = role(ACCOUNT, { checks: "off" });
    const seams: ReturnType<typeof given> = given({ connections: [off] });

    expect(await answer(seams.options)).toEqual([
      {
        change: change(),
        facts: {
          provider: "AWS",
          state: AccountChangeState.Unknown,
          reason: AccountChangeUnknownReason.NotGranted,
        },
        hasConnection: true,
        reader: { connectionId: off.id!.toString(), isChecking: false },
      },
    ]);
    expect(seams.opened).toEqual([]);
    expect(seams.read).toEqual([]);
  });

  test("a sign-in that fails, or a read that fails, is said, never undone", async () => {
    const own: CloudConnection = role(ACCOUNT);

    expect(
      await answer(
        given({ connections: [own], failsToSignIn: [own.id!.toString()] })
          .options,
      ),
    ).toEqual([
      {
        change: change(),
        facts: null,
        error: "AWS refused sts:AssumeRole",
        hasConnection: true,
      },
    ]);

    jest.restoreAllMocks();

    expect(
      await answer(given({ connections: [own], readFails: true }).options),
    ).toEqual([
      {
        change: change(),
        facts: null,
        error: "IAM failed: ServiceFailure",
        hasConnection: true,
      },
    ]);
  });
});

describe("a connection that does not reach the account", () => {
  test("a role in another account is never read: a user of the same name missing there would read as undone", async () => {
    const seams: ReturnType<typeof given> = given({
      connections: [role(ELSEWHERE)],
    });

    expect(await answer(seams.options)).toEqual([
      { change: change(), facts: null, hasConnection: false },
    ]);
    expect(seams.opened).toEqual([]);
  });

  test("with no AWS connection at all, the change is one to connect", async () => {
    const seams: ReturnType<typeof given> = given({ connections: [] });

    expect(await answer(seams.options)).toEqual([
      { change: change(), facts: null, hasConnection: false },
    ]);
  });

  test("an event that names no account is read nowhere", async () => {
    const seams: ReturnType<typeof given> = given({
      connections: [role(ACCOUNT)],
    });
    const unnamed: AccountChange = change({ cloudAccountId: "" });

    expect(await answer(seams.options, [unnamed])).toEqual([
      {
        change: unnamed,
        facts: {
          provider: "AWS",
          state: AccountChangeState.Unknown,
          reason: AccountChangeUnknownReason.NotNamed,
        },
        hasConnection: true,
      },
    ]);
    expect(seams.opened).toEqual([]);

    jest.restoreAllMocks();

    expect(await answer(given({ connections: [] }).options, [unnamed])).toEqual(
      [{ change: unnamed, facts: null, hasConnection: false }],
    );
  });
});

describe("the connection that read the change's event", () => {
  test("is the one read first, an organization's included, in the account the event names", async () => {
    const organization: CloudConnection = role(ELSEWHERE, {
      organization: true,
    });
    const other: CloudConnection = role(MEMBER);
    const seams: ReturnType<typeof given> = given({
      connections: [other, organization],
    });
    const fromAudit: AccountChange = change({
      cloudAccountId: MEMBER,
      cloudConnectionId: organization.id!.toString(),
    });

    expect((await answer(seams.options, [fromAudit]))[0]!.facts).toEqual(
      STILL_THERE,
    );
    expect(seams.opened).toEqual([
      { connection: organization.id!.toString(), accountId: MEMBER },
    ]);
  });

  test("whose checks are off makes the change one to grant, though another may read it", async () => {
    const organization: CloudConnection = role(ELSEWHERE, {
      organization: true,
      checks: "off",
    });
    const seams: ReturnType<typeof given> = given({
      connections: [organization, role(ELSEWHERE, { organization: true })],
    });
    const fromAudit: AccountChange = change({
      cloudAccountId: MEMBER,
      cloudConnectionId: organization.id!.toString(),
    });

    // The other organization reaches the member account: it reads it.
    expect((await answer(seams.options, [fromAudit]))[0]!.facts).toEqual(
      STILL_THERE,
    );

    jest.restoreAllMocks();

    const alone: ReturnType<typeof given> = given({
      connections: [organization],
    });

    expect((await answer(alone.options, [fromAudit]))[0]).toMatchObject({
      facts: { reason: AccountChangeUnknownReason.NotGranted },
      hasConnection: true,
    });
    expect(alone.opened).toEqual([]);
  });
});

describe("an organization's connection", () => {
  test("reads a member account through the role its StackSet put there", async () => {
    const organization: CloudConnection = role(ELSEWHERE, {
      organization: true,
    });
    const seams: ReturnType<typeof given> = given({
      connections: [organization],
    });

    expect(
      (await answer(seams.options, [change({ cloudAccountId: MEMBER })]))[0]!
        .facts,
    ).toEqual(STILL_THERE);
    expect(seams.opened).toEqual([
      { connection: organization.id!.toString(), accountId: MEMBER },
    ]);
  });

  test("that cannot sign in to an account does not reach it: no error, no read", async () => {
    const organization: CloudConnection = role(ELSEWHERE, {
      organization: true,
    });
    const seams: ReturnType<typeof given> = given({
      connections: [organization],
      failsToSignIn: [organization.id!.toString()],
    });

    expect(
      await answer(seams.options, [change({ cloudAccountId: MEMBER })]),
    ).toEqual([
      {
        change: change({ cloudAccountId: MEMBER }),
        facts: null,
        hasConnection: false,
      },
    ]);
    expect(seams.read).toEqual([]);
  });

  test("with its checks off, is not asked to sign in to a member account it may not reach", async () => {
    const seams: ReturnType<typeof given> = given({
      connections: [role(ELSEWHERE, { organization: true, checks: "off" })],
    });

    expect(
      (await answer(seams.options, [change({ cloudAccountId: MEMBER })]))[0],
    ).toMatchObject({ facts: null, hasConnection: false });
    expect(seams.opened).toEqual([]);
  });

  test("reads its management account as its own role's", async () => {
    const organization: CloudConnection = role(ACCOUNT, {
      organization: true,
    });
    const seams: ReturnType<typeof given> = given({
      connections: [organization],
    });

    expect((await answer(seams.options))[0]!.facts).toEqual(STILL_THERE);
    expect(seams.opened).toEqual([
      { connection: organization.id!.toString(), accountId: ACCOUNT },
    ]);
  });
});

describe("an access key's connection", () => {
  test("reads its own account, as STS says it is", async () => {
    const key: CloudConnection = accessKey();
    const seams: ReturnType<typeof given> = given({
      connections: [key],
      keyAccount: ACCOUNT,
    });

    expect((await answer(seams.options))[0]!.facts).toEqual(STILL_THERE);
    expect(seams.keyAsked).toEqual([key.id!.toString()]);
  });

  test("of another account, or one STS will not answer for, does not reach the account", async () => {
    for (const keyAccount of [ELSEWHERE, "throws"]) {
      const seams: ReturnType<typeof given> = given({
        connections: [accessKey()],
        keyAccount,
      });

      expect((await answer(seams.options))[0]).toMatchObject({
        facts: null,
        hasConnection: false,
      });
      expect(seams.opened).toEqual([]);

      jest.restoreAllMocks();
    }
  });

  test("with its checks off, is asked nothing at all", async () => {
    const seams: ReturnType<typeof given> = given({
      connections: [accessKey({ checks: "off" })],
      keyAccount: ACCOUNT,
    });

    expect((await answer(seams.options))[0]).toMatchObject({
      facts: null,
      hasConnection: false,
    });
    expect(seams.keyAsked).toEqual([]);
  });
});

describe("over a case's changes", () => {
  test("an answer for each AWS change, in their order; another product's are not this reader's", async () => {
    const seams: ReturnType<typeof given> = given({
      connections: [role(ACCOUNT)],
    });
    const changes: Array<AccountChange> = [
      change({ objectName: "Admins" }),
      change({ provider: AccountChangeProvider.Okta, cloudAccountId: "" }),
      change({ objectName: "Ops", cloudAccountId: ELSEWHERE }),
      change({ objectName: "Billing" }),
    ];

    expect(
      (await answer(seams.options, changes)).map(
        (item: AccountChangeAnswer): [string, boolean] => {
          return [item.change.objectName, item.hasConnection];
        },
      ),
    ).toEqual([
      ["Admins", true],
      ["Ops", false],
      ["Billing", true],
    ]);
    // One sign-in an account, however many changes it holds.
    expect(seams.opened).toHaveLength(1);
    expect(seams.read).toEqual([`${ACCOUNT} Admins`, `${ACCOUNT} Billing`]);
  });

  test("reads the project's AWS connections that are on, as the system", async () => {
    const seams: ReturnType<typeof given> = given({ connections: [] });
    const projectId: ObjectID = ObjectID.generate();

    await AwsAccountChanges.read({
      projectId,
      changes: [change()],
      options: seams.options,
    });

    expect(seams.findBy.mock.calls[0]![0]).toMatchObject({
      query: { projectId, provider: CloudProvider.AWS, isEnabled: true },
      props: { isRoot: true },
    });
  });

  test("a case with no AWS change looks no connection up", async () => {
    const seams: ReturnType<typeof given> = given({ connections: [] });

    expect(
      await answer(seams.options, [
        change({ provider: AccountChangeProvider.EntraId }),
      ]),
    ).toEqual([]);
    expect(seams.findBy).not.toHaveBeenCalled();
  });
});

describe("the connection each answer names (#11039)", () => {
  const NOT_GRANTED: AccountChangeFacts = {
    provider: "AWS",
    state: AccountChangeState.Unknown,
    reason: AccountChangeUnknownReason.NotGranted,
  };

  test("the one that read it, its checks on: a refusal from it is one to run its command again for", async () => {
    const own: CloudConnection = role(ACCOUNT);
    const seams: ReturnType<typeof given> = given({
      connections: [own],
      facts: NOT_GRANTED,
    });

    expect((await answer(seams.options))[0]).toEqual({
      change: change(),
      facts: NOT_GRANTED,
      hasConnection: true,
      reader: { connectionId: own.id!.toString(), isChecking: true },
    });
  });

  test("of several known to reach the account with their checks off, the event's own first, then a role in it", async () => {
    const roleIn: CloudConnection = role(ACCOUNT, { checks: "off" });
    const events: CloudConnection = role(ELSEWHERE, {
      organization: true,
      checks: "off",
    });
    const seams: ReturnType<typeof given> = given({
      connections: [roleIn, events],
    });

    expect(
      (
        await answer(seams.options, [
          change({ cloudConnectionId: events.id!.toString() }),
        ])
      )[0]!.reader,
    ).toEqual({ connectionId: events.id!.toString(), isChecking: false });

    jest.restoreAllMocks();

    expect(
      (await answer(given({ connections: [roleIn, events] }).options))[0]!
        .reader,
    ).toEqual({ connectionId: roleIn.id!.toString(), isChecking: false });
  });

  test("an answer no connection reaches, or one a read failed for, names none", async () => {
    expect(
      (await answer(given({ connections: [role(ELSEWHERE)] }).options))[0]!
        .reader,
    ).toBeUndefined();

    jest.restoreAllMocks();

    const own: CloudConnection = role(ACCOUNT);

    expect(
      (await answer(given({ connections: [own], readFails: true }).options))[0]!
        .reader,
    ).toBeUndefined();
  });
});

describe("the project's Cloud Accounts say which connection found an account (#11039)", () => {
  test("an organization that found the member account, its checks off: the change is one to grant on it, not one to connect", async () => {
    const organization: CloudConnection = role(ELSEWHERE, {
      organization: true,
      checks: "off",
    });
    const seams: ReturnType<typeof given> = given({
      connections: [organization],
      cloudAccounts: [{ accountId: MEMBER, connection: organization }],
    });

    expect(
      (await answer(seams.options, [change({ cloudAccountId: MEMBER })]))[0],
    ).toEqual({
      change: change({ cloudAccountId: MEMBER }),
      facts: {
        provider: "AWS",
        state: AccountChangeState.Unknown,
        reason: AccountChangeUnknownReason.NotGranted,
      },
      hasConnection: true,
      reader: { connectionId: organization.id!.toString(), isChecking: false },
    });
    // Off: asked nothing, not even to sign in.
    expect(seams.opened).toEqual([]);
  });

  test("an organization that found it, its checks on, reads it; one that can no longer sign in to it (the account left) does not reach it", async () => {
    const organization: CloudConnection = role(ELSEWHERE, {
      organization: true,
    });
    const seams: ReturnType<typeof given> = given({
      connections: [organization],
      cloudAccounts: [{ accountId: MEMBER, connection: organization }],
    });

    expect(
      (await answer(seams.options, [change({ cloudAccountId: MEMBER })]))[0],
    ).toMatchObject({
      facts: STILL_THERE,
      reader: { connectionId: organization.id!.toString(), isChecking: true },
    });

    jest.restoreAllMocks();

    const left: ReturnType<typeof given> = given({
      connections: [organization],
      cloudAccounts: [{ accountId: MEMBER, connection: organization }],
      failsToSignIn: [organization.id!.toString()],
    });

    expect(
      (await answer(left.options, [change({ cloudAccountId: MEMBER })]))[0],
    ).toEqual({
      change: change({ cloudAccountId: MEMBER }),
      facts: null,
      hasConnection: false,
    });
    expect(left.read).toEqual([]);
  });

  test("an access key's connection that found its own account reads it without asking STS whose it is", async () => {
    const key: CloudConnection = accessKey();
    const seams: ReturnType<typeof given> = given({
      connections: [key],
      cloudAccounts: [{ accountId: ACCOUNT, connection: key }],
      keyAccount: ELSEWHERE,
    });

    expect((await answer(seams.options))[0]).toMatchObject({
      facts: STILL_THERE,
      reader: { connectionId: key.id!.toString(), isChecking: true },
    });
    expect(seams.keyAsked).toEqual([]);
  });

  test("an access key's that found it, its checks off, is one to grant on it", async () => {
    const key: CloudConnection = accessKey({ checks: "off" });
    const seams: ReturnType<typeof given> = given({
      connections: [key],
      cloudAccounts: [{ accountId: ACCOUNT, connection: key }],
    });

    expect((await answer(seams.options))[0]).toMatchObject({
      facts: { reason: AccountChangeUnknownReason.NotGranted },
      reader: { connectionId: key.id!.toString(), isChecking: false },
    });
  });

  test("an account another connection found is not this one's: a connection is never read in an account it did not find", async () => {
    const organization: CloudConnection = role(ELSEWHERE, {
      organization: true,
      checks: "off",
    });
    const other: CloudConnection = role(MEMBER);
    const seams: ReturnType<typeof given> = given({
      connections: [organization, other],
      cloudAccounts: [{ accountId: MEMBER, connection: other }],
    });

    // The member account's own role reads it; the organization, off and not the finder, is left alone.
    expect(
      (await answer(seams.options, [change({ cloudAccountId: MEMBER })]))[0],
    ).toMatchObject({
      facts: STILL_THERE,
      reader: { connectionId: other.id!.toString(), isChecking: true },
    });
    expect(seams.opened).toEqual([
      { connection: other.id!.toString(), accountId: MEMBER },
    ]);
  });

  test("looked up once a read, for the accounts the AWS changes name, as the system", async () => {
    const projectId: ObjectID = ObjectID.generate();
    const seams: ReturnType<typeof given> = given({
      connections: [role(ACCOUNT)],
    });

    await AwsAccountChanges.read({
      projectId,
      changes: [
        change(),
        change({ objectName: "Ops", cloudAccountId: MEMBER }),
        change({ objectName: "Billing" }),
        change({ provider: AccountChangeProvider.Okta, cloudAccountId: "" }),
      ],
      options: seams.options,
    });

    expect(seams.accountsFindBy).toHaveBeenCalledTimes(1);
    expect(seams.accountsFindBy.mock.calls[0]![0]).toMatchObject({
      query: { projectId, provider: CloudProvider.AWS },
      select: { _id: true, accountId: true, cloudConnectionId: true },
      props: { isRoot: true },
    });
  });

  test("a project with no AWS connection, or a lookup that fails, leaves the other ways to reach an account", async () => {
    const none: ReturnType<typeof given> = given({ connections: [] });

    expect((await answer(none.options))[0]).toMatchObject({
      facts: null,
      hasConnection: false,
    });
    expect(none.accountsFindBy).not.toHaveBeenCalled();

    jest.restoreAllMocks();

    const own: CloudConnection = role(ACCOUNT);
    const failing: ReturnType<typeof given> = given({
      connections: [own],
      cloudAccountsFail: true,
    });

    expect((await answer(failing.options))[0]).toMatchObject({
      facts: STILL_THERE,
      reader: { connectionId: own.id!.toString(), isChecking: true },
    });
  });
});

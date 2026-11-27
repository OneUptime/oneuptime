import CloudAccount from "../../../../../Models/DatabaseModels/CloudAccount";
import CloudConnection from "../../../../../Models/DatabaseModels/CloudConnection";
import { CloudProvider } from "../../../../../Types/Cloud/CloudPlatform";
import {
  CloudConnectionAuthMethod,
  SECURITY_CASE_CHECKS_FIELD_KEY,
  isCloudConnectionSecurityCaseChecksOn,
} from "../../../../../Types/CloudConnection/CloudConnectionCatalog";
import ObjectID from "../../../../../Types/ObjectID";
import {
  AccountChange,
  AccountChangeProvider,
} from "../../../../../Utils/SecurityCase/AttackAccountChanges";
import CloudAccountService from "../../../../Services/CloudAccountService";
import CloudConnectionService from "../../../../Services/CloudConnectionService";
import QueryHelper from "../../../../Types/Database/QueryHelper";
import AwsCloudConnector from "../../../CloudConnection/Aws/AwsCloudConnector";
import {
  AwsIamCallOptions,
  AwsIamSession,
  openAwsIamSession,
} from "../../../CloudConnection/Aws/AwsIamUsers";
import {
  getCallerIdentity,
  getStsRegion,
} from "../../../CloudConnection/Aws/AwsSts";
import { CloudConnectionSettings } from "../../../CloudConnection/CloudConnectorTypes";
import AccountChangeReadBack, {
  AccountChangeFacts,
  AccountChangeState,
  AccountChangeUnknownReason,
} from "../../../SecurityPlaybook/AccountChangeReadBack";
import { AccountChangeAnswer } from "./AccountChangesState";

/*
 * THE AWS IAM CHANGES AN ATTACK MADE, READ BACK THROUGH THE PROJECT'S AWS
 * CLOUD CONNECTIONS (#10900).
 *
 * An IAM user or role is one account's: a change is read only through a
 * connection that signs in to the account the change was made in - never
 * another, where a user of the same name being missing would read as the
 * change undone. In order:
 *
 *   1. the connection whose Cloud audit logs read the change's event;
 *   2. a connection whose role is in that account;
 *   3. the connection the project's Cloud Accounts say found that account
 *      (CloudAccount.cloudConnectionId, #11039): an organization's, which
 *      reads each member account, or an access key's own;
 *   4. a connection that reads an organization, through the role its
 *      StackSet put in that account - one it cannot sign in to does not
 *      reach the account;
 *   5. a connection with an access key of that account, as STS's
 *      GetCallerIdentity says.
 *
 * A connection whose Security case checks are off is never asked anything
 * of IAM: a connection known to reach the account (1-3) makes the change
 * "not granted", which its step says how to grant, and a person confirms
 * it. With no connection that reaches the account, the step says so. Each
 * answer names the connection that reaches the account, when one does, and
 * whether its Security case checks are on: the one the step's line links
 * to, to edit (#11039).
 */

export interface AwsAccountChangesOptions extends AwsIamCallOptions {
  // How an answer is read once a session is open: AccountChangeReadBack's, or a test's.
  readChange?:
    | ((data: {
        session: AwsIamSession;
        change: AccountChange;
      }) => Promise<AccountChangeFacts>)
    | undefined;
  // How a session is opened: the AWS sign-in, or a test's.
  openSession?:
    | ((
        settings: CloudConnectionSettings,
        options: AwsIamCallOptions & {
          connectionId: ObjectID;
          accountId: string;
        },
      ) => Promise<AwsIamSession>)
    | undefined;
  // The account an access key is of: STS's GetCallerIdentity, or a test's.
  readKeyAccount?:
    | ((data: {
        settings: CloudConnectionSettings;
        connectionId: ObjectID;
      }) => Promise<string>)
    | undefined;
}

// A connection, as these reads take it.
interface AwsReader {
  id: ObjectID;
  settings: CloudConnectionSettings;
  method: CloudConnectionAuthMethod;
  isOrganization: boolean;
  // The account its role is in: "" for an access key.
  roleAccountId: string;
  // Its Security case checks are on: IAM may be read through it.
  isChecking: boolean;
}

// The most AWS connections of a project read for a case.
export const AWS_ACCOUNT_CHANGE_CONNECTIONS_MAX: number = 20;

/*
 * The most of the project's cloud accounts looked up for a case's changes:
 * each change names one (ACCOUNT_CHANGES_MAX), and two connections may
 * have found it.
 */
const CLOUD_ACCOUNTS_MAX: number = 50;

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message
    ? error.message
    : String(error || "unknown error");
}

/*
 * Which connections found each AWS account the changes name, as the
 * project's Cloud Accounts keep it: an account id's connections. A lookup
 * that fails leaves the other ways to reach an account.
 */
async function findAccountReaders(data: {
  projectId: ObjectID;
  accountIds: Array<string>;
}): Promise<Map<string, Set<string>>> {
  const found: Map<string, Set<string>> = new Map();

  if (data.accountIds.length === 0) {
    return found;
  }

  try {
    const accounts: Array<CloudAccount> = await CloudAccountService.findBy({
      query: {
        projectId: data.projectId,
        provider: CloudProvider.AWS,
        accountId: QueryHelper.any(data.accountIds),
      },
      select: { _id: true, accountId: true, cloudConnectionId: true },
      skip: 0,
      limit: CLOUD_ACCOUNTS_MAX,
      props: { isRoot: true },
    });

    for (const account of accounts) {
      if (!account.accountId || !account.cloudConnectionId) {
        continue;
      }

      const readers: Set<string> = found.get(account.accountId) || new Set();

      readers.add(account.cloudConnectionId.toString());
      found.set(account.accountId, readers);
    }
  } catch {
    // The other ways to reach each account still hold.
  }

  return found;
}

// The project's AWS cloud connections that are on, as these reads take them.
async function findReaders(projectId: ObjectID): Promise<Array<AwsReader>> {
  const connections: Array<CloudConnection> =
    await CloudConnectionService.findBy({
      query: {
        projectId,
        provider: CloudProvider.AWS,
        isEnabled: true,
      },
      select: {
        _id: true,
        projectId: true,
        provider: true,
        config: true,
        secrets: true,
      },
      skip: 0,
      limit: AWS_ACCOUNT_CHANGE_CONNECTIONS_MAX,
      props: { isRoot: true },
    });
  const connector: AwsCloudConnector = new AwsCloudConnector();
  const readers: Array<AwsReader> = [];

  for (const connection of connections) {
    if (!connection.id) {
      continue;
    }

    const settings: CloudConnectionSettings =
      await CloudConnectionService.getConnectorSettings(connection);
    const method: CloudConnectionAuthMethod = connector.getAuthMethod(settings);

    readers.push({
      id: connection.id,
      settings,
      method,
      isOrganization: connector.isOrganization(settings),
      roleAccountId:
        method === CloudConnectionAuthMethod.AwsRole
          ? connector.getManagementAccountId(settings)
          : "",
      isChecking: isCloudConnectionSecurityCaseChecksOn(
        settings.config[SECURITY_CASE_CHECKS_FIELD_KEY],
      ),
    });
  }

  return readers;
}

// The account an access key is of, as STS says it.
async function readKeyAccountWithSts(data: {
  settings: CloudConnectionSettings;
  connectionId: ObjectID;
  options: AwsIamCallOptions;
}): Promise<string> {
  const connector: AwsCloudConnector = new AwsCloudConnector();
  const session: AwsIamSession = await openAwsIamSession(data.settings, {
    ...data.options,
    connectionId: data.connectionId,
    accountId: "",
  });

  return (
    await getCallerIdentity({
      transport: session.transport,
      credentials: session.credentials,
      region: getStsRegion(connector.getConfiguredRegions(data.settings)),
      now: session.now,
      budget: session.budget,
    })
  ).account;
}

export default class AwsAccountChanges {
  /*
   * Each AWS change, read back through the connection that reaches the
   * account it was made in. An answer for every change, in their order.
   */
  public static async read(data: {
    projectId: ObjectID;
    changes: Array<AccountChange>;
    options?: AwsAccountChangesOptions | undefined;
  }): Promise<Array<AccountChangeAnswer>> {
    const changes: Array<AccountChange> = data.changes.filter(
      (change: AccountChange): boolean => {
        return change.provider === AccountChangeProvider.Aws;
      },
    );

    if (changes.length === 0) {
      return [];
    }

    const options: AwsAccountChangesOptions = data.options || {};
    const readers: Array<AwsReader> = await findReaders(data.projectId);
    const accountReaders: Map<string, Set<string>> =
      readers.length > 0
        ? await findAccountReaders({
            projectId: data.projectId,
            accountIds: Array.from(
              new Set(
                changes
                  .map((change: AccountChange): string => {
                    return change.cloudAccountId;
                  })
                  .filter(Boolean),
              ),
            ),
          })
        : new Map();
    const openSession: NonNullable<AwsAccountChangesOptions["openSession"]> =
      options.openSession || openAwsIamSession;
    const readChange: NonNullable<AwsAccountChangesOptions["readChange"]> =
      options.readChange ||
      (async (input: {
        session: AwsIamSession;
        change: AccountChange;
      }): Promise<AccountChangeFacts> => {
        return await AccountChangeReadBack.readInAws(input);
      });
    const readKeyAccount: NonNullable<
      AwsAccountChangesOptions["readKeyAccount"]
    > =
      options.readKeyAccount ||
      (async (input: {
        settings: CloudConnectionSettings;
        connectionId: ObjectID;
      }): Promise<string> => {
        return await readKeyAccountWithSts({ ...input, options });
      });
    const callOptions: AwsIamCallOptions = {
      transport: options.transport,
      now: options.now,
      sleep: options.sleep,
      budget: options.budget,
    };
    // Each connection's session in each account, opened once a read; null where it cannot sign in.
    const sessions: Map<string, Promise<AwsIamSession | null>> = new Map();
    // Each access key's account, asked once a read.
    const keyAccounts: Map<string, Promise<string>> = new Map();

    const keyAccountOf: (reader: AwsReader) => Promise<string> = (
      reader: AwsReader,
    ): Promise<string> => {
      const key: string = reader.id.toString();

      if (!keyAccounts.has(key)) {
        keyAccounts.set(
          key,
          readKeyAccount({
            settings: reader.settings,
            connectionId: reader.id,
          }).catch((): string => {
            return "";
          }),
        );
      }

      return keyAccounts.get(key)!;
    };

    /*
     * A session of `reader` in `accountId`: an organization's member account
     * it cannot sign in to is one it does not reach (null); any other
     * failure to sign in is thrown.
     */
    const sessionOf: (
      reader: AwsReader,
      accountId: string,
      isMemberAccount: boolean,
    ) => Promise<AwsIamSession | null> = (
      reader: AwsReader,
      accountId: string,
      isMemberAccount: boolean,
    ): Promise<AwsIamSession | null> => {
      const key: string = `${reader.id.toString()}|${accountId}`;

      if (!sessions.has(key)) {
        const opened: Promise<AwsIamSession | null> = openSession(
          reader.settings,
          { ...callOptions, connectionId: reader.id, accountId },
        ).catch((error: unknown): AwsIamSession | null => {
          if (isMemberAccount) {
            return null;
          }

          throw error;
        });

        sessions.set(key, opened);
      }

      return sessions.get(key)!;
    };

    const answers: Array<AccountChangeAnswer> = [];

    for (const change of changes) {
      answers.push(
        await AwsAccountChanges.readOne({
          change,
          readers,
          accountReaders:
            accountReaders.get(change.cloudAccountId) || new Set<string>(),
          readChange,
          sessionOf,
          keyAccountOf,
        }),
      );
    }

    return answers;
  }

  private static async readOne(data: {
    change: AccountChange;
    readers: Array<AwsReader>;
    // The connections the project's Cloud Accounts say found the change's account.
    accountReaders: Set<string>;
    readChange: NonNullable<AwsAccountChangesOptions["readChange"]>;
    sessionOf: (
      reader: AwsReader,
      accountId: string,
      isMemberAccount: boolean,
    ) => Promise<AwsIamSession | null>;
    keyAccountOf: (reader: AwsReader) => Promise<string>;
  }): Promise<AccountChangeAnswer> {
    const { change, readers } = data;
    const accountId: string = change.cloudAccountId;
    const provider: string = AccountChangeProvider.Aws;

    // An event that names no account: there is no telling which to read.
    if (!accountId) {
      return {
        change,
        facts:
          readers.length > 0
            ? {
                provider,
                state: AccountChangeState.Unknown,
                reason: AccountChangeUnknownReason.NotNamed,
              }
            : null,
        hasConnection: readers.length > 0,
      };
    }

    /*
     * The connections known to reach the account without asking AWS: the
     * event's first, then a role in it, then the one the project's Cloud
     * Accounts say found it - an organization's member account, an access
     * key's own.
     */
    const isEvents: (reader: AwsReader) => boolean = (
      reader: AwsReader,
    ): boolean => {
      return reader.id.toString() === change.cloudConnectionId;
    };
    const isRoleIn: (reader: AwsReader) => boolean = (
      reader: AwsReader,
    ): boolean => {
      return !isEvents(reader) && reader.roleAccountId === accountId;
    };
    const found: Array<AwsReader> = readers.filter(
      (reader: AwsReader): boolean => {
        return (
          !isEvents(reader) &&
          !isRoleIn(reader) &&
          data.accountReaders.has(reader.id.toString())
        );
      },
    );
    const known: Array<AwsReader> = [
      ...readers.filter(isEvents),
      ...readers.filter(isRoleIn),
      ...found,
    ];
    const knownIds: Set<string> = new Set(
      known.map((reader: AwsReader): string => {
        return reader.id.toString();
      }),
    );
    /*
     * An organization the Cloud Accounts know of signs in to the member
     * account through its StackSet's role: one it no longer can (an account
     * that left) does not reach it, as for any organization.
     */
    const foundIds: Set<string> = new Set(
      found.map((reader: AwsReader): string => {
        return reader.id.toString();
      }),
    );
    // Then the organizations, and the access keys, that may reach it.
    const others: Array<AwsReader> = readers.filter(
      (reader: AwsReader): boolean => {
        return (
          !knownIds.has(reader.id.toString()) &&
          reader.isChecking &&
          (reader.isOrganization ||
            reader.method === CloudConnectionAuthMethod.AwsAccessKey)
        );
      },
    );
    // Known to reach the account, but asked nothing of IAM: their Security case checks are off.
    const off: Array<AwsReader> = known.filter((reader: AwsReader): boolean => {
      return !reader.isChecking;
    });
    let error: string | undefined = undefined;

    for (const reader of [...known, ...others]) {
      if (!reader.isChecking) {
        continue;
      }

      try {
        const id: string = reader.id.toString();
        const isKnown: boolean = knownIds.has(id);

        // An access key reads its own account only.
        if (
          !isKnown &&
          reader.method === CloudConnectionAuthMethod.AwsAccessKey &&
          (await data.keyAccountOf(reader)) !== accountId
        ) {
          continue;
        }

        const session: AwsIamSession | null = await data.sessionOf(
          reader,
          accountId,
          (!isKnown || foundIds.has(id)) && reader.isOrganization,
        );

        if (!session) {
          continue;
        }

        return {
          change,
          facts: await data.readChange({ session, change }),
          hasConnection: true,
          reader: { connectionId: id, isChecking: true },
        };
      } catch (readError) {
        error = errorMessage(readError);
      }
    }

    if (error) {
      return { change, facts: null, error, hasConnection: true };
    }

    // Reached, but by connections that may not read IAM: the step says how to grant it, on the first.
    if (off.length > 0) {
      return {
        change,
        facts: {
          provider,
          state: AccountChangeState.Unknown,
          reason: AccountChangeUnknownReason.NotGranted,
        },
        hasConnection: true,
        reader: { connectionId: off[0]!.id.toString(), isChecking: false },
      };
    }

    return { change, facts: null, hasConnection: false };
  }
}

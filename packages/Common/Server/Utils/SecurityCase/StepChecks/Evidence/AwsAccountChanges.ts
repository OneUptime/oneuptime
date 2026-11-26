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
import CloudConnectionService from "../../../../Services/CloudConnectionService";
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
 * An IAM user is one account's: a change is read only through a connection
 * that signs in to the account the change was made in - never another,
 * where a user of the same name being missing would read as the change
 * undone. In order:
 *
 *   1. the connection whose Cloud audit logs read the change's event;
 *   2. a connection whose role is in that account;
 *   3. a connection that reads an organization, through the role its
 *      StackSet put in that account - one it cannot sign in to does not
 *      reach the account;
 *   4. a connection with an access key of that account, as STS's
 *      GetCallerIdentity says.
 *
 * A connection whose Security case checks are off is never asked anything
 * of IAM: a connection known to reach the account (1, 2) makes the change
 * "not granted", which its step says how to grant, and a person confirms
 * it. With no connection that reaches the account, the step says so.
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

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message
    ? error.message
    : String(error || "unknown error");
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
     * event's first, then a role in it.
     */
    const isEvents: (reader: AwsReader) => boolean = (
      reader: AwsReader,
    ): boolean => {
      return reader.id.toString() === change.cloudConnectionId;
    };
    const known: Array<AwsReader> = [
      ...readers.filter(isEvents),
      ...readers.filter((reader: AwsReader): boolean => {
        return !isEvents(reader) && reader.roleAccountId === accountId;
      }),
    ];
    const knownIds: Set<string> = new Set(
      known.map((reader: AwsReader): string => {
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
    let reached: boolean = known.length > 0;
    let error: string | undefined = undefined;

    for (const reader of [...known, ...others]) {
      if (!reader.isChecking) {
        continue;
      }

      try {
        const isKnown: boolean = knownIds.has(reader.id.toString());

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
          !isKnown && reader.isOrganization,
        );

        if (!session) {
          continue;
        }

        reached = true;

        return {
          change,
          facts: await data.readChange({ session, change }),
          hasConnection: true,
        };
      } catch (readError) {
        reached = true;
        error = errorMessage(readError);
      }
    }

    if (error) {
      return { change, facts: null, error, hasConnection: true };
    }

    // Reached, but by connections that may not read IAM: the step says how to grant it.
    if (reached) {
      return {
        change,
        facts: {
          provider,
          state: AccountChangeState.Unknown,
          reason: AccountChangeUnknownReason.NotGranted,
        },
        hasConnection: true,
      };
    }

    return { change, facts: null, hasConnection: false };
  }
}

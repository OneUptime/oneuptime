import SecurityCaseEvidence from "../../../../../Models/DatabaseModels/SecurityCaseEvidence";
import SecurityEventConnection from "../../../../../Models/DatabaseModels/SecurityEventConnection";
import SortOrder from "../../../../../Types/BaseDatabase/SortOrder";
import ObjectID from "../../../../../Types/ObjectID";
import {
  SecurityCaseEventSnapshot,
  readSecurityCaseEventSnapshot,
} from "../../../../../Types/SecurityCase/SecurityCaseEventEvidence";
import SecurityCaseEvidenceKind from "../../../../../Types/SecurityCase/SecurityCaseEvidenceKind";
import SecurityEventConnectorProvider from "../../../../../Types/SecurityEvent/Connectors/SecurityEventConnectorProvider";
import {
  AccountChange,
  AccountChangeProvider,
} from "../../../../../Utils/SecurityCase/AttackAccountChanges";
import SecurityCaseEvidenceService from "../../../../Services/SecurityCaseEvidenceService";
import SecurityEventConnectionService from "../../../../Services/SecurityEventConnectionService";
import QueryHelper from "../../../../Types/Database/QueryHelper";
import {
  ConnectorTransport,
  SecurityConnectorSettings,
} from "../../../SecurityEvent/Connectors/Types";
import AccountChangeReadBack, {
  ACCOUNT_CHANGE_CONNECTION_PROVIDERS,
  AccountChangeFacts,
  AccountChangeState,
} from "../../../SecurityPlaybook/AccountChangeReadBack";
import AwsAccountChanges, {
  AwsAccountChangesOptions,
} from "./AwsAccountChanges";

/*
 * WHAT THE FIX STEP "UNDO WHAT CHANGED ON THE ACCOUNT" READS (#10603): the
 * events kept on the case beside the ones its detections matched, and
 * whether each change those events record is still there, asked of every
 * connection the project has switched on to the product it was made in -
 * Okta, Microsoft Entra ID, Google Workspace (AccountChangeReadBack) - and,
 * for AWS IAM, of the AWS cloud connection that reaches the account it was
 * made in (AwsAccountChanges, #10900).
 *
 * A product that cannot be read says why, and is never taken to mean the
 * change was undone.
 */

// The most events kept on a case that are read for its changes.
export const ACCOUNT_CHANGES_KEPT_EVENTS_MAX: number = 100;

// What the products said of one change.
export interface AccountChangeAnswer {
  change: AccountChange;
  /*
   * What the product said, from the connection that has the account -
   * still there wins over any other's answer. Null when no connection
   * could say: none has the account, or each one failed.
   */
  facts: AccountChangeFacts | null;
  // Why a connection could not be read, in the product's or the client's words.
  error?: string | undefined;
  // The project has a connection that reads this product's changes back.
  hasConnection: boolean;
  /*
   * An AWS change's (#11039): the cloud connection that reaches the account
   * it was made in, when one does - the one a person edits to let OneUptime
   * read it back - and whether its Security case checks are on: on, a read
   * AWS refused means its command was not run again since.
   */
  reader?: AccountChangeReader | undefined;
}

export interface AccountChangeReader {
  connectionId: string;
  isChecking: boolean;
}

export interface AccountChangesReading {
  answers: Array<AccountChangeAnswer>;
}

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message
    ? error.message
    : String(error || "unknown error");
}

// Of several connections' answers, the one that says the most: still there, then unknown, then undone.
const STATE_WEIGHT: Record<AccountChangeState, number> = {
  [AccountChangeState.StillThere]: 3,
  [AccountChangeState.Unknown]: 2,
  [AccountChangeState.Undone]: 1,
};

export default class AccountChangesState {
  // The security events kept on the case (its Evidence), as they were kept.
  public static async readKeptEvents(data: {
    projectId: ObjectID;
    securityCaseId: ObjectID;
  }): Promise<Array<SecurityCaseEventSnapshot>> {
    const rows: Array<SecurityCaseEvidence> =
      await SecurityCaseEvidenceService.findBy({
        query: {
          projectId: data.projectId,
          securityCaseId: data.securityCaseId,
          kind: SecurityCaseEvidenceKind.Event,
        },
        select: { _id: true, eventSnapshot: true },
        sort: { createdAt: SortOrder.Ascending },
        skip: 0,
        limit: ACCOUNT_CHANGES_KEPT_EVENTS_MAX,
        props: { isRoot: true },
      });

    return rows
      .map((row: SecurityCaseEvidence): SecurityCaseEventSnapshot | null => {
        return readSecurityCaseEventSnapshot(row.eventSnapshot);
      })
      .filter(
        (
          snapshot: SecurityCaseEventSnapshot | null,
        ): snapshot is SecurityCaseEventSnapshot => {
          return snapshot !== null;
        },
      );
  }

  /*
   * Each change, read back in every connection of its product: AWS's
   * through the AWS cloud connection that reaches its account
   * (AwsAccountChanges).
   */
  public static async read(data: {
    projectId: ObjectID;
    changes: Array<AccountChange>;
    transport?: ConnectorTransport | undefined;
    aws?: AwsAccountChangesOptions | undefined;
  }): Promise<AccountChangesReading> {
    const awsAnswers: Array<AccountChangeAnswer> = await AwsAccountChanges.read(
      {
        projectId: data.projectId,
        changes: data.changes,
        options: data.aws,
      },
    );
    let nextAwsAnswer: number = 0;
    const providers: Array<SecurityEventConnectorProvider> = Array.from(
      new Set(
        data.changes
          .map(
            (change: AccountChange): SecurityEventConnectorProvider | null => {
              return ACCOUNT_CHANGE_CONNECTION_PROVIDERS[change.provider];
            },
          )
          .filter(
            (
              provider: SecurityEventConnectorProvider | null,
            ): provider is SecurityEventConnectorProvider => {
              return provider !== null;
            },
          ),
      ),
    );
    const connections: Array<SecurityEventConnection> =
      providers.length > 0
        ? await SecurityEventConnectionService.findBy({
            query: {
              projectId: data.projectId,
              provider: QueryHelper.any(providers),
              isEnabled: true,
            },
            select: {
              _id: true,
              name: true,
              provider: true,
              config: true,
              secrets: true,
              alertingOnly: true,
            },
            skip: 0,
            limit: 10,
            props: { isRoot: true },
          })
        : [];
    const settingsById: Map<string, SecurityConnectorSettings> = new Map();
    const answers: Array<AccountChangeAnswer> = [];

    for (const change of data.changes) {
      if (change.provider === AccountChangeProvider.Aws) {
        answers.push(
          awsAnswers[nextAwsAnswer++] || {
            change,
            facts: null,
            hasConnection: false,
          },
        );
        continue;
      }

      const provider: SecurityEventConnectorProvider | null =
        ACCOUNT_CHANGE_CONNECTION_PROVIDERS[change.provider];
      const ofProduct: Array<SecurityEventConnection> = provider
        ? connections.filter((connection: SecurityEventConnection): boolean => {
            return connection.provider === provider;
          })
        : [];
      let facts: AccountChangeFacts | null = null;
      let error: string | undefined = undefined;

      for (const connection of ofProduct) {
        try {
          const key: string = connection.id?.toString() || "";
          let settings: SecurityConnectorSettings | undefined =
            settingsById.get(key);

          if (!settings) {
            settings =
              await SecurityEventConnectionService.getConnectorSettings(
                connection,
              );
            settingsById.set(key, settings);
          }

          const found: AccountChangeFacts | null =
            await AccountChangeReadBack.read({
              provider: connection.provider!,
              settings,
              change,
              transport: data.transport,
            });

          if (
            found &&
            (!facts || STATE_WEIGHT[found.state] > STATE_WEIGHT[facts.state])
          ) {
            facts = found;
          }
        } catch (readError) {
          error = errorMessage(readError);
        }
      }

      answers.push({
        change,
        facts,
        ...(error ? { error } : {}),
        hasConnection: ofProduct.length > 0,
      });
    }

    return { answers };
  }
}

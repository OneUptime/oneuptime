import CodeRepositoryService from "Common/Server/Services/CodeRepositoryService";
import ProjectSmtpConfigService from "Common/Server/Services/ProjectSmtpConfigService";
import UserWebhookService from "Common/Server/Services/UserWebhookService";
import WorkspaceProjectAuthTokenService from "Common/Server/Services/WorkspaceProjectAuthTokenService";
import WorkspaceUserAuthTokenService from "Common/Server/Services/WorkspaceUserAuthTokenService";
import MattermostConnection from "Common/Server/Utils/Workspace/Mattermost/MattermostConnection";
import {
  InMemoryTable,
  StoredRow,
  useInMemoryTable,
} from "Common/Tests/Server/TestingUtils/InMemoryRepository";
import Hostname from "Common/Types/API/Hostname";
import Email from "Common/Types/Email";
import MailTransportType from "Common/Types/Email/MailTransportType";
import OAuthProviderType from "Common/Types/Email/OAuthProviderType";
import SMTPAuthenticationType from "Common/Types/Email/SMTPAuthenticationType";
import ObjectID from "Common/Types/ObjectID";
import Port from "Common/Types/Port";
import WorkspaceType from "Common/Types/Workspace/WorkspaceType";
import EncryptProjectCredentials from "../../../../FeatureSet/Workers/DataMigrations/EncryptProjectCredentials";
import { encryptInPlaceADayLater } from "./CredentialsAtRestPass";
import { expect } from "@jest/globals";

/*
 * A PROJECT'S CREDENTIALS AS THEY WERE STORED BEFORE THEY WERE KEPT
 * ENCRYPTED (#8989), behind the real services.
 *
 * Each table is in memory (InMemoryRepository), behind the service every
 * sender reads it through, so a read decrypts on the way as it does from
 * Postgres. migrateProjectCredentials runs the upgrade over the same rows -
 * the real EncryptProjectCredentials, which changes nothing (#9266), then
 * the CredentialsAtRest:EncryptInPlace job's real pass a day later, which
 * encrypts them - its SQL answered as Postgres answers it
 * (answerEncryptColumnSql).
 */

export const PROJECT_ID: string = "89890000-0000-4000-8000-000000000001";
export const USER_ID: string = "89890000-0000-4000-8000-000000000002";

export const SMTP_PASSWORD_CONFIG_ID: string =
  "89890000-0000-4000-8000-000000000011";
export const SMTP_OAUTH_CONFIG_ID: string =
  "89890000-0000-4000-8000-000000000012";
export const SMTP_JWT_CONFIG_ID: string =
  "89890000-0000-4000-8000-000000000013";
export const GRAPH_CONFIG_ID: string = "89890000-0000-4000-8000-000000000014";

export const SLACK_CONNECTION_ID: string =
  "89890000-0000-4000-8000-000000000021";
export const TEAMS_CONNECTION_ID: string =
  "89890000-0000-4000-8000-000000000022";
export const MATTERMOST_CONNECTION_ID: string =
  "89890000-0000-4000-8000-000000000023";
export const SLACK_USER_LINK_ID: string =
  "89890000-0000-4000-8000-000000000031";
export const WEBHOOK_ID: string = "89890000-0000-4000-8000-000000000041";
export const REPOSITORY_ID: string = "89890000-0000-4000-8000-000000000051";

export const SMTP_HOST: string = "smtp.example.com";
export const SMTP_USERNAME: string = "alerts@example.com";
export const SMTP_CLIENT_ID: string = "smtp-oauth-client-id";
export const JWT_CLIENT_ID: string = "alerts@example-project.iam.example.com";
export const GRAPH_CLIENT_ID: string = "11111111-2222-4333-8444-555555555555";
export const TOKEN_URL: string = "https://login.example.com/oauth2/v2.0/token";
export const SENDER_EMAIL: string = "alerts@example.com";
export const WEBHOOK_URL: string = "https://hooks.example.com/oneuptime";
export const MATTERMOST_SERVER_URL: string = "https://chat.example.com";
export const MATTERMOST_TEAM_ID: string = "abcdefghijklmnopqrstuvwxyz";
export const MATTERMOST_BOT_USER_ID: string = "zyxwvutsrqponmlkjihgfedcba";

// Each as a person wrote it: kept exactly, spaces and symbols and all.
export const SMTP_PASSWORD: string = " an SMTP password, spaces & all ";
export const SMTP_CLIENT_SECRET: string = `client~secret.${String.fromCodePoint(0xe9, 0x4e2d)}`;
export const GRAPH_CLIENT_SECRET: string = "graph-client-secret-value~0123";
export const SLACK_BOT_TOKEN: string =
  "xoxb-0000000001-0000000002-slackbottoken";
export const TEAMS_GRAPH_TOKEN: string = `eyJ0eXAiOiJKV1QifQ.${"graph".repeat(80)}.signature`;
export const MATTERMOST_ACCESS_TOKEN: string = "mattermostbotaccesstoken0123";
export const SLACK_USER_TOKEN: string =
  "xoxp-0000000003-0000000004-slackusertoken";
export const SIGNING_SECRET: string = "a webhook signing secret";
export const REPOSITORY_SECRET: string = "a repository webhook secret";

export const MATTERMOST_AUTH_TOKEN: string = MattermostConnection.toAuthToken({
  serverUrl: MATTERMOST_SERVER_URL,
  accessToken: MATTERMOST_ACCESS_TOKEN,
  teamId: MATTERMOST_TEAM_ID,
  botUserId: MATTERMOST_BOT_USER_ID,
});

export interface ProjectCredentialTables {
  smtpConfigs: InMemoryTable;
  projectAuthTokens: InMemoryTable;
  userAuthTokens: InMemoryTable;
  webhooks: InMemoryTable;
  repositories: InMemoryTable;
}

function smtpConfigRow(values: StoredRow): StoredRow {
  return {
    projectId: new ObjectID(PROJECT_ID),
    fromEmail: new Email(SENDER_EMAIL),
    fromName: "Example Alerts",
    secure: false,
    ...values,
  };
}

// The rows as they were stored: each credential as written.
export function useProjectCredentialTables(data: {
  // A service account's private key, made by the test.
  jwtPrivateKey: string;
}): ProjectCredentialTables {
  return {
    smtpConfigs: useInMemoryTable(ProjectSmtpConfigService, [
      smtpConfigRow({
        _id: SMTP_PASSWORD_CONFIG_ID,
        name: "Mail server",
        transportType: MailTransportType.SMTP,
        hostname: new Hostname(SMTP_HOST),
        port: new Port(587),
        authType: SMTPAuthenticationType.UsernamePassword,
        username: SMTP_USERNAME,
        password: SMTP_PASSWORD,
      }),
      smtpConfigRow({
        _id: SMTP_OAUTH_CONFIG_ID,
        name: "Mail server with OAuth",
        transportType: MailTransportType.SMTP,
        hostname: new Hostname(SMTP_HOST),
        port: new Port(587),
        authType: SMTPAuthenticationType.OAuth,
        oauthProviderType: OAuthProviderType.ClientCredentials,
        username: SMTP_USERNAME,
        clientId: SMTP_CLIENT_ID,
        clientSecret: SMTP_CLIENT_SECRET,
        tokenUrl: TOKEN_URL,
        scope: "https://outlook.office365.com/.default",
      }),
      smtpConfigRow({
        _id: SMTP_JWT_CONFIG_ID,
        name: "Google Workspace",
        transportType: MailTransportType.SMTP,
        hostname: new Hostname(SMTP_HOST),
        port: new Port(587),
        authType: SMTPAuthenticationType.OAuth,
        oauthProviderType: OAuthProviderType.JWTBearer,
        username: SMTP_USERNAME,
        clientId: JWT_CLIENT_ID,
        clientSecret: data.jwtPrivateKey,
        tokenUrl: TOKEN_URL,
        scope: "https://mail.google.com/",
      }),
      smtpConfigRow({
        _id: GRAPH_CONFIG_ID,
        name: "Microsoft 365",
        transportType: MailTransportType.MicrosoftGraph,
        authType: SMTPAuthenticationType.OAuth,
        clientId: GRAPH_CLIENT_ID,
        clientSecret: GRAPH_CLIENT_SECRET,
        tokenUrl: TOKEN_URL,
        scope: "https://graph.microsoft.com/.default",
      }),
    ]),
    projectAuthTokens: useInMemoryTable(WorkspaceProjectAuthTokenService, [
      {
        _id: SLACK_CONNECTION_ID,
        projectId: new ObjectID(PROJECT_ID),
        workspaceType: WorkspaceType.Slack,
        workspaceProjectId: "T0000000001",
        authToken: SLACK_BOT_TOKEN,
        miscData: {
          teamId: "T0000000001",
          teamName: "Example",
          botUserId: "B1",
        },
      },
      {
        _id: TEAMS_CONNECTION_ID,
        projectId: new ObjectID(PROJECT_ID),
        workspaceType: WorkspaceType.MicrosoftTeams,
        workspaceProjectId: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
        authToken: TEAMS_GRAPH_TOKEN,
        miscData: { tenantId: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee" },
      },
      {
        _id: MATTERMOST_CONNECTION_ID,
        projectId: new ObjectID(PROJECT_ID),
        workspaceType: WorkspaceType.Mattermost,
        workspaceProjectId: MATTERMOST_TEAM_ID,
        authToken: MATTERMOST_AUTH_TOKEN,
        miscData: {
          serverUrl: MATTERMOST_SERVER_URL,
          teamId: MATTERMOST_TEAM_ID,
          teamName: "example",
          teamDisplayName: "Example",
          botUserId: MATTERMOST_BOT_USER_ID,
          botUsername: "oneuptime",
        },
      },
    ]),
    userAuthTokens: useInMemoryTable(WorkspaceUserAuthTokenService, [
      {
        _id: SLACK_USER_LINK_ID,
        projectId: new ObjectID(PROJECT_ID),
        userId: new ObjectID(USER_ID),
        workspaceType: WorkspaceType.Slack,
        workspaceUserId: "U0000000001",
        authToken: SLACK_USER_TOKEN,
        miscData: { userId: "U0000000001" },
      },
    ]),
    webhooks: useInMemoryTable(UserWebhookService, [
      {
        _id: WEBHOOK_ID,
        projectId: new ObjectID(PROJECT_ID),
        userId: new ObjectID(USER_ID),
        name: "My endpoint",
        webhookUrl: WEBHOOK_URL,
        secret: SIGNING_SECRET,
      },
    ]),
    repositories: useInMemoryTable(CodeRepositoryService, [
      {
        _id: REPOSITORY_ID,
        projectId: new ObjectID(PROJECT_ID),
        name: "example/service",
        secretToken: REPOSITORY_SECRET,
      },
    ]),
  };
}

/*
 * The two statements EncryptColumnInPlace sends, answered over `rows` as
 * Postgres answers them:
 *
 *   SELECT "_id", "<column>" FROM "<table>" WHERE "<column>" IS NOT NULL
 *     AND "<column>" <> '' AND "<column>" NOT LIKE $1 [AND "_id" > $2]
 *     ORDER BY "_id" ASC LIMIT <n>
 *   UPDATE "<table>" SET "<column>" = $1 WHERE "_id" = $2 AND "<column>" = $3
 *
 * Anything else fails the test.
 */
const SELECT_PAGE: RegExp =
  /^SELECT "_id", "(\w+)" FROM "(\w+)" WHERE "\1" IS NOT NULL AND "\1" <> '' AND "\1" NOT LIKE \$1(?: AND "_id" > \$2)? ORDER BY "_id" ASC LIMIT (\d+)$/;
const UPDATE_HELD_TO_VALUE_READ: RegExp =
  /^UPDATE "(\w+)" SET "(\w+)" = \$1 WHERE "_id" = \$2 AND "\2" = \$3$/;

export function answerEncryptColumnSql(
  tableName: string,
  table: InMemoryTable,
): (sql: string, params?: Array<unknown>) => Promise<unknown> {
  return async (sql: string, params?: Array<unknown>): Promise<unknown> => {
    const values: Array<unknown> = params || [];
    const select: RegExpMatchArray | null = sql.match(SELECT_PAGE);

    if (select) {
      const column: string = select[1]!;

      if (select[2] !== tableName) {
        throw new Error(`a read of ${select[2]} from ${tableName}`);
      }

      const prefix: string = String(values[0]).replace(/%$/, "");
      const afterId: string | undefined =
        values.length > 1 ? String(values[1]) : undefined;

      return table.rows
        .filter((row: StoredRow): boolean => {
          const value: unknown = row[column];

          return (
            typeof value === "string" &&
            value !== "" &&
            !value.startsWith(prefix) &&
            (afterId === undefined || String(row["_id"]) > afterId)
          );
        })
        .sort((a: StoredRow, b: StoredRow): number => {
          return String(a["_id"]) < String(b["_id"]) ? -1 : 1;
        })
        .slice(0, Number(select[3]))
        .map((row: StoredRow): StoredRow => {
          return { _id: String(row["_id"]), [column]: row[column] };
        });
    }

    const update: RegExpMatchArray | null = sql.match(
      UPDATE_HELD_TO_VALUE_READ,
    );

    if (update) {
      const column: string = update[2]!;

      if (update[1] !== tableName) {
        throw new Error(`a write of ${update[1]} through ${tableName}`);
      }

      const [encrypted, id, previous] = values as [string, string, string];

      for (const row of table.rows) {
        if (String(row["_id"]) === id && row[column] === previous) {
          row[column] = encrypted;
        }
      }

      return [];
    }

    throw new Error(`an unexpected statement: ${sql}`);
  };
}

/*
 * Runs the upgrade over the tables: the data migration, which leaves every
 * credential as a server of the release before reads it - held to that
 * here - and the job's pass a day later, which encrypts them. Only while
 * they run does a repository answer SQL, as Postgres's does: every other
 * read and write goes through the services' find and update, as before.
 */
export async function migrateProjectCredentials(
  tables: ProjectCredentialTables,
): Promise<void> {
  const attached: Array<[InMemoryTable, string]> = [
    [tables.smtpConfigs, "ProjectSMTPConfig"],
    [tables.projectAuthTokens, "WorkspaceProjectAuthToken"],
    [tables.userAuthTokens, "WorkspaceUserAuthToken"],
    [tables.webhooks, "UserWebhook"],
    [tables.repositories, "CodeRepository"],
  ];

  for (const [table, tableName] of attached) {
    const repository: Record<string, unknown> =
      table.repository as unknown as Record<string, unknown>;

    repository["metadata"] = { tableName: tableName };
    repository["manager"] = { query: answerEncryptColumnSql(tableName, table) };
  }

  try {
    const asWritten: string = JSON.stringify(
      attached.map(([table]: [InMemoryTable, string]) => {
        return table.rows;
      }),
    );

    await new EncryptProjectCredentials().migrate();

    expect(
      JSON.stringify(
        attached.map(([table]: [InMemoryTable, string]) => {
          return table.rows;
        }),
      ),
    ).toBe(asWritten);

    await encryptInPlaceADayLater(new EncryptProjectCredentials().name);
  } finally {
    for (const [table] of attached) {
      const repository: Record<string, unknown> =
        table.repository as unknown as Record<string, unknown>;

      delete repository["metadata"];
      delete repository["manager"];
    }
  }
}

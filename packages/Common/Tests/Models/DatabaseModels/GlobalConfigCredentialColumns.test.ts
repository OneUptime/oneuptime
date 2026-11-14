import GlobalConfig from "../../../Models/DatabaseModels/GlobalConfig";
import { TableColumnMetadata } from "../../../Types/Database/TableColumn";
import TableColumnType from "../../../Types/Database/TableColumnType";
import { ModelSchema } from "../../../Utils/Schema/ModelSchema";
import { describe, expect, test } from "@jest/globals";
import { getMetadataArgsStorage } from "typeorm";
import { ColumnMetadataArgs } from "typeorm/metadata-args/ColumnMetadataArgs";

/*
 * THE SERVER'S CREDENTIALS ARE STORED ENCRYPTED (#7739).
 *
 * The server's own settings live in one GlobalConfig row. Every credential
 * column of it is declared `encrypted: true`, as its newer provider keys
 * (Amazon SES, Mailgun, Postmark, Resend) were from the start: DatabaseService
 * encrypts the value on every write and decrypts it on every read, so the
 * senders, the Admin Dashboard and every other reader get the value as it
 * was written. Each is text, with room for a ciphertext longer than the
 * value, and none is unique: each write stores a different ciphertext.
 *
 * A column that is looked up by value cannot be encrypted, and the columns
 * that only name an account, an app or a mailbox are not secrets: both kinds
 * are listed below, each with why it stays as it is. Any other column of
 * the row that holds a secret fails here until it is encrypted or listed.
 */

const model: GlobalConfig = new GlobalConfig();

// Encrypted since they were added.
const ENCRYPTED_FROM_THE_START: ReadonlyArray<string> = [
  "amazonSesSecretAccessKey",
  "mailgunApiKey",
  "postmarkServerToken",
  "resendApiKey",
];

/*
 * Encrypted by #7739. The EncryptGlobalConfigCredentials data migration
 * encrypts the values stored before.
 */
const ENCRYPTED_BY_7739: ReadonlyArray<string> = [
  "smtpPassword",
  "smtpClientSecret",
  "twilioAuthToken",
  "callAndSmsGatewaySecret",
  "metaWhatsAppAccessToken",
  "metaWhatsAppAppSecret",
  "metaWhatsAppWebhookVerifyToken",
  "telegramBotToken",
  "telegramWebhookSecretToken",
  "sendgridApiKey",
  "enterpriseLicenseKey",
  "enterpriseLicenseToken",
];

const ENCRYPTED: ReadonlyArray<string> = [
  ...ENCRYPTED_FROM_THE_START,
  ...ENCRYPTED_BY_7739,
];

// The credential columns left as they are, and why.
const LEFT_AS_THEY_ARE: Readonly<Record<string, string>> = {
  masterApiKey:
    "Looked up by value: a request names the key, and ProjectAuthorization.isMasterApiKey finds the row WHERE masterApiKey = that key. An encrypted value differs on every write, so no lookup could match it; it is a uuid column, too.",
  twilioAccountSID:
    "Names the Twilio account; the auth token that goes with it is the secret, and is encrypted.",
  smtpUsername:
    "Names the mailbox the server signs in as; the password or OAuth client secret is the secret, and is encrypted.",
  smtpClientId:
    "Names the OAuth app; its client secret is the secret, and is encrypted.",
  amazonSesAccessKeyId:
    "Names the AWS access key; the secret access key is the secret, and is encrypted.",
  metaWhatsAppPhoneNumberId:
    "Names the WhatsApp number messages go out from; the access token is the secret, and is encrypted.",
  metaWhatsAppBusinessAccountId:
    "Names the WhatsApp Business account; the access token is the secret, and is encrypted.",
  metaWhatsAppAppId:
    "Names the Meta app; its app secret is the secret, and is encrypted.",
  telegramBotUsername:
    "The bot's public username, shown to people in the deep links they open; the bot token is the secret, and is encrypted.",
};

function typeOrmColumn(column: string): ColumnMetadataArgs | undefined {
  return getMetadataArgsStorage().columns.find(
    (entry: ColumnMetadataArgs): boolean => {
      return entry.target === GlobalConfig && entry.propertyName === column;
    },
  );
}

function secretColumns(): Array<string> {
  return model.getTableColumns().columns.filter((column: string): boolean => {
    return ModelSchema.isSecretColumn(model.getTableColumnMetadata(column));
  });
}

describe("GlobalConfig's credential columns", () => {
  test("every credential column is declared encrypted, and no other column is", () => {
    expect([...model.getEncryptedColumns().columns].sort()).toEqual(
      [...ENCRYPTED].sort(),
    );
  });

  test.each(
    ENCRYPTED.map((column: string): [string] => {
      return [column];
    }),
  )(
    "%s is text with room for its ciphertext, nullable and not unique",
    (column: string) => {
      const metadata: TableColumnMetadata =
        model.getTableColumnMetadata(column);

      expect(metadata.encrypted).toBe(true);
      expect(metadata.type).toBe(TableColumnType.VeryLongText);
      // No unique check of the plaintext against the ciphertext stored.
      expect(metadata.unique).toBeFalsy();

      const stored: ColumnMetadataArgs | undefined = typeOrmColumn(column);

      expect(stored?.options.type).toBe("text");
      expect(stored?.options.length).toBeUndefined();
      expect(stored?.options.nullable).toBe(true);
      expect(stored?.options.unique).toBeFalsy();
    },
  );

  test("each is a secret to the API documentation and to the clients made from it", () => {
    for (const column of ENCRYPTED) {
      expect([
        column,
        ModelSchema.isSecretColumn(model.getTableColumnMetadata(column)),
      ]).toEqual([column, true]);
    }
  });

  test("no permission reads, writes or filters any of them: only the server and a master admin", () => {
    for (const column of ENCRYPTED) {
      expect([column, model.getColumnAccessControlFor(column)]).toEqual([
        column,
        { create: [], read: [], update: [] },
      ]);
    }
  });

  test("every secret of the row is encrypted, or left as it is with why", () => {
    const leftSecrets: Array<string> = Object.keys(LEFT_AS_THEY_ARE).filter(
      (column: string): boolean => {
        return ModelSchema.isSecretColumn(model.getTableColumnMetadata(column));
      },
    );

    expect(leftSecrets).toEqual(["masterApiKey"]);
    expect(secretColumns().sort()).toEqual(
      [...ENCRYPTED, ...leftSecrets].sort(),
    );
  });

  describe("the columns left as they are", () => {
    test.each(Object.entries(LEFT_AS_THEY_ARE))(
      "%s is not encrypted: %s",
      (column: string, reason: string) => {
        const metadata: TableColumnMetadata =
          model.getTableColumnMetadata(column);

        expect(metadata).toBeDefined();
        expect(metadata.encrypted).toBeFalsy();
        expect(reason.length).toBeGreaterThan(20);
      },
    );

    test("the master API key is a uuid, matched by value, and a secret all the same", () => {
      const metadata: TableColumnMetadata =
        model.getTableColumnMetadata("masterApiKey");

      expect(metadata.type).toBe(TableColumnType.ObjectID);
      expect(metadata.secret).toBe(true);
      expect(typeOrmColumn("masterApiKey")?.options.type).toBe("uuid");
    });

    test("the identifiers are not secrets", () => {
      for (const column of Object.keys(LEFT_AS_THEY_ARE)) {
        if (column === "masterApiKey") {
          continue;
        }

        expect([
          column,
          ModelSchema.isSecretColumn(model.getTableColumnMetadata(column)),
        ]).toEqual([column, false]);
      }
    });
  });
});

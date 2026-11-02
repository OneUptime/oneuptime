import { getOpenApiMetadata } from "@asteasolutions/zod-to-openapi";
import { ZodType } from "zod";
import AllModelTypes from "../../../Models/DatabaseModels/Index";
import DatabaseBaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import ApiKey from "../../../Models/DatabaseModels/ApiKey";
import Probe from "../../../Models/DatabaseModels/Probe";
import StatusPageSubscriber from "../../../Models/DatabaseModels/StatusPageSubscriber";
import Label from "../../../Models/DatabaseModels/Label";
import TelemetryIngestionKey from "../../../Models/DatabaseModels/TelemetryIngestionKey";
import {
  getTableColumns,
  TableColumnMetadata,
} from "../../../Types/Database/TableColumn";
import TableColumnType from "../../../Types/Database/TableColumnType";
import Dictionary from "../../../Types/Dictionary";
import {
  ModelSchema,
  ModelSchemaType,
} from "../../../Utils/Schema/ModelSchema";
import { isSecretFieldName } from "../../../Utils/DeveloperDocs/TerraformValues";

/*
 * SECRETS IN THE SPEC.
 *
 * A column whose value lets whoever has it in - an API key's value, a
 * probe's or a Runner's key, a monitor's secret keys, an SNMP passphrase or
 * community string, a TLS private key, a Slack or Microsoft Teams incoming
 * webhook address - is a secret, and the OpenAPI spec says so
 * (x-oneuptime-secret: ModelSchema.isSecretColumn). The clients published
 * from the spec keep it out of what they print: the Terraform and OpenTofu
 * provider marks the attribute Sensitive, so a plan, a log or an output
 * shows (sensitive value). Hashed and encrypted text columns always were;
 * the ones stored as they are were printed in every plan and every log -
 * oneuptime_api_key's api_key among them - until their models marked them
 * `secret` (TableColumnMetadata.secret).
 *
 * This holds every column named like a secret (isSecretFieldName, the rule
 * the dashboard's Terraform pages use to keep values off the screen, and a
 * few names it leaves to the model) to being one, or to being listed below
 * with why it is not.
 */

type ModelType = new () => DatabaseBaseModel;

/*
 * Columns named like a secret that are not one, each with why. A new
 * column named like a secret either is one - mark it `secret: true` in its
 * @TableColumn - or goes here.
 */
const NOT_SECRETS: Readonly<Record<string, string>> = {
  // Identifiers, not credentials: machine-readable names a person picks or
  // the server derives from a name.
  "AlertMeasurement.key":
    "a measurement's stable name, chosen by the person who adds it",
  "IncidentMeasurement.key":
    "a measurement's stable name, chosen by the person who adds it",
  "ScheduledMaintenanceMeasurement.key":
    "a measurement's stable name, chosen by the person who adds it",
  "NetworkDeviceRole.key": "derived from the role's name when it is created",
  "DataStoreAccess.accessKey":
    "identifies an access entry within its store: the principal, level and grant",
  // Tokens that are public by design.
  "DashboardDomain.cnameVerificationToken":
    "written into a public DNS record to show the domain is yours",
  "FormDomain.cnameVerificationToken":
    "written into a public DNS record to show the domain is yours",
  "StatusPageDomain.cnameVerificationToken":
    "written into a public DNS record to show the domain is yours",
  "AcmeChallenge.token":
    "an ACME challenge, served in public at /.well-known for the certificate authority",
  "GreenlockChallenge.token":
    "an ACME challenge, served in public at /.well-known for the certificate authority",
  "File.imageAccessToken":
    "addresses a file in a link; opening it still takes the right to see the file (FileViewerAccess)",
  // A cursor, not a credential.
  "ThreatIntelFeed.nextPageToken":
    "where the next poll of a feed resumes, handed out by the feed's own server",
};

// Names a secret goes by that isSecretFieldName leaves to the model.
const ALSO_SECRET_NAMES: ReadonlyArray<string> = [
  "secretToken",
  "embeddedOverallStatusToken",
  "subscriptionConfirmationToken",
  "slackIncomingWebhookUrl",
  "microsoftTeamsIncomingWebhookUrl",
  "subscriberWebhook",
  "snmpV3Auth",
  "snmpConfigs",
];

// Types whose value is shown as text: the only ones that hold a credential.
const TEXT_TYPES: ReadonlyArray<TableColumnType> = [
  TableColumnType.ShortText,
  TableColumnType.LongText,
  TableColumnType.VeryLongText,
  TableColumnType.ObjectID,
  TableColumnType.ShortURL,
  TableColumnType.LongURL,
  TableColumnType.JSON,
  TableColumnType.Array,
];

function looksLikeASecret(name: string, column: TableColumnMetadata): boolean {
  if (ALSO_SECRET_NAMES.includes(name)) {
    return true;
  }

  return TEXT_TYPES.includes(column.type) && isSecretFieldName(name);
}

function getSchemaProperty(
  schema: ModelSchemaType,
  column: string,
): Record<string, unknown> | undefined {
  const shape: Record<string, ZodType> = (
    schema as unknown as { shape: Record<string, ZodType> }
  ).shape;
  const property: ZodType | undefined = shape[column];

  if (!property) {
    return undefined;
  }

  return getOpenApiMetadata(property) as Record<string, unknown> | undefined;
}

describe("secret columns", () => {
  test("every column named like a secret is one, or says why it is not", () => {
    const unmarked: Array<string> = [];
    const listedButSecret: Array<string> = [];
    const listedSeen: Set<string> = new Set<string>();

    for (const modelType of AllModelTypes as Array<ModelType>) {
      const model: DatabaseBaseModel = new modelType();
      const columns: Dictionary<TableColumnMetadata> = getTableColumns(model);

      for (const [name, column] of Object.entries(columns)) {
        const key: string = `${model.tableName}.${name}`;

        if (NOT_SECRETS[key]) {
          listedSeen.add(key);
          if (ModelSchema.isSecretColumn(column)) {
            listedButSecret.push(key);
          }
          continue;
        }

        if (
          looksLikeASecret(name, column) &&
          !ModelSchema.isSecretColumn(column)
        ) {
          unmarked.push(key);
        }
      }
    }

    expect(unmarked).toEqual([]);
    // A column listed as no secret is not marked one too.
    expect(listedButSecret).toEqual([]);
    // Every listed column still exists: a renamed one would hide a secret.
    expect(
      Object.keys(NOT_SECRETS).filter((key: string) => {
        return !listedSeen.has(key);
      }),
    ).toEqual([]);
  });

  test("the spec marks a secret x-oneuptime-secret, in every schema that has it", () => {
    const unmarked: Array<string> = [];

    for (const [modelType, column] of [
      [ApiKey, "apiKey"],
      [Probe, "key"],
      [TelemetryIngestionKey, "secretKey"],
    ] as Array<[ModelType, string]>) {
      for (const [kind, schema] of [
        ["read", ModelSchema.getReadModelSchema({ modelType })],
        ["model", ModelSchema.getModelSchema({ modelType })],
      ] as Array<[string, ModelSchemaType]>) {
        const property: Record<string, unknown> | undefined = getSchemaProperty(
          schema,
          column,
        );
        if (property?.["x-oneuptime-secret"] !== true) {
          unmarked.push(
            `${modelType.name}.${column} (${kind}): ${JSON.stringify(property)}`,
          );
        }
      }
    }

    expect(unmarked).toEqual([]);

    // A secret the API takes at create says so in the create schema too,
    // a write-only one included (a Slack incoming webhook address is never
    // read back).
    for (const [modelType, column] of [
      [Probe, "key"],
      [StatusPageSubscriber, "slackIncomingWebhookUrl"],
      [StatusPageSubscriber, "microsoftTeamsIncomingWebhookUrl"],
    ] as Array<[ModelType, string]>) {
      expect(
        getSchemaProperty(
          ModelSchema.getCreateModelSchema({ modelType }),
          column,
        )?.["x-oneuptime-secret"],
      ).toBe(true);
    }
  });

  test("a secret keeps its own format: an API key is still a uuid", () => {
    const apiKey: Record<string, unknown> | undefined = getSchemaProperty(
      ModelSchema.getReadModelSchema({ modelType: ApiKey }),
      "apiKey",
    );

    expect(apiKey?.["format"]).toBe("uuid");
    expect(apiKey?.["x-oneuptime-secret"]).toBe(true);
  });

  test("a column that is no secret is not marked one", () => {
    for (const [modelType, column] of [
      [ApiKey, "name"],
      [Probe, "name"],
      [Label, "color"],
      [StatusPageSubscriber, "subscriberEmail"],
    ] as Array<[ModelType, string]>) {
      const property: Record<string, unknown> | undefined = getSchemaProperty(
        ModelSchema.getReadModelSchema({ modelType }),
        column,
      );

      expect(property).toBeDefined();
      expect(property?.["x-oneuptime-secret"]).toBeUndefined();
    }
  });

  test("isSecretColumn: marked, hashed, password and encrypted text columns", () => {
    const base: TableColumnMetadata = { type: TableColumnType.ShortText };

    expect(ModelSchema.isSecretColumn(base)).toBe(false);
    expect(ModelSchema.isSecretColumn({ ...base, secret: true })).toBe(true);
    expect(ModelSchema.isSecretColumn({ ...base, encrypted: true })).toBe(true);
    expect(
      ModelSchema.isSecretColumn({ type: TableColumnType.HashedString }),
    ).toBe(true);
    expect(ModelSchema.isSecretColumn({ type: TableColumnType.Password })).toBe(
      true,
    );
    // An encrypted JSON column holds a map of secrets, which the spec leaves
    // as it is.
    expect(
      ModelSchema.isSecretColumn({
        type: TableColumnType.JSON,
        encrypted: true,
      }),
    ).toBe(false);
    expect(
      ModelSchema.isSecretColumn({
        type: TableColumnType.ObjectID,
        secret: true,
      }),
    ).toBe(true);
  });
});

import DatabaseService from "./DatabaseService";
import Model from "../../Models/DatabaseModels/SecurityEventConnection";
import CreateBy from "../Types/Database/CreateBy";
import UpdateBy from "../Types/Database/UpdateBy";
import { OnCreate, OnUpdate } from "../Types/Database/Hooks";
import BadDataException from "../../Types/Exception/BadDataException";
import PartialEntity from "../../Types/Database/PartialEntity";
import Select from "../Types/Database/Select";
import { JSONObject, JSONValue } from "../../Types/JSON";
import ObjectID from "../../Types/ObjectID";
import SecurityEventConnectorType, {
  SecurityEventConnectorTypes,
} from "../../Types/SecurityEvent/SecurityEventConnectorType";
import { createHash, createPrivateKey } from "crypto";
import { UpdateQueryBuilder, UpdateResult } from "typeorm";
import { QueryDeepPartialEntity } from "typeorm/query-builder/QueryPartialEntity";

const AWS_REGION_PATTERN: RegExp = /^[a-z]{2}(?:-gov)?-[a-z]+-\d$/;
const MICROSOFT_TENANT_PATTERN: RegExp = /^[A-Za-z0-9.-]+$/;
const GOOGLE_SCC_PARENT_PATTERN: RegExp =
  /^(?:organizations|folders|projects)\/[^/\s?#%]+\/sources\/(?:-|[^/\s?#%]+)(?:\/locations\/[^/\s?#%]+)?$/;

export interface SecurityEventPollingCheckpointUpdate {
  lastPolledAt: Date;
  lastPollResult: JSONObject;
  lastError: string | null;
  cursor?: string | null | undefined;
  lastSuccessfulPollAt?: Date | undefined;
  lastEventIngestedAt?: Date | undefined;
}

function requiredString(
  value: JSONObject,
  key: string,
  provider: string,
): string {
  const candidate: JSONValue = value[key];
  if (typeof candidate !== "string" || !candidate.trim()) {
    throw new BadDataException(`${provider} requires ${key}.`);
  }
  return candidate.trim();
}

function optionalString(value: JSONObject, key: string): string {
  const candidate: JSONValue = value[key];
  if (candidate === undefined || candidate === null || candidate === "") {
    return "";
  }
  if (typeof candidate !== "string") {
    throw new BadDataException(`${key} must be a string.`);
  }
  return candidate.trim();
}

function validateHttpsOrigin(value: string, label: string): void {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new BadDataException(`${label} must be a valid HTTPS URL.`);
  }
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    throw new BadDataException(
      `${label} must be an HTTPS URL without credentials, query, or fragment.`,
    );
  }
}

function isSqlExpressionValue(value: unknown): boolean {
  return typeof value === "function";
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value
      .map((item: unknown): string => {
        return stableJson(item);
      })
      .join(",")}]`;
  }
  if (value && typeof value === "object") {
    const record: Record<string, unknown> = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key: string): string => {
        return `${JSON.stringify(key)}:${stableJson(record[key])}`;
      })
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

interface SecurityEventConnectionUpdateCarryForward {
  configurationSupplied: boolean;
  credentialsSupplied: boolean;
  configuration?: JSONObject | undefined;
  credentialJson?: string | undefined;
  pollIntervalInMinutes?: number | undefined;
}

function securityEventSourceFingerprint(
  provider: SecurityEventConnectorType,
  configuration: JSONObject,
): string {
  return createHash("sha256")
    .update(stableJson({ provider, configuration }))
    .digest("hex");
}

export function parseSecurityEventCredentialJson(value: string): JSONObject {
  let parsed: JSONValue;
  try {
    parsed = JSON.parse(value || "") as JSONValue;
  } catch {
    throw new BadDataException("Credentials JSON is not valid JSON.");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new BadDataException("Credentials JSON must be a JSON object.");
  }
  return parsed as JSONObject;
}

export function parseSecurityEventConfiguration(
  value: JSONObject | string,
): JSONObject {
  let parsed: unknown = value;
  if (typeof value === "string") {
    try {
      parsed = JSON.parse(value);
    } catch {
      throw new BadDataException("Configuration is not valid JSON.");
    }
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new BadDataException("Configuration must be a JSON object.");
  }
  return parsed as JSONObject;
}

export function validateSecurityEventConnection(data: {
  provider?: SecurityEventConnectorType | undefined;
  configuration?: JSONObject | string | undefined;
  credentialJson?: string | undefined;
  pollIntervalInMinutes?: number | undefined;
}): void {
  if (data.pollIntervalInMinutes !== undefined) {
    if (
      !Number.isInteger(data.pollIntervalInMinutes) ||
      data.pollIntervalInMinutes < 1 ||
      data.pollIntervalInMinutes > 1440
    ) {
      throw new BadDataException(
        "Poll interval must be a whole number of minutes between 1 and 1440.",
      );
    }
  }

  if (data.provider === undefined) {
    return;
  }
  if (!SecurityEventConnectorTypes.includes(data.provider)) {
    throw new BadDataException("Choose a supported security event provider.");
  }
  if (!data.configuration) {
    throw new BadDataException("Configuration must be a JSON object.");
  }
  if (!data.credentialJson) {
    throw new BadDataException("Credentials JSON is required.");
  }

  const configuration: JSONObject = parseSecurityEventConfiguration(
    data.configuration,
  );
  const credentials: JSONObject = parseSecurityEventCredentialJson(
    data.credentialJson,
  );

  switch (data.provider) {
    case SecurityEventConnectorType.AwsSecurityHub: {
      const region: string = requiredString(configuration, "region", "AWS");
      if (!AWS_REGION_PATTERN.test(region)) {
        throw new BadDataException("AWS region is not valid.");
      }
      requiredString(credentials, "accessKeyId", "AWS");
      requiredString(credentials, "secretAccessKey", "AWS");
      optionalString(credentials, "sessionToken");
      break;
    }
    case SecurityEventConnectorType.MicrosoftDefender: {
      const tenantId: string = requiredString(
        configuration,
        "tenantId",
        "Microsoft",
      );
      if (!MICROSOFT_TENANT_PATTERN.test(tenantId)) {
        throw new BadDataException("Microsoft tenantId is not valid.");
      }
      requiredString(credentials, "clientId", "Microsoft");
      requiredString(credentials, "clientSecret", "Microsoft");
      break;
    }
    case SecurityEventConnectorType.Cloudflare:
      requiredString(configuration, "zoneId", "Cloudflare");
      requiredString(credentials, "apiToken", "Cloudflare");
      break;
    case SecurityEventConnectorType.CrowdStrikeFalcon: {
      const cloud: string = optionalString(configuration, "cloud") || "us-1";
      if (!["us-1", "us-2", "eu-1", "us-gov-1"].includes(cloud)) {
        throw new BadDataException(
          "CrowdStrike cloud must be us-1, us-2, eu-1, or us-gov-1.",
        );
      }
      requiredString(credentials, "clientId", "CrowdStrike");
      requiredString(credentials, "clientSecret", "CrowdStrike");
      break;
    }
    case SecurityEventConnectorType.GoogleSecurityCommandCenter: {
      const parent: string = requiredString(
        configuration,
        "parent",
        "Google Security Command Center",
      );
      if (!GOOGLE_SCC_PARENT_PATTERN.test(parent)) {
        throw new BadDataException(
          "Google Security Command Center parent must look like organizations/{id}/sources/- or organizations/{id}/sources/-/locations/{location}.",
        );
      }
      requiredString(credentials, "client_email", "Google service account");
      const privateKey: string = requiredString(
        credentials,
        "private_key",
        "Google service account",
      );
      try {
        createPrivateKey(privateKey);
      } catch {
        throw new BadDataException(
          "Google service account private_key is not a valid private key.",
        );
      }
      const tokenUri: string =
        optionalString(credentials, "token_uri") ||
        "https://oauth2.googleapis.com/token";
      validateHttpsOrigin(tokenUri, "Google token_uri");
      const parsedTokenUri: URL = new URL(tokenUri);
      if (
        parsedTokenUri.hostname !== "oauth2.googleapis.com" ||
        parsedTokenUri.port ||
        parsedTokenUri.pathname !== "/token"
      ) {
        throw new BadDataException(
          "Google token_uri must be https://oauth2.googleapis.com/token.",
        );
      }
      break;
    }
    case SecurityEventConnectorType.Okta: {
      const baseUrl: string = requiredString(configuration, "baseUrl", "Okta");
      validateHttpsOrigin(baseUrl, "Okta baseUrl");
      requiredString(credentials, "apiToken", "Okta");
      break;
    }
    case SecurityEventConnectorType.SplunkEnterpriseSecurity: {
      const baseUrl: string = requiredString(
        configuration,
        "baseUrl",
        "Splunk",
      );
      validateHttpsOrigin(baseUrl, "Splunk baseUrl");
      const token: string = optionalString(credentials, "apiToken");
      const username: string = optionalString(credentials, "username");
      const password: string = optionalString(credentials, "password");
      if (!token && !(username && password)) {
        throw new BadDataException(
          "Splunk requires apiToken or username and password.",
        );
      }
      const tokenScheme: string =
        optionalString(credentials, "tokenScheme") || "Bearer";
      if (token && !["Bearer", "Splunk"].includes(tokenScheme)) {
        throw new BadDataException(
          "Splunk tokenScheme must be Bearer or Splunk.",
        );
      }
      optionalString(configuration, "search");
      break;
    }
  }
}

export class Service extends DatabaseService<Model> {
  public constructor() {
    super(Model);
  }

  /**
   * Stores poll progress only while the connection is still the exact version
   * that was loaded by the poller. Keeping the row-version predicate in the
   * UPDATE statement prevents an in-flight poll from restoring an old cursor
   * after credentials or source settings have changed and reset the state.
   */
  public async updatePollingCheckpointIfUnchanged(data: {
    id: ObjectID;
    expectedVersion: number;
    checkpoint: SecurityEventPollingCheckpointUpdate;
  }): Promise<number> {
    const encryptedCheckpoint: Model = (await this.encrypt({
      ...data.checkpoint,
    } as unknown as Model)) as Model;
    const queryBuilder: UpdateQueryBuilder<Model> = this.getRepository()
      .createQueryBuilder()
      .update(Model)
      .set(encryptedCheckpoint as unknown as QueryDeepPartialEntity<Model>)
      .where('"_id" = :id', { id: data.id.toString() })
      .andWhere('"version" = :expectedVersion', {
        expectedVersion: data.expectedVersion,
      })
      .andWhere('"deletedAt" IS NULL');

    const result: UpdateResult = await queryBuilder.execute();
    return result.affected || 0;
  }

  protected override async onBeforeCreate(
    createBy: CreateBy<Model>,
  ): Promise<OnCreate<Model>> {
    const rawConfiguration: unknown = createBy.data.configuration;
    if (typeof rawConfiguration === "string") {
      createBy.data.configuration =
        parseSecurityEventConfiguration(rawConfiguration);
    }
    validateSecurityEventConnection({
      provider: createBy.data.provider,
      configuration: createBy.data.configuration,
      credentialJson: createBy.data.credentialJson,
      pollIntervalInMinutes: createBy.data.pollIntervalInMinutes,
    });
    if (createBy.data.provider && createBy.data.configuration) {
      createBy.data.sourceFingerprint = securityEventSourceFingerprint(
        createBy.data.provider,
        createBy.data.configuration,
      );
    }
    return { createBy, carryForward: null };
  }

  protected override async onBeforeUpdate(
    updateBy: UpdateBy<Model>,
  ): Promise<OnUpdate<Model>> {
    delete (updateBy.data as unknown as Record<string, unknown>)[
      "sourceFingerprint"
    ];
    const incomingProvider: unknown = updateBy.data.provider;
    let incomingConfiguration: unknown = updateBy.data.configuration;
    const incomingCredentialJson: unknown = updateBy.data.credentialJson;
    const incomingPollInterval: unknown = updateBy.data.pollIntervalInMinutes;

    if (incomingProvider !== undefined) {
      throw new BadDataException(
        "The provider cannot be changed. Create a new connection for another provider.",
      );
    }

    const containsSqlExpression: boolean =
      isSqlExpressionValue(incomingConfiguration) ||
      isSqlExpressionValue(incomingCredentialJson) ||
      isSqlExpressionValue(incomingPollInterval);

    if (containsSqlExpression) {
      throw new BadDataException(
        "SQL expressions are not supported for security event connection settings.",
      );
    }

    if (incomingConfiguration !== undefined) {
      incomingConfiguration = parseSecurityEventConfiguration(
        incomingConfiguration as JSONObject | string,
      );
      (
        updateBy.data as unknown as {
          configuration?: JSONObject | undefined;
        }
      ).configuration = incomingConfiguration as JSONObject;
    }

    if (incomingPollInterval !== undefined) {
      validateSecurityEventConnection({
        pollIntervalInMinutes: incomingPollInterval as number,
      });
    }

    if (incomingCredentialJson !== undefined) {
      parseSecurityEventCredentialJson(incomingCredentialJson as string);
    }

    if (
      incomingConfiguration === undefined &&
      incomingCredentialJson === undefined
    ) {
      return { updateBy, carryForward: null };
    }

    return {
      updateBy,
      carryForward: {
        configurationSupplied: incomingConfiguration !== undefined,
        credentialsSupplied: incomingCredentialJson !== undefined,
        ...(incomingConfiguration !== undefined
          ? { configuration: incomingConfiguration as JSONObject }
          : {}),
        ...(incomingCredentialJson !== undefined
          ? { credentialJson: incomingCredentialJson as string }
          : {}),
        ...(incomingPollInterval !== undefined
          ? { pollIntervalInMinutes: incomingPollInterval as number }
          : {}),
      } as SecurityEventConnectionUpdateCarryForward,
    };
  }

  protected override getAdditionalUpdateSelect(
    onUpdate: OnUpdate<Model>,
  ): Select<Model> {
    const carryForward: SecurityEventConnectionUpdateCarryForward | null =
      onUpdate.carryForward as SecurityEventConnectionUpdateCarryForward | null;
    if (
      !carryForward?.configurationSupplied &&
      !carryForward?.credentialsSupplied
    ) {
      return {} as Select<Model>;
    }
    return {
      provider: true,
      configuration: true,
      credentialJson: true,
      pollIntervalInMinutes: true,
    } as Select<Model>;
  }

  protected override async onBeforeUpdateItems(
    onUpdate: OnUpdate<Model>,
    items: Array<Model>,
  ): Promise<void> {
    const carryForward: SecurityEventConnectionUpdateCarryForward | null =
      onUpdate.carryForward as SecurityEventConnectionUpdateCarryForward | null;
    if (!carryForward) {
      return;
    }

    for (const item of items) {
      validateSecurityEventConnection({
        provider: item.provider,
        configuration: carryForward.configurationSupplied
          ? carryForward.configuration
          : item.configuration,
        credentialJson: carryForward.credentialsSupplied
          ? carryForward.credentialJson
          : item.credentialJson,
        pollIntervalInMinutes:
          carryForward.pollIntervalInMinutes ?? item.pollIntervalInMinutes,
      });
    }
  }

  protected override async getInternalUpdateData(
    onUpdate: OnUpdate<Model>,
    item: Model,
  ): Promise<PartialEntity<Model>> {
    const carryForward: SecurityEventConnectionUpdateCarryForward | null =
      onUpdate.carryForward as SecurityEventConnectionUpdateCarryForward | null;
    if (!carryForward) {
      return {} as PartialEntity<Model>;
    }

    const sourceSettingsSupplied: boolean = carryForward.configurationSupplied;
    const internalData: Record<string, unknown> = {};
    let sourceChangedCondition: string = "";
    if (sourceSettingsSupplied) {
      const provider: SecurityEventConnectorType | undefined = item.provider;
      const configuration: JSONObject | undefined = carryForward.configuration;
      if (!provider || !configuration) {
        throw new BadDataException(
          "Provider and configuration are required to update source settings.",
        );
      }
      const fingerprint: string = securityEventSourceFingerprint(
        provider,
        configuration,
      );
      sourceChangedCondition = `"sourceFingerprint" IS DISTINCT FROM '${fingerprint}'`;
      internalData["sourceFingerprint"] = fingerprint;
      internalData["sourceGeneration"] = (): string => {
        return `CASE WHEN ${sourceChangedCondition} THEN "sourceGeneration" + 1 ELSE "sourceGeneration" END`;
      };
    }

    const pollingStateColumns: Array<string> = [
      "cursor",
      "lastPolledAt",
      "lastSuccessfulPollAt",
      "lastEventIngestedAt",
      "lastPollResult",
      "lastError",
    ];
    if (carryForward.credentialsSupplied) {
      for (const column of pollingStateColumns) {
        internalData[column] = null;
      }
    } else if (sourceChangedCondition) {
      for (const column of pollingStateColumns) {
        internalData[column] = (): string => {
          return `CASE WHEN ${sourceChangedCondition} THEN NULL ELSE "${column}" END`;
        };
      }
    }
    return internalData as unknown as PartialEntity<Model>;
  }

  protected override async onCreateSuccess(
    _onCreate: OnCreate<Model>,
    createdItem: Model,
  ): Promise<Model> {
    delete createdItem.credentialJson;
    delete createdItem.cursor;
    delete createdItem.sourceFingerprint;
    delete createdItem.sourceGeneration;
    return createdItem;
  }
}

export default new Service();

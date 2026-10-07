import Email from "../../../Types/Email";
import BadDataException from "../../../Types/Exception/BadDataException";
import { JSONObject, JSONValue } from "../../../Types/JSON";
import VideoCallProvider from "../../../Types/VideoCall/VideoCallProvider";
import {
  VideoCallConnectionField,
  VideoCallProviderDefinition,
  getVideoCallProviderDefinition,
  isConnectableVideoCallProvider,
} from "../../../Types/VideoCall/VideoCallProviderCatalog";
import GoogleMeetClient from "./Providers/GoogleMeetClient";
import MicrosoftTeamsMeetingClient from "./Providers/MicrosoftTeamsMeetingClient";

/*
 * A video call connection's settings, checked at save time so a connection
 * that saves is one a call can be started with: a wrong key, a missing
 * secret or a malformed id surfaces to the person configuring it, not as a
 * failed call in the middle of an incident.
 *
 * `config` holds the provider's non-secret settings and `secrets` its
 * credentials, both keyed by the catalog's field keys. The secrets are
 * encrypted at rest and never returned by the API.
 */
export interface VideoCallConnectionSettings {
  provider: VideoCallProvider;
  config: JSONObject;
  secrets: JSONObject;
}

// Longer than any real meeting link, short enough to keep out a payload.
export const MAX_MEETING_LINK_LENGTH: number = 2048;

// A tenant is named by its GUID or by one of its domains.
const TENANT_DOMAIN_REGEX: RegExp =
  /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/i;

// A Zoom user is named by email or by its user id.
const ZOOM_USER_ID_REGEX: RegExp = /^[A-Za-z0-9_-]{6,64}$/;

const SIMPLE_EMAIL_REGEX: RegExp = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default class VideoCallConnectionSettingsUtil {
  /*
   * The JSON a form submits for config and secrets. Both may arrive as an
   * object or as JSON text; anything else is a 400.
   */
  public static parseJsonObject(value: unknown, fieldName: string): JSONObject {
    if (value === undefined || value === null || value === "") {
      return {};
    }

    let parsed: unknown = value;

    if (typeof value === "string") {
      try {
        parsed = JSON.parse(value);
      } catch {
        throw new BadDataException(`${fieldName} must be a JSON object.`);
      }
    }

    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new BadDataException(`${fieldName} must be a JSON object.`);
    }

    return parsed as JSONObject;
  }

  public static getDefinitionOrThrow(
    provider: unknown,
  ): VideoCallProviderDefinition {
    const definition: VideoCallProviderDefinition | undefined =
      isConnectableVideoCallProvider(provider)
        ? getVideoCallProviderDefinition(provider)
        : undefined;

    if (!definition) {
      throw new BadDataException(
        "Provider must be one of Zoom, Google Meet, Microsoft Teams or Meeting link.",
      );
    }

    return definition;
  }

  public static isEmail(value: string): boolean {
    const trimmed: string = value.trim();
    return SIMPLE_EMAIL_REGEX.test(trimmed) && Email.isValid(trimmed);
  }

  public static readString(values: JSONObject, key: string): string {
    const value: JSONValue | undefined = values[key];

    if (typeof value === "string") {
      return value.trim();
    }

    if (typeof value === "number" || typeof value === "boolean") {
      return String(value);
    }

    return "";
  }

  /*
   * A secret is read untrimmed: a client secret may legitimately end in a
   * character a trim would remove, and a pasted key keeps its newlines.
   */
  public static readSecret(values: JSONObject, key: string): string {
    const value: JSONValue | undefined = values[key];
    return typeof value === "string" ? value : "";
  }

  /*
   * Keys are the catalog's and values are text. Unknown keys are refused
   * rather than stored, so a typo in a field key cannot quietly become "the
   * setting was never provided".
   */
  public static validateFields(data: {
    definition: VideoCallProviderDefinition;
    fields: Array<VideoCallConnectionField>;
    values: JSONObject;
    label: string;
    requireRequiredFields: boolean;
  }): void {
    const fieldsByKey: Map<string, VideoCallConnectionField> = new Map(
      data.fields.map(
        (
          field: VideoCallConnectionField,
        ): [string, VideoCallConnectionField] => {
          return [field.key, field];
        },
      ),
    );

    for (const key of Object.keys(data.values)) {
      const field: VideoCallConnectionField | undefined = fieldsByKey.get(key);

      if (!field) {
        throw new BadDataException(
          `${data.label} contains an unknown setting "${key}" for ${data.definition.title}.`,
        );
      }

      const value: JSONValue | undefined = data.values[key];

      if (value !== null && value !== undefined && typeof value !== "string") {
        throw new BadDataException(`${field.title} must be text.`);
      }
    }

    for (const field of data.fields) {
      const raw: JSONValue | undefined = data.values[field.key];
      const text: string = typeof raw === "string" ? raw.trim() : "";

      if (!text) {
        if (field.required && data.requireRequiredFields) {
          throw new BadDataException(
            `${field.title} is required for ${data.definition.title}.`,
          );
        }

        continue;
      }

      if (field.type === "dropdown" && field.options) {
        const allowed: Array<string> = field.options.map(
          (option: { value: string }): string => {
            return option.value;
          },
        );

        if (!allowed.includes(text)) {
          throw new BadDataException(
            `${field.title} must be one of: ${allowed.join(", ")}.`,
          );
        }
      }

      if (field.type === "json") {
        let parsed: unknown;

        try {
          parsed = JSON.parse(text);
        } catch {
          throw new BadDataException(`${field.title} must be a JSON object.`);
        }

        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
          throw new BadDataException(`${field.title} must be a JSON object.`);
        }
      }

      if (field.type === "url") {
        VideoCallConnectionSettingsUtil.validateMeetingLink(text, field.title);
      }
    }
  }

  /*
   * A link a person provides - a standing bridge or a link pasted on one
   * incident. It is posted to Slack and Microsoft Teams as a button and
   * opened by every responder, so only an https link without credentials
   * in it is accepted.
   */
  public static validateMeetingLink(value: string, fieldTitle: string): void {
    const text: string = (value || "").trim();

    if (!text) {
      throw new BadDataException(`${fieldTitle} is required.`);
    }

    if (text.length > MAX_MEETING_LINK_LENGTH) {
      throw new BadDataException(
        `${fieldTitle} must be at most ${MAX_MEETING_LINK_LENGTH} characters.`,
      );
    }

    let parsed: URL;

    try {
      parsed = new URL(text);
    } catch {
      throw new BadDataException(
        `${fieldTitle} must be a full https link, such as https://example.zoom.us/j/1234567890.`,
      );
    }

    if (parsed.protocol !== "https:") {
      throw new BadDataException(`${fieldTitle} must be an https link.`);
    }

    if (parsed.username || parsed.password) {
      throw new BadDataException(
        `${fieldTitle} must not contain a user name or password.`,
      );
    }
  }

  /*
   * Provider rules the catalog's field types cannot say: ids that must be
   * GUIDs, a key file that must parse, an email that must look like one.
   */
  public static validateProviderRules(
    settings: VideoCallConnectionSettings,
  ): void {
    const config: JSONObject = settings.config;

    switch (settings.provider) {
      case VideoCallProvider.Zoom: {
        const hostEmail: string = this.readString(config, "hostEmail");

        if (
          hostEmail &&
          !this.isEmail(hostEmail) &&
          !ZOOM_USER_ID_REGEX.test(hostEmail)
        ) {
          throw new BadDataException(
            "Meeting host must be the email address of a Zoom user, such as incidents@example.com.",
          );
        }

        return;
      }

      case VideoCallProvider.GoogleMeet: {
        const userEmail: string = this.readString(
          config,
          "impersonatedUserEmail",
        );

        if (userEmail && !this.isEmail(userEmail)) {
          throw new BadDataException(
            "Create meetings as must be the email address of a Google Workspace user, such as incidents@example.com.",
          );
        }

        const serviceAccountJson: string = this.readSecret(
          settings.secrets,
          "serviceAccountJson",
        );

        if (serviceAccountJson.trim()) {
          GoogleMeetClient.parseServiceAccountJson(serviceAccountJson);
        }

        return;
      }

      case VideoCallProvider.MicrosoftTeams: {
        const tenantId: string = this.readString(config, "tenantId");

        if (
          tenantId &&
          !MicrosoftTeamsMeetingClient.isGuid(tenantId) &&
          !TENANT_DOMAIN_REGEX.test(tenantId)
        ) {
          throw new BadDataException(
            "Directory (tenant) ID must be a GUID, such as 00000000-0000-0000-0000-000000000000.",
          );
        }

        const clientId: string = this.readString(config, "clientId");

        if (clientId && !MicrosoftTeamsMeetingClient.isGuid(clientId)) {
          throw new BadDataException(
            "Application (client) ID must be a GUID, such as 00000000-0000-0000-0000-000000000000.",
          );
        }

        const organizerUserId: string = this.readString(
          config,
          "organizerUserId",
        );

        if (
          organizerUserId &&
          !MicrosoftTeamsMeetingClient.isGuid(organizerUserId)
        ) {
          throw new BadDataException(
            "Organizer object ID must be the Object ID (a GUID) of a Microsoft Entra user, not an email address. Find it in the Entra admin center under Users.",
          );
        }

        return;
      }

      default:
        return;
    }
  }

  /*
   * Fills a dropdown left unset with its default, so a connection created
   * through the API without one behaves as the form's would.
   */
  public static withConfigDefaults(
    definition: VideoCallProviderDefinition,
    config: JSONObject,
  ): JSONObject {
    const result: JSONObject = { ...config };

    for (const field of definition.configFields) {
      const current: JSONValue | undefined = result[field.key];
      const isEmpty: boolean =
        current === undefined ||
        current === null ||
        (typeof current === "string" && current.trim() === "");

      if (isEmpty && field.defaultValue !== undefined) {
        result[field.key] = field.defaultValue;
      }
    }

    return result;
  }

  /*
   * Full validation of settings: the catalog's shape, then the provider's
   * own rules. Used on create, on update (with the merged secrets) and by
   * the connection test for settings that were never stored.
   */
  public static validate(data: {
    provider: unknown;
    config: JSONObject;
    secrets: JSONObject;
    requireRequiredSecrets: boolean;
  }): VideoCallConnectionSettings {
    const definition: VideoCallProviderDefinition = this.getDefinitionOrThrow(
      data.provider,
    );

    const config: JSONObject = this.withConfigDefaults(definition, data.config);

    this.validateFields({
      definition,
      fields: definition.configFields,
      values: config,
      label: "Configuration",
      requireRequiredFields: true,
    });

    this.validateFields({
      definition,
      fields: definition.secretFields,
      values: data.secrets,
      label: "Credentials",
      requireRequiredFields: data.requireRequiredSecrets,
    });

    const settings: VideoCallConnectionSettings = {
      provider: definition.provider,
      config: config,
      secrets: data.secrets,
    };

    this.validateProviderRules(settings);

    return settings;
  }

  /*
   * Secrets are write-only, so an edit form cannot echo them back. Each
   * submitted key is read as:
   *   - a non-empty value: replaces the stored one;
   *   - "" or undefined: keeps the stored one (an untouched password input);
   *   - null: removes the stored key.
   * The merged object is validated by the caller, so clearing a required
   * secret fails with that field's "is required" message.
   */
  public static mergeSecrets(data: {
    definition: VideoCallProviderDefinition;
    stored: JSONObject;
    provided: JSONObject;
  }): JSONObject {
    const knownKeys: Set<string> = new Set(
      data.definition.secretFields.map(
        (field: VideoCallConnectionField): string => {
          return field.key;
        },
      ),
    );
    const merged: JSONObject = { ...data.stored };

    for (const key of Object.keys(data.provided)) {
      const value: JSONValue | undefined = data.provided[key];

      if (value === null) {
        if (
          !knownKeys.has(key) &&
          !Object.prototype.hasOwnProperty.call(data.stored, key)
        ) {
          throw new BadDataException(
            `Credentials contains an unknown setting "${key}" for ${data.definition.title}.`,
          );
        }

        delete merged[key];
        continue;
      }

      if (value === undefined || value === "") {
        continue;
      }

      merged[key] = value;
    }

    return merged;
  }
}

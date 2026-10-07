import { createPrivateKey } from "crypto";
import jwt from "jsonwebtoken";
import BadDataException from "../../../../Types/Exception/BadDataException";
import APIException from "../../../../Types/Exception/ApiException";
import { JSONObject, JSONValue } from "../../../../Types/JSON";
import VideoCallMeeting from "../../../../Types/VideoCall/VideoCallMeeting";
import VideoCallProvider from "../../../../Types/VideoCall/VideoCallProvider";
import { GOOGLE_MEET_SCOPE } from "../../../../Types/VideoCall/VideoCallProviderCatalog";
import VideoCallHttpClient, {
  VideoCallHttpResponse,
} from "../VideoCallHttpClient";
import { VideoCallMeetingRequest } from "../VideoCallMeetingRequest";

/*
 * Creates incident meetings as a Google Meet space through the Meet REST
 * API, acting as a Google Workspace user through a service account with
 * domain-wide delegation.
 *
 * A service account cannot own a Meet space itself - the Meet API only
 * accepts a token that acts as a real Workspace user - so the assertion
 * names that user as its subject (`sub`). The admin grants the service
 * account the meetings.space.created scope once, in the Admin console, and
 * from then on no person's token is involved.
 * https://developers.google.com/workspace/meet/api/guides/authenticate-authorize
 * https://developers.google.com/identity/protocols/oauth2/service-account#delegatingauthority
 *
 * A space has no name of its own - it is a room with a link - and lives on
 * after its conference ends, so the same link works for the whole incident.
 * https://developers.google.com/workspace/meet/api/reference/rest/v2/spaces/create
 */

export interface GoogleMeetClientSettings {
  serviceAccountJson: string;
  impersonatedUserEmail: string;
  // "TRUSTED" or "OPEN" (SpaceConfig.accessType).
  accessType: string;
}

export interface GoogleServiceAccountKey {
  clientEmail: string;
  // The numeric OAuth client id domain-wide delegation is granted to.
  clientId: string;
  privateKey: string;
  tokenUri: string;
}

export const GOOGLE_MEET_SPACES_URL: string =
  "https://meet.googleapis.com/v2/spaces";
export const GOOGLE_DEFAULT_TOKEN_URI: string =
  "https://oauth2.googleapis.com/token";

const TOKEN_LIFETIME_IN_SECONDS: number = 3600;

/*
 * Google rejects an assertion whose iat is in the future, and a host clock a
 * few seconds fast is enough to trigger it - reported back as invalid_grant,
 * which reads exactly like a bad key. Backdated instead; exp stays at most
 * an hour after iat, Google's maximum.
 */
const TOKEN_CLOCK_SKEW_IN_SECONDS: number = 60;

const ALLOWED_ACCESS_TYPES: Array<string> = ["TRUSTED", "OPEN"];

/*
 * The words Google uses for the failures a person can fix, matched against
 * the error a token or space request came back with.
 */
const KEY_NO_LONGER_VALID_PATTERN: RegExp =
  /signature|not found|disabled|deleted/i;
const SERVICE_DISABLED_PATTERN: RegExp = /SERVICE_DISABLED/;
const API_NOT_ENABLED_PATTERN: RegExp =
  /has not been used in project|is disabled/i;

/*
 * The token endpoint comes from a key a person pasted. Only Google's own
 * hosts may receive the signed assertion.
 */
const TOKEN_URI_HOSTS: Array<string> = ["accounts.google.com"];
const TOKEN_URI_HOST_SUFFIX: string = ".googleapis.com";

export default class GoogleMeetClient {
  private settings: GoogleMeetClientSettings;
  private key: GoogleServiceAccountKey;
  private http: VideoCallHttpClient;

  public constructor(
    settings: GoogleMeetClientSettings,
    http?: VideoCallHttpClient | undefined,
  ) {
    this.settings = settings;
    this.key = GoogleMeetClient.parseServiceAccountJson(
      settings.serviceAccountJson,
    );
    this.http = http || new VideoCallHttpClient();
  }

  public async createMeeting(
    _request: VideoCallMeetingRequest,
  ): Promise<VideoCallMeeting> {
    const accessToken: string = await this.getAccessToken();

    const accessType: string = ALLOWED_ACCESS_TYPES.includes(
      this.settings.accessType,
    )
      ? this.settings.accessType
      : "TRUSTED";

    const response: VideoCallHttpResponse = await this.http.request({
      url: GOOGLE_MEET_SPACES_URL,
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        config: {
          accessType: accessType,
          entryPointAccess: "ALL",
        },
      }),
      stepLabel: "Google Meet request",
    });

    if (!response.ok) {
      throw this.getMeetingError(response);
    }

    const meetingUri: JSONValue | undefined = response.json?.["meetingUri"];
    const spaceName: JSONValue | undefined = response.json?.["name"];

    if (
      typeof meetingUri !== "string" ||
      !GoogleMeetClient.isMeetUrl(meetingUri)
    ) {
      throw new APIException(
        "Google created the meeting space but returned no join link for it.",
      );
    }

    return {
      provider: VideoCallProvider.GoogleMeet,
      joinUrl: meetingUri,
      externalMeetingId: typeof spaceName === "string" ? spaceName : undefined,
    };
  }

  public async getAccessToken(): Promise<string> {
    const issuedAtInSeconds: number =
      Math.floor(Date.now() / 1000) - TOKEN_CLOCK_SKEW_IN_SECONDS;

    const assertion: string = jwt.sign(
      {
        iss: this.key.clientEmail,
        sub: this.settings.impersonatedUserEmail.trim(),
        scope: GOOGLE_MEET_SCOPE,
        aud: this.key.tokenUri,
        iat: issuedAtInSeconds,
        exp: issuedAtInSeconds + TOKEN_LIFETIME_IN_SECONDS,
      },
      this.key.privateKey,
      { algorithm: "RS256" },
    );

    const response: VideoCallHttpResponse = await this.http.request({
      url: this.key.tokenUri,
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
        assertion: assertion,
      }).toString(),
      stepLabel: "Google token request",
    });

    if (!response.ok) {
      throw this.getTokenError(response);
    }

    const accessToken: JSONValue | undefined = response.json?.["access_token"];

    if (typeof accessToken !== "string" || !accessToken) {
      throw new APIException("Google returned no access token.");
    }

    return accessToken;
  }

  public static parseServiceAccountJson(
    serviceAccountJson: string,
  ): GoogleServiceAccountKey {
    let parsed: unknown;

    try {
      parsed = JSON.parse(serviceAccountJson || "");
    } catch {
      throw new BadDataException(
        "Service account JSON key is not valid JSON. Paste the whole key file you downloaded from Google Cloud.",
      );
    }

    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new BadDataException(
        "Service account JSON key must be a JSON object.",
      );
    }

    const key: JSONObject = parsed as JSONObject;

    /*
     * Read before coercing: String({}) is "[object Object]", which would sail
     * through the checks below and fail later inside jwt.sign.
     */
    if (
      typeof key["client_email"] !== "string" ||
      typeof key["private_key"] !== "string" ||
      !key["client_email"] ||
      !key["private_key"]
    ) {
      throw new BadDataException(
        "Service account JSON key must contain client_email and private_key. Paste the whole key file you downloaded from Google Cloud.",
      );
    }

    const tokenUri: string =
      typeof key["token_uri"] === "string" && key["token_uri"]
        ? key["token_uri"]
        : GOOGLE_DEFAULT_TOKEN_URI;

    GoogleMeetClient.validateTokenUri(tokenUri);
    GoogleMeetClient.validatePrivateKey(key["private_key"]);

    return {
      clientEmail: key["client_email"],
      clientId: typeof key["client_id"] === "string" ? key["client_id"] : "",
      privateKey: key["private_key"],
      tokenUri: tokenUri,
    };
  }

  public static isMeetUrl(url: string): boolean {
    let parsed: URL;

    try {
      parsed = new URL(url);
    } catch {
      return false;
    }

    return (
      parsed.protocol === "https:" &&
      parsed.hostname.toLowerCase() === "meet.google.com"
    );
  }

  private static validateTokenUri(tokenUri: string): void {
    let parsed: URL;

    try {
      parsed = new URL(tokenUri);
    } catch {
      throw new BadDataException(
        "Service account JSON key has a token_uri that is not an absolute https URL.",
      );
    }

    const hostname: string = parsed.hostname.toLowerCase();
    const isGoogleHost: boolean =
      TOKEN_URI_HOSTS.includes(hostname) ||
      hostname.endsWith(TOKEN_URI_HOST_SUFFIX);

    if (
      parsed.protocol !== "https:" ||
      !isGoogleHost ||
      parsed.username ||
      parsed.password
    ) {
      throw new BadDataException(
        "Service account JSON key has a token_uri that is not on a Google host, such as https://oauth2.googleapis.com/token.",
      );
    }
  }

  private static validatePrivateKey(privateKey: string): void {
    /*
     * A double-escaped or truncated key would save cleanly and fail on the
     * first incident inside jwt.sign, with nobody looking.
     */
    try {
      createPrivateKey(privateKey);
    } catch {
      throw new BadDataException(
        "Service account JSON key has a private_key that is not a readable PEM private key. Paste the key file exactly as downloaded.",
      );
    }
  }

  private getDelegationHint(): string {
    const clientIdText: string = this.key.clientId
      ? `client ID ${this.key.clientId}`
      : "the service account's client ID";

    return `In the Google Admin console, open Security > Access and data control > API controls > Manage Domain Wide Delegation and authorize ${clientIdText} for the scope ${GOOGLE_MEET_SCOPE}.`;
  }

  private getTokenError(response: VideoCallHttpResponse): Error {
    const errorCode: string = VideoCallHttpClient.readErrorCode(
      response.json,
    ).toLowerCase();
    const summary: string = VideoCallHttpClient.summarizeErrorBody(response);

    if (errorCode === "unauthorized_client" || errorCode === "access_denied") {
      return new BadDataException(
        `Google did not let the service account act as ${this.settings.impersonatedUserEmail.trim()}. ${this.getDelegationHint()} (${summary})`,
      );
    }

    if (errorCode === "invalid_grant") {
      if (KEY_NO_LONGER_VALID_PATTERN.test(summary)) {
        return new BadDataException(
          `Google rejected the service account key - it may have been deleted or disabled. Create a new JSON key for the service account and paste it here. (${summary})`,
        );
      }

      return new BadDataException(
        `Google rejected the user to create meetings as. Check that ${this.settings.impersonatedUserEmail.trim()} is an active user of your Google Workspace. (${summary})`,
      );
    }

    if (response.status >= 400 && response.status < 500) {
      return new BadDataException(
        `Google could not issue a token for the service account (HTTP ${response.status}): ${summary}`,
      );
    }

    return new APIException(
      `Google could not issue a token for the service account (HTTP ${response.status}): ${summary}`,
    );
  }

  private getMeetingError(response: VideoCallHttpResponse): Error {
    const errorCode: string = VideoCallHttpClient.readErrorCode(response.json);
    const summary: string = VideoCallHttpClient.summarizeErrorBody(response);

    if (
      SERVICE_DISABLED_PATTERN.test(response.bodyText) ||
      API_NOT_ENABLED_PATTERN.test(summary)
    ) {
      return new BadDataException(
        `The Google Meet REST API is not enabled for the service account's Google Cloud project. Enable it in the Google Cloud console under APIs & Services, then try again. (${summary})`,
      );
    }

    if (response.status === 401 || response.status === 403) {
      return new BadDataException(
        `Google did not allow ${this.settings.impersonatedUserEmail.trim()} to create a meeting space. Check that the user has Google Meet and that ${this.getDelegationHint()} (${errorCode || response.status}: ${summary})`,
      );
    }

    if (response.status >= 400 && response.status < 500) {
      return new BadDataException(
        `Google could not create the meeting space (HTTP ${response.status}): ${summary}`,
      );
    }

    return new APIException(
      `Google could not create the meeting space (HTTP ${response.status}): ${summary}`,
    );
  }
}

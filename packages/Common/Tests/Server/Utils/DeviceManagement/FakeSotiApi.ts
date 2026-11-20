import Dictionary from "../../../../Types/Dictionary";
import { JSONObject } from "../../../../Types/JSON";
import {
  DataSourceHttpRequest,
  DataSourceHttpResponse,
} from "../../../../Server/Utils/DataSource/HttpFetch";
import { DeviceManagementTransport } from "../../../../Server/Utils/DeviceManagement/DeviceManagementTypes";

/*
 * A SOTI MobiControl server in a test (#10087), answering the way its REST
 * API reference (the Swagger every server serves at /MobiControl/api)
 * documents it:
 *
 *   - POST /MobiControl/api/token, "Authorization: Basic
 *     base64(<client ID>:<client secret>)" and a form body with
 *     grant_type=password, username and password: {"access_token",
 *     "token_type": "bearer", "expires_in": 3600}; a wrong API client is
 *     400 {"error": "invalid_client"}, a wrong user or password 400
 *     {"error": "invalid_grant"};
 *   - every API route takes "Authorization: Bearer <token>", else 401
 *     {"ErrorCode": 0, "Message": "Authorization has been denied for this
 *     request."}; a user without the permission is 403;
 *   - GET /MobiControl/api/devices?skip=N&take=M: a plain array of devices,
 *     each with its Kind's fields;
 *   - GET /MobiControl/api/devices/{id}/installedApplications?skip&take: a
 *     plain array of apps (the ID decoded twice, as MobiControl does);
 *   - POST /MobiControl/api/devices/summary: the devices counted by the
 *     property asked for.
 *
 * Faults are scripted per path: answers to give first. Every request is
 * recorded.
 */

export const SOTI_SERVER: string = "acme.mobicontrolcloud.com";
export const SOTI_CLIENT_ID: string = "a9326fd5872f4a66b6bab3e2c8065e63";
export const SOTI_CLIENT_SECRET: string = "19DzUX7K7ObjwPRFbxZanwVQFsUcqMak";
export const SOTI_USERNAME: string = "oneuptime-reader";
export const SOTI_PASSWORD: string = "Reader pass 2026!";
export const SOTI_TOKEN: string =
  "AAEAAK0OiDDPciqCR5sZ6Nu6c8wIvURVwCTxslETUGpxDfmf6uzkXAg9MKzfJqm4k9AD";

export interface FakeSotiAnswer {
  status: number;
  body?: unknown;
  headers?: Dictionary<string> | undefined;
}

export interface FakeSotiRequest {
  method: string;
  url: string;
  host: string;
  path: string;
  query: URLSearchParams;
  headers: Dictionary<string>;
  body: unknown;
  egressLabel: string | undefined;
}

export interface FakeSotiOptions {
  server?: string | undefined;
  clientId?: string | undefined;
  clientSecret?: string | undefined;
  username?: string | undefined;
  password?: string | undefined;
  devices?: Array<JSONObject> | undefined;
  // Each device's apps, by its ID.
  apps?: Record<string, Array<JSONObject>> | undefined;
  // The user may not read the devices (or their apps).
  isPermissionMissing?: boolean | undefined;
  tokenLifetimeSeconds?: number | undefined;
}

/*
 * An Android Plus device as the API lists one, with its Kind's fields - a
 * warehouse scanner whose agent is connected - and its user's details, as
 * MobiControl sends them: the import never keeps those.
 */
export function buildSotiDevice(overrides: JSONObject = {}): JSONObject {
  return {
    $type: "DeviceAndroidPlus",
    Kind: "AndroidPlus",
    CompliancePolicyStatus: "Compliant",
    ComplianceStatus: true,
    ComplianceItems: [{ ComplianceType: "rooted", ComplianceValue: false }],
    DeviceId: "35-8C4F2A9B1D7E",
    DeviceName: "WH-SCANNER-07",
    EnrollmentType: "DeviceEnrollment",
    EnrollmentTime: "2025-03-04T09:12:44Z",
    Family: "AndroidPlus",
    HostName: "wh-scanner-07",
    IsAgentOnline: true,
    CustomAttributes: [{ Name: "Owner", Value: "Megan Bowen" }],
    MACAddress: "00:11:22:33:44:55",
    BluetoothMAC: "00:11:22:33:44:56",
    WifiMAC: "00:11:22:33:44:57",
    Manufacturer: "Zebra Technologies",
    Mode: "Active",
    Model: "TC52",
    OSVersion: "13",
    Path: "\\\\Acme\\Warehouses\\Dallas",
    Platform: "AndroidPlus",
    ServerName: "MCDS01",
    AgentVersion: "2025.0.1.1234",
    AndroidApiLevel: 33,
    Memory: {
      AvailableExternalStorage: 0,
      AvailableMemory: 1879048192,
      AvailableSDCardStorage: 0,
      AvailableStorage: 18253611008,
      TotalExternalStorage: 0,
      TotalMemory: 3758096384,
      TotalSDCardStorage: 0,
      TotalStorage: 31675383808,
    },
    BatteryStatus: 76,
    CellularCarrier: "Carrier",
    HardwareSerialNumber: "21075B2C3D",
    MobileSerialNumber: "21075B2C3D",
    IMEI_MEID_ESN: "354123456789012",
    IsEncrypted: true,
    LastCheckInTime: "2026-11-19T10:15:00Z",
    LastAgentConnectTime: "2026-11-19T07:02:11Z",
    LastAgentDisconnectTime: "2026-11-19T07:01:40Z",
    LastLoggedOnUser: "mbowen",
    PersonalizedName: "Megan's scanner",
    PhoneNumber: "+15555550123",
    SubscriberNumber: "+15555550123",
    BuildSecurityPatch: "2026-10-01",
    DeviceUserInfo: { UserName: "mbowen", Email: "megan@contoso.com" },
    Ipv6: "fe80::211:22ff:fe33:4457",
    ...overrides,
  };
}

// An iPad its agent is not connected from: it checks in through Apple's push.
export function buildSotiIpad(overrides: JSONObject = {}): JSONObject {
  return buildSotiDevice({
    $type: "DeviceIos",
    Kind: "Ios",
    Family: "Apple",
    Platform: "iOS",
    DeviceId: "IOS-00008110001A2B3C",
    DeviceName: "Lobby iPad",
    Manufacturer: "Apple",
    Model: "iPad (9th generation)",
    ProductName: "iPad12,1",
    OSVersion: "17.6.1",
    BuildVersion: "21G93",
    HardwareSerialNumber: undefined as unknown as string,
    ManufacturerSerialNumber: "DMPXK1ABCDEF",
    IMEI_MEID_ESN: "",
    IsAgentOnline: false,
    IsSupervised: true,
    LastCheckInTime: "2026-11-19T02:00:00Z",
    LastStatusUpdate: "2026-11-19T04:30:00Z",
    LastAgentConnectTime: "0001-01-01T00:00:00Z",
    LastAgentDisconnectTime: "0001-01-01T00:00:00Z",
    Path: "\\\\Acme\\Stores\\West",
    BuildSecurityPatch: undefined as unknown as string,
    ...overrides,
  });
}

// A Windows laptop, whose agent disconnected two hours before the read.
export function buildSotiWindows(overrides: JSONObject = {}): JSONObject {
  return buildSotiDevice({
    $type: "DeviceWindowsDesktop",
    Kind: "WindowsDesktop",
    Family: "WindowsDesktop",
    Platform: "WindowsTen64",
    DeviceId: "WIN-5D1C2B3A4E5F",
    DeviceName: "DESKTOP-7KQ2M1",
    Manufacturer: "Dell Inc.",
    Model: "Latitude 5440",
    OSVersion: "10.0.22631",
    HardwareSerialNumber: "PF3ABCDE",
    IMEI_MEID_ESN: "",
    IsAgentOnline: false,
    LastCheckInTime: "2026-11-19T09:30:00Z",
    LastAgentConnectTime: "2026-11-19T06:00:00Z",
    LastAgentDisconnectTime: "2026-11-19T10:00:00Z",
    Path: "\\\\Acme\\Offices",
    BuildSecurityPatch: undefined as unknown as string,
    ...overrides,
  });
}

export function buildSotiApp(overrides: JSONObject = {}): JSONObject {
  return {
    DeviceId: "35-8C4F2A9B1D7E",
    ApplicationId: "com.example.scanner",
    Name: "Scanner",
    Version: "4.2.0",
    ShortVersion: "",
    SizeInBytes: 48321536,
    DataSizeInBytes: 1024,
    Status: "Installed",
    CanChangeManagementState: false,
    InstalledOn: "2026-10-02T08:00:00Z",
    Build: "420",
    ...overrides,
  };
}

export class FakeSotiApi {
  public readonly requests: Array<FakeSotiRequest> = [];
  private readonly options: FakeSotiOptions;
  private readonly scripted: Map<string, Array<FakeSotiAnswer>> = new Map<
    string,
    Array<FakeSotiAnswer>
  >();
  private failures: Map<string, number> = new Map<string, number>();
  private issued: number = 0;

  public constructor(options: FakeSotiOptions = {}) {
    this.options = options;
  }

  public get server(): string {
    return this.options.server || SOTI_SERVER;
  }

  // Answers to give, in order, before the path answers as it would.
  public script(path: string, answers: Array<FakeSotiAnswer>): void {
    this.scripted.set(path, [...(this.scripted.get(path) || []), ...answers]);
  }

  // The transport throws this many times on a path, as a dropped connection does.
  public dropConnections(path: string, times: number): void {
    this.failures.set(path, times);
  }

  public requestsTo(path: string): Array<FakeSotiRequest> {
    return this.requests.filter((request: FakeSotiRequest): boolean => {
      return request.path === path;
    });
  }

  public get tokensIssued(): number {
    return this.issued;
  }

  public get transport(): DeviceManagementTransport {
    return async (
      request: DataSourceHttpRequest,
    ): Promise<DataSourceHttpResponse> => {
      const url: URL = new URL(request.url);
      const recorded: FakeSotiRequest = {
        method: request.method,
        url: request.url,
        host: url.host,
        path: url.pathname,
        query: url.searchParams,
        headers: request.headers || {},
        body: request.body,
        egressLabel: request.egressOptions?.targetLabel,
      };
      this.requests.push(recorded);

      const drops: number = this.failures.get(url.pathname) || 0;

      if (drops > 0) {
        this.failures.set(url.pathname, drops - 1);
        throw new Error("socket hang up");
      }

      const scripted: Array<FakeSotiAnswer> | undefined = this.scripted.get(
        url.pathname,
      );

      if (scripted && scripted.length > 0) {
        return this.respond(scripted.shift()!);
      }

      if (url.host !== this.server || url.protocol !== "https:") {
        return this.respond({ status: 404, body: "Not Found" });
      }

      const path: string = url.pathname.toLowerCase();

      if (path === "/mobicontrol/api/token") {
        return this.respond(this.token(request));
      }

      return this.respond(this.api(url, recorded));
    };
  }

  private token(request: DataSourceHttpRequest): FakeSotiAnswer {
    const form: Dictionary<string> =
      request.body && typeof request.body === "object"
        ? (request.body as Dictionary<string>)
        : {};
    const client: string = `Basic ${Buffer.from(
      `${this.options.clientId || SOTI_CLIENT_ID}:${this.options.clientSecret || SOTI_CLIENT_SECRET}`,
    ).toString("base64")}`;

    if (request.method !== "POST" || !request.formUrlEncoded) {
      return { status: 405, body: { Message: "Method not allowed." } };
    }

    if ((request.headers || {})["Authorization"] !== client) {
      return { status: 400, body: { error: "invalid_client" } };
    }

    if (
      form["grant_type"] !== "password" ||
      form["username"] !== (this.options.username || SOTI_USERNAME) ||
      form["password"] !== (this.options.password || SOTI_PASSWORD)
    ) {
      return { status: 400, body: { error: "invalid_grant" } };
    }

    this.issued++;

    return {
      status: 200,
      body: {
        access_token: SOTI_TOKEN,
        token_type: "bearer",
        expires_in: this.options.tokenLifetimeSeconds ?? 3600,
      },
    };
  }

  private api(url: URL, request: FakeSotiRequest): FakeSotiAnswer {
    if (request.headers["Authorization"] !== `Bearer ${SOTI_TOKEN}`) {
      return {
        status: 401,
        body: {
          $type: "ErrorDetails",
          ErrorCode: 0,
          Message: "Authorization has been denied for this request.",
          Data: [],
          HelpLink: null,
        },
      };
    }

    if (this.options.isPermissionMissing) {
      return {
        status: 403,
        body: {
          $type: "ErrorDetails",
          ErrorCode: 0,
          Message: "The user does not have permission to perform this action.",
          Data: [],
          HelpLink: null,
        },
      };
    }

    const path: string = url.pathname.toLowerCase();
    const skip: number = Number(url.searchParams.get("skip") || "0");
    const take: number = Number(url.searchParams.get("take") || "50");
    const devices: Array<JSONObject> = this.options.devices || [];

    if (path === "/mobicontrol/api/devices") {
      return { status: 200, body: devices.slice(skip, skip + take) };
    }

    if (path === "/mobicontrol/api/devices/summary") {
      const counts: Map<string, number> = new Map<string, number>();

      for (const device of devices) {
        const mode: string = String(device["Mode"] || "Active");
        counts.set(mode, (counts.get(mode) || 0) + 1);
      }

      return {
        status: 200,
        body: [
          {
            AggregationName: "Modes",
            OtherCount: 0,
            Buckets: Array.from(counts.entries()).map(
              ([value, count]: [string, number]): JSONObject => {
                return { Value: value, Count: count };
              },
            ),
          },
        ],
      };
    }

    const prefix: string = "/mobicontrol/api/devices/";
    const suffix: string = "/installedapplications";

    if (path.startsWith(prefix) && path.endsWith(suffix)) {
      // MobiControl decodes a path's ID twice.
      const encoded: string = url.pathname.substring(
        prefix.length,
        url.pathname.length - suffix.length,
      );
      const id: string = decodeURIComponent(decodeURIComponent(encoded));
      const known: boolean = devices.some((device: JSONObject): boolean => {
        return device["DeviceId"] === id;
      });

      if (!known) {
        return {
          status: 404,
          body: { ErrorCode: 0, Message: `Device '${id}' not found.` },
        };
      }

      const apps: Array<JSONObject> = (this.options.apps || {})[id] || [];

      return { status: 200, body: apps.slice(skip, skip + take) };
    }

    return {
      status: 404,
      body: { ErrorCode: 0, Message: "No HTTP resource was found." },
    };
  }

  private respond(answer: FakeSotiAnswer): DataSourceHttpResponse {
    const bodyText: string =
      typeof answer.body === "string"
        ? answer.body
        : answer.body === undefined
          ? ""
          : JSON.stringify(answer.body);
    let bodyJson: unknown = undefined;

    try {
      bodyJson = bodyText ? JSON.parse(bodyText) : undefined;
    } catch {
      bodyJson = undefined;
    }

    return {
      statusCode: answer.status,
      bodyText,
      bodyJson,
      headers: answer.headers || {},
    };
  }
}

import Dictionary from "../../../../Types/Dictionary";
import { JSONObject } from "../../../../Types/JSON";
import {
  DataSourceHttpRequest,
  DataSourceHttpResponse,
} from "../../../../Server/Utils/DataSource/HttpFetch";
import { DeviceManagementTransport } from "../../../../Server/Utils/DeviceManagement/DeviceManagementTypes";

/*
 * A Workspace ONE UEM tenant in a test (#10086): its API server and the
 * Workspace ONE token service, answering the way Omnissa's MDM REST API V1
 * reference (release 2607) and its official Bruno collection document them:
 *
 *   - POST https://<region>.uemauth.workspaceone.com/connect/token, a form
 *     body with grant_type=client_credentials, client_id and client_secret:
 *     {"access_token", "expires_in", "token_type": "Bearer"}; a wrong client
 *     is 400 {"error": "invalid_client"}, as an IdentityServer answers;
 *   - every API route takes "Authorization: Bearer <token>" - or, for an
 *     administrator's account, Basic and the aw-tenant-code header - else
 *     401 {"errorCode": 1029, "message": "OAuth token is expired."} or
 *     1005; a role without the REST API permissions is 403 errorCode 1011;
 *   - GET /api/mdm/devices/search?page=N&pagesize=S: {"Devices", "Page",
 *     "PageSize", "Total"}, ordered by ID; a search that finds nothing is a
 *     204 with no body, as Workspace ONE answers one;
 *   - GET /api/mdm/devices/{id}/apps?page=N&pagesize=S: {"DeviceApps",
 *     "Page", "PageSize", "Total"}; a device it does not know is 400.
 *
 * Faults are scripted per path: answers to give first. Every request is
 * recorded.
 */

export const WORKSPACE_ONE_SERVER: string = "as1234.awmdm.com";
export const WORKSPACE_ONE_CLIENT_ID: string =
  "a3f1c2d4e5b647a8b9c0d1e2f3a4b5c6";
export const WORKSPACE_ONE_CLIENT_SECRET: string =
  "9F2C4A7E1B3D5F60A8C2E4B6D8F0A1C3";
export const WORKSPACE_ONE_TOKEN: string =
  "eyJhbGciOiJSUzI1NiJ9.fake-workspace-one-token.signature";
export const WORKSPACE_ONE_USERNAME: string = "oneuptime-reader";
export const WORKSPACE_ONE_PASSWORD: string = "Rd-only pass 2026!";
export const WORKSPACE_ONE_API_KEY: string =
  "1EhZqw0lA6Uq2aUW8IDHm2RkAgpQZJbH9jE2/nYwG+w=";

export interface FakeWorkspaceOneAnswer {
  status: number;
  body?: unknown;
  headers?: Dictionary<string> | undefined;
}

export interface FakeWorkspaceOneRequest {
  method: string;
  url: string;
  host: string;
  path: string;
  query: URLSearchParams;
  headers: Dictionary<string>;
  body: unknown;
  egressLabel: string | undefined;
}

export interface FakeWorkspaceOneOptions {
  server?: string | undefined;
  region?: string | undefined;
  clientId?: string | undefined;
  clientSecret?: string | undefined;
  username?: string | undefined;
  password?: string | undefined;
  apiKey?: string | undefined;
  devices?: Array<JSONObject> | undefined;
  // Each device's apps, by its ID.
  apps?: Record<string, Array<JSONObject>> | undefined;
  // The role lacks the REST API permissions.
  isPermissionMissing?: boolean | undefined;
  // What a page's Total says, when it is not the list's length.
  total?: number | undefined;
  tokenLifetimeSeconds?: number | undefined;
}

/*
 * A device as the V1 DeviceExtended schema writes one, with what the
 * search lists of it: an enrolled iPhone of a store, its user's details
 * included, as Workspace ONE sends them - which the import never keeps.
 */
export function buildWorkspaceOneDevice(
  overrides: JSONObject = {},
): JSONObject {
  return {
    EasIds: { EasId: ["ApplF2LXK1AAAAAA"] },
    TimeZone: "America/Chicago",
    tenant_uuid: "8f7c6b5a-4e3d-4c2b-9a1f-0e9d8c7b6a51",
    customer_uuid: "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d",
    Udid: "00008110-001A2B3C4D5E801E",
    SerialNumber: "F2LXK1AAAAAA",
    MacAddress: "A4:83:E7:12:34:56",
    Imei: "356938035643809",
    EasId: "ApplF2LXK1AAAAAA",
    AssetNumber: "STORE-0412-07",
    DeviceFriendlyName: "Megan Bowen iPhone iOS 17.6.1 AAAA",
    DeviceReportedName: "Store 0412 Front Counter",
    LocationGroupId: {
      Id: { Value: 1041 },
      Name: "Stores West",
      Uuid: "7b1d4f9e-2c3a-4b5d-8e6f-1a2b3c4d5e6f",
    },
    LocationGroupName: "Stores West",
    UserId: {
      Id: { Value: 77 },
      Name: "Megan Bowen",
      Uuid: "2a1b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5e",
    },
    UserName: "mbowen",
    DataProtectionStatus: 1,
    UserEmailAddress: "megan@contoso.com",
    Ownership: "C",
    PlatformId: { Id: { Value: 2 }, Name: "Apple" },
    Platform: "Apple",
    ModelId: { Id: { Value: 1 }, Name: "iPhone" },
    Model: "iPhone 15 (128 GB Black)",
    OperatingSystem: "17.6.1",
    PhoneNumber: "+15555550123",
    LastSeen: "2026-11-19T11:40:00.123",
    EnrollmentStatus: "Enrolled",
    ComplianceStatus: "Compliant",
    CompromisedStatus: false,
    LastEnrolledOn: "2025-03-04T09:12:44",
    LastComplianceCheckOn: "2026-11-19T11:00:00",
    LastCompromisedCheckOn: "2026-11-19T11:00:00",
    IsSupervised: true,
    DeviceMCC: { SIMMCC: "310", CurrentMCC: "310" },
    IsRemoteManagementEnabled: "false",
    DataEncryptionYN: "Y",
    AcLineStatus: 0,
    VirtualMemory: 0,
    OEMInfo: "Apple",
    DeviceCapacity: 119.2,
    AvailableDeviceCapacity: 87.4,
    LastSystemSampleTime: "2026-11-19T11:40:00",
    IsDeviceDNDEnabled: false,
    IsDeviceLocatorEnabled: true,
    IsCloudBackupEnabled: false,
    IsActivationLockEnabled: true,
    IsNetworkTethered: false,
    BatteryLevel: "87%",
    IsRoaming: false,
    LastNetworkLANSampleTime: "2026-11-19T10:00:00",
    LastBluetoothSampleTime: "0001-01-01T00:00:00",
    SystemIntegrityProtectionEnabled: false,
    ProcessorArchitecture: 0,
    UserApprovedEnrollment: false,
    EnrolledViaDEP: true,
    TotalPhysicalMemory: 6144,
    TotalPhysicalMemoryInfo: { MemorySize: 6, MemoryUnit: "GB" },
    AvailablePhysicalMemory: 0,
    OSBuildVersion: "21G93",
    HostName: "",
    LocalHostName: "",
    SecurityPatchDate: "0001-01-01T00:00:00",
    DeviceNetworkInfo: [
      {
        ConnectionType: "WiFi",
        IPAddress: "10.20.30.41",
        MACAddress: "A4:83:E7:12:34:56",
        Name: "en0",
        Vendor: "",
      },
    ],
    DeviceCellularNetworkInfo: [
      {
        CarrierName: "Carrier",
        CardId: "8901410000000000000",
        PhoneNumber: "+15555550123",
        IsRoaming: false,
        Imei: "356938035643809",
      },
    ],
    EnrollmentUserUuid: "2a1b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5e",
    ManagedBy: "WorkspaceONE",
    WifiSsid: "Store-0412",
    Id: { Value: 15 },
    Uuid: "c3d4e5f6-a7b8-4c9d-8e0f-1a2b3c4d5e6f",
    ...overrides,
  };
}

// An iPad: Workspace ONE calls its platform Apple, as an iPhone's.
export function buildWorkspaceOneIpad(overrides: JSONObject = {}): JSONObject {
  return buildWorkspaceOneDevice({
    Id: { Value: 16 },
    Uuid: "d4e5f6a7-b8c9-4d0e-9f1a-2b3c4d5e6f70",
    SerialNumber: "DMPXK1ABCDEF",
    DeviceReportedName: "Lobby iPad",
    DeviceFriendlyName: "Megan Bowen iPad iPadOS 17.6.1 CDEF",
    Model: "iPad (9th generation) (64 GB Space Gray)",
    Imei: "",
    MacAddress: "A4:83:E7:65:43:21",
    ...overrides,
  });
}

// A Windows laptop: WinRT, Workspace ONE's platform for Windows 10 and 11.
export function buildWorkspaceOneWindows(
  overrides: JSONObject = {},
): JSONObject {
  return buildWorkspaceOneDevice({
    Id: { Value: 17 },
    Uuid: "e5f6a7b8-c9d0-4e1f-8a2b-3c4d5e6f7081",
    SerialNumber: "PF3ABCDE",
    DeviceReportedName: "DESKTOP-7KQ2M1",
    DeviceFriendlyName: "Megan Bowen Windows Desktop 10.0.22631",
    Platform: "WinRT",
    PlatformId: { Id: { Value: 12 }, Name: "WinRT" },
    Model: "Latitude 5440",
    OEMInfo: "Dell Inc.",
    OperatingSystem: "10.0.22631",
    OSBuildVersion: "22631.4460",
    Imei: "",
    MacAddress: "7C1E520A9B3F",
    BatteryLevel: "64",
    DeviceCapacity: 475.8,
    AvailableDeviceCapacity: 211.3,
    TotalPhysicalMemoryInfo: { MemorySize: 16384, MemoryUnit: "MB" },
    IsSupervised: false,
    ...overrides,
  });
}

// An Android scanner of a warehouse, with its security patch date.
export function buildWorkspaceOneAndroid(
  overrides: JSONObject = {},
): JSONObject {
  return buildWorkspaceOneDevice({
    Id: { Value: 18 },
    Uuid: "f6a7b8c9-d0e1-4f2a-9b3c-4d5e6f708192",
    SerialNumber: "R5CR30ABCDE",
    DeviceReportedName: "WH-SCANNER-07",
    DeviceFriendlyName: "Staging Android 13",
    Platform: "Android",
    PlatformId: { Id: { Value: 5 }, Name: "Android" },
    Model: "TC52",
    OEMInfo: "Zebra Technologies",
    OperatingSystem: "13.0.0",
    OSBuildVersion: "13-11-19.00-TG-U00-STD",
    SecurityPatchDate: "2026-10-01T00:00:00",
    Imei: "354123456789012",
    MacAddress: "02:00:00:00:00:00",
    BatteryLevel: "0.55",
    LocationGroupId: {
      Id: { Value: 1077 },
      Name: "Warehouse",
      Uuid: "8c2e5a0f-3d4b-4c6e-9f70-2b3c4d5e6f71",
    },
    LocationGroupName: "Warehouse",
    IsSupervised: false,
    ...overrides,
  });
}

export function buildWorkspaceOneApp(overrides: JSONObject = {}): JSONObject {
  return {
    ApplicationName: "Ordering Kiosk",
    Version: "2.4.1",
    BuildVersion: "241",
    Status: "Installed",
    DeviceId: { Id: { Value: 15 }, Name: "Store 0412 Front Counter" },
    Size: "48321536",
    ApplicationIdentifier: "com.example.kiosk",
    Type: "Internal",
    IsManaged: true,
    AppVersion: "2.4.1",
    Id: { Value: 9001 },
    Uuid: "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d",
    ...overrides,
  };
}

export class FakeWorkspaceOneApi {
  public readonly requests: Array<FakeWorkspaceOneRequest> = [];
  private readonly options: FakeWorkspaceOneOptions;
  private readonly scripted: Map<string, Array<FakeWorkspaceOneAnswer>> =
    new Map<string, Array<FakeWorkspaceOneAnswer>>();
  private failures: Map<string, number> = new Map<string, number>();
  private issued: number = 0;

  public constructor(options: FakeWorkspaceOneOptions = {}) {
    this.options = options;
  }

  public get server(): string {
    return this.options.server || WORKSPACE_ONE_SERVER;
  }

  private get tokenHost(): string {
    return `${this.options.region || "na"}.uemauth.workspaceone.com`;
  }

  // Answers to give, in order, before the path answers as it would.
  public script(path: string, answers: Array<FakeWorkspaceOneAnswer>): void {
    this.scripted.set(path, [...(this.scripted.get(path) || []), ...answers]);
  }

  // The transport throws this many times on a path, as a dropped connection does.
  public dropConnections(path: string, times: number): void {
    this.failures.set(path, times);
  }

  public requestsTo(path: string): Array<FakeWorkspaceOneRequest> {
    return this.requests.filter((request: FakeWorkspaceOneRequest): boolean => {
      return request.path === path;
    });
  }

  // The tokens the token service gave out.
  public get tokensIssued(): number {
    return this.issued;
  }

  public get transport(): DeviceManagementTransport {
    return async (
      request: DataSourceHttpRequest,
    ): Promise<DataSourceHttpResponse> => {
      const url: URL = new URL(request.url);
      const recorded: FakeWorkspaceOneRequest = {
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

      const scripted: Array<FakeWorkspaceOneAnswer> | undefined =
        this.scripted.get(url.pathname);

      if (scripted && scripted.length > 0) {
        return this.respond(scripted.shift()!);
      }

      if (url.host === this.tokenHost) {
        return this.respond(this.token(url, request));
      }

      if (url.host !== this.server || url.protocol !== "https:") {
        return this.respond({ status: 404, body: "Not Found" });
      }

      return this.respond(this.api(url, recorded));
    };
  }

  private token(
    url: URL,
    request: DataSourceHttpRequest,
  ): FakeWorkspaceOneAnswer {
    const form: Dictionary<string> =
      request.body && typeof request.body === "object"
        ? (request.body as Dictionary<string>)
        : {};

    if (
      request.method !== "POST" ||
      !request.formUrlEncoded ||
      url.pathname !== "/connect/token"
    ) {
      return { status: 404, body: "Not Found" };
    }

    if (form["grant_type"] !== "client_credentials") {
      return { status: 400, body: { error: "unsupported_grant_type" } };
    }

    if (
      form["client_id"] !==
        (this.options.clientId || WORKSPACE_ONE_CLIENT_ID) ||
      form["client_secret"] !==
        (this.options.clientSecret || WORKSPACE_ONE_CLIENT_SECRET)
    ) {
      return { status: 400, body: { error: "invalid_client" } };
    }

    this.issued++;

    return {
      status: 200,
      body: {
        access_token: WORKSPACE_ONE_TOKEN,
        expires_in: this.options.tokenLifetimeSeconds ?? 3600,
        token_type: "Bearer",
        scope: "api",
      },
    };
  }

  private isSignedIn(request: FakeWorkspaceOneRequest): boolean {
    const authorization: string = request.headers["Authorization"] || "";

    if (authorization === `Bearer ${WORKSPACE_ONE_TOKEN}`) {
      return true;
    }

    const basic: string = `Basic ${Buffer.from(
      `${this.options.username || WORKSPACE_ONE_USERNAME}:${this.options.password || WORKSPACE_ONE_PASSWORD}`,
    ).toString("base64")}`;

    return (
      authorization === basic &&
      request.headers["aw-tenant-code"] ===
        (this.options.apiKey || WORKSPACE_ONE_API_KEY)
    );
  }

  private api(
    url: URL,
    request: FakeWorkspaceOneRequest,
  ): FakeWorkspaceOneAnswer {
    if (!this.isSignedIn(request)) {
      return {
        status: 401,
        body: {
          errorCode: request.headers["Authorization"]?.startsWith("Basic")
            ? 1005
            : 1029,
          message: request.headers["Authorization"]?.startsWith("Basic")
            ? "User credentials are invalid."
            : "OAuth token is expired.",
          activityId: "5b6c7d8e-0000-4000-8000-000000000001",
        },
      };
    }

    if (this.options.isPermissionMissing) {
      return {
        status: 403,
        body: {
          errorCode: 1011,
          message:
            "User doesn't have sufficient permissions to perform this operation.",
          activityId: "5b6c7d8e-0000-4000-8000-000000000002",
        },
      };
    }

    const path: string = url.pathname.toLowerCase();
    const page: number = Number(url.searchParams.get("page") || "0");
    const pageSize: number = Number(url.searchParams.get("pagesize") || "500");

    if (path === "/api/mdm/devices/search") {
      const devices: Array<JSONObject> = this.options.devices || [];
      const slice: Array<JSONObject> = devices.slice(
        page * pageSize,
        page * pageSize + pageSize,
      );

      if (devices.length === 0) {
        return { status: 204 };
      }

      return {
        status: 200,
        body: {
          Devices: slice,
          Page: page,
          PageSize: pageSize,
          Total: this.options.total ?? devices.length,
        },
      };
    }

    const appsPrefix: string = "/api/mdm/devices/";
    const appsSuffix: string = "/apps";

    if (
      path.startsWith(appsPrefix) &&
      path.endsWith(appsSuffix) &&
      path.length > appsPrefix.length + appsSuffix.length
    ) {
      const id: string = decodeURIComponent(
        path.substring(appsPrefix.length, path.length - appsSuffix.length),
      );
      const known: boolean = (this.options.devices || []).some(
        (device: JSONObject): boolean => {
          return (
            String((device["Id"] as JSONObject | undefined)?.["Value"]) === id
          );
        },
      );

      if (!known) {
        return {
          status: 400,
          body: {
            errorCode: 400,
            message:
              "Device does not exist or Admin User does not have access to the Device.",
          },
        };
      }

      const apps: Array<JSONObject> = (this.options.apps || {})[id] || [];

      if (apps.length === 0) {
        return { status: 204 };
      }

      return {
        status: 200,
        body: {
          DeviceApps: apps.slice(page * pageSize, page * pageSize + pageSize),
          Page: page,
          PageSize: pageSize,
          Total: apps.length,
        },
      };
    }

    return {
      status: 404,
      body: { errorCode: 404, message: "Resource not found." },
    };
  }

  private respond(answer: FakeWorkspaceOneAnswer): DataSourceHttpResponse {
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

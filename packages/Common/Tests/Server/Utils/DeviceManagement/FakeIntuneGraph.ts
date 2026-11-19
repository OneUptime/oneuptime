import Dictionary from "../../../../Types/Dictionary";
import { JSONObject } from "../../../../Types/JSON";
import {
  DataSourceHttpRequest,
  DataSourceHttpResponse,
} from "../../../../Server/Utils/DataSource/HttpFetch";
import { DeviceManagementTransport } from "../../../../Server/Utils/DeviceManagement/DeviceManagementTypes";

/*
 * Microsoft Entra's token endpoint and Microsoft Graph's Intune routes in a
 * test, answering the way Microsoft's reference pages document them:
 *
 *   - POST {login}/{tenant}/oauth2/v2.0/token, a form body with client_id,
 *     client_secret, scope ({graph}/.default) and grant_type
 *     (client_credentials): {"token_type", "expires_in", "access_token"};
 *     an unknown tenant is 400 AADSTS90002, an unknown client 400
 *     AADSTS700016, a wrong secret 401 AADSTS7000215, each as
 *     {"error", "error_description", "error_codes"};
 *   - every Graph route takes "Authorization: Bearer <token>", else 401
 *     InvalidAuthenticationToken; without the permission, 403 with Graph's
 *     {"error": {"code", "message"}};
 *   - GET /v1.0/deviceManagement/managedDevices: {"@odata.context",
 *     "value", "@odata.nextLink"}, pageSize a page, the next link absolute
 *     on the Graph host with a $skiptoken; $top cuts the first page, and
 *     $select=id keeps the ID alone;
 *   - GET /v1.0/deviceManagement/managedDeviceOverview;
 *   - GET /beta/deviceManagement/managedDevices/{id}?$select=id
 *     &$expand=detectedApps: {"id", "detectedApps": [...]}, 404 for a
 *     device it does not know.
 *
 * Faults are scripted per path: answers to give first. Every request is
 * recorded.
 */

export const INTUNE_TENANT: string = "contoso.onmicrosoft.com";
export const INTUNE_CLIENT_ID: string = "6731de76-14a6-49ae-97bc-6eba6914391e";
export const INTUNE_CLIENT_SECRET: string =
  "Xq48Q~Zk1Lm9vN0pQrStUvWxYz.AbCdEfGhIjK-L";
export const INTUNE_TOKEN: string =
  "eyJ0eXAiOiJKV1QiLCJhbGciOiJSUzI1NiJ9.fake-intune-token.signature";

export interface FakeIntuneAnswer {
  status: number;
  body?: unknown;
  headers?: Dictionary<string> | undefined;
}

export interface FakeIntuneRequest {
  method: string;
  url: string;
  host: string;
  path: string;
  query: URLSearchParams;
  headers: Dictionary<string>;
  body: unknown;
  egressLabel: string | undefined;
}

export interface FakeIntuneOptions {
  loginHost?: string | undefined;
  graphHost?: string | undefined;
  tenant?: string | undefined;
  clientId?: string | undefined;
  clientSecret?: string | undefined;
  devices?: Array<JSONObject> | undefined;
  // Each device's discovered apps, by its ID.
  apps?: Record<string, Array<JSONObject>> | undefined;
  enrolledDeviceCount?: number | undefined;
  // The app registration lacks DeviceManagementManagedDevices.Read.All.
  isPermissionMissing?: boolean | undefined;
  pageSize?: number | undefined;
  tokenLifetimeSeconds?: number | undefined;
}

/*
 * A device as Graph's v1.0 managedDevice reference writes one, with what
 * Graph gives in a list: physical memory and the Ethernet MAC are its
 * defaults there (0, null), as the reference says.
 */
export function buildIntuneDevice(overrides: JSONObject = {}): JSONObject {
  return {
    "@odata.type": "#microsoft.graph.managedDevice",
    id: "0f7c8c6b-0c2a-4d6e-9a1b-2c3d4e5f6a7b",
    userId: "a2b8c1d0-1111-4222-8333-944455566677",
    deviceName: "DESKTOP-7KQ2M1",
    managedDeviceOwnerType: "company",
    deviceActionResults: [],
    enrolledDateTime: "2025-03-04T09:12:44Z",
    lastSyncDateTime: "2026-11-19T11:40:00Z",
    operatingSystem: "Windows",
    complianceState: "compliant",
    jailBroken: "Unknown",
    managementAgent: "mdm",
    osVersion: "10.0.22631.4460",
    easActivated: false,
    easDeviceId: "",
    easActivationDateTime: "0001-01-01T00:00:00Z",
    azureADRegistered: true,
    deviceEnrollmentType: "windowsAzureADJoin",
    activationLockBypassCode: null,
    emailAddress: "megan@contoso.com",
    azureADDeviceId: "5d1c2b3a-4e5f-4a6b-8c7d-9e0f1a2b3c4d",
    deviceRegistrationState: "registered",
    deviceCategoryDisplayName: "Front Desk",
    isSupervised: false,
    exchangeLastSuccessfulSyncDateTime: "0001-01-01T00:00:00Z",
    exchangeAccessState: "none",
    exchangeAccessStateReason: "none",
    remoteAssistanceSessionUrl: "",
    remoteAssistanceSessionErrorDetails: "",
    isEncrypted: true,
    userPrincipalName: "megan@contoso.com",
    model: "Surface Laptop 5",
    manufacturer: "Microsoft Corporation",
    imei: "",
    complianceGracePeriodExpirationDateTime: "9999-12-31T23:59:59Z",
    serialNumber: "0F33AB12345678",
    phoneNumber: "",
    androidSecurityPatchLevel: "",
    userDisplayName: "Megan Bowen",
    configurationManagerClientEnabledFeatures: null,
    wiFiMacAddress: "7C1E520A9B3F",
    deviceHealthAttestationState: null,
    subscriberCarrier: "",
    meid: "",
    totalStorageSpaceInBytes: 255060049920,
    freeStorageSpaceInBytes: 141733920768,
    managedDeviceName: "megan_Windows_3/4/2025_9:12 AM",
    partnerReportedThreatState: "unknown",
    requireUserEnrollmentApproval: false,
    managementCertificateExpirationDate: "2026-03-04T09:02:44Z",
    iccid: null,
    udid: null,
    notes: null,
    ethernetMacAddress: null,
    physicalMemoryInBytes: 0,
    enrollmentProfileName: null,
    ...overrides,
  };
}

// An iPad on an older enrollment: Intune calls its system iOS.
export function buildIntuneIpad(overrides: JSONObject = {}): JSONObject {
  return buildIntuneDevice({
    id: "4a5b6c7d-8e9f-4a0b-9c1d-2e3f4a5b6c7d",
    deviceName: "Lobby iPad",
    operatingSystem: "iOS",
    osVersion: "17.6.1",
    model: "iPad (9th generation)",
    manufacturer: "Apple",
    serialNumber: "DMPXK1ABCDEF",
    deviceEnrollmentType: "appleBulkWithoutUser",
    isSupervised: true,
    isEncrypted: true,
    wiFiMacAddress: "a4:83:e7:12:34:56",
    deviceCategoryDisplayName: "Unknown",
    managedDeviceOwnerType: "company",
    managedDeviceName: "Lobby iPad",
    ...overrides,
  });
}

// An Android Enterprise phone, with its security patch level.
export function buildIntuneAndroid(overrides: JSONObject = {}): JSONObject {
  return buildIntuneDevice({
    id: "9e8d7c6b-5a4f-4e3d-8c2b-1a0f9e8d7c6b",
    deviceName: "SM-G991B",
    operatingSystem: "Android",
    osVersion: "14",
    model: "SM-G991B",
    manufacturer: "samsung",
    serialNumber: "R5CR30ABCDE",
    imei: "356938035643809",
    androidSecurityPatchLevel: "2026-10-01",
    deviceEnrollmentType: "androidEnterpriseFullyManaged",
    wiFiMacAddress: "020000000000",
    deviceCategoryDisplayName: "Warehouse",
    ...overrides,
  });
}

export function buildIntuneDetectedApp(overrides: JSONObject = {}): JSONObject {
  return {
    "@odata.type": "#microsoft.graph.detectedApp",
    id: "caf60db6-0db6-caf6-b60d-f6cab60df6ca",
    displayName: "Microsoft Edge",
    version: "131.0.2903.51",
    sizeInByte: 0,
    deviceCount: 112,
    publisher: "Microsoft Corporation",
    platform: "windows",
    ...overrides,
  };
}

export class FakeIntuneGraph {
  public readonly requests: Array<FakeIntuneRequest> = [];
  private readonly options: FakeIntuneOptions;
  private readonly scripted: Map<string, Array<FakeIntuneAnswer>> = new Map<
    string,
    Array<FakeIntuneAnswer>
  >();
  private failures: Map<string, number> = new Map<string, number>();

  public constructor(options: FakeIntuneOptions = {}) {
    this.options = options;
  }

  private get loginHost(): string {
    return this.options.loginHost || "login.microsoftonline.com";
  }

  private get graphHost(): string {
    return this.options.graphHost || "graph.microsoft.com";
  }

  // Answers to give, in order, before the path answers as it would.
  public script(path: string, answers: Array<FakeIntuneAnswer>): void {
    this.scripted.set(path, [...(this.scripted.get(path) || []), ...answers]);
  }

  // The transport throws this many times on a path, as a dropped connection does.
  public dropConnections(path: string, times: number): void {
    this.failures.set(path, times);
  }

  public requestsTo(path: string): Array<FakeIntuneRequest> {
    return this.requests.filter((request: FakeIntuneRequest): boolean => {
      return request.path === path;
    });
  }

  public get transport(): DeviceManagementTransport {
    return async (
      request: DataSourceHttpRequest,
    ): Promise<DataSourceHttpResponse> => {
      const url: URL = new URL(request.url);
      const recorded: FakeIntuneRequest = {
        method: request.method,
        url: request.url,
        host: url.hostname,
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

      const scripted: Array<FakeIntuneAnswer> | undefined = this.scripted.get(
        url.pathname,
      );

      if (scripted && scripted.length > 0) {
        return this.respond(scripted.shift()!);
      }

      if (url.hostname === this.loginHost) {
        return this.respond(this.token(url, request));
      }

      if (url.hostname !== this.graphHost) {
        return this.respond({ status: 404, body: "Not Found" });
      }

      return this.respond(this.graph(url, recorded));
    };
  }

  private token(url: URL, request: DataSourceHttpRequest): FakeIntuneAnswer {
    const form: Dictionary<string> =
      request.body && typeof request.body === "object"
        ? (request.body as Dictionary<string>)
        : {};
    const tenant: string = decodeURIComponent(url.pathname.split("/")[1] || "");

    if (
      request.method !== "POST" ||
      !request.formUrlEncoded ||
      url.pathname !== `/${encodeURIComponent(tenant)}/oauth2/v2.0/token`
    ) {
      return { status: 404, body: "Not Found" };
    }

    if (tenant !== (this.options.tenant || INTUNE_TENANT)) {
      return {
        status: 400,
        body: {
          error: "invalid_request",
          error_description: `AADSTS90002: Tenant '${tenant}' not found. Check to make sure you have the correct tenant ID and are signing into the correct cloud.\r\nTrace ID: 0b1c2d3e-0000-4000-8000-000000000001\r\nCorrelation ID: 7a6b5c4d-0000-4000-8000-000000000002\r\nTimestamp: 2026-11-19 12:00:00Z`,
          error_codes: [90002],
          timestamp: "2026-11-19 12:00:00Z",
          trace_id: "0b1c2d3e-0000-4000-8000-000000000001",
          correlation_id: "7a6b5c4d-0000-4000-8000-000000000002",
        },
      };
    }

    if (form["client_id"] !== (this.options.clientId || INTUNE_CLIENT_ID)) {
      return {
        status: 400,
        body: {
          error: "unauthorized_client",
          error_description: `AADSTS700016: Application with identifier '${form["client_id"] || ""}' was not found in the directory 'Contoso'. This can happen if the application has not been installed by the administrator of the tenant or consented to by any user in the tenant.\r\nTrace ID: 0b1c2d3e-0000-4000-8000-000000000003`,
          error_codes: [700016],
        },
      };
    }

    if (
      form["client_secret"] !==
      (this.options.clientSecret || INTUNE_CLIENT_SECRET)
    ) {
      return {
        status: 401,
        body: {
          error: "invalid_client",
          error_description: `AADSTS7000215: Invalid client secret provided. Ensure the secret being sent in the request is the client secret value, not the client secret ID, for a secret added to app '${form["client_id"] || ""}'.\r\nTrace ID: 0b1c2d3e-0000-4000-8000-000000000004`,
          error_codes: [7000215],
        },
      };
    }

    if (
      form["grant_type"] !== "client_credentials" ||
      form["scope"] !== `https://${this.graphHost}/.default`
    ) {
      return {
        status: 400,
        body: {
          error: "invalid_scope",
          error_description:
            "AADSTS70011: The provided value for the input parameter 'scope' is not valid.",
          error_codes: [70011],
        },
      };
    }

    return {
      status: 200,
      body: {
        token_type: "Bearer",
        expires_in: this.options.tokenLifetimeSeconds ?? 3599,
        ext_expires_in: 3599,
        access_token: INTUNE_TOKEN,
      },
    };
  }

  private graph(url: URL, request: FakeIntuneRequest): FakeIntuneAnswer {
    if (request.headers["Authorization"] !== `Bearer ${INTUNE_TOKEN}`) {
      return {
        status: 401,
        body: {
          error: {
            code: "InvalidAuthenticationToken",
            message: "Access token validation failure. Invalid audience.",
            innerError: { date: "2026-11-19T12:00:00", "request-id": "r1" },
          },
        },
      };
    }

    if (this.options.isPermissionMissing) {
      return {
        status: 403,
        body: {
          error: {
            code: "Forbidden",
            message:
              "Application is not authorized to perform this operation. Application must have one of the following scopes: DeviceManagementManagedDevices.Read.All, DeviceManagementManagedDevices.ReadWrite.All - Operation ID (for customer support): 00000000-0000-0000-0000-000000000000",
          },
        },
      };
    }

    const devices: Array<JSONObject> = this.options.devices || [];

    if (url.pathname === "/v1.0/deviceManagement/managedDevices") {
      const pageSize: number = this.options.pageSize || 2;
      const top: number = Number(url.searchParams.get("$top") || "0");
      const skip: number = Number(url.searchParams.get("$skiptoken") || "0");
      const size: number = top > 0 ? top : pageSize;
      let page: Array<JSONObject> = devices.slice(skip, skip + size);

      if (url.searchParams.get("$select") === "id") {
        page = page.map((device: JSONObject): JSONObject => {
          return { id: device["id"] || null };
        });
      }

      const body: JSONObject = {
        "@odata.context":
          "https://graph.microsoft.com/v1.0/$metadata#deviceManagement/managedDevices",
        value: page,
      };

      if (top === 0 && skip + size < devices.length) {
        body["@odata.nextLink"] =
          `https://${this.graphHost}/v1.0/deviceManagement/managedDevices?$skiptoken=${skip + size}`;
      }

      return { status: 200, body };
    }

    if (url.pathname === "/v1.0/deviceManagement/managedDeviceOverview") {
      return {
        status: 200,
        body: {
          "@odata.context":
            "https://graph.microsoft.com/v1.0/$metadata#deviceManagement/managedDeviceOverview/$entity",
          id: "8a1b2c3d-0000-4000-8000-000000000000",
          enrolledDeviceCount:
            this.options.enrolledDeviceCount ?? devices.length,
          mdmEnrolledCount: devices.length,
          dualEnrolledDeviceCount: 0,
          deviceOperatingSystemSummary: {
            androidCount: 0,
            iosCount: 0,
            macOSCount: 0,
            windowsMobileCount: 0,
            windowsCount: devices.length,
            unknownCount: 0,
          },
        },
      };
    }

    const appsPrefix: string = "/beta/deviceManagement/managedDevices/";

    if (url.pathname.startsWith(appsPrefix)) {
      const id: string = decodeURIComponent(
        url.pathname.substring(appsPrefix.length),
      );
      const known: boolean = devices.some((device: JSONObject): boolean => {
        return device["id"] === id;
      });

      if (!known || url.searchParams.get("$expand") !== "detectedApps") {
        return {
          status: 404,
          body: {
            error: {
              code: "ResourceNotFound",
              message: `{"_version": 3, "Message": "Resource not found for the segment 'managedDevices'."}`,
            },
          },
        };
      }

      return {
        status: 200,
        body: {
          "@odata.context":
            "https://graph.microsoft.com/beta/$metadata#deviceManagement/managedDevices(id,detectedApps())/$entity",
          id,
          detectedApps: (this.options.apps || {})[id] || [],
        },
      };
    }

    return {
      status: 400,
      body: {
        error: {
          code: "BadRequest",
          message: `Resource not found for the segment '${url.pathname}'.`,
        },
      },
    };
  }

  private respond(answer: FakeIntuneAnswer): DataSourceHttpResponse {
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

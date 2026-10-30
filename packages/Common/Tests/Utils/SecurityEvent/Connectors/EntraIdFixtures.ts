import { JSONObject } from "../../../../Types/JSON";

/*
 * Microsoft Entra ID's records as Microsoft Graph returns them
 * (learn.microsoft.com/graph/api/resources/signin, .../directoryaudit,
 * .../riskdetection) and as Azure's diagnostic settings export them (the
 * same object under `properties`, beside a category). Made-up tenant,
 * people and documentation addresses. Not a test file itself.
 */

export function entraSignIn(overrides: JSONObject = {}): JSONObject {
  return {
    id: "66ea54eb-6301-4ee5-be62-ff5a759b0100",
    createdDateTime: "2026-10-30T09:57:40Z",
    userDisplayName: "Alice Example",
    userPrincipalName: "alice@contoso.example",
    userId: "d7cc485d-2c1b-422c-98fd-5ce52859a4a3",
    appId: "c44b4083-3bb0-49c1-b47d-974e53cbdf3c",
    appDisplayName: "Azure Portal",
    ipAddress: "203.0.113.7",
    clientAppUsed: "Browser",
    correlationId: "d79f5bee-5860-4832-928f-3133e22ae912",
    conditionalAccessStatus: "notApplied",
    isInteractive: true,
    riskDetail: "none",
    riskLevelAggregated: "none",
    riskLevelDuringSignIn: "none",
    riskState: "none",
    riskEventTypes_v2: [],
    resourceDisplayName: "Windows Azure Service Management API",
    resourceId: "797f4846-ba00-4fd7-ba43-dac1f8f63013",
    status: { errorCode: 0, failureReason: "Other.", additionalDetails: null },
    deviceDetail: {
      deviceId: "",
      displayName: "",
      operatingSystem: "Windows 10",
      browser: "Edge 130.0",
      isCompliant: false,
      isManaged: false,
      trustType: "",
    },
    location: {
      city: "Seattle",
      state: "Washington",
      countryOrRegion: "US",
      geoCoordinates: { latitude: 47.6, longitude: -122.3 },
    },
    appliedConditionalAccessPolicies: [],
    ...overrides,
  };
}

export function entraFailedSignIn(overrides: JSONObject = {}): JSONObject {
  return entraSignIn({
    status: {
      errorCode: 50126,
      failureReason:
        "Error validating credentials due to invalid username or password.",
    },
    ...overrides,
  });
}

export function entraRoleAssignment(
  role: string = "Global Administrator",
  overrides: JSONObject = {},
): JSONObject {
  return {
    id: "Directory_0b9a6c7b-6b9f-4a3e-9b0e-0f6e2c0d0a11",
    category: "RoleManagement",
    correlationId: "1f0b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d",
    result: "success",
    resultReason: "",
    activityDisplayName: "Add member to role",
    activityDateTime: "2026-10-30T09:55:00Z",
    loggedByService: "Core Directory",
    operationType: "Assign",
    initiatedBy: {
      user: {
        id: "d7cc485d-2c1b-422c-98fd-5ce52859a4a3",
        displayName: null,
        userPrincipalName: "alice@contoso.example",
        ipAddress: "203.0.113.7",
      },
      app: null,
    },
    targetResources: [
      {
        id: "4f9d1a2b-0000-4000-8000-000000000001",
        displayName: null,
        type: "User",
        userPrincipalName: "mallory@contoso.example",
        modifiedProperties: [
          {
            displayName: "Role.ObjectID",
            oldValue: null,
            newValue: '"62e90394-69f5-4237-9190-012177145e10"',
          },
          {
            displayName: "Role.DisplayName",
            oldValue: null,
            newValue: `"${role}"`,
          },
        ],
      },
    ],
    additionalDetails: [],
    ...overrides,
  };
}

export function entraConsent(overrides: JSONObject = {}): JSONObject {
  return {
    id: "Directory_consent_0001",
    category: "ApplicationManagement",
    correlationId: "9a8b7c6d-0000-4000-8000-000000000002",
    result: "success",
    resultReason: "",
    activityDisplayName: "Consent to application",
    activityDateTime: "2026-10-30T09:56:00Z",
    loggedByService: "Core Directory",
    operationType: "Assign",
    initiatedBy: {
      user: {
        userPrincipalName: "bob@contoso.example",
        ipAddress: "198.51.100.23",
      },
    },
    targetResources: [
      {
        id: "5e6f7a8b-0000-4000-8000-000000000003",
        displayName: "Mail Exporter Pro",
        type: "ServicePrincipal",
        modifiedProperties: [],
      },
    ],
    additionalDetails: [],
    ...overrides,
  };
}

export function entraRiskDetection(overrides: JSONObject = {}): JSONObject {
  return {
    id: "6a1b2c3d4e5f60718293a4b5c6d7e8f9",
    requestId: "2c3d4e5f-0000-4000-8000-000000000004",
    correlationId: "3d4e5f6a-0000-4000-8000-000000000005",
    riskEventType: "anonymizedIPAddress",
    riskState: "atRisk",
    riskLevel: "high",
    riskDetail: "none",
    source: "IdentityProtection",
    detectionTimingType: "realtime",
    activity: "signin",
    ipAddress: "203.0.113.99",
    activityDateTime: "2026-10-30T09:50:00Z",
    detectedDateTime: "2026-10-30T09:51:00Z",
    userId: "d7cc485d-2c1b-422c-98fd-5ce52859a4a3",
    userDisplayName: "Alice Example",
    userPrincipalName: "alice@contoso.example",
    ...overrides,
  };
}

// A record as Azure's diagnostic settings export it.
export function entraExport(
  category: string,
  properties: JSONObject,
  overrides: JSONObject = {},
): JSONObject {
  const status: JSONObject | undefined = properties["status"] as
    | JSONObject
    | undefined;

  return {
    time: "2026-10-30T09:57:40.0000000Z",
    resourceId:
      "/tenants/72f988bf-86f1-41af-91ab-2d7cd011db47/providers/Microsoft.aadiam",
    operationName: category.endsWith("SignInLogs")
      ? "Sign-in activity"
      : "Add member to role",
    operationVersion: "1.0",
    category,
    tenantId: "72f988bf-86f1-41af-91ab-2d7cd011db47",
    resultType: status ? String(status["errorCode"] ?? "0") : "",
    resultSignature: "None",
    durationMs: 0,
    callerIpAddress: "203.0.113.7",
    correlationId: "d79f5bee-5860-4832-928f-3133e22ae912",
    identity: "Alice Example",
    Level: 4,
    location: "US",
    properties,
    ...overrides,
  };
}

// An Activity Log record as diagnostic settings export it.
export function azureActivityExport(overrides: JSONObject = {}): JSONObject {
  return {
    time: "2026-10-30T09:59:01.0000000Z",
    resourceId:
      "/SUBSCRIPTIONS/11111111-2222-3333-4444-555555555555/RESOURCEGROUPS/PROD/PROVIDERS/MICROSOFT.AUTHORIZATION/ROLEASSIGNMENTS/9F0E",
    operationName: "MICROSOFT.AUTHORIZATION/ROLEASSIGNMENTS/WRITE",
    category: "Administrative",
    resultType: "Success",
    resultSignature: "Succeeded.Created",
    durationMs: "312",
    callerIpAddress: "203.0.113.7",
    correlationId: "7e6d5c4b-0000-4000-8000-000000000006",
    identity: {
      authorization: {
        scope:
          "/subscriptions/11111111-2222-3333-4444-555555555555/resourceGroups/prod",
        action: "Microsoft.Authorization/roleAssignments/write",
      },
      claims: {
        "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/upn":
          "alice@contoso.example",
        appid: "c44b4083-3bb0-49c1-b47d-974e53cbdf3c",
      },
    },
    level: "Information",
    location: "global",
    properties: { statusCode: "Created" },
    ...overrides,
  };
}

// The same, as the Activity Log's REST API returns it.
export function azureActivityApiEvent(overrides: JSONObject = {}): JSONObject {
  return {
    authorization: {
      action: "Microsoft.Insights/diagnosticSettings/delete",
      scope:
        "/subscriptions/11111111-2222-3333-4444-555555555555/providers/microsoft.insights/diagnosticSettings/to-siem",
    },
    caller: "mallory@contoso.example",
    category: { value: "Administrative", localizedValue: "Administrative" },
    correlationId: "8f7e6d5c-0000-4000-8000-000000000007",
    eventDataId: "a0b1c2d3-0000-4000-8000-000000000008",
    eventTimestamp: "2026-10-30T09:59:30.1234567Z",
    httpRequest: { clientIpAddress: "198.51.100.66", method: "DELETE" },
    level: "Informational",
    operationName: {
      value: "Microsoft.Insights/diagnosticSettings/delete",
      localizedValue: "Delete diagnostic setting",
    },
    resourceId:
      "/subscriptions/11111111-2222-3333-4444-555555555555/providers/microsoft.insights/diagnosticSettings/to-siem",
    status: { value: "Succeeded", localizedValue: "Succeeded" },
    subscriptionId: "11111111-2222-3333-4444-555555555555",
    ...overrides,
  };
}

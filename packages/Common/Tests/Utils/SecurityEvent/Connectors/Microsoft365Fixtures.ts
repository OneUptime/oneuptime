import { JSONObject, JSONValue } from "../../../../Types/JSON";

/*
 * Microsoft 365 audit records as the Office 365 Management Activity API's
 * content blobs hold them (learn.microsoft.com/office/office-365-management-
 * api/office-365-management-activity-api-schema): the common schema - Id,
 * RecordType, CreationTime in UTC without a zone, Operation, UserId,
 * ClientIP, Workload - and each service's own fields. Made-up tenant,
 * people and documentation addresses. Not a test file itself.
 */

const ORGANIZATION_ID: string = "b3c1b5fc-828c-45fa-a1e1-10d74f6d6e9c";

function common(
  id: string,
  recordType: number,
  operation: string,
  workload: string,
): JSONObject {
  return {
    CreationTime: "2026-10-30T09:41:07",
    Id: id,
    Operation: operation,
    OrganizationId: ORGANIZATION_ID,
    RecordType: recordType,
    ResultStatus: "True",
    UserKey: "10032001A5B7C9D1",
    UserType: 2,
    Version: 1,
    Workload: workload,
    ClientIP: "203.0.113.7:51234",
    UserId: "alice@contoso.example",
  };
}

// An Exchange cmdlet, run by an administrator or by Outlook on the web.
export function exchangeCmdlet(
  operation: string,
  parameters: Record<string, string>,
  overrides: JSONObject = {},
): JSONObject {
  return {
    ...common("4c8e3e3a-2d4b-4b8e-9d5c-08dcf8a1b001", 1, operation, "Exchange"),
    ObjectId: "bob",
    ExternalAccess: false,
    OrganizationName: "contoso.onmicrosoft.com",
    OriginatingServer: "DM6PR11MB0001 (15.20.8093.000)",
    Parameters: Object.keys(parameters).map((name: string): JSONValue => {
      return { Name: name, Value: parameters[name]! };
    }),
    ...overrides,
  };
}

// An inbox rule made in Outlook on the desktop: Outlook's own record of it.
export function outlookInboxRule(
  ruleActions: string,
  overrides: JSONObject = {},
): JSONObject {
  return {
    ...common(
      "6d1f9a52-3c5e-4f0a-8b7d-08dcf8a1b002",
      2,
      "UpdateInboxRules",
      "Exchange",
    ),
    UserType: 0,
    ObjectId: "alice@contoso.example\\Inbox",
    MailboxOwnerUPN: "alice@contoso.example",
    ClientIPAddress: "203.0.113.7",
    ClientInfoString: "Client=MSExchangeRPC",
    OperationProperties: [
      { Name: "RuleOperation", Value: "AddMailboxRule" },
      { Name: "RuleName", Value: "Invoices" },
      { Name: "RuleCondition", Value: "SubjectContainsCondition" },
      { Name: "RuleActions", Value: ruleActions },
    ],
    ...overrides,
  };
}

export function sendAs(overrides: JSONObject = {}): JSONObject {
  return {
    ...common("8a2b7c4d-1e3f-4a5b-9c6d-08dcf8a1b003", 2, "SendAs", "Exchange"),
    UserType: 0,
    ObjectId: "",
    MailboxOwnerUPN: "alice@contoso.example",
    SendAsUserSmtp: "ceo@contoso.example",
    Item: {
      Id: "RgAAAAB",
      Subject: "Wire transfer today",
      ParentFolder: { Path: "\\Sent Items" },
    },
    ...overrides,
  };
}

// A file shared in SharePoint or OneDrive.
export function sharing(
  operation: string,
  targetType: string,
  overrides: JSONObject = {},
): JSONObject {
  return {
    ...common(
      "a7c4e1f2-5b6d-4c8e-9f0a-08dcf8a1b004",
      14,
      operation,
      "OneDrive",
    ),
    UserType: 0,
    ObjectId:
      "https://contoso-my.sharepoint.com/personal/alice_contoso_example/Documents/Budget.xlsx",
    SiteUrl:
      "https://contoso-my.sharepoint.com/personal/alice_contoso_example/",
    SourceFileName: "Budget.xlsx",
    SourceRelativeUrl: "Documents",
    ItemType: "File",
    TargetUserOrGroupName: "bob@fabrikam.example",
    TargetUserOrGroupType: targetType,
    EventData: "<Type>Edit</Type>",
    ...overrides,
  };
}

export function siteCollectionAdminAdded(
  overrides: JSONObject = {},
): JSONObject {
  return {
    ...common(
      "b8d5f2a3-6c7e-4d9f-8a1b-08dcf8a1b005",
      4,
      "SiteCollectionAdminAdded",
      "SharePoint",
    ),
    ObjectId: "https://contoso.sharepoint.com/sites/finance",
    SiteUrl: "https://contoso.sharepoint.com/sites/finance",
    TargetUserOrGroupName: "mallory@contoso.example",
    ...overrides,
  };
}

// Microsoft Defender for Office 365's verdict on a message.
export function threatMail(
  verdict: string,
  overrides: JSONObject = {},
): JSONObject {
  return {
    ...common(
      "c9e6a3b4-7d8f-4e0a-9b2c-08dcf8a1b006",
      28,
      "TIMailData",
      "ThreatIntelligence",
    ),
    UserType: 4,
    UserId: "ThreatIntel",
    ClientIP: "",
    ObjectId: "<5f3c2a1b@mail.fabrikam.example>",
    Verdict: verdict,
    DetectionType: "Inline",
    DetectionMethod: "URL detonation reputation",
    P1Sender: "billing@fabrikam.example",
    P2Sender: "billing@fabrikam.example",
    SenderIp: "198.51.100.23",
    Recipients: ["alice@contoso.example", "bob@contoso.example"],
    Subject: "Your invoice is overdue",
    Directionality: "Inbound",
    MessageTime: "2026-10-30T09:40:58",
    ...overrides,
  };
}

// An alert Microsoft 365 raised (Security & Compliance).
export function securityAlert(
  operation: string,
  overrides: JSONObject = {},
): JSONObject {
  return {
    ...common(
      "d0f7b4c5-8e9a-4f1b-8c3d-08dcf8a1b007",
      40,
      operation,
      "SecurityComplianceCenter",
    ),
    UserType: 4,
    UserId: "SecurityComplianceAlerts",
    ClientIP: "",
    ObjectId: "0f2e1d3c-4b5a-4968-8778-a1b2c3d4e5f6",
    AlertId: "0f2e1d3c-4b5a-4968-8778-a1b2c3d4e5f6",
    AlertType: "System",
    Name: "Suspicious email forwarding activity",
    PolicyId: "4a5b6c7d-8e9f-4a0b-9c1d-2e3f4a5b6c7d",
    Status: "Active",
    Severity: "High",
    Category: "ThreatManagement",
    Source: "Office 365 Security & Compliance",
    ...overrides,
  };
}

export function teamsAppInstalled(overrides: JSONObject = {}): JSONObject {
  return {
    ...common(
      "e1a8c5d6-9f0b-4a2c-9d4e-08dcf8a1b008",
      25,
      "AppInstalled",
      "MicrosoftTeams",
    ),
    UserType: 0,
    ObjectId: "",
    TeamName: "Finance",
    AddOnName: "Files Exporter",
    AddOnGuid: "7c1d9e2f-3a4b-4c5d-8e6f-7a8b9c0d1e2f",
    ...overrides,
  };
}

// What everyone does all day: a file opened. Not read.
export function fileAccessed(overrides: JSONObject = {}): JSONObject {
  return {
    ...common(
      "f2b9d6e7-0a1c-4b3d-8e5f-08dcf8a1b009",
      6,
      "FileAccessed",
      "SharePoint",
    ),
    UserType: 0,
    ObjectId:
      "https://contoso.sharepoint.com/sites/finance/Shared Documents/Q3.xlsx",
    SourceFileName: "Q3.xlsx",
    ...overrides,
  };
}

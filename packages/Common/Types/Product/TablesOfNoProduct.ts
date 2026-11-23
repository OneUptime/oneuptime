import AnalyticsTableName from "../AnalyticsDatabase/AnalyticsTableName";

/*
 * THE TABLES OF NO ONE PRODUCT, EACH WITH WHY (#7479).
 *
 * A table every product uses - a person, a project, a team, a label, a
 * notification method - is no product's record: its writes are refused for
 * no product that is switched off. Every table of the server is a product's
 * (PRODUCT_RECORD_TABLES, in ProductRecordTables) or here, with why
 * (ProductRecordTables.test.ts holds every model to one or the other), so a
 * new table is a decision, never forgotten; and no product level reaches one
 * of these (ProductLevels.test.ts).
 *
 * A file of its own, as only those tests read it. The browser reads
 * ProductRecordTables for the product levels every model's lists are read
 * with (#10289), and this table, built as its file loads, came with it into
 * the first load of every page that reads a model, the sign-in pages among
 * them (packages/Common/Scripts/first-load-budgets.js).
 */
// The tables of no one product, each with why: every product uses them.
const noProduct: (
  reason: string,
  tables: ReadonlyArray<string>,
) => Array<[string, string]> = (
  reason: string,
  tables: ReadonlyArray<string>,
): Array<[string, string]> => {
  return tables.map((table: string): [string, string] => {
    return [table, reason];
  });
};

export const TABLES_OF_NO_PRODUCT: Readonly<Record<string, string>> =
  Object.fromEntries([
    ...noProduct("A person's own account and how they sign in.", [
      "User",
      "UserSession",
      "UserTotpAuth",
      "UserTwoFactorBackupCode",
      "UserWebAuthn",
      "UserProjectSsoConsent",
      "UserProjectSsoIdentity",
      "EmailVerificationToken",
      "ProjectUserPreference",
      "ProjectUserProfile",
    ]),
    ...noProduct(
      "A person's own progress through a guided setup, which spans products.",
      ["GuidedSetupRun"],
    ),
    ...noProduct(
      "How to reach a person, which incidents, alerts and on-call all use.",
      [
        "UserCall",
        "UserEmail",
        "UserIncomingCallNumber",
        "UserMattermost",
        "UserMicrosoftTeams",
        "UserNotificationEmailRollupBatch",
        "UserNotificationEmailRollupItem",
        "UserNotificationEmailRollupSetting",
        "UserNotificationRule",
        "UserNotificationSetting",
        "UserPush",
        "UserSMS",
        "UserSlack",
        "UserTelegram",
        "UserWebhook",
        "UserWhatsApp",
        "CustomNotificationChannel",
      ],
    ),
    ...noProduct(
      "A log of a message OneUptime sent, written by the server for every product.",
      [
        "CallLog",
        "EmailLog",
        "PushNotificationLog",
        "ServerEmailLog",
        "SmsLog",
        "TelegramLog",
        "WebhookLog",
        "WhatsAppLog",
        "WorkspaceNotificationLog",
        "OwnerNotificationDelivery",
      ],
    ),
    ...noProduct(
      "The project, its people and its teams: Users, Teams and Project Settings, always on.",
      [
        "Project",
        "Team",
        "TeamComplianceSetting",
        "TeamCustomField",
        "TeamCustomRole",
        "TeamMember",
        "TeamMemberCustomField",
        "TeamOwnerTeam",
        "TeamOwnerUser",
        "TeamPermission",
        "CustomRole",
        "CustomRolePermission",
        "ApiKey",
        "ApiKeyCustomRole",
        "ApiKeyPermission",
        "Label",
        "File",
        "Domain",
        "TableView",
        "ShortLink",
        "ProjectMilestone",
        "RecommendationDismissal",
        "ProductFeedback",
        "DeletedProject",
        "ToolImportRecord",
        "ToolImportRun",
        "AuditLogExport",
        AnalyticsTableName.AuditLog,
        AnalyticsTableName.ChangeEvent,
      ],
    ),
    ...noProduct("How the project's people sign in: Project Settings.", [
      "ProjectSSO",
      "ProjectOIDC",
      "ProjectSCIM",
      "ProjectSCIMLog",
      "ProjectSCIMUser",
    ]),
    ...noProduct(
      "Where the project sends from - its mail server, its phone numbers, its chat and video connections - for every product.",
      [
        "ProjectSMTPConfig",
        "ProjectCallSMSConfig",
        "VideoCallConnection",
        "WorkspaceHomeChoice",
        "WorkspaceLiveMessage",
        "WorkspaceNotificationRule",
        "WorkspaceNotificationRuleOwningTeam",
        "WorkspaceNotificationSummary",
        "WorkspaceProjectAuthToken",
        "WorkspacePublicNoteApprovalMessage",
        "WorkspaceSetting",
        "WorkspaceUserAuthToken",
        "PublicNoteApprovalRequest",
      ],
    ),
    ...noProduct(
      "Probes check monitors, network devices, data stores and VMware: Project Settings.",
      ["Probe", "ProbeOwnerTeam", "ProbeOwnerUser"],
    ),
    ...noProduct(
      "How telemetry reaches the project, for every telemetry product: Project Settings.",
      [
        "TelemetryIngestionKey",
        "TelemetryIngestionKeyRefusal",
        "TelemetryIngestionTeamLabelBudget",
        "TelemetryUsageBilling",
      ],
    ),
    ...noProduct(
      "OneUptime AI's own setup and work, which every product's AI uses: Project Settings.",
      [
        "AIAgent",
        "AIAgentOwnerTeam",
        "AIAgentOwnerUser",
        "AIRun",
        "AIRunEvent",
        "AIRunRecording",
        "AutoRemediationDecision",
        "AutoRemediationRule",
        "AutoRemediationSuggestion",
        "ExternalMcpServer",
        "LlmLog",
        "LlmProvider",
        "ResourceAiAgent",
        "RunnerJob",
        "McpOAuthClient",
        "McpOAuthGrant",
        "McpOAuthToken",
      ],
    ),
    ...noProduct("Billing, which the project pays for every product with.", [
      "BillingInvoice",
      "BillingPaymentMethod",
      "PromoCode",
      "Reseller",
      "Reseller Plan",
      "MarketplaceCharge",
      "MarketplaceSubscription",
      "MarketplaceUsageReport",
      "VercelMarketplaceConnection",
      "VercelMarketplaceInstallation",
    ]),
    ...noProduct(
      "The server's own setup, which only a master admin or the server writes.",
      [
        "GlobalConfig",
        "GlobalOIDC",
        "GlobalOIDCProject",
        "GlobalSSO",
        "GlobalSSOProject",
        "EnterpriseLicense",
        "EnterpriseLicenseInstance",
        "OpenSourceDeployment",
        "AcmeCertificate",
        "AcmeChallenge",
        "BackupRun",
        "BackupSetting",
        "DataMigration",
        "MigrationFailure",
        "InstanceHealthLog",
        "InstanceReceivingPeriod",
        "InstanceTokenSigningKey",
        "InstanceSamlSigningKey",
      ],
    ),
  ]);

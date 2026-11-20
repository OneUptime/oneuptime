enum EmailTemplateType {
  BlankTemplate = "BlankTemplate.hbs",
  ForgotPassword = "ForgotPassword.hbs",
  /*
   * The first password of an account a master admin created: a link to set
   * it (Types/Accounts/SetPasswordLink).
   */
  SetPassword = "SetPassword.hbs",
  // An account's sign-in link (Types/Accounts/MagicLink).
  MagicLink = "MagicLink.hbs",
  ProbeOffline = "ProbeOffline.hbs",
  SignupWelcomeEmail = "SignupWelcomeEmail.hbs",
  // The welcome of an account that is ready at sign-up (self-hosted): nothing to verify.
  SignupAccountReadyEmail = "SignupAccountReadyEmail.hbs",
  CompleteRegistration = "CompleteRegistration.hbs",
  /*
   * A sign-up named an address that already has an account (#9816): the
   * address's owner is told, and the page that signed up is not.
   */
  AccountAlreadyExists = "AccountAlreadyExists.hbs",
  /*
   * A person's own change of address, to the new address (#9821): a link to
   * confirm a free one, or word that one another account has cannot be used.
   */
  ConfirmEmailChange = "ConfirmEmailChange.hbs",
  EmailChangeAddressTaken = "EmailChangeAddressTaken.hbs",
  /*
   * An account's address changed, however it changed (#9907): to the
   * address it had, in the account's own language
   * (Types/Accounts/EmailAddressChangedEmail).
   */
  EmailAddressChanged = "EmailAddressChanged.hbs",
  ConfirmProjectSsoSignIn = "ConfirmProjectSsoSignIn.hbs",
  /*
   * The SSO sign-in links of the organizations an account belongs to, asked
   * for on "Sign in with SSO" (#9987, Types/Accounts/SsoSignInLinks), in the
   * account's own language.
   */
  SsoSignInLinks = "SsoSignInLinks.hbs",
  ProbeConnectionStatusChange = "ProbeConnectionStatusChange.hbs",
  AIAgentConnectionStatusChange = "AIAgentConnectionStatusChange.hbs",
  AIAgentOwnerAdded = "AIAgentOwnerAdded.hbs",
  ConfirmStatusPageSubscription = "ConfirmStatusPageSubscription.hbs",
  EmailVerified = "EmailVerified.hbs",
  PasswordChanged = "PasswordChanged.hbs",
  TwoFactorBackupCodeUsed = "TwoFactorBackupCodeUsed.hbs",
  TwoFactorBackupCodesRegenerated = "TwoFactorBackupCodesRegenerated.hbs",
  TwoFactorBackupCodesCreated = "TwoFactorBackupCodesCreated.hbs",
  TwoFactorWrongCodes = "TwoFactorWrongCodes.hbs",
  /*
   * A person's password, passkeys and second steps were cleared by a server
   * admin or an owner of their projects (#9818, #9820,
   * Types/SSO/SignInSettingsClearedEmail), in their own language.
   */
  SignInSettingsCleared = "SignInSettingsCleared.hbs",
  ProbeOwnerAdded = "ProbeOwnerAdded.hbs",
  // Made an owner of a table, a pipeline or a data store (#9681).
  DataAssetOwnerAdded = "DataAssetOwnerAdded.hbs",
  DataPipelineOwnerAdded = "DataPipelineOwnerAdded.hbs",
  DataStoreOwnerAdded = "DataStoreOwnerAdded.hbs",
  /*
   * Made an owner of a service, a piece of infrastructure, a dashboard, a
   * workflow, a runbook or an on-call policy, schedule or incoming call
   * policy (#9700): one template, named by the kind of record it is about.
   */
  ResourceOwnerAdded = "ResourceOwnerAdded.hbs",
  InviteMember = "InviteMember.hbs",
  EmailChanged = "EmailChanged.hbs",
  SubscribedToStatusPage = "SubscribedToStatusPage.hbs",
  SubscriberAnnouncementCreated = "SubscriberAnnouncementCreated.hbs",
  SubscriberAnnouncementUpdated = "SubscriberAnnouncementUpdated.hbs",
  SubscriberIncidentCreated = "SubscriberIncidentCreated.hbs",
  SubscriberIncidentPostmortemCreated = "SubscriberIncidentPostmortemCreated.hbs",
  StatusPageSubscriberReport = "StatusPageSubscriberReport.hbs",
  SubscriberIncidentNoteCreated = "SubscriberIncidentNoteCreated.hbs",
  SubscriberIncidentNoteUpdated = "SubscriberIncidentNoteUpdated.hbs",
  SubscriberIncidentStateChanged = "SubscriberIncidentStateChanged.hbs",
  SubscriberScheduledMaintenanceEventCreated = "SubscriberScheduledMaintenanceEventCreated.hbs",
  ManageExistingStatusPageSubscriberSubscription = "ManageExistingStatusPageSubscriberSubscription.hbs",
  SubscriberScheduledMaintenanceEventStateChanged = "SubscriberScheduledMaintenanceEventStateChanged.hbs",
  StatusPageForgotPassword = "StatusPageForgotPassword.hbs",
  // A private user's sign-in link (Types/StatusPage/StatusPageMagicLink).
  StatusPageMagicLink = "StatusPageMagicLink.hbs",
  StatusPagePasswordChanged = "StatusPagePasswordChanged.hbs",
  /*
   * A private user's address changed (#10156): to the address they had, in
   * the status page's branding and language
   * (Types/StatusPage/PrivateUserEmailAddressChangedEmail).
   */
  StatusPagePrivateUserEmailAddressChanged = "StatusPagePrivateUserEmailAddressChanged.hbs",
  StatusPageWelcomeEmail = "StatusPageWelcomeEmail.hbs",
  SubscriberScheduledMaintenanceEventNoteCreated = "SubscriberScheduledMaintenanceEventNoteCreated.hbs",
  SubscriberScheduledMaintenanceEventNoteUpdated = "SubscriberScheduledMaintenanceEventNoteUpdated.hbs",
  SMTPTest = "SMTPTest.hbs",
  MonitorOwnerAdded = "MonitorOwnerAdded.hbs",
  MonitorOwnerResourceCreated = "MonitorOwnerResourceCreated.hbs",
  MonitorProbesStatus = "MonitorProbesStatus.hbs",
  MonitorsAffectedByProbeStatus = "MonitorsAffectedByProbeStatus.hbs",
  MonitorOwnerStatusChanged = "MonitorOwnerStatusChanged.hbs",

  SloOwnerStatusChanged = "SloOwnerStatusChanged.hbs",

  IncidentOwnerAdded = "IncidentOwnerAdded.hbs",
  IncidentOwnerStateChanged = "IncidentOwnerStateChanged.hbs",
  IncidentOwnerNotePosted = "IncidentOwnerNotePosted.hbs",
  IncidentOwnerResourceCreated = "IncidentOwnerResourceCreated.hbs",
  IncidentMemberAdded = "IncidentMemberAdded.hbs",
  IncidentOwnerUnresolvedReminder = "IncidentOwnerUnresolvedReminder.hbs",
  IncidentOwnerSlaBreached = "IncidentOwnerSlaBreached.hbs",

  AlertOwnerAdded = "AlertOwnerAdded.hbs",
  AlertOwnerStateChanged = "AlertOwnerStateChanged.hbs",
  AlertOwnerNotePosted = "AlertOwnerNotePosted.hbs",
  AlertOwnerResourceCreated = "AlertOwnerResourceCreated.hbs",
  AlertOwnerUnresolvedReminder = "AlertOwnerUnresolvedReminder.hbs",

  AlertEpisodeOwnerAdded = "AlertEpisodeOwnerAdded.hbs",
  AlertEpisodeOwnerStateChanged = "AlertEpisodeOwnerStateChanged.hbs",
  AlertEpisodeOwnerNotePosted = "AlertEpisodeOwnerNotePosted.hbs",
  AlertEpisodeOwnerResourceCreated = "AlertEpisodeOwnerResourceCreated.hbs",
  AlertEpisodeOwnerAlertAdded = "AlertEpisodeOwnerAlertAdded.hbs",

  IncidentEpisodeOwnerAdded = "IncidentEpisodeOwnerAdded.hbs",
  IncidentEpisodeOwnerStateChanged = "IncidentEpisodeOwnerStateChanged.hbs",
  IncidentEpisodeOwnerNotePosted = "IncidentEpisodeOwnerNotePosted.hbs",
  IncidentEpisodeOwnerResourceCreated = "IncidentEpisodeOwnerResourceCreated.hbs",
  IncidentEpisodeOwnerIncidentAdded = "IncidentEpisodeOwnerIncidentAdded.hbs",

  SubscriberEpisodeCreated = "SubscriberEpisodeCreated.hbs",
  SubscriberEpisodeStateChanged = "SubscriberEpisodeStateChanged.hbs",
  SubscriberEpisodeNoteCreated = "SubscriberEpisodeNoteCreated.hbs",
  SubscriberEpisodeNoteUpdated = "SubscriberEpisodeNoteUpdated.hbs",

  ScheduledMaintenanceOwnerNotePosted = "ScheduledMaintenanceOwnerNotePosted.hbs",
  ScheduledMaintenanceOwnerAdded = "ScheduledMaintenanceOwnerAdded.hbs",
  ScheduledMaintenanceOwnerStateChanged = "ScheduledMaintenanceOwnerStateChanged.hbs",
  ScheduledMaintenanceOwnerResourceCreated = "ScheduledMaintenanceOwnerResourceCreated.hbs",
  ScheduledMaintenanceOwnerUnresolvedReminder = "ScheduledMaintenanceOwnerUnresolvedReminder.hbs",
  StatusPageOwnerResourceCreated = "StatusPageOwnerResourceCreated.hbs",
  StatusPageOwnerAdded = "StatusPageOwnerAdded.hbs",
  StatusPageOwnerAnnouncementPosted = "StatusPageOwnerAnnouncementPosted.hbs",
  SimpleMessage = "SimpleMessage.hbs",
  VerificationCode = "VerificationCode.hbs",
  AcknowledgeIncident = "AcknowledgeIncident.hbs",
  AcknowledgeAlert = "AcknowledgeAlert.hbs",
  AcknowledgeAlertEpisode = "AcknowledgeAlertEpisode.hbs",
  AcknowledgeIncidentEpisode = "AcknowledgeIncidentEpisode.hbs",
  // A test page (Types/OnCallDutyPolicy/OnCallTestPage): TEST first, and Acknowledge.
  OnCallTestPage = "OnCallTestPage.hbs",

  UserAddedToOnCallPolicy = "UserAddedToOnCallPolicy.hbs",
  UserRemovedFromOnCallPolicy = "UserRemovedFromOnCallPolicy.hbs",
  UserCurrentlyOnOnCallRoster = "UserCurrentlyOnOnCallRoster.hbs",
  UserNextOnOnCallRoster = "UserNextOnOnCallRoster.hbs",
  UserNoLongerActiveOnOnCallRoster = "UserNoLongerActiveOnOnCallRoster.hbs",
  UserOnCallShiftReminder = "UserOnCallShiftReminder.hbs",
  UserOnCallShiftReassigned = "UserOnCallShiftReassigned.hbs",

  IncomingCallPolicyOwnerMissedCall = "IncomingCallPolicyOwnerMissedCall.hbs",

  // Security cases (Server/Utils/SecurityCase/SecurityCaseNotifications.ts).
  SecurityCaseOpened = "SecurityCaseOpened.hbs",
  SecurityCaseAssigned = "SecurityCaseAssigned.hbs",
  SecurityPlaybookApprovalRequested = "SecurityPlaybookApprovalRequested.hbs",
  SecurityCaseTargetDue = "SecurityCaseTargetDue.hbs",
  SecurityCaseTaskAssigned = "SecurityCaseTaskAssigned.hbs",
  // A scheduled hunt found security events (SecurityHuntNotifications).
  SecurityHuntFound = "SecurityHuntFound.hbs",

  // Public note approval (Server/Utils/Notes/PublicNoteApprovalNotifications.ts).
  PublicNoteApprovalRequested = "PublicNoteApprovalRequested.hbs",
  PublicNoteApprovalDecided = "PublicNoteApprovalDecided.hbs",

  ProjectSubscriptionOverdue = "ProjectSubscriptionOverdue.hbs",
  Invoice = "Invoice.hbs",

  ClickhouseCapacityWarning = "ClickhouseCapacityWarning.hbs",
  RedisHealthWarning = "RedisHealthWarning.hbs",
  PostgresHealthWarning = "PostgresHealthWarning.hbs",
  // A backup or a restore of the instance failed (Enterprise, ee/Server/Backup).
  BackupFailed = "BackupFailed.hbs",
  AuditLogExportFailed = "AuditLogExportFailed.hbs",

  EnterpriseLicenseUserLimitBreach = "EnterpriseLicenseUserLimitBreach.hbs",
  EnterpriseLicenseExpiryReminder = "EnterpriseLicenseExpiryReminder.hbs",

  /*
   * A published OneUptime security advisory affects the version this
   * self-hosted installation runs (Workers/Jobs/InstanceUpdate): once per
   * advisory, to its master admins and admin notification email.
   */
  SecurityAdvisoryAffectsInstallation = "SecurityAdvisoryAffectsInstallation.hbs",

  NotificationRollup = "NotificationRollup.hbs",

  // The marketing site's Resellers page form (Home/Utils/ResellerInquiry.ts).
  ResellerInquiry = "ResellerInquiry.hbs",

  /*
   * What a person wrote in Give Feedback, to the team that reads it, the
   * person copied (Server/Utils/ProductFeedback/GiveFeedbackEmail.ts).
   */
  GiveFeedback = "GiveFeedback.hbs",
}

export default EmailTemplateType;

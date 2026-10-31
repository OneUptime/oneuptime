enum EmailTemplateType {
  BlankTemplate = "BlankTemplate.hbs",
  ForgotPassword = "ForgotPassword.hbs",
  ProbeOffline = "ProbeOffline.hbs",
  SignupWelcomeEmail = "SignupWelcomeEmail.hbs",
  CompleteRegistration = "CompleteRegistration.hbs",
  ConfirmProjectSsoSignIn = "ConfirmProjectSsoSignIn.hbs",
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
  ProbeOwnerAdded = "ProbeOwnerAdded.hbs",
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
  StatusPagePasswordChanged = "StatusPagePasswordChanged.hbs",
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
}

export default EmailTemplateType;

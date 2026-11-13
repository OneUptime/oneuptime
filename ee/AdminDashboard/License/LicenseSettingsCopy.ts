import {
  PluralTemplate,
  translationKey,
} from "Common/UI/Utils/TranslateTemplate";

/*
 * What Settings > License says (./LicenseSettingsView.tsx, its activation
 * form ./LicenseActivationForm.tsx and the status it reads off the server's
 * answer, ./LicenseStatus.ts).
 *
 * Kept free of React so the page, its pure status helper and their tests
 * read the same words. Every sentence is an English key of the Admin
 * Dashboard's locale files, in every language (ee/Tests/UI/License/
 * LicenseSettingsWords.test.ts): the license cards this page shares with
 * the edition dialog were already in the reader's language, and the page
 * around them was the one part still in English - read right to left on an
 * Arabic or Persian page, with its full stops at the wrong end.
 *
 * Only the Admin Dashboard draws this page (the Dashboard's plugin bundles
 * the license cards alone), so only its locales hold these words. What is
 * not OneUptime's to word stays as written: the license key, the instance
 * ID, the licensed company's name, the sales address, a marketplace's name
 * and whatever the server says.
 */
export const LicenseSettingsCopy: {
  cardDescription: string;
  licensedTo: string;
  notSpecified: string;
  expires: string;
  licenseKey: string;
  activation: string;
  activatedOffline: string;
  instanceId: string;
  refreshLicense: string;
  refreshLicenseTooltip: string;
  changeLicenseKey: string;
  replaceLicense: string;
  enterLicenseKeyFirst: string;
  pasteLicenseTokenFirst: string;
  licenseValidated: string;
  licenseActivatedOffline: string;
  licenseRefreshed: string;
  licenseCouldNotBeRead: string;
  newLicenseKey: string;
  licenseToken: string;
  licenseTokenHelp: string;
  newLicenseKeyHelp: string;
  licenseKeyHelp: string;
  licenseTokenPlaceholder: string;
  licenseKeyPlaceholder: string;
  tokenInstanceId: string;
  useLicenseKeyInstead: string;
  activateOfflineInstead: string;
  activateLicense: string;
  validateLicense: string;
  cancel: string;
} = {
  cardDescription: translationKey("The Enterprise license of this installation."),
  // The facts of the license in place, each above its value.
  licensedTo: translationKey("Licensed to"),
  notSpecified: translationKey("Not specified"),
  expires: translationKey("Expires"),
  licenseKey: translationKey("License key"),
  activation: translationKey("Activation"),
  activatedOffline: translationKey("Offline, with a signed token"),
  instanceId: translationKey("Instance ID"),
  // The card's buttons.
  refreshLicense: translationKey("Refresh license"),
  refreshLicenseTooltip: translationKey(
    "Fetch the latest seat limit and expiry for this license from OneUptime.",
  ),
  changeLicenseKey: translationKey("Change license key"),
  replaceLicense: translationKey("Replace license"),
  // What a write says, and what the page says when it cannot read the license.
  enterLicenseKeyFirst: translationKey(
    "Please enter a license key before validating.",
  ),
  pasteLicenseTokenFirst: translationKey(
    "Please paste a license token before activating.",
  ),
  licenseValidated: translationKey("License validated successfully."),
  licenseActivatedOffline: translationKey("License activated offline."),
  licenseRefreshed: translationKey("License refreshed from OneUptime."),
  licenseCouldNotBeRead: translationKey("The license could not be read."),
  // The activation form: a key, or behind one link a signed token.
  newLicenseKey: translationKey("New license key"),
  licenseToken: translationKey("License token (offline activation)"),
  licenseTokenHelp: translationKey(
    "For an installation that cannot reach oneuptime.com. Paste the signed license token OneUptime issued for this installation. Only tokens signed by a key this OneUptime release trusts are accepted.",
  ),
  newLicenseKeyHelp: translationKey(
    "Enter the new enterprise license key and validate it to replace the current one. Your existing license stays active until the new key is validated.",
  ),
  // The sales address is a link, drawn where the language puts {{email}}.
  licenseKeyHelp: translationKey(
    "Validate your license key with OneUptime to activate it. Need a license key? Contact our sales team at {{email}}.",
  ),
  licenseTokenPlaceholder: translationKey("Paste the signed license token"),
  licenseKeyPlaceholder: translationKey("Enter your enterprise license key"),
  // The instance ID is drawn as written, where the language puts it.
  tokenInstanceId: translationKey(
    "A token works only on the instance it was issued for. This installation's instance ID is {{instanceId}}.",
  ),
  useLicenseKeyInstead: translationKey("Use a license key instead"),
  activateOfflineInstead: translationKey(
    "No internet access? Activate offline with a license token",
  ),
  activateLicense: translationKey("Activate License"),
  validateLicense: translationKey("Validate License"),
  cancel: translationKey("Cancel"),
};

/*
 * Where the license stands (./LicenseStatus.ts). Most of these are the
 * edition dialog's own sentences (Common's EditionLabel), worded once for
 * both: the page and the dialog say the same thing about the same license.
 * The few that are the page's own say "here" where the dialog says "in the
 * Admin Dashboard".
 */
export const LicenseStatusCopy: {
  licensedThrough: string;
  billedByTheHour: string;
  lastReportingProblem: string;
  notAcceptingReports: string;
  keepsWorkingUntil: string;
  keepsWorkingUntilGraceEnds: string;
  makeSureItCanReach: string;
  noLongerLicenses: string;
  trial: string;
  trialDaysLeft: string;
  installedButUnsure: string;
  noLicenseInstalled: string;
  fullyAvailableUntil: string;
  fullyAvailable: string;
  graceUntil: string;
  grace: string;
  expiredOn: string;
  expired: string;
  keepsWorkingUntilGraceEndsDaysLeft: string;
  renewThenRefreshHere: string;
  licenseNotValid: string;
  couldNotBeVerified: string;
  expiredOnGraceOver: string;
  expiredGraceOver: string;
  installedButNotConfirmed: string;
  noValidLicenseInstalled: string;
  licenseExpired: string;
  noValidLicense: string;
  evaluationActive: string;
  evaluationDescription: string;
  licenseActive: string;
  legacyDescription: string;
  enterpriseFeaturesOn: string;
  storedButNotLicensing: string;
} = {
  // A license that is a cloud marketplace subscription.
  licensedThrough: translationKey("Licensed through {{marketplace}}"),
  billedByTheHour: translationKey(
    "Every user of this installation is billed by the hour on your {{marketplace}} account. Enterprise features stay licensed for as long as {{marketplace}} accepts the installation's hourly usage reports.",
  ),
  lastReportingProblem: translationKey("Last reporting problem: {{problem}}"),
  notAcceptingReports: translationKey(
    "{{marketplace}} is not accepting usage reports",
  ),
  keepsWorkingUntil: translationKey(
    "Every enterprise feature keeps working until {{date}}.",
  ),
  keepsWorkingUntilGraceEnds: translationKey(
    "Every enterprise feature keeps working until the grace period ends.",
  ),
  makeSureItCanReach: translationKey(
    "Make sure this installation can reach {{marketplace}} and is set up as the listing's instructions say.",
  ),
  noLongerLicenses: translationKey(
    "{{marketplace}} no longer licenses this installation",
  ),
  // The unlicensed installation's first-run trial.
  trial: translationKey("Enterprise Edition trial"),
  trialDaysLeft: translationKey("Enterprise Edition trial: {{daysLeft}}"),
  installedButUnsure: translationKey(
    "A license is installed, but this installation cannot tell whether it is still current, so it is treating this as an unlicensed install.",
  ),
  noLicenseInstalled: translationKey("No Enterprise license is installed."),
  fullyAvailableUntil: translationKey(
    "Enterprise features stay fully available until {{date}}, counted from the first time this installation ran the Enterprise Edition.",
  ),
  fullyAvailable: translationKey(
    "Enterprise features stay fully available, counted from the first time this installation ran the Enterprise Edition.",
  ),
  // An expired license's grace period.
  graceUntil: translationKey("License expired, grace period until {{date}}"),
  grace: translationKey("License expired, grace period"),
  expiredOn: translationKey("The Enterprise license expired on {{date}}."),
  expired: translationKey("The Enterprise license expired."),
  keepsWorkingUntilGraceEndsDaysLeft: translationKey(
    "Every enterprise feature keeps working until the grace period ends ({{daysLeft}}).",
  ),
  renewThenRefreshHere: translationKey(
    "Renew the license with OneUptime, then refresh it here.",
  ),
  // No usable license: expired past its grace period, missing or invalid.
  licenseNotValid: translationKey("License not valid"),
  couldNotBeVerified: translationKey(
    "The stored license could not be verified. Validate the license again.",
  ),
  expiredOnGraceOver: translationKey(
    "The Enterprise license expired on {{date}} and its grace period is over.",
  ),
  expiredGraceOver: translationKey(
    "The Enterprise license expired and its grace period is over.",
  ),
  installedButNotConfirmed: translationKey(
    "A license is installed, but this installation cannot confirm that it is current, so nothing is licensed by it.",
  ),
  noValidLicenseInstalled: translationKey(
    "This installation has no valid Enterprise license.",
  ),
  licenseExpired: translationKey("License expired"),
  noValidLicense: translationKey("No valid license"),
  // A valid license.
  evaluationActive: translationKey("Evaluation license active"),
  evaluationDescription: translationKey(
    "This key was issued for evaluation and testing. It is not licensed for production use — reach out whenever you are ready to go live and we will get a production license sorted for you.",
  ),
  licenseActive: translationKey("License active"),
  legacyDescription: translationKey(
    "This license was issued before OneUptime signed its licenses, so this installation cannot verify it offline. It keeps working; refreshing the license replaces it with a signed one once OneUptime issues them.",
  ),
  enterpriseFeaturesOn: translationKey(
    "Enterprise features are on for this installation.",
  ),
  // A write the server stored that licenses nothing (describeLicenseWriteOutcome).
  storedButNotLicensing: translationKey(
    "The license was stored, but this installation cannot confirm that it is current, so enterprise features are not being licensed by it. Refresh the license, or check it on oneuptime.com.",
  ),
};

// Whole days left in the trial or the grace period, as the dialog counts them.
export const DAYS_LEFT: PluralTemplate = {
  one: translationKey("{{count}} day left"),
  other: translationKey("{{count}} days left"),
};

export const LICENSE_SETTINGS_PLURALS: ReadonlyArray<PluralTemplate> = [
  DAYS_LEFT,
];

// The address a license key is bought from: it goes to OneUptime, as written.
export const SALES_EMAIL: string = "sales@oneuptime.com";

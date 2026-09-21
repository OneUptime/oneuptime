import { JSONObject } from "../../../Types/JSON";
import { ComponentType, ReactElement, ReactNode } from "react";

/*
 * The contract between the edition dialog (EditionLabel) and the Enterprise
 * license management UI.
 *
 * EditionLabel only READS the license: it asks GET /global-config/license and
 * shows what the answer says - the edition pill, the status, grace and trial
 * notices, the version card. Everything that CHANGES the license lives in the
 * Enterprise Edition (ee/AdminDashboard/License, under ee/LICENSE), because
 * the routes it calls exist only in the Enterprise server: activating it with
 * a key or an offline token, refreshing it from oneuptime.com, replacing it,
 * and the seat usage and instance tables a master admin manages it by.
 *
 * The Dashboard and the Admin Dashboard hand that UI to EditionLabel as their
 * LicenseManager plugin (src/Enterprise/EnterprisePlugins.ts). The Community
 * stubs have none, and the login page passes none: there the dialog shows
 * the license status only, and nobody is told to manage the license from it.
 *
 * The manager wraps the dialog rather than filling one spot inside it. Its
 * sections land in three places in the dialog body (messages at the top, seat
 * usage after the version card, the activation input near the bottom) and it
 * drives the dialog's footer buttons, so EditionLabel gives it renderDialog
 * and the manager calls it with those parts. It stays mounted while the
 * dialog is closed, so what an admin typed and which input they chose
 * survive closing and reopening the dialog.
 *
 * Types only: nothing here ships any license management code.
 */

/*
 * How close the installation is to its licensed seats. "breached" also
 * covers an enforced limit that is exactly full: new users are already
 * refused there.
 */
export type SeatTone = "healthy" | "approaching" | "breached";

// What EditionLabel knows about the license, read-only.
export interface LicenseSnapshot {
  /*
   * The body of the last GET /global-config/license that succeeded, or null
   * before the first one and after one that failed. A new object on every
   * successful load, so a manager can tell that the license was (re)loaded.
   */
  payload: JSONObject | null;
  isLoading: boolean;
  // Why the last load failed; "" when it did not.
  loadError: string;
  /*
   * A master admin, in a dialog that has a license manager. The server
   * accepts license writes from a master admin only, so nobody else is
   * offered them.
   */
  canManageLicense: boolean;
  licenseValid: boolean;
  // Enterprise Edition with no license yet, inside its first-run trial.
  isUnlicensedTrial: boolean;
  // A real license (not the trial) is valid and loaded: show what it covers.
  showLicenseDetails: boolean;
  // "" when the server did not say.
  companyName: string;
  // The stored license key; "" when there is none or the caller may not see it.
  licenseKey: string;
  userLimit: number | null;
  // What oneuptime.com last counted across every instance on the license.
  currentUserCount: number | null;
  /*
   * The seat figure everything is measured against: the live, enforced count
   * when this installation enforces its seat limit, else currentUserCount.
   */
  effectiveUserCount: number | null;
  isSeatLimitEnforced: boolean;
  canAddMoreUsers: boolean;
  seatTone: SeatTone;
  // The percent of licensed seats in use, as the admin reads it (may exceed 100).
  seatUsageDisplayPercent: number | null;
  currentVersion: string;
  latestVersion: string;
  // currentVersion is a real release number that can be compared.
  hasComparableVersion: boolean;
}

// What a manager adds to the dialog. Every part is optional.
export interface LicenseManagerDialogParts {
  // Top of the body: the outcome of the last license action.
  messages?: ReactNode | undefined;
  // After the version card: seat usage and the instances on the license.
  usage?: ReactNode | undefined;
  // Near the bottom of the body: the license key or offline token input.
  activation?: ReactNode | undefined;
  // The dialog's primary button, when the manager offers one.
  submitButtonText?: string | undefined;
  onSubmit?: (() => void) | undefined;
  isSubmitting?: boolean | undefined;
  disableSubmitButton?: boolean | undefined;
  // Left of the footer: actions on a license that is already in place.
  leftFooterElement?: ReactElement | undefined;
}

export interface LicenseManagerProps {
  license: LicenseSnapshot;
  isDialogOpen: boolean;
  // Asks GET /global-config/license again; the pill and the dialog follow.
  reloadLicense: () => Promise<void>;
  /*
   * Applies the seat fields (isSeatLimitEnforced, seatsInUse, canAddMoreUsers)
   * a license write answers with, the same way the GET's are applied.
   */
  applySeatEnforcement: (payload: JSONObject) => void;
  // Renders the dialog (nothing while it is closed) with the manager's parts.
  renderDialog: (parts: LicenseManagerDialogParts) => ReactElement;
}

/*
 * Must render renderDialog's result, and must not be React.lazy: it is
 * mounted with the edition pill on every page, and the dialog is inside it.
 */
export type LicenseManagerComponent = ComponentType<LicenseManagerProps>;

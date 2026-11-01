import { JSONObject } from "../../../Types/JSON";
import { SeatTone } from "./LicenseSeatUsage";
import { ComponentType } from "react";

/*
 * The contract between the edition dialog (EditionLabel) and the Enterprise
 * Edition's license details.
 *
 * The dialog only shows where the license stands. It asks GET
 * /global-config/license and shows what the answer says - the edition pill,
 * the status, grace and trial notices, the version card - and the Enterprise
 * Edition adds the seat usage and the instances on the license
 * (ee/AdminDashboard/License, under ee/LICENSE).
 *
 * Nothing in the dialog changes the license. Activating it with a key or an
 * offline token, refreshing it from oneuptime.com and replacing it are done
 * on one page, Settings > License in the Admin Dashboard, which is a master
 * admin's alone (./LicenseSettingsPage.ts). The dialog's one action takes a
 * master admin there.
 *
 * The Dashboard and the Admin Dashboard hand the details to EditionLabel as
 * their LicenseDetails plugin (src/Enterprise/EnterprisePlugins.ts). The
 * Community stubs have none, and the login page passes none: there the dialog
 * shows the license status only, and nobody is told to manage the license
 * from it.
 *
 * Types only: nothing here ships any license management code.
 */

// What the details know about the license, read-only.
export interface LicenseSnapshot {
  /*
   * The body of the last GET /global-config/license that succeeded, or null
   * before the first one and after one that failed.
   */
  payload: JSONObject | null;
  /*
   * A master admin, in a dialog that has license details. The server
   * accepts license writes from a master admin only, so nobody else is
   * sent to make them.
   */
  canManageLicense: boolean;
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

export interface LicenseDetailsProps {
  license: LicenseSnapshot;
}

/*
 * Drawn inside the dialog while it is open, and on the license page. It holds
 * no state of its own, so it may simply draw nothing.
 */
export type LicenseDetailsComponent = ComponentType<LicenseDetailsProps>;

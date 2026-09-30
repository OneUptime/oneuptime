import { EnterpriseLicenseMode } from "./EnterpriseLicenseMode";

/*
 * The "Force SSO for Login" card on the project and status page SSO screens.
 *
 * While single sign-on is off - the license lapsed (ReadOnly), or it does not
 * include single sign-on (NotIncluded) - the requirement is not enforced, and
 * the server reports it the way it is applied: every read made for a person,
 * master admins included, says "No", whatever is saved (EditionEnforcement.
 * shouldMaskSsoRequirementOnRead). The saved value is untouched and is
 * enforced again as soon as a license that includes single sign-on is
 * activated.
 *
 * So in those modes - exactly the ones isEnterpriseConfigurationReadOnly
 * answers true for - the card is not editable: its form would open with the
 * reported "No", and saving it - even unchanged - would overwrite the saved
 * requirement, which then would not come back with the license. And its
 * description says why it shows "No", so nobody reads that as the setting
 * having been lost.
 */

export const FORCE_SSO_NOT_ENFORCED_DESCRIPTION: string =
  "Not enforced while the Enterprise license is missing or expired, so this shows No whatever is saved. The saved setting is kept and is enforced again as soon as a license is activated.";

export const FORCE_SSO_NOT_INCLUDED_DESCRIPTION: string =
  "Not enforced while the Enterprise license does not include single sign-on, so this shows No whatever is saved. The saved setting is kept and is enforced again as soon as a license that includes single sign-on is activated.";

// The description the card shows: its usual one unless the setting is locked.
export const getForceSsoDescription: (
  mode: EnterpriseLicenseMode,
  usualDescription: string,
) => string = (
  mode: EnterpriseLicenseMode,
  usualDescription: string,
): string => {
  if (mode === EnterpriseLicenseMode.NotIncluded) {
    return FORCE_SSO_NOT_INCLUDED_DESCRIPTION;
  }

  if (mode === EnterpriseLicenseMode.ReadOnly) {
    return FORCE_SSO_NOT_ENFORCED_DESCRIPTION;
  }

  return usualDescription;
};

import { IsBillingEnabled } from "Common/Server/EnvironmentConfig";
import licenseProvider from "../License/LicenseProvider";
import { LicenseTokenClassification } from "../License/LicenseToken";

/*
 * Whether this installation may white-label itself: replace OneUptime's name
 * and logo with its own. One question, asked synchronously wherever the
 * answer shows (env.js, the index pages, emails, the settings routes).
 *
 * Yes only when ALL of these hold:
 *
 *   - this is a self-hosted installation (billing off). OneUptime Cloud is
 *     OneUptime's own product and never white-labelled;
 *   - its license token is VERIFIED - signed by a key this build trusts. An
 *     unverified legacy token, a token signed by an unknown key and the
 *     unlicensed trial grant nothing here, because the right is read from
 *     the signature and from nowhere else;
 *   - the license is usable right now: valid, or expired and still inside
 *     its grace period (nothing changes until the grace period ends, as for
 *     every other enterprise feature);
 *   - the signed token carries canBeWhiteLabelled: true.
 *
 * Everything else - the Community Edition, no license, a license without the
 * switch, one that expired past its grace period, an invalid or tampered one,
 * a license not read yet - is no. It fails closed: an unknown license state
 * is no, so a page shows OneUptime's branding rather than guessing.
 *
 * When the answer turns to no, the product shows OneUptime's name and logo
 * again at once and the settings disappear; what was stored is kept, so it
 * all comes back if the license gets the switch back.
 */

export const isWhiteLabelAllowedFor: (data: {
  classification: LicenseTokenClassification | null;
  isBillingEnabled: boolean;
}) => boolean = (data: {
  classification: LicenseTokenClassification | null;
  isBillingEnabled: boolean;
}): boolean => {
  if (data.isBillingEnabled) {
    return false;
  }

  const classification: LicenseTokenClassification | null =
    data.classification;

  if (!classification) {
    return false;
  }

  if (classification.verification !== "verified") {
    return false;
  }

  if (classification.status !== "valid" && classification.status !== "grace") {
    return false;
  }

  return classification.canBeWhiteLabelled === true;
};

// The answer for this process, from the license it holds right now.
export const isWhiteLabelAllowed: () => boolean = (): boolean => {
  try {
    return isWhiteLabelAllowedFor({
      classification: licenseProvider.getCachedClassification(),
      isBillingEnabled: IsBillingEnabled,
    });
  } catch {
    return false;
  }
};

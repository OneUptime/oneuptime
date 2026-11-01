import Dictionary from "../../../Types/Dictionary";
import { JSONObject } from "../../../Types/JSON";
import {
  SecurityAdvisorySeverity,
  SEVERITY_ORDER,
} from "../../../Types/UpdateCheck/SecurityAdvisory";
import { AffectingAdvisory } from "../../../Types/UpdateCheck/UpdateStatus";

/*
 * The email that tells a self-hosted installation's owners that a security
 * advisory OneUptime published on GitHub affects the version it runs, and
 * which release to upgrade to (SecurityAdvisoryAffectsInstallation.hbs).
 *
 * Pure: the update check gathers what to say and who to tell, and this
 * words it, so the template test renders exactly what is sent. Every value
 * is plain text the template writes escaped; the only link is the
 * installation's own upgrade guide. The product is named as the
 * installation goes by (ProductBrandingText), and nothing names GitHub's
 * pages: the Admin Dashboard's notice links each advisory.
 */

export interface SecurityAdvisoryEmailData {
  // "OneUptime", or the name the installation goes by.
  productName: string;
  // HOST; "" when it is not set.
  host: string;
  currentVersion: string;
  // The release to upgrade to, or null when no release fixes them all yet.
  recommendedVersion: string | null;
  // What this email is about: the advisories nobody was emailed about yet.
  advisories: Array<AffectingAdvisory>;
  // The installation's upgrade guide; "" when HOST is not set.
  upgradeGuideUrl: string;
  homeUrl: string;
}

export interface SecurityAdvisoryEmailContent {
  subject: string;
  vars: Dictionary<string | JSONObject>;
}

// The most advisories one email lists; the Admin Dashboard lists them all.
export const MAX_ADVISORIES_IN_EMAIL: number = 20;

export const SEVERITY_LABELS: Record<SecurityAdvisorySeverity, string> = {
  [SecurityAdvisorySeverity.Critical]: "Critical",
  [SecurityAdvisorySeverity.High]: "High",
  [SecurityAdvisorySeverity.Medium]: "Medium",
  [SecurityAdvisorySeverity.Low]: "Low",
  [SecurityAdvisorySeverity.Unknown]: "Unrated",
};

export default class SecurityAdvisoryEmail {
  public static build(
    data: SecurityAdvisoryEmailData,
  ): SecurityAdvisoryEmailContent {
    const count: number = data.advisories.length;
    const onHost: string = data.host ? ` on ${data.host}` : "";
    const advisoryWords: string =
      count === 1 ? "a security advisory" : `${count} security advisories`;

    const subject: string = `ACTION REQUIRED: ${
      count === 1
        ? "a security advisory affects"
        : `${count} security advisories affect`
    } ${data.productName} ${data.currentVersion}${onHost}`;

    const affected: string = `${data.productName} ${data.currentVersion}${onHost} is affected by ${advisoryWords} published for it.`;

    const leadSentence: string = data.recommendedVersion
      ? `${affected} Upgrade to ${data.recommendedVersion} to fix ${
          count === 1 ? "it" : "them"
        }. The Admin Dashboard lists every advisory that affects this installation.`
      : `${affected} No release fixes ${
          count === 1 ? "it" : "all of them"
        } yet. The Admin Dashboard links each advisory, with what to do until a release does, and the footer will say when one is out.`;

    const isSevere: boolean = data.advisories.some(
      (advisory: AffectingAdvisory): boolean => {
        return (
          advisory.severity === SecurityAdvisorySeverity.Critical ||
          advisory.severity === SecurityAdvisorySeverity.High
        );
      },
    );

    const listed: Array<AffectingAdvisory> = [...data.advisories]
      .sort((a: AffectingAdvisory, b: AffectingAdvisory): number => {
        return (
          SEVERITY_ORDER.indexOf(a.severity) -
          SEVERITY_ORDER.indexOf(b.severity)
        );
      })
      .slice(0, MAX_ADVISORIES_IN_EMAIL);

    const rows: Array<JSONObject> = listed.map(
      (advisory: AffectingAdvisory): JSONObject => {
        return {
          title: `${SEVERITY_LABELS[advisory.severity]}: ${advisory.summary}`,
          details: [
            advisory.ghsaId,
            advisory.cveId,
            advisory.affectedVersions
              ? `Affects ${advisory.affectedVersions}`
              : null,
            advisory.fixedIn
              ? `Fixed in ${advisory.fixedIn}`
              : "No fixed release yet",
          ]
            .filter((part: string | null): part is string => {
              return Boolean(part);
            })
            .join(" · "),
        };
      },
    );

    const unlisted: number = count - listed.length;

    return {
      subject: subject,
      vars: {
        subject: subject,
        badgeType: isSevere ? "critical" : "warning",
        badgeText: data.recommendedVersion
          ? "Security Update"
          : "Security Advisory",
        leadSentence: leadSentence,
        oneuptimeHost: data.host,
        homeURL: data.homeUrl,
        currentVersion: data.currentVersion,
        recommendedVersion: data.recommendedVersion || "",
        hasAdvisories: rows.length > 0 ? "true" : "false",
        advisories: rows as unknown as JSONObject,
        moreAdvisoriesSentence:
          unlisted > 0
            ? `...and ${unlisted} more. The Admin Dashboard lists them all.`
            : "",
        upgradeGuideLink: data.upgradeGuideUrl,
        reasonSentence: `You are receiving this email because you administer this ${data.productName} installation. Its master admins, and its admin notification email, are told once about each published security advisory that affects the version it runs.`,
      },
    };
  }
}

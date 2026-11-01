import {
  LicenseDetailsProps,
  LicenseSnapshot,
} from "Common/UI/Components/EditionLabel/LicenseDetails";
import { SeatTone } from "Common/UI/Components/EditionLabel/LicenseSeatUsage";
import Button, { ButtonStyleType } from "Common/UI/Components/Button/Button";
import Icon from "Common/UI/Components/Icon/Icon";
import OneUptimeDate from "Common/Types/Date";
import EnterpriseLicenseInstanceSummary from "Common/Types/EnterpriseLicense/EnterpriseLicenseInstanceSummary";
import IconProp from "Common/Types/Icon/IconProp";
import { JSONObject } from "Common/Types/JSON";
import VersionUtil from "Common/Utils/VersionUtil";
import React, { FunctionComponent, ReactElement, useMemo } from "react";

/*
 * The Enterprise license details: the seat usage card and the instances on
 * the license, for a master admin. Nothing here changes the license.
 *
 * Drawn in two places. In the edition dialog (the pill in the Dashboard's
 * footer and the Admin Dashboard's header), where EditionLabel renders it
 * through the LicenseDetails plugin key of both frontends, and on the Admin
 * Dashboard's Settings > License page (./LicenseSettingsView.tsx), which is
 * where a master admin activates, refreshes and replaces the license.
 * Common/UI/Components/EditionLabel/LicenseDetails.ts is the contract.
 *
 * One implementation for both frontends: ee/Dashboard/License/Plugins.ts
 * imports it from here. It may therefore import only what both bundles
 * resolve - Common/... and react, never "@oneuptime/admin-dashboard/..." -
 * and ee/Dashboard/tsconfig.json includes this file so the Dashboard's type
 * check proves it.
 */

const SALES_EMAIL: string = "sales@oneuptime.com";
const SALES_MAILTO_URL: string = "mailto:sales@oneuptime.com";

type ParseLicenseInstancesFunction = (
  value: unknown,
) => Array<EnterpriseLicenseInstanceSummary>;

const parseLicenseInstances: ParseLicenseInstancesFunction = (
  value: unknown,
): Array<EnterpriseLicenseInstanceSummary> => {
  if (!Array.isArray(value)) {
    return [];
  }

  const instances: Array<EnterpriseLicenseInstanceSummary> = [];

  for (const item of value) {
    if (!item || typeof item !== "object") {
      continue;
    }

    const instance: JSONObject = item as JSONObject;

    instances.push({
      instanceId:
        typeof instance["instanceId"] === "string"
          ? instance["instanceId"]
          : "",
      host:
        typeof instance["host"] === "string" && instance["host"]
          ? instance["host"]
          : null,
      userCount:
        typeof instance["userCount"] === "number"
          ? instance["userCount"]
          : null,
      isCountedTowardsUsage:
        typeof instance["isCountedTowardsUsage"] === "boolean"
          ? instance["isCountedTowardsUsage"]
          : undefined,
      lastReportedAt:
        typeof instance["lastReportedAt"] === "string"
          ? instance["lastReportedAt"]
          : null,
      version:
        typeof instance["version"] === "string" && instance["version"]
          ? instance["version"]
          : null,
    });
  }

  return instances;
};

type FormatInstanceReportedAtFunction = (
  lastReportedAt: string | null,
) => string;

const formatInstanceReportedAt: FormatInstanceReportedAtFunction = (
  lastReportedAt: string | null,
): string => {
  if (!lastReportedAt) {
    return "No usage reported yet.";
  }

  const reportedAt: Date = OneUptimeDate.fromString(lastReportedAt);

  if (Number.isNaN(reportedAt.getTime())) {
    return "No usage reported yet.";
  }

  return `Last reported ${reportedAt.toLocaleString()}.`;
};

const LicenseDetails: FunctionComponent<LicenseDetailsProps> = (
  props: LicenseDetailsProps,
): ReactElement => {
  const license: LicenseSnapshot = props.license;

  const canManageLicense: boolean = license.canManageLicense;
  const showLicenseDetails: boolean = license.showLicenseDetails;
  const userLimit: number | null = license.userLimit;
  const currentUserCount: number | null = license.currentUserCount;
  const effectiveUserCount: number | null = license.effectiveUserCount;
  const isSeatLimitEnforced: boolean = license.isSeatLimitEnforced;
  const canAddMoreUsers: boolean = license.canAddMoreUsers;
  const seatTone: SeatTone = license.seatTone;
  const seatUsageDisplayPercent: number | null =
    license.seatUsageDisplayPercent;
  const currentVersion: string = license.currentVersion;
  const latestVersion: string = license.latestVersion;
  const hasComparableVersion: boolean = license.hasComparableVersion;

  /*
   * The fields only these details show, read from the same license GET. The
   * server sends them to a master admin only; anybody else gets none.
   */
  const payload: JSONObject = useMemo(() => {
    return license.payload || {};
  }, [license.payload]);

  /*
   * A license that is a cloud marketplace subscription has no key to refresh:
   * it renews itself with every usage report the marketplace accepts.
   */
  const isMarketplaceLicense: boolean =
    typeof payload["marketplace"] === "string" &&
    payload["marketplace"].length > 0;

  const licenseInstances: Array<EnterpriseLicenseInstanceSummary> =
    useMemo(() => {
      return parseLicenseInstances(payload["instances"]);
    }, [payload]);

  const thisInstanceId: string =
    typeof payload["instanceId"] === "string" ? payload["instanceId"] : "";

  // "online" (a license key) or "offline" (a pasted signed token).
  const activationMode: string =
    typeof payload["activationMode"] === "string"
      ? payload["activationMode"]
      : "";

  /*
   * An installation activated offline, or licensed by a marketplace, has no
   * key to refresh with, so it is not told to refresh.
   */
  const canRefreshLicense: boolean =
    activationMode !== "offline" && !isMarketplaceLicense;

  const userCountUpdatedAtText: string | null = useMemo(() => {
    if (!payload["userCountUpdatedAt"]) {
      return null;
    }

    const reportedAt: Date = OneUptimeDate.fromString(
      payload["userCountUpdatedAt"] as string,
    );

    if (Number.isNaN(reportedAt.getTime())) {
      return null;
    }

    return reportedAt.toLocaleString();
  }, [payload]);

  /*
   * The displayed percent clamped to 0-100. Drives the bar width and
   * aria-valuenow, so the fill can never overflow its track and aria-valuenow
   * can never exceed aria-valuemax. Derived from the displayed percent rather
   * than the raw ratio so the fill always agrees with the caption beneath it:
   * 599/600 reads 99% and fills to 99%, not to a visually full 100%. The true
   * figure for a breach goes in aria-valuetext.
   */
  const seatUsageBarPercent: number = useMemo(() => {
    if (seatUsageDisplayPercent === null) {
      return 0;
    }

    return Math.min(100, Math.max(0, seatUsageDisplayPercent));
  }, [seatUsageDisplayPercent]);

  const seatsRemaining: number | null = useMemo(() => {
    if (typeof userLimit !== "number" || userLimit <= 0) {
      return null;
    }

    if (typeof effectiveUserCount !== "number") {
      return null;
    }

    return userLimit - effectiveUserCount;
  }, [userLimit, effectiveUserCount]);

  const seatsRemainingText: string = useMemo(() => {
    if (typeof seatsRemaining !== "number") {
      return "";
    }

    if (seatsRemaining > 0) {
      return `${seatsRemaining.toLocaleString()} ${
        seatsRemaining === 1 ? "seat" : "seats"
      } remaining`;
    }

    if (seatsRemaining === 0) {
      return "No seats remaining";
    }

    return `${Math.abs(seatsRemaining).toLocaleString()} over limit`;
  }, [seatsRemaining]);

  /*
   * Copy containing apostrophes lives in string literals rather than JSX text,
   * because react/no-unescaped-entities is enforced in this repo.
   */
  const seatAdvisoryTitle: string = useMemo(() => {
    if (seatTone === "breached") {
      const over: number = Math.abs(seatsRemaining || 0);

      /*
       * Reachable now that "every seat taken" is a breach in its own right:
       * an installation sitting exactly on its limit is not "0 users over".
       */
      if (over === 0) {
        return "Every licensed seat is in use";
      }

      return over === 1
        ? "1 user over your licensed seats"
        : `${over.toLocaleString()} users over your licensed seats`;
    }

    if (seatTone === "approaching") {
      if (seatsRemaining === 0) {
        return "Every licensed seat is in use";
      }

      return seatsRemaining === 1
        ? "Only 1 seat left on your license"
        : `Only ${(seatsRemaining || 0).toLocaleString()} seats left on your license`;
    }

    return "";
  }, [seatTone, seatsRemaining]);

  const seatAdvisoryBody: string = useMemo(() => {
    const limitText: string = (userLimit || 0).toLocaleString();
    const inUse: string = `${(effectiveUserCount || 0).toLocaleString()} of ${limitText}`;

    if (seatTone === "breached") {
      /*
       * When the limit is being enforced this is no longer advice, it is a
       * description of what the installation is already doing to invitations
       * and signups - so it says so plainly rather than suggesting an upgrade
       * as though adding people were still an option.
       */
      if (isSeatLimitEnforced && !canAddMoreUsers) {
        return `This installation is using ${inUse} licensed seats. New users cannot be invited, signed up or provisioned until a seat is freed up or the license is expanded.`;
      }

      return `This installation is using ${inUse} licensed seats. Expand your license so it covers everyone on the platform.`;
    }

    if (seatTone === "approaching") {
      return `You're using ${inUse} licensed seats. Anyone you add beyond ${limitText} puts this installation over its licensed limit — if more people are joining, it's worth talking to OneUptime about expanding now.`;
    }

    return "";
  }, [
    seatTone,
    effectiveUserCount,
    userLimit,
    isSeatLimitEnforced,
    canAddMoreUsers,
  ]);

  const seatUsageAriaValueText: string = useMemo(() => {
    if (typeof seatUsageDisplayPercent !== "number") {
      return "";
    }

    if (seatTone === "breached") {
      return `${seatUsageDisplayPercent}% of licensed seats in use — ${seatAdvisoryTitle}`;
    }

    if (typeof seatsRemaining === "number") {
      return `${seatUsageDisplayPercent}% of licensed seats in use — ${seatsRemainingText}`;
    }

    return `${seatUsageDisplayPercent}% of licensed seats in use`;
  }, [
    seatUsageDisplayPercent,
    seatTone,
    seatAdvisoryTitle,
    seatsRemaining,
    seatsRemainingText,
  ]);

  /*
   * The per-instance counts only exceed the unique total when someone actually
   * appears on more than one instance, and the component cannot know whether
   * they do — it receives per-instance counts and the unique total separately.
   * So the summation is stated as a possibility, and is dropped entirely when
   * there is no unique total to compare against. It names the unique user count
   * rather than "the total above", which would be ambiguous next to a hero
   * reading "119 / 120 seats".
   */
  const instanceOverlapText: string = useMemo(() => {
    const countingRule: string = `Seats are counted uniquely across all ${licenseInstances.length} instances that share this license — the same person on multiple instances uses one seat.`;

    if (typeof currentUserCount !== "number") {
      return countingRule;
    }

    return `${countingRule} Per-instance counts can therefore add up to more than the ${currentUserCount.toLocaleString()} unique ${
      currentUserCount === 1 ? "user" : "users"
    } counted above.`;
  }, [licenseInstances.length, currentUserCount]);

  type BuildSeatExpansionMailtoFunction = () => string;

  const buildSeatExpansionMailto: BuildSeatExpansionMailtoFunction =
    (): string => {
      const subject: string =
        seatTone === "breached"
          ? "Expand OneUptime license - over seat limit"
          : "Expand OneUptime license - nearly out of seats";

      const body: string = [
        "Hi OneUptime,",
        "",
        "We would like to expand the seat count on our enterprise license.",
        "",
        `Company: ${license.companyName || "Not specified"}`,
        `Seats in use: ${(effectiveUserCount || 0).toLocaleString()} of ${(
          userLimit || 0
        ).toLocaleString()}`,
        `Instances on this license: ${licenseInstances.length}`,
      ].join("\n");

      return `${SALES_MAILTO_URL}?subject=${encodeURIComponent(
        subject,
      )}&body=${encodeURIComponent(body)}`;
    };

  const handleRequestMoreSeats: () => void = () => {
    if (typeof window !== "undefined") {
      window.location.href = buildSeatExpansionMailto();
    }
  };

  /*
   * The seat and instance cards are built from figures the server gives a
   * master admin only; anybody else would see an empty "unlimited" card. So
   * would a marketplace license, which has no seat limit at all: every user
   * is billed by the hour, and nothing is reported to OneUptime.
   */
  const showSeatDetails: boolean =
    showLicenseDetails && canManageLicense && !isMarketplaceLicense;

  /*
   * GlobalConfigAPI returns userLimit and currentUserCount to anonymous callers
   * because the same route serves the signed-out login page, and gates only
   * licenseKey, token, instances and instanceId on isAuthenticatedUser. Gate
   * the sales ask on a field the server does redact, so a signed-out visitor is
   * never shown an administrator-targeted CTA.
   */
  const canSeeLicenseAdmin: boolean = Boolean(license.licenseKey);

  const usage: ReactElement = (
    <>
                {showSeatDetails && (
                  <section
                    aria-labelledby="edition-seats-heading"
                    className="rounded-xl border border-gray-200 bg-white p-5"
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0">
                        <h4
                          id="edition-seats-heading"
                          className="text-sm font-semibold text-gray-900"
                        >
                          Licensed seats
                        </h4>
                        <p className="mt-0.5 text-xs text-gray-500">
                          Unique users across every instance on this license.
                        </p>
                      </div>
                      {seatTone !== "healthy" && (
                        <span
                          className={`inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                            seatTone === "breached"
                              ? "bg-red-100 text-red-700"
                              : "bg-amber-100 text-amber-800"
                          }`}
                        >
                          {seatTone === "breached"
                            ? "Limit exceeded"
                            : "Nearly full"}
                        </span>
                      )}
                    </div>

                    <div className="mt-4 flex items-end justify-between gap-4">
                      <p className="flex items-baseline gap-1.5">
                        <span
                          className={`text-3xl font-semibold leading-none tabular-nums ${
                            typeof effectiveUserCount !== "number"
                              ? "text-gray-300"
                              : seatTone === "breached"
                                ? "text-red-700"
                                : "text-gray-900"
                          }`}
                        >
                          {typeof effectiveUserCount === "number"
                            ? effectiveUserCount.toLocaleString()
                            : "—"}
                        </span>
                        <span className="text-sm tabular-nums text-gray-500">
                          {" / "}
                          {typeof userLimit === "number" && userLimit > 0
                            ? `${userLimit.toLocaleString()} seats`
                            : "unlimited"}
                        </span>
                      </p>
                      {typeof seatsRemaining === "number" && (
                        <p
                          className={`text-xs font-medium tabular-nums ${
                            seatTone === "breached"
                              ? "text-red-700"
                              : seatTone === "approaching"
                                ? "text-amber-700"
                                : "text-gray-500"
                          }`}
                        >
                          {seatsRemainingText}
                        </p>
                      )}
                    </div>

                    {typeof seatUsageDisplayPercent === "number" && (
                      <div className="mt-2.5">
                        <div
                          className="h-2.5 w-full overflow-hidden rounded-full bg-gray-100"
                          role="progressbar"
                          aria-label="Licensed seat usage"
                          aria-valuenow={seatUsageBarPercent}
                          aria-valuemin={0}
                          aria-valuemax={100}
                          aria-valuetext={seatUsageAriaValueText}
                        >
                          <div
                            className={`h-full rounded-full transition-all duration-300 ease-out ${
                              seatTone === "breached"
                                ? "bg-red-500"
                                : seatTone === "approaching"
                                  ? "bg-amber-500"
                                  : "bg-emerald-500"
                            }`}
                            style={{ width: `${seatUsageBarPercent}%` }}
                          />
                        </div>
                        <p className="mt-1.5 text-xs tabular-nums text-gray-500">
                          {seatUsageDisplayPercent}% of licensed seats in use
                        </p>
                      </div>
                    )}

                    {seatTone !== "healthy" && canSeeLicenseAdmin && (
                      <div
                        role={seatTone === "breached" ? "alert" : "status"}
                        className={`mt-4 rounded-lg border p-3.5 ${
                          seatTone === "breached"
                            ? "border-red-200 bg-red-50"
                            : "border-amber-200 bg-amber-50"
                        }`}
                      >
                        <div className="flex items-start gap-2.5">
                          {/*
                           * Colour comes from className only. Never add a type
                           * prop here: Icon emits both the type colour and
                           * className into one class attribute, so two colour
                           * classes would land on one svg and Tailwind's
                           * emission order would pick the winner.
                           */}
                          <Icon
                            icon={
                              seatTone === "breached"
                                ? IconProp.Alert
                                : IconProp.ExclaimationCircle
                            }
                            className={`mt-0.5 h-4 w-4 shrink-0 ${
                              seatTone === "breached"
                                ? "text-red-600"
                                : "text-amber-600"
                            }`}
                          />
                          <div className="min-w-0 flex-1">
                            <h5
                              className={`text-sm font-semibold ${
                                seatTone === "breached"
                                  ? "text-red-900"
                                  : "text-amber-900"
                              }`}
                            >
                              {seatAdvisoryTitle}
                            </h5>
                            <p
                              className={`mt-1 text-xs leading-relaxed ${
                                seatTone === "breached"
                                  ? "text-red-800"
                                  : "text-amber-800"
                              }`}
                            >
                              {seatAdvisoryBody}
                            </p>
                            <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2">
                              <Button
                                title={
                                  seatTone === "breached"
                                    ? "Expand your license"
                                    : "Request more seats"
                                }
                                icon={IconProp.Email}
                                buttonStyle={
                                  seatTone === "breached"
                                    ? ButtonStyleType.DANGER
                                    : ButtonStyleType.PRIMARY
                                }
                                onClick={handleRequestMoreSeats}
                                className="!mt-0 md:!ml-0"
                              />
                              <span
                                className={`text-[11px] ${
                                  seatTone === "breached"
                                    ? "text-red-700"
                                    : "text-amber-700"
                                }`}
                              >
                                Or email{" "}
                                <a
                                  href={SALES_MAILTO_URL}
                                  className={`font-medium underline ${
                                    seatTone === "breached"
                                      ? "text-red-800 hover:text-red-900"
                                      : "text-amber-900 hover:text-amber-950"
                                  }`}
                                >
                                  {SALES_EMAIL}
                                </a>{" "}
                                directly.
                              </span>
                            </div>
                          </div>
                        </div>
                      </div>
                    )}

                    <div className="mt-4 border-t border-gray-100 pt-3">
                      <p className="text-xs text-gray-500">
                        {activationMode === "offline"
                          ? "This installation was activated offline, so it does not report its user count to OneUptime."
                          : userCountUpdatedAtText
                            ? `Last reported to OneUptime on ${userCountUpdatedAtText}.`
                            : "User count has not been reported to OneUptime yet. The first report will be sent within 24 hours."}
                        {isSeatLimitEnforced && (
                          <>
                            {" "}
                            This installation enforces the seat limit: users
                            above it cannot be invited, signed up or
                            provisioned.
                          </>
                        )}
                        {/*
                         * Only pointed at somebody who can actually do it.
                         * Refreshing is a master admin's, on the license page,
                         * so telling anybody else would be an instruction they
                         * cannot follow. No place in the sentence: the page
                         * has the button, and the dialog leads to the page.
                         */}
                        {isSeatLimitEnforced &&
                          canManageLicense &&
                          canRefreshLicense && (
                            <>
                              {" "}
                              Bought more seats? Refresh the license to apply
                              the new limit without waiting for the next daily
                              report.
                            </>
                          )}
                      </p>
                    </div>
                  </section>
                )}

                {showSeatDetails && licenseInstances.length > 0 && (
                  <section
                    aria-labelledby="edition-instances-heading"
                    className="rounded-xl border border-gray-200 bg-white p-5"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <h4
                        id="edition-instances-heading"
                        className="text-sm font-semibold text-gray-900"
                      >
                        Instances on this license
                      </h4>
                      <span className="shrink-0 rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium tabular-nums text-gray-600">
                        {licenseInstances.length}{" "}
                        {licenseInstances.length === 1
                          ? "instance"
                          : "instances"}
                      </span>
                    </div>
                    <p className="mt-1 text-xs leading-relaxed text-gray-500">
                      Use the same license key on every instance you deploy
                      (staging, production, and so on). Each instance reports
                      its usage and the version it runs once a day.
                    </p>
                    {licenseInstances.length > 1 && (
                      <p className="mt-1.5 text-xs leading-relaxed text-gray-500">
                        {instanceOverlapText}
                      </p>
                    )}
                    <ul className="mt-3 divide-y divide-gray-100 overflow-hidden rounded-lg border border-gray-200">
                      {licenseInstances.map(
                        (
                          instance: EnterpriseLicenseInstanceSummary,
                          index: number,
                        ) => {
                          const isThisInstance: boolean =
                            Boolean(thisInstanceId) &&
                            instance.instanceId === thisInstanceId;

                          /*
                           * The list is a snapshot of what each instance last
                           * reported, refreshed at most once a day. For the
                           * instance serving this page the server just told us
                           * what it is running right now, so prefer that —
                           * otherwise this row contradicts the "This
                           * installation" card above it for up to a day after
                           * an upgrade. hasComparableVersion keeps a dev build
                           * from rendering "vunknown".
                           */
                          const displayVersion: string | null =
                            isThisInstance && hasComparableVersion
                              ? currentVersion
                              : instance.version;

                          /*
                           * Per-instance, so an admin can see which of their
                           * deployments are lagging rather than only the one
                           * they happen to be signed in to.
                           */
                          const isInstanceOutdated: boolean =
                            VersionUtil.isUpdateAvailable({
                              currentVersion: displayVersion,
                              latestVersion: latestVersion,
                            });

                          return (
                            <li
                              key={instance.instanceId || index}
                              className="flex items-center justify-between gap-4 bg-white px-3 py-2.5 transition-colors hover:bg-gray-50"
                            >
                              <div className="min-w-0 flex-1">
                                {/*
                                 * Wraps rather than squeezing: both pills are
                                 * shrink-0, so without this a long hostname on
                                 * a narrow modal absorbs all the overflow and
                                 * truncates to a few characters.
                                 */}
                                <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                                  <span
                                    className="min-w-0 max-w-full truncate text-sm font-medium text-gray-900"
                                    title={instance.host || "Unknown host"}
                                  >
                                    {instance.host || "Unknown host"}
                                  </span>
                                  {isThisInstance && (
                                    <span className="shrink-0 rounded-full bg-indigo-50 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-indigo-700">
                                      This instance
                                    </span>
                                  )}
                                  {displayVersion && (
                                    <span
                                      className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium tabular-nums ${
                                        isInstanceOutdated
                                          ? "bg-amber-50 text-amber-800"
                                          : "bg-gray-100 text-gray-600"
                                      }`}
                                      title={
                                        isInstanceOutdated
                                          ? `Running v${displayVersion}. OneUptime v${latestVersion} is available.`
                                          : `Running v${displayVersion}.`
                                      }
                                    >
                                      v{displayVersion}
                                    </span>
                                  )}
                                </div>
                                <p className="mt-0.5 truncate text-xs text-gray-500">
                                  {formatInstanceReportedAt(
                                    instance.lastReportedAt,
                                  )}
                                  {isInstanceOutdated
                                    ? " Update available."
                                    : ""}
                                </p>
                              </div>
                              <div className="flex shrink-0 items-baseline justify-end gap-1">
                                {typeof instance.userCount === "number" ? (
                                  <>
                                    <span className="text-sm font-medium tabular-nums text-gray-900">
                                      {instance.userCount.toLocaleString()}
                                    </span>
                                    <span className="text-xs text-gray-500">
                                      {instance.userCount === 1
                                        ? "user"
                                        : "users"}
                                    </span>
                                  </>
                                ) : (
                                  <span className="text-sm text-gray-400">
                                    —
                                  </span>
                                )}
                              </div>
                            </li>
                          );
                        },
                      )}
                    </ul>
                  </section>
                )}
    </>
  );

  return usage;
};

export default LicenseDetails;

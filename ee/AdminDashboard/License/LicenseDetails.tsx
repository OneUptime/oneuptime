import {
  LicenseDetailsProps,
  LicenseSnapshot,
} from "Common/UI/Components/EditionLabel/LicenseDetails";
import { SeatTone } from "Common/UI/Components/EditionLabel/LicenseSeatUsage";
import Button, { ButtonStyleType } from "Common/UI/Components/Button/Button";
import { joinSentences } from "Common/UI/Components/DeleteConfirmation/DeleteConsequences";
import Icon from "Common/UI/Components/Icon/Icon";
import { getIsolatedLine } from "Common/UI/Components/IsolatedText/IsolatedLine";
import TranslatedSentence from "Common/UI/Components/TranslatedSentence/TranslatedSentence";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import OneUptimeDate from "Common/Types/Date";
import EnterpriseLicenseInstanceSummary from "Common/Types/EnterpriseLicense/EnterpriseLicenseInstanceSummary";
import IconProp from "Common/Types/Icon/IconProp";
import { JSONObject } from "Common/Types/JSON";
import { ReadingDirection } from "Common/Types/ReadingDirection";
import VersionUtil from "Common/Utils/VersionUtil";
import React, { FunctionComponent, ReactElement, useMemo } from "react";
import {
  FIRST_REPORT_WITHIN,
  FIRST_REPORT_WITHIN_HOURS,
  INSTANCES,
  LicenseDetailsCopy,
  PER_INSTANCE_COUNTS,
  SEAT_LIMIT,
  SEATS_COUNTED_UNIQUELY,
  SEATS_LEFT,
  SEATS_REMAINING,
  USERS_OVER_LICENSED_SEATS,
  USERS_OVER_LIMIT,
} from "./LicenseDetailsCopy";

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
 *
 * In the reader's language, as the dialog around it is: every word is in
 * ./LicenseDetailsCopy.ts, numbers and dates are written the reader's way,
 * and a host name reads the way it is written on an Arabic or Persian page.
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

type FormatReportedAtFunction = (value: unknown) => string | null;

/*
 * A report's time in the reader's language, or null when there is none:
 * "Nov 11, 12:00 PM", "11. Nov., 12:00", with the year only when it is not
 * this one - as every list writes a moment (OneUptimeDate's compact local
 * string), in the zone and the 12- or 24-hour clock the reader picked. It
 * was the browser's toLocaleString: the browser's zone rather than the
 * reader's, seconds nobody needs, a numeric date beside the page's "31 May
 * 2027", and a Latin comma inside a Persian sentence.
 */
const formatReportedAt: FormatReportedAtFunction = (
  value: unknown,
): string | null => {
  if (!value || typeof value !== "string") {
    return null;
  }

  const reportedAt: Date = OneUptimeDate.fromString(value);

  if (Number.isNaN(reportedAt.getTime())) {
    return null;
  }

  return OneUptimeDate.getDateAsCompactLocalString(reportedAt);
};

/*
 * A sentence that ends with a time whose half of the day is written with a
 * dot of its own - Persian "۱۲:۰۰ ب.ظ.", Spanish "12:00 p. m." - ends with
 * one full stop, not two.
 */
const DOUBLE_FULL_STOP_AT_THE_END: RegExp = /\.\.$/;

type EndWithOneFullStopFunction = (sentence: string) => string;

const endWithOneFullStop: EndWithOneFullStopFunction = (
  sentence: string,
): string => {
  return sentence.replace(DOUBLE_FULL_STOP_AT_THE_END, ".");
};

type FormatInstanceReportedAtFunction = (
  lastReportedAt: string | null,
  translator: Translator,
) => string;

const formatInstanceReportedAt: FormatInstanceReportedAtFunction = (
  lastReportedAt: string | null,
  translator: Translator,
): string => {
  const date: string | null = formatReportedAt(lastReportedAt);

  if (!date) {
    return translator.translateTemplate(LicenseDetailsCopy.noUsageReported);
  }

  return endWithOneFullStop(
    translator.translateTemplate(LicenseDetailsCopy.lastReported, {
      date: date,
    }),
  );
};

const LicenseDetails: FunctionComponent<LicenseDetailsProps> = (
  props: LicenseDetailsProps,
): ReactElement => {
  const translator: Translator = useTranslator();
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

  const userCountUpdatedAtText: string | null = formatReportedAt(
    payload["userCountUpdatedAt"],
  );

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
      return translator.translatePlural(SEATS_REMAINING, seatsRemaining);
    }

    if (seatsRemaining === 0) {
      return translator.translateTemplate(LicenseDetailsCopy.noSeatsRemaining);
    }

    return translator.translatePlural(
      USERS_OVER_LIMIT,
      Math.abs(seatsRemaining),
    );
  }, [seatsRemaining, translator]);

  const seatAdvisoryTitle: string = useMemo(() => {
    if (seatTone === "breached") {
      const over: number = Math.abs(seatsRemaining || 0);

      /*
       * Reachable now that "every seat taken" is a breach in its own right:
       * an installation sitting exactly on its limit is not "0 users over".
       */
      if (over === 0) {
        return translator.translateTemplate(LicenseDetailsCopy.everySeatInUse);
      }

      return translator.translatePlural(USERS_OVER_LICENSED_SEATS, over);
    }

    if (seatTone === "approaching") {
      if (seatsRemaining === 0) {
        return translator.translateTemplate(LicenseDetailsCopy.everySeatInUse);
      }

      return translator.translatePlural(SEATS_LEFT, seatsRemaining || 0);
    }

    return "";
  }, [seatTone, seatsRemaining, translator]);

  const seatAdvisoryBody: string = useMemo(() => {
    const seats: { used: string; limit: string } = {
      used: translator.formatNumber(effectiveUserCount || 0),
      limit: translator.formatNumber(userLimit || 0),
    };

    if (seatTone === "breached") {
      /*
       * When the limit is being enforced this is no longer advice, it is a
       * description of what the installation is already doing to invitations
       * and signups - so it says so plainly rather than suggesting an upgrade
       * as though adding people were still an option.
       */
      if (isSeatLimitEnforced && !canAddMoreUsers) {
        return translator.translateTemplate(
          LicenseDetailsCopy.overLimitEnforced,
          seats,
        );
      }

      return translator.translateTemplate(LicenseDetailsCopy.overLimit, seats);
    }

    if (seatTone === "approaching") {
      return translator.translateTemplate(
        LicenseDetailsCopy.nearlyOutOfSeats,
        seats,
      );
    }

    return "";
  }, [
    seatTone,
    effectiveUserCount,
    userLimit,
    isSeatLimitEnforced,
    canAddMoreUsers,
    translator,
  ]);

  const seatsInUseText: string =
    typeof seatUsageDisplayPercent === "number"
      ? translator.translateTemplate(LicenseDetailsCopy.seatsInUsePercent, {
          percent: translator.formatNumber(seatUsageDisplayPercent),
        })
      : "";

  // The caption under the bar, then what the reader most needs to know.
  const seatUsageAriaValueText: string = useMemo(() => {
    if (!seatsInUseText) {
      return "";
    }

    if (seatTone === "breached") {
      return `${seatsInUseText} — ${seatAdvisoryTitle}`;
    }

    if (typeof seatsRemaining === "number") {
      return `${seatsInUseText} — ${seatsRemainingText}`;
    }

    return seatsInUseText;
  }, [
    seatsInUseText,
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
    return joinSentences([
      translator.translatePlural(
        SEATS_COUNTED_UNIQUELY,
        licenseInstances.length,
      ),
      typeof currentUserCount === "number"
        ? translator.translatePlural(PER_INSTANCE_COUNTS, currentUserCount)
        : "",
    ]);
  }, [licenseInstances.length, currentUserCount, translator]);

  // Under the seat card: where the count comes from, and what the limit does.
  const seatReportText: string = joinSentences([
    activationMode === "offline"
      ? translator.translateTemplate(LicenseDetailsCopy.activatedOffline)
      : userCountUpdatedAtText
        ? endWithOneFullStop(
            translator.translateTemplate(
              LicenseDetailsCopy.lastReportedToOneUptime,
              { date: userCountUpdatedAtText },
            ),
          )
        : translator.translatePlural(
            FIRST_REPORT_WITHIN,
            FIRST_REPORT_WITHIN_HOURS,
          ),
    isSeatLimitEnforced
      ? translator.translateTemplate(LicenseDetailsCopy.enforcesSeatLimit)
      : "",
    /*
     * Only pointed at somebody who can actually do it. Refreshing is a
     * master admin's, on the license page, so telling anybody else would be
     * an instruction they cannot follow. No place in the sentence: the page
     * has the button, and the dialog leads to the page.
     */
    isSeatLimitEnforced && canManageLicense && canRefreshLicense
      ? translator.translateTemplate(LicenseDetailsCopy.boughtMoreSeats)
      : "",
  ]);

  type BuildSeatExpansionMailtoFunction = () => string;

  /*
   * The email is to OneUptime's sales team, so it is in English whatever
   * language the dialog is in.
   */
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
                {translator.translateText(LicenseDetailsCopy.seatsTitle)}
              </h4>
              <p className="mt-0.5 text-xs text-gray-500">
                {translator.translateText(LicenseDetailsCopy.seatsDescription)}
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
                {translator.translateText(
                  seatTone === "breached"
                    ? LicenseDetailsCopy.limitExceeded
                    : LicenseDetailsCopy.nearlyFull,
                )}
              </span>
            )}
          </div>

          {/*
           * Wraps rather than overflowing: "37 / 50 Plätze" and "3 Plätze
           * frei" are longer than the English, and a narrow dialog puts the
           * seats left under the seats in use.
           */}
          <div className="mt-4 flex flex-wrap items-end justify-between gap-x-4 gap-y-1">
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
                  ? translator.formatNumber(effectiveUserCount)
                  : "—"}
              </span>
              <span className="text-sm tabular-nums text-gray-500">
                {typeof userLimit === "number" && userLimit > 0
                  ? translator.translatePlural(SEAT_LIMIT, userLimit)
                  : translator.translateText(LicenseDetailsCopy.unlimited)}
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
                aria-label={translator.translateText(
                  LicenseDetailsCopy.seatUsageLabel,
                )}
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
                {seatsInUseText}
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
                    seatTone === "breached" ? "text-red-600" : "text-amber-600"
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
                    {/* Button says its title in the reader's language. */}
                    <Button
                      title={
                        seatTone === "breached"
                          ? LicenseDetailsCopy.expandLicense
                          : LicenseDetailsCopy.requestMoreSeats
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
                      <TranslatedSentence
                        template={LicenseDetailsCopy.orEmailDirectly}
                        slots={{
                          email: (
                            <a
                              href={SALES_MAILTO_URL}
                              className={`font-medium underline ${
                                seatTone === "breached"
                                  ? "text-red-800 hover:text-red-900"
                                  : "text-amber-900 hover:text-amber-950"
                              }`}
                            >
                              {SALES_EMAIL}
                            </a>
                          ),
                        }}
                      />
                    </span>
                  </div>
                </div>
              </div>
            </div>
          )}

          <div className="mt-4 border-t border-gray-100 pt-3">
            <p className="text-xs text-gray-500">{seatReportText}</p>
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
              {translator.translateText(LicenseDetailsCopy.instancesTitle)}
            </h4>
            <span className="shrink-0 rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium tabular-nums text-gray-600">
              {translator.translatePlural(INSTANCES, licenseInstances.length)}
            </span>
          </div>
          <p className="mt-1 text-xs leading-relaxed text-gray-500">
            {translator.translateText(LicenseDetailsCopy.instancesDescription)}
          </p>
          {licenseInstances.length > 1 && (
            <p className="mt-1.5 text-xs leading-relaxed text-gray-500">
              {instanceOverlapText}
            </p>
          )}
          <ul className="mt-3 divide-y divide-gray-100 overflow-hidden rounded-lg border border-gray-200">
            {licenseInstances.map(
              (instance: EnterpriseLicenseInstanceSummary, index: number) => {
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

                const host: string =
                  instance.host ||
                  translator.translateTemplate(LicenseDetailsCopy.unknownHost);

                /*
                 * A host name reads the way it is written: on an Arabic or
                 * Persian page it is cut short at its own end
                 * ("staging.example...") rather than losing its start.
                 */
                const hostLine: {
                  dir: ReadingDirection | undefined;
                  className: string;
                } = getIsolatedLine({
                  text: host,
                  pageLanguage: translator.language,
                  className:
                    "min-w-0 max-w-full truncate text-sm font-medium text-gray-900",
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
                          className={hostLine.className}
                          dir={hostLine.dir}
                          title={host}
                        >
                          {host}
                        </span>
                        {isThisInstance && (
                          <span className="shrink-0 rounded-full bg-indigo-50 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-indigo-700">
                            {translator.translateText(
                              LicenseDetailsCopy.thisInstance,
                            )}
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
                                ? translator.translateTemplate(
                                    LicenseDetailsCopy.runningUpdateAvailable,
                                    {
                                      version: displayVersion,
                                      latest: latestVersion,
                                    },
                                  )
                                : translator.translateTemplate(
                                    LicenseDetailsCopy.running,
                                    { version: displayVersion },
                                  )
                            }
                          >
                            v{displayVersion}
                          </span>
                        )}
                      </div>
                      <p className="mt-0.5 truncate text-xs text-gray-500">
                        {joinSentences([
                          formatInstanceReportedAt(
                            instance.lastReportedAt,
                            translator,
                          ),
                          isInstanceOutdated
                            ? translator.translateTemplate(
                                LicenseDetailsCopy.updateAvailable,
                              )
                            : "",
                        ])}
                      </p>
                    </div>
                    {/*
                     * The count bolder than its label, where the reader's
                     * language puts it ("Users: 7", "Пользователей: 7").
                     */}
                    <div className="flex shrink-0 items-baseline justify-end gap-1">
                      {typeof instance.userCount === "number" ? (
                        <TranslatedSentence
                          template={LicenseDetailsCopy.instanceUsers}
                          slots={{
                            count: (
                              <span className="text-sm font-medium tabular-nums text-gray-900">
                                {translator.formatNumber(instance.userCount)}
                              </span>
                            ),
                          }}
                          renderText={(text: string): ReactElement => {
                            return (
                              <span className="text-xs text-gray-500">
                                {text}
                              </span>
                            );
                          }}
                        />
                      ) : (
                        <span className="text-sm text-gray-400">—</span>
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

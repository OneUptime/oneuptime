import Modal, { ModalWidth } from "../Modal/Modal";
import Icon from "../Icon/Icon";
import IconProp from "../../../Types/Icon/IconProp";
import Button, { ButtonStyleType } from "../Button/Button";
import {
  LicenseManagerComponent,
  LicenseManagerDialogParts,
  LicenseSnapshot,
  SeatTone,
} from "./LicenseManager";
import React, {
  FunctionComponent,
  ReactElement,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import GlobalConfig from "../../../Models/DatabaseModels/GlobalConfig";
import API from "../../Utils/API/API";
import OneUptimeDate from "../../../Types/Date";
import HTTPMethod from "../../../Types/API/HTTPMethod";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import Route from "../../../Types/API/Route";
import URL from "../../../Types/API/URL";
import { JSONObject } from "../../../Types/JSON";
import {
  APP_API_URL,
  BILLING_ENABLED,
  IS_ENTERPRISE_EDITION,
  env,
} from "../../Config";
import VersionUtil from "../../../Utils/VersionUtil";
import {
  ENTERPRISE_LICENSE_GRACE_PERIOD_IN_DAYS,
  ENTERPRISE_LICENSE_TRIAL_PERIOD_IN_DAYS,
} from "../../../Types/EnterpriseLicense/EnterpriseLicensePeriods";
import UserUtil from "../../Utils/User";

/*
 * The edition pill and its dialog. This component only READS the license
 * (GET /global-config/license): the pill, the status notices and the version
 * card. Activating, refreshing and replacing a license, and the seat usage and
 * instance tables, are the Enterprise Edition's license manager (see
 * ./LicenseManager.ts), which the Dashboard and the Admin Dashboard pass in.
 */
export interface ComponentProps {
  className?: string | undefined;
  /*
   * The Enterprise plugin's LicenseManager, read from the plugin door inside
   * the caller's render (never at module load). Undefined in the Community
   * Edition and on the login page: the dialog then shows the license status
   * only.
   */
  licenseManager?: LicenseManagerComponent | undefined;
}

const ENTERPRISE_URL: string = "https://oneuptime.com/enterprise/demo";

/*
 * Linked only for major upgrades. Points at the oneuptime.com docs rather than
 * the docs site on this installation, because the guide for the version you are
 * moving TO is the one you need, and this installation only ships the guide for
 * the version it is already running. The oneuptime.com docs always carry the
 * latest release, and unlike a GitHub file link this URL does not break when
 * the docs move in the repository.
 */
const UPGRADE_GUIDE_URL: string =
  "https://oneuptime.com/docs/installation/upgrading";
const SALES_MAILTO_URL: string = "mailto:sales@oneuptime.com";

const DAY_IN_MS: number = 24 * 60 * 60 * 1000;

/*
 * What stops when the license lapses, in one sentence set, so every notice in
 * the dialog says it the same way. It has to be said plainly and before it
 * happens: after the trial or the grace period, single sign-on (SAML and
 * OIDC) and SCIM provisioning stop, "Require SSO" is no longer enforced (so
 * nobody is locked out: users sign in with their password), and audit logging
 * stops recording - the Community Edition's behaviour - until a license is
 * activated, when everything resumes without a restart. Core monitoring is
 * never touched.
 */
export const LICENSE_LAPSE_CONSEQUENCES: string =
  'single sign-on (SAML and OIDC) stops and "Require SSO" is no longer enforced, so users sign in with their password; SCIM provisioning stops; audit logging stops recording; enterprise configuration becomes read-only; and the enterprise admin dashboards are locked. Everything resumes as soon as a license is activated, and core monitoring is never affected.';

/*
 * The two periods have different names and different lengths: an unlicensed
 * installation's first ENTERPRISE_LICENSE_TRIAL_PERIOD_IN_DAYS days are its
 * trial, and only a license that expired has a grace period
 * (ENTERPRISE_LICENSE_GRACE_PERIOD_IN_DAYS days after its expiry). The
 * numbers come from the constants the license classifier uses.
 */
export const TRIAL_ENFORCEMENT_SUMMARY: string = `Without a valid license (after the ${ENTERPRISE_LICENSE_TRIAL_PERIOD_IN_DAYS}-day trial), ${LICENSE_LAPSE_CONSEQUENCES}`;

export const GRACE_ENFORCEMENT_SUMMARY: string = `Without a valid license (after the ${ENTERPRISE_LICENSE_GRACE_PERIOD_IN_DAYS}-day grace period), ${LICENSE_LAPSE_CONSEQUENCES}`;

/*
 * What has stopped once the license lapsed (expired past its grace period,
 * missing after the trial, or invalid), after the reason the notice gives.
 */
export const LICENSE_LAPSED_STATE: string =
  'Single sign-on (SAML and OIDC) and SCIM provisioning are off: "Require SSO" is not enforced, so users sign in with their password, and your identity provider\'s SCIM requests are refused. Audit logging is not recording. Enterprise configuration is read-only and the enterprise admin dashboards are locked. Everything resumes, without a restart, as soon as a valid license is added, and core monitoring is never affected.';

type LicenseStatus = "valid" | "grace" | "expired" | "missing" | "invalid";

type ParseLicenseStatusFunction = (value: unknown) => LicenseStatus | null;

const parseLicenseStatus: ParseLicenseStatusFunction = (
  value: unknown,
): LicenseStatus | null => {
  if (
    value === "valid" ||
    value === "grace" ||
    value === "expired" ||
    value === "missing" ||
    value === "invalid"
  ) {
    return value;
  }

  return null;
};

/*
 * Seat usage at or above this percent asks the admin to talk to OneUptime about
 * expanding. Matches CRITICAL_CAPACITY_PERCENT in
 * App/FeatureSet/Workers/Jobs/InstanceHealth/EvaluateClickhouseCapacity.ts.
 */
const SEAT_WARNING_PERCENT: number = 90;

type PillTone = "normal" | "warning" | "alerted";

const EditionLabel: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [isDialogOpen, setIsDialogOpen] = useState<boolean>(false);
  const [globalConfig, setGlobalConfig] = useState<GlobalConfig | null>(null);
  /*
   * The last successful license GET, as the server sent it. Handed to the
   * license manager, which reads its own fields (the instances, the
   * activation mode) from it.
   */
  const [licensePayload, setLicensePayload] = useState<JSONObject | null>(null);
  const [isConfigLoading, setIsConfigLoading] = useState<boolean>(false);
  const [configError, setConfigError] = useState<string>("");
  /*
   * The seat limit as this installation actually enforces it, rather than as
   * oneuptime.com last reported it. The server computes it from the live User
   * table, so it knows about everybody added since the last daily report -
   * including the person whose invitation is about to be refused.
   *
   * Only returned to a signed-in caller, so all four stay at their "nothing to
   * say" values on the login page.
   */
  const [isSeatLimitEnforced, setIsSeatLimitEnforced] =
    useState<boolean>(false);
  const [enforcedSeatsInUse, setEnforcedSeatsInUse] = useState<number | null>(
    null,
  );
  const [canAddMoreUsers, setCanAddMoreUsers] = useState<boolean>(true);
  /*
   * Version state comes from the server rather than APP_VERSION in the
   * browser bundle: the frontend env var is empty in every build that was
   * not produced by the release pipeline, which would silently render a
   * blank version instead of an honest one.
   */
  const [currentVersion, setCurrentVersion] = useState<string>("");
  const [latestVersion, setLatestVersion] = useState<string>("");
  const [latestVersionPublishedAt, setLatestVersionPublishedAt] =
    useState<string>("");
  const [latestVersionCheckedAt, setLatestVersionCheckedAt] =
    useState<string>("");
  const [isUpdateAvailable, setIsUpdateAvailable] = useState<boolean>(false);
  const [isUpdateCheckDisabled, setIsUpdateCheckDisabled] =
    useState<boolean>(false);
  /*
   * True when the validated license was issued for evaluation/testing rather
   * than production. Purely informational — it drives the evaluation notice in
   * the modal and a small tag on the pill, and never gates any functionality.
   */
  const [isEvaluationLicense, setIsEvaluationLicense] =
    useState<boolean>(false);
  /*
   * Validity as computed by the server. The server redacts the license
   * token for signed-out visitors (e.g. on the login page), so the client
   * cannot always derive validity from the token itself.
   */
  const [serverLicenseValid, setServerLicenseValid] = useState<boolean | null>(
    null,
  );
  /*
   * Where the license stands, as the Enterprise license client classified it:
   * valid, grace (an expired license's grace period, or an unlicensed
   * installation's trial counted from its first run), expired, missing or
   * invalid - and whether it could be verified offline.
   */
  const [licenseStatus, setLicenseStatus] = useState<LicenseStatus | null>(
    null,
  );
  const [licenseVerification, setLicenseVerification] = useState<string>("");
  const [graceReason, setGraceReason] = useState<string>("");
  const [graceEndsAt, setGraceEndsAt] = useState<string>("");
  // Why the license is not valid, when the server says (master admins only).
  const [licenseMessage, setLicenseMessage] = useState<string>("");

  const isMasterAdmin: boolean = useMemo(() => {
    return Boolean(UserUtil.isMasterAdmin());
  }, []);

  /*
   * The Enterprise Edition's license manager, when the caller passed one (the
   * Dashboard and the Admin Dashboard of the Enterprise image do). Never on
   * the Community Edition, whatever the bundle holds: there is no license to
   * manage there.
   */
  const LicenseManager: LicenseManagerComponent | undefined =
    IS_ENTERPRISE_EDITION ? props.licenseManager : undefined;

  /*
   * Activating, replacing and refreshing the license are master-admin actions:
   * the license is instance-wide, and its seat limit is what UserService
   * enforces against, so being able to rewrite it is being able to raise the
   * ceiling on the whole installation. The server enforces this
   * (MasterAdminAuthorization on both POSTs, and it answers everybody else
   * with the edition pill's fields only); hiding the controls just stops
   * everyone else being offered a button that can only fail.
   *
   * It also takes a license manager to manage the license with. The login
   * page (where a signed-out visitor sees the same pill) and a Community
   * build pass none, and telling somebody to "add a license below" there
   * would point at nothing.
   */
  const canManageLicense: boolean = isMasterAdmin && Boolean(LicenseManager);

  /*
   * The server says it was asked for the Enterprise Edition
   * (IS_ENTERPRISE_EDITION=true) but runs the Community Edition image, which
   * has no enterprise code. Only a master admin can fix that, so only a
   * master admin is told.
   */
  const showEditionMismatchNotice: boolean =
    !IS_ENTERPRISE_EDITION &&
    isMasterAdmin &&
    env("ENTERPRISE_EDITION_REQUESTED_BUT_NOT_LOADED") === "true";

  /*
   * The license GET and the license manager's writes answer with the same
   * seat fields, so every response is unpacked in one place (the manager
   * calls this through applySeatEnforcement).
   * isSeatLimitEnforced is what tells "this installation does not enforce a
   * seat limit" apart from "this build did not report one" - without it, an
   * older server's silence would read as a limit of zero.
   */
  const applySeatEnforcementPayload: (payload: JSONObject) => void =
    useCallback((payload: JSONObject): void => {
      setIsSeatLimitEnforced(payload["isSeatLimitEnforced"] === true);
      setEnforcedSeatsInUse(
        typeof payload["seatsInUse"] === "number"
          ? (payload["seatsInUse"] as number)
          : null,
      );
      /*
       * Defaults to true, so a build or a response that says nothing about
       * enforcement never renders a "you cannot add users" warning it has no
       * evidence for.
       */
      setCanAddMoreUsers(payload["canAddMoreUsers"] !== false);
    }, []);

  /*
   * Runs on Community Edition too. The license half of the response is empty
   * there, but the version and update-check half is not — a community
   * installation still wants to be told a newer OneUptime has been released.
   */
  const fetchGlobalConfig: () => Promise<void> =
    useCallback(async (): Promise<void> => {
      setIsConfigLoading(true);
      setConfigError("");

      try {
        const licenseUrl: URL = URL.fromURL(APP_API_URL).addRoute(
          new Route("/global-config/license"),
        );

        /*
         * The route also serves the login page, so on its own it answers a
         * caller with no session with the reduced anonymous payload and a 200.
         * Inside a signed-in app that caller is us with an expired session,
         * and the reduced payload reads as "no license, no instances". Saying
         * we expect to be signed in makes the server answer 401 instead,
         * which the API client refreshes and replays.
         */
        if (UserUtil.isLoggedIn()) {
          licenseUrl.addQueryParam("signedIn", "true");
        }

        const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
          await API.fetch<JSONObject>({
            method: HTTPMethod.GET,
            url: licenseUrl,
          });

        if (!response.isSuccess()) {
          throw response;
        }

        const payload: JSONObject = response.data as JSONObject;

        const configModel: GlobalConfig = new GlobalConfig();

        if (payload["companyName"]) {
          configModel.enterpriseCompanyName = payload["companyName"] as string;
        }

        if (payload["licenseKey"]) {
          configModel.enterpriseLicenseKey = payload["licenseKey"] as string;
        }

        if (payload["token"]) {
          configModel.enterpriseLicenseToken = payload["token"] as string;
        }

        if (payload["expiresAt"]) {
          configModel.enterpriseLicenseExpiresAt = OneUptimeDate.fromString(
            payload["expiresAt"] as string,
          );
        }

        if (typeof payload["userLimit"] === "number") {
          configModel.enterpriseLicenseUserLimit = payload[
            "userLimit"
          ] as number;
        }

        if (typeof payload["currentUserCount"] === "number") {
          configModel.enterpriseLicenseCurrentUserCount = payload[
            "currentUserCount"
          ] as number;
        }

        setGlobalConfig(configModel);
        setLicensePayload(payload);
        setServerLicenseValid(
          typeof payload["licenseValid"] === "boolean"
            ? payload["licenseValid"]
            : null,
        );
        setIsEvaluationLicense(
          payload["isEvaluation"] === true ||
            payload["isEvaluationLicense"] === true,
        );
        setLicenseStatus(parseLicenseStatus(payload["status"]));
        setLicenseVerification(
          typeof payload["verification"] === "string"
            ? payload["verification"]
            : "",
        );
        setGraceReason(
          typeof payload["graceReason"] === "string"
            ? payload["graceReason"]
            : "",
        );
        setGraceEndsAt(
          typeof payload["graceEndsAt"] === "string"
            ? payload["graceEndsAt"]
            : "",
        );
        setLicenseMessage(
          typeof payload["message"] === "string" ? payload["message"] : "",
        );

        setCurrentVersion(
          typeof payload["currentVersion"] === "string"
            ? payload["currentVersion"]
            : "",
        );
        setLatestVersion(
          typeof payload["latestVersion"] === "string"
            ? payload["latestVersion"]
            : "",
        );
        setLatestVersionPublishedAt(
          typeof payload["latestVersionPublishedAt"] === "string"
            ? payload["latestVersionPublishedAt"]
            : "",
        );
        setLatestVersionCheckedAt(
          typeof payload["latestVersionCheckedAt"] === "string"
            ? payload["latestVersionCheckedAt"]
            : "",
        );
        setIsUpdateAvailable(payload["isUpdateAvailable"] === true);
        setIsUpdateCheckDisabled(payload["isUpdateCheckDisabled"] === true);
        applySeatEnforcementPayload(payload);
      } catch (err) {
        setGlobalConfig(null);
        setLicensePayload(null);
        setServerLicenseValid(null);
        setIsEvaluationLicense(false);
        setLicenseStatus(null);
        setLicenseVerification("");
        setGraceReason("");
        setGraceEndsAt("");
        setLicenseMessage("");
        setCurrentVersion("");
        setLatestVersion("");
        setLatestVersionPublishedAt("");
        setLatestVersionCheckedAt("");
        setIsUpdateAvailable(false);
        setIsUpdateCheckDisabled(false);
        setIsSeatLimitEnforced(false);
        setEnforcedSeatsInUse(null);
        setCanAddMoreUsers(true);
        setConfigError(API.getFriendlyMessage(err));
      } finally {
        setIsConfigLoading(false);
      }
    }, [applySeatEnforcementPayload]);

  /*
   * Only Enterprise Edition needs this on mount — its pill reports license
   * validity and seat pressure, which it cannot know without asking. The
   * community pill is a static label, so it waits until the modal is actually
   * opened rather than adding a request to every page load.
   */
  useEffect(() => {
    if (BILLING_ENABLED || !IS_ENTERPRISE_EDITION) {
      return;
    }

    void fetchGlobalConfig();
  }, [fetchGlobalConfig]);

  const licenseValid: boolean = useMemo(() => {
    if (!IS_ENTERPRISE_EDITION) {
      return false;
    }

    // Prefer the server's verdict (works even when the token is redacted).
    if (serverLicenseValid !== null) {
      return serverLicenseValid;
    }

    if (
      !globalConfig?.enterpriseLicenseToken ||
      !globalConfig.enterpriseLicenseExpiresAt
    ) {
      return false;
    }

    const expiresAt: Date = OneUptimeDate.fromString(
      globalConfig.enterpriseLicenseExpiresAt,
    );

    return expiresAt.getTime() > Date.now();
  }, [
    globalConfig?.enterpriseLicenseExpiresAt,
    globalConfig?.enterpriseLicenseToken,
    serverLicenseValid,
  ]);

  /*
   * Whether a license token IS installed, whatever the license client made of
   * it.
   *
   * It matters because "the unlicensed trial" is no longer only for an
   * installation with no license: one whose token has no expiry recorded
   * beside it falls back to the same trial and the same lapse (the license
   * client's classifyUnverifiedWithoutExpiry), so the copy below must not tell
   * a paying customer that no license is installed.
   *
   * Two signals, because the two audiences are told different things. A master
   * admin is sent the token itself. Everybody else is sent only the
   * verification, and the license client reports "none" there exactly when
   * there was no token to judge - so an "unverified" or "verified" grace
   * period is a grace period with a license behind it. Neither field is new:
   * both already come back from GET /global-config/license.
   */
  const hasLicenseInstalled: boolean =
    IS_ENTERPRISE_EDITION &&
    (Boolean(globalConfig?.enterpriseLicenseToken) ||
      licenseVerification === "unverified" ||
      licenseVerification === "verified");

  /*
   * The two faces of "grace". An unlicensed installation's trial (counted from
   * the first run of the Enterprise Edition) is not an expired license, and
   * the dialog must not tell somebody who never had a license to renew one.
   */
  const isUnlicensedTrial: boolean =
    IS_ENTERPRISE_EDITION &&
    licenseStatus === "grace" &&
    graceReason === "unlicensed";

  const isExpiredGrace: boolean =
    IS_ENTERPRISE_EDITION &&
    licenseStatus === "grace" &&
    graceReason !== "unlicensed";

  /*
   * A license issued before OneUptime signed its licenses: accepted, but it
   * cannot be verified offline.
   */
  const isUnverifiedLegacyLicense: boolean =
    IS_ENTERPRISE_EDITION &&
    licenseValid &&
    !isUnlicensedTrial &&
    licenseVerification === "unverified";

  const graceEndsAtText: string | null = useMemo(() => {
    if (!graceEndsAt) {
      return null;
    }

    const endsAt: Date = OneUptimeDate.fromString(graceEndsAt);

    if (Number.isNaN(endsAt.getTime())) {
      return null;
    }

    return endsAt.toLocaleDateString();
  }, [graceEndsAt]);

  // Whole days left in the trial or the grace period, rounded up; never negative.
  const graceDaysLeft: number | null = useMemo(() => {
    if (!graceEndsAt) {
      return null;
    }

    const endsAt: Date = OneUptimeDate.fromString(graceEndsAt);

    if (Number.isNaN(endsAt.getTime())) {
      return null;
    }

    return Math.max(0, Math.ceil((endsAt.getTime() - Date.now()) / DAY_IN_MS));
  }, [graceEndsAt]);

  const graceDaysLeftText: string =
    graceDaysLeft === null
      ? ""
      : `${graceDaysLeft} ${graceDaysLeft === 1 ? "day" : "days"} left`;

  const licenseExpiresAtText: string | null = useMemo(() => {
    if (!globalConfig?.enterpriseLicenseExpiresAt) {
      return null;
    }

    const expiresAt: Date = OneUptimeDate.fromString(
      globalConfig.enterpriseLicenseExpiresAt,
    );

    if (Number.isNaN(expiresAt.getTime())) {
      return null;
    }

    return expiresAt.toLocaleString();
  }, [globalConfig?.enterpriseLicenseExpiresAt]);

  /*
   * True only for a build that reports a real semantic version. Dev builds and
   * images assembled without APP_VERSION report "unknown", which is worth
   * showing verbatim but must never be compared against a release.
   */
  const hasComparableVersion: boolean = useMemo(() => {
    return VersionUtil.isValid(currentVersion);
  }, [currentVersion]);

  const latestVersionPublishedAtText: string | null = useMemo(() => {
    if (!latestVersionPublishedAt) {
      return null;
    }

    const publishedAt: Date = OneUptimeDate.fromString(
      latestVersionPublishedAt,
    );

    if (Number.isNaN(publishedAt.getTime())) {
      return null;
    }

    return publishedAt.toLocaleDateString();
  }, [latestVersionPublishedAt]);

  const latestVersionCheckedAtText: string | null = useMemo(() => {
    if (!latestVersionCheckedAt) {
      return null;
    }

    const checkedAt: Date = OneUptimeDate.fromString(latestVersionCheckedAt);

    if (Number.isNaN(checkedAt.getTime())) {
      return null;
    }

    return checkedAt.toLocaleString();
  }, [latestVersionCheckedAt]);

  /*
   * Only claim an installation is current once a release has actually been
   * fetched to compare it against — an air-gapped install that has never
   * reached GitHub knows nothing, and saying "up to date" there would be a
   * guess dressed up as a fact.
   */
  const isUpToDate: boolean = useMemo(() => {
    return (
      hasComparableVersion &&
      VersionUtil.isValid(latestVersion) &&
      !isUpdateAvailable
    );
  }, [hasComparableVersion, latestVersion, isUpdateAvailable]);

  /*
   * Computed client-side rather than served, because the same comparison has
   * to run per-instance in the list below, where the server has no single
   * "current version" to compare against.
   */
  const isMajorUpgrade: boolean = useMemo(() => {
    return VersionUtil.isMajorUpgrade({
      currentVersion: currentVersion,
      latestVersion: latestVersion,
    });
  }, [currentVersion, latestVersion]);

  const updateAdvisoryText: string = useMemo(() => {
    const released: string = latestVersionPublishedAtText
      ? `Released on ${latestVersionPublishedAtText}. `
      : "";

    if (isMajorUpgrade) {
      return `${released}Major versions carry breaking changes and have to be applied one at a time, so check the upgrade guide before you start.`;
    }

    return `${released}Upgrading picks up the latest fixes and improvements.`;
  }, [isMajorUpgrade, latestVersionPublishedAtText]);

  /*
   * Null renders no footer at all. Every branch here has to be true of this
   * installation specifically — a line promising a daily check would be a lie
   * on a build that cannot be compared, and a worse one where the check has
   * been turned off.
   */
  const updateFooterText: string | null = useMemo(() => {
    if (isUpdateCheckDisabled) {
      return "Update checks are turned off on this installation (DISABLE_UPDATE_CHECK), so it is not compared against OneUptime releases.";
    }

    if (!hasComparableVersion) {
      return null;
    }

    if (!latestVersionCheckedAtText) {
      return "This installation has not checked for updates yet. It checks OneUptime releases on GitHub once a day.";
    }

    return `Checked for updates on ${latestVersionCheckedAtText}.`;
  }, [isUpdateCheckDisabled, hasComparableVersion, latestVersionCheckedAtText]);

  const userLimit: number | null = useMemo(() => {
    return typeof globalConfig?.enterpriseLicenseUserLimit === "number"
      ? globalConfig.enterpriseLicenseUserLimit
      : null;
  }, [globalConfig?.enterpriseLicenseUserLimit]);

  const currentUserCount: number | null = useMemo(() => {
    return typeof globalConfig?.enterpriseLicenseCurrentUserCount === "number"
      ? globalConfig.enterpriseLicenseCurrentUserCount
      : null;
  }, [globalConfig?.enterpriseLicenseCurrentUserCount]);

  /*
   * The seat figure everything below is measured against.
   *
   * currentUserCount is what oneuptime.com last computed across every instance
   * on this license, which is up to a day old. On an installation that
   * enforces a seat limit the server also sends seatsInUse: the same
   * cross-instance figure reconciled with the live User table here, and the
   * number invitations are actually refused on. Showing anything else would
   * leave the card reading "98 of 100" next to an invitation that had just
   * bounced.
   */
  const effectiveUserCount: number | null = useMemo(() => {
    if (isSeatLimitEnforced && typeof enforcedSeatsInUse === "number") {
      return enforcedSeatsInUse;
    }

    return currentUserCount;
  }, [isSeatLimitEnforced, enforcedSeatsInUse, currentUserCount]);

  const isUserLimitBreached: boolean = useMemo(() => {
    if (!licenseValid) {
      return false;
    }

    if (typeof userLimit !== "number" || userLimit <= 0) {
      return false;
    }

    if (typeof effectiveUserCount !== "number") {
      return false;
    }

    return effectiveUserCount > userLimit;
  }, [licenseValid, userLimit, effectiveUserCount]);

  /*
   * Unclamped and unrounded. The only value that can tell 120/120 apart from
   * 240/120. Null means there is no seat limit to measure against, either
   * because the license is unlimited or because usage has not been reported.
   */
  const rawUserUsagePercent: number | null = useMemo(() => {
    if (typeof userLimit !== "number" || userLimit <= 0) {
      return null;
    }

    if (typeof effectiveUserCount !== "number") {
      return null;
    }

    return Math.max(0, (effectiveUserCount / userLimit) * 100);
  }, [userLimit, effectiveUserCount]);

  /*
   * The percent the admin reads, and the one the warning fires on. May exceed
   * 100 so a breach shows a real figure. Floored to 99 when rounding would
   * claim 100% while a seat is genuinely free, so 599/600 never reads
   * "100% of licensed seats in use" next to "1 seat remaining".
   */
  const seatUsageDisplayPercent: number | null = useMemo(() => {
    if (rawUserUsagePercent === null) {
      return null;
    }

    const rounded: number = Math.round(rawUserUsagePercent);

    if (rounded >= 100 && rawUserUsagePercent < 100) {
      return 99;
    }

    return rounded;
  }, [rawUserUsagePercent]);

  /*
   * Total and mutually exclusive. isUserLimitBreached is tested first, so
   * reaching the >= 90 test structurally guarantees the limit is not exceeded
   * and the amber nudge can never co-fire with the red breach.
   *
   * The test runs on the displayed percent rather than the raw ratio so that
   * the number triggering the warning is the number printed under the bar.
   */
  const seatTone: SeatTone = useMemo(() => {
    if (!licenseValid) {
      return "healthy";
    }

    if (isUserLimitBreached) {
      return "breached";
    }

    /*
     * Exactly at the limit is not over it, but it is the point where the
     * installation starts refusing new users - so it gets the red treatment
     * rather than the amber "nearly full" nudge, which would understate a
     * door that is already shut.
     */
    if (isSeatLimitEnforced && !canAddMoreUsers) {
      return "breached";
    }

    if (
      typeof seatUsageDisplayPercent === "number" &&
      seatUsageDisplayPercent >= SEAT_WARNING_PERCENT
    ) {
      return "approaching";
    }

    return "healthy";
  }, [
    licenseValid,
    isUserLimitBreached,
    isSeatLimitEnforced,
    canAddMoreUsers,
    seatUsageDisplayPercent,
  ]);

  const editionName: string = useMemo(() => {
    if (!IS_ENTERPRISE_EDITION) {
      return "Community Edition";
    }

    if (isConfigLoading) {
      return "Enterprise Edition (Checking...)";
    }

    if (isUnlicensedTrial) {
      return graceDaysLeftText
        ? `Enterprise Edition (Trial, ${graceDaysLeftText})`
        : "Enterprise Edition (Trial)";
    }

    if (isExpiredGrace) {
      return "Enterprise Edition (License Expired, Grace Period)";
    }

    if (licenseValid) {
      return "Enterprise Edition";
    }

    if (licenseStatus === "expired") {
      return "Enterprise Edition (License Expired)";
    }

    if (licenseStatus === "invalid") {
      return "Enterprise Edition (License Invalid)";
    }

    return "Enterprise Edition (License Required)";
  }, [
    isConfigLoading,
    licenseValid,
    licenseStatus,
    isUnlicensedTrial,
    isExpiredGrace,
    graceDaysLeftText,
  ]);

  const indicatorColor: string = useMemo(() => {
    if (!IS_ENTERPRISE_EDITION) {
      return "bg-indigo-400";
    }

    if (isConfigLoading) {
      return "bg-yellow-400";
    }

    if (!licenseValid) {
      return "bg-red-500";
    }

    if (seatTone === "breached") {
      return "bg-red-500";
    }

    if (seatTone === "approaching" || licenseStatus === "grace") {
      return "bg-amber-500";
    }

    return "bg-emerald-500";
  }, [isConfigLoading, licenseValid, seatTone, licenseStatus]);

  const ctaLabel: string = useMemo(() => {
    if (!IS_ENTERPRISE_EDITION) {
      return showEditionMismatchNotice ? "Action needed" : "Learn more";
    }

    if (isConfigLoading) {
      return "Checking";
    }

    if (isUnlicensedTrial) {
      return "Add license";
    }

    if (isExpiredGrace) {
      return "Renew license";
    }

    if (!licenseValid) {
      if (licenseStatus === "expired") {
        return "Renew license";
      }

      if (licenseStatus === "invalid") {
        return "Fix license";
      }

      return "Validate license";
    }

    if (seatTone === "breached") {
      return "User limit exceeded";
    }

    if (seatTone === "approaching") {
      return "Seats nearly full";
    }

    return "View details";
  }, [
    isConfigLoading,
    licenseValid,
    licenseStatus,
    seatTone,
    isUnlicensedTrial,
    isExpiredGrace,
    showEditionMismatchNotice,
  ]);

  const pillTone: PillTone = useMemo(() => {
    if (!IS_ENTERPRISE_EDITION) {
      return showEditionMismatchNotice ? "warning" : "normal";
    }

    if (isConfigLoading) {
      return "normal";
    }

    if (
      seatTone === "breached" ||
      (!licenseValid &&
        (Boolean(globalConfig?.enterpriseLicenseKey) ||
          licenseStatus === "expired" ||
          licenseStatus === "invalid"))
    ) {
      return "alerted";
    }

    if (seatTone === "approaching" || licenseStatus === "grace") {
      return "warning";
    }

    return "normal";
  }, [
    isConfigLoading,
    licenseValid,
    licenseStatus,
    seatTone,
    globalConfig?.enterpriseLicenseKey,
    showEditionMismatchNotice,
  ]);

  const modalDescription: string = useMemo(() => {
    if (!IS_ENTERPRISE_EDITION) {
      return "You are running the free, open-source build of OneUptime.";
    }

    if (isConfigLoading) {
      return "Checking your license with OneUptime...";
    }

    if (isUnlicensedTrial) {
      return "No license is installed yet. Enterprise features are available during the trial.";
    }

    if (isExpiredGrace) {
      return "Your license has expired. Renew it before the grace period ends.";
    }

    if (!licenseValid) {
      return "Add a valid license to turn single sign-on, SCIM and audit logging back on and make enterprise configuration editable.";
    }

    return "License, version, seat usage, and the instances covered by this key.";
  }, [isConfigLoading, licenseValid, isUnlicensedTrial, isExpiredGrace]);

  const communityFeatures: Array<string> = useMemo(() => {
    return [
      "Full OneUptime platform with incident response, status pages, and workflow automation.",
      "Community support, documentation, and tutorials to help teams get started quickly.",
      "Regular updates, bug fixes, and open-source extensibility.",
      "Integrations with popular DevOps tools through community-maintained connectors.",
    ];
  }, []);

  const enterpriseFeatures: Array<string> = useMemo(() => {
    return [
      "Enterprise (hardened and secure) Docker images.",
      "Dedicated enterprise support phone number available 24/7/365.",
      "Priority chat and email support.",
      "Dedicated engineer who can build custom features to integrate OneUptime with your ecosystem.",
      "Compliance reports (ISO, SOC, GDPR, HIPAA).",
      "Legal indemnification.",
      "Audit logs and many more enterprise-focused features.",
    ];
  }, []);

  /*
   * The license manager clears its own messages (and abandons a license
   * change in progress) when the dialog opens or closes.
   */
  const openDialog: () => void = () => {
    setIsDialogOpen(true);

    void fetchGlobalConfig();
  };

  const closeDialog: () => void = () => {
    setIsDialogOpen(false);
  };

  const handlePrimaryAction: () => void = () => {
    if (typeof window !== "undefined") {
      window.open(ENTERPRISE_URL, "_blank", "noopener,noreferrer");
    }

    closeDialog();
  };

  const handleRetryFetch: () => void = () => {
    if (!isConfigLoading) {
      void fetchGlobalConfig();
    }
  };

  /*
   * Someone who cannot fix the license still needs to be told why the
   * installation is behaving like an unlicensed one, and who can fix it.
   */
  const showLicenseAdminRequiredNotice: boolean =
    IS_ENTERPRISE_EDITION &&
    !configError &&
    !isConfigLoading &&
    !licenseValid &&
    !canManageLicense;

  /*
   * Collapses the !configError && !isConfigLoading && licenseValid chain that
   * gates the stat strip here, and the license manager's seat card, instances
   * card and footer actions.
   */
  const showLicenseDetails: boolean =
    IS_ENTERPRISE_EDITION &&
    !configError &&
    !isConfigLoading &&
    licenseValid &&
    !isUnlicensedTrial;

  // Status notices describe the license, so they wait for it to load.
  const showLicenseStatusNotices: boolean =
    IS_ENTERPRISE_EDITION && !configError && !isConfigLoading;

  /*
   * The evaluation notice rides along with the license details: it is only
   * meaningful once there is a valid license to describe, and it sits at the
   * top of the body as the first thing an evaluating customer sees.
   */
  const showEvaluationNotice: boolean =
    showLicenseDetails && isEvaluationLicense;

  /*
   * The pill tag is shown whenever a valid evaluation license is active, so an
   * admin sees "Evaluation" without opening the modal.
   */
  const showEvaluationTag: boolean =
    IS_ENTERPRISE_EDITION && licenseValid && isEvaluationLicense;

  const showEnterpriseFeatureList: boolean =
    IS_ENTERPRISE_EDITION &&
    !configError &&
    !isConfigLoading &&
    (!licenseValid || isUnlicensedTrial);

  /*
   * Gated on neither edition nor licenseValid: which build you run, and
   * whether a newer one exists, is a property of the installation rather than
   * of the license, and is useful precisely when the license needs sorting
   * out. The server returns currentVersion only to a signed-in user, so an
   * anonymous visitor on the login page falls out here.
   */
  const showVersionCard: boolean =
    !configError && !isConfigLoading && Boolean(currentVersion);

  const modalRightElement: ReactElement | undefined = showLicenseDetails ? (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium ${
        seatTone === "breached"
          ? "border-red-200 bg-red-50 text-red-700"
          : seatTone === "approaching"
            ? "border-amber-200 bg-amber-50 text-amber-800"
            : "border-emerald-200 bg-emerald-50 text-emerald-800"
      }`}
    >
      <span
        className={`h-1.5 w-1.5 shrink-0 rounded-full ${
          seatTone === "breached"
            ? "bg-red-500"
            : seatTone === "approaching"
              ? "bg-amber-500"
              : "bg-emerald-500"
        }`}
      />
      {seatTone === "breached"
        ? "Seat limit exceeded"
        : seatTone === "approaching"
          ? "Seats nearly full"
          : isExpiredGrace
            ? "Grace period"
            : "License active"}
    </span>
  ) : undefined;

  const pillClassName: string =
    pillTone === "alerted"
      ? "group inline-flex items-center gap-2 rounded-full border border-red-200 bg-red-50 px-3 py-1 text-xs font-medium text-red-700 shadow-sm transition hover:border-red-300 hover:bg-red-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-400"
      : pillTone === "warning"
        ? "group inline-flex items-center gap-2 rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-medium text-amber-800 shadow-sm transition hover:border-amber-300 hover:bg-amber-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-400"
        : "group inline-flex items-center gap-2 rounded-full border border-indigo-100 bg-white px-3 py-1 text-xs font-medium text-indigo-700 shadow-sm transition hover:border-indigo-300 hover:bg-indigo-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400";

  const pillCtaTextClassName: string =
    pillTone === "alerted"
      ? "text-[11px] text-red-500 group-hover:text-red-600"
      : pillTone === "warning"
        ? "text-[11px] text-amber-600 group-hover:text-amber-700"
        : "text-[11px] text-indigo-500 group-hover:text-indigo-600";

  /*
   * Rendered in both the enterprise and the community branch of the modal:
   * the version and update state belong to the installation, not the license.
   */
  const versionCardElement: ReactElement | null = showVersionCard ? (
    <section
      aria-labelledby="edition-version-heading"
      className={`overflow-hidden rounded-xl border ${
        isUpdateAvailable ? "border-amber-200" : "border-gray-200"
      } bg-white`}
    >
      <div className="flex items-center justify-between gap-4 p-5">
        <div className="min-w-0">
          <h4
            id="edition-version-heading"
            className="text-sm font-semibold text-gray-900"
          >
            This installation
          </h4>
          <p className="mt-1.5 flex items-baseline gap-2">
            <span
              className={`text-2xl font-semibold leading-none tabular-nums ${
                hasComparableVersion ? "text-gray-900" : "text-gray-400"
              }`}
            >
              {hasComparableVersion ? `v${currentVersion}` : currentVersion}
            </span>
          </p>
          {!hasComparableVersion && (
            <p className="mt-1.5 text-xs leading-relaxed text-gray-500">
              This build does not report a version number, so it cannot be
              compared against the latest OneUptime release.
            </p>
          )}
        </div>
        {(isUpdateAvailable || isUpToDate) && (
          <span
            className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${
              isUpdateAvailable
                ? "bg-amber-100 text-amber-800"
                : "bg-emerald-50 text-emerald-700"
            }`}
          >
            {/*
             * Colour comes from className only — see the note on
             * the seat advisory icon below.
             */}
            <Icon
              icon={
                isUpdateAvailable
                  ? IconProp.ArrowCircleUp
                  : IconProp.CheckCircle
              }
              className={`h-3.5 w-3.5 shrink-0 ${
                isUpdateAvailable ? "text-amber-700" : "text-emerald-600"
              }`}
            />
            {isUpdateAvailable ? "Update available" : "Up to date"}
          </span>
        )}
      </div>

      {isUpdateAvailable && (
        <div
          role="status"
          className="border-t border-amber-200 bg-amber-50 px-5 py-4"
        >
          <h5 className="text-sm font-semibold text-amber-900">
            {isMajorUpgrade
              ? `OneUptime v${latestVersion} is a major upgrade`
              : `OneUptime v${latestVersion} is available`}
          </h5>
          <p className="mt-1 text-xs leading-relaxed text-amber-800">
            {updateAdvisoryText}
          </p>
          {/*
           * Only a major upgrade gets a call to action. Minor and patch
           * releases are routine — a button on every one of them trains
           * administrators to dismiss the banner, and there is nothing to read
           * before taking them. A major has breaking changes and must be
           * applied one major at a time, so it earns the interruption.
           */}
          {isMajorUpgrade && (
            <div className="mt-3">
              <a
                href={UPGRADE_GUIDE_URL}
                target="_blank"
                rel="noopener noreferrer"
                /*
                 * Indigo, not amber: the seat advisory directly
                 * below is an amber panel with an indigo primary
                 * button, and two different accent colours for
                 * the same role would read as two conventions.
                 */
                className="inline-flex items-center gap-1.5 rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white shadow-sm transition hover:bg-indigo-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 focus-visible:ring-offset-2"
              >
                Read the upgrade guide
                <Icon
                  icon={IconProp.ExternalLink}
                  className="h-3 w-3 shrink-0 text-white"
                />
              </a>
            </div>
          )}
        </div>
      )}

      {!isUpdateAvailable && updateFooterText && (
        <div className="border-t border-gray-100 px-5 py-3">
          <p className="text-xs text-gray-500">{updateFooterText}</p>
        </div>
      )}
    </section>
  ) : null;

  /*
   * The evaluation notice. Violet rather than amber or red: this is not a
   * warning about something wrong, it is a statement of what the license is
   * for. Amber is spoken for by seat pressure and available updates, so a
   * distinct hue keeps the two from being read as the same kind of message.
   */
  const evaluationNoticeElement: ReactElement | null = showEvaluationNotice ? (
    <section
      aria-labelledby="edition-evaluation-heading"
      className="overflow-hidden rounded-xl border border-violet-200 bg-gradient-to-br from-violet-50 via-white to-white"
    >
      <div className="flex items-start gap-3.5 p-5">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-violet-100 ring-4 ring-violet-50">
          {/*
           * Colour comes from className only — never add a type prop here, for
           * the reason spelled out on the seat advisory icon below.
           */}
          <Icon icon={IconProp.Beaker} className="h-5 w-5 text-violet-600" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h4
              id="edition-evaluation-heading"
              className="text-sm font-semibold text-violet-900"
            >
              Evaluation license
            </h4>
            <span className="inline-flex items-center rounded-full bg-violet-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-violet-700">
              Testing only
            </span>
          </div>
          <p className="mt-1.5 text-xs leading-relaxed text-violet-800">
            This key was issued for evaluation and testing. It is not licensed
            for production use — reach out whenever you are ready to go live and
            we will get a production license sorted for you.
          </p>
          <div className="mt-3">
            <a
              href={`${SALES_MAILTO_URL}?subject=${encodeURIComponent(
                "Moving our OneUptime evaluation to production",
              )}`}
              className="inline-flex items-center gap-1.5 rounded-md bg-violet-600 px-3 py-1.5 text-xs font-medium text-white shadow-sm transition hover:bg-violet-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-400 focus-visible:ring-offset-2"
            >
              <Icon
                icon={IconProp.Email}
                className="h-3 w-3 shrink-0 text-white"
              />
              Talk to sales about production
            </a>
          </div>
        </div>
      </div>
    </section>
  ) : null;

  /*
   * What the license status means for this installation, in plain words.
   * Before the lapse (the trial, the grace period) every branch warns what
   * will stop and when (LICENSE_LAPSE_CONSEQUENCES); after it, what has
   * stopped (LICENSE_LAPSED_STATE).
   */
  const licenseStatusNoticeElement: ReactElement | null = (() => {
    if (!showLicenseStatusNotices) {
      return null;
    }

    if (isUnlicensedTrial) {
      return (
        <section
          role="status"
          data-testid="enterprise-license-trial-notice"
          className="rounded-xl border border-amber-200 bg-amber-50 p-5"
        >
          <h4 className="text-sm font-semibold text-amber-900">
            {graceDaysLeftText
              ? `Enterprise Edition trial: ${graceDaysLeftText}`
              : "Enterprise Edition trial"}
          </h4>
          <p className="mt-1 text-xs leading-relaxed text-amber-800">
            {`${
              hasLicenseInstalled
                ? "A license is installed, but this installation cannot tell whether it is still current, so it is treating this as an unlicensed install."
                : "No Enterprise license is installed."
            } Enterprise features stay fully available${
              graceEndsAtText ? ` until ${graceEndsAtText}` : ""
            }, counted from the first time this installation ran the Enterprise Edition. ${TRIAL_ENFORCEMENT_SUMMARY}`}
          </p>
          {/*
           * What the license client actually said about the installed license.
           * Only a master admin is sent it, and only this state has one to
           * show: a genuinely unlicensed install's message is the sentence
           * above.
           */}
          {hasLicenseInstalled && licenseMessage && (
            <p
              data-testid="enterprise-license-status-message"
              className="mt-2 text-xs leading-relaxed text-amber-800"
            >
              {licenseMessage}
            </p>
          )}
          <p className="mt-2 text-xs leading-relaxed text-amber-800">
            {canManageLicense
              ? hasLicenseInstalled
                ? "Re-activate the license below before the trial ends, or let the daily license sync fetch its expiry from OneUptime, to keep single sign-on, SCIM and audit logging running and enterprise configuration editable."
                : "Add a license below before the trial ends to keep single sign-on, SCIM and audit logging running and enterprise configuration editable."
              : hasLicenseInstalled
                ? "Ask a master admin of this installation to re-activate the license."
                : "Ask a master admin of this installation to add a license."}
          </p>
        </section>
      );
    }

    if (isExpiredGrace) {
      return (
        <section
          role="status"
          data-testid="enterprise-license-grace-notice"
          className="rounded-xl border border-amber-200 bg-amber-50 p-5"
        >
          <h4 className="text-sm font-semibold text-amber-900">
            {graceEndsAtText
              ? `License expired, grace period until ${graceEndsAtText}`
              : "License expired, grace period"}
          </h4>
          <p className="mt-1 text-xs leading-relaxed text-amber-800">
            {`The Enterprise license expired${
              licenseExpiresAtText ? ` on ${licenseExpiresAtText}` : ""
            }. Every enterprise feature keeps working until the grace period ends${
              graceDaysLeftText ? ` (${graceDaysLeftText})` : ""
            }. ${GRACE_ENFORCEMENT_SUMMARY}`}
          </p>
          <p className="mt-2 text-xs leading-relaxed text-amber-800">
            {canManageLicense
              ? "Renew the license with OneUptime, then refresh it here."
              : "Ask a master admin of this installation to renew the license."}
          </p>
        </section>
      );
    }

    if (!licenseValid) {
      const title: string =
        licenseStatus === "expired"
          ? "License expired"
          : licenseStatus === "invalid"
            ? "License not valid"
            : "No valid license";

      const reason: string =
        licenseStatus === "expired"
          ? `The Enterprise license expired${
              licenseExpiresAtText ? ` on ${licenseExpiresAtText}` : ""
            } and its grace period is over.`
          : licenseStatus === "invalid"
            ? licenseMessage ||
              "The stored license could not be verified. Validate the license again."
            : hasLicenseInstalled
              ? "A license is installed, but this installation cannot confirm that it is current, so nothing is licensed by it."
              : "This installation has no valid Enterprise license.";

      /*
       * Whatever the license client said, for EVERY status and not only
       * "invalid".
       *
       * The reason above is this component's own reading of a status code, and
       * a status code cannot carry a diagnosis: "missing" is both "no license"
       * and "a license whose expiry was never recorded, re-activate it or let
       * the daily sync fetch it" (the license client's
       * classifyUnverifiedWithoutExpiry). The second one is the whole point of
       * the message field, and it used to be rendered nowhere but here in the
       * "invalid" branch - which that state deliberately no longer is.
       *
       * Skipped when the reason already IS the message ("invalid"), so a master
       * admin is never shown the same sentence twice.
       */
      const explanation: string =
        licenseMessage && licenseMessage !== reason ? licenseMessage : "";

      return (
        <section
          role="alert"
          data-testid="enterprise-license-required-notice"
          className="rounded-xl border border-red-200 bg-red-50 p-5"
        >
          <h4 className="text-sm font-semibold text-red-900">{title}</h4>
          {explanation && (
            <p
              data-testid="enterprise-license-status-message"
              className="mt-1 text-xs leading-relaxed text-red-800"
            >
              {explanation}
            </p>
          )}
          <p className="mt-1 text-xs leading-relaxed text-red-800">
            {`${reason} ${LICENSE_LAPSED_STATE}`}
          </p>
        </section>
      );
    }

    if (isUnverifiedLegacyLicense && canManageLicense) {
      return (
        <section
          data-testid="enterprise-license-unverified-notice"
          className="rounded-xl border border-gray-200 bg-gray-50 p-4"
        >
          <h4 className="text-sm font-semibold text-gray-900">
            Legacy license
          </h4>
          <p className="mt-1 text-xs leading-relaxed text-gray-600">
            This license was issued before OneUptime signed its licenses, so
            this installation cannot verify it offline. It keeps working;
            refreshing the license replaces it with a signed one once OneUptime
            issues them.
          </p>
        </section>
      );
    }

    return null;
  })();

  /*
   * What the license manager needs to know, all of it read from the license
   * GET (see LicenseManager.ts).
   */
  const licenseSnapshot: LicenseSnapshot = {
    payload: licensePayload,
    isLoading: isConfigLoading,
    loadError: configError,
    canManageLicense: canManageLicense,
    licenseValid: licenseValid,
    isUnlicensedTrial: isUnlicensedTrial,
    showLicenseDetails: showLicenseDetails,
    companyName: globalConfig?.enterpriseCompanyName || "",
    licenseKey: globalConfig?.enterpriseLicenseKey || "",
    userLimit: userLimit,
    currentUserCount: currentUserCount,
    effectiveUserCount: effectiveUserCount,
    isSeatLimitEnforced: isSeatLimitEnforced,
    canAddMoreUsers: canAddMoreUsers,
    seatTone: seatTone,
    seatUsageDisplayPercent: seatUsageDisplayPercent,
    currentVersion: currentVersion,
    latestVersion: latestVersion,
    hasComparableVersion: hasComparableVersion,
  };

  /*
   * The dialog, with whatever the license manager adds to it: its messages,
   * the seat usage and instance cards, the activation input and the footer
   * actions. With no manager (the Community Edition, the login page) the
   * parts are empty and the dialog shows the license status only.
   */
  const renderDialog: (parts: LicenseManagerDialogParts) => ReactElement = (
    parts: LicenseManagerDialogParts,
  ): ReactElement => {
    if (!isDialogOpen) {
      return <></>;
    }

    return (
      <Modal
        title={editionName}
        description={modalDescription}
        rightElement={modalRightElement}
        submitButtonText={
          IS_ENTERPRISE_EDITION ? parts.submitButtonText : "Talk to Sales"
        }
        closeButtonText="Close"
        onClose={closeDialog}
        onSubmit={IS_ENTERPRISE_EDITION ? parts.onSubmit : handlePrimaryAction}
        modalWidth={ModalWidth.Medium}
        isLoading={IS_ENTERPRISE_EDITION ? Boolean(parts.isSubmitting) : false}
        disableSubmitButton={
          IS_ENTERPRISE_EDITION ? parts.disableSubmitButton : false
        }
        isBodyLoading={IS_ENTERPRISE_EDITION ? isConfigLoading : false}
        leftFooterElement={
          IS_ENTERPRISE_EDITION ? parts.leftFooterElement : undefined
        }
      >
        <div className="space-y-4 text-sm text-gray-600">
          {IS_ENTERPRISE_EDITION ? (
            <>
              {parts.messages}

              {configError && (
                <div className="rounded-xl border border-red-200 bg-red-50 p-4">
                  <div className="flex items-start gap-2.5">
                    <Icon
                      icon={IconProp.Alert}
                      className="mt-0.5 h-4 w-4 shrink-0 text-red-600"
                    />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold text-red-900">
                        Unable to load license details
                      </p>
                      <p className="mt-1 text-xs leading-relaxed text-red-800">
                        {configError}
                      </p>
                      <div className="mt-3">
                        <Button
                          title="Try again"
                          buttonStyle={ButtonStyleType.DANGER}
                          onClick={handleRetryFetch}
                          isLoading={isConfigLoading}
                          className="!mt-0 md:!ml-0"
                        />
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {evaluationNoticeElement}

              {licenseStatusNoticeElement}

              {showLicenseDetails && (
                <dl className="grid grid-cols-1 gap-px overflow-hidden rounded-xl border border-gray-200 bg-gray-200 sm:grid-cols-2">
                  <div className="min-w-0 bg-white px-4 py-3">
                    <dt className="text-[11px] font-medium uppercase tracking-wide text-gray-500">
                      Licensed to
                    </dt>
                    <dd
                      className="mt-1 truncate text-sm font-medium text-gray-900"
                      title={globalConfig?.enterpriseCompanyName || undefined}
                    >
                      {globalConfig?.enterpriseCompanyName || "Not specified"}
                    </dd>
                  </div>
                  <div className="bg-white px-4 py-3">
                    <dt className="text-[11px] font-medium uppercase tracking-wide text-gray-500">
                      Expires
                    </dt>
                    <dd className="mt-1 text-sm font-medium tabular-nums text-gray-900">
                      {licenseExpiresAtText || "—"}
                    </dd>
                  </div>
                </dl>
              )}

              {versionCardElement}

              {parts.usage}

              {showLicenseAdminRequiredNotice && (
                <section className="rounded-xl border border-amber-200 bg-amber-50 p-5">
                  <h4 className="text-sm font-semibold text-amber-900">
                    A master admin has to activate this license
                  </h4>
                  <p className="mt-1 text-xs leading-relaxed text-amber-800">
                    This installation does not have a valid enterprise license.
                    Ask a master admin of this OneUptime installation to enter
                    or refresh the license key from this dialog.
                  </p>
                </section>
              )}

              {parts.activation}

              {showEnterpriseFeatureList && (
                <section
                  aria-labelledby="edition-features-heading"
                  className="rounded-xl border border-indigo-100 bg-gradient-to-br from-indigo-50 via-white to-white p-5"
                >
                  <h4
                    id="edition-features-heading"
                    className="text-sm font-semibold text-indigo-900"
                  >
                    What your license unlocks
                  </h4>
                  <p className="mt-0.5 text-xs text-indigo-700">
                    {canManageLicense
                      ? "A valid license that includes them keeps single sign-on, SCIM provisioning and audit logging running, enterprise configuration (SSO, SCIM, team compliance, audit log settings) editable and the enterprise admin dashboards unlocked."
                      : "A master admin can add the license to keep single sign-on, SCIM provisioning and audit logging running and enterprise configuration editable."}{" "}
                    Core monitoring never depends on it.
                  </p>
                  <ul className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
                    {enterpriseFeatures.map(
                      (feature: string, index: number) => {
                        return (
                          <li
                            key={index}
                            className="flex items-start gap-2 rounded-lg border border-gray-100 bg-white px-3 py-2.5"
                          >
                            <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-indigo-50">
                              <Icon
                                icon={IconProp.Check}
                                className="h-3 w-3 text-indigo-600"
                              />
                            </span>
                            <span className="text-xs leading-snug text-gray-700">
                              {feature}
                            </span>
                          </li>
                        );
                      },
                    )}
                  </ul>
                </section>
              )}
            </>
          ) : (
            <>
              {showEditionMismatchNotice && (
                <section
                  role="alert"
                  data-testid="enterprise-edition-image-mismatch"
                  className="rounded-xl border border-amber-200 bg-amber-50 p-5"
                >
                  <h4 className="text-sm font-semibold text-amber-900">
                    This is the Community Edition image
                  </h4>
                  <p className="mt-1 text-xs leading-relaxed text-amber-800">
                    IS_ENTERPRISE_EDITION is set but this is the Community
                    Edition image — switch to the enterprise image (the
                    enterprise-* image tags) to use Enterprise Edition features.
                    Until then they are off; everything else keeps working.
                  </p>
                </section>
              )}
              {versionCardElement}
              <p>
                You are running the Community Edition of OneUptime. Here is a
                quick comparison to help you decide if Enterprise is the right
                fit for your team.
              </p>
              <div className="grid gap-4 md:grid-cols-2">
                <div className="rounded-xl border border-gray-200 bg-white p-4">
                  <h4 className="text-sm font-semibold text-gray-900">
                    Community Edition
                  </h4>
                  <ul className="mt-3 space-y-2 text-sm text-gray-600">
                    {communityFeatures.map((feature: string, index: number) => {
                      return (
                        <li key={index} className="flex items-start gap-2">
                          <Icon
                            icon={IconProp.Check}
                            className="mt-0.5 h-3 w-3 shrink-0 text-gray-400"
                          />
                          <span className="leading-snug">{feature}</span>
                        </li>
                      );
                    })}
                  </ul>
                  <p className="mt-3 text-xs text-gray-500">
                    Best for small teams experimenting with reliability
                    workflows.
                  </p>
                </div>
                <div className="rounded-xl border border-indigo-100 bg-gradient-to-br from-indigo-50 via-white to-white p-4">
                  <h4 className="text-sm font-semibold text-indigo-900">
                    Enterprise Edition
                  </h4>
                  <ul className="mt-3 space-y-2 text-sm text-indigo-900">
                    {enterpriseFeatures.map(
                      (feature: string, index: number) => {
                        return (
                          <li key={index} className="flex items-start gap-2">
                            <Icon
                              icon={IconProp.Check}
                              className="mt-0.5 h-3 w-3 shrink-0 text-indigo-600"
                            />
                            <span className="leading-snug">{feature}</span>
                          </li>
                        );
                      },
                    )}
                  </ul>
                  <p className="mt-3 text-xs text-indigo-700">
                    Everything in Community plus white-glove onboarding,
                    enterprise SLAs, and a partner dedicated to your reliability
                    goals.
                  </p>
                </div>
              </div>
              <p className="text-xs text-gray-500">
                Ready to unlock enterprise capabilities? Click &quot;Talk to
                Sales&quot; to start the conversation.
              </p>
            </>
          )}
        </div>
      </Modal>
    );
  };

  /*
   * Kept after every hook: oneuptime.com (billing enabled) bounds seats and
   * plans through subscriptions and shows no edition pill at all.
   */
  if (BILLING_ENABLED) {
    return <></>;
  }

  return (
    <>
      <button
        type="button"
        onClick={openDialog}
        className={`${pillClassName} ${props.className ? props.className : ""}`}
        /*
         * Accessible name must include the visible text (WCAG 2.5.3 Label in
         * Name) so voice-control users can activate it by the words they see
         * ("{editionName}" and "{ctaLabel}", e.g. "Learn more").
         */
        aria-label={`${editionName}${
          showEvaluationTag ? ", Evaluation" : ""
        }, ${ctaLabel}`}
      >
        {pillTone !== "normal" && (
          <Icon
            icon={
              pillTone === "alerted"
                ? IconProp.Alert
                : IconProp.ExclaimationCircle
            }
            className={`h-3 w-3 ${
              pillTone === "alerted" ? "text-red-600" : "text-amber-600"
            }`}
          />
        )}
        <span
          className={`h-2 w-2 rounded-full transition group-hover:scale-110 ${indicatorColor}`}
        ></span>
        <span className="tracking-wide">{editionName}</span>
        {showEvaluationTag && (
          <span className="inline-flex items-center rounded-full bg-violet-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-violet-700">
            Evaluation
          </span>
        )}
        <span className={pillCtaTextClassName}>{ctaLabel}</span>
      </button>

      {LicenseManager ? (
        <LicenseManager
          license={licenseSnapshot}
          isDialogOpen={isDialogOpen}
          reloadLicense={fetchGlobalConfig}
          applySeatEnforcement={applySeatEnforcementPayload}
          renderDialog={renderDialog}
        />
      ) : (
        renderDialog({})
      )}
    </>
  );
};

export default EditionLabel;

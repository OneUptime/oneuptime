import Modal, { ModalWidth } from "../Modal/Modal";
import Icon from "../Icon/Icon";
import IconProp from "../../../Types/Icon/IconProp";
import Button, { ButtonStyleType } from "../Button/Button";
import { LicenseDetailsComponent, LicenseSnapshot } from "./LicenseDetails";
import { subscribeToLicenseChanged } from "./LicenseEvents";
import {
  getLicenseSeatUsage,
  LicenseSeatUsage,
  SeatTone,
} from "./LicenseSeatUsage";
import { getLicenseSettingsPageUrl } from "./LicenseSettingsPage";
import React, {
  FunctionComponent,
  ReactElement,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
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
import Navigation from "../../Utils/Navigation";
import UserUtil from "../../Utils/User";
import CloudMarketplace, {
  CloudMarketplaceUtil,
} from "../../../Types/Marketplace/CloudMarketplace";
import {
  fillTemplate,
  formatList,
  Translator,
  translationKey,
} from "../../Utils/TranslateTemplate";
import useTranslator from "../../Utils/UseTranslator";
import UpdateStatusLoader, {
  getUpgradeGuideUrl,
} from "../../Utils/UpdateStatus";
import {
  UPDATE_STATUS_PILL_COPY,
  describeUpdateStatus,
} from "../UpdateStatus/UpdateStatusPill";
import UpdateStatusUtil, {
  UpdateState,
  UpdateStatus,
} from "../../../Types/UpdateCheck/UpdateStatus";
import { getReaderDateLocale } from "../../../Types/DateLanguage";
import { getIsolatedLine } from "../IsolatedText/IsolatedLine";
import { ReadingDirection } from "../../../Types/ReadingDirection";

/*
 * The edition pill and its dialog. This component only READS the license
 * (GET /global-config/license): the pill, the status notices and the version
 * card, for whoever opens it. The seat usage and instance tables are the
 * Enterprise Edition's license details (see ./LicenseDetails.ts), which the
 * Dashboard and the Admin Dashboard pass in. Activating, refreshing and
 * replacing a license are done on Settings > License in the Admin Dashboard,
 * and the dialog's one action takes a master admin there.
 */
export interface ComponentProps {
  className?: string | undefined;
  /*
   * The Enterprise plugin's LicenseDetails, read from the plugin door inside
   * the caller's render (never at module load). Undefined in the Community
   * Edition and on the login page: the dialog then shows the license status
   * only.
   */
  licenseDetails?: LicenseDetailsComponent | undefined;
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
 * happens: after the trial or the grace period, SCIM provisioning stops and
 * audit logging stops recording - the Community Edition's behaviour - until a
 * license is activated, when everything resumes without a restart. Core
 * monitoring is never touched. Single sign-on (SAML and OIDC) and "Require
 * SSO" are not on this list: they are part of every edition (see
 * communityFeatures below).
 */
export const LICENSE_LAPSE_CONSEQUENCES: string = translationKey(
  "SCIM provisioning stops, audit logging stops recording, enterprise configuration becomes read-only and the enterprise admin dashboards are locked. Everything resumes as soon as a license is activated, and core monitoring is never affected.",
);

/*
 * The two periods have different names and different lengths: an unlicensed
 * installation's first ENTERPRISE_LICENSE_TRIAL_PERIOD_IN_DAYS days are its
 * trial, and only a license that expired has a grace period
 * (ENTERPRISE_LICENSE_GRACE_PERIOD_IN_DAYS days after its expiry). The
 * numbers come from the constants the license classifier uses.
 *
 * Each is one whole sentence set with the number of days as a placeholder, so
 * a locale words "after the 30-day trial" its own way. The English ends with
 * LICENSE_LAPSE_CONSEQUENCES word for word (a test holds them together).
 */
export const TRIAL_ENFORCEMENT_TEMPLATE: string = translationKey(
  "Without a valid license (after the {{days}}-day trial), SCIM provisioning stops, audit logging stops recording, enterprise configuration becomes read-only and the enterprise admin dashboards are locked. Everything resumes as soon as a license is activated, and core monitoring is never affected.",
);

export const GRACE_ENFORCEMENT_TEMPLATE: string = translationKey(
  "Without a valid license (after the {{days}}-day grace period), SCIM provisioning stops, audit logging stops recording, enterprise configuration becomes read-only and the enterprise admin dashboards are locked. Everything resumes as soon as a license is activated, and core monitoring is never affected.",
);

export const TRIAL_ENFORCEMENT_SUMMARY: string = fillTemplate(
  TRIAL_ENFORCEMENT_TEMPLATE,
  { days: ENTERPRISE_LICENSE_TRIAL_PERIOD_IN_DAYS },
);

export const GRACE_ENFORCEMENT_SUMMARY: string = fillTemplate(
  GRACE_ENFORCEMENT_TEMPLATE,
  { days: ENTERPRISE_LICENSE_GRACE_PERIOD_IN_DAYS },
);

/*
 * What has stopped once the license lapsed (expired past its grace period,
 * missing after the trial, or invalid), after the reason the notice gives.
 */
export const LICENSE_LAPSED_STATE: string = translationKey(
  "SCIM provisioning is off and your identity provider's SCIM requests are refused. Audit logging is not recording. Enterprise configuration is read-only and the enterprise admin dashboards are locked. Everything resumes, without a restart, as soon as a valid license is added, and core monitoring is never affected.",
);

/*
 * The pill's accessible name: the words it shows - the edition, the
 * evaluation tag when there is one, and the action - so voice-control users
 * can activate it by the words they see (WCAG 2.5.3, Label in Name).
 *
 * Joined as the reader's language lists words (formatList): ", " in most,
 * "، " in Arabic and Persian, "、" in Chinese and Japanese. A template of
 * placeholders alone ("{{edition}}, {{action}}") has no words to translate,
 * so every language got English's Latin comma: a braille display and the
 * text read back showed "," in an Arabic or Persian name (#7133).
 */
export const getEditionPillAccessibleName: (data: {
  edition: string;
  evaluationTag: string | null;
  action: string;
  translator: Translator;
}) => string = (data: {
  edition: string;
  evaluationTag: string | null;
  action: string;
  translator: Translator;
}): string => {
  return formatList(
    [
      data.edition,
      ...(data.evaluationTag ? [data.evaluationTag] : []),
      data.action,
    ],
    data.translator,
  );
};

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

type PillTone = "normal" | "warning" | "alerted";

/*
 * The license, as the label reads it off the server's answer. A plain
 * object: it used to be built as a GlobalConfig, a database model of about a
 * hundred columns that the sign-in and sign-up pages, which draw this label,
 * downloaded for these six (issue #5619).
 */
interface LicenseConfig {
  enterpriseCompanyName?: string | undefined;
  enterpriseLicenseKey?: string | undefined;
  enterpriseLicenseToken?: string | undefined;
  enterpriseLicenseExpiresAt?: Date | undefined;
  enterpriseLicenseUserLimit?: number | undefined;
  enterpriseLicenseCurrentUserCount?: number | undefined;
}

const EditionLabel: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const [isDialogOpen, setIsDialogOpen] = useState<boolean>(false);
  const [globalConfig, setGlobalConfig] = useState<LicenseConfig | null>(null);
  /*
   * The last successful license GET, as the server sent it. Handed to the
   * license details, which read their own fields (the instances, the
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
   * Whether a published security advisory affects this version, as the
   * footer read it (GET /global-config/update-status, master admins only).
   * Null until the dialog opens on a page whose footer read it.
   */
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus | null>(null);
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
   * The Enterprise Edition's license details, when the caller passed them (the
   * Dashboard and the Admin Dashboard of the Enterprise image do). Never on
   * the Community Edition, whatever the bundle holds: there is no license to
   * manage there.
   */
  const LicenseDetails: LicenseDetailsComponent | undefined =
    IS_ENTERPRISE_EDITION ? props.licenseDetails : undefined;

  /*
   * Activating, replacing and refreshing the license are master-admin actions:
   * the license is instance-wide, and its seat limit is what UserService
   * enforces against, so being able to rewrite it is being able to raise the
   * ceiling on the whole installation. The server enforces this
   * (MasterAdminAuthorization on both POSTs, and it answers everybody else
   * with the edition pill's fields only). The dialog never writes the license
   * for anybody: this only decides who is sent to the page that does, and who
   * is told to ask a master admin instead.
   *
   * It also takes the Enterprise frontend the page ships in. The login page
   * (where a signed-out visitor sees the same pill) and a Community build pass
   * no details, and sending somebody to the license page there would point at
   * nothing.
   */
  const canManageLicense: boolean = isMasterAdmin && Boolean(LicenseDetails);

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

        const configModel: LicenseConfig = {};

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

  /*
   * The Admin Dashboard's license page changed the license: this pill sits in
   * the header above it, and reads the license again rather than keep saying
   * what it said when the page loaded.
   */
  useEffect(() => {
    return subscribeToLicenseChanged((): void => {
      void fetchGlobalConfig();
    });
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
   * The cloud marketplace that licenses this installation, when it was bought
   * on one (AWS Marketplace, Microsoft Marketplace, Google Cloud Marketplace).
   * There is no key to add, renew or refresh then: the license lasts as long
   * as the marketplace takes the installation's hourly usage reports, so the
   * key-centred copy below is replaced by the marketplace's.
   */
  const licenseMarketplace: CloudMarketplace | null =
    IS_ENTERPRISE_EDITION &&
    CloudMarketplaceUtil.isCloudMarketplace(licensePayload?.["marketplace"])
      ? (licensePayload?.["marketplace"] as CloudMarketplace)
      : null;

  const marketplaceName: string = licenseMarketplace
    ? CloudMarketplaceUtil.getDisplayName(licenseMarketplace)
    : "";

  // How billing stands, for a master admin (the server sends it to nobody else).
  const marketplaceBilling: JSONObject | null =
    licenseMarketplace &&
    licensePayload?.["marketplaceBilling"] &&
    typeof licensePayload["marketplaceBilling"] === "object" &&
    !Array.isArray(licensePayload["marketplaceBilling"])
      ? (licensePayload["marketplaceBilling"] as JSONObject)
      : null;

  /*
   * The two faces of "grace". An unlicensed installation's trial (counted from
   * the first run of the Enterprise Edition) is not an expired license, and
   * the dialog must not tell somebody who never had a license to renew one.
   * A marketplace license in grace is neither: its reports are not being
   * accepted, which the marketplace notice explains.
   */
  const isUnlicensedTrial: boolean =
    IS_ENTERPRISE_EDITION &&
    licenseStatus === "grace" &&
    graceReason === "unlicensed";

  const isExpiredGrace: boolean =
    IS_ENTERPRISE_EDITION &&
    licenseStatus === "grace" &&
    graceReason !== "unlicensed" &&
    !licenseMarketplace;

  const isMarketplaceReportingGrace: boolean =
    Boolean(licenseMarketplace) && licenseStatus === "grace";

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

    return endsAt.toLocaleDateString(getReaderDateLocale());
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
      : translator.translatePlural(
          { one: "{{count}} day left", other: "{{count}} days left" },
          graceDaysLeft,
        );

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

    return expiresAt.toLocaleString(getReaderDateLocale());
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

    return publishedAt.toLocaleDateString(getReaderDateLocale());
  }, [latestVersionPublishedAt]);

  const latestVersionCheckedAtText: string | null = useMemo(() => {
    if (!latestVersionCheckedAt) {
      return null;
    }

    const checkedAt: Date = OneUptimeDate.fromString(latestVersionCheckedAt);

    if (Number.isNaN(checkedAt.getTime())) {
      return null;
    }

    return checkedAt.toLocaleString(getReaderDateLocale());
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

  // Two whole sentences: when it was released, then what upgrading means.
  const updateAdvisoryText: string = [
    latestVersionPublishedAtText
      ? translator.translateTemplate("Released on {{date}}.", {
          date: latestVersionPublishedAtText,
        })
      : "",
    translator.translateText(
      isMajorUpgrade
        ? "Major versions carry breaking changes and have to be applied one at a time, so check the upgrade guide before you start."
        : "Upgrading picks up the latest fixes and improvements.",
    ),
  ]
    .filter(Boolean)
    .join(" ");

  /*
   * Null renders no footer at all. Every branch here has to be true of this
   * installation specifically — a line promising a daily check would be a lie
   * on a build that cannot be compared, and a worse one where the check has
   * been turned off.
   */
  const updateFooterText: string | null = ((): string | null => {
    if (isUpdateCheckDisabled) {
      return (
        translator.translateText(
          "Update checks are turned off on this installation (DISABLE_UPDATE_CHECK), so it is not compared against OneUptime releases.",
        ) || null
      );
    }

    if (!hasComparableVersion) {
      return null;
    }

    if (!latestVersionCheckedAtText) {
      return (
        translator.translateText(
          "This installation has not checked for updates yet. It checks OneUptime releases on GitHub once a day.",
        ) || null
      );
    }

    return translator.translateTemplate("Checked for updates on {{date}}.", {
      date: latestVersionCheckedAtText,
    });
  })();

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

  const seatUsage: LicenseSeatUsage = useMemo(() => {
    return getLicenseSeatUsage({
      licenseValid: licenseValid,
      userLimit: userLimit,
      currentUserCount: currentUserCount,
      isSeatLimitEnforced: isSeatLimitEnforced,
      enforcedSeatsInUse: enforcedSeatsInUse,
      canAddMoreUsers: canAddMoreUsers,
    });
  }, [
    licenseValid,
    userLimit,
    currentUserCount,
    isSeatLimitEnforced,
    enforcedSeatsInUse,
    canAddMoreUsers,
  ]);

  const effectiveUserCount: number | null = seatUsage.effectiveUserCount;
  const seatUsageDisplayPercent: number | null =
    seatUsage.seatUsageDisplayPercent;
  const seatTone: SeatTone = seatUsage.seatTone;

  // In the reader's language: the pill, the dialog title and the pill's name.
  const editionName: string = ((): string => {
    let name: string = translationKey("Enterprise Edition (License Required)");

    if (!IS_ENTERPRISE_EDITION) {
      name = translationKey("Community Edition");
    } else if (isConfigLoading) {
      name = translationKey("Enterprise Edition (Checking...)");
    } else if (isUnlicensedTrial) {
      if (graceDaysLeftText) {
        return translator.translateTemplate(
          "Enterprise Edition (Trial, {{daysLeft}})",
          { daysLeft: graceDaysLeftText },
        );
      }

      name = translationKey("Enterprise Edition (Trial)");
    } else if (isExpiredGrace) {
      name = translationKey(
        "Enterprise Edition (License Expired, Grace Period)",
      );
    } else if (isMarketplaceReportingGrace) {
      name = translationKey("Enterprise Edition (Marketplace Reports Failing)");
    } else if (licenseMarketplace && !licenseValid) {
      name = translationKey(
        "Enterprise Edition (Marketplace Subscription Ended)",
      );
    } else if (licenseValid) {
      name = translationKey("Enterprise Edition");
    } else if (licenseStatus === "expired") {
      name = translationKey("Enterprise Edition (License Expired)");
    } else if (licenseStatus === "invalid") {
      name = translationKey("Enterprise Edition (License Invalid)");
    }

    return translator.translateText(name) || name;
  })();

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
      return showEditionMismatchNotice
        ? translationKey("Action needed")
        : translationKey("Learn more");
    }

    if (isConfigLoading) {
      return translationKey("Checking");
    }

    /*
     * Every label below asks for something only a master admin can do. The
     * same pill is in everybody's footer, and on the login page: nobody else
     * is told to "Add license" and then shown that they cannot.
     */
    if (
      !canManageLicense &&
      (!licenseValid ||
        isUnlicensedTrial ||
        isExpiredGrace ||
        isMarketplaceReportingGrace)
    ) {
      return translationKey("View details");
    }

    if (isUnlicensedTrial) {
      return translationKey("Add license");
    }

    if (isExpiredGrace) {
      return translationKey("Renew license");
    }

    if (isMarketplaceReportingGrace) {
      return translationKey("Check billing");
    }

    if (licenseMarketplace && !licenseValid) {
      return translationKey("Check subscription");
    }

    if (!licenseValid) {
      if (licenseStatus === "expired") {
        return translationKey("Renew license");
      }

      if (licenseStatus === "invalid") {
        return translationKey("Fix license");
      }

      return translationKey("Validate license");
    }

    if (seatTone === "breached") {
      return translationKey("User limit exceeded");
    }

    if (seatTone === "approaching") {
      return translationKey("Seats nearly full");
    }

    return translationKey("View details");
  }, [
    isConfigLoading,
    licenseValid,
    licenseStatus,
    seatTone,
    isUnlicensedTrial,
    isExpiredGrace,
    isMarketplaceReportingGrace,
    licenseMarketplace,
    showEditionMismatchNotice,
    canManageLicense,
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
      return translationKey(
        "You are running the free, open-source build of OneUptime.",
      );
    }

    if (isConfigLoading) {
      return translationKey("Checking your license with OneUptime...");
    }

    if (isUnlicensedTrial) {
      return translationKey(
        "No license is installed yet. Enterprise features are available during the trial.",
      );
    }

    if (isExpiredGrace) {
      return translationKey(
        "Your license has expired. Renew it before the grace period ends.",
      );
    }

    if (isMarketplaceReportingGrace) {
      return translationKey(
        "Your cloud marketplace has not accepted this installation's usage reports lately. Enterprise features keep working during the grace period.",
      );
    }

    if (licenseMarketplace && !licenseValid) {
      return translationKey(
        "Your cloud marketplace subscription no longer licenses this installation.",
      );
    }

    if (!licenseValid) {
      return translationKey(
        "Add a valid license to turn SCIM provisioning and audit logging back on and make enterprise configuration editable.",
      );
    }

    if (licenseMarketplace) {
      return translationKey(
        "Licensed through your cloud marketplace subscription: every user is billed by the hour.",
      );
    }

    return translationKey(
      "License, version, seat usage, and the instances covered by this key.",
    );
  }, [
    isConfigLoading,
    licenseValid,
    isUnlicensedTrial,
    isExpiredGrace,
    isMarketplaceReportingGrace,
    licenseMarketplace,
  ]);

  const communityFeatures: Array<string> = useMemo(() => {
    return [
      translationKey(
        "Full OneUptime platform with incident response, status pages, and workflow automation.",
      ),
      translationKey(
        'SAML and OIDC single sign-on (SSO) for projects, status pages, and the whole instance, including "Require SSO for login".',
      ),
      translationKey(
        "Community support, documentation, and tutorials to help teams get started quickly.",
      ),
      translationKey(
        "Regular updates, bug fixes, and open-source extensibility.",
      ),
      translationKey(
        "Integrations with popular DevOps tools through community-maintained connectors.",
      ),
    ];
  }, []);

  const enterpriseFeatures: Array<string> = useMemo(() => {
    return [
      translationKey("Enterprise (hardened and secure) Docker images."),
      translationKey(
        "Dedicated enterprise support phone number available 24/7/365.",
      ),
      translationKey("Priority chat and email support."),
      translationKey(
        "Dedicated engineer who can build custom features to integrate OneUptime with your ecosystem.",
      ),
      translationKey("Compliance reports (ISO, SOC, GDPR, HIPAA)."),
      translationKey("Legal indemnification."),
      translationKey("Audit logs and many more enterprise-focused features."),
    ];
  }, []);

  const openDialog: () => void = () => {
    setIsDialogOpen(true);

    /*
     * What the footer already read about this installation's security
     * advisories, when it did: the version card then says what the footer's
     * "Security update" pill says. No request of its own.
     */
    setUpdateStatus(UpdateStatusLoader.peek());

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

  // The dialog's one action: where a master admin changes the license.
  const handleManageLicense: () => void = () => {
    closeDialog();
    Navigation.navigate(getLicenseSettingsPageUrl());
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
   * gates the stat strip here, and the license details' seat and instances
   * cards.
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
   * admin sees "Evaluation license" without opening the modal.
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

  /*
   * The company a license names reads the way its name is written: a Latin
   * name in an Arabic or Persian dialog is cut short at its own end
   * ("Nordwind Logistik und Daten...") rather than losing its start
   * ("...wind Logistik und Datenverarbeitung GmbH"), and still sits under
   * its label (LineDirection).
   */
  const licensedToLine: {
    dir: ReadingDirection | undefined;
    className: string;
  } = getIsolatedLine({
    text: globalConfig?.enterpriseCompanyName,
    pageLanguage: translator.language,
    className: "mt-1 truncate text-sm font-medium text-gray-900",
  });

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
      {translator.translateText(
        seatTone === "breached"
          ? "Seat limit exceeded"
          : seatTone === "approaching"
            ? "Seats nearly full"
            : isExpiredGrace
              ? "Grace period"
              : "License active",
      )}
    </span>
  ) : undefined;

  /*
   * One line where it fits. Where it does not - a phone's sign-in page, the
   * Admin Dashboard's header beside the logo, or a language whose words are
   * longer than English's ("Enterprise Edition (Testphase, noch 10 Tage)
   * Details anzeigen") - the pill wraps between its parts, never inside the
   * tag or the action ("EVALUATION / LICENSE", "View / details"), and its
   * corners round a two-line box (rounded-2xl is a full pill on one line).
   */
  const PILL_LAYOUT_CLASS_NAME: string =
    "group inline-flex max-w-full flex-wrap items-center justify-center gap-x-2 gap-y-0.5 rounded-2xl border px-3 py-1 text-center text-xs font-medium shadow-sm transition focus:outline-none focus-visible:ring-2";

  const pillClassName: string =
    pillTone === "alerted"
      ? `${PILL_LAYOUT_CLASS_NAME} border-red-200 bg-red-50 text-red-700 hover:border-red-300 hover:bg-red-100 focus-visible:ring-red-400`
      : pillTone === "warning"
        ? `${PILL_LAYOUT_CLASS_NAME} border-amber-200 bg-amber-50 text-amber-800 hover:border-amber-300 hover:bg-amber-100 focus-visible:ring-amber-400`
        : `${PILL_LAYOUT_CLASS_NAME} border-indigo-100 bg-white text-indigo-700 hover:border-indigo-300 hover:bg-indigo-50 focus-visible:ring-indigo-400`;

  const pillCtaTextClassName: string =
    pillTone === "alerted"
      ? "whitespace-nowrap text-[11px] text-red-500 group-hover:text-red-600"
      : pillTone === "warning"
        ? "whitespace-nowrap text-[11px] text-amber-600 group-hover:text-amber-700"
        : "whitespace-nowrap text-[11px] text-indigo-500 group-hover:text-indigo-600";

  /*
   * A published security advisory affects the version this installation
   * runs, as the footer read it: the card says so in red, as the footer's
   * "Security update" pill does, and always offers the upgrade guide - a
   * security fix earns the interruption a routine release does not.
   */
  const securityStatus: UpdateStatus | null =
    updateStatus &&
    UpdateStatusUtil.isSecurityState(updateStatus.state) &&
    updateStatus.advisories.length > 0
      ? updateStatus
      : null;

  /*
   * Rendered in both the enterprise and the community branch of the modal:
   * the version and update state belong to the installation, not the license.
   */
  const versionCardElement: ReactElement | null = showVersionCard ? (
    <section
      aria-labelledby="edition-version-heading"
      className={`overflow-hidden rounded-xl border ${
        securityStatus
          ? "border-red-200"
          : isUpdateAvailable
            ? "border-amber-200"
            : "border-gray-200"
      } bg-white`}
    >
      <div className="flex items-center justify-between gap-4 p-5">
        <div className="min-w-0">
          <h4
            id="edition-version-heading"
            className="text-sm font-semibold text-gray-900"
          >
            {translator.translateText("This installation")}
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
              {translator.translateText(
                "This build does not report a version number, so it cannot be compared against the latest OneUptime release.",
              )}
            </p>
          )}
        </div>
        {securityStatus ? (
          <span
            data-testid="edition-security-update-chip"
            className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-red-100 px-2.5 py-1 text-xs font-medium text-red-800"
          >
            <Icon
              icon={IconProp.ShieldExclamation}
              className="h-3.5 w-3.5 shrink-0 text-red-700"
            />
            {translator.translateText(
              securityStatus.state === UpdateState.SecurityUpdate
                ? UPDATE_STATUS_PILL_COPY.securityUpdate
                : UPDATE_STATUS_PILL_COPY.securityAdvisory,
            )}
          </span>
        ) : (
          (isUpdateAvailable || isUpToDate) && (
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
              {translator.translateText(
                isUpdateAvailable ? "Update available" : "Up to date",
              )}
            </span>
          )
        )}
      </div>

      {securityStatus ? (
        <div
          role="status"
          data-testid="edition-security-update"
          className="border-t border-red-200 bg-red-50 px-5 py-4"
        >
          <p className="text-xs leading-relaxed text-red-800">
            {describeUpdateStatus(securityStatus, translator)}
          </p>
          <div className="mt-3">
            <a
              href={getUpgradeGuideUrl()}
              target="_blank"
              rel="noopener noreferrer"
              // Indigo, as every primary button of this dialog.
              className="inline-flex items-center gap-1.5 rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white shadow-sm transition hover:bg-indigo-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 focus-visible:ring-offset-2"
            >
              {translator.translateText("Read the upgrade guide")}
              <Icon
                icon={IconProp.ExternalLink}
                className="h-3 w-3 shrink-0 text-white"
              />
            </a>
          </div>
        </div>
      ) : (
        isUpdateAvailable && (
          <div
            role="status"
            className="border-t border-amber-200 bg-amber-50 px-5 py-4"
          >
            <h5 className="text-sm font-semibold text-amber-900">
              {translator.translateTemplate(
                isMajorUpgrade
                  ? "OneUptime v{{version}} is a major upgrade"
                  : "OneUptime v{{version}} is available",
                { version: latestVersion },
              )}
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
                  {translator.translateText("Read the upgrade guide")}
                  <Icon
                    icon={IconProp.ExternalLink}
                    className="h-3 w-3 shrink-0 text-white"
                  />
                </a>
              </div>
            )}
          </div>
        )
      )}

      {!securityStatus && !isUpdateAvailable && updateFooterText && (
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
              {translator.translateText("Evaluation license")}
            </h4>
            <span className="inline-flex items-center rounded-full bg-violet-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-violet-700">
              {translator.translateText("Testing only")}
            </span>
          </div>
          <p className="mt-1.5 text-xs leading-relaxed text-violet-800">
            {translator.translateText(
              "This key was issued for evaluation and testing. It is not licensed for production use — reach out whenever you are ready to go live and we will get a production license sorted for you.",
            )}
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
              {translator.translateText("Talk to sales about production")}
            </a>
          </div>
        </div>
      </div>
    </section>
  ) : null;

  /*
   * A license that is a cloud marketplace subscription: what the marketplace
   * last said, in place of the notices about license keys. A master admin is
   * also shown the last report the marketplace took and the last problem
   * reporting, which are what to check when reports stop being accepted.
   */
  const marketplaceLastAccepted: JSONObject | null =
    marketplaceBilling?.["lastAcceptedReport"] &&
    typeof marketplaceBilling["lastAcceptedReport"] === "object"
      ? (marketplaceBilling["lastAcceptedReport"] as JSONObject)
      : null;

  const marketplaceLastAcceptedText: string | null = ((): string | null => {
    const acceptedAt: unknown = marketplaceLastAccepted?.["acceptedAt"];
    const quantity: unknown = marketplaceLastAccepted?.["quantity"];

    if (typeof acceptedAt !== "string" || typeof quantity !== "number") {
      return null;
    }

    const date: Date = OneUptimeDate.fromString(acceptedAt);

    if (Number.isNaN(date.getTime())) {
      return null;
    }

    return translator.translateTemplate(
      "Last usage report accepted {{date}}: {{quantity}} user-hours.",
      {
        date: date.toLocaleString(getReaderDateLocale()),
        quantity: translator.formatNumber(quantity),
      },
    );
  })();

  const marketplaceProblem: string =
    typeof marketplaceBilling?.["lastProblem"] === "string"
      ? (marketplaceBilling["lastProblem"] as string)
      : "";

  const marketplaceNoticeElement: ReactElement | null =
    ((): ReactElement | null => {
      if (!licenseMarketplace) {
        return null;
      }

      const problemElement: ReactElement | null = marketplaceProblem ? (
        <p
          data-testid="enterprise-marketplace-problem"
          className="mt-2 break-words text-xs leading-relaxed"
        >
          {translator.translateTemplate("Last reporting problem: {{problem}}", {
            problem: marketplaceProblem,
          })}
        </p>
      ) : null;

      if (licenseValid && licenseStatus !== "grace") {
        return (
          <section
            role="status"
            data-testid="enterprise-marketplace-license-notice"
            className="rounded-xl border border-emerald-200 bg-emerald-50 p-5 text-emerald-800"
          >
            <h4 className="text-sm font-semibold text-emerald-900">
              {translator.translateTemplate(
                "Licensed through {{marketplace}}",
                {
                  marketplace: marketplaceName,
                },
              )}
            </h4>
            <p className="mt-1 text-xs leading-relaxed">
              {translator.translateTemplate(
                "Every user of this installation is billed by the hour on your {{marketplace}} account. Enterprise features stay licensed for as long as {{marketplace}} accepts the installation's hourly usage reports.",
                { marketplace: marketplaceName },
              )}
            </p>
            {marketplaceLastAcceptedText && (
              <p className="mt-2 text-xs leading-relaxed">
                {marketplaceLastAcceptedText}
              </p>
            )}
            {problemElement}
          </section>
        );
      }

      if (licenseStatus === "grace") {
        return (
          <section
            role="status"
            data-testid="enterprise-marketplace-grace-notice"
            className="rounded-xl border border-amber-200 bg-amber-50 p-5 text-amber-800"
          >
            <h4 className="text-sm font-semibold text-amber-900">
              {translator.translateTemplate(
                "{{marketplace}} is not accepting usage reports",
                { marketplace: marketplaceName },
              )}
            </h4>
            <p className="mt-1 text-xs leading-relaxed">
              {[
                graceEndsAtText
                  ? translator.translateTemplate(
                      "Every enterprise feature keeps working until {{date}}.",
                      { date: graceEndsAtText },
                    )
                  : translator.translateText(
                      "Every enterprise feature keeps working until the grace period ends.",
                    ),
                translator.translateTemplate(
                  "Make sure this installation can reach {{marketplace}} and is set up as the listing's instructions say.",
                  { marketplace: marketplaceName },
                ),
              ].join(" ")}
            </p>
            {marketplaceLastAcceptedText && (
              <p className="mt-2 text-xs leading-relaxed">
                {marketplaceLastAcceptedText}
              </p>
            )}
            {problemElement}
          </section>
        );
      }

      return (
        <section
          role="alert"
          data-testid="enterprise-marketplace-ended-notice"
          className="rounded-xl border border-red-200 bg-red-50 p-5 text-red-800"
        >
          <h4 className="text-sm font-semibold text-red-900">
            {translator.translateTemplate(
              "{{marketplace}} no longer licenses this installation",
              { marketplace: marketplaceName },
            )}
          </h4>
          {licenseMessage && (
            <p
              data-testid="enterprise-license-status-message"
              className="mt-1 text-xs leading-relaxed"
            >
              {licenseMessage}
            </p>
          )}
          <p className="mt-1 text-xs leading-relaxed">
            {translator.translateText(LICENSE_LAPSED_STATE)}
          </p>
          {problemElement}
        </section>
      );
    })();

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

    if (licenseMarketplace) {
      return marketplaceNoticeElement;
    }

    if (isUnlicensedTrial) {
      return (
        <section
          role="status"
          data-testid="enterprise-license-trial-notice"
          className="rounded-xl border border-amber-200 bg-amber-50 p-5"
        >
          {/*
           * The days left set apart from the title: in Persian it keeps
           * "Enterprise Edition" in Latin letters, and the browser drew the
           * count's digits inside that Latin run, on the far side of the
           * colon from its "days left" (#7132's review).
           */}
          <h4 className="text-sm font-semibold text-amber-900">
            {graceDaysLeftText
              ? translator.translateTemplate(
                  "Enterprise Edition trial: {{daysLeft}}",
                  {
                    daysLeft: graceDaysLeftText,
                  },
                  { setsValuesApart: true },
                )
              : translator.translateText("Enterprise Edition trial")}
          </h4>
          <p className="mt-1 text-xs leading-relaxed text-amber-800">
            {[
              translator.translateText(
                hasLicenseInstalled
                  ? "A license is installed, but this installation cannot tell whether it is still current, so it is treating this as an unlicensed install."
                  : "No Enterprise license is installed.",
              ),
              graceEndsAtText
                ? translator.translateTemplate(
                    "Enterprise features stay fully available until {{date}}, counted from the first time this installation ran the Enterprise Edition.",
                    { date: graceEndsAtText },
                  )
                : translator.translateText(
                    "Enterprise features stay fully available, counted from the first time this installation ran the Enterprise Edition.",
                  ),
              // The number in the reader's digits, as the days left are.
              translator.translateTemplate(TRIAL_ENFORCEMENT_TEMPLATE, {
                days: translator.formatNumber(
                  ENTERPRISE_LICENSE_TRIAL_PERIOD_IN_DAYS,
                ),
              }),
            ].join(" ")}
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
            {translator.translateText(
              canManageLicense
                ? hasLicenseInstalled
                  ? "Re-activate the license in the Admin Dashboard before the trial ends, or let the daily license sync fetch its expiry from OneUptime, to keep SCIM provisioning and audit logging running and enterprise configuration editable."
                  : "Add a license in the Admin Dashboard before the trial ends to keep SCIM provisioning and audit logging running and enterprise configuration editable."
                : hasLicenseInstalled
                  ? "Ask a master admin of this installation to re-activate the license."
                  : "Ask a master admin of this installation to add a license.",
            )}
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
              ? translator.translateTemplate(
                  "License expired, grace period until {{date}}",
                  { date: graceEndsAtText },
                )
              : translator.translateText("License expired, grace period")}
          </h4>
          <p className="mt-1 text-xs leading-relaxed text-amber-800">
            {[
              licenseExpiresAtText
                ? translator.translateTemplate(
                    "The Enterprise license expired on {{date}}.",
                    { date: licenseExpiresAtText },
                  )
                : translator.translateText("The Enterprise license expired."),
              graceDaysLeftText
                ? translator.translateTemplate(
                    "Every enterprise feature keeps working until the grace period ends ({{daysLeft}}).",
                    { daysLeft: graceDaysLeftText },
                  )
                : translator.translateText(
                    "Every enterprise feature keeps working until the grace period ends.",
                  ),
              translator.translateTemplate(GRACE_ENFORCEMENT_TEMPLATE, {
                days: translator.formatNumber(
                  ENTERPRISE_LICENSE_GRACE_PERIOD_IN_DAYS,
                ),
              }),
            ].join(" ")}
          </p>
          <p className="mt-2 text-xs leading-relaxed text-amber-800">
            {translator.translateText(
              canManageLicense
                ? "Renew the license with OneUptime, then refresh it in the Admin Dashboard."
                : "Ask a master admin of this installation to renew the license.",
            )}
          </p>
        </section>
      );
    }

    if (!licenseValid) {
      const title: string =
        translator.translateText(
          licenseStatus === "expired"
            ? "License expired"
            : licenseStatus === "invalid"
              ? "License not valid"
              : "No valid license",
        ) || "";

      /*
       * The license client's own message is shown as it was sent; everything
       * else is this component's sentence in the reader's language.
       */
      const reason: string =
        licenseStatus === "expired"
          ? licenseExpiresAtText
            ? translator.translateTemplate(
                "The Enterprise license expired on {{date}} and its grace period is over.",
                { date: licenseExpiresAtText },
              )
            : translator.translateText(
                "The Enterprise license expired and its grace period is over.",
              ) || ""
          : licenseStatus === "invalid"
            ? licenseMessage ||
              translator.translateText(
                "The stored license could not be verified. Validate the license again.",
              ) ||
              ""
            : translator.translateText(
                hasLicenseInstalled
                  ? "A license is installed, but this installation cannot confirm that it is current, so nothing is licensed by it."
                  : "This installation has no valid Enterprise license.",
              ) || "";

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
            {`${reason} ${translator.translateText(LICENSE_LAPSED_STATE)}`}
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
            {translator.translateText("Legacy license")}
          </h4>
          <p className="mt-1 text-xs leading-relaxed text-gray-600">
            {translator.translateText(
              "This license was issued before OneUptime signed its licenses, so this installation cannot verify it offline. It keeps working; refreshing the license replaces it with a signed one once OneUptime issues them.",
            )}
          </p>
        </section>
      );
    }

    return null;
  })();

  /*
   * What the license details need to know, all of it read from the license
   * GET (see LicenseDetails.ts).
   */
  const licenseSnapshot: LicenseSnapshot = {
    payload: licensePayload,
    canManageLicense: canManageLicense,
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
   * The dialog is read-only for everybody. With the license details (the
   * Dashboard and the Admin Dashboard of the Enterprise image) it adds the
   * seat usage and instance cards, and a master admin gets one action: to the
   * page that manages the license. Without them (the Community Edition, the
   * login page) it shows the license status only.
   */
  const renderDialog: () => ReactElement = (): ReactElement => {
    if (!isDialogOpen) {
      return <></>;
    }

    const enterpriseActionText: string | undefined = canManageLicense
      ? translationKey("Manage license")
      : undefined;

    return (
      <Modal
        title={editionName}
        description={translator.translateText(modalDescription)}
        rightElement={modalRightElement}
        submitButtonText={
          IS_ENTERPRISE_EDITION ? enterpriseActionText : "Talk to Sales"
        }
        closeButtonText="Close"
        onClose={closeDialog}
        onSubmit={
          IS_ENTERPRISE_EDITION
            ? enterpriseActionText
              ? handleManageLicense
              : undefined
            : handlePrimaryAction
        }
        modalWidth={ModalWidth.Medium}
        isBodyLoading={IS_ENTERPRISE_EDITION ? isConfigLoading : false}
      >
        <div className="space-y-4 text-sm text-gray-600">
          {IS_ENTERPRISE_EDITION ? (
            <>
              {configError && (
                <div className="rounded-xl border border-red-200 bg-red-50 p-4">
                  <div className="flex items-start gap-2.5">
                    <Icon
                      icon={IconProp.Alert}
                      className="mt-0.5 h-4 w-4 shrink-0 text-red-600"
                    />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold text-red-900">
                        {translator.translateText(
                          "Unable to load license details",
                        )}
                      </p>
                      <p className="mt-1 text-xs leading-relaxed text-red-800">
                        {configError}
                      </p>
                      <div className="mt-3">
                        {/*
                         * A retry, not a destructive action: the red panel
                         * already says something went wrong, and a filled red
                         * button would compete with the dialog's own action.
                         */}
                        <Button
                          title="Try again"
                          buttonStyle={ButtonStyleType.NORMAL}
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

              {showLicenseDetails && !licenseMarketplace && (
                <dl className="grid grid-cols-1 gap-px overflow-hidden rounded-xl border border-gray-200 bg-gray-200 sm:grid-cols-2">
                  <div className="min-w-0 bg-white px-4 py-3">
                    <dt className="text-[11px] font-medium uppercase tracking-wide text-gray-500">
                      {translator.translateText("Licensed to")}
                    </dt>
                    <dd
                      className={licensedToLine.className}
                      dir={licensedToLine.dir}
                      title={globalConfig?.enterpriseCompanyName || undefined}
                    >
                      {globalConfig?.enterpriseCompanyName ||
                        translator.translateText("Not specified")}
                    </dd>
                  </div>
                  <div className="bg-white px-4 py-3">
                    <dt className="text-[11px] font-medium uppercase tracking-wide text-gray-500">
                      {translator.translateText("Expires")}
                    </dt>
                    <dd className="mt-1 text-sm font-medium tabular-nums text-gray-900">
                      {licenseExpiresAtText || "—"}
                    </dd>
                  </div>
                </dl>
              )}

              {versionCardElement}

              {LicenseDetails && <LicenseDetails license={licenseSnapshot} />}

              {showLicenseAdminRequiredNotice && (
                <section className="rounded-xl border border-amber-200 bg-amber-50 p-5">
                  <h4 className="text-sm font-semibold text-amber-900">
                    {translator.translateText(
                      "A master admin has to activate this license",
                    )}
                  </h4>
                  <p className="mt-1 text-xs leading-relaxed text-amber-800">
                    {translator.translateText(
                      "This installation does not have a valid enterprise license. Ask a master admin of this OneUptime installation to add or refresh the license in the Admin Dashboard.",
                    )}
                  </p>
                </section>
              )}

              {showEnterpriseFeatureList && (
                <section
                  aria-labelledby="edition-features-heading"
                  className="rounded-xl border border-indigo-100 bg-gradient-to-br from-indigo-50 via-white to-white p-5"
                >
                  <h4
                    id="edition-features-heading"
                    className="text-sm font-semibold text-indigo-900"
                  >
                    {translator.translateText("What your license unlocks")}
                  </h4>
                  <p className="mt-0.5 text-xs text-indigo-700">
                    {`${translator.translateText(
                      canManageLicense
                        ? "A valid license that includes them keeps SCIM provisioning and audit logging running, enterprise configuration (SCIM, team compliance, audit log settings) editable and the enterprise admin dashboards unlocked."
                        : "A master admin can add the license to keep SCIM provisioning and audit logging running and enterprise configuration editable.",
                    )} ${translator.translateText("Core monitoring never depends on it.")}`}
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
                              {translator.translateText(feature)}
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
                    {translator.translateText(
                      "This is the Community Edition image",
                    )}
                  </h4>
                  <p className="mt-1 text-xs leading-relaxed text-amber-800">
                    {translator.translateText(
                      "IS_ENTERPRISE_EDITION is set but this is the Community Edition image — switch to the enterprise image (the enterprise-* image tags) to use Enterprise Edition features. Until then they are off; everything else keeps working.",
                    )}
                  </p>
                </section>
              )}
              {versionCardElement}
              <p>
                {translator.translateText(
                  "You are running the Community Edition of OneUptime. Here is a quick comparison to help you decide if Enterprise is the right fit for your team.",
                )}
              </p>
              <div className="grid gap-4 md:grid-cols-2">
                <div className="rounded-xl border border-gray-200 bg-white p-4">
                  <h4 className="text-sm font-semibold text-gray-900">
                    {translator.translateText("Community Edition")}
                  </h4>
                  <ul className="mt-3 space-y-2 text-sm text-gray-600">
                    {communityFeatures.map((feature: string, index: number) => {
                      return (
                        <li key={index} className="flex items-start gap-2">
                          <Icon
                            icon={IconProp.Check}
                            className="mt-0.5 h-3 w-3 shrink-0 text-gray-400"
                          />
                          <span className="leading-snug">
                            {translator.translateText(feature)}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                  <p className="mt-3 text-xs text-gray-500">
                    {translator.translateText(
                      "Best for small teams experimenting with reliability workflows.",
                    )}
                  </p>
                </div>
                <div className="rounded-xl border border-indigo-100 bg-gradient-to-br from-indigo-50 via-white to-white p-4">
                  <h4 className="text-sm font-semibold text-indigo-900">
                    {translator.translateText("Enterprise Edition")}
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
                            <span className="leading-snug">
                              {translator.translateText(feature)}
                            </span>
                          </li>
                        );
                      },
                    )}
                  </ul>
                  <p className="mt-3 text-xs text-indigo-700">
                    {translator.translateText(
                      "Everything in Community plus white-glove onboarding, enterprise SLAs, and a partner dedicated to your reliability goals.",
                    )}
                  </p>
                </div>
              </div>
              <p className="text-xs text-gray-500">
                {translator.translateText(
                  'Ready to unlock enterprise capabilities? Click "Talk to Sales" to start the conversation.',
                )}
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
        aria-label={getEditionPillAccessibleName({
          edition: editionName,
          evaluationTag: showEvaluationTag
            ? translator.translateText("Evaluation license") ||
              "Evaluation license"
            : null,
          action: translator.translateText(ctaLabel) || ctaLabel,
          translator: translator,
        })}
      >
        {/*
         * The marks stay beside the edition they mark: a state too long
         * for the line ("Enterprise Edition (лицензия истекла, льготный
         * период)") wraps inside its own words, never leaving the dot
         * alone on a line above it.
         */}
        <span
          className="inline-flex min-w-0 items-center gap-2"
          data-testid="edition-label-pill-edition"
        >
          {pillTone !== "normal" && (
            <Icon
              icon={
                pillTone === "alerted"
                  ? IconProp.Alert
                  : IconProp.ExclaimationCircle
              }
              className={`h-3 w-3 shrink-0 ${
                pillTone === "alerted" ? "text-red-600" : "text-amber-600"
              }`}
            />
          )}
          <span
            className={`h-2 w-2 shrink-0 rounded-full transition group-hover:scale-110 ${indicatorColor}`}
          ></span>
          <span className="min-w-0 tracking-wide">{editionName}</span>
        </span>
        {/*
         * "Evaluation license", the dialog's own heading for it, and not
         * "Evaluation": that word is also an SLO card's title, which a
         * language words as assessing (German "Auswertung"), never as a
         * license for trying the product out.
         */}
        {showEvaluationTag && (
          <span className="inline-flex items-center whitespace-nowrap rounded-full bg-violet-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-violet-700">
            {translator.translateText("Evaluation license")}
          </span>
        )}
        <span className={pillCtaTextClassName}>
          {translator.translateText(ctaLabel)}
        </span>
      </button>

      {renderDialog()}
    </>
  );
};

export default EditionLabel;

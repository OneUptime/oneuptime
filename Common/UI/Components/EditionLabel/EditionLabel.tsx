import Modal, { ModalWidth } from "../Modal/Modal";
import Icon, { IconType } from "../Icon/Icon";
import IconProp from "../../../Types/Icon/IconProp";
import Input from "../Input/Input";
import Button, { ButtonStyleType } from "../Button/Button";
import React, {
  FunctionComponent,
  ReactElement,
  useCallback,
  useEffect,
  useMemo,
  useRef,
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
} from "../../Config";
import Alert, { AlertType } from "../Alerts/Alert";
import EnterpriseLicenseInstanceSummary from "../../../Types/EnterpriseLicense/EnterpriseLicenseInstanceSummary";
import VersionUtil from "../../../Utils/VersionUtil";

export interface ComponentProps {
  className?: string | undefined;
}

const ENTERPRISE_URL: string = "https://oneuptime.com/enterprise/demo";

/*
 * Linked only for major upgrades. Points at GitHub rather than the docs site
 * on this installation, because the guide for the version you are moving TO is
 * the one you need, and this installation only ships the guide for the version
 * it is already running.
 */
const UPGRADE_GUIDE_URL: string =
  "https://github.com/OneUptime/oneuptime/blob/master/App/FeatureSet/Docs/Content/en/installation/upgrading.md";
const SALES_EMAIL: string = "sales@oneuptime.com";
const SALES_MAILTO_URL: string = "mailto:sales@oneuptime.com";

/*
 * Seat usage at or above this percent asks the admin to talk to OneUptime about
 * expanding. Matches CRITICAL_CAPACITY_PERCENT in
 * App/FeatureSet/Workers/Jobs/InstanceHealth/EvaluateClickhouseCapacity.ts.
 */
const SEAT_WARNING_PERCENT: number = 90;

type SeatTone = "healthy" | "approaching" | "breached";

type PillTone = "normal" | "warning" | "alerted";

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

const EditionLabel: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [isDialogOpen, setIsDialogOpen] = useState<boolean>(false);
  const [globalConfig, setGlobalConfig] = useState<GlobalConfig | null>(null);
  const [isConfigLoading, setIsConfigLoading] = useState<boolean>(false);
  const [configError, setConfigError] = useState<string>("");
  const [licenseKeyInput, setLicenseKeyInput] = useState<string>("");
  const [validationError, setValidationError] = useState<string>("");
  const [successMessage, setSuccessMessage] = useState<string>("");
  const [isValidating, setIsValidating] = useState<boolean>(false);
  const [isChangingLicense, setIsChangingLicense] = useState<boolean>(false);
  const [licenseInstances, setLicenseInstances] = useState<
    Array<EnterpriseLicenseInstanceSummary>
  >([]);
  const [thisInstanceId, setThisInstanceId] = useState<string>("");
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
   * Validity as computed by the server. The server redacts the license
   * token for signed-out visitors (e.g. on the login page), so the client
   * cannot always derive validity from the token itself.
   */
  const [serverLicenseValid, setServerLicenseValid] = useState<boolean | null>(
    null,
  );
  const licenseInputEditedRef: React.MutableRefObject<boolean> =
    useRef<boolean>(false);

  if (BILLING_ENABLED) {
    return <></>;
  }

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

        if (payload["userCountUpdatedAt"]) {
          configModel.enterpriseLicenseUserCountUpdatedAt =
            OneUptimeDate.fromString(payload["userCountUpdatedAt"] as string);
        }

        setGlobalConfig(configModel);
        setLicenseInstances(parseLicenseInstances(payload["instances"]));
        setThisInstanceId(
          typeof payload["instanceId"] === "string"
            ? payload["instanceId"]
            : "",
        );
        setServerLicenseValid(
          typeof payload["licenseValid"] === "boolean"
            ? payload["licenseValid"]
            : null,
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

        if (!licenseInputEditedRef.current) {
          setLicenseKeyInput(configModel.enterpriseLicenseKey || "");
        }
      } catch (err) {
        setGlobalConfig(null);
        setLicenseInstances([]);
        setServerLicenseValid(null);
        setCurrentVersion("");
        setLatestVersion("");
        setLatestVersionPublishedAt("");
        setLatestVersionCheckedAt("");
        setIsUpdateAvailable(false);
        setIsUpdateCheckDisabled(false);
        setConfigError(API.getFriendlyMessage(err));
      } finally {
        setIsConfigLoading(false);
      }
    }, []);

  /*
   * Only Enterprise Edition needs this on mount — its pill reports license
   * validity and seat pressure, which it cannot know without asking. The
   * community pill is a static label, so it waits until the modal is actually
   * opened rather than adding a request to every page load.
   */
  useEffect(() => {
    if (!IS_ENTERPRISE_EDITION) {
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

  const userCountUpdatedAtText: string | null = useMemo(() => {
    if (!globalConfig?.enterpriseLicenseUserCountUpdatedAt) {
      return null;
    }

    const reportedAt: Date = OneUptimeDate.fromString(
      globalConfig.enterpriseLicenseUserCountUpdatedAt,
    );

    if (Number.isNaN(reportedAt.getTime())) {
      return null;
    }

    return reportedAt.toLocaleString();
  }, [globalConfig?.enterpriseLicenseUserCountUpdatedAt]);

  const isUserLimitBreached: boolean = useMemo(() => {
    if (!licenseValid) {
      return false;
    }

    if (typeof userLimit !== "number" || userLimit <= 0) {
      return false;
    }

    if (typeof currentUserCount !== "number") {
      return false;
    }

    return currentUserCount > userLimit;
  }, [licenseValid, userLimit, currentUserCount]);

  /*
   * Unclamped and unrounded. The only value that can tell 120/120 apart from
   * 240/120. Null means there is no seat limit to measure against, either
   * because the license is unlimited or because usage has not been reported.
   */
  const rawUserUsagePercent: number | null = useMemo(() => {
    if (typeof userLimit !== "number" || userLimit <= 0) {
      return null;
    }

    if (typeof currentUserCount !== "number") {
      return null;
    }

    return Math.max(0, (currentUserCount / userLimit) * 100);
  }, [userLimit, currentUserCount]);

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

    if (typeof currentUserCount !== "number") {
      return null;
    }

    return userLimit - currentUserCount;
  }, [userLimit, currentUserCount]);

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

    if (
      typeof seatUsageDisplayPercent === "number" &&
      seatUsageDisplayPercent >= SEAT_WARNING_PERCENT
    ) {
      return "approaching";
    }

    return "healthy";
  }, [licenseValid, isUserLimitBreached, seatUsageDisplayPercent]);

  /*
   * Copy containing apostrophes lives in string literals rather than JSX text,
   * because react/no-unescaped-entities is enforced in this repo.
   */
  const seatAdvisoryTitle: string = useMemo(() => {
    if (seatTone === "breached") {
      const over: number = Math.abs(seatsRemaining || 0);

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
    const inUse: string = `${(currentUserCount || 0).toLocaleString()} of ${limitText}`;

    if (seatTone === "breached") {
      return `This installation is using ${inUse} licensed seats. Expand your license so it covers everyone on the platform.`;
    }

    if (seatTone === "approaching") {
      return `You're using ${inUse} licensed seats. Anyone you add beyond ${limitText} puts this installation over its licensed limit — if more people are joining, it's worth talking to OneUptime about expanding now.`;
    }

    return "";
  }, [seatTone, currentUserCount, userLimit]);

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

  const editionName: string = useMemo(() => {
    if (!IS_ENTERPRISE_EDITION) {
      return "Community Edition";
    }

    if (isConfigLoading) {
      return "Enterprise Edition (Checking...)";
    }

    return licenseValid
      ? "Enterprise Edition"
      : "Enterprise Edition (License Required)";
  }, [isConfigLoading, licenseValid]);

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

    if (seatTone === "approaching") {
      return "bg-amber-500";
    }

    return "bg-emerald-500";
  }, [isConfigLoading, licenseValid, seatTone]);

  const ctaLabel: string = useMemo(() => {
    if (!IS_ENTERPRISE_EDITION) {
      return "Learn more";
    }

    if (isConfigLoading) {
      return "Checking";
    }

    if (!licenseValid) {
      return "Validate license";
    }

    if (seatTone === "breached") {
      return "User limit exceeded";
    }

    if (seatTone === "approaching") {
      return "Seats nearly full";
    }

    return "View details";
  }, [isConfigLoading, licenseValid, seatTone]);

  const pillTone: PillTone = useMemo(() => {
    if (!IS_ENTERPRISE_EDITION || isConfigLoading) {
      return "normal";
    }

    if (
      seatTone === "breached" ||
      (!licenseValid && Boolean(globalConfig?.enterpriseLicenseKey))
    ) {
      return "alerted";
    }

    if (seatTone === "approaching") {
      return "warning";
    }

    return "normal";
  }, [
    isConfigLoading,
    licenseValid,
    seatTone,
    globalConfig?.enterpriseLicenseKey,
  ]);

  const modalIcon: IconProp = useMemo(() => {
    if (!IS_ENTERPRISE_EDITION || isConfigLoading) {
      return IconProp.Cube;
    }

    if (!licenseValid || isUserLimitBreached) {
      return IconProp.Alert;
    }

    return IconProp.ShieldCheck;
  }, [isConfigLoading, licenseValid, isUserLimitBreached]);

  const modalIconType: IconType = useMemo(() => {
    if (!IS_ENTERPRISE_EDITION || isConfigLoading) {
      return IconType.Info;
    }

    if (!licenseValid || isUserLimitBreached) {
      return IconType.Danger;
    }

    return IconType.Success;
  }, [isConfigLoading, licenseValid, isUserLimitBreached]);

  const modalDescription: string = useMemo(() => {
    if (!IS_ENTERPRISE_EDITION) {
      return "You are running the free, open-source build of OneUptime.";
    }

    if (isConfigLoading) {
      return "Checking your license with OneUptime...";
    }

    if (!licenseValid) {
      return "Validate your license key to activate Enterprise Edition.";
    }

    return "License, version, seat usage, and the instances covered by this key.";
  }, [isConfigLoading, licenseValid]);

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

  const licenseKeyHelperText: string = useMemo(() => {
    if (isChangingLicense) {
      return "Enter the new enterprise license key and validate it to replace the current one. Your existing license stays active until the new key is validated.";
    }

    return "You have installed Enterprise Edition of OneUptime. You need to validate your license key. Need a license key? Contact our sales team at";
  }, [isChangingLicense]);

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

  const openDialog: () => void = () => {
    setIsDialogOpen(true);
    setValidationError("");
    setSuccessMessage("");

    void fetchGlobalConfig();
  };

  const closeDialog: () => void = () => {
    setIsDialogOpen(false);
    setValidationError("");
    setSuccessMessage("");
    setIsChangingLicense(false);
  };

  const handleStartChangingLicense: () => void = () => {
    setIsChangingLicense(true);
    setValidationError("");
    setSuccessMessage("");
    setLicenseKeyInput("");
    licenseInputEditedRef.current = true;
  };

  const handleCancelChangingLicense: () => void = () => {
    setIsChangingLicense(false);
    setValidationError("");
    licenseInputEditedRef.current = false;
    setLicenseKeyInput(globalConfig?.enterpriseLicenseKey || "");
  };

  const handlePrimaryAction: () => void = () => {
    if (typeof window !== "undefined") {
      window.open(ENTERPRISE_URL, "_blank", "noopener,noreferrer");
    }

    closeDialog();
  };

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
        `Company: ${globalConfig?.enterpriseCompanyName || "Not specified"}`,
        `Seats in use: ${(currentUserCount || 0).toLocaleString()} of ${(
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

  const runLicenseValidation: (
    key: string,
    setLoading: React.Dispatch<React.SetStateAction<boolean>>,
  ) => Promise<void> = useCallback(
    async (
      key: string,
      setLoading: React.Dispatch<React.SetStateAction<boolean>>,
    ): Promise<void> => {
      const trimmedKey: string = key.trim();

      if (!trimmedKey) {
        setValidationError("Please enter a license key before validating.");
        setSuccessMessage("");
        return;
      }

      setValidationError("");
      setSuccessMessage("");
      setLoading(true);

      try {
        const validationUrl: URL = URL.fromURL(APP_API_URL).addRoute(
          new Route("/global-config/license"),
        );

        const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
          await API.fetch<JSONObject>({
            method: HTTPMethod.POST,
            url: validationUrl,
            data: {
              licenseKey: trimmedKey,
            },
          });

        if (!response.isSuccess()) {
          throw response;
        }

        const payload: JSONObject = response.data as JSONObject;

        licenseInputEditedRef.current = false;
        setLicenseKeyInput((payload["licenseKey"] as string) || trimmedKey);
        setSuccessMessage("License validated successfully.");
        setIsChangingLicense(false);

        await fetchGlobalConfig();
      } catch (err) {
        setValidationError(API.getFriendlyMessage(err));
      } finally {
        setLoading(false);
      }
    },
    [fetchGlobalConfig],
  );

  const handleValidateClick: () => void = () => {
    if (isValidating) {
      return;
    }

    void runLicenseValidation(licenseKeyInput, setIsValidating);
  };

  const handleRetryFetch: () => void = () => {
    if (!isConfigLoading) {
      void fetchGlobalConfig();
    }
  };

  const showLicenseKeyInput: boolean =
    IS_ENTERPRISE_EDITION && (!licenseValid || isChangingLicense);

  const shouldShowEnterpriseValidationButton: boolean = showLicenseKeyInput;

  /*
   * Collapses the !configError && !isConfigLoading && licenseValid chain that
   * gates the stat strip, the seat card and the instances card.
   */
  const showLicenseDetails: boolean =
    IS_ENTERPRISE_EDITION && !configError && !isConfigLoading && licenseValid;

  const showEnterpriseFeatureList: boolean =
    IS_ENTERPRISE_EDITION && !configError && !isConfigLoading && !licenseValid;

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
   * GlobalConfigAPI returns userLimit and currentUserCount to anonymous callers
   * because the same route serves the signed-out login page, and gates only
   * licenseKey, token, instances and instanceId on isAuthenticatedUser. Gate
   * the sales ask on a field the server does redact, so a signed-out visitor is
   * never shown an administrator-targeted CTA.
   */
  const canSeeLicenseAdmin: boolean = Boolean(
    globalConfig?.enterpriseLicenseKey,
  );

  const modalSubmitButtonText: string | undefined = IS_ENTERPRISE_EDITION
    ? shouldShowEnterpriseValidationButton
      ? "Validate License"
      : undefined
    : "Talk to Sales";

  const modalOnSubmit: (() => void) | undefined = IS_ENTERPRISE_EDITION
    ? shouldShowEnterpriseValidationButton
      ? handleValidateClick
      : undefined
    : handlePrimaryAction;

  const modalIsLoading: boolean =
    IS_ENTERPRISE_EDITION && shouldShowEnterpriseValidationButton
      ? isValidating
      : false;

  const modalDisableSubmitButton: boolean | undefined = IS_ENTERPRISE_EDITION
    ? shouldShowEnterpriseValidationButton
      ? !licenseKeyInput.trim() || isValidating || isConfigLoading
      : undefined
    : false;

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
          : "License active"}
    </span>
  ) : undefined;

  const modalLeftFooterElement: ReactElement | undefined =
    showLicenseDetails && !isChangingLicense ? (
      <Button
        title="Change license key"
        icon={IconProp.Edit}
        buttonStyle={ButtonStyleType.NORMAL}
        onClick={handleStartChangingLicense}
      />
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
        aria-label={`${editionName}, ${ctaLabel}`}
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
        <span className={pillCtaTextClassName}>{ctaLabel}</span>
      </button>

      {isDialogOpen && (
        <Modal
          title={editionName}
          description={modalDescription}
          icon={modalIcon}
          iconType={modalIconType}
          rightElement={modalRightElement}
          submitButtonText={modalSubmitButtonText}
          closeButtonText="Close"
          onClose={closeDialog}
          onSubmit={modalOnSubmit}
          modalWidth={ModalWidth.Medium}
          isLoading={modalIsLoading}
          disableSubmitButton={modalDisableSubmitButton}
          isBodyLoading={IS_ENTERPRISE_EDITION ? isConfigLoading : false}
          leftFooterElement={modalLeftFooterElement}
        >
          <div className="space-y-4 text-sm text-gray-600">
            {IS_ENTERPRISE_EDITION ? (
              <>
                {!configError && successMessage && (
                  <Alert type={AlertType.SUCCESS} title={successMessage} />
                )}

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

                {showLicenseDetails && (
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
                            typeof currentUserCount !== "number"
                              ? "text-gray-300"
                              : seatTone === "breached"
                                ? "text-red-700"
                                : "text-gray-900"
                          }`}
                        >
                          {typeof currentUserCount === "number"
                            ? currentUserCount.toLocaleString()
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
                        {userCountUpdatedAtText
                          ? `Last reported to OneUptime on ${userCountUpdatedAtText}.`
                          : "User count has not been reported to OneUptime yet. The first report will be sent within 24 hours."}
                      </p>
                    </div>
                  </section>
                )}

                {showLicenseDetails && licenseInstances.length > 0 && (
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

                {!configError &&
                  !isConfigLoading &&
                  !licenseValid &&
                  globalConfig?.enterpriseLicenseKey && (
                    <div className="rounded-xl border border-red-200 bg-red-50 p-4">
                      <p className="text-sm font-semibold text-red-900">
                        License validation required
                      </p>
                      <p className="mt-1 text-xs leading-relaxed text-red-800">
                        The stored license information could not be verified.
                        Please validate the license key again.
                      </p>
                    </div>
                  )}

                {!configError && showLicenseKeyInput && (
                  <section className="rounded-xl border border-gray-200 bg-white p-5">
                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0">
                        <label
                          htmlFor="enterprise-license-key"
                          className="text-sm font-semibold text-gray-900"
                        >
                          {isChangingLicense
                            ? "New license key"
                            : "License key"}
                        </label>
                        <p className="mt-0.5 text-xs leading-relaxed text-gray-500">
                          {licenseKeyHelperText}
                          {!isChangingLicense && (
                            <>
                              {" "}
                              <a
                                href={SALES_MAILTO_URL}
                                className="font-medium text-indigo-600 hover:text-indigo-700"
                              >
                                {SALES_EMAIL}
                              </a>
                              .
                            </>
                          )}
                        </p>
                      </div>
                      {isChangingLicense && (
                        <Button
                          title="Cancel"
                          buttonStyle={ButtonStyleType.NORMAL}
                          onClick={handleCancelChangingLicense}
                          className="!mt-0 shrink-0 md:!ml-0"
                        />
                      )}
                    </div>
                    <div className="mt-3">
                      <Input
                        id="enterprise-license-key"
                        value={licenseKeyInput}
                        onChange={(value: string) => {
                          setLicenseKeyInput(value);
                          licenseInputEditedRef.current = true;
                        }}
                        placeholder="Enter your enterprise license key"
                        disableSpellCheck={true}
                      />
                    </div>
                    {validationError && (
                      <div className="mt-3">
                        <Alert
                          type={AlertType.DANGER}
                          title={validationError}
                        />
                      </div>
                    )}
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
                      What your license unlocks
                    </h4>
                    <p className="mt-0.5 text-xs text-indigo-700">
                      Validate your key above to turn these on immediately.
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
                      {communityFeatures.map(
                        (feature: string, index: number) => {
                          return (
                            <li key={index} className="flex items-start gap-2">
                              <Icon
                                icon={IconProp.Check}
                                className="mt-0.5 h-3 w-3 shrink-0 text-gray-400"
                              />
                              <span className="leading-snug">{feature}</span>
                            </li>
                          );
                        },
                      )}
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
                      enterprise SLAs, and a partner dedicated to your
                      reliability goals.
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
      )}
    </>
  );
};

export default EditionLabel;

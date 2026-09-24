import {
  LicenseManagerProps,
  LicenseSnapshot,
  SeatTone,
} from "Common/UI/Components/EditionLabel/LicenseManager";
import Alert, { AlertType } from "Common/UI/Components/Alerts/Alert";
import Button, { ButtonStyleType } from "Common/UI/Components/Button/Button";
import Icon from "Common/UI/Components/Icon/Icon";
import Input from "Common/UI/Components/Input/Input";
import TextArea from "Common/UI/Components/TextArea/TextArea";
import { APP_API_URL } from "Common/UI/Config";
import API from "Common/UI/Utils/API/API";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPMethod from "Common/Types/API/HTTPMethod";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import Route from "Common/Types/API/Route";
import URL from "Common/Types/API/URL";
import OneUptimeDate from "Common/Types/Date";
import EnterpriseLicenseInstanceSummary from "Common/Types/EnterpriseLicense/EnterpriseLicenseInstanceSummary";
import IconProp from "Common/Types/Icon/IconProp";
import { JSONObject } from "Common/Types/JSON";
import VersionUtil from "Common/Utils/VersionUtil";
import React, {
  FunctionComponent,
  ReactElement,
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";

/*
 * The Enterprise license manager: everything in the edition dialog that
 * changes the license, for a master admin.
 *
 *   - activating it with a license key (POST /global-config/license
 *     { licenseKey }) or, for an installation that cannot reach
 *     oneuptime.com, with a signed token ({ licenseToken });
 *   - refreshing the stored license from oneuptime.com
 *     (POST /global-config/license/refresh);
 *   - replacing it ("Change license key" / "Replace license");
 *   - the seat usage card and the instances on the license.
 *
 * Those routes exist only in the Enterprise server
 * (ee/Server/License/API/LicenseClientAPI.ts), so this UI ships only in the
 * Enterprise image. The core EditionLabel (Common/UI/Components/EditionLabel)
 * keeps the edition pill and the read-only license status, and renders this
 * component through the LicenseManager plugin key of the Dashboard and the
 * Admin Dashboard. Common/UI/Components/EditionLabel/LicenseManager.ts is the
 * contract.
 *
 * One implementation for both frontends: ee/Dashboard/License/Plugins.ts
 * imports it from here. It may therefore import only what both bundles
 * resolve - Common/... and react, never "@oneuptime/admin-dashboard/..." -
 * and ee/Dashboard/tsconfig.json includes this directory so the Dashboard's
 * type check proves it.
 */

const SALES_EMAIL: string = "sales@oneuptime.com";
const SALES_MAILTO_URL: string = "mailto:sales@oneuptime.com";

type ActivationInputMode = "key" | "token";

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

/*
 * What to tell a master admin after a license write the server ACCEPTED.
 *
 * A 200 means the license was stored, not that it licenses anything. The
 * server deliberately stores a license it cannot date - a token with no expiry
 * beside it - because a token is better than nothing and the daily sync may
 * complete it (LicenseClient.validateWithLicenseServer refuses only a license
 * this installation cannot use at all). But such an install is on the
 * unlicensed trial, and past that trial single sign-on, SCIM and audit logging
 * are OFF. A green "License validated successfully." there tells the admin who
 * came to fix exactly that lapse that they have fixed it.
 *
 * Green only while the stored license is genuinely licensing this
 * installation: status "valid", or a grace period that belongs to a LICENSE
 * (graceReason anything but "unlicensed"). Otherwise the classification's own
 * message - which says what is missing and what to do - is shown as a warning,
 * with the license still stored.
 *
 * A response that says nothing about the status is treated as a success, as it
 * always was: that is an older server or a build that does not report one, and
 * inventing a warning out of silence would be its own lie.
 */
interface LicenseWriteOutcome {
  isLicensed: boolean;
  message: string;
}

const LICENSE_STORED_BUT_NOT_LICENSING: string =
  "The license was stored, but this installation cannot confirm that it is current, so enterprise features are not being licensed by it. Refresh the license, or check it on oneuptime.com.";

type DescribeLicenseWriteOutcomeFunction = (
  payload: JSONObject,
  successMessage: string,
) => LicenseWriteOutcome;

const describeLicenseWriteOutcome: DescribeLicenseWriteOutcomeFunction = (
  payload: JSONObject,
  successMessage: string,
): LicenseWriteOutcome => {
  const status: string =
    typeof payload["status"] === "string" ? payload["status"] : "";
  const graceReason: string =
    typeof payload["graceReason"] === "string" ? payload["graceReason"] : "";

  const isLicensed: boolean =
    status === "" ||
    status === "valid" ||
    (status === "grace" && graceReason !== "unlicensed");

  if (isLicensed) {
    return { isLicensed: true, message: successMessage };
  }

  return {
    isLicensed: false,
    message:
      (typeof payload["message"] === "string" && payload["message"]) ||
      LICENSE_STORED_BUT_NOT_LICENSING,
  };
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

const LicenseManager: FunctionComponent<LicenseManagerProps> = (
  props: LicenseManagerProps,
): ReactElement => {
  const license: LicenseSnapshot = props.license;
  const reloadLicense: () => Promise<void> = props.reloadLicense;
  const applySeatEnforcement: (payload: JSONObject) => void =
    props.applySeatEnforcement;

  /*
   * What EditionLabel read from the license GET, under the names the dialog
   * has always used for them.
   */
  const configError: string = license.loadError;
  const isConfigLoading: boolean = license.isLoading;
  const canManageLicense: boolean = license.canManageLicense;
  const licenseValid: boolean = license.licenseValid;
  const isUnlicensedTrial: boolean = license.isUnlicensedTrial;
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

  const [licenseKeyInput, setLicenseKeyInput] = useState<string>("");
  const [validationError, setValidationError] = useState<string>("");
  const [successMessage, setSuccessMessage] = useState<string>("");
  /*
   * A write the server accepted that did not leave this installation licensed
   * (see describeLicenseWriteOutcome). Its own state, not successMessage, so
   * the alert can be a warning rather than a green tick.
   */
  const [licenseWarning, setLicenseWarning] = useState<string>("");
  const [isValidating, setIsValidating] = useState<boolean>(false);
  const [isRefreshingLicense, setIsRefreshingLicense] =
    useState<boolean>(false);
  const [isChangingLicense, setIsChangingLicense] = useState<boolean>(false);
  // Which activation the input section offers: a license key, or a token.
  const [activationInputMode, setActivationInputMode] =
    useState<ActivationInputMode>("key");
  const [licenseTokenInput, setLicenseTokenInput] = useState<string>("");
  const licenseInputEditedRef: React.MutableRefObject<boolean> =
    useRef<boolean>(false);

  /*
   * The fields only this manager shows, read from the same license GET. The
   * server sends them to a master admin only; anybody else gets none.
   */
  const payload: JSONObject = useMemo(() => {
    return license.payload || {};
  }, [license.payload]);

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
   * Every time the license (re)loads, the key input shows the stored key -
   * unless the admin has started typing a new one. A failed load leaves the
   * input alone.
   *
   * Both effects here are layout effects: before the split this happened in
   * the same state update as the load (or the dialog opening), so the dialog
   * never painted the in-between state, and it still must not.
   */
  useLayoutEffect(() => {
    if (!license.payload) {
      return;
    }

    if (!licenseInputEditedRef.current) {
      setLicenseKeyInput(license.licenseKey);
    }
  }, [license.payload, license.licenseKey]);

  /*
   * Opening or closing the dialog clears the outcome of the last action, and
   * closing it abandons a license change in progress. What was typed, and
   * whether the key or the token input is showing, stays.
   */
  useLayoutEffect(() => {
    setValidationError("");
    setSuccessMessage("");
    setLicenseWarning("");

    if (!props.isDialogOpen) {
      setIsChangingLicense(false);
    }
  }, [props.isDialogOpen]);

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

  const licenseKeyHelperText: string = useMemo(() => {
    if (isChangingLicense) {
      return "Enter the new enterprise license key and validate it to replace the current one. Your existing license stays active until the new key is validated.";
    }

    return "You have installed Enterprise Edition of OneUptime. Validate your license key with OneUptime to activate it. Need a license key? Contact our sales team at";
  }, [isChangingLicense]);

  const handleStartChangingLicense: () => void = () => {
    setIsChangingLicense(true);
    setValidationError("");
    setSuccessMessage("");
    setLicenseKeyInput("");
    setLicenseTokenInput("");
    setActivationInputMode(activationMode === "offline" ? "token" : "key");
    licenseInputEditedRef.current = true;
  };

  const handleCancelChangingLicense: () => void = () => {
    setIsChangingLicense(false);
    setValidationError("");
    setLicenseTokenInput("");
    setActivationInputMode("key");
    licenseInputEditedRef.current = false;
    setLicenseKeyInput(license.licenseKey);
  };

  const handleSwitchActivationInputMode: () => void = () => {
    setActivationInputMode(activationInputMode === "key" ? "token" : "key");
    setValidationError("");
    setSuccessMessage("");
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
        setLicenseWarning("");
        return;
      }

      setValidationError("");
      setSuccessMessage("");
      setLicenseWarning("");
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
        /*
         * Stored, but not necessarily licensing anything: the server keeps a
         * license it cannot date rather than refusing it outright.
         */
        const outcome: LicenseWriteOutcome = describeLicenseWriteOutcome(
          payload,
          "License validated successfully.",
        );

        setSuccessMessage(outcome.isLicensed ? outcome.message : "");
        setLicenseWarning(outcome.isLicensed ? "" : outcome.message);
        setIsChangingLicense(false);

        await reloadLicense();
      } catch (err) {
        setValidationError(API.getFriendlyMessage(err));
      } finally {
        setLoading(false);
      }
    },
    [reloadLicense],
  );

  /*
   * Offline activation: a signed license token, for an installation that
   * cannot reach oneuptime.com. The server accepts only a token signed by a
   * key this OneUptime release trusts, and says so when it does not.
   */
  const runOfflineActivation: (token: string) => Promise<void> = useCallback(
    async (token: string): Promise<void> => {
      const trimmedToken: string = token.trim();

      if (!trimmedToken) {
        setValidationError("Please paste a license token before activating.");
        setSuccessMessage("");
        setLicenseWarning("");
        return;
      }

      setValidationError("");
      setSuccessMessage("");
      setLicenseWarning("");
      setIsValidating(true);

      try {
        const activationUrl: URL = URL.fromURL(APP_API_URL).addRoute(
          new Route("/global-config/license"),
        );

        const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
          await API.fetch<JSONObject>({
            method: HTTPMethod.POST,
            url: activationUrl,
            data: {
              licenseToken: trimmedToken,
            },
          });

        if (!response.isSuccess()) {
          throw response;
        }

        setLicenseTokenInput("");

        const outcome: LicenseWriteOutcome = describeLicenseWriteOutcome(
          (response.data as JSONObject) || {},
          "License activated offline.",
        );

        setSuccessMessage(outcome.isLicensed ? outcome.message : "");
        setLicenseWarning(outcome.isLicensed ? "" : outcome.message);
        setIsChangingLicense(false);
        setActivationInputMode("key");

        await reloadLicense();
      } catch (err) {
        setValidationError(API.getFriendlyMessage(err));
      } finally {
        setIsValidating(false);
      }
    },
    [reloadLicense],
  );

  const handleValidateClick: () => void = () => {
    if (isValidating) {
      return;
    }

    if (activationInputMode === "token") {
      void runOfflineActivation(licenseTokenInput);
      return;
    }

    void runLicenseValidation(licenseKeyInput, setIsValidating);
  };

  /*
   * Re-ask oneuptime.com about the license this installation already holds.
   *
   * The seat limit and the expiry are changed on oneuptime.com, and the daily
   * report job is what normally carries them here - so without this, an
   * administrator who has just bought seats waits up to a day before the
   * installation stops refusing invitations. Deliberately sends no key: the
   * server refreshes the stored one.
   */
  const handleRefreshLicense: () => void = useCallback((): void => {
    if (isRefreshingLicense) {
      return;
    }

    const refresh: () => Promise<void> = async (): Promise<void> => {
      setValidationError("");
      setSuccessMessage("");
      setLicenseWarning("");
      setIsRefreshingLicense(true);

      try {
        const refreshUrl: URL = URL.fromURL(APP_API_URL).addRoute(
          new Route("/global-config/license/refresh"),
        );

        const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
          await API.fetch<JSONObject>({
            method: HTTPMethod.POST,
            url: refreshUrl,
          });

        if (!response.isSuccess()) {
          throw response;
        }

        applySeatEnforcement(response.data as JSONObject);

        const outcome: LicenseWriteOutcome = describeLicenseWriteOutcome(
          (response.data as JSONObject) || {},
          "License refreshed from OneUptime.",
        );

        setSuccessMessage(outcome.isLicensed ? outcome.message : "");
        setLicenseWarning(outcome.isLicensed ? "" : outcome.message);

        /*
         * The POST already returned the new terms, but the modal renders from
         * what the GET reports - re-reading keeps one source of truth for the
         * whole dialog instead of two that can disagree.
         */
        await reloadLicense();
      } catch (err) {
        setValidationError(API.getFriendlyMessage(err));
      } finally {
        setIsRefreshingLicense(false);
      }
    };

    void refresh();
  }, [isRefreshingLicense, reloadLicense, applySeatEnforcement]);

  /*
   * The trial counts as "no license yet" here: an administrator trying the
   * Enterprise Edition should be able to add the license from the same place
   * as one whose license lapsed.
   */
  const showLicenseKeyInput: boolean =
    canManageLicense &&
    (!licenseValid || isUnlicensedTrial || isChangingLicense);

  /*
   * The seat and instance cards are built from figures the server gives a
   * master admin only; anybody else would see an empty "unlimited" card.
   */
  const showSeatDetails: boolean = showLicenseDetails && canManageLicense;

  /*
   * GlobalConfigAPI returns userLimit and currentUserCount to anonymous callers
   * because the same route serves the signed-out login page, and gates only
   * licenseKey, token, instances and instanceId on isAuthenticatedUser. Gate
   * the sales ask on a field the server does redact, so a signed-out visitor is
   * never shown an administrator-targeted CTA.
   */
  const canSeeLicenseAdmin: boolean = Boolean(license.licenseKey);

  const leftFooterElement: ReactElement | undefined =
    showLicenseDetails && !isChangingLicense && canManageLicense ? (
      <div className="flex flex-wrap items-center gap-2">
        {/*
         * The seat limit and the expiry are changed on oneuptime.com and reach
         * this installation through the daily report job. This is the button
         * for the administrator who has just bought seats and would rather not
         * wait a day for the installation to stop refusing invitations.
         */}
        {/*
         * An installation activated offline has no key to refresh with; a new
         * token replaces the license instead.
         */}
        {activationMode !== "offline" && (
          <Button
            title="Refresh license"
            icon={IconProp.Refresh}
            buttonStyle={ButtonStyleType.NORMAL}
            onClick={handleRefreshLicense}
            isLoading={isRefreshingLicense}
            disabled={isRefreshingLicense || isConfigLoading}
            tooltip="Fetch the latest seat limit and expiry for this license from OneUptime."
            dataTestId="refresh-enterprise-license"
            className="!mt-0 md:!ml-0"
          />
        )}
        <Button
          title={
            activationMode === "offline"
              ? "Replace license"
              : "Change license key"
          }
          icon={IconProp.Edit}
          buttonStyle={ButtonStyleType.NORMAL}
          onClick={handleStartChangingLicense}
          disabled={isRefreshingLicense}
          className="!mt-0 md:!ml-0"
        />
      </div>
    ) : undefined;

  // Top of the dialog body.
  const messages: ReactElement = (
    <>
                {!configError && successMessage && (
                  <Alert type={AlertType.SUCCESS} title={successMessage} />
                )}

                {/*
                 * The server stored the license and still says it is not
                 * licensing this installation (describeLicenseWriteOutcome).
                 * Same place as the success alert, because it answers the same
                 * question - "did that work?" - and the answer is "not yet".
                 */}
                {!configError && licenseWarning && (
                  <Alert
                    type={AlertType.WARNING}
                    title={licenseWarning}
                    dataTestId="enterprise-license-stored-warning"
                  />
                )}

                {/*
                 * A failed refresh has nowhere else to go: the license key
                 * section carries its own copy of this alert, but that
                 * section is not rendered at all while the license is valid,
                 * which is exactly when refreshing is worth doing.
                 */}
                {!configError && validationError && !showLicenseKeyInput && (
                  <Alert type={AlertType.DANGER} title={validationError} />
                )}
    </>
  );

  // After the version card.
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
                         * Only pointed at somebody who can actually press it.
                         * The refresh button is master-admin only, so telling
                         * everyone else to use it would be an instruction they
                         * cannot follow.
                         */}
                        {isSeatLimitEnforced && canManageLicense && (
                          <>
                            {" "}
                            Bought more seats? Use &quot;Refresh license&quot;
                            below to apply the new limit without waiting for the
                            next daily report.
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

  // After the notice for somebody who cannot manage the license.
  const activation: ReactElement = (
    <>
                {!configError && showLicenseKeyInput && (
                  <section className="rounded-xl border border-gray-200 bg-white p-5">
                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0">
                        <label
                          htmlFor={
                            activationInputMode === "token"
                              ? "enterprise-license-token"
                              : "enterprise-license-key"
                          }
                          className="text-sm font-semibold text-gray-900"
                        >
                          {activationInputMode === "token"
                            ? "License token (offline activation)"
                            : isChangingLicense
                              ? "New license key"
                              : "License key"}
                        </label>
                        <p className="mt-0.5 text-xs leading-relaxed text-gray-500">
                          {activationInputMode === "token"
                            ? "For an installation that cannot reach oneuptime.com. Paste the signed license token OneUptime issued for this installation. Only tokens signed by a key this OneUptime release trusts are accepted."
                            : licenseKeyHelperText}
                          {!isChangingLicense &&
                            activationInputMode === "key" && (
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
                      {activationInputMode === "token" ? (
                        <TextArea
                          id="enterprise-license-token"
                          value={licenseTokenInput}
                          onChange={(value: string) => {
                            setLicenseTokenInput(value);
                          }}
                          placeholder="Paste the signed license token"
                          disableSpellCheck={true}
                          dataTestId="enterprise-license-token-input"
                        />
                      ) : (
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
                      )}
                    </div>
                    <div className="mt-2">
                      <button
                        type="button"
                        onClick={handleSwitchActivationInputMode}
                        data-testid="switch-license-activation-mode"
                        className="text-xs font-medium text-indigo-600 hover:text-indigo-700 focus:outline-none focus-visible:underline"
                      >
                        {activationInputMode === "token"
                          ? "Use a license key instead"
                          : "No internet access? Activate offline with a license token"}
                      </button>
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
    </>
  );

  return props.renderDialog({
    messages: messages,
    usage: usage,
    activation: activation,
    submitButtonText: showLicenseKeyInput
      ? activationInputMode === "token"
        ? "Activate License"
        : "Validate License"
      : undefined,
    onSubmit: showLicenseKeyInput ? handleValidateClick : undefined,
    isSubmitting: showLicenseKeyInput ? isValidating : false,
    disableSubmitButton: showLicenseKeyInput
      ? !(
          activationInputMode === "token" ? licenseTokenInput : licenseKeyInput
        ).trim() ||
        isValidating ||
        isConfigLoading
      : undefined,
    leftFooterElement: leftFooterElement,
  });
};

export default LicenseManager;

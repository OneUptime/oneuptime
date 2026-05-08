import Modal, { ModalWidth } from "../Modal/Modal";
import Icon, { IconType, SizeProp } from "../Icon/Icon";
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

export interface ComponentProps {
  className?: string | undefined;
}

const ENTERPRISE_URL: string = "https://oneuptime.com/enterprise/demo";

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
  const licenseInputEditedRef: React.MutableRefObject<boolean> =
    useRef<boolean>(false);

  if (BILLING_ENABLED) {
    return <></>;
  }

  const fetchGlobalConfig: () => Promise<void> =
    useCallback(async (): Promise<void> => {
      if (!IS_ENTERPRISE_EDITION) {
        return;
      }

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

        if (!licenseInputEditedRef.current) {
          setLicenseKeyInput(configModel.enterpriseLicenseKey || "");
        }
      } catch (err) {
        setGlobalConfig(null);
        setConfigError(API.getFriendlyMessage(err));
      } finally {
        setIsConfigLoading(false);
      }
    }, []);

  useEffect(() => {
    void fetchGlobalConfig();
  }, [fetchGlobalConfig]);

  const licenseValid: boolean = useMemo(() => {
    if (!IS_ENTERPRISE_EDITION) {
      return false;
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

  const userUsagePercent: number | null = useMemo(() => {
    if (typeof userLimit !== "number" || userLimit <= 0) {
      return null;
    }

    if (typeof currentUserCount !== "number") {
      return null;
    }

    return Math.min(
      100,
      Math.max(0, Math.round((currentUserCount / userLimit) * 100)),
    );
  }, [userLimit, currentUserCount]);

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

    if (isUserLimitBreached) {
      return "bg-red-500";
    }

    return "bg-emerald-500";
  }, [isConfigLoading, licenseValid, isUserLimitBreached]);

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

    if (isUserLimitBreached) {
      return "User limit exceeded";
    }

    return "View details";
  }, [isConfigLoading, licenseValid, isUserLimitBreached]);

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

    if (IS_ENTERPRISE_EDITION) {
      void fetchGlobalConfig();
    }
  };

  const closeDialog: () => void = () => {
    setIsDialogOpen(false);
    setValidationError("");
    setSuccessMessage("");
  };

  const handlePrimaryAction: () => void = () => {
    if (typeof window !== "undefined") {
      window.open(ENTERPRISE_URL, "_blank", "noopener,noreferrer");
    }

    closeDialog();
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

  const shouldShowEnterpriseValidationButton: boolean =
    IS_ENTERPRISE_EDITION && !licenseValid;

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

  const showAlertedPill: boolean =
    IS_ENTERPRISE_EDITION &&
    !isConfigLoading &&
    (isUserLimitBreached ||
      (!licenseValid && Boolean(globalConfig?.enterpriseLicenseKey)));

  const pillClassName: string = showAlertedPill
    ? "group inline-flex items-center gap-2 rounded-full border border-red-200 bg-red-50 px-3 py-1 text-xs font-medium text-red-700 shadow-sm transition hover:border-red-300 hover:bg-red-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-400"
    : "group inline-flex items-center gap-2 rounded-full border border-indigo-100 bg-white px-3 py-1 text-xs font-medium text-indigo-700 shadow-sm transition hover:border-indigo-300 hover:bg-indigo-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400";

  const pillCtaTextClassName: string = showAlertedPill
    ? "text-[11px] text-red-500 group-hover:text-red-600"
    : "text-[11px] text-indigo-500 group-hover:text-indigo-600";

  return (
    <>
      <button
        type="button"
        onClick={openDialog}
        className={`${pillClassName} ${props.className ? props.className : ""}`}
        aria-label={`${editionName} details`}
      >
        {showAlertedPill && (
          <Icon
            icon={IconProp.Alert}
            size={SizeProp.Small}
            className="text-red-600"
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
          submitButtonText={modalSubmitButtonText}
          closeButtonText="Close"
          onClose={closeDialog}
          onSubmit={modalOnSubmit}
          modalWidth={ModalWidth.Large}
          isLoading={modalIsLoading}
          disableSubmitButton={modalDisableSubmitButton}
          isBodyLoading={IS_ENTERPRISE_EDITION ? isConfigLoading : false}
        >
          <div className="space-y-3 text-sm text-gray-600">
            {IS_ENTERPRISE_EDITION ? (
              <>
                {configError && (
                  <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                    <p className="font-semibold">
                      Unable to load license details
                    </p>
                    <p className="mt-1">{configError}</p>
                    <div className="mt-3 -ml-3">
                      <Button
                        title="Retry"
                        buttonStyle={ButtonStyleType.DANGER}
                        onClick={handleRetryFetch}
                        isLoading={isConfigLoading}
                      />
                    </div>
                  </div>
                )}

                {!configError && !isConfigLoading && licenseValid && (
                  <div className="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700">
                    <p className="font-semibold">License verified</p>
                    <p className="mt-1">
                      <span className="font-medium">Company:</span>{" "}
                      {globalConfig?.enterpriseCompanyName || "Not specified"}
                    </p>
                    {licenseExpiresAtText && (
                      <p>
                        <span className="font-medium">Expires:</span>{" "}
                        {licenseExpiresAtText}
                      </p>
                    )}
                  </div>
                )}

                {!configError && !isConfigLoading && licenseValid && (
                  <div
                    className={`rounded-lg border p-4 shadow-sm ${
                      isUserLimitBreached
                        ? "border-red-200 bg-red-50"
                        : "border-gray-200 bg-white"
                    }`}
                  >
                    <div className="flex items-start gap-3">
                      <div
                        className={`flex h-9 w-9 items-center justify-center rounded-full ${
                          isUserLimitBreached
                            ? "bg-red-100 text-red-600"
                            : "bg-indigo-100 text-indigo-600"
                        }`}
                      >
                        <Icon
                          icon={
                            isUserLimitBreached ? IconProp.Alert : IconProp.User
                          }
                          size={SizeProp.Regular}
                        />
                      </div>
                      <div className="flex-1">
                        <div className="flex items-center justify-between">
                          <h3
                            className={`text-sm font-semibold ${
                              isUserLimitBreached
                                ? "text-red-900"
                                : "text-gray-900"
                            }`}
                          >
                            User Usage
                          </h3>
                          {isUserLimitBreached && (
                            <span className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700">
                              Limit exceeded
                            </span>
                          )}
                        </div>

                        <div className="mt-2 flex items-baseline gap-1">
                          <span
                            className={`text-2xl font-semibold ${
                              isUserLimitBreached
                                ? "text-red-700"
                                : "text-gray-900"
                            }`}
                          >
                            {typeof currentUserCount === "number"
                              ? currentUserCount.toLocaleString()
                              : "—"}
                          </span>
                          <span className="text-sm text-gray-500">
                            {" / "}
                            {typeof userLimit === "number" && userLimit > 0
                              ? `${userLimit.toLocaleString()} users`
                              : "unlimited"}
                          </span>
                        </div>

                        {typeof userUsagePercent === "number" && (
                          <div className="mt-3">
                            <div className="h-2 w-full overflow-hidden rounded-full bg-gray-200">
                              <div
                                className={`h-full rounded-full transition-all ${
                                  isUserLimitBreached
                                    ? "bg-red-500"
                                    : userUsagePercent >= 80
                                      ? "bg-amber-500"
                                      : "bg-emerald-500"
                                }`}
                                style={{ width: `${userUsagePercent}%` }}
                              />
                            </div>
                            <p className="mt-1 text-xs text-gray-500">
                              {userUsagePercent}% of licensed seats in use
                            </p>
                          </div>
                        )}

                        {isUserLimitBreached && (
                          <p className="mt-3 text-xs text-red-700">
                            Your installation has more users than your license
                            permits. Please contact{" "}
                            <a
                              href="mailto:sales@oneuptime.com"
                              className="font-medium text-red-800 underline hover:text-red-900"
                            >
                              sales@oneuptime.com
                            </a>{" "}
                            to expand your license.
                          </p>
                        )}

                        <p className="mt-3 text-xs text-gray-500">
                          {userCountUpdatedAtText
                            ? `Last reported to OneUptime on ${userCountUpdatedAtText}.`
                            : "User count has not been reported to OneUptime yet. The first report will be sent within 24 hours."}
                        </p>
                      </div>
                    </div>
                  </div>
                )}

                {!configError &&
                  !isConfigLoading &&
                  !licenseValid &&
                  globalConfig?.enterpriseLicenseKey && (
                    <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                      <p className="font-semibold">
                        License validation required
                      </p>
                      <p className="mt-1">
                        The stored license information could not be verified.
                        Please validate the license key again.
                      </p>
                    </div>
                  )}

                {!configError && (
                  <>
                    {successMessage && (
                      <Alert type={AlertType.SUCCESS} title={successMessage} />
                    )}

                    {!licenseValid && (
                      <>
                        <div>
                          <label className="text-sm font-medium text-gray-700">
                            License Key
                          </label>
                          <Input
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
                          <Alert
                            type={AlertType.DANGER}
                            title={validationError}
                          />
                        )}

                        <p className="text-xs text-gray-500">
                          You have installed Enterprise Edition of OneUptime.
                          You need to validate your license key. Need a license
                          key? Contact our sales team at{" "}
                          <a
                            href="mailto:sales@oneuptime.com"
                            className="font-medium text-indigo-600 hover:text-indigo-700"
                          >
                            sales@oneuptime.com
                          </a>
                          .
                        </p>
                      </>
                    )}
                  </>
                )}

                <div className="rounded-lg border border-indigo-200 bg-indigo-50 p-4 shadow-sm">
                  <h3 className="text-sm font-semibold text-indigo-900">
                    Enterprise Edition Features
                  </h3>
                  <ul className="mt-3 space-y-2 text-sm text-indigo-900">
                    {enterpriseFeatures.map(
                      (feature: string, index: number) => {
                        return (
                          <li key={index} className="flex items-start gap-2">
                            <Icon
                              icon={IconProp.Check}
                              type={IconType.Success}
                              size={SizeProp.Small}
                              className="mt-0.5"
                            />
                            <span className="leading-snug">{feature}</span>
                          </li>
                        );
                      },
                    )}
                  </ul>
                  <p className="mt-3 text-xs text-indigo-700">
                    Already have a license? Validate it above to unlock these
                    premium capabilities immediately.
                  </p>
                </div>
              </>
            ) : (
              <>
                <p>
                  You are running the Community Edition of OneUptime. Here is a
                  quick comparison to help you decide if Enterprise is the right
                  fit for your team.
                </p>
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
                    <h3 className="text-sm font-semibold text-gray-900">
                      Community Edition
                    </h3>
                    <ul className="mt-3 space-y-2 text-sm text-gray-600">
                      {communityFeatures.map(
                        (feature: string, index: number) => {
                          return (
                            <li key={index} className="flex items-start gap-2">
                              <Icon
                                icon={IconProp.Check}
                                size={SizeProp.Small}
                                className="mt-0.5 text-gray-400"
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
                  <div className="rounded-lg border border-indigo-200 bg-indigo-50 p-4 shadow-sm">
                    <h3 className="text-sm font-semibold text-indigo-900">
                      Enterprise Edition
                    </h3>
                    <ul className="mt-3 space-y-2 text-sm text-indigo-900">
                      {enterpriseFeatures.map(
                        (feature: string, index: number) => {
                          return (
                            <li key={index} className="flex items-start gap-2">
                              <Icon
                                icon={IconProp.Check}
                                type={IconType.Success}
                                size={SizeProp.Small}
                                className="mt-0.5"
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

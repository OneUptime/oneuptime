import LicenseActivationForm, {
  ActivationInputMode,
} from "./LicenseActivationForm";
import LicenseDetails from "./LicenseDetails";
import { LicenseSettingsCopy } from "./LicenseSettingsCopy";
import {
  activateLicenseKey,
  activateLicenseToken,
  fetchLicense,
  refreshLicense,
} from "./LicenseSettingsAPI";
import {
  describeLicenseStatus,
  describeLicenseWriteOutcome,
  isLicensed,
  LicenseStatusSummary,
  LicenseStatusTone,
  LicenseWriteOutcome,
  toLicenseSnapshot,
  writeLicenseDate,
} from "./LicenseStatus";
import OneUptimeDate from "Common/Types/Date";
import IconProp from "Common/Types/Icon/IconProp";
import { JSONObject } from "Common/Types/JSON";
import { ReadingDirection } from "Common/Types/ReadingDirection";
import Alert, { AlertType } from "Common/UI/Components/Alerts/Alert";
import Button, { ButtonStyleType } from "Common/UI/Components/Button/Button";
import Card from "Common/UI/Components/Card/Card";
import CopyableButton from "Common/UI/Components/CopyableButton/CopyableButton";
import { announceLicenseChanged } from "Common/UI/Components/EditionLabel/LicenseEvents";
import { LicenseSnapshot } from "Common/UI/Components/EditionLabel/LicenseDetails";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import HiddenText from "Common/UI/Components/HiddenText/HiddenText";
import Icon from "Common/UI/Components/Icon/Icon";
import IsolatedLine, {
  getIsolatedLine,
} from "Common/UI/Components/IsolatedText/IsolatedLine";
import PageLoader from "Common/UI/Components/Loader/PageLoader";
import API from "Common/UI/Utils/API/API";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  FunctionComponent,
  ReactElement,
  ReactNode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";

/*
 * Settings > License: the one place the license is changed. A master admin
 * sees where the license stands, and from here adds it (with a key, or a
 * signed token offline), refreshes it from oneuptime.com and replaces it.
 * Everybody else - and a master admin in the Dashboard - has the edition
 * pill's dialog, which only shows the status and leads here.
 *
 * The Admin Dashboard is a master admin's and the server checks every write
 * again (ee/Server/License/API/LicenseClientAPI.ts), so nothing here is a
 * check of its own.
 *
 * In the reader's language: every word is a key of ./LicenseSettingsCopy.ts.
 * The shared components (Card, Button, Alert, ErrorMessage) draw the keys
 * they are given in the reader's language themselves; what this page draws
 * as text it translates here. The license key, the instance ID and the
 * licensed company's name are drawn as written, and read in their own
 * direction on an Arabic or Persian page.
 */

const STATUS_ICON: Record<LicenseStatusTone, IconProp> = {
  healthy: IconProp.CheckCircle,
  warning: IconProp.ExclaimationCircle,
  critical: IconProp.Alert,
};

const STATUS_ICON_CLASS_NAME: Record<LicenseStatusTone, string> = {
  healthy: "bg-emerald-50 text-emerald-700",
  warning: "bg-amber-50 text-amber-700",
  critical: "bg-red-50 text-red-700",
};

// How a fact's value is drawn: one line, cut short where its box ends.
const FACT_VALUE_CLASS_NAME: string =
  "mt-1 truncate text-sm font-medium text-gray-900";

interface LicenseFact {
  // The English key: the fact's label, and its React key.
  label: string;
  value: ReactNode;
  title?: string | undefined;
  /*
   * A value written as someone wrote it (the licensed company's name): its
   * box reads the way its words do, so on an Arabic or Persian page a Latin
   * name is cut short at its own end rather than losing its start.
   */
  dir?: ReadingDirection | undefined;
  className?: string | undefined;
}

type FormatExpiryFunction = (value: unknown) => string;

// The expiry in the page's language ("2. März 2027"), or a dash.
const formatExpiry: FormatExpiryFunction = (value: unknown): string => {
  if (typeof value !== "string" || !value) {
    return "—";
  }

  const date: Date = OneUptimeDate.fromString(value);

  return Number.isNaN(date.getTime()) ? "—" : writeLicenseDate(date);
};

const LicenseSettingsView: FunctionComponent = (): ReactElement => {
  const { t } = useTranslation();
  const translator: Translator = useTranslator();
  const [payload, setPayload] = useState<JSONObject | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [loadError, setLoadError] = useState<string>("");

  const [licenseKeyInput, setLicenseKeyInput] = useState<string>("");
  const [licenseTokenInput, setLicenseTokenInput] = useState<string>("");
  // Which activation the form offers: a license key, or a token.
  const [activationInputMode, setActivationInputMode] =
    useState<ActivationInputMode>("key");
  const [isChangingLicense, setIsChangingLicense] = useState<boolean>(false);
  const [isActivating, setIsActivating] = useState<boolean>(false);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);

  const [actionError, setActionError] = useState<string>("");
  const [successMessage, setSuccessMessage] = useState<string>("");
  /*
   * A write the server accepted that did not leave this installation licensed
   * (see describeLicenseWriteOutcome). Its own state, not successMessage, so
   * the alert can be a warning rather than a green tick.
   */
  const [licenseWarning, setLicenseWarning] = useState<string>("");

  const licenseInputEditedRef: React.MutableRefObject<boolean> =
    useRef<boolean>(false);

  const loadLicense: () => Promise<void> =
    useCallback(async (): Promise<void> => {
      setIsLoading(true);
      setLoadError("");

      try {
        setPayload(await fetchLicense());
      } catch (err) {
        setPayload(null);
        setLoadError(API.getFriendlyMessage(err));
      } finally {
        setIsLoading(false);
      }
    }, []);

  useEffect(() => {
    void loadLicense();
  }, [loadLicense]);

  const license: LicenseSnapshot | null = useMemo(() => {
    return payload ? toLicenseSnapshot(payload) : null;
  }, [payload]);

  const storedLicenseKey: string = license?.licenseKey || "";

  /*
   * The key input shows the stored key, for a license that needs validating
   * again - unless the admin has started typing a new one. A layout effect,
   * so the form never paints empty first.
   */
  useLayoutEffect(() => {
    if (!licenseInputEditedRef.current) {
      setLicenseKeyInput(storedLicenseKey);
    }
  }, [storedLicenseKey]);

  const clearOutcome: () => void = (): void => {
    setActionError("");
    setSuccessMessage("");
    setLicenseWarning("");
  };

  /*
   * The server answered a write with the license as it now stands, the same
   * body the GET gives a master admin, so the page shows it without asking
   * again; the edition pill in the header reads it for itself.
   */
  const applyLicenseWrite: (
    response: JSONObject,
    successText: string,
  ) => void = (response: JSONObject, successText: string): void => {
    const outcome: LicenseWriteOutcome = describeLicenseWriteOutcome(
      response,
      successText,
    );

    setSuccessMessage(outcome.isLicensed ? outcome.message : "");
    setLicenseWarning(outcome.isLicensed ? "" : outcome.message);
    setPayload(response);
    announceLicenseChanged();
  };

  const activateWithKey: () => Promise<void> = async (): Promise<void> => {
    const trimmedKey: string = licenseKeyInput.trim();

    if (!trimmedKey) {
      setActionError(LicenseSettingsCopy.enterLicenseKeyFirst);
      return;
    }

    setIsActivating(true);

    try {
      const response: JSONObject = await activateLicenseKey(trimmedKey);

      licenseInputEditedRef.current = false;
      setLicenseKeyInput((response["licenseKey"] as string) || trimmedKey);
      setIsChangingLicense(false);
      applyLicenseWrite(response, LicenseSettingsCopy.licenseValidated);
    } catch (err) {
      setActionError(API.getFriendlyMessage(err));
    } finally {
      setIsActivating(false);
    }
  };

  /*
   * Offline activation: a signed license token, for an installation that
   * cannot reach oneuptime.com. The server accepts only a token signed by a
   * key this OneUptime release trusts, and says so when it does not.
   */
  const activateWithToken: () => Promise<void> = async (): Promise<void> => {
    const trimmedToken: string = licenseTokenInput.trim();

    if (!trimmedToken) {
      setActionError(LicenseSettingsCopy.pasteLicenseTokenFirst);
      return;
    }

    setIsActivating(true);

    try {
      const response: JSONObject = await activateLicenseToken(trimmedToken);

      setLicenseTokenInput("");
      setIsChangingLicense(false);
      setActivationInputMode("key");
      applyLicenseWrite(response, LicenseSettingsCopy.licenseActivatedOffline);
    } catch (err) {
      setActionError(API.getFriendlyMessage(err));
    } finally {
      setIsActivating(false);
    }
  };

  const handleActivate: () => void = (): void => {
    if (isActivating) {
      return;
    }

    clearOutcome();

    if (activationInputMode === "token") {
      void activateWithToken();
      return;
    }

    void activateWithKey();
  };

  /*
   * Re-ask oneuptime.com about the license this installation already holds.
   *
   * The seat limit and the expiry are changed on oneuptime.com, and the daily
   * report job is what normally carries them here - so without this, an
   * administrator who has just bought seats waits up to a day before the
   * installation stops refusing invitations.
   */
  const handleRefresh: () => void = (): void => {
    if (isRefreshing) {
      return;
    }

    const refresh: () => Promise<void> = async (): Promise<void> => {
      clearOutcome();
      setIsRefreshing(true);

      try {
        applyLicenseWrite(
          await refreshLicense(),
          LicenseSettingsCopy.licenseRefreshed,
        );
      } catch (err) {
        setActionError(API.getFriendlyMessage(err));
      } finally {
        setIsRefreshing(false);
      }
    };

    void refresh();
  };

  const handleStartChangingLicense: () => void = (): void => {
    clearOutcome();
    setIsChangingLicense(true);
    setLicenseKeyInput("");
    setLicenseTokenInput("");
    setActivationInputMode(
      payload?.["activationMode"] === "offline" ? "token" : "key",
    );
    licenseInputEditedRef.current = true;
  };

  const handleCancelChangingLicense: () => void = (): void => {
    setIsChangingLicense(false);
    setActionError("");
    setLicenseTokenInput("");
    setActivationInputMode("key");
    licenseInputEditedRef.current = false;
    setLicenseKeyInput(storedLicenseKey);
  };

  const handleSwitchActivationInputMode: () => void = (): void => {
    setActivationInputMode(activationInputMode === "key" ? "token" : "key");
    clearOutcome();
  };

  if (isLoading) {
    return <PageLoader isVisible={true} />;
  }

  if (!payload || !license) {
    return (
      <ErrorMessage
        message={loadError || LicenseSettingsCopy.licenseCouldNotBeRead}
        onRefreshClick={() => {
          void loadLicense();
        }}
      />
    );
  }

  const status: LicenseStatusSummary = describeLicenseStatus(
    payload,
    undefined,
    translator,
  );
  const hasLicense: boolean = isLicensed(payload);
  const isMarketplaceLicense: boolean = Boolean(payload["marketplace"]);
  const isOfflineLicense: boolean = payload["activationMode"] === "offline";
  const instanceId: string =
    typeof payload["instanceId"] === "string" ? payload["instanceId"] : "";

  const showActivationForm: boolean = !hasLicense || isChangingLicense;

  /*
   * What is in place. The company and the expiry only mean something for a
   * real license; a marketplace subscription has no key and no fixed expiry.
   * While the form is showing nothing is in place to read, and the form says
   * the instance ID where it matters: beside a token.
   */
  const companyNameLine: {
    dir: ReadingDirection | undefined;
    className: string;
  } = getIsolatedLine({
    text: license.companyName,
    pageLanguage: translator.language,
    className: FACT_VALUE_CLASS_NAME,
  });

  const facts: Array<LicenseFact> = [
    ...(hasLicense && !isMarketplaceLicense
      ? [
          {
            label: LicenseSettingsCopy.licensedTo,
            value:
              license.companyName ||
              translator.translateText(LicenseSettingsCopy.notSpecified),
            title: license.companyName || undefined,
            dir: companyNameLine.dir,
            className: companyNameLine.className,
          },
          {
            label: LicenseSettingsCopy.expires,
            value: formatExpiry(payload["expiresAt"]),
          },
        ]
      : []),
    ...(license.licenseKey && !showActivationForm
      ? [
          {
            label: LicenseSettingsCopy.licenseKey,
            // Drawn left to right in every language (HiddenText).
            value: <HiddenText text={license.licenseKey} isCopyable={true} />,
          },
        ]
      : []),
    ...(hasLicense && isOfflineLicense
      ? [
          {
            label: LicenseSettingsCopy.activation,
            value: translator.translateText(
              LicenseSettingsCopy.activatedOffline,
            ),
          },
        ]
      : []),
    ...(instanceId && !showActivationForm
      ? [
          {
            label: LicenseSettingsCopy.instanceId,
            value: (
              <span
                className="group inline-flex max-w-full items-center gap-1 font-mono text-xs"
                data-testid="license-instance-id"
              >
                {/*
                 * An identifier: left to right on every page, so it is cut
                 * short at its own end.
                 */}
                <span className="truncate" dir="ltr" title={instanceId}>
                  {instanceId}
                </span>
                <CopyableButton textToBeCopied={instanceId} />
              </span>
            ),
          },
        ]
      : []),
  ];

  /*
   * An installation activated offline has no key to refresh with, and a
   * marketplace license renews itself with every usage report the marketplace
   * accepts: a new token, or a new key, replaces either.
   */
  const cardButtons: Array<ReactElement> =
    hasLicense && !isChangingLicense
      ? [
          ...(!isOfflineLicense && !isMarketplaceLicense
            ? [
                <Button
                  key="refresh"
                  title={LicenseSettingsCopy.refreshLicense}
                  icon={IconProp.Refresh}
                  buttonStyle={ButtonStyleType.OUTLINE}
                  onClick={handleRefresh}
                  isLoading={isRefreshing}
                  disabled={isRefreshing}
                  tooltip={LicenseSettingsCopy.refreshLicenseTooltip}
                  dataTestId="refresh-enterprise-license"
                />,
              ]
            : []),
          <Button
            key="change"
            title={
              isOfflineLicense
                ? LicenseSettingsCopy.replaceLicense
                : LicenseSettingsCopy.changeLicenseKey
            }
            icon={IconProp.Edit}
            buttonStyle={ButtonStyleType.OUTLINE}
            onClick={handleStartChangingLicense}
            disabled={isRefreshing}
            dataTestId="change-enterprise-license"
          />,
        ]
      : [];

  return (
    <div className="space-y-4">
      <Card
        title={t("breadcrumbs.enterpriseLicense")}
        description={LicenseSettingsCopy.cardDescription}
        buttons={cardButtons}
      >
        <div>
          {(successMessage || licenseWarning) && (
            <div className="mb-5 space-y-3">
              {successMessage && (
                <Alert type={AlertType.SUCCESS} title={successMessage} />
              )}
              {/*
               * The server stored the license and still says it is not
               * licensing this installation (describeLicenseWriteOutcome).
               * Same place as the success alert, because it answers the same
               * question - "did that work?" - and the answer is "not yet".
               */}
              {licenseWarning && (
                <Alert
                  type={AlertType.WARNING}
                  title={licenseWarning}
                  dataTestId="enterprise-license-stored-warning"
                />
              )}
            </div>
          )}

          {/*
           * A failed refresh has nowhere else to go: the activation form
           * carries its own copy of this alert, but it is not drawn at all
           * while the license is valid, which is exactly when refreshing is
           * worth doing.
           */}
          {actionError && !showActivationForm && (
            <div className="mb-5">
              <Alert type={AlertType.DANGER} title={actionError} />
            </div>
          )}

          <div
            className="flex items-start gap-3"
            data-testid="license-status"
            data-tone={status.tone}
          >
            <div
              className={`flex h-10 w-10 flex-none items-center justify-center rounded-full ${STATUS_ICON_CLASS_NAME[status.tone]}`}
            >
              <Icon icon={STATUS_ICON[status.tone]} className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <h3 className="text-sm font-semibold text-gray-900">
                {status.title}
              </h3>
              {status.description && (
                <p className="mt-1 max-w-3xl text-sm leading-relaxed text-gray-600">
                  {status.description}
                </p>
              )}
              {/*
               * What the license client said, as the server sent it: a
               * line of its own, so on an Arabic or Persian page an English
               * diagnosis reads left to right with its full stop at its end.
               */}
              {status.serverMessage && (
                <IsolatedLine
                  as="p"
                  text={status.serverMessage}
                  className="mt-1 max-w-3xl break-words text-sm leading-relaxed text-gray-600"
                  dataTestId="license-status-server-message"
                />
              )}
              {status.note && (
                <p className="mt-1.5 max-w-3xl text-xs leading-relaxed text-gray-500">
                  {status.note}
                </p>
              )}
            </div>
          </div>

          {facts.length > 0 && (
            <dl className="mt-5 grid grid-cols-1 gap-x-8 gap-y-4 border-t border-gray-100 pt-5 sm:grid-cols-2">
              {facts.map((fact: LicenseFact): ReactElement => {
                return (
                  <div key={fact.label} className="min-w-0">
                    <dt className="text-xs font-medium text-gray-500">
                      {translator.translateText(fact.label)}
                    </dt>
                    <dd
                      className={fact.className || FACT_VALUE_CLASS_NAME}
                      dir={fact.dir}
                      title={fact.title}
                    >
                      {fact.value}
                    </dd>
                  </div>
                );
              })}
            </dl>
          )}

          {showActivationForm && (
            <LicenseActivationForm
              mode={activationInputMode}
              isChangingLicense={isChangingLicense}
              licenseKey={licenseKeyInput}
              licenseToken={licenseTokenInput}
              instanceId={instanceId}
              error={actionError}
              isSubmitting={isActivating}
              onLicenseKeyChange={(value: string) => {
                setLicenseKeyInput(value);
                licenseInputEditedRef.current = true;
              }}
              onLicenseTokenChange={setLicenseTokenInput}
              onSwitchMode={handleSwitchActivationInputMode}
              onSubmit={handleActivate}
              onCancel={handleCancelChangingLicense}
            />
          )}
        </div>
      </Card>

      <LicenseDetails license={license} />
    </div>
  );
};

export default LicenseSettingsView;

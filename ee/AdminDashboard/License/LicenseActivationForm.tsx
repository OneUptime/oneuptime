import { LicenseSettingsCopy, SALES_EMAIL } from "./LicenseSettingsCopy";
import Alert, { AlertType } from "Common/UI/Components/Alerts/Alert";
import Button, { ButtonStyleType } from "Common/UI/Components/Button/Button";
import Input from "Common/UI/Components/Input/Input";
import TextArea from "Common/UI/Components/TextArea/TextArea";
import TranslatedSentence from "Common/UI/Components/TranslatedSentence/TranslatedSentence";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * Adding a license on Settings > License: a license key, which is what most
 * installations have, and behind one link a signed token for an installation
 * that cannot reach oneuptime.com. Replacing a license is the same form with
 * a way back.
 *
 * In the reader's language (./LicenseSettingsCopy.ts). The buttons, the
 * placeholders and the alert draw the keys they are given in it themselves;
 * the label, the help and the link are translated here. The sales address
 * and the instance ID are drawn as written, left to right, where the
 * reader's language puts them in its sentence.
 */

const SALES_MAILTO_URL: string = `mailto:${SALES_EMAIL}`;

export type ActivationInputMode = "key" | "token";

export interface ComponentProps {
  mode: ActivationInputMode;
  // Replacing a license that is in place, rather than adding the first one.
  isChangingLicense: boolean;
  licenseKey: string;
  licenseToken: string;
  // What a token has to be issued for; "" when the server did not say.
  instanceId: string;
  error: string;
  isSubmitting: boolean;
  onLicenseKeyChange: (value: string) => void;
  onLicenseTokenChange: (value: string) => void;
  onSwitchMode: () => void;
  onSubmit: () => void;
  onCancel: () => void;
}

const LicenseActivationForm: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const isTokenMode: boolean = props.mode === "token";
  const inputValue: string = isTokenMode
    ? props.licenseToken
    : props.licenseKey;

  const translate: (text: string) => string = (text: string): string => {
    return translator.translateText(text) || text;
  };

  const getLabel: () => string = (): string => {
    if (isTokenMode) {
      return translate(LicenseSettingsCopy.licenseToken);
    }

    return translate(
      props.isChangingLicense
        ? LicenseSettingsCopy.newLicenseKey
        : LicenseSettingsCopy.licenseKey,
    );
  };

  /*
   * What the field is for. Adding the first key says where one is bought:
   * the sales address, a link, where the reader's language puts it.
   */
  const getHelperText: () => ReactElement | string = ():
    | ReactElement
    | string => {
    if (isTokenMode) {
      return translate(LicenseSettingsCopy.licenseTokenHelp);
    }

    if (props.isChangingLicense) {
      return translate(LicenseSettingsCopy.newLicenseKeyHelp);
    }

    return (
      <TranslatedSentence
        template={LicenseSettingsCopy.licenseKeyHelp}
        slots={{
          email: (
            <a
              href={SALES_MAILTO_URL}
              dir="ltr"
              className="font-medium text-indigo-600 hover:text-indigo-700"
            >
              {SALES_EMAIL}
            </a>
          ),
        }}
      />
    );
  };

  return (
    <section
      className="mt-5 border-t border-gray-100 pt-5"
      data-testid="license-activation-form"
    >
      <label
        htmlFor={
          isTokenMode ? "enterprise-license-token" : "enterprise-license-key"
        }
        className="text-sm font-semibold text-gray-900"
      >
        {getLabel()}
      </label>
      <p className="mt-0.5 max-w-2xl text-xs leading-relaxed text-gray-500">
        {getHelperText()}
      </p>

      <div className="mt-3 max-w-2xl">
        {isTokenMode ? (
          <TextArea
            id="enterprise-license-token"
            value={props.licenseToken}
            onChange={props.onLicenseTokenChange}
            placeholder={LicenseSettingsCopy.licenseTokenPlaceholder}
            disableSpellCheck={true}
            dataTestId="enterprise-license-token-input"
          />
        ) : (
          <Input
            id="enterprise-license-key"
            value={props.licenseKey}
            onChange={props.onLicenseKeyChange}
            onEnterPress={props.onSubmit}
            placeholder={LicenseSettingsCopy.licenseKeyPlaceholder}
            disableSpellCheck={true}
            dataTestId="enterprise-license-key-input"
          />
        )}
      </div>

      {isTokenMode && props.instanceId && (
        <p
          className="mt-2 max-w-2xl text-xs leading-relaxed text-gray-500"
          data-testid="license-token-instance-id"
        >
          <TranslatedSentence
            template={LicenseSettingsCopy.tokenInstanceId}
            slots={{
              instanceId: (
                <span className="font-mono text-gray-700" dir="ltr">
                  {props.instanceId}
                </span>
              ),
            }}
          />
        </p>
      )}

      <div className="mt-2">
        <button
          type="button"
          onClick={props.onSwitchMode}
          data-testid="switch-license-activation-mode"
          /*
           * text-start: a button centres its lines, and on a phone this
           * link wraps in most languages - its second line sat in the
           * middle, under nothing.
           */
          className="text-start text-xs font-medium text-indigo-600 hover:text-indigo-700 focus:outline-none focus-visible:underline"
        >
          {translate(
            isTokenMode
              ? LicenseSettingsCopy.useLicenseKeyInstead
              : LicenseSettingsCopy.activateOfflineInstead,
          )}
        </button>
      </div>

      {props.error && (
        <div className="mt-3 max-w-2xl">
          <Alert type={AlertType.DANGER} title={props.error} />
        </div>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Button
          title={
            isTokenMode
              ? LicenseSettingsCopy.activateLicense
              : LicenseSettingsCopy.validateLicense
          }
          buttonStyle={ButtonStyleType.PRIMARY}
          onClick={props.onSubmit}
          isLoading={props.isSubmitting}
          disabled={!inputValue.trim() || props.isSubmitting}
          dataTestId="activate-enterprise-license"
          className="!mt-0 md:!ml-0"
        />
        {props.isChangingLicense && (
          <Button
            title={LicenseSettingsCopy.cancel}
            buttonStyle={ButtonStyleType.OUTLINE}
            onClick={props.onCancel}
            disabled={props.isSubmitting}
            dataTestId="cancel-license-change"
          />
        )}
      </div>
    </section>
  );
};

export default LicenseActivationForm;

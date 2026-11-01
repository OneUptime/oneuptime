import Alert, { AlertType } from "Common/UI/Components/Alerts/Alert";
import Button, { ButtonStyleType } from "Common/UI/Components/Button/Button";
import Input from "Common/UI/Components/Input/Input";
import TextArea from "Common/UI/Components/TextArea/TextArea";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * Adding a license on Settings > License: a license key, which is what most
 * installations have, and behind one link a signed token for an installation
 * that cannot reach oneuptime.com. Replacing a license is the same form with
 * a way back.
 */

const SALES_EMAIL: string = "sales@oneuptime.com";
const SALES_MAILTO_URL: string = "mailto:sales@oneuptime.com";

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
  const isTokenMode: boolean = props.mode === "token";
  const inputValue: string = isTokenMode
    ? props.licenseToken
    : props.licenseKey;

  const getLabel: () => string = (): string => {
    if (isTokenMode) {
      return "License token (offline activation)";
    }

    return props.isChangingLicense ? "New license key" : "License key";
  };

  const getHelperText: () => string = (): string => {
    if (isTokenMode) {
      return "For an installation that cannot reach oneuptime.com. Paste the signed license token OneUptime issued for this installation. Only tokens signed by a key this OneUptime release trusts are accepted.";
    }

    if (props.isChangingLicense) {
      return "Enter the new enterprise license key and validate it to replace the current one. Your existing license stays active until the new key is validated.";
    }

    return "Validate your license key with OneUptime to activate it. Need a license key? Contact our sales team at";
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
        {!isTokenMode && !props.isChangingLicense && (
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

      <div className="mt-3 max-w-2xl">
        {isTokenMode ? (
          <TextArea
            id="enterprise-license-token"
            value={props.licenseToken}
            onChange={props.onLicenseTokenChange}
            placeholder="Paste the signed license token"
            disableSpellCheck={true}
            dataTestId="enterprise-license-token-input"
          />
        ) : (
          <Input
            id="enterprise-license-key"
            value={props.licenseKey}
            onChange={props.onLicenseKeyChange}
            onEnterPress={props.onSubmit}
            placeholder="Enter your enterprise license key"
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
          A token works only on the instance it was issued for. This
          installation&apos;s instance ID is{" "}
          <span className="font-mono text-gray-700">{props.instanceId}</span>.
        </p>
      )}

      <div className="mt-2">
        <button
          type="button"
          onClick={props.onSwitchMode}
          data-testid="switch-license-activation-mode"
          className="text-xs font-medium text-indigo-600 hover:text-indigo-700 focus:outline-none focus-visible:underline"
        >
          {isTokenMode
            ? "Use a license key instead"
            : "No internet access? Activate offline with a license token"}
        </button>
      </div>

      {props.error && (
        <div className="mt-3 max-w-2xl">
          <Alert type={AlertType.DANGER} title={props.error} />
        </div>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Button
          title={isTokenMode ? "Activate License" : "Validate License"}
          buttonStyle={ButtonStyleType.PRIMARY}
          onClick={props.onSubmit}
          isLoading={props.isSubmitting}
          disabled={!inputValue.trim() || props.isSubmitting}
          dataTestId="activate-enterprise-license"
          className="!mt-0 md:!ml-0"
        />
        {props.isChangingLicense && (
          <Button
            title="Cancel"
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

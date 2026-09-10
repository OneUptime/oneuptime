import {
  MINIMUM_SIGNUP_PASSWORD_LENGTH,
  getSignupPasswordValidationError,
} from "Common/Types/Password";
import IconProp from "Common/Types/Icon/IconProp";
import Icon from "Common/UI/Components/Icon/Icon";
import React, { ReactElement } from "react";
import { useTranslation } from "react-i18next";

export interface ComponentProps {
  id: string;
  password: string;
  error?: string | undefined;
}

const PasswordRequirements: (props: ComponentProps) => ReactElement = (
  props: ComponentProps,
): ReactElement => {
  const { t } = useTranslation();
  const validationError: string | null =
    props.error || getSignupPasswordValidationError(props.password);
  const meetsRequirements: boolean = validationError === null;
  const showGuidance: boolean =
    !props.error &&
    (!props.password ||
      (Array.from(props.password).length < MINIMUM_SIGNUP_PASSWORD_LENGTH &&
        props.password.trim().length > 0));

  const message: string =
    props.error ||
    (meetsRequirements
      ? t("Password meets requirements")
      : showGuidance
        ? t("Use at least {{minimum}} characters.", {
            minimum: MINIMUM_SIGNUP_PASSWORD_LENGTH,
          })
        : t(validationError!, {
            defaultValue: validationError!,
            keySeparator: false,
            nsSeparator: false,
          }));

  return (
    <div
      id={props.id}
      role="status"
      aria-live="polite"
      aria-atomic="true"
      className={`mt-3 flex min-h-[96px] items-center gap-3 rounded-lg border p-3 text-sm leading-5 transition-colors duration-150 motion-reduce:transition-none sm:min-h-[80px] sm:px-4 ${
        meetsRequirements
          ? "border-emerald-200 bg-emerald-50 text-emerald-800"
          : showGuidance
            ? "border-indigo-100 bg-indigo-50/50 text-indigo-950"
            : "border-amber-200 bg-amber-50 text-amber-900"
      }`}
    >
      <div
        className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white shadow-sm ring-1 ${
          meetsRequirements
            ? "text-emerald-600 ring-emerald-200"
            : showGuidance
              ? "text-indigo-600 ring-indigo-100"
              : "text-amber-600 ring-amber-200"
        }`}
      >
        <Icon
          icon={
            meetsRequirements
              ? IconProp.CheckCircle
              : showGuidance
                ? IconProp.Lock
                : IconProp.InformationCircle
          }
          className="h-5 w-5"
        />
      </div>
      <div className="min-w-0">
        <p
          className="font-medium"
          data-testid={props.error ? "error-message" : undefined}
        >
          {message}
        </p>
        {showGuidance && (
          <p className="mt-1 text-gray-600">
            {t("Try a few unrelated words.")}
          </p>
        )}
      </div>
    </div>
  );
};

export default PasswordRequirements;

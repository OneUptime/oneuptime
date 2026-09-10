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
}

const PasswordRequirements: (props: ComponentProps) => ReactElement = (
  props: ComponentProps,
): ReactElement => {
  const { t } = useTranslation();
  const validationError: string | null = getSignupPasswordValidationError(
    props.password,
  );
  const meetsRequirements: boolean = validationError === null;
  const showGuidance: boolean =
    !props.password ||
    (Array.from(props.password).length < MINIMUM_SIGNUP_PASSWORD_LENGTH &&
      props.password.trim().length > 0);

  const message: string = meetsRequirements
    ? t("Password meets requirements")
    : showGuidance
      ? t("Use at least {{minimum}} characters.", {
          minimum: MINIMUM_SIGNUP_PASSWORD_LENGTH,
        })
      : t(validationError!, {
          defaultValue: validationError!,
          keySeparator: false,
          nsSeparator: false,
        });

  return (
    <div
      id={props.id}
      role="status"
      aria-live="polite"
      aria-atomic="true"
      className={`mt-2 rounded-md border px-3 py-2.5 text-xs leading-5 ${
        meetsRequirements
          ? "border-emerald-200 bg-emerald-50 text-emerald-800"
          : "border-gray-200 bg-gray-50 text-gray-600"
      }`}
    >
      <div className="flex items-start gap-2">
        <Icon
          icon={meetsRequirements ? IconProp.CheckCircle : IconProp.ShieldCheck}
          className={`mt-0.5 h-4 w-4 shrink-0 ${
            meetsRequirements ? "text-emerald-600" : "text-gray-400"
          }`}
        />
        <div>
          <p className="font-medium">{message}</p>
          {showGuidance && <p>{t("Try a few unrelated words.")}</p>}
        </div>
      </div>
    </div>
  );
};

export default PasswordRequirements;

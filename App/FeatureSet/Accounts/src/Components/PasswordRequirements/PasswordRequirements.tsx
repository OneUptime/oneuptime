import {
  MAXIMUM_PASSWORD_LENGTH,
  MINIMUM_SIGNUP_PASSWORD_LENGTH,
  getSignupPasswordValidationError,
  isPredictableSignupPassword,
} from "Common/Types/Password";
import IconProp from "Common/Types/Icon/IconProp";
import Icon from "Common/UI/Components/Icon/Icon";
import React, { ReactElement } from "react";
import { useTranslation } from "react-i18next";

const SPECIAL_CHARACTER_PATTERN: RegExp = /[\p{P}\p{S}]/u;

export interface ComponentProps {
  id: string;
  password: string;
  error?: string | undefined;
}

const PasswordRequirements: (props: ComponentProps) => ReactElement = (
  props: ComponentProps,
): ReactElement => {
  const { t } = useTranslation();
  const length: number = Array.from(props.password).length;
  const lengthProgress: number = Math.min(
    length,
    MINIMUM_SIGNUP_PASSWORD_LENGTH,
  );
  const hasValidLength: boolean =
    length >= MINIMUM_SIGNUP_PASSWORD_LENGTH &&
    length <= MAXIMUM_PASSWORD_LENGTH;
  const hasUnpredictableContent: boolean =
    props.password.trim().length > 0 &&
    !isPredictableSignupPassword(props.password);
  const hasSpecialCharacter: boolean = SPECIAL_CHARACTER_PATTERN.test(
    props.password,
  );
  const validationError: string | null =
    props.error || getSignupPasswordValidationError(props.password);
  const meetsRequirements: boolean = validationError === null;
  const showGuidance: boolean =
    !props.error &&
    (!props.password ||
      (length < MINIMUM_SIGNUP_PASSWORD_LENGTH &&
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

  const requirements: Array<{ label: string; complete: boolean }> = [
    {
      label: t("Between {{minimum}} and {{maximum}} characters", {
        minimum: MINIMUM_SIGNUP_PASSWORD_LENGTH,
        maximum: MAXIMUM_PASSWORD_LENGTH,
      }),
      complete: hasValidLength,
    },
    {
      label: t("Avoid common or repeated patterns"),
      complete: hasUnpredictableContent,
    },
  ];

  return (
    <div
      id={props.id}
      role="status"
      aria-live="polite"
      aria-atomic="true"
      className={`mt-3 rounded-lg border p-3 text-sm leading-5 transition-colors duration-150 motion-reduce:transition-none sm:px-4 ${
        meetsRequirements
          ? "border-emerald-200 bg-emerald-50 text-emerald-800"
          : showGuidance
            ? "border-indigo-100 bg-indigo-50/50 text-indigo-950"
            : "border-amber-200 bg-amber-50 text-amber-900"
      }`}
    >
      <div className="flex items-start gap-2">
        <Icon
          icon={
            meetsRequirements
              ? IconProp.CheckCircle
              : showGuidance
                ? IconProp.Lock
                : IconProp.InformationCircle
          }
          className="h-5 w-5 shrink-0"
        />
        <p
          className="min-w-0 font-medium"
          data-testid={props.error ? "error-message" : undefined}
        >
          {message}
        </p>
      </div>
      <div className="mt-3 flex flex-wrap justify-between gap-x-3 gap-y-1 text-xs text-gray-600">
        <span>{t("Password length")}</span>
        <span className="tabular-nums">
          {t("{{length}} / {{minimum}} characters minimum", {
            length,
            minimum: MINIMUM_SIGNUP_PASSWORD_LENGTH,
          })}
        </span>
      </div>
      <div
        role="progressbar"
        aria-label={t("Password length")}
        aria-valuemin={0}
        aria-valuemax={MINIMUM_SIGNUP_PASSWORD_LENGTH}
        aria-valuenow={lengthProgress}
        aria-valuetext={t("{{length}} / {{minimum}} characters minimum", {
          length,
          minimum: MINIMUM_SIGNUP_PASSWORD_LENGTH,
        })}
        className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-gray-200"
      >
        <div
          style={{
            width: `${(lengthProgress / MINIMUM_SIGNUP_PASSWORD_LENGTH) * 100}%`,
          }}
          className={`h-full rounded-full transition-all duration-150 motion-reduce:transition-none ${
            meetsRequirements
              ? "bg-emerald-500"
              : showGuidance
                ? "bg-indigo-500"
                : "bg-amber-500"
          }`}
        />
      </div>
      <ul className="mt-3 space-y-1.5">
        {requirements.map(
          (requirement: { label: string; complete: boolean }) => {
            return (
              <li
                key={requirement.label}
                className={`flex items-start gap-2 ${requirement.complete ? "text-emerald-800" : "text-gray-600"}`}
              >
                <Icon
                  icon={
                    requirement.complete
                      ? IconProp.CheckCircle
                      : IconProp.EmptyCircle
                  }
                  className="h-4 w-4 shrink-0 mt-0.5"
                />
                <span className="sr-only">
                  {t(requirement.complete ? "Complete:" : "Incomplete:", {
                    keySeparator: false,
                    nsSeparator: false,
                  })}{" "}
                </span>
                <span>{requirement.label}</span>
              </li>
            );
          },
        )}
        <li
          className={`flex items-start gap-2 ${hasSpecialCharacter ? "text-emerald-800" : "text-gray-600"}`}
        >
          <Icon
            icon={
              hasSpecialCharacter
                ? IconProp.CheckCircle
                : IconProp.InformationCircle
            }
            className="h-4 w-4 shrink-0 mt-0.5"
          />
          <span>
            {hasSpecialCharacter
              ? t("Special character included (optional)")
              : t("Special characters are optional. Try !, @, # or $.")}
          </span>
        </li>
      </ul>
      {showGuidance && (
        <p className="mt-2 text-xs text-gray-600">
          {t("Try a few unrelated words.")}
        </p>
      )}
    </div>
  );
};

export default PasswordRequirements;

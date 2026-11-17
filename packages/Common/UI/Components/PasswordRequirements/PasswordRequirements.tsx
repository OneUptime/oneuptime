import {
  MAXIMUM_PASSWORD_LENGTH,
  MINIMUM_PASSWORD_LENGTH,
  getPasswordLength,
  getPasswordValidationError,
  isPredictablePassword,
} from "../../../Types/Password";
import IconProp from "../../../Types/Icon/IconProp";
import { Translator } from "../../../Types/Translator";
import Icon from "../Icon/Icon";
import useTranslator from "../../Utils/UseTranslator";
import React, { ReactElement } from "react";

/*
 * The one password rule's checklist (Types/Password), under every field that
 * sets a password: sign up, Reset Password (OneUptime's and a status page's),
 * Update Password and Admin Dashboard's Create User and Set Password. It shows
 * what the rule asks before the person types and ticks each part off as they
 * do (#9123). Its words are keys in the locales of each of those apps.
 */

const SPECIAL_CHARACTER_PATTERN: RegExp = /[\p{P}\p{S}]/u;

// The rule's refusal (or the server's) in the reader's language.
export const translatePasswordRefusal: (
  translator: Translator,
  message: string,
) => string = (translator: Translator, message: string): string => {
  return translator.translateText(message) || message;
};

export interface ComponentProps {
  id: string;
  password: string;
  error?: string | undefined;
}

const PasswordRequirements: (props: ComponentProps) => ReactElement = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const length: number = getPasswordLength(props.password);
  const lengthProgress: number = Math.min(length, MINIMUM_PASSWORD_LENGTH);
  const hasValidLength: boolean =
    length >= MINIMUM_PASSWORD_LENGTH && length <= MAXIMUM_PASSWORD_LENGTH;
  const hasUnpredictableContent: boolean =
    props.password.trim().length > 0 && !isPredictablePassword(props.password);
  const hasSpecialCharacter: boolean = SPECIAL_CHARACTER_PATTERN.test(
    props.password,
  );
  const validationError: string | null =
    props.error || getPasswordValidationError(props.password);
  const meetsRequirements: boolean = validationError === null;
  const showGuidance: boolean =
    !props.error &&
    (!props.password ||
      (length < MINIMUM_PASSWORD_LENGTH && props.password.trim().length > 0));

  const lengthText: string = translator.translateTemplate(
    "{{length}} / {{minimum}} characters minimum",
    {
      length,
      minimum: MINIMUM_PASSWORD_LENGTH,
    },
  );

  const message: string =
    props.error ||
    (meetsRequirements
      ? translator.translateText("Password meets requirements")!
      : showGuidance
        ? translator.translateTemplate("Use at least {{minimum}} characters.", {
            minimum: MINIMUM_PASSWORD_LENGTH,
          })
        : translatePasswordRefusal(translator, validationError!));

  const requirements: Array<{ label: string; complete: boolean }> = [
    {
      label: translator.translateTemplate(
        "Between {{minimum}} and {{maximum}} characters",
        {
          minimum: MINIMUM_PASSWORD_LENGTH,
          maximum: MAXIMUM_PASSWORD_LENGTH,
        },
      ),
      complete: hasValidLength,
    },
    {
      label: translator.translateText("Avoid common or repeated patterns")!,
      complete: hasUnpredictableContent,
    },
  ];

  return (
    <div
      id={props.id}
      role="status"
      aria-live="polite"
      aria-atomic="true"
      data-testid="password-requirements"
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
        <span>{translator.translateText("Password length")}</span>
        <span className="tabular-nums">{lengthText}</span>
      </div>
      <div
        role="progressbar"
        aria-label={translator.translateText("Password length")}
        aria-valuemin={0}
        aria-valuemax={MINIMUM_PASSWORD_LENGTH}
        aria-valuenow={lengthProgress}
        aria-valuetext={lengthText}
        className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-gray-200"
      >
        <div
          style={{
            width: `${(lengthProgress / MINIMUM_PASSWORD_LENGTH) * 100}%`,
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
                  {translator.translateText(
                    requirement.complete ? "Complete:" : "Incomplete:",
                  )}{" "}
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
              ? translator.translateText(
                  "Special character included (optional)",
                )
              : translator.translateText(
                  "Special characters are optional. Try !, @, # or $.",
                )}
          </span>
        </li>
      </ul>
      {showGuidance && (
        <p className="mt-2 text-xs text-gray-600">
          {translator.translateText("Try a few unrelated words.")}
        </p>
      )}
    </div>
  );
};

export default PasswordRequirements;

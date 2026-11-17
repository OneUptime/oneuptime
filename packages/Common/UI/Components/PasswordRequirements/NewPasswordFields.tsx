import HashedString from "../../../Types/HashedString";
import { JSONObject } from "../../../Types/JSON";
import { getPasswordValidationError } from "../../../Types/Password";
import { Translator } from "../../../Types/Translator";
import Field from "../Forms/Types/Field";
import FormFieldSchemaType from "../Forms/Types/FormFieldSchemaType";
import FormValues from "../Forms/Types/FormValues";
import PasswordRequirements, {
  translatePasswordRefusal,
} from "./PasswordRequirements";
import React from "react";

/*
 * The fields of every form that sets a password - the new password, with the
 * one rule's checklist under it (PasswordRequirements), and its confirmation -
 * so sign up, Reset Password, Update Password and Admin Dashboard's Create
 * User and Set Password ask the same thing the same way, and the server's rule
 * (Types/Password) is the browser's too (#9123).
 *
 * A sign-in form never uses these: it never checks a password's length.
 */

/*
 * BasicForm wraps a password in a HashedString for submission; validation and
 * the checklist read the plaintext, also after a request fails.
 */
export const getFormPasswordValue: (value: unknown) => unknown = (
  value: unknown,
): unknown => {
  return value instanceof HashedString ? value.toString() : value;
};

export interface NewPasswordFieldsOptions<TEntity> {
  translator: Translator;
  // The checklist's id: the password field is described by it (useId()).
  requirementsId: string;
  // The titles in the reader's words, as each app writes them.
  passwordTitle: string;
  // Read by the confirmation only.
  confirmPasswordTitle?: string | undefined;
  // What the new password field adds or overrides (sectionTitle, dataTestId).
  passwordField?: Partial<Field<TEntity>> | undefined;
  confirmPasswordField?: Partial<Field<TEntity>> | undefined;
  /*
   * Whose password it is: the person's own (the default), which a password
   * manager saves, or somebody else's (a master admin's Create User and Set
   * Password), which it must not offer to save as the admin's own.
   */
  isOwnPassword?: boolean | undefined;
}

// The new password, with the rule's checklist under it.
export const getNewPasswordField: <TEntity>(
  options: NewPasswordFieldsOptions<TEntity>,
) => Field<TEntity> = <TEntity,>(
  options: NewPasswordFieldsOptions<TEntity>,
): Field<TEntity> => {
  return {
    field: {
      password: true,
    } as Field<TEntity>["field"],
    fieldType: FormFieldSchemaType.Password,
    errorMessageInFooter: true,
    customValidation: (values: FormValues<TEntity>): string | null => {
      const message: string | null = getPasswordValidationError(
        getFormPasswordValue((values as JSONObject)["password"]),
      );

      return message
        ? translatePasswordRefusal(options.translator, message)
        : null;
    },
    getFooterElement: (
      values: FormValues<TEntity>,
      error?: string,
    ): React.ReactElement => {
      const password: unknown = getFormPasswordValue(
        (values as JSONObject)["password"],
      );

      return (
        <PasswordRequirements
          id={options.requirementsId}
          password={typeof password === "string" ? password : ""}
          error={error}
        />
      );
    },
    ariaDescribedby: options.requirementsId,
    autoComplete: "new-password",
    isOwnCredential: options.isOwnPassword !== false,
    placeholder: options.passwordTitle,
    isPlaceholderTranslated: true,
    title: options.passwordTitle,
    required: true,
    showEvenIfPermissionDoesNotExist: true,
    disableSpellCheck: true,
    ...(options.passwordField || {}),
  };
};

// The new password typed again: it has to match.
export const getConfirmPasswordField: <TEntity>(
  options: NewPasswordFieldsOptions<TEntity>,
) => Field<TEntity> = <TEntity,>(
  options: NewPasswordFieldsOptions<TEntity>,
): Field<TEntity> => {
  const confirmPasswordTitle: string = options.confirmPasswordTitle || "";

  return {
    field: {
      confirmPassword: true,
    } as Field<TEntity>["field"],
    customValidation: (values: FormValues<TEntity>): string | null => {
      const confirmation: unknown = getFormPasswordValue(
        (values as JSONObject)["confirmPassword"],
      );

      if (
        !confirmation ||
        confirmation ===
          getFormPasswordValue((values as JSONObject)["password"])
      ) {
        return null;
      }

      return options.translator.translateTemplate(
        "{{field}} should match {{matchField}}",
        {
          field: confirmPasswordTitle,
          matchField: options.passwordTitle,
        },
      );
    },
    fieldType: FormFieldSchemaType.Password,
    autoComplete: "new-password",
    isOwnCredential: options.isOwnPassword !== false,
    placeholder: confirmPasswordTitle,
    isPlaceholderTranslated: true,
    title: confirmPasswordTitle,
    overrideFieldKey: "confirmPassword",
    required: true,
    showEvenIfPermissionDoesNotExist: true,
    disableSpellCheck: true,
    ...(options.confirmPasswordField || {}),
  };
};

// Both: the new password and its confirmation.
export const getNewPasswordFields: <TEntity>(
  options: NewPasswordFieldsOptions<TEntity>,
) => Array<Field<TEntity>> = <TEntity,>(
  options: NewPasswordFieldsOptions<TEntity>,
): Array<Field<TEntity>> => {
  return [getNewPasswordField(options), getConfirmPasswordField(options)];
};

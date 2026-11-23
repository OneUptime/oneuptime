import Dictionary from "../Dictionary";
import { translationKey, Translator } from "../Translator";
import { LocalSignInSettings } from "./LocalSignInClearing";

/*
 * THE EMAIL A PERSON GETS WHEN THEIR SIGN-IN SETTINGS ARE CLEARED (issues
 * #9818 and #9820).
 *
 * Clearing someone's password, passkeys, security keys, authenticator apps,
 * backup codes and two-factor authentication cannot be undone
 * (Types/SSO/LocalSignInClearing), so the person is told, at the address on
 * their account, as every other change to how they sign in tells them (a
 * new password's "Password Changed.", backup codes made at sign-in). One
 * email per person, in the language on their account (Types/UserLanguage),
 * saying:
 *
 *   - who cleared them, by role and never by name: "a server admin" (a
 *     master admin, in the Admin Dashboard), or "an owner of Acme" (an
 *     owner of every project the person is in, #9820). Naming the master
 *     admin would name OneUptime's own staff on OneUptime Cloud;
 *   - when, in the person's own time zone;
 *   - exactly what was removed, a row for each thing they had;
 *   - how they sign in now: with single sign-on, naming its providers,
 *     while SSO manages their sign-in (Types/SSO/SsoManagedSignIn), or by
 *     setting a new password with Forgot password? when it does not;
 *   - who to ask if they did not expect it: the owners of the project, the
 *     server's admin, or OneUptime's support on OneUptime Cloud.
 *
 * NOTHING ABOUT ANYBODY ELSE: an email is about its reader alone - no other
 * person cleared with them, no count of them, no name of whoever cleared
 * them. A clear that removed nothing sends nothing.
 *
 * The template is App/FeatureSet/Notification/Templates/
 * SignInSettingsCleared.hbs; its words are in Common/Server/Locales, as an
 * on-call page's are. React-free and server-safe: the server's sender
 * (Server/Utils/SignInSettingsClearedEmail) and the tests read it.
 */

// Who cleared the settings, as the email names them: by role, never by name.
export enum SignInSettingsClearedBy {
  // A master admin, in the Admin Dashboard: for one person, or for everyone.
  ServerAdmin = "ServerAdmin",
  // An owner of every project the person is in (#9820).
  ProjectOwner = "ProjectOwner",
}

// How the person signs in once their settings are gone.
export enum SignInAfterClearing {
  // Single sign-on manages their sign-in: their identity provider signs them in.
  SingleSignOn = "SingleSignOn",
  // Nothing manages it: a new password, set with Forgot password?.
  ForgotPassword = "ForgotPassword",
  // Which could not be read: the email names both ways.
  Unknown = "Unknown",
}

// The longest list of providers an email names, as the profile names them.
export const MAX_EMAIL_SSO_PROVIDER_NAMES: number = 10;

// What sets the providers' names apart in the email's row of them.
export const SSO_PROVIDER_NAME_SEPARATOR: string = " · ";

/*
 * The email's subject, in the reader's language: literal, since the
 * product's name is the installation's own (ProductBrandingText).
 */
export const getSignInSettingsClearedSubject: (
  translator: Translator,
  productName: string,
) => string = (translator: Translator, productName: string): string => {
  return translator.translateTemplate(
    translationKey("Your {{product}} sign-in settings were cleared"),
    { product: productName },
  );
};

/*
 * The providers' names as the email's row lists them: trimmed, each once,
 * none empty, at most MAX_EMAIL_SSO_PROVIDER_NAMES, set apart with a dot -
 * names side by side, not a sentence, so no language has to word a list.
 * "" for none: the row is left out.
 */
export const getSsoProviderNamesForEmail: (
  names: ReadonlyArray<string>,
) => string = (names: ReadonlyArray<string>): string => {
  const kept: Array<string> = [];
  const seen: Set<string> = new Set<string>();

  for (const name of names) {
    const trimmed: string = (name || "").trim();

    if (!trimmed || seen.has(trimmed.toLowerCase())) {
      continue;
    }

    seen.add(trimmed.toLowerCase());
    kept.push(trimmed);

    if (kept.length >= MAX_EMAIL_SSO_PROVIDER_NAMES) {
      break;
    }
  }

  return kept.join(SSO_PROVIDER_NAME_SEPARATOR);
};

/*
 * Who cleared them, as the email says it: a server admin, or an owner of a
 * project, named by that project's name. The name is read when the email
 * is written (#9991), so it is "" for a project deleted since the clear:
 * the email then says "a project owner", and sends them to the server's
 * admin or to support, as a server admin's clear does.
 */
export type SignInSettingsClearer =
  | { clearedBy: SignInSettingsClearedBy.ServerAdmin }
  | { clearedBy: SignInSettingsClearedBy.ProjectOwner; projectName: string };

// What the template is handed, beside the brand's own variables.
export type SignInSettingsClearedEmailData = SignInSettingsClearer & {
  cleared: LocalSignInSettings;
  signIn: SignInAfterClearing;
  // The SSO providers that sign them in, for SingleSignOn.
  ssoProviderNames: ReadonlyArray<string>;
  // When, already written in the reader's time zone and language.
  clearedAt: string;
  productName: string;
  // Where the buttons go.
  signInUrl: string;
  ssoSignInUrl: string;
  forgotPasswordUrl: string;
};

/*
 * The template's variables. A row shows only for what the person had, and
 * a flag is "true" or left out, as the template's {{#if}} reads it; counts
 * are written out for its plural sentences ({{tp}}), which word them in the
 * reader's digits.
 */
export const getSignInSettingsClearedEmailVariables: (
  data: SignInSettingsClearedEmailData,
) => Dictionary<string> = (
  data: SignInSettingsClearedEmailData,
): Dictionary<string> => {
  const vars: Dictionary<string> = {
    productName: data.productName,
    clearedAt: data.clearedAt,
    signInUrl: data.signInUrl,
  };

  /*
   * A project's owner is never called a server admin, whatever its name is,
   * and a project whose name cannot be read (deleted since the clear) is
   * named nowhere: no sentence is left with a gap where its name was.
   */
  if (data.clearedBy === SignInSettingsClearedBy.ProjectOwner) {
    vars["clearedByProjectOwner"] = "true";

    const projectName: string = (data.projectName || "").trim();

    if (projectName) {
      vars["projectName"] = projectName;
    }
  } else {
    vars["clearedByServerAdmin"] = "true";
  }

  if (data.cleared.hasPassword) {
    vars["removedPassword"] = "true";
  } else if (data.cleared.hasPasswordResetLink) {
    /*
     * A reset link with no password beside it (#9992): somebody who asked
     * for one to set their first password. With a password, its row already
     * names "any password reset link".
     */
    vars["removedPasswordResetLink"] = "true";
  }

  if (data.cleared.passkeyAndSecurityKeyCount > 0) {
    vars["removedPasskeyCount"] = String(
      data.cleared.passkeyAndSecurityKeyCount,
    );
  }

  if (data.cleared.authenticatorAppCount > 0) {
    vars["removedAuthenticatorAppCount"] = String(
      data.cleared.authenticatorAppCount,
    );
  }

  if (data.cleared.backupCodeCount > 0) {
    vars["removedBackupCodeCount"] = String(data.cleared.backupCodeCount);
  }

  if (data.cleared.isTwoFactorAuthEnabled) {
    vars["turnedOffTwoFactorAuth"] = "true";
  }

  if (data.signIn === SignInAfterClearing.SingleSignOn) {
    vars["signsInWithSso"] = "true";
    vars["ssoSignInUrl"] = data.ssoSignInUrl;

    const providers: string = getSsoProviderNamesForEmail(
      data.ssoProviderNames,
    );

    if (providers) {
      vars["ssoProviderNames"] = providers;
    }
  } else if (data.signIn === SignInAfterClearing.ForgotPassword) {
    vars["setsNewPassword"] = "true";
    vars["forgotPasswordUrl"] = data.forgotPasswordUrl;
  } else {
    vars["signInWayUnknown"] = "true";
    vars["forgotPasswordUrl"] = data.forgotPasswordUrl;
  }

  return vars;
};

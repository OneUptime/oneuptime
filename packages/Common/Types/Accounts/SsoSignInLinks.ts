import Dictionary from "../Dictionary";
import { JSONObject } from "../JSON";
import { translationKey, Translator } from "../Translator";

/*
 * "SIGN IN WITH SSO" CAN EMAIL AN ADDRESS ITS ORGANIZATIONS' SSO SIGN-IN
 * LINKS (#9987).
 *
 * "Sign in with SSO" (/accounts/sso) finds a project's providers by the
 * typed address's verified domain alone, never by its account (#9824), so
 * somebody whose address is on another domain - a contractor at gmail.com
 * in Acme's project - finds nothing there and needs the project's SSO
 * sign-in link (/accounts/sso/<project id>, #9918), which their admin has
 * to send them. When the lookup finds nothing, the page offers to email the
 * address those links instead (POST /identity/send-sso-sign-in-links).
 *
 * EVERY ADDRESS IS ANSWERED ALIKE. The route answers the same thing, with
 * the same status, after the same work, whether the address has an account
 * or not, a blocked one or an administrator's, one in organizations that
 * sign in with SSO or in none:
 *
 *   - it counts the request per caller and per address
 *     (PublicMessageRateLimit, SsoSignInLinks) before anything is looked
 *     up, and never gives a count back, so a refusal says nothing either;
 *   - it looks nothing up while the request waits: the account, its
 *     projects and their providers are read in the background, after the
 *     answer, and the email - when there is one - goes out from there
 *     (Identity/Utils/SsoSignInLinksEmail). How long the answer takes says
 *     nothing about the address.
 *
 * WHAT THE EMAIL LISTS, AND TO WHOM. Only the address the request names is
 * ever emailed, and only when it has an account that a project's SSO could
 * sign in: not blocked, not a OneUptime administrator (a project's SSO never
 * signs one in). It lists the projects that account has joined - never one
 * it was only invited to, which anyone could have done to put their own
 * provider in front of a stranger - whose own SAML or OIDC providers are on,
 * each as a button to its SSO sign-in link. The link opens OneUptime's own
 * page for the project, which lists the providers; the email itself links to
 * no identity provider. Nothing is sent for an address with no account, or
 * none in such a project.
 *
 * The email is written in the account's own language, and says exactly
 * what it is, when and from where it was asked for, and that it can be
 * ignored: the links sign nobody in without the organization's identity
 * provider.
 *
 * React-free and server-safe: the route, the sender and the tests read it.
 */

// The identity route that asks for the email.
export const SEND_SSO_SIGN_IN_LINKS_ROUTE: string = "/send-sso-sign-in-links";

/*
 * What a server that cannot send email answers: the same for every address,
 * a fact of the server asked before any address is looked at.
 */
export const SSO_SIGN_IN_LINKS_CANNOT_BE_EMAILED_MESSAGE: string =
  "This server cannot send email, so sign-in links cannot be emailed. Ask your admin for your organization's SSO sign-in link.";

// The most projects one email lists; a person in more can ask their admins.
export const MAX_EMAILED_SSO_PROJECTS: number = 20;

// One project the email lists, as a button to its SSO sign-in page.
export interface EmailedSsoProject {
  // As its admins named it: their words, escaped wherever they are drawn.
  projectName: string;
  // Its SSO sign-in link: OneUptime's own page, /accounts/sso/<project id>.
  signInUrl: string;
}

// What the template is handed, beside the brand's own variables.
export interface SsoSignInLinksEmailData {
  productName: string;
  projects: ReadonlyArray<EmailedSsoProject>;
  // When it was asked for, written in the reader's time zone and language.
  requestedAt: string;
  // Where from, as RequestOriginUtil writes them: "" for what is not known.
  requestIpAddress: string;
  requestLocation: string;
  requestDevice: string;
}

// The email's subject, in the reader's language.
export const getSsoSignInLinksSubject: (
  translator: Translator,
  productName: string,
) => string = (translator: Translator, productName: string): string => {
  return translator.translateTemplate(
    translationKey("Your {{product}} SSO sign-in links"),
    { product: productName },
  );
};

/*
 * The template's variables: the projects, a button each (at most
 * MAX_EMAILED_SSO_PROJECTS, each with a name and a link), and where the
 * request came from, a row only for what is known.
 */
export const getSsoSignInLinksEmailVariables: (
  data: SsoSignInLinksEmailData,
) => Dictionary<string | JSONObject> = (
  data: SsoSignInLinksEmailData,
): Dictionary<string | JSONObject> => {
  const projects: Array<JSONObject> = data.projects
    .filter((project: EmailedSsoProject): boolean => {
      return Boolean(project.signInUrl);
    })
    .slice(0, MAX_EMAILED_SSO_PROJECTS)
    .map((project: EmailedSsoProject): JSONObject => {
      return {
        projectName: (project.projectName || "").trim(),
        signInUrl: project.signInUrl,
      };
    });

  const vars: Dictionary<string | JSONObject> = {
    productName: data.productName,
    // An array, which Handlebars' {{#each}} walks.
    projects: projects as unknown as JSONObject,
    requestedAt: data.requestedAt,
  };

  if (data.requestIpAddress) {
    vars["requestIpAddress"] = data.requestIpAddress;
  }

  if (data.requestLocation) {
    vars["requestLocation"] = data.requestLocation;
  }

  if (data.requestDevice) {
    vars["requestDevice"] = data.requestDevice;
  }

  return vars;
};

import { getFormOnCustomDomainUrl, getFormUrl } from "./Form";
import FormAPI from "./FormAPI";
import { getFormDomainPageOrigin } from "./FormDomainPage";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import URL from "Common/Types/API/URL";
import {
  FORM_PRIVATE_USER_API_ROUTE,
  FORM_SIGN_IN_STATE_ROUTE,
  FormPrivateUserApiRoutes,
  FormSignInMethods,
  FormSignInProvider,
  FormSignInState,
} from "Common/Types/Form/FormPrivateUserSignIn";
import { JSONObject } from "Common/Types/JSON";
import { APP_API_URL, IDENTITY_URL } from "Common/UI/Config";

/*
 * A FORM'S PAGE SIGNS ITS VISITORS IN (#10249), on the host it is served
 * from - OneUptime's own (/accounts/form/<share key>) or the form's custom
 * domain - through the form's sign-in routes under /api/form
 * (Types/Form/FormPrivateUserSignIn). The session is the server's HttpOnly
 * cookies: the page never holds it, and asks who is signed in each time it
 * loads (loadFormSignInState).
 */

// Where the form's sign-in routes are, on the host the page is served from.
const getPrivateUserUrl: (data: {
  route: string;
  formId: string;
  isOnCustomDomain: boolean;
}) => URL = (data: {
  route: string;
  formId: string;
  isOnCustomDomain: boolean;
}): URL => {
  const base: URL = data.isOnCustomDomain
    ? URL.fromString(`${getFormDomainPageOrigin()}/api/form`)
    : URL.fromURL(APP_API_URL).addRoute("/form");

  return base.addRoute(
    `${FORM_PRIVATE_USER_API_ROUTE}${data.route}/${encodeURIComponent(data.formId)}`,
  );
};

const post: (data: {
  url: URL;
  body?: JSONObject | undefined;
}) => Promise<JSONObject> = async (data: {
  url: URL;
  body?: JSONObject | undefined;
}): Promise<JSONObject> => {
  const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
    await FormAPI.post<JSONObject>({
      url: data.url,
      data: data.body || {},
    });

  if (response instanceof HTTPErrorResponse) {
    throw response;
  }

  return (response.data as JSONObject) || {};
};

/*
 * Whether the form asks its visitors to sign in, and only then its id, its
 * name and who is signed in on this host. Refusals are thrown as the
 * HTTPErrorResponse itself, as the form's own read does.
 */
export const loadFormSignInState: (
  shareKey: string | null,
) => Promise<FormSignInState> = async (
  shareKey: string | null,
): Promise<FormSignInState> => {
  const url: URL = URL.fromURL(
    shareKey ? getFormUrl(shareKey) : getFormOnCustomDomainUrl(),
  ).addRoute(FORM_SIGN_IN_STATE_ROUTE);

  const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
    await FormAPI.get<JSONObject>({ url: url });

  if (response instanceof HTTPErrorResponse) {
    throw response;
  }

  const data: JSONObject = (response.data as JSONObject) || {};

  if (data["requireSignIn"] !== true) {
    return { requireSignIn: false };
  }

  return {
    requireSignIn: true,
    formId: typeof data["formId"] === "string" ? data["formId"] : undefined,
    name: typeof data["name"] === "string" ? data["name"] : undefined,
    signedInAs:
      typeof data["signedInAs"] === "string" && data["signedInAs"]
        ? data["signedInAs"]
        : null,
  };
};

export interface FormSignInTarget {
  formId: string;
  isOnCustomDomain: boolean;
}

// A password's sign-in: the signed-in address, or the server's one refusal.
export const signInToForm: (
  target: FormSignInTarget,
  credentials: { email: string; password: string },
) => Promise<string> = async (
  target: FormSignInTarget,
  credentials: { email: string; password: string },
): Promise<string> => {
  const answer: JSONObject = await post({
    url: getPrivateUserUrl({
      ...target,
      route: FormPrivateUserApiRoutes.login,
    }),
    body: { data: { email: credentials.email, password: credentials.password } },
  });

  return typeof answer["email"] === "string" ? answer["email"] : credentials.email;
};

/*
 * A new access token for the session the browser holds, if it still counts:
 * the address signed in, or null when there is none.
 */
export const renewFormSession: (
  target: FormSignInTarget,
) => Promise<string | null> = async (
  target: FormSignInTarget,
): Promise<string | null> => {
  try {
    const answer: JSONObject = await post({
      url: getPrivateUserUrl({
        ...target,
        route: FormPrivateUserApiRoutes.refreshToken,
      }),
    });

    return typeof answer["email"] === "string" && answer["email"]
      ? answer["email"]
      : null;
  } catch {
    return null;
  }
};

// Ends the session on this host; never throws - the page signs out either way.
export const signOutOfForm: (target: FormSignInTarget) => Promise<void> = async (
  target: FormSignInTarget,
): Promise<void> => {
  try {
    await post({
      url: getPrivateUserUrl({ ...target, route: FormPrivateUserApiRoutes.logout }),
    });
  } catch {
    // The server cleared what it could.
  }
};

// A reset link to the address, if it may sign in: the same answer for any.
export const sendFormPasswordReset: (
  target: FormSignInTarget,
  email: string,
) => Promise<void> = async (
  target: FormSignInTarget,
  email: string,
): Promise<void> => {
  await post({
    url: getPrivateUserUrl({
      ...target,
      route: FormPrivateUserApiRoutes.forgotPassword,
    }),
    body: { data: { email } },
  });
};

export const resetFormPassword: (
  target: FormSignInTarget,
  data: { token: string; password: string },
) => Promise<void> = async (
  target: FormSignInTarget,
  data: { token: string; password: string },
): Promise<void> => {
  await post({
    url: getPrivateUserUrl({
      ...target,
      route: FormPrivateUserApiRoutes.resetPassword,
    }),
    body: {
      data: { resetPasswordToken: data.token, password: data.password },
    },
  });
};

// Single sign-on's code, exchanged for the session on this host.
export const exchangeFormLoginCode: (
  target: FormSignInTarget,
  loginCode: string,
) => Promise<void> = async (
  target: FormSignInTarget,
  loginCode: string,
): Promise<void> => {
  await post({
    url: getPrivateUserUrl({
      ...target,
      route: FormPrivateUserApiRoutes.exchangeLoginCode,
    }),
    body: { loginCode },
  });
};

// Whether a password signs in, and the providers that are on.
export const loadFormSignInMethods: (
  target: FormSignInTarget,
) => Promise<FormSignInMethods> = async (
  target: FormSignInTarget,
): Promise<FormSignInMethods> => {
  const answer: JSONObject = await post({
    url: getPrivateUserUrl({
      ...target,
      route: FormPrivateUserApiRoutes.signInMethods,
    }),
  });

  const providers: (value: unknown) => Array<FormSignInProvider> = (
    value: unknown,
  ): Array<FormSignInProvider> => {
    return Array.isArray(value) ? (value as Array<FormSignInProvider>) : [];
  };

  return {
    isPasswordSignInAllowed: answer["isPasswordSignInAllowed"] !== false,
    samlProviders: providers(answer["samlProviders"]),
    oidcProviders: providers(answer["oidcProviders"]),
  };
};

/*
 * Where a provider's sign-in starts: OneUptime's own address, where the
 * identity providers are configured; it sends the visitor back to the
 * form's link with a code.
 */
export const getFormSsoSignInUrl: (data: {
  formId: string;
  providerId: string;
  protocol: "saml" | "oidc";
}) => URL = (data: {
  formId: string;
  providerId: string;
  protocol: "saml" | "oidc";
}): URL => {
  return URL.fromURL(IDENTITY_URL).addRoute(
    `/${data.protocol === "saml" ? "form-sso" : "form-oidc"}/${encodeURIComponent(
      data.formId,
    )}/${encodeURIComponent(data.providerId)}`,
  );
};

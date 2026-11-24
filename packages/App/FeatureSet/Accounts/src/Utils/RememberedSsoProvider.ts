import { getProjectSignInMethodsApiUrl } from "./ApiPaths";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import RememberedSsoProviderUtil, {
  REMEMBERED_SSO_PROVIDER_KEY,
  RememberedSsoProvider,
} from "Common/Types/Accounts/RememberedSsoProvider";
import { JSONObject } from "Common/Types/JSON";
import SignInMethodsUtil, {
  SsoSignInProvider,
} from "Common/Types/SSO/SignInMethods";
import API from "Common/UI/Utils/API/API";
import { MutableRefObject, useEffect, useRef, useState } from "react";

/*
 * THE PROJECT SSO PROVIDER THIS BROWSER LAST SIGNED IN WITH (#9986), in the
 * Accounts app: remembered when a person picks a project's provider on "Sign
 * in with SSO" or a project's SSO sign-in link, offered first by "Sign in
 * with SSO", forgotten there in a click. What is kept, and why it is safe to
 * keep, is in Common/Types/Accounts/RememberedSsoProvider.
 *
 * The browser's storage can be missing, full or refused (a private window,
 * a locked-down browser): then nothing is remembered and nothing offered,
 * and every sign-in works as it did.
 */

// The stored provider, or null for none - or for anything that is not one.
export const readRememberedSsoProvider: () => RememberedSsoProvider | null =
  (): RememberedSsoProvider | null => {
    try {
      return RememberedSsoProviderUtil.fromStoredValue(
        window.localStorage.getItem(REMEMBERED_SSO_PROVIDER_KEY),
      );
    } catch {
      return null;
    }
  };

/*
 * Remembers the provider a person picked for a project: only a project's
 * own SAML or OIDC provider, by its kind and id and its project's id. An
 * instance-wide one is never remembered (the page lists those anyway), and
 * picking one leaves what was remembered as it was.
 */
export const rememberSsoProvider: (data: {
  provider: SsoSignInProvider;
  projectId: string | undefined;
}) => void = (data: {
  provider: SsoSignInProvider;
  projectId: string | undefined;
}): void => {
  const value: string | null = RememberedSsoProviderUtil.toStoredValue({
    type: data.provider.type,
    providerId: data.provider.id,
    projectId: data.projectId,
  });

  if (!value) {
    return;
  }

  try {
    window.localStorage.setItem(REMEMBERED_SSO_PROVIDER_KEY, value);
  } catch {
    // Storage refused: this sign-in still goes ahead, remembered or not.
  }
};

export const forgetRememberedSsoProvider: () => void = (): void => {
  try {
    window.localStorage.removeItem(REMEMBERED_SSO_PROVIDER_KEY);
  } catch {
    // Nothing could be stored there either.
  }
};

/*
 * The answers that say the project is not one the server can ask about: an
 * id it refuses (400), or no such route on the server (404).
 */
const FORGETTING_STATUSES: ReadonlyArray<number> = [400, 404];

// A remembered provider the server has just said is there and on.
export interface OfferedSsoProvider {
  // As the server names it now: its current name and description.
  provider: SsoSignInProvider;
  projectId: string;
}

export interface RememberedSsoProviderRead {
  // The server is being asked about the remembered provider's project.
  isReading: boolean;
  offered: OfferedSsoProvider | null;
  // Forgets it, in the browser and on the page.
  forget: () => void;
}

/*
 * Whether the remembered provider is still one the project signs people in
 * with, asked of the server by the project's id alone (GET /identity/
 * project-sign-in-methods/<project id>), never with an address:
 *
 *   - listed: offered, under the name the server gives it now;
 *   - not listed - removed, turned off, or no longer one of the project's
 *     ways in (a project that requires another) - or a project the server
 *     says nothing of: forgotten, so the browser stops offering a way in
 *     that cannot work;
 *   - the server could not be asked (offline, restarting, a 5xx): not
 *     offered this time, and kept, since nothing says it went.
 */
export const readOfferedSsoProvider: (
  remembered: RememberedSsoProvider,
) => Promise<OfferedSsoProvider | null> = async (
  remembered: RememberedSsoProvider,
): Promise<OfferedSsoProvider | null> => {
  let response: HTTPResponse<JSONObject> | HTTPErrorResponse;

  try {
    response = await API.get<JSONObject>({
      url: getProjectSignInMethodsApiUrl(remembered.projectId),
    });
  } catch (err) {
    response =
      err instanceof HTTPErrorResponse ? err : new HTTPErrorResponse(0, {}, {});
  }

  if (response instanceof HTTPErrorResponse) {
    /*
     * The server answered that it has no such project to ask about: forget
     * it. A refusal for now - too many requests, a proxy's 403 - says
     * nothing of the provider, so it is kept.
     */
    if (FORGETTING_STATUSES.includes(response.statusCode)) {
      forgetRememberedSsoProvider();
    }

    return null;
  }

  const listed: SsoSignInProvider | undefined =
    SignInMethodsUtil.parseProjectMethods(response.data).ssoProviders.find(
      (provider: SsoSignInProvider): boolean => {
        return (
          provider.type === remembered.type &&
          provider.id.toLowerCase() === remembered.providerId
        );
      },
    );

  if (!listed) {
    forgetRememberedSsoProvider();
    return null;
  }

  return { provider: listed, projectId: remembered.projectId };
};

/*
 * The remembered provider for "Sign in with SSO", asked about once as the
 * page opens. With nothing remembered, nothing is asked and nothing waited
 * for.
 */
export const useRememberedSsoProvider: () => RememberedSsoProviderRead =
  (): RememberedSsoProviderRead => {
    const [remembered] = useState<RememberedSsoProvider | null>(() => {
      return readRememberedSsoProvider();
    });
    const [offered, setOffered] = useState<OfferedSsoProvider | null>(null);
    const [isReading, setIsReading] = useState<boolean>(Boolean(remembered));

    // Set when the page has moved on: a late answer is dropped.
    const isGoneRef: MutableRefObject<boolean> = useRef<boolean>(false);

    useEffect(() => {
      isGoneRef.current = false;

      if (remembered) {
        void readOfferedSsoProvider(remembered).then(
          (answer: OfferedSsoProvider | null): void => {
            if (isGoneRef.current) {
              return;
            }

            setOffered(answer);
            setIsReading(false);
          },
        );
      }

      return () => {
        isGoneRef.current = true;
      };
    }, []);

    return {
      isReading: isReading,
      offered: offered,
      forget: (): void => {
        forgetRememberedSsoProvider();
        setOffered(null);
      },
    };
  };

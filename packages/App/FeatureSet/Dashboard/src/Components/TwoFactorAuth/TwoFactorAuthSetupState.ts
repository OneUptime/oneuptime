import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import URL from "Common/Types/API/URL";
import { JSONObject } from "Common/Types/JSON";
import TwoFactorAuthSetupUtil, {
  TWO_FACTOR_AUTH_STATUS_API_ROUTE,
  TwoFactorAuthSetup,
} from "Common/Types/TwoFactorAuthSetup";
import TwoFactorAuthStatus from "Common/Types/TwoFactorAuthStatus";
import { APP_API_URL } from "Common/UI/Config";
import API from "Common/UI/Utils/API/API";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";
import { useEffect, useState } from "react";

/*
 * WHERE THE SIGNED-IN PERSON STANDS ON TWO-FACTOR AUTHENTICATION (#9666), as
 * the Security pages read it: whether it is on, and how many second steps -
 * authenticator apps whose code was entered, security keys, passkeys - are
 * set up behind it (GET /user/two-factor-auth-status). The server counts
 * them as it does when it refuses turning it on with none, or removing the
 * last one, so the pages offer what it allows.
 */

export interface TwoFactorAuthSetupState {
  setup: TwoFactorAuthSetup | null;
  isLoading: boolean;
  // Said in the reader's words by the page (API.getFriendlyMessage).
  error: unknown;
}

const NOT_AN_ANSWER_MESSAGE: string = translationKey(
  "Your two-factor authentication status could not be loaded.",
);

// An answer that came but is not one: said in the reader's words by the page.
export class TwoFactorAuthSetupNotAnAnswer extends Error {
  public constructor() {
    super(NOT_AN_ANSWER_MESSAGE);
  }
}

/*
 * What a failed read says, in the reader's language: an answer that is not
 * one in the page's own words, anything else as API.getFriendlyMessage
 * words it.
 */
export const describeTwoFactorAuthSetupError: (data: {
  error: unknown;
  translateText: (text: string) => string;
  getFriendlyMessage: (error: unknown) => string;
}) => string = (data: {
  error: unknown;
  translateText: (text: string) => string;
  getFriendlyMessage: (error: unknown) => string;
}): string => {
  if (data.error instanceof TwoFactorAuthSetupNotAnAnswer) {
    return data.translateText(NOT_AN_ANSWER_MESSAGE);
  }

  return data.getFriendlyMessage(data.error);
};

/*
 * The signed-in person's setup. Throws what the request failed with, or an
 * error of its own when the answer is not one.
 */
export const fetchTwoFactorAuthSetup: (
  signal?: AbortSignal | undefined,
) => Promise<TwoFactorAuthSetup> = async (
  signal?: AbortSignal | undefined,
): Promise<TwoFactorAuthSetup> => {
  const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
    await API.get<JSONObject>({
      url: URL.fromString(APP_API_URL.toString()).addRoute(
        TWO_FACTOR_AUTH_STATUS_API_ROUTE,
      ),
      ...(signal ? { options: { signal: signal } } : {}),
    });

  if (response instanceof HTTPErrorResponse) {
    throw response;
  }

  const setup: TwoFactorAuthSetup | null = TwoFactorAuthSetupUtil.parse(
    response.data,
  );

  if (!setup) {
    throw new TwoFactorAuthSetupNotAnAnswer();
  }

  return setup;
};

/*
 * Reads the setup, and again each time `refreshToggle` changes: after a
 * second step is added or removed, or two-factor authentication is turned
 * on or off.
 */
export const useTwoFactorAuthSetup: (
  refreshToggle: number,
) => TwoFactorAuthSetupState = (
  refreshToggle: number,
): TwoFactorAuthSetupState => {
  const [state, setState] = useState<TwoFactorAuthSetupState>({
    setup: null,
    isLoading: true,
    error: null,
  });

  useEffect(() => {
    const controller: AbortController = new AbortController();

    setState((previous: TwoFactorAuthSetupState): TwoFactorAuthSetupState => {
      return { ...previous, isLoading: true, error: null };
    });

    fetchTwoFactorAuthSetup(controller.signal)
      .then((setup: TwoFactorAuthSetup): void => {
        if (!controller.signal.aborted) {
          setState({ setup: setup, isLoading: false, error: null });
        }
      })
      .catch((error: unknown): void => {
        if (!controller.signal.aborted) {
          setState({ setup: null, isLoading: false, error: error });
        }
      });

    return () => {
      controller.abort();
    };
  }, [refreshToggle]);

  return state;
};

/*
 * Why a second step cannot be removed now, or undefined when it can: the
 * last verified one while two-factor authentication is on (#9666). The
 * server refuses that delete too; the list locks it first, with what to do.
 * An unfinished setup, which no sign-in can ask for, can always go.
 */
export const LAST_SECOND_STEP_DELETE_REASON: string = translationKey(
  "Two-factor authentication needs at least one second step. Add another, or turn off two-factor authentication, before you remove this one.",
);

export const getSecondStepDeleteDisabledReason: (data: {
  setup: TwoFactorAuthSetup | null;
  isVerified: boolean | undefined;
}) => string | undefined = (data: {
  setup: TwoFactorAuthSetup | null;
  isVerified: boolean | undefined;
}): string | undefined => {
  if (!data.setup || data.isVerified !== true) {
    return undefined;
  }

  if (
    data.setup.status === TwoFactorAuthStatus.EnabledConfigured &&
    data.setup.verifiedMethodCount <= 1
  ) {
    return LAST_SECOND_STEP_DELETE_REASON;
  }

  return undefined;
};

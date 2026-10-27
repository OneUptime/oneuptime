import { SIGN_IN_METHODS_API_URL } from "./ApiPaths";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import { JSONObject } from "Common/Types/JSON";
import SignInMethodsUtil, {
  SignInMethods,
} from "Common/Types/SSO/SignInMethods";
import API from "Common/UI/Utils/API/API";
import { MutableRefObject, useEffect, useRef, useState } from "react";

/*
 * How this server signs people in (GET /identity/sign-in-methods), read as a
 * sign-in page opens: whether it requires single sign-on - the page then
 * offers nothing else - and its instance-wide providers.
 *
 * Null when it cannot be read - a proxy's page, the server restarting - or
 * says something that is not an answer: the page then shows what it shows
 * when SSO is not required, and the server still refuses whatever it must
 * (a password sign-in while SSO is required).
 */
export const readSignInMethods: () => Promise<SignInMethods | null> =
  async (): Promise<SignInMethods | null> => {
    try {
      const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
        await API.get<JSONObject>({ url: SIGN_IN_METHODS_API_URL });

      if (response instanceof HTTPErrorResponse) {
        return null;
      }

      return SignInMethodsUtil.parse(response.data);
    } catch {
      return null;
    }
  };

export interface SignInMethodsRead {
  // Null until read, and when it could not be.
  signInMethods: SignInMethods | null;
  isReading: boolean;
  /*
   * Reads them again, quietly - the page stays as it is until the answer is
   * back: for a page told by the server that SSO is required now.
   */
  readAgain: () => void;
}

/*
 * The server's sign-in methods for a page: the ones a page that drew this
 * one has read already (`known`), or read once as it opens. While reading,
 * the page draws nothing of its own - never a password form it may then
 * take away.
 */
export const useSignInMethods: (
  known?: SignInMethods | undefined,
) => SignInMethodsRead = (
  known?: SignInMethods | undefined,
): SignInMethodsRead => {
  const [signInMethods, setSignInMethods] = useState<SignInMethods | null>(
    known || null,
  );
  const [isReading, setIsReading] = useState<boolean>(!known);

  /*
   * Bumped by every read, and on unmount: an answer for a read the page has
   * moved on from is dropped.
   */
  const readRef: MutableRefObject<number> = useRef<number>(0);

  const read: () => void = (): void => {
    const thisRead: number = readRef.current + 1;
    readRef.current = thisRead;

    void readSignInMethods().then((methods: SignInMethods | null): void => {
      if (readRef.current !== thisRead) {
        return;
      }

      setSignInMethods(methods);
      setIsReading(false);
    });
  };

  useEffect(() => {
    if (!known) {
      read();
    }

    return () => {
      readRef.current += 1;
    };
  }, []);

  return {
    signInMethods: signInMethods,
    isReading: isReading,
    readAgain: read,
  };
};

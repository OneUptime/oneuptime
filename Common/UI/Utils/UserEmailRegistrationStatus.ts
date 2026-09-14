import {
  MutableRefObject,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import Dictionary from "../../Types/Dictionary";
import Email from "../../Types/Email";
import HTTPErrorResponse from "../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../Types/API/HTTPResponse";
import URL from "../../Types/API/URL";
import { JSONObject } from "../../Types/JSON";
import TeamMember from "../../Models/DatabaseModels/TeamMember";
import API from "./API/API";
import { APP_API_URL } from "../Config";

export interface UserEmailRegistrationStatus {
  /*
   * null: unknown — email is empty/invalid, the check is still in flight,
   * or the check failed. true/false: the email does / does not belong to an
   * existing OneUptime account.
   */
  isEmailRegistered: boolean | null;
  checkEmail: (email: string) => void;
}

/*
 * Debounce-checks whether an email already has a OneUptime account, for
 * invite forms that only need to ask for the invitee's name when the
 * account does not exist yet.
 */
export function useUserEmailRegistrationStatus(options?: {
  getRequestHeaders?: (() => Dictionary<string>) | undefined;
}): UserEmailRegistrationStatus {
  const [isEmailRegistered, setIsEmailRegistered] = useState<boolean | null>(
    null,
  );

  const debounceTimeout: MutableRefObject<ReturnType<
    typeof setTimeout
  > | null> = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestEmail: MutableRefObject<string> = useRef<string>("");

  /*
   * Held in a ref so a caller that writes its options inline - which is every
   * caller - does not get a new checkEmail on every render, and through it a
   * new field definition and a new re-render of the form it is attached to.
   */
  const getRequestHeaders: MutableRefObject<
    (() => Dictionary<string>) | undefined
  > = useRef<(() => Dictionary<string>) | undefined>(
    options?.getRequestHeaders,
  );

  getRequestHeaders.current = options?.getRequestHeaders;

  // A check still in flight when the form closes has nowhere to report to.
  useEffect(() => {
    return () => {
      if (debounceTimeout.current) {
        clearTimeout(debounceTimeout.current);
        debounceTimeout.current = null;
      }
    };
  }, []);

  const checkEmail: (email: string) => void = useCallback(
    (email: string): void => {
      const trimmedEmail: string = (email || "").trim();
      latestEmail.current = trimmedEmail;

      if (debounceTimeout.current) {
        clearTimeout(debounceTimeout.current);
        debounceTimeout.current = null;
      }

      if (!trimmedEmail || !Email.isValid(trimmedEmail)) {
        setIsEmailRegistered(null);
        return;
      }

      debounceTimeout.current = setTimeout(async () => {
        try {
          const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
            await API.post<JSONObject>({
              url: URL.fromString(APP_API_URL.toString())
                .addRoute(new TeamMember().getCrudApiPath()!)
                .addRoute("/is-user-registered"),
              data: {
                email: trimmedEmail,
              },
              ...(getRequestHeaders.current
                ? { headers: getRequestHeaders.current() }
                : {}),
            });

          if (latestEmail.current !== trimmedEmail) {
            return; // a newer email is being checked — ignore this result.
          }

          if (response instanceof HTTPErrorResponse) {
            setIsEmailRegistered(null);
            return;
          }

          setIsEmailRegistered(
            Boolean((response.data as JSONObject)["isRegistered"]),
          );
        } catch {
          if (latestEmail.current === trimmedEmail) {
            setIsEmailRegistered(null);
          }
        }
      }, 400);
    },
    [],
  );

  return { isEmailRegistered, checkEmail };
}

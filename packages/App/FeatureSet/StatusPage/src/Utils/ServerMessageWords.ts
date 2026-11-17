import i18n from "./i18n";
import { STATUS_PAGE_MAGIC_LINK_TURNED_OFF_MESSAGE } from "Common/Types/StatusPage/StatusPageMagicLink";
import {
  STATUS_PAGE_SESSION_EXPIRED_MESSAGE,
  STATUS_PAGE_SIGNED_OUT_MESSAGE,
  STATUS_PAGE_SIGN_IN_TO_VIEW_MESSAGE,
} from "Common/Types/StatusPage/StatusPageSignInMessages";

/*
 * The server answers in English. The messages it sends a status page's
 * reader about signing in are said in the reader's language instead
 * (#9212): each is one of the shared sentences in Common/Types/StatusPage,
 * and has a key under serverMessages in every status page locale. Any other
 * message is shown as the server wrote it.
 */
export const SERVER_MESSAGE_KEYS: Readonly<Record<string, string>> = {
  [STATUS_PAGE_SIGN_IN_TO_VIEW_MESSAGE]: "serverMessages.signInToView",
  [STATUS_PAGE_SESSION_EXPIRED_MESSAGE]: "serverMessages.sessionExpired",
  [STATUS_PAGE_SIGNED_OUT_MESSAGE]: "serverMessages.signedOut",
  [STATUS_PAGE_MAGIC_LINK_TURNED_OFF_MESSAGE]:
    "serverMessages.magicLinkTurnedOff",
};

export const sayServerMessage: (message: string) => string = (
  message: string,
): string => {
  const key: string | undefined = SERVER_MESSAGE_KEYS[message.trim()];

  if (!key) {
    return message;
  }

  return i18n.t(key, { defaultValue: message });
};

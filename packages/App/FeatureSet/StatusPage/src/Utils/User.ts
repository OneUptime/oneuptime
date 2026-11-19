import URL from "Common/Types/API/URL";
import Email from "Common/Types/Email";
import Name from "Common/Types/Name";
import ObjectID from "Common/Types/ObjectID";
import { STATUS_PAGE_IDENTITY_API_URL } from "./Config";
import LocalStorage from "Common/UI/Utils/LocalStorage";
import { Logger } from "Common/UI/Utils/Logger";
import SignOutRequest, { SignOutAnswer } from "Common/UI/Utils/SignOutRequest";

export default class User {
  private static getMasterPasswordStorageKeys(
    statusPageId: ObjectID,
  ): Array<string> {
    return [
      `masterPasswordValidated-${statusPageId.toString()}`,
      "masterPasswordValidated",
    ];
  }

  public static setUserId(statusPageId: ObjectID, userId: ObjectID): void {
    LocalStorage.setItem(
      statusPageId.toString() + "user_id",
      userId.toString(),
    );
  }

  public static getUserId(statusPageId: ObjectID): ObjectID {
    return new ObjectID(
      (LocalStorage.getItem(statusPageId.toString() + "user_id") as string) ||
        "",
    );
  }

  public static getName(statusPageId: ObjectID): Name {
    return new Name(
      (LocalStorage.getItem(statusPageId.toString() + "user_name") as string) ||
        "",
    );
  }

  public static setName(statusPageId: ObjectID, name: Name): void {
    LocalStorage.setItem(
      statusPageId.toString() + "user_name",
      name.toString(),
    );
  }

  public static removeName(statusPageId: ObjectID): void {
    LocalStorage.removeItem(statusPageId.toString() + "user_name");
  }

  public static removeUser(statusPageId: ObjectID): void {
    this.removeUserId(statusPageId);
    this.removeUserEmail(statusPageId);
    this.removeName(statusPageId);
  }

  public static getEmail(statusPageId: ObjectID): Email | null {
    if (!LocalStorage.getItem(statusPageId.toString() + "user_email")) {
      return null;
    }

    return new Email(
      LocalStorage.getItem(statusPageId.toString() + "user_email") as string,
    );
  }

  public static setEmail(statusPageId: ObjectID, email: Email): void {
    LocalStorage.setItem(statusPageId.toString() + "user_email", email);
  }

  public static removeUserId(statusPageId: ObjectID): void {
    LocalStorage.removeItem(statusPageId.toString() + "user_id");
  }

  public static removeUserEmail(statusPageId: ObjectID): void {
    LocalStorage.removeItem(statusPageId.toString() + "user_email");
  }

  public static removeInitialUrl(statusPageId: ObjectID): void {
    return sessionStorage.removeItem(statusPageId.toString() + "initialUrl");
  }

  public static isLoggedIn(statusPageId: ObjectID): boolean {
    return Boolean(this.getEmail(statusPageId));
  }

  /*
   * Signs the reader out of this page: forgets them here at once, then ends
   * their session on the server, whose answer clears the page's HttpOnly
   * cookies. Resolves once the server has answered, or once the wait for it
   * is over, and never rejects: await it before the page changes (issue
   * #9508). The request is sent so that no page change cancels it
   * (SignOutRequest, keepalive), and it is no API client's, so a sign-out
   * run from API.handleError never refreshes or signs out again.
   */
  public static async logout(statusPageId: ObjectID): Promise<void> {
    this.removeUser(statusPageId);
    for (const storageKey of this.getMasterPasswordStorageKeys(statusPageId)) {
      LocalStorage.removeItem(storageKey);
    }

    /*
     * Same origin as the page, like the refresh in ./API.ts: on a custom domain
     * the session cookies are not sent to IDENTITY_URL's host, so a logout
     * there cleared nothing.
     */
    const answer: SignOutAnswer = await SignOutRequest.send(
      URL.fromURL(STATUS_PAGE_IDENTITY_API_URL).addRoute(
        `/logout/${statusPageId.toString()}`,
      ),
    );

    if (
      answer === SignOutAnswer.Refused ||
      answer === SignOutAnswer.Unreachable
    ) {
      Logger.error(`Error during logout: ${answer}`);
    }
  }
}

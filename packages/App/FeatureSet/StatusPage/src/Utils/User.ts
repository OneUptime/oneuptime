import URL from "Common/Types/API/URL";
import Email from "Common/Types/Email";
import Name from "Common/Types/Name";
import ObjectID from "Common/Types/ObjectID";
import API from "Common/Utils/API";
import { STATUS_PAGE_IDENTITY_API_URL } from "./Config";
import LocalStorage from "Common/UI/Utils/LocalStorage";

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

  public static async logout(statusPageId: ObjectID): Promise<void> {
    /*
     * Same origin as the page, like the refresh in ./API.ts: on a custom domain
     * the session cookies are not sent to IDENTITY_URL's host, so a logout
     * there cleared nothing. The bare API client on purpose - this runs from
     * API.handleError, and must not trigger another refresh or logout.
     */
    await API.post({
      url: URL.fromURL(STATUS_PAGE_IDENTITY_API_URL).addRoute(
        `/logout/${statusPageId.toString()}`,
      ),
    });
    this.removeUser(statusPageId);
    for (const storageKey of this.getMasterPasswordStorageKeys(statusPageId)) {
      LocalStorage.removeItem(storageKey);
    }
  }
}

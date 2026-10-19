import UserUtil from "../../../UI/Utils/User";
import LocalStorage from "../../../UI/Utils/LocalStorage";
import CookieName from "../../../Types/CookieName";
import Email from "../../../Types/Email";
import { ObjectType } from "../../../Types/JSON";
import { beforeEach, describe, expect, test } from "@jest/globals";

/*
 * The signed-in user's address is kept twice: in the email cookie the server
 * sets at sign-in (plain text, for 30 days), and in local storage, where
 * UserUtil.setEmail keeps the Email itself. With no cookie - it ran out, or
 * this host never had one - getEmail reads local storage, which gives the
 * address back as an Email. Once Email's constructor refused everything that
 * is not text, that read threw, and isLoggedIn() with it, on every page that
 * asks whether someone is signed in.
 */
describe("UserUtil reads the address local storage holds", () => {
  beforeEach(() => {
    window.localStorage.clear();
    document.cookie =
      CookieName.Email + "=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/";
  });

  test("with no email cookie, the address set at sign-in is the user's", () => {
    UserUtil.setEmail(new Email("Ada@Example.com"));

    // Stored as an Email, and read back as one.
    expect(JSON.parse(window.localStorage.getItem("user_email")!)).toEqual({
      _type: ObjectType.Email,
      value: "ada@example.com",
    });
    expect(LocalStorage.getItem("user_email")).toBeInstanceOf(Email);

    const email: Email | null = UserUtil.getEmail();

    expect(email).toBeInstanceOf(Email);
    expect(email?.toString()).toBe("ada@example.com");
    expect(UserUtil.isLoggedIn()).toBe(true);
  });

  test("the email cookie, when there is one, is read first", () => {
    UserUtil.setEmail(new Email("stored@example.com"));
    document.cookie = CookieName.Email + "=cookie%40example.com; path=/";

    expect(UserUtil.getEmail()?.toString()).toBe("cookie@example.com");
  });

  test("with nothing stored, no one is signed in", () => {
    expect(UserUtil.getEmail()).toBeNull();
    expect(UserUtil.isLoggedIn()).toBe(false);
  });
});

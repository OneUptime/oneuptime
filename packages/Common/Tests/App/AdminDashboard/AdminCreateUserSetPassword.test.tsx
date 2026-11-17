import "@testing-library/jest-dom";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import React, { act } from "react";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { SpyInstance } from "jest-mock";
import { MemoryRouter } from "react-router-dom";
import fs from "fs";
import path from "path";

/*
 * ADMIN DASHBOARD > USERS > CREATE USER (#9139).
 *
 * The form used to ask for an email, then a password, then a name, and left
 * the master admin to invent a password and pass it on. Now:
 *
 *   - it asks for the name, then the email; the password is optional, folded
 *     under More fields, and still held to the one rule (Types/Password);
 *   - left empty, the new user is emailed a link to set their own
 *     (POST /user/:userId/send-password-reset-link), and a toast says to whom;
 *   - a password set by the admin is said in a toast too, with no email;
 *   - when the email is not sent, a dialog says so - OneUptime's words first,
 *     the mail server's second - and hands over the link to send by hand
 *     (POST /user/:userId/set-password-link), or the way to set a password;
 *   - on a server known not to send email, the password is not folded, and
 *     its help says why.
 *
 * The real ModelTable is stood in for: what is pinned is what the page hands
 * it, and what the page does with a user it created.
 */

jest.mock("react-i18next", () => {
  return {
    useTranslation: () => {
      return {
        /*
         * The page's own keys come back with what was put in them, so a
         * test can see the name and address it was handed; the shared
         * translator's English look-ups come back as their English.
         */
        t: (key: string, values?: Record<string, unknown>): string => {
          if (!values || "defaultValue" in values) {
            return (values?.["defaultValue"] as string | undefined) || key;
          }

          return `${key} ${JSON.stringify(values)}`;
        },
      };
    },
  };
});

jest.mock("../../../UI/Utils/Permission", () => {
  return {
    __esModule: true,
    default: {
      getAllPermissions: () => {
        return [];
      },
      getProjectPermissions: () => {
        return [];
      },
      getGlobalPermissions: () => {
        return [];
      },
    },
  };
});

jest.mock("../../../UI/Utils/User", () => {
  return {
    __esModule: true,
    default: {
      isMasterAdmin: () => {
        return true;
      },
      getUserId: () => {
        return null;
      },
    },
  };
});

jest.mock("../../../UI/Utils/UpdateStatus", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "../../../UI/Utils/UpdateStatus",
  ) as Record<string, unknown>;

  return {
    ...actual,
    useUpdateStatus: (): null => {
      return null;
    },
  };
});

// Whether this server can send email, as GET /global-config/vars says.
let canSendEmail: boolean | null = true;

jest.mock("../../../UI/Utils/ServerSending", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "../../../UI/Utils/ServerSending",
  ) as Record<string, unknown>;

  return {
    ...actual,
    useServerCanSendEmail: (): boolean | null => {
      return canSendEmail;
    },
  };
});

type CapturedTableProps = {
  formFields?: Array<Field<User>> | undefined;
  hideChangeToasts?: boolean | undefined;
  onBeforeCreate?:
    | ((item: User, misc: JSONObject, values: JSONObject) => Promise<User>)
    | undefined;
  onCreateSuccess?:
    | ((item: User, modalType?: ModalType) => Promise<User>)
    | undefined;
};

let capturedTableProps: CapturedTableProps | null = null;

jest.mock("../../../UI/Components/ModelTable/ModelTable", () => {
  return {
    __esModule: true,
    default: (props: CapturedTableProps) => {
      capturedTableProps = props;
      return null;
    },
  };
});

import Users from "../../../../App/FeatureSet/AdminDashboard/src/Pages/Users/Index";
import {
  PASSWORD_FOLD_SUMMARY_EMAIL,
  PASSWORD_FOLD_SUMMARY_PASSWORD,
  PASSWORD_HELP_NO_EMAIL,
  SET_PASSWORD_EMAIL_NOT_SENT,
  SET_PASSWORD_LINK_NOT_MADE,
} from "../../../../App/FeatureSet/AdminDashboard/src/Components/User/SetPasswordLink";
import Field from "../../../UI/Components/Forms/Types/Field";
import FormValues from "../../../UI/Components/Forms/Types/FormValues";
import { ModalType } from "../../../UI/Components/ModelTable/BaseModelTable";
import { MORE_FIELDS_SECTION_TITLE } from "../../../UI/Components/Forms/Utils/AdvancedFormSection";
import API from "../../../UI/Utils/API/API";
import Toast from "../../../UI/Utils/Toast";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import URL from "../../../Types/API/URL";
import Email from "../../../Types/Email";
import HashedString from "../../../Types/HashedString";
import { JSONObject } from "../../../Types/JSON";
import Name from "../../../Types/Name";
import ObjectID from "../../../Types/ObjectID";
import { PASSWORD_RULE_MESSAGES } from "../../../Types/Password";
import {
  SET_PASSWORD_LINK_CANNOT_BE_EMAILED_MESSAGE,
  SET_PASSWORD_LINK_HAS_PASSWORD_MESSAGE,
} from "../../../Types/Accounts/SetPasswordLink";
import User from "../../../Models/DatabaseModels/User";

const LINK: string =
  "https://oneuptime.example.com/accounts/set-password/6f1c7e4a-2b3d-4c5e-8f90-a1b2c3d4e5f6";

const renderPage: () => Promise<void> = async (): Promise<void> => {
  await act(async () => {
    render(
      <MemoryRouter>
        <Users />
      </MemoryRouter>,
    );
  });
};

const formFields: () => Array<Field<User>> = (): Array<Field<User>> => {
  return capturedTableProps?.formFields || [];
};

const fieldNames: () => Array<string> = (): Array<string> => {
  return formFields().map((field: Field<User>): string => {
    return Object.keys(field.field || {})[0] || "";
  });
};

const passwordField: () => Field<User> = (): Field<User> => {
  return formFields().find((field: Field<User>) => {
    return Boolean((field.field as JSONObject | undefined)?.["password"]);
  })!;
};

const aNewUser: () => User = (): User => {
  const user: User = new User();
  user.id = ObjectID.generate();
  user.name = new Name("Ada Lovelace");
  user.email = new Email("ada@example.com");
  return user;
};

type PostAnswer = (url: URL) => HTTPResponse<JSONObject> | HTTPErrorResponse;

let postAnswer: PostAnswer;
let postedUrls: Array<string>;

const answerWith: (data: {
  emailed?: HTTPResponse<JSONObject> | HTTPErrorResponse;
  link?: HTTPResponse<JSONObject> | HTTPErrorResponse;
}) => PostAnswer = (data: {
  emailed?: HTTPResponse<JSONObject> | HTTPErrorResponse;
  link?: HTTPResponse<JSONObject> | HTTPErrorResponse;
}): PostAnswer => {
  return (url: URL): HTTPResponse<JSONObject> | HTTPErrorResponse => {
    if (url.toString().endsWith("/send-password-reset-link")) {
      return (
        data.emailed ||
        new HTTPResponse<JSONObject>(200, { email: "ada@example.com" }, {})
      );
    }

    return data.link || new HTTPResponse<JSONObject>(200, { link: LINK }, {});
  };
};

const createUser: (data: {
  user: User;
  password?: unknown;
}) => Promise<void> = async (data: {
  user: User;
  password?: unknown;
}): Promise<void> => {
  await act(async () => {
    await capturedTableProps!.onBeforeCreate!(
      data.user,
      {},
      { password: data.password as JSONObject[string] },
    );
    await capturedTableProps!.onCreateSuccess!(data.user, ModalType.Create);
  });
};

describe("Admin > Users > Create User", () => {
  let toastSuccess: SpyInstance<typeof Toast.success>;

  beforeEach(() => {
    capturedTableProps = null;
    canSendEmail = true;
    postedUrls = [];
    postAnswer = answerWith({});

    jest.spyOn(API, "post").mockImplementation((async (options: {
      url: URL;
    }) => {
      postedUrls.push(options.url.toString());
      return postAnswer(options.url);
    }) as never);

    toastSuccess = jest.spyOn(Toast, "success").mockImplementation(() => {
      return "toast";
    });
  });

  afterEach(() => {
    cleanup();
    jest.restoreAllMocks();
  });

  describe("the form asks only what it cannot work out", () => {
    test("name first, then email, then the password nobody has to set", async () => {
      await renderPage();

      expect(fieldNames()).toEqual(["name", "email", "password"]);
    });

    test("the password is optional, but anything typed is held to the one rule", async () => {
      await renderPage();

      const password: Field<User> = passwordField();

      expect(password.required).toBe(false);
      expect(
        password.customValidation!({ password: "" } as FormValues<User>),
      ).toBeNull();
      expect(password.customValidation!({} as FormValues<User>)).toBeNull();
      expect(
        password.customValidation!({
          password: new HashedString("short"),
        } as unknown as FormValues<User>),
      ).toBe(PASSWORD_RULE_MESSAGES.tooShort);
      expect(
        password.customValidation!({
          password: "violet river lantern",
        } as unknown as FormValues<User>),
      ).toBeNull();
    });

    test("the password is folded under More fields, which says what happens either way", async () => {
      await renderPage();

      const section: Field<User>["collapsibleSection"] =
        passwordField().collapsibleSection;

      expect(section?.title).toBe(MORE_FIELDS_SECTION_TITLE);
      expect(section?.getSummary!({} as FormValues<User>)).toEqual([
        PASSWORD_FOLD_SUMMARY_EMAIL,
      ]);
      expect(
        section?.getSummary!({
          password: new HashedString("violet river lantern"),
        } as unknown as FormValues<User>),
      ).toEqual([PASSWORD_FOLD_SUMMARY_PASSWORD]);
    });

    test("it is still somebody else's password: no password manager saves it", async () => {
      await renderPage();

      expect(passwordField().isOwnCredential).toBe(false);
    });

    test("on a server known not to send email, the password is in view and says why", async () => {
      canSendEmail = false;

      await renderPage();

      expect(passwordField().collapsibleSection).toBeUndefined();
      expect(passwordField().description).toBe(PASSWORD_HELP_NO_EMAIL);
      expect(passwordField().required).toBe(false);
    });

    test("the create says what it did itself, not the generic toast", async () => {
      await renderPage();

      expect(capturedTableProps?.hideChangeToasts).toBe(true);
    });
  });

  describe("created with no password: the new user is emailed a link", () => {
    test("asks the server to email the user just created, and says to whom", async () => {
      await renderPage();

      const user: User = aNewUser();

      await createUser({ user: user, password: "" });

      expect(postedUrls).toHaveLength(1);
      expect(postedUrls[0]).toContain(
        `/user/${user.id!.toString()}/send-password-reset-link`,
      );
      expect(toastSuccess).toHaveBeenCalledTimes(1);
      expect(toastSuccess.mock.calls[0]![0]).toBe(
        `pages.users.createdAndEmailed ${JSON.stringify({
          name: "Ada Lovelace",
          email: "ada@example.com",
        })}`,
      );
      expect(screen.queryByTestId("set-password-link-dialog")).toBeNull();
    });

    test("an empty HashedString is no password either", async () => {
      await renderPage();

      await createUser({ user: aNewUser(), password: new HashedString("") });

      expect(postedUrls[0]).toContain("/send-password-reset-link");
    });

    test("an edit sends nothing", async () => {
      await renderPage();

      await act(async () => {
        await capturedTableProps!.onCreateSuccess!(aNewUser(), ModalType.Edit);
      });

      expect(postedUrls).toEqual([]);
      expect(toastSuccess).not.toHaveBeenCalled();
    });
  });

  describe("created with a password the admin set", () => {
    test("sends no email, and says the password is theirs to pass on", async () => {
      await renderPage();

      await createUser({
        user: aNewUser(),
        password: new HashedString("violet river lantern"),
      });

      expect(postedUrls).toEqual([]);
      expect(toastSuccess.mock.calls[0]![0]).toBe(
        `pages.users.createdWithPassword ${JSON.stringify({
          name: "Ada Lovelace",
        })}`,
      );
    });
  });

  describe("when the email is not sent", () => {
    test("a dialog says why, in OneUptime's words first, and hands over the link to copy", async () => {
      postAnswer = answerWith({
        emailed: new HTTPErrorResponse(
          400,
          { message: SET_PASSWORD_LINK_CANNOT_BE_EMAILED_MESSAGE },
          {},
        ),
      });

      await renderPage();

      const user: User = aNewUser();

      await createUser({ user: user, password: "" });

      await waitFor(() => {
        expect(screen.getByTestId("set-password-link-value")).toHaveTextContent(
          LINK,
        );
      });

      expect(toastSuccess).not.toHaveBeenCalled();
      expect(postedUrls[1]).toContain(
        `/user/${user.id!.toString()}/set-password-link`,
      );

      const notSent: string =
        screen.getByTestId("set-password-email-not-sent").textContent || "";

      expect(notSent).toContain(
        "Ada Lovelace was created, but the email with a link to set their password was not sent.",
      );
      expect(notSent).toContain(SET_PASSWORD_LINK_CANNOT_BE_EMAILED_MESSAGE);
      expect(notSent.indexOf("Ada Lovelace was created")).toBeLessThan(
        notSent.indexOf("This server cannot send email yet"),
      );

      expect(screen.getByRole("button", { name: /Copy/ })).toBeInTheDocument();
      expect(
        screen.getByTestId("set-password-link-authentication-page"),
      ).toHaveAttribute(
        "href",
        `/admin/users/${user.id!.toString()}/authentication`,
      );
    });

    test("a refused recipient is said with the mail server's words after OneUptime's", async () => {
      postAnswer = answerWith({
        emailed: new HTTPErrorResponse(
          400,
          {
            message:
              "The email with a link to set their password was not sent. Amazon SES has not verified the recipient ada@example.com.",
          },
          {},
        ),
      });

      await renderPage();
      await createUser({ user: aNewUser(), password: "" });

      await waitFor(() => {
        expect(
          screen.getByTestId("set-password-email-not-sent"),
        ).toHaveTextContent("Amazon SES has not verified the recipient");
      });
    });

    test("when the link cannot be made either, says so, and still offers the Authentication page", async () => {
      postAnswer = answerWith({
        emailed: new HTTPErrorResponse(
          400,
          { message: SET_PASSWORD_LINK_CANNOT_BE_EMAILED_MESSAGE },
          {},
        ),
        link: new HTTPErrorResponse(
          400,
          { message: SET_PASSWORD_LINK_HAS_PASSWORD_MESSAGE },
          {},
        ),
      });

      await renderPage();
      await createUser({ user: aNewUser(), password: "" });

      await waitFor(() => {
        expect(
          screen.getByTestId("set-password-link-failed"),
        ).toHaveTextContent(SET_PASSWORD_LINK_HAS_PASSWORD_MESSAGE);
      });

      expect(screen.queryByTestId("set-password-link-value")).toBeNull();
      expect(
        screen.getByTestId("set-password-link-authentication-page"),
      ).toBeInTheDocument();
    });

    test("Done closes the dialog", async () => {
      postAnswer = answerWith({
        emailed: new HTTPErrorResponse(
          400,
          { message: SET_PASSWORD_LINK_CANNOT_BE_EMAILED_MESSAGE },
          {},
        ),
      });

      await renderPage();
      await createUser({ user: aNewUser(), password: "" });

      await waitFor(() => {
        expect(
          screen.getByTestId("set-password-link-value"),
        ).toBeInTheDocument();
      });

      await act(async () => {
        screen.getByRole("button", { name: "Done" }).click();
      });

      expect(screen.queryByTestId("set-password-link-dialog")).toBeNull();
    });
  });
});

describe("Create User's words, in every Admin Dashboard language", () => {
  const LOCALES_DIR: string = path.resolve(
    __dirname,
    "../../../../App/FeatureSet/AdminDashboard/src/Locales",
  );

  const NESTED_KEYS: Array<string> = [
    "createdAndEmailed",
    "createdWithPassword",
    "setPasswordLinkTitle",
    "setPasswordLinkDescription",
    "setPasswordLinkOrSetIt",
  ];

  const ENGLISH_KEYS: Array<string> = [
    SET_PASSWORD_EMAIL_NOT_SENT,
    SET_PASSWORD_LINK_NOT_MADE,
    PASSWORD_FOLD_SUMMARY_EMAIL,
    PASSWORD_FOLD_SUMMARY_PASSWORD,
    PASSWORD_HELP_NO_EMAIL,
    SET_PASSWORD_LINK_CANNOT_BE_EMAILED_MESSAGE,
    SET_PASSWORD_LINK_HAS_PASSWORD_MESSAGE,
  ];

  const readLocale: (file: string) => JSONObject = (file: string) => {
    return JSON.parse(fs.readFileSync(path.join(LOCALES_DIR, file), "utf8"));
  };

  const english: JSONObject = readLocale("en.json");
  const locales: Array<string> = fs
    .readdirSync(LOCALES_DIR)
    .filter((file: string): boolean => {
      return file.endsWith(".json") && file !== "en.json";
    });

  const placeholders: (text: string) => Array<string> = (
    text: string,
  ): Array<string> => {
    return (text.match(/\{\{\w+\}\}/g) || []).sort();
  };

  test("there are 17 other languages", () => {
    expect(locales).toHaveLength(17);
  });

  test.each(locales)("%s says every one in its own words", (file: string) => {
    const locale: JSONObject = readLocale(file);
    const users: JSONObject = (locale["pages"] as JSONObject)[
      "users"
    ] as JSONObject;
    const englishUsers: JSONObject = (english["pages"] as JSONObject)[
      "users"
    ] as JSONObject;

    for (const key of NESTED_KEYS) {
      const value: string = users[key] as string;

      expect(value).toBeTruthy();
      expect(value).not.toBe(englishUsers[key]);
      expect(placeholders(value)).toEqual(
        placeholders(englishUsers[key] as string),
      );
    }

    for (const key of ENGLISH_KEYS) {
      const value: string = locale[key] as string;

      expect(english[key]).toBe(key);
      expect(value).toBeTruthy();
      expect(value).not.toBe(key);
      expect(placeholders(value)).toEqual(placeholders(key));
    }
  });
});

import StatusPageAPI from "../../../../App/FeatureSet/StatusPage/src/Utils/API";
import i18n from "../../../../App/FeatureSet/StatusPage/src/Utils/i18n";
import {
  SERVER_MESSAGE_KEYS,
  sayServerMessage,
} from "../../../../App/FeatureSet/StatusPage/src/Utils/ServerMessageWords";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import { STATUS_PAGE_MAGIC_LINK_TURNED_OFF_MESSAGE } from "../../../Types/StatusPage/StatusPageMagicLink";
import {
  STATUS_PAGE_SESSION_EXPIRED_MESSAGE,
  STATUS_PAGE_SIGNED_OUT_MESSAGE,
  STATUS_PAGE_SIGN_IN_TO_VIEW_MESSAGE,
} from "../../../Types/StatusPage/StatusPageSignInMessages";
import { afterEach, describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * WHAT THE SERVER TELLS A STATUS PAGE'S READER ABOUT SIGNING IN, IN THEIR
 * LANGUAGE (#9212).
 *
 * The server used to say "Please login to view the status page." and
 * "Session expired. Please login again.", in English to every reader. Its
 * sign-in messages are now shared sentences (Common/Types/StatusPage) that
 * say "sign in", and the status page says each in the reader's language
 * through the one place its pages read an error from
 * (API.getFriendlyMessage). Any other message is shown as the server wrote
 * it.
 */

const LOCALES_DIR: string = path.resolve(
  __dirname,
  "../../../../App/FeatureSet/StatusPage/src/Locales",
);

type Json = { [key: string]: unknown };

const locale: (file: string) => Json = (file: string): Json => {
  return JSON.parse(fs.readFileSync(path.join(LOCALES_DIR, file), "utf8"));
};

const valueAt: (json: Json, key: string) => unknown = (
  json: Json,
  key: string,
): unknown => {
  return key.split(".").reduce((value: unknown, part: string): unknown => {
    return value && typeof value === "object"
      ? (value as Json)[part]
      : undefined;
  }, json);
};

const refusal: (message: string) => HTTPErrorResponse = (
  message: string,
): HTTPErrorResponse => {
  return new HTTPErrorResponse(401, { message: message }, {});
};

const SHARED_SENTENCES: Array<string> = [
  STATUS_PAGE_SIGN_IN_TO_VIEW_MESSAGE,
  STATUS_PAGE_SESSION_EXPIRED_MESSAGE,
  STATUS_PAGE_SIGNED_OUT_MESSAGE,
  STATUS_PAGE_MAGIC_LINK_TURNED_OFF_MESSAGE,
];

describe("the server's sign-in sentences", () => {
  test.each(SHARED_SENTENCES)(
    "%j says sign in, never login",
    (sentence: string) => {
      expect(sentence).toMatch(/sign in/i);
      expect(sentence).not.toMatch(/\blog ?in\b|\blogin\b/i);
    },
  );

  test("each has a key on the status page", () => {
    expect(Object.keys(SERVER_MESSAGE_KEYS).sort()).toEqual(
      [...SHARED_SENTENCES].sort(),
    );
  });

  test("the English locale says exactly what the server says", () => {
    const english: Json = locale("en.json");

    for (const [sentence, key] of Object.entries(SERVER_MESSAGE_KEYS)) {
      expect({ key: key, value: valueAt(english, key) }).toEqual({
        key: key,
        value: sentence,
      });
    }
  });
});

describe("every status page language says them in its own words", () => {
  const files: Array<string> = fs
    .readdirSync(LOCALES_DIR)
    .filter((file: string): boolean => {
      return file.endsWith(".json") && file !== "en.json";
    });

  test("there are languages to check", () => {
    expect(files.length).toBeGreaterThanOrEqual(17);
  });

  test.each(files)("%s", (file: string) => {
    const words: Json = locale(file);

    for (const [sentence, key] of Object.entries(SERVER_MESSAGE_KEYS)) {
      const value: unknown = valueAt(words, key);

      expect({ key: key, isText: typeof value === "string" }).toEqual({
        key: key,
        isText: true,
      });
      expect(value).not.toBe(sentence);
    }

    // The nav item is Sign Out, under its new key; the old key is gone.
    expect(typeof valueAt(words, "nav.signOut")).toBe("string");
    expect(valueAt(words, "nav.logout")).toBeUndefined();
  });
});

describe("what the reader sees", () => {
  afterEach(async () => {
    StatusPageAPI.setServerMessageWords(null);
    await i18n.changeLanguage("en");
  });

  test("a sign-in sentence, in German", async () => {
    StatusPageAPI.setServerMessageWords(sayServerMessage);
    await i18n.changeLanguage("de");

    expect(
      StatusPageAPI.getFriendlyMessage(
        refusal(STATUS_PAGE_SESSION_EXPIRED_MESSAGE),
      ),
    ).toBe(
      valueAt(locale("de.json"), "serverMessages.sessionExpired") as string,
    );
  });

  test("a sign-in sentence, in English", () => {
    StatusPageAPI.setServerMessageWords(sayServerMessage);

    expect(
      StatusPageAPI.getFriendlyMessage(
        refusal(STATUS_PAGE_SIGN_IN_TO_VIEW_MESSAGE),
      ),
    ).toBe(STATUS_PAGE_SIGN_IN_TO_VIEW_MESSAGE);
  });

  test("any other message is shown as the server wrote it", async () => {
    StatusPageAPI.setServerMessageWords(sayServerMessage);
    await i18n.changeLanguage("de");

    expect(
      StatusPageAPI.getFriendlyMessage(refusal("Something else went wrong.")),
    ).toBe("Something else went wrong.");
  });

  test("before the page sets its words, the server's English", () => {
    expect(
      StatusPageAPI.getFriendlyMessage(
        refusal(STATUS_PAGE_SESSION_EXPIRED_MESSAGE),
      ),
    ).toBe(STATUS_PAGE_SESSION_EXPIRED_MESSAGE);
  });

  test("the status page sets its words as it starts", () => {
    const app: string = fs.readFileSync(
      path.resolve(
        __dirname,
        "../../../../App/FeatureSet/StatusPage/src/App.tsx",
      ),
      "utf8",
    );

    expect(app).toContain("API.setServerMessageWords(sayServerMessage);");
  });
});

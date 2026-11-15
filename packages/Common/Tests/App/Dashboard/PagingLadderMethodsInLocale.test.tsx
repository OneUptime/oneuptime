import "@testing-library/jest-dom";
import { afterEach, beforeAll, describe, expect, test } from "@jest/globals";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import fs from "fs";
import { createInstance, i18n } from "i18next";
import path from "path";
import React from "react";
import { I18nextProvider } from "react-i18next";

/*
 * HOW TO REACH ME'S LADDER NAMES A METHOD AS THE CARDS BELOW IT DO (#7178).
 *
 * A step of the ladder, a method still waiting for its code and the Add
 * menus name each method by its own phrase in the reader's language -
 * "Phone call", never the shared "Call", which is a function call in
 * Chinese; "Push notification", never the shared "Push", a payment in
 * Arabic - in one sentence of that language ("{{label}}: {{identifier}}",
 * so French spaces its colon and Chinese writes a full-width one). A number
 * reads +15550100 in every language, and a device registered without a
 * name is an unknown device in the reader's words. Read from the
 * Dashboard's locale files, so a value put back into English fails here.
 */

import PagingLadderEditor from "../../../../App/FeatureSet/Dashboard/src/Components/NotificationRule/PagingLadder/PagingLadderEditor";
import { PagingMethodChoice } from "../../../../App/FeatureSet/Dashboard/src/Components/NotificationRule/PagingLadder/PagingLadderMethods";
import { MethodLabel } from "../../../../App/FeatureSet/Dashboard/src/Components/NotificationRule/PagingLadder/PagingLadderParts";
import { PagingLadderStep } from "../../../Types/NotificationRule/PagingLadder";
import { OnCallPageChannel } from "../../../Types/OnCallDutyPolicy/OnCallPageChannel";
import { withoutIsolateMarks } from "../../Helpers/IsolateMarks";

const LOCALES_DIR: string = path.join(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "App",
  "FeatureSet",
  "Dashboard",
  "src",
  "Locales",
);

const LANGUAGES: Array<string> = ["en", "de", "fr", "zh-CN", "fa", "ar"];
const RIGHT_TO_LEFT: Array<string> = ["fa", "ar"];

const PHONE: string = "+15550100";
const EMAIL_ADDRESS: string = "me@example.com";
const DEVICE: string = "Pixel 8";
// How the server stores a device registered without a name (UserPushAPI).
const UNNAMED_DEVICE: string = "Unknown Device";

const PUSH_ID: string = "c0000000-0000-4000-8000-000000000001";
const SMS_ID: string = "c0000000-0000-4000-8000-000000000002";
const CALL_ID: string = "c0000000-0000-4000-8000-000000000003";
const EMAIL_ID: string = "c0000000-0000-4000-8000-000000000004";
const UNNAMED_PUSH_ID: string = "c0000000-0000-4000-8000-000000000005";

// The key each method is named by, and the English its rows store.
const NAME_KEYS: Record<string, string> = {
  [OnCallPageChannel.Push]: "Push notification",
  [OnCallPageChannel.SMS]: "SMS",
  [OnCallPageChannel.Call]: "Phone call",
  [OnCallPageChannel.Email]: "Email",
};

function readLocale(language: string): Record<string, string> {
  return JSON.parse(
    fs.readFileSync(path.join(LOCALES_DIR, `${language}.json`), "utf8"),
  ) as Record<string, string>;
}

const instances: Record<string, i18n> = {};
const locales: Record<string, Record<string, string>> = {};

beforeAll(async () => {
  for (const language of LANGUAGES) {
    locales[language] = readLocale(language);

    const instance: i18n = createInstance();

    await instance.init({
      lng: language,
      fallbackLng: "en",
      resources: {
        en: { translation: readLocale("en") },
        [language]: { translation: locales[language]! },
      },
      interpolation: { escapeValue: false },
    });

    instances[language] = instance;
  }
});

afterEach(() => {
  cleanup();
  document.documentElement.removeAttribute("dir");
});

const choice: (
  methodColumn: PagingMethodChoice["methodColumn"],
  methodId: string,
  channel: OnCallPageChannel,
  identifier: string,
) => PagingMethodChoice = (
  methodColumn: PagingMethodChoice["methodColumn"],
  methodId: string,
  channel: OnCallPageChannel,
  identifier: string,
): PagingMethodChoice => {
  return {
    methodColumn: methodColumn,
    methodId: methodId,
    channel: channel,
    title: channel,
    identifier: identifier,
    isVerified: true,
    hasPushLevel: methodColumn === "userPushId",
  };
};

const METHODS: Array<PagingMethodChoice> = [
  choice("userPushId", PUSH_ID, OnCallPageChannel.Push, DEVICE),
  choice("userSmsId", SMS_ID, OnCallPageChannel.SMS, PHONE),
  choice("userCallId", CALL_ID, OnCallPageChannel.Call, PHONE),
  choice("userEmailId", EMAIL_ID, OnCallPageChannel.Email, EMAIL_ADDRESS),
  choice("userPushId", UNNAMED_PUSH_ID, OnCallPageChannel.Push, UNNAMED_DEVICE),
];

const step: (
  methodColumn: PagingLadderStep["methodColumn"],
  methodId: string,
  notifyAfterMinutes: number,
) => PagingLadderStep = (
  methodColumn: PagingLadderStep["methodColumn"],
  methodId: string,
  notifyAfterMinutes: number,
): PagingLadderStep => {
  return {
    methodColumn: methodColumn,
    methodId: methodId,
    notifyAfterMinutes: notifyAfterMinutes,
  };
};

// Push and SMS at once, a call after five minutes, an email after ten.
const STEPS: Array<PagingLadderStep> = [
  step("userPushId", PUSH_ID, 0),
  step("userSmsId", SMS_ID, 0),
  step("userCallId", CALL_ID, 5),
  step("userEmailId", EMAIL_ID, 10),
];

function renderEditor(language: string): void {
  if (RIGHT_TO_LEFT.includes(language)) {
    document.documentElement.setAttribute("dir", "rtl");
  }

  render(
    <I18nextProvider i18n={instances[language]!}>
      <PagingLadderEditor
        title="How to reach me when I am on call"
        description="The ladder."
        savedSteps={STEPS}
        methods={METHODS}
        isEditable={true}
        isPushTurnedOff={false}
        differences={[]}
        severityColors={{}}
        onSave={(): Promise<void> => {
          return Promise.resolve();
        }}
      />
    </I18nextProvider>,
  );
}

function renderLabel(language: string, method: PagingMethodChoice): void {
  if (RIGHT_TO_LEFT.includes(language)) {
    document.documentElement.setAttribute("dir", "rtl");
  }

  render(
    <I18nextProvider i18n={instances[language]!}>
      <MethodLabel choice={method} />
    </I18nextProvider>,
  );
}

// A method's name as a language writes it.
function nameIn(language: string, channel: OnCallPageChannel): string {
  const key: string = NAME_KEYS[channel]!;

  return locales[language]![key] || key;
}

// A method's line as a language writes it: its own name, its own colon.
function lineIn(
  language: string,
  channel: OnCallPageChannel,
  identifier: string,
): string {
  const words: Record<string, string> = locales[language]!;

  return (words["{{label}}: {{identifier}}"] || "{{label}}: {{identifier}}")
    .replace("{{label}}", nameIn(language, channel))
    .replace("{{identifier}}", identifier);
}

function unnamedDeviceIn(language: string): string {
  return locales[language]![UNNAMED_DEVICE] || UNNAMED_DEVICE;
}

function drawnLines(): Array<string> {
  return screen
    .getAllByTestId("paging-ladder-method")
    .map((element: HTMLElement): string => {
      return withoutIsolateMarks(element.textContent || "");
    })
    .sort();
}

describe("the ladder's steps name their methods in the reader's words", () => {
  test.each(LANGUAGES)(
    "%s: each step is its method's line in this language",
    (language: string) => {
      renderEditor(language);

      expect(drawnLines()).toEqual(
        [
          lineIn(language, OnCallPageChannel.Push, DEVICE),
          lineIn(language, OnCallPageChannel.SMS, PHONE),
          lineIn(language, OnCallPageChannel.Call, PHONE),
          lineIn(language, OnCallPageChannel.Email, EMAIL_ADDRESS),
        ].sort(),
      );
    },
  );

  test("in English, a call is a phone call and a push a push notification", () => {
    renderEditor("en");

    expect(drawnLines()).toEqual(
      [
        "Email: me@example.com",
        "Phone call: +15550100",
        "Push notification: Pixel 8",
        "SMS: +15550100",
      ].sort(),
    );
  });

  test.each(["de", "fr", "zh-CN", "fa", "ar"])(
    "%s: no step names a method by its English name",
    (language: string) => {
      renderEditor(language);

      /*
       * Each name is translated in this language (SMS is SMS in German,
       * French and Chinese, so it is left out of the check there).
       */
      for (const channel of [
        OnCallPageChannel.Push,
        OnCallPageChannel.Call,
        OnCallPageChannel.Email,
      ]) {
        expect([language, channel, nameIn(language, channel)]).not.toEqual([
          language,
          channel,
          NAME_KEYS[channel],
        ]);
      }

      for (const line of drawnLines()) {
        for (const english of ["Push notification", "Phone call", "Call"]) {
          expect([language, line, line.includes(english)]).toEqual([
            language,
            line,
            false,
          ]);
        }
      }
    },
  );

  test.each(RIGHT_TO_LEFT)(
    "%s: a number reads +15550100, in an isolate that reads left to right",
    (language: string) => {
      renderEditor(language);

      const numbers: Array<Element> = screen
        .getAllByTestId("paging-ladder-method")
        .flatMap((element: HTMLElement): Array<Element> => {
          return Array.from(element.querySelectorAll("bdi")).filter(
            (isolate: Element): boolean => {
              return isolate.textContent === PHONE;
            },
          );
        });

      // The SMS step's and the call step's.
      expect(numbers).toHaveLength(2);

      for (const number of numbers) {
        expect(number).toHaveAttribute("dir", "ltr");
      }
    },
  );

  test("the method's name stands out, and the colon is quieter than the rest", () => {
    renderLabel("de", METHODS[1]!);

    const label: HTMLElement = screen.getByTestId("paging-ladder-method");
    const name: HTMLElement = within(label).getByText(
      nameIn("de", OnCallPageChannel.SMS),
    );

    expect(name).toHaveClass("font-medium", "text-gray-900");
    expect(
      Array.from(label.querySelectorAll("span.text-gray-400")).map(
        (piece: Element): string => {
          return withoutIsolateMarks(piece.textContent || "");
        },
      ),
    ).toEqual([": "]);
  });
});

describe("a device registered without a name", () => {
  test.each(LANGUAGES)(
    "%s: is an unknown device in the reader's words",
    (language: string) => {
      renderLabel(language, METHODS[4]!);

      expect(
        withoutIsolateMarks(
          screen.getByTestId("paging-ladder-method").textContent || "",
        ),
      ).toBe(
        lineIn(language, OnCallPageChannel.Push, unnamedDeviceIn(language)),
      );
    },
  );

  test.each(["de", "fa", "ar"])(
    "%s: never the stored English placeholder",
    (language: string) => {
      renderLabel(language, METHODS[4]!);

      expect(unnamedDeviceIn(language)).not.toBe(UNNAMED_DEVICE);
      expect(
        screen.getByTestId("paging-ladder-method").textContent,
      ).not.toContain(UNNAMED_DEVICE);
    },
  );

  test("a name someone gave the device is drawn as written", () => {
    renderLabel("de", METHODS[0]!);

    expect(
      withoutIsolateMarks(
        screen.getByTestId("paging-ladder-method").textContent || "",
      ),
    ).toBe(lineIn("de", OnCallPageChannel.Push, DEVICE));
  });
});

describe("the Add Step menu", () => {
  test.each(LANGUAGES)(
    "%s: offers each method by its line in this language, drawn as written in the page's direction",
    (language: string) => {
      renderEditor(language);

      fireEvent.click(screen.getByTestId("paging-ladder-add-step-button"));

      const options: Array<HTMLElement> = screen.getAllByTestId(
        /^paging-ladder-add-option-/,
      );

      expect(
        options.map((option: HTMLElement): string => {
          return withoutIsolateMarks(option.textContent || "");
        }),
      ).toEqual([
        lineIn(language, OnCallPageChannel.Push, DEVICE),
        lineIn(language, OnCallPageChannel.SMS, PHONE),
        lineIn(language, OnCallPageChannel.Call, PHONE),
        lineIn(language, OnCallPageChannel.Email, EMAIL_ADDRESS),
        lineIn(language, OnCallPageChannel.Push, unnamedDeviceIn(language)),
      ]);

      /*
       * Never looked up again, and the page's way: on a Persian page every
       * option reads from the right, a "WhatsApp: ..." under a Persian
       * line as much as the Persian ones - no item sets a direction of its
       * own.
       */
      for (const option of options) {
        expect([
          withoutIsolateMarks(option.textContent || ""),
          option.closest("[dir]")?.getAttribute("dir") ?? null,
        ]).toEqual([
          withoutIsolateMarks(option.textContent || ""),
          RIGHT_TO_LEFT.includes(language) ? "rtl" : null,
        ]);
      }
    },
  );
});

describe("the steps' times", () => {
  test.each(LANGUAGES)(
    "%s: each step's time is the reader's, on its heading and in its menu",
    (language: string) => {
      renderEditor(language);

      const atOnce: string = locales[language]!["At once"] || "At once";
      const heading: HTMLElement = screen.getAllByTestId(
        "paging-ladder-step-wait",
      )[0]!;

      expect(withoutIsolateMarks(heading.textContent || "")).toBe(atOnce);

      fireEvent.click(heading);

      expect(
        withoutIsolateMarks(
          screen.getByTestId("paging-ladder-wait-option-0").textContent || "",
        ),
      ).toBe(atOnce);

      // Said whole to a screen reader, in the reader's language.
      expect([
        language,
        (heading.getAttribute("aria-label") || "").includes(
          "Change when this step is sent",
        ),
      ]).toEqual([language, language === "en"]);
    },
  );
});

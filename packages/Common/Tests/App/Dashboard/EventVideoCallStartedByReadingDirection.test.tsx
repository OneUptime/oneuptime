import "@testing-library/jest-dom";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { cleanup, render, screen, within } from "@testing-library/react";
import fs from "fs";
import { createInstance, i18n } from "i18next";
import path from "path";
import React from "react";
import { I18nextProvider } from "react-i18next";
import { MemoryRouter } from "react-router-dom";
import { PROJECT_ID, goTo } from "./SideMenuHarness";
import { withoutIsolateMarks } from "../../Helpers/IsolateMarks";
import { drawLine, isDrawnAsWritten } from "../../Helpers/BidiLayout";
import { SeededRandom, seededRandom } from "../../Helpers/SeededRandom";
import EventVideoCallsCard, {
  EVENT_VIDEO_CALL_STARTED_FACTS_CLASS_NAME,
  EVENT_VIDEO_CALL_STARTED_ROW_CLASS_NAME,
  EVENT_VIDEO_CALL_STARTED_ROW_TEXT_CLASS_NAME,
  EVENT_VIDEO_CALL_STARTED_SEPARATOR_CLASS_NAME,
  EVENT_VIDEO_CALL_STARTED_WHEN_CLASS_NAME,
  EVENT_VIDEO_CALL_STARTED_WHEN_TEST_ID,
  EVENT_VIDEO_CALL_STARTED_WHO_CLASS_NAME,
  EVENT_VIDEO_CALL_STARTED_WHO_TEST_ID,
  EVENT_VIDEO_CALL_STARTER_NAME_CLASS_NAME,
} from "../../../../App/FeatureSet/Dashboard/src/Components/VideoCall/EventVideoCallsCard";
import { VideoCallEventKind } from "../../../../App/FeatureSet/Dashboard/src/Components/VideoCall/useEventVideoCalls";
import ConnectedWorkspaces from "../../../../App/FeatureSet/Dashboard/src/Utils/Workspace/ConnectedWorkspaces";
import IncidentVideoCall from "../../../Models/DatabaseModels/IncidentVideoCall";
import User from "../../../Models/DatabaseModels/User";
import VideoCallConnection from "../../../Models/DatabaseModels/VideoCallConnection";
import ListResult from "../../../Types/BaseDatabase/ListResult";
import Email from "../../../Types/Email";
import Name from "../../../Types/Name";
import ObjectID from "../../../Types/ObjectID";
import {
  FIRST_STRONG_ISOLATE,
  POP_DIRECTIONAL_ISOLATE,
} from "../../../Types/ReadingDirection";
import {
  DOT_ZERO_INLINE_SEPARATOR,
  INLINE_SEPARATOR,
  getInlineSeparator,
} from "../../../Types/Translator";
import VideoCallProvider from "../../../Types/VideoCall/VideoCallProvider";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import PermissionGate, {
  PermissionGateResult,
} from "../../../UI/Utils/PermissionGate";

/*
 * WHO STARTED A CALL, AND WHEN, ON ANY WIDTH AND IN EVERY LANGUAGE (#7086,
 * #7234).
 *
 * Under a call on an incident's page, a line says who started it and when:
 * "Started by Maya Chen · 3 minutes ago", in the reader's language.
 *
 * #7086 made a name that reads the other way from the page (an English name
 * on an Arabic or Persian page) a box of its own, read its own way and cut
 * short at its own end, in a row whose words and time kept their width.
 * Every other line stayed one line of text cut short where the card ended,
 * so on a phone an English page lost the time ("Started by Maya
 * Chen-Rodriguez (Pl..."), while a Persian page kept it: how the line gave
 * way hung on the script of the name. And an earlier call's line, beside
 * its Join link, is 105px wide in Russian: room for neither fact whole.
 *
 * Every line is now drawn the same way (#7234): two facts, who and when, in
 * a row that wraps between them only. Who keeps the sentence's words whole
 * and lets the name give way, cut at its own end, its whole self in its
 * title; when follows on the line where both fit, and starts the next one
 * whole where they do not; the separator between them sits in the room
 * before the time, which the line clips where the time starts a line. The
 * text still reads as one sentence. Drawn here with the real Dashboard
 * locales; a browser lays the row out (the layout is checked there).
 */

const LOCALES: string = path.resolve(
  __dirname,
  "../../../../App/FeatureSet/Dashboard/src/Locales",
);

const readLocale: (language: string) => Record<string, string> = (
  language: string,
): Record<string, string> => {
  return JSON.parse(
    fs.readFileSync(path.join(LOCALES, `${language}.json`), "utf8"),
  ) as Record<string, string>;
};

const RIGHT_TO_LEFT_LANGUAGES: Array<string> = ["ar", "fa"];

// The languages the issue names: English, a long one, and right to left.
const CHECKED_LANGUAGES: Array<string> = ["en", "de", "ru", "ar", "fa"];

// Languages whose sentence puts the name first: "{{name}} ने शुरू किया".
const NAME_FIRST_LANGUAGES: Array<string> = ["hi", "ja"];

const ALL_LANGUAGES: Array<string> = [
  ...CHECKED_LANGUAGES,
  ...NAME_FIRST_LANGUAGES,
];

const ENGLISH_PERSON: string = "Maya Chen-Rodriguez (SRE, EU West)";
const LONG_ENGLISH_PERSON: string =
  "Maya Chen-Rodriguez (Platform, EU West on-call)";
const ARABIC_PERSON: string = "مايا تشين";
const ENGLISH_EMAIL: string = "maya.chen@acme-commerce.example";
/*
 * A name that starts with a number, which a line read from the right pulled
 * apart: its number drawn after its words ("Ops Bot (EU) 911").
 */
const NUMBERED_PERSON: string = "911 Ops Bot (EU)";

const ZOOM_URL: string = "https://example.zoom.us/j/81234567890?pwd=abc";

const instances: Record<string, i18n> = {};
const locales: Record<string, Record<string, string>> = {};

beforeAll(async () => {
  for (const language of ALL_LANGUAGES) {
    const instance: i18n = createInstance();

    locales[language] = readLocale(language);

    await instance.init({
      lng: language,
      fallbackLng: "en",
      resources: { [language]: { translation: locales[language]! } },
      interpolation: { escapeValue: false },
      keySeparator: false,
      nsSeparator: false,
    });

    instances[language] = instance;
  }
});

beforeEach(() => {
  goTo(
    `/dashboard/${PROJECT_ID}/incidents/9e8d7c6b-5a4f-4e3d-8c2b-1a0f9e8d7c6b`,
  );
  ConnectedWorkspaces.reset();

  jest
    .spyOn(PermissionGate, "check")
    .mockImplementation((): PermissionGateResult => {
      return { isAllowed: true };
    });

  jest
    .spyOn(ModelAPI, "getList")
    .mockImplementation(async (): Promise<ListResult<VideoCallConnection>> => {
      return { data: [], count: 0, skip: 0, limit: 100 };
    });
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
  ConnectedWorkspaces.reset();
});

interface Starter {
  name?: string;
  email?: string;
  // No time known: the line says only who started it.
  withoutTime?: boolean;
  // Started by a workspace rule, not by a person.
  byWorkspaceRule?: boolean;
}

const callStartedBy: (person: Starter) => IncidentVideoCall = (
  person: Starter,
): IncidentVideoCall => {
  const call: IncidentVideoCall = new IncidentVideoCall();
  call.id = new ObjectID("0193c0de-7086-4aaa-8bbb-000000000003");
  call.provider = VideoCallProvider.Zoom;
  call.joinUrl = ZOOM_URL;
  call.title = "Checkout bridge";

  const user: User = new User();

  if (person.name) {
    user.name = new Name(person.name);
  }

  if (person.email) {
    user.email = new Email(person.email);
  }

  call.createdByUser = user;

  if (!person.withoutTime) {
    call.createdAt = new Date(Date.now() - 3 * 60 * 1000);
  }

  if (person.byWorkspaceRule) {
    call.workspaceNotificationRuleId = new ObjectID(
      "0193c0de-7086-4aaa-8bbb-000000000004",
    );
  }

  return call;
};

// The line under the call: who started it, and when.
const drawStartedLine: (language: string, person: Starter) => HTMLElement = (
  language: string,
  person: Starter,
): HTMLElement => {
  render(
    <I18nextProvider i18n={instances[language]!}>
      <MemoryRouter>
        <EventVideoCallsCard
          kind={VideoCallEventKind.Incident}
          eventId={new ObjectID("9e8d7c6b-5a4f-4e3d-8c2b-1a0f9e8d7c6b")}
          calls={[callStartedBy(person)]}
          hasLoaded={true}
          onChanged={() => {}}
          onRetry={() => {}}
        />
      </MemoryRouter>
    </I18nextProvider>,
  );

  return screen.getByTestId("event-video-call-started");
};

// "بدأها {{name}}" filled with the name as the sentence holds it.
const startedBySentence: (language: string, name: string) => string = (
  language: string,
  name: string,
): string => {
  const sentence: string = locales[language]!["Started by {{name}}"]!;

  expect(sentence).toContain("{{name}}");

  return sentence.replace("{{name}}", name);
};

// The line's two facts: who, and when.
const factsOf: (line: HTMLElement, language: string) => Array<string> = (
  line: HTMLElement,
  language: string,
): Array<string> => {
  return (line.textContent || "").split(getInlineSeparator(language));
};

// The box that holds the starter's name.
const nameBoxOf: (line: HTMLElement) => HTMLElement = (
  line: HTMLElement,
): HTMLElement => {
  return within(line).getByTestId("event-video-call-started-by-name");
};

const whoOf: (line: HTMLElement) => HTMLElement = (
  line: HTMLElement,
): HTMLElement => {
  return within(line).getByTestId(EVENT_VIDEO_CALL_STARTED_WHO_TEST_ID);
};

const whenOf: (line: HTMLElement) => HTMLElement = (
  line: HTMLElement,
): HTMLElement => {
  return within(line).getByTestId(EVENT_VIDEO_CALL_STARTED_WHEN_TEST_ID);
};

// The sentence's words before the name, as the locale writes them.
const wordsBeforeName: (language: string) => string = (
  language: string,
): string => {
  const sentence: string = locales[language]!["Started by {{name}}"]!;

  return sentence.slice(0, sentence.indexOf("{{name}}"));
};

const wordsAfterName: (language: string) => string = (
  language: string,
): string => {
  const sentence: string = locales[language]!["Started by {{name}}"]!;

  return sentence.slice(sentence.indexOf("{{name}}") + "{{name}}".length);
};

// The line as one layout: a clip, a wrapping row of two facts.
const expectTwoFactsRow: (line: HTMLElement) => {
  facts: HTMLElement;
  who: HTMLElement;
} = (line: HTMLElement): { facts: HTMLElement; who: HTMLElement } => {
  expect(line.tagName).toBe("P");
  // In the page's direction: no dir of its own.
  expect(line).not.toHaveAttribute("dir");
  expect(line.getAttribute("class")).toBe(
    EVENT_VIDEO_CALL_STARTED_ROW_CLASS_NAME,
  );
  // The line clips what its row draws before its start.
  expect(line).toHaveClass("overflow-hidden", "mt-0.5", "text-xs");
  expect(line).toHaveClass("text-gray-500");

  expect(line.children).toHaveLength(1);

  const facts: HTMLElement = line.firstElementChild as HTMLElement;

  expect(facts.getAttribute("class")).toBe(
    EVENT_VIDEO_CALL_STARTED_FACTS_CLASS_NAME,
  );
  // A row that wraps, started the separator's room before the line.
  expect(facts).toHaveClass("flex", "flex-wrap", "-ms-3");

  const who: HTMLElement = whoOf(line);

  expect(who.parentElement).toBe(facts);
  expect(facts.firstElementChild).toBe(who);
  expect(who.getAttribute("class")).toBe(
    EVENT_VIDEO_CALL_STARTED_WHO_CLASS_NAME,
  );
  // One line of its own, as wide as the line at most, its room in front.
  expect(who).toHaveClass(
    "flex",
    "min-w-0",
    "max-w-full",
    "whitespace-nowrap",
    "ps-3",
  );

  return { facts, who };
};

describe("who started a call, and when, in every language", () => {
  test.each(CHECKED_LANGUAGES)(
    "%s: a long name gives way, cut at its own end, its whole self in its title; the time stays, whole, in a box of its own",
    (language: string) => {
      const line: HTMLElement = drawStartedLine(language, {
        name: LONG_ENGLISH_PERSON,
      });
      const { facts, who } = expectTwoFactsRow(line);
      const name: HTMLElement = nameBoxOf(line);
      const when: HTMLElement = whenOf(line);

      // The name is the one box that gives way.
      expect(who).toContainElement(name);
      expect(name.getAttribute("class")).toContain(
        EVENT_VIDEO_CALL_STARTER_NAME_CLASS_NAME,
      );
      expect(name).toHaveClass("min-w-0", "truncate");
      expect(name.textContent).toBe(LONG_ENGLISH_PERSON);
      expect(name).toHaveAttribute("title", LONG_ENGLISH_PERSON);

      // The sentence's words keep their width and their spaces.
      for (const box of Array.from(who.children)) {
        if (box !== name) {
          expect(box.getAttribute("class")).toBe(
            EVENT_VIDEO_CALL_STARTED_ROW_TEXT_CLASS_NAME,
          );
          expect(box).toHaveClass("shrink-0", "whitespace-pre");
        }
      }

      // The time: the row's second fact, never inside who's line.
      expect(when.parentElement).toBe(facts);
      expect(facts.lastElementChild).toBe(when);
      expect(who).not.toContainElement(when);
      expect(when.getAttribute("class")).toBe(
        EVENT_VIDEO_CALL_STARTED_WHEN_CLASS_NAME,
      );
      expect(when.textContent).not.toContain(LONG_ENGLISH_PERSON);
      expect(
        withoutIsolateMarks(when.textContent!).replace(
          getInlineSeparator(language),
          "",
        ),
      ).toBeTruthy();
    },
  );

  test.each(ALL_LANGUAGES)(
    "%s: the line still reads as one sentence: who, the separator, when",
    (language: string) => {
      const line: HTMLElement = drawStartedLine(language, {
        name: LONG_ENGLISH_PERSON,
      });
      const when: HTMLElement = whenOf(line);
      const [who, time] = factsOf(line, language);

      expect(factsOf(line, language)).toHaveLength(2);
      expect(who).toBe(startedBySentence(language, LONG_ENGLISH_PERSON));
      // The name is set apart by its box, not by marks in the text.
      expect(line.textContent).toBe(withoutIsolateMarks(line.textContent!));
      expect(time).toBeTruthy();
      expect(when.textContent).toBe(
        `${getInlineSeparator(language)}${time}`,
      );
    },
  );

  /*
   * The separator sits in the room the time keeps in front of itself
   * (ps-3), drawn into it (-ms-3) as wide as that room (w-3). The facts'
   * row starts that room before the line's start, and the line clips it:
   * where the time starts a line, no line starts with "·".
   */
  test.each(CHECKED_LANGUAGES)(
    "%s: the separator is drawn in the room before the time, which the line clips at its start",
    (language: string) => {
      const line: HTMLElement = drawStartedLine(language, {
        name: ENGLISH_PERSON,
      });
      const when: HTMLElement = whenOf(line);
      const separator: HTMLElement = when.firstElementChild as HTMLElement;

      expect(when).toHaveClass("ps-3", "min-w-0", "max-w-full", "truncate");
      expect(separator.getAttribute("class")).toBe(
        EVENT_VIDEO_CALL_STARTED_SEPARATOR_CLASS_NAME,
      );
      expect(separator).toHaveClass(
        "-ms-3",
        "w-3",
        "inline-block",
        "whitespace-pre",
      );
      expect(separator.textContent).toBe(getInlineSeparator(language));
      // The room each fact keeps is the room the row starts before the line.
      expect(EVENT_VIDEO_CALL_STARTED_FACTS_CLASS_NAME).toContain("-ms-3");
      expect(EVENT_VIDEO_CALL_STARTED_WHO_CLASS_NAME).toContain("ps-3");
      expect(EVENT_VIDEO_CALL_STARTED_WHEN_CLASS_NAME).toContain("ps-3");
    },
  );

  test.each(ALL_LANGUAGES)(
    "%s: who's boxes come in the sentence's order, the name where the sentence puts it",
    (language: string) => {
      const line: HTMLElement = drawStartedLine(language, {
        name: ENGLISH_PERSON,
      });
      const who: HTMLElement = whoOf(line);
      const boxes: Array<Element> = Array.from(who.children);
      const before: string = wordsBeforeName(language);
      const after: string = wordsAfterName(language);
      const expected: Array<string> = [before, ENGLISH_PERSON, after].filter(
        (part: string): boolean => {
          return part.length > 0;
        },
      );

      expect(boxes.map((box: Element) => box.textContent)).toEqual(expected);
      expect(boxes[expected.indexOf(ENGLISH_PERSON)]).toBe(nameBoxOf(line));
    },
  );

  test.each(NAME_FIRST_LANGUAGES)(
    "%s: the name comes first, then the sentence's words, then the time",
    (language: string) => {
      const line: HTMLElement = drawStartedLine(language, {
        name: ENGLISH_PERSON,
      });
      const who: HTMLElement = whoOf(line);

      expect(wordsBeforeName(language)).toBe("");
      expect(who.firstElementChild).toBe(nameBoxOf(line));
      expect(who.lastElementChild!.textContent).toBe(wordsAfterName(language));
      expect(whenOf(line).previousElementSibling).toBe(who);
    },
  );
});

describe("who started a call, read the way it is written", () => {
  test.each(RIGHT_TO_LEFT_LANGUAGES)(
    "%s: an English name is a box of its own that reads its way",
    (language: string) => {
      const sentence: string = locales[language]!["Started by {{name}}"]!;

      // The sentence is the reader's, read right to left.
      expect(sentence).not.toBe("Started by {{name}}");

      const line: HTMLElement = drawStartedLine(language, {
        name: ENGLISH_PERSON,
      });
      const name: HTMLElement = nameBoxOf(line);

      expect(name.tagName).toBe("SPAN");
      expect(name.textContent).toBe(ENGLISH_PERSON);
      expect(name).toHaveAttribute("dir", "ltr");
      // The whole name, when the box cuts it short.
      expect(name).toHaveAttribute("title", ENGLISH_PERSON);
    },
  );

  test.each(RIGHT_TO_LEFT_LANGUAGES)(
    "%s: a name that starts with a number is drawn as written in its box, where plain text in the line was not",
    (language: string) => {
      const line: HTMLElement = drawStartedLine(language, {
        name: NUMBERED_PERSON,
      });
      const name: HTMLElement = nameBoxOf(line);

      expect(name.textContent).toBe(NUMBERED_PERSON);
      expect(name).toHaveAttribute("dir", "ltr");
      /*
       * A box with a dir of its own is an isolate (unicode-bidi: isolate in
       * every browser's own style sheet), drawn in its own direction.
       */
      expect(
        isDrawnAsWritten(
          drawLine(name.textContent!, "ltr"),
          0,
          NUMBERED_PERSON.length,
        ),
      ).toBe(true);

      // Negative control: the same line with the name as plain text.
      const plain: string = withoutIsolateMarks(line.textContent || "");
      const plainAt: number = plain.indexOf(NUMBERED_PERSON);

      expect(plainAt).toBeGreaterThan(0);
      expect(
        isDrawnAsWritten(
          drawLine(plain, "rtl"),
          plainAt,
          plainAt + NUMBERED_PERSON.length,
        ),
      ).toBe(false);
    },
  );

  test.each(RIGHT_TO_LEFT_LANGUAGES)(
    "%s: an email address in place of a name is a box of its own too",
    (language: string) => {
      const line: HTMLElement = drawStartedLine(language, {
        email: ENGLISH_EMAIL,
      });
      const name: HTMLElement = nameBoxOf(line);
      const [who] = factsOf(line, language);

      expect(name.textContent).toBe(ENGLISH_EMAIL);
      expect(name).toHaveAttribute("dir", "ltr");
      expect(name).toHaveAttribute("title", ENGLISH_EMAIL);
      expect(who).toBe(startedBySentence(language, ENGLISH_EMAIL));
    },
  );

  /*
   * A name that reads the sentence's way is drawn the same way as any
   * other (#7234): a box that gives way, cut at its end, with no dir of
   * its own. It used to be plain text in a line cut short where the card
   * ended, which lost the time first.
   */
  test.each(RIGHT_TO_LEFT_LANGUAGES)(
    "%s: an Arabic name is a box too, reading the sentence's way, and the time keeps its own box",
    (language: string) => {
      const line: HTMLElement = drawStartedLine(language, {
        name: ARABIC_PERSON,
      });
      const [who] = factsOf(line, language);
      const name: HTMLElement = nameBoxOf(line);

      expectTwoFactsRow(line);
      expect(who).toBe(startedBySentence(language, ARABIC_PERSON));
      expect(who).not.toContain(FIRST_STRONG_ISOLATE);
      expect(who).not.toContain(POP_DIRECTIONAL_ISOLATE);
      expect(name.textContent).toBe(ARABIC_PERSON);
      expect(name).not.toHaveAttribute("dir");
      expect(name).toHaveClass("min-w-0", "truncate");
      expect(whenOf(line).textContent).not.toContain(ARABIC_PERSON);
    },
  );

  test("on an English page an English name is a box too, with no dir of its own, and the time keeps its own box", () => {
    const line: HTMLElement = drawStartedLine("en", {
      name: LONG_ENGLISH_PERSON,
    });
    const text: string = line.textContent || "";
    const name: HTMLElement = nameBoxOf(line);

    expectTwoFactsRow(line);
    expect(text.startsWith(`Started by ${LONG_ENGLISH_PERSON} · `)).toBe(true);
    expect(text).toBe(withoutIsolateMarks(text));
    expect(name).not.toHaveAttribute("dir");
    expect(name).toHaveAttribute("title", LONG_ENGLISH_PERSON);
    expect(whoOf(line).firstElementChild!.textContent).toBe("Started by ");
    expect(whenOf(line).textContent!.startsWith(" · ")).toBe(true);
  });

  test("on an English page an Arabic name is a box of its own, read right to left", () => {
    const line: HTMLElement = drawStartedLine("en", { name: ARABIC_PERSON });
    const name: HTMLElement = nameBoxOf(line);
    const [who] = factsOf(line, "en");

    expect(name.textContent).toBe(ARABIC_PERSON);
    expect(name).toHaveAttribute("dir", "rtl");
    expect(who).toBe(`Started by ${ARABIC_PERSON}`);
    expectTwoFactsRow(line);
    expect(whoOf(line).firstElementChild!.textContent).toBe("Started by ");
  });
});

describe("a line with one fact, or with no person in it", () => {
  test.each(CHECKED_LANGUAGES)(
    "%s: without a time the row is the sentence alone",
    (language: string) => {
      const line: HTMLElement = drawStartedLine(language, {
        name: ENGLISH_PERSON,
        withoutTime: true,
      });
      const { facts } = expectTwoFactsRow(line);

      expect(line.textContent).toBe(
        startedBySentence(language, ENGLISH_PERSON),
      );
      expect(line.textContent).not.toContain(getInlineSeparator(language));
      expect(facts.children).toHaveLength(1);
      expect(
        within(line).queryByTestId(EVENT_VIDEO_CALL_STARTED_WHEN_TEST_ID),
      ).toBeNull();
    },
  );

  /*
   * A workspace rule's line lost its time as a person's did: "Automatisch
   * von einer Workspace-Regel gestartet ..." in German, beside an earlier
   * call's Join link. It is the same two facts now, its sentence the one
   * that gives way.
   */
  test.each(CHECKED_LANGUAGES)(
    "%s: a call a workspace rule started says so, the time in its own box",
    (language: string) => {
      const line: HTMLElement = drawStartedLine(language, {
        name: ENGLISH_PERSON,
        byWorkspaceRule: true,
      });
      const { who } = expectTwoFactsRow(line);
      const [said] = factsOf(line, language);
      const sentence: HTMLElement = who.firstElementChild as HTMLElement;

      expect(said).toBe(
        locales[language]!["Started automatically by a workspace rule"],
      );
      expect(who.children).toHaveLength(1);
      expect(sentence).toHaveClass(
        ...EVENT_VIDEO_CALL_STARTER_NAME_CLASS_NAME.split(" "),
      );
      expect(line.textContent).not.toContain(ENGLISH_PERSON);
      expect(
        within(line).queryByTestId("event-video-call-started-by-name"),
      ).toBeNull();
      expect(whenOf(line).textContent!.startsWith(getInlineSeparator(language))).toBe(true);
    },
  );

  test.each(CHECKED_LANGUAGES)(
    "%s: a call started from the API says so, the time in its own box",
    (language: string) => {
      const line: HTMLElement = drawStartedLine(language, {});
      const [said] = factsOf(line, language);

      expectTwoFactsRow(line);
      expect(said).toBe(locales[language]!["Started from the API"]);
      expect(whenOf(line)).toBeInTheDocument();
    },
  );
});

describe("the separator, as the reader's language sets facts apart", () => {
  test("Persian sets the time off with a bullet: its zero is a dot", () => {
    const line: HTMLElement = drawStartedLine("fa", { name: ENGLISH_PERSON });

    expect(getInlineSeparator("fa")).toBe(DOT_ZERO_INLINE_SEPARATOR);
    expect(whenOf(line).firstElementChild!.textContent).toBe(
      DOT_ZERO_INLINE_SEPARATOR,
    );
    expect(line.textContent).not.toContain(INLINE_SEPARATOR);
    expect(factsOf(line, "fa")).toHaveLength(2);
  });

  test("Persian sets it off with a bullet for a Persian-script name too", () => {
    const line: HTMLElement = drawStartedLine("fa", { name: ARABIC_PERSON });

    expect(line.textContent).toContain(DOT_ZERO_INLINE_SEPARATOR);
    expect(line.textContent).not.toContain(INLINE_SEPARATOR);
    expect(factsOf(line, "fa")).toHaveLength(2);
  });

  test("Arabic, written in Latin digits, keeps the middle dot", () => {
    const line: HTMLElement = drawStartedLine("ar", { name: ENGLISH_PERSON });

    expect(getInlineSeparator("ar")).toBe(INLINE_SEPARATOR);
    expect(whenOf(line).firstElementChild!.textContent).toBe(INLINE_SEPARATOR);
    expect(factsOf(line, "ar")).toHaveLength(2);
  });
});

/*
 * Whatever the name - its length, its script, its brackets - and whatever
 * the language, the line is drawn one way: who and when as two facts, the
 * name whole in its box and its title, the sentence read as one.
 */
describe("names drawn at random", () => {
  const LETTERS: Array<string> = [
    "abcdefghijklmnopqrstuvwxyz",
    "ابتثجحخدذرزسشصضطظعغفقكلمنهوي",
    "абвгдежзиклмнопрстуфхцчшщ",
    "あいうえおかきくけこさしすせそ",
  ];

  const drawName: (random: SeededRandom) => string = (
    random: SeededRandom,
  ): string => {
    const letters: string = LETTERS[random(LETTERS.length)]!;
    const words: Array<string> = [];
    const wordCount: number = 1 + random(6);

    for (let index: number = 0; index < wordCount; index++) {
      let word: string = "";
      const length: number = 1 + random(12);

      for (let letter: number = 0; letter < length; letter++) {
        word += letters[random(letters.length)];
      }

      words.push(word);
    }

    const name: string = words.join(" ");

    // Now and then a team in brackets, or a number first.
    switch (random(4)) {
      case 0:
        return `${name} (SRE, EU)`;
      case 1:
        return `${1 + random(999)} ${name}`;
      default:
        return name;
    }
  };

  test("the line is two facts, the name whole in its box and title, the sentence one", () => {
    const random: SeededRandom = seededRandom(7234);

    for (let round: number = 0; round < 40; round++) {
      const language: string = ALL_LANGUAGES[random(ALL_LANGUAGES.length)]!;
      const person: string = drawName(random);
      const line: HTMLElement = drawStartedLine(language, { name: person });
      const name: HTMLElement = nameBoxOf(line);
      const [who, when] = factsOf(line, language);

      expectTwoFactsRow(line);
      expect({ language, person, name: name.textContent }).toEqual({
        language,
        person,
        name: person,
      });
      expect(name).toHaveAttribute("title", person);
      expect(who).toBe(startedBySentence(language, person));
      expect(when).toBeTruthy();
      expect(whenOf(line).textContent).toBe(
        `${getInlineSeparator(language)}${when}`,
      );

      cleanup();
    }
  });
});

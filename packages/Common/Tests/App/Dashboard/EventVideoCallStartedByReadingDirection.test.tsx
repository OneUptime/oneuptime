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
import EventVideoCallsCard, {
  EVENT_VIDEO_CALL_STARTED_LINE_CLASS_NAME,
  EVENT_VIDEO_CALL_STARTED_ROW_CLASS_NAME,
  EVENT_VIDEO_CALL_STARTED_ROW_TEXT_CLASS_NAME,
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
 * WHO STARTED A CALL, READ THE WAY IT IS WRITTEN (#7086).
 *
 * Under a call on an incident's page, a line says who started it and when:
 * "Started by Maya Chen · 3 minutes ago", in the reader's language. On an
 * Arabic or Persian page the person's English name sat in the Arabic
 * sentence as plain text: its brackets and the time after it could move
 * around it, and the line - cut short where the card ends - lost the wrong
 * part. And the Persian line set its time off with a middle dot, which
 * beside Persian digits reads as their zero.
 *
 * A name that reads the other way from the page is a box of its own now,
 * in a row of boxes on the line's one line: it reads its own way, keeps
 * its punctuation, and is cut short at its own end ("Maya Chen-Rodriguez
 * (S...") while the sentence's words and the time keep their width. The
 * two facts are set off as the reader's language does (a bullet in
 * Persian). A name that reads the sentence's way, and an English name in
 * the English sentence, are written exactly as they were: one line of
 * text, its values set apart where they could move the words around them
 * (setsValuesApart). Drawn here with the real Dashboard locales.
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

const ENGLISH_PERSON: string = "Maya Chen-Rodriguez (SRE, EU West)";
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
  for (const language of ["en", "ar", "fa"]) {
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

// The box that holds the starter's name, in a line drawn as a row.
const nameBoxOf: (line: HTMLElement) => HTMLElement = (
  line: HTMLElement,
): HTMLElement => {
  return within(line).getByTestId("event-video-call-started-by-name");
};

// The sentence's words before the name, as the locale writes them.
const wordsBeforeName: (language: string) => string = (
  language: string,
): string => {
  const sentence: string = locales[language]!["Started by {{name}}"]!;

  return sentence.slice(0, sentence.indexOf("{{name}}"));
};

describe("who started a call", () => {
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
    "%s: the line still says the sentence and the time, with its spaces",
    (language: string) => {
      const line: HTMLElement = drawStartedLine(language, {
        name: ENGLISH_PERSON,
      });
      const [who, when] = factsOf(line, language);

      expect(who).toBe(startedBySentence(language, ENGLISH_PERSON));
      // The name is set apart by its box, not by marks in the text.
      expect(line.textContent).toBe(withoutIsolateMarks(line.textContent!));
      // The time after it is the reader's, and is not part of the name.
      expect(when).toBeTruthy();
      expect(when).not.toContain(ENGLISH_PERSON);
      expect(factsOf(line, language)).toHaveLength(2);
    },
  );

  test.each(RIGHT_TO_LEFT_LANGUAGES)(
    "%s: the line is a row on one line: the words and the time keep their width, the name gives way and is cut at its own end",
    (language: string) => {
      const line: HTMLElement = drawStartedLine(language, {
        name: ENGLISH_PERSON,
      });
      const name: HTMLElement = nameBoxOf(line);
      const boxes: Array<Element> = Array.from(line.children);

      expect(line.tagName).toBe("P");
      // In the page's direction: no dir of its own.
      expect(line).not.toHaveAttribute("dir");
      expect(line.getAttribute("class")).toBe(
        EVENT_VIDEO_CALL_STARTED_ROW_CLASS_NAME,
      );
      expect(line).toHaveClass(
        "flex",
        "min-w-0",
        "overflow-hidden",
        "whitespace-nowrap",
        "mt-0.5",
        "text-xs",
        "text-gray-500",
      );

      // The name is one of the row's boxes, and the one that gives way.
      expect(name.parentElement).toBe(line);
      expect(name).toHaveClass(
        ...EVENT_VIDEO_CALL_STARTER_NAME_CLASS_NAME.split(" "),
      );
      expect(name).toHaveClass("min-w-0", "truncate");

      // Every other box keeps its width and its spaces.
      const others: Array<Element> = boxes.filter((box: Element): boolean => {
        return box !== name;
      });

      expect(others.length).toBeGreaterThan(0);

      for (const box of others) {
        expect(box.tagName).toBe("SPAN");
        expect(box.getAttribute("class")).toBe(
          EVENT_VIDEO_CALL_STARTED_ROW_TEXT_CLASS_NAME,
        );
        expect(box).toHaveClass("shrink-0", "whitespace-pre");
      }
    },
  );

  test.each(RIGHT_TO_LEFT_LANGUAGES)(
    "%s: the boxes come in the sentence's order: its words, the name, then the time",
    (language: string) => {
      const line: HTMLElement = drawStartedLine(language, {
        name: ENGLISH_PERSON,
      });
      const boxes: Array<Element> = Array.from(line.children);
      const before: string = wordsBeforeName(language);

      // "بدأها {{name}}", "آغازشده توسط {{name}}": the words come first.
      expect(before.length).toBeGreaterThan(0);
      expect(boxes).toHaveLength(3);
      expect(boxes[0]!.textContent).toBe(before);
      // The space before the name is kept, in its box.
      expect(boxes[0]!.textContent!.endsWith(" ")).toBe(true);
      expect(boxes[1]).toBe(nameBoxOf(line));
      expect(
        boxes[2]!.textContent!.startsWith(getInlineSeparator(language)),
      ).toBe(true);
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

  test.each(RIGHT_TO_LEFT_LANGUAGES)(
    "%s: without a time the row is the sentence alone",
    (language: string) => {
      const line: HTMLElement = drawStartedLine(language, {
        name: ENGLISH_PERSON,
        withoutTime: true,
      });

      expect(line.getAttribute("class")).toBe(
        EVENT_VIDEO_CALL_STARTED_ROW_CLASS_NAME,
      );
      expect(line.textContent).toBe(
        startedBySentence(language, ENGLISH_PERSON),
      );
      expect(line.textContent).not.toContain(getInlineSeparator(language));
      expect(line.children).toHaveLength(2);
      expect(line.lastElementChild).toBe(nameBoxOf(line));
    },
  );

  test.each(RIGHT_TO_LEFT_LANGUAGES)(
    "%s: an Arabic name reads the sentence's way: one line of text, written as it was",
    (language: string) => {
      const line: HTMLElement = drawStartedLine(language, {
        name: ARABIC_PERSON,
      });
      const [who] = factsOf(line, language);

      expect(who).toBe(startedBySentence(language, ARABIC_PERSON));
      expect(who).not.toContain(FIRST_STRONG_ISOLATE);
      expect(who).not.toContain(POP_DIRECTIONAL_ISOLATE);
      expect(line.getAttribute("class")).toBe(
        EVENT_VIDEO_CALL_STARTED_LINE_CLASS_NAME,
      );
      expect(line).not.toHaveAttribute("dir");
      expect(line.children).toHaveLength(0);
      expect(
        within(line).queryByTestId("event-video-call-started-by-name"),
      ).toBeNull();
    },
  );

  test.each(RIGHT_TO_LEFT_LANGUAGES)(
    "%s: a call a workspace rule started says so in one line of text",
    (language: string) => {
      const line: HTMLElement = drawStartedLine(language, {
        name: ENGLISH_PERSON,
        byWorkspaceRule: true,
      });
      const [who] = factsOf(line, language);

      expect(who).toBe(
        locales[language]!["Started automatically by a workspace rule"],
      );
      expect(line.getAttribute("class")).toBe(
        EVENT_VIDEO_CALL_STARTED_LINE_CLASS_NAME,
      );
      expect(line.children).toHaveLength(0);
      expect(line.textContent).not.toContain(ENGLISH_PERSON);
    },
  );

  test.each(RIGHT_TO_LEFT_LANGUAGES)(
    "%s: a call started from the API says so in one line of text",
    (language: string) => {
      const line: HTMLElement = drawStartedLine(language, {});
      const [who] = factsOf(line, language);

      expect(who).toBe(locales[language]!["Started from the API"]);
      expect(line.getAttribute("class")).toBe(
        EVENT_VIDEO_CALL_STARTED_LINE_CLASS_NAME,
      );
      expect(line.children).toHaveLength(0);
    },
  );

  test("Persian sets the time off with a bullet: its zero is a dot", () => {
    const line: HTMLElement = drawStartedLine("fa", { name: ENGLISH_PERSON });

    expect(getInlineSeparator("fa")).toBe(DOT_ZERO_INLINE_SEPARATOR);
    expect(line.textContent).toContain(DOT_ZERO_INLINE_SEPARATOR);
    expect(line.textContent).not.toContain(INLINE_SEPARATOR);
    expect(factsOf(line, "fa")).toHaveLength(2);
  });

  test("Persian sets the time off with a bullet in a line of text too", () => {
    const line: HTMLElement = drawStartedLine("fa", { name: ARABIC_PERSON });

    expect(line.children).toHaveLength(0);
    expect(line.textContent).toContain(DOT_ZERO_INLINE_SEPARATOR);
    expect(line.textContent).not.toContain(INLINE_SEPARATOR);
    expect(factsOf(line, "fa")).toHaveLength(2);
  });

  test("Arabic, written in Latin digits, keeps the middle dot", () => {
    const line: HTMLElement = drawStartedLine("ar", { name: ENGLISH_PERSON });

    expect(getInlineSeparator("ar")).toBe(INLINE_SEPARATOR);
    expect(line.textContent).toContain(INLINE_SEPARATOR);
    expect(factsOf(line, "ar")).toHaveLength(2);
  });

  test("on an English page an English name is written as it always was", () => {
    const line: HTMLElement = drawStartedLine("en", { name: ENGLISH_PERSON });
    const text: string = line.textContent || "";

    expect(text.startsWith(`Started by ${ENGLISH_PERSON} · `)).toBe(true);
    expect(text).toBe(withoutIsolateMarks(text));
    expect(line.children).toHaveLength(0);
    expect(line).not.toHaveAttribute("dir");
    expect(line.getAttribute("class")).toBe(
      "mt-0.5 truncate text-xs text-gray-500",
    );
    expect(EVENT_VIDEO_CALL_STARTED_LINE_CLASS_NAME).toBe(
      "mt-0.5 truncate text-xs text-gray-500",
    );
  });

  test("on an English page an Arabic name is a box of its own, read right to left", () => {
    const line: HTMLElement = drawStartedLine("en", { name: ARABIC_PERSON });
    const name: HTMLElement = nameBoxOf(line);
    const [who] = factsOf(line, "en");

    expect(name.textContent).toBe(ARABIC_PERSON);
    expect(name).toHaveAttribute("dir", "rtl");
    expect(who).toBe(`Started by ${ARABIC_PERSON}`);
    expect(line.getAttribute("class")).toBe(
      EVENT_VIDEO_CALL_STARTED_ROW_CLASS_NAME,
    );
    expect(line.firstElementChild!.textContent).toBe("Started by ");
  });
});

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
import { cleanup, render, screen } from "@testing-library/react";
import fs from "fs";
import { createInstance, i18n } from "i18next";
import path from "path";
import React from "react";
import { I18nextProvider } from "react-i18next";
import { MemoryRouter } from "react-router-dom";
import { PROJECT_ID, goTo } from "./SideMenuHarness";
import { isolated, withoutIsolateMarks } from "../../Helpers/IsolateMarks";
import { drawLine, isDrawnAsWritten } from "../../Helpers/BidiLayout";
import EventVideoCallsCard from "../../../../App/FeatureSet/Dashboard/src/Components/VideoCall/EventVideoCallsCard";
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
 * The name is set apart from the sentence now (setsValuesApart: a Unicode
 * isolate around a value that reads the other way), and the two facts are
 * set off as the reader's language does (formatInline: a bullet in
 * Persian). A name that reads the sentence's way, and an English name in
 * the English sentence, are written exactly as they were. Drawn here with
 * the real Dashboard locales.
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

const callStartedBy: (person: {
  name?: string;
  email?: string;
}) => IncidentVideoCall = (person: {
  name?: string;
  email?: string;
}): IncidentVideoCall => {
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
  call.createdAt = new Date(Date.now() - 3 * 60 * 1000);
  return call;
};

// The line under the call: who started it, and when.
const drawStartedLine: (
  language: string,
  person: { name?: string; email?: string },
) => HTMLElement = (
  language: string,
  person: { name?: string; email?: string },
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

describe("who started a call", () => {
  test.each(RIGHT_TO_LEFT_LANGUAGES)(
    "%s: an English name is set apart from the sentence",
    (language: string) => {
      const sentence: string = locales[language]!["Started by {{name}}"]!;

      // The sentence is the reader's, read right to left.
      expect(sentence).not.toBe("Started by {{name}}");

      const line: HTMLElement = drawStartedLine(language, {
        name: ENGLISH_PERSON,
      });
      const [who, when] = factsOf(line, language);

      expect(who).toBe(startedBySentence(language, isolated(ENGLISH_PERSON)));
      // What it says, without the isolate's marks.
      expect(withoutIsolateMarks(who!)).toBe(
        startedBySentence(language, ENGLISH_PERSON),
      );
      // The time after it is the reader's, and is not part of the name.
      expect(when).toBeTruthy();
      expect(when).not.toContain(ENGLISH_PERSON);
    },
  );

  test.each(RIGHT_TO_LEFT_LANGUAGES)(
    "%s: the name is drawn as it is written in the right-to-left line, where plain text was not",
    (language: string) => {
      const line: HTMLElement = drawStartedLine(language, {
        name: NUMBERED_PERSON,
      });
      const text: string = line.textContent || "";
      const at: number = text.indexOf(NUMBERED_PERSON);

      expect(at).toBeGreaterThan(0);
      expect(
        isDrawnAsWritten(
          drawLine(text, "rtl"),
          at,
          at + NUMBERED_PERSON.length,
        ),
      ).toBe(true);

      // Negative control: the same line with the name as plain text.
      const plain: string = withoutIsolateMarks(text);
      const plainAt: number = plain.indexOf(NUMBERED_PERSON);

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
    "%s: an email address in place of a name is set apart too",
    (language: string) => {
      const line: HTMLElement = drawStartedLine(language, {
        email: ENGLISH_EMAIL,
      });
      const [who] = factsOf(line, language);

      expect(who).toBe(startedBySentence(language, isolated(ENGLISH_EMAIL)));
    },
  );

  test.each(RIGHT_TO_LEFT_LANGUAGES)(
    "%s: an Arabic name reads the sentence's way, written as it was",
    (language: string) => {
      const line: HTMLElement = drawStartedLine(language, {
        name: ARABIC_PERSON,
      });
      const [who] = factsOf(line, language);

      expect(who).toBe(startedBySentence(language, ARABIC_PERSON));
      expect(who).not.toContain(FIRST_STRONG_ISOLATE);
      expect(who).not.toContain(POP_DIRECTIONAL_ISOLATE);
    },
  );

  test.each(RIGHT_TO_LEFT_LANGUAGES)(
    "%s: the line keeps its place: one line of the page's way, cut short at its end",
    (language: string) => {
      const line: HTMLElement = drawStartedLine(language, {
        name: ENGLISH_PERSON,
      });

      expect(line.tagName).toBe("P");
      expect(line).not.toHaveAttribute("dir");
      expect(line.getAttribute("class")).toBe(
        "mt-0.5 truncate text-xs text-gray-500",
      );
      // Text only: the name is set apart in the text, not in a box.
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

  test("Arabic, written in Latin digits, keeps the middle dot", () => {
    const line: HTMLElement = drawStartedLine("ar", { name: ENGLISH_PERSON });

    expect(getInlineSeparator("ar")).toBe(INLINE_SEPARATOR);
    expect(factsOf(line, "ar")).toHaveLength(2);
  });

  test("on an English page an English name is written as it always was", () => {
    const line: HTMLElement = drawStartedLine("en", { name: ENGLISH_PERSON });
    const text: string = line.textContent || "";

    expect(text.startsWith(`Started by ${ENGLISH_PERSON} · `)).toBe(true);
    expect(text).toBe(withoutIsolateMarks(text));
    expect(line.children).toHaveLength(0);
    expect(line).not.toHaveAttribute("dir");
  });

  test("on an English page an Arabic name is set apart from the English sentence", () => {
    const line: HTMLElement = drawStartedLine("en", { name: ARABIC_PERSON });
    const [who] = factsOf(line, "en");

    expect(who).toBe(`Started by ${isolated(ARABIC_PERSON)}`);
  });
});

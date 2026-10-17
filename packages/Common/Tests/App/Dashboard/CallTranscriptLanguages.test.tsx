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
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { createInstance, i18n } from "i18next";
import fs from "fs";
import path from "path";
import React, { ReactElement } from "react";
import { I18nextProvider } from "react-i18next";
import { MemoryRouter } from "react-router-dom";
import { PROJECT_ID, goTo } from "./SideMenuHarness";

/*
 * AN INCIDENT CALL'S TRANSCRIPT IN THE READER'S LANGUAGE, from the real
 * locale files (issue #4875).
 *
 * The Video Call card sits in the page's narrow column, where a German
 * "Transkript" beside two buttons used to be cut to "Tran…", and where
 * "Von Zoom gelesen 5 minutes ago" put English in the middle of a German
 * sentence. Here, in German: the heading on a line of its own, every "when"
 * in German, the provider's answer in a German sentence of the card's own,
 * and the AI Investigation card's lists under their German headings. Then
 * every language the Dashboard ships: each words every sentence the call
 * transcript UI review added, and never words Review it as View transcript,
 * the button under it.
 */

jest.mock("../../../UI/Components/Markdown.tsx/LazyMarkdownViewer", () => {
  return {
    __esModule: true,
    default: (props: { text: string }): ReactElement => {
      return <div data-testid="markdown-viewer">{props.text}</div>;
    },
  };
});

import englishLocale from "../../../../App/FeatureSet/Dashboard/src/Locales/en.json";
import germanLocale from "../../../../App/FeatureSet/Dashboard/src/Locales/de.json";
import CallSummarySection from "../../../../App/FeatureSet/Dashboard/src/Components/AI/CallSummary/CallSummarySection";
import { getTranscriptUnavailableHeadline } from "../../../../App/FeatureSet/Dashboard/src/Components/VideoCall/CallTranscriptBlock";
import { formatCallTranscriptTime } from "../../../../App/FeatureSet/Dashboard/src/Components/VideoCall/CallTranscriptState";
import EventVideoCallsCard from "../../../../App/FeatureSet/Dashboard/src/Components/VideoCall/EventVideoCallsCard";
import { VideoCallEventKind } from "../../../../App/FeatureSet/Dashboard/src/Components/VideoCall/useEventVideoCalls";
import IncidentVideoCall from "../../../Models/DatabaseModels/IncidentVideoCall";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import ListResult from "../../../Types/BaseDatabase/ListResult";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import { RootCauseSuggestionStatus } from "../../../Types/VideoCall/CallSummary";
import { VideoCallTranscriptUnavailableReason } from "../../../Types/VideoCall/VideoCallTranscript";
import API from "../../../UI/Utils/API/API";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import PermissionGate, {
  PermissionGateResult,
} from "../../../UI/Utils/PermissionGate";
import {
  INCIDENT_ID,
  suggestedCall,
  transcriptCall,
} from "./CallTranscriptFixtures";

const EN: Record<string, string> = englishLocale as unknown as Record<
  string,
  string
>;
const DE: Record<string, string> = germanLocale as unknown as Record<
  string,
  string
>;

const LOCALES_DIRECTORY: string = path.join(
  __dirname,
  "../../../../App/FeatureSet/Dashboard/src/Locales",
);

// Every language the Dashboard is translated into, besides English.
const LANGUAGES: Array<string> = [
  "de",
  "fr",
  "es",
  "it",
  "pt",
  "nl",
  "da",
  "no",
  "sv",
  "ru",
  "ja",
  "ko",
  "zh-CN",
  "zh-TW",
  "hi",
  "fa",
];

// The sentences the UI review added: each language words every one.
const REVIEW_KEYS: Array<string> = [
  "Hypotheses",
  "OneUptime AI suggested a root cause.",
  "Review it",
  ...Object.values(VideoCallTranscriptUnavailableReason).map(
    (reason: VideoCallTranscriptUnavailableReason): string => {
      return getTranscriptUnavailableHeadline(reason);
    },
  ),
];

function fill(template: string, values: Record<string, string>): string {
  let text: string = template;

  for (const [name, value] of Object.entries(values)) {
    text = text.split(`{{${name}}}`).join(value);
  }

  return text;
}

function instanceFor(language: string, locale: Record<string, string>): i18n {
  const instance: i18n = createInstance();

  instance.init({
    lng: language,
    fallbackLng: "en",
    resources: {
      en: { translation: englishLocale },
      [language]: { translation: locale },
    },
    interpolation: { escapeValue: false },
    keySeparator: false,
    nsSeparator: false,
    initImmediate: false,
  });

  return instance;
}

let german: i18n;
let postAnswer: () => HTTPResponse<JSONObject>;

beforeAll(() => {
  german = instanceFor("de", DE);
});

beforeEach(() => {
  goTo(`/dashboard/${PROJECT_ID}/incidents/${INCIDENT_ID}`);

  jest
    .spyOn(PermissionGate, "check")
    .mockImplementation((): PermissionGateResult => {
      return { isAllowed: true };
    });
  jest
    .spyOn(PermissionGate, "checkColumnUpdate")
    .mockImplementation((): PermissionGateResult => {
      return { isAllowed: true };
    });
  jest
    .spyOn(ModelAPI, "getList")
    .mockImplementation(async (): Promise<ListResult<never>> => {
      return { data: [], count: 0, skip: 0, limit: 100 };
    });
  jest.spyOn(ModelAPI, "getCommonHeaders").mockReturnValue({
    tenantid: PROJECT_ID,
  } as never);

  postAnswer = (): HTTPResponse<JSONObject> => {
    return new HTTPResponse<JSONObject>(200, {}, {});
  };

  jest.spyOn(API, "post").mockImplementation((async () => {
    return postAnswer();
  }) as never);
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

function renderCard(calls: Array<IncidentVideoCall>): void {
  render(
    <I18nextProvider i18n={german}>
      <MemoryRouter>
        <EventVideoCallsCard
          kind={VideoCallEventKind.Incident}
          eventId={new ObjectID(INCIDENT_ID)}
          calls={calls}
          hasLoaded={true}
          onChanged={() => {}}
          onRetry={() => {}}
          onReviewCallSummary={() => {}}
        />
      </MemoryRouter>
    </I18nextProvider>,
  );
}

describe("in German", () => {
  test("the Video Call card: Transkript on a line of its own, and every when in German", () => {
    renderCard([suggestedCall({ addedMinutesAgo: 5, createdMinutesAgo: 40 })]);

    const heading: HTMLElement = screen.getByTestId("call-transcript-heading");

    expect(heading).toHaveTextContent(/^Transkript$/);
    expect(
      heading.parentElement!.querySelector(
        "[data-testid='call-transcript-view']",
      ),
    ).toBeNull();

    // "Von Zoom gelesen vor 5 Minuten", never "... 5 minutes ago".
    const facts: HTMLElement = screen.getByTestId("call-transcript-facts");

    expect(facts).toHaveTextContent(
      fill(DE["Read from {{provider}} {{when}}"]!, {
        provider: "Zoom",
        when: "vor 5 Minuten",
      }),
    );
    expect(facts).not.toHaveTextContent(/ago/);

    // The call's own line, above it, says when it started in German too.
    expect(screen.getByTestId("event-video-call")).toHaveTextContent(
      "vor 40 Minuten",
    );
    expect(screen.getByTestId("event-video-call")).not.toHaveTextContent(
      /minutes ago/,
    );

    // The reading's sentence and its action, then View transcript under them.
    expect(screen.getByTestId("call-transcript-read")).toHaveTextContent(
      `${DE["OneUptime AI suggested a root cause."]} ${DE["Review it"]}`,
    );
    expect(screen.getByTestId("call-transcript-view")).toHaveTextContent(
      DE["View transcript"]!,
    );
  });

  test("what Zoom answers is said in a German sentence of the card's own, Zoom's own words behind Details anzeigen", async () => {
    postAnswer = (): HTTPResponse<JSONObject> => {
      return new HTTPResponse<JSONObject>(
        200,
        {
          added: false,
          reason: VideoCallTranscriptUnavailableReason.PermissionMissing,
          message:
            "This connection's Zoom app cannot read transcripts. Add cloud_recording:read:list_recording_files:admin.",
        },
        {},
      );
    };

    renderCard([transcriptCall()]);

    fireEvent.click(screen.getByTestId("call-transcript-get"));

    const outcome: HTMLElement = await screen.findByTestId(
      "call-transcript-outcome",
    );

    expect(
      within(outcome).getByTestId("call-transcript-outcome-headline"),
    ).toHaveTextContent(
      fill(
        DE[
          getTranscriptUnavailableHeadline(
            VideoCallTranscriptUnavailableReason.PermissionMissing,
          )
        ]!,
        { provider: "Zoom" },
      ),
    );
    expect(
      within(outcome).getByTestId("call-transcript-set-up-docs"),
    ).toHaveTextContent(DE["How to set it up"]!);
    expect(
      within(outcome).getByTestId("call-transcript-outcome-details-toggle"),
    ).toHaveTextContent(DE["Show details"]!);
  });

  test("the AI Investigation card: who dismissed the suggestion and when, and the call's lists, under German headings", async () => {
    render(
      <I18nextProvider i18n={german}>
        <MemoryRouter>
          <CallSummarySection
            incidentId={new ObjectID(INCIDENT_ID)}
            calls={[
              suggestedCall({
                suggestion: RootCauseSuggestionStatus.Dismissed,
                reviewedBy: "Jordan Patel",
                reviewedMinutesAgo: 2,
              }),
            ]}
            onChanged={() => {}}
          />
        </MemoryRouter>
      </I18nextProvider>,
    );

    expect(screen.getByTestId("call-summary")).toHaveTextContent(
      fill(DE["{{name}} dismissed it {{when}}."]!, {
        name: "Jordan Patel",
        when: "vor 2 Minuten",
      }),
    );

    const details: HTMLElement = screen.getByTestId("call-summary-details");

    await act(async () => {
      fireEvent.click(details.querySelector("summary")!);
    });

    expect(
      within(screen.getByTestId("call-summary-confirmed")).getByRole(
        "heading",
        { level: 5 },
      ),
    ).toHaveTextContent(DE["Confirmed on the call"]!);
    expect(
      within(screen.getByTestId("call-summary-hypotheses")).getByRole(
        "heading",
        { level: 5 },
      ),
    ).toHaveTextContent("Hypothesen");
  });
});

describe("in every language the Dashboard ships", () => {
  test.each(LANGUAGES)(
    "%s words every sentence of the review, and tells Review it from View transcript",
    (language: string) => {
      const locale: Record<string, string> = JSON.parse(
        fs.readFileSync(
          path.join(LOCALES_DIRECTORY, `${language}.json`),
          "utf8",
        ),
      ) as Record<string, string>;

      for (const key of REVIEW_KEYS) {
        // In en.json, mapped to itself.
        expect({ key, english: EN[key] }).toEqual({ key, english: key });

        const value: string | undefined = locale[key];

        expect({ key, worded: Boolean(value) && value !== key }).toEqual({
          key,
          worded: true,
        });
        expect({ key, provider: value!.includes("{{provider}}") }).toEqual({
          key,
          provider: key.includes("{{provider}}"),
        });
      }

      expect(locale["Review it"]).not.toBe(locale["View transcript"]);
    },
  );
});

describe("when, in the reader's words", () => {
  const NOW: Date = new Date("2026-09-14T18:20:00.000Z");

  function ago(seconds: number): Date {
    return new Date(NOW.getTime() - seconds * 1000);
  }

  test.each<[string, number, string]>([
    ["en", 5 * 60, "5 minutes ago"],
    ["de", 5 * 60, "vor 5 Minuten"],
    ["ja", 5 * 60, "5 分前"],
    // Never "now": the sentence it fills needs a distance.
    ["en", 10, "1 minute ago"],
    ["de", 10, "vor 1 Minute"],
    ["en", 3 * 3600, "3 hours ago"],
  ])(
    "%s, %i seconds ago: %s",
    (language: string, seconds: number, expected: string) => {
      expect(
        formatCallTranscriptTime({
          date: ago(seconds),
          language,
          now: NOW,
        }),
      ).toBe(expected);
    },
  );
});

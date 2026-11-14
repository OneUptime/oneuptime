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
import { act, cleanup, render, screen } from "@testing-library/react";
import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import fs from "fs";
import path from "path";
/*
 * The Dashboard has its own copy of react; Common's jest moduleNameMapper
 * pins react and react-dom to this project's single copy for every
 * importer (see the note at the top of ReplayStage.test.tsx).
 */
import * as React from "react";
import { MemoryRouter } from "react-router-dom";
import ReplayHeader, {
  ReplayHeaderProps,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SessionReplay/ReplayHeader";
import ReplayCorrelationPanel, {
  ReplaySessionDetails,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SessionReplay/ReplayCorrelationPanel";
import SessionReplayFilterModal from "../../../../App/FeatureSet/Dashboard/src/Components/SessionReplay/SessionReplayFilterModal";
import { EMPTY_ADVANCED_FILTERS } from "../../../../App/FeatureSet/Dashboard/src/Components/SessionReplay/SessionReplayListFilters";
import SessionReplayMaskingMode from "../../../Types/Rum/SessionReplayMaskingMode";
import Permission, { PermissionHelper } from "../../../Types/Permission";
import { withoutIsolateMarks } from "../../Helpers/IsolateMarks";

/*
 * WHERE SESSION REPLAY SAYS WHO A SESSION'S END USER IS HIDDEN, IT NAMES
 * THE GRANT THAT SHOWS THEM (#7096), drawn from the Dashboard's shipped
 * locale files.
 *
 * Three lines said "the identity permission": the session details panel's
 * End user row, the header's tooltip on "Identity hidden", and the User
 * filter's hint in the filter dialog. No roles screen lists a permission by
 * that name (German said "Identitätsberechtigung", Arabic "إذن الهوية"),
 * so neither the reader nor the project admin they asked could tell which
 * grant shows the identity. Each now names "Watch Session Replays", the
 * title the roles screen gives the permission the server serves the
 * identity behind, in the language's quotes.
 */

const LOCALES_DIR: string = path.resolve(
  __dirname,
  "../../../../App/FeatureSet/Dashboard/src/Locales",
);

const LANGUAGES: ReadonlyArray<string> = ["en", "de", "ar", "fa"];

const WATCH: string = PermissionHelper.getTitle(
  Permission.ReadRumSessionReplayPayload,
);

// The three lines in English, and the English they replaced.
const ROW_SENTENCE: string =
  'Hidden - your role needs the "{{permission}}" permission';
const TOOLTIP_SENTENCE: string =
  'Your role cannot read end-user identity. Ask a project admin for the "{{permission}}" permission.';
const HINT_SENTENCE: string =
  'The exact reference your page passed to identify(). Needs the "{{permission}}" permission; never written to the URL.';

const RETIRED_ENGLISH: ReadonlyArray<string> = [
  "Not shown - viewing identity needs the identity permission",
  "The end user's identity needs the identity permission to view.",
  "Needs the end-user identity permission",
];

const LOCALES: Record<string, Record<string, string>> = {};

for (const language of LANGUAGES) {
  LOCALES[language] = JSON.parse(
    fs.readFileSync(path.join(LOCALES_DIR, `${language}.json`), "utf8"),
  ) as Record<string, string>;
}

// What `language` says for `sentence`, its grant filled in.
function worded(language: string, sentence: string): string {
  const text: string | undefined = LOCALES[language]?.[sentence];

  expect({ language, sentence, worded: Boolean(text) }).toEqual({
    language,
    sentence,
    worded: true,
  });

  return (text as string).split("{{permission}}").join(WATCH);
}

async function readIn(language: string): Promise<void> {
  await act(async () => {
    await i18next.changeLanguage(language);
  });
}

beforeAll(async () => {
  await i18next.use(initReactI18next).init({
    lng: "en",
    fallbackLng: "en",
    resources: Object.fromEntries(
      LANGUAGES.map((language: string) => {
        return [
          language,
          { translation: LOCALES[language] as Record<string, string> },
        ];
      }),
    ),
    interpolation: { escapeValue: false },
  });
});

beforeEach(async () => {
  await readIn("en");
});

afterEach(() => {
  cleanup();
});

function headerProps(): ReplayHeaderProps {
  return {
    sessionId: "a1b2c3d4e5f60718293a4b5c6d7e8f90",
    backHref: "/dashboard/p/rum/a/session-replay",
    onBack: jest.fn(),
    // The manifest left the identity out: this role may not see it.
    identity: { label: null },
    facts: [{ label: "Browser", value: "Chrome 126" }],
    startTimeUnixMs: new Date(2026, 8, 4, 10, 12, 41).getTime(),
    currentTimeMs: 41200,
    durationMs: 252000,
    isLive: false,
    tabs: [],
    onSwitchTab: jest.fn(),
    isWide: true,
    onToggleWide: jest.fn(),
    isTheater: false,
    onToggleTheater: jest.fn(),
    onOpenDetails: jest.fn(),
    buildMomentUrl: (): string => {
      return "https://dash.example/session-replay/a1b2?t=41";
    },
  };
}

function hiddenIdentityDetails(): ReplaySessionDetails {
  return {
    entryUrl: "https://app.acme.com/checkout",
    exitUrl: "https://app.acme.com/checkout/done",
    browserName: "Chrome",
    browserVersion: "126",
    osName: "macOS",
    deviceType: "desktop",
    countryCode: "DE",
    // Left out of the manifest: this role may not see it.
    identifiedUserLabel: null,
    identifiedUserKey: "5f4dcc3b5aa765d61d8327deb882cf99",
    visitorId: "",
    maskingMode: SessionReplayMaskingMode.MaskAllText,
    consentState: "NotRequired",
    triggerReason: "error",
    recorderKind: "dom",
    recorderVersion: "1.4.0",
    rrwebVersion: "2.0.0",
    viewportWidth: 1440,
    viewportHeight: 900,
    clockSkewMs: 0,
    payloadBytes: 2048,
    startTime: "2026-08-14T10:00:00.000Z",
    endTime: "2026-08-14T10:12:30.000Z",
    traceIds: [],
    exceptionFingerprints: [],
  };
}

// The three lines as `language`'s reader sees them.
function drawnLines(): { row: string; tooltip: string; hint: string } {
  render(<ReplayHeader {...headerProps()} />);

  const tooltip: string =
    screen.getByTestId("replay-header-user").getAttribute("title") || "";

  cleanup();

  render(
    <MemoryRouter>
      <ReplayCorrelationPanel
        isOpen={true}
        onClose={(): void => {}}
        activeTabId="session"
        onTabChange={(): void => {}}
        sessionId="a1b2c3d4e5f60718293a4b5c6d7e8f90"
        details={hiddenIdentityDetails()}
        fidelityNotices={[]}
        missingAssets={[]}
        gaps={[]}
      />
    </MemoryRouter>,
  );

  const row: string =
    screen.getByTestId("replay-details-end-user").textContent || "";

  cleanup();

  render(
    <SessionReplayFilterModal
      filters={EMPTY_ADVANCED_FILTERS}
      onApply={(): void => {}}
      onClose={(): void => {}}
    />,
  );

  const hint: string =
    screen
      .getByTestId("session-filter-row-identifiedUserRef")
      .querySelector("p")?.textContent || "";

  return {
    row: withoutIsolateMarks(row),
    tooltip: withoutIsolateMarks(tooltip),
    hint: withoutIsolateMarks(hint),
  };
}

describe("the lines that say the identity is hidden name Watch Session Replays", () => {
  test("the grant is the roles screen's Watch Session Replays", () => {
    expect(WATCH).toBe("Watch Session Replays");
  });

  test("English", () => {
    const lines: { row: string; tooltip: string; hint: string } = drawnLines();

    expect(lines.row).toContain(
      'Hidden - your role needs the "Watch Session Replays" permission',
    );
    expect(lines.tooltip).toBe(
      'Your role cannot read end-user identity. Ask a project admin for the "Watch Session Replays" permission.',
    );
    expect(lines.hint).toBe(
      'The exact reference your page passed to identify(). Needs the "Watch Session Replays" permission; never written to the URL.',
    );

    for (const text of Object.values(lines)) {
      expect(text).not.toContain("identity permission");
    }
  });

  test.each([
    ["German", "de", "„Watch Session Replays“"],
    ["Arabic", "ar", "«Watch Session Replays»"],
    ["Persian", "fa", "«Watch Session Replays»"],
  ])(
    "%s: each line in the language's words, the grant in its quotes",
    async (_name: string, language: string, quoted: string) => {
      await readIn(language);

      const lines: { row: string; tooltip: string; hint: string } =
        drawnLines();

      expect(lines.row).toContain(worded(language, ROW_SENTENCE));
      expect(lines.tooltip).toBe(worded(language, TOOLTIP_SENTENCE));
      expect(lines.hint).toBe(worded(language, HINT_SENTENCE));

      for (const text of Object.values(lines)) {
        expect(text).toContain(quoted);
        expect(text).not.toContain("{{permission}}");

        // None of the English it replaced, nor the English it now is.
        for (const english of [
          ...RETIRED_ENGLISH,
          ROW_SENTENCE.split("{{permission}}").join(WATCH),
          TOOLTIP_SENTENCE.split("{{permission}}").join(WATCH),
          HINT_SENTENCE.split("{{permission}}").join(WATCH),
        ]) {
          expect(text).not.toContain(english);
        }
      }
    },
  );

  test("German no longer says Identitätsberechtigung, Arabic no longer إذن الهوية", async () => {
    for (const [language, retired] of [
      ["de", "Identitätsberechtigung"],
      ["ar", "إذن الهوية"],
      ["fa", "دسترسی هویت"],
    ] as Array<[string, string]>) {
      await readIn(language);

      for (const text of Object.values(drawnLines())) {
        expect({ language, text, retired: text.includes(retired) }).toEqual({
          language,
          text,
          retired: false,
        });
      }

      cleanup();
    }
  });
});

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
  waitFor,
} from "@testing-library/react";
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
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import Permission, { PermissionHelper } from "../../../Types/Permission";
import TimeRange from "../../../Types/Time/TimeRange";
import getJestMockFunction, { MockFunction } from "../../MockType";
import { withoutIsolateMarks } from "../../Helpers/IsolateMarks";

/*
 * A HIDDEN USER'S HOVER ON THE SESSION LIST AND THE USERS PAGE NAMES THE
 * GRANT THAT SHOWS THEM (#7320), drawn from the Dashboard's shipped locales.
 *
 * Session Replay hides who a session's end user is from a role that may
 * not read it. The player's header already said why and what to do: "Your
 * role cannot read end-user identity. Ask a Project Admin for the "Watch
 * Session Replays" permission." (#7096). The list - where most people meet
 * a hidden user first - stopped at the reason ("..., so the label is not
 * sent to you."), and its screen-reader name ("User hidden: your role
 * cannot read end-user identity") said no more: the one place that left
 * them with no next step. Both tables' hovers are the header's request
 * now, in the reader's language, the grant named as the roles screen
 * names it.
 */

const postMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/API/API", () => {
  return {
    __esModule: true,
    default: {
      post: (...args: Array<unknown>) => {
        return postMock(...args);
      },
      getFriendlyMessage: (error: unknown): string => {
        return error instanceof HTTPErrorResponse
          ? error.message
          : String(error);
      },
    },
  };
});

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getCommonHeaders: (): Record<string, string> => {
        return {};
      },
    },
  };
});

import SessionReplayTable from "../../../../App/FeatureSet/Dashboard/src/Components/SessionReplay/SessionReplayTable";
import SessionReplayUsersTable from "../../../../App/FeatureSet/Dashboard/src/Components/SessionReplay/SessionReplayUsersTable";
import { HIDDEN_IDENTITY_TITLE } from "../../../../App/FeatureSet/Dashboard/src/Components/SessionReplay/SessionReplayUserIdentity";
import { clearSessionReplayHealthStore } from "../../../../App/FeatureSet/Dashboard/src/Components/SessionReplay/useSessionReplayHealth";

const LOCALES_DIR: string = path.resolve(
  __dirname,
  "../../../../App/FeatureSet/Dashboard/src/Locales",
);

const LANGUAGES: ReadonlyArray<string> = ["en", "de", "ar", "fa"];

const WATCH: string = PermissionHelper.getTitle(
  Permission.ReadRumSessionReplayPayload,
);

// The header's tooltip on "Identity hidden", which the lists now share.
const REQUEST: string =
  'Your role cannot read end-user identity. Ask a Project Admin for the "{{permission}}" permission.';

// What the lists said before, which named no grant and no next step.
const RETIRED: ReadonlyArray<string> = [
  "Your role cannot read end-user identity, so the label is not sent to you.",
  "User hidden: your role cannot read end-user identity",
];

const LOCALES: Record<string, Record<string, string>> = {};

for (const language of LANGUAGES) {
  LOCALES[language] = JSON.parse(
    fs.readFileSync(path.join(LOCALES_DIR, `${language}.json`), "utf8"),
  ) as Record<string, string>;
}

// The request as `language` words it, the grant filled in.
function wordedRequest(language: string): string {
  const text: string | undefined = LOCALES[language]?.[REQUEST];

  expect({ language, worded: Boolean(text) }).toEqual({
    language,
    worded: true,
  });

  return (text as string).split("{{permission}}").join(WATCH);
}

async function readIn(language: string): Promise<void> {
  await act(async () => {
    await i18next.changeLanguage(language);
  });
}

const APP_ID: string = "0193c0de-1111-4aaa-8bbb-000000000001";
const SESSION_A: string = "a1b2c3d4e5f60718293a4b5c6d7e8f90";
const USER_KEY: string =
  "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08";
const NOW: number = Date.now();

/* A session row whose identity column the server withheld from this role. */
function hiddenSessionRow(overrides?: JSONObject): JSONObject {
  const row: JSONObject = {
    sessionId: SESSION_A,
    rumApplicationId: APP_ID,
    startTime: new Date(NOW - 3 * 60_000).toISOString(),
    endTime: new Date(NOW - 60_000).toISOString(),
    startTimeUnixMs: NOW - 3 * 60_000,
    durationMs: 2 * 60_000,
    isFinalized: 1,
    sealedReason: "",
    chunkCount: 2,
    maxChunkIndex: 1,
    missingChunkCount: 0,
    eventCount: 400,
    payloadBytes: 10_000,
    hasError: 0,
    errorCount: 0,
    rageClickCount: 0,
    deadClickCount: 0,
    errorClickCount: 0,
    refreshRageCount: 0,
    pageCount: 1,
    triggerReason: "sampled",
    samplePercentageAtCapture: 100,
    entryUrl: "https://app.acme.com/checkout",
    exitUrl: "https://app.acme.com/checkout",
    routes: ["https://app.acme.com/checkout"],
    browserName: "Chrome",
    browserVersion: "126",
    osName: "macOS",
    deviceType: "desktop",
    countryCode: "DE",
    viewportWidth: 1440,
    viewportHeight: 900,
    identifiedUserKey: USER_KEY,
    maskingMode: "MaskSensitiveInputsOnly",
    fidelityNotices: [],
    ...overrides,
  };

  // Left out of the answer: this role may not read who the session belongs to.
  delete row["identifiedUserLabel"];

  return row;
}

function hiddenRollup(): JSONObject {
  return {
    groupKey: `u:${USER_KEY}`,
    kind: "identified",
    identifiedUserKey: USER_KEY,
    visitorId: "",
    sessionCount: 3,
    liveSessionCount: 0,
    firstSeenUnixMs: NOW - 5 * 60 * 60_000,
    lastSeenUnixMs: NOW - 2 * 60 * 60_000,
    totalDurationMs: 45 * 60_000,
    errorCount: 0,
    frustrationCount: 0,
    errorSessionCount: 0,
    pageCount: 2,
    lastSessionId: SESSION_A,
    lastEntryUrl: "https://app.acme.com/checkout",
    browserName: "Chrome",
    browserVersion: "126",
    osName: "macOS",
    deviceType: "desktop",
    countryCode: "DE",
  };
}

function answerWith(body: (url: string) => JSONObject): void {
  postMock.mockImplementation((request: unknown): Promise<unknown> => {
    const url: string = (request as { url: { toString: () => string } }).url
      .toString()
      .toString();

    return Promise.resolve(new HTTPResponse<JSONObject>(200, body(url), {}));
  });
}

async function renderSessionList(row: JSONObject): Promise<void> {
  answerWith((url: string): JSONObject => {
    return url.includes("/session-replay/list")
      ? { sessions: [row], nextCursor: null }
      : {};
  });

  render(
    <MemoryRouter>
      <SessionReplayTable rumApplicationId={new ObjectID(APP_ID)} />
    </MemoryRouter>,
  );

  await waitFor(() => {
    expect(screen.getAllByTestId("session-row").length).toBe(1);
  });
}

async function renderUsersTable(): Promise<void> {
  answerWith((): JSONObject => {
    return { users: [hiddenRollup()], nextCursor: null };
  });

  render(
    <MemoryRouter>
      <SessionReplayUsersTable
        rumApplicationId={APP_ID}
        timeRange={{ range: TimeRange.PAST_ONE_DAY }}
        reloadToken={0}
        onViewUserSessions={(): void => {}}
      />
    </MemoryRouter>,
  );

  await waitFor(() => {
    expect(screen.getAllByTestId("session-user-row").length).toBe(1);
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
  postMock.mockReset();
  clearSessionReplayHealthStore();
  window.sessionStorage.clear();
  window.history.replaceState(null, "", "/");
  await readIn("en");
});

afterEach(() => {
  cleanup();
});

describe("the hidden user's hover is the header's request", () => {
  test("the lists' key is the header's, word for word", () => {
    expect(HIDDEN_IDENTITY_TITLE).toBe(REQUEST);
    expect(WATCH).toBe("Watch Session Replays");
  });

  test("the retired lines are gone from every locale they were in", () => {
    for (const language of LANGUAGES) {
      for (const sentence of RETIRED) {
        expect({
          language,
          sentence,
          kept: sentence in (LOCALES[language] as Record<string, string>),
        }).toEqual({ language, sentence, kept: false });
      }
    }
  });

  test.each(LANGUAGES.map((language: string) => {
    return [language];
  }))(
    "%s: every language words the request, naming the grant by its placeholder",
    (language: string) => {
      const worded: string = LOCALES[language]?.[REQUEST] || "";

      expect(worded.split("{{permission}}").length).toBe(2);

      if (language !== "en") {
        expect(worded).not.toBe(REQUEST);
      }
    },
  );
});

describe("the session list", () => {
  test.each(LANGUAGES.map((language: string) => {
    return [language];
  }))(
    "%s: hovering a hidden user names Watch Session Replays and what to do",
    async (language: string) => {
      await readIn(language);
      await renderSessionList(hiddenSessionRow());

      // With a digest, the user is a button that narrows the list to them.
      const button: HTMLElement = screen.getByTestId(
        "session-row-user-filter",
      );
      const hover: string = withoutIsolateMarks(
        button.getAttribute("title") || "",
      );

      expect(hover).toBe(wordedRequest(language));
      expect(hover).toContain(WATCH);

      for (const sentence of RETIRED) {
        expect(hover).not.toContain(sentence);
      }

      expect(screen.getByTestId("session-row-user")).toHaveAttribute(
        "data-user-kind",
        "hidden",
      );
    },
  );

  test.each([["de"], ["fa"]])(
    "%s: a hidden user with nothing to filter by is read out with the same request",
    async (language: string) => {
      await readIn(language);
      await renderSessionList(hiddenSessionRow({ identifiedUserKey: "" }));

      expect(screen.queryByTestId("session-row-user-filter")).toBeNull();

      const cell: HTMLElement = screen.getByTestId("session-row-user")
        .parentElement as HTMLElement;
      const name: string = withoutIsolateMarks(
        cell.getAttribute("aria-label") || "",
      );

      expect(name).toContain(wordedRequest(language));
      expect(name).toContain(WATCH);
      expect(name).toContain(
        (LOCALES[language] as Record<string, string>)["Hidden"] as string,
      );

      // Hovered, the tooltip says the same.
      fireEvent.mouseEnter(cell);

      await waitFor(() => {
        expect(
          withoutIsolateMarks(document.body.textContent || ""),
        ).toContain(wordedRequest(language));
      });
    },
  );

  test("English: read out as the cell's word and the request", async () => {
    await renderSessionList(hiddenSessionRow({ identifiedUserKey: "" }));

    const cell: HTMLElement = screen.getByTestId("session-row-user")
      .parentElement as HTMLElement;

    expect(withoutIsolateMarks(cell.getAttribute("aria-label") || "")).toBe(
      'Hidden: Your role cannot read end-user identity. Ask a Project Admin for the "Watch Session Replays" permission.',
    );
  });
});

describe("the Users page", () => {
  test.each(LANGUAGES.map((language: string) => {
    return [language];
  }))(
    "%s: hovering a hidden user names Watch Session Replays and what to do",
    async (language: string) => {
      await readIn(language);
      await renderUsersTable();

      const name: HTMLElement = screen.getByTestId("session-user-name");

      expect(name).toHaveAttribute("data-user-kind", "hidden");

      const hover: string = withoutIsolateMarks(
        name.getAttribute("title") || "",
      );

      expect(hover).toBe(wordedRequest(language));
      expect(hover).toContain(WATCH);
    },
  );
});

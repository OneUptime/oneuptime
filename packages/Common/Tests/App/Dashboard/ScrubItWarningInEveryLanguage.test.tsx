// UX rule: Docs/ux/README.md#in-every-language
import "@testing-library/jest-dom";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { cleanup, render, screen, within } from "@testing-library/react";
import i18next from "i18next";
import React from "react";
import { initReactI18next } from "react-i18next";
import { MemoryRouter } from "react-router-dom";
import DataSecurityApi from "../../../../App/FeatureSet/Dashboard/src/Components/DataSecurity/DataSecurityApi";
import ScrubItModal, {
  SCRUB_IT_SCOPE_SENTENCES,
} from "../../../../App/FeatureSet/Dashboard/src/Components/DataSecurity/ScrubItModal";
import {
  FIELD_READER_CONSEQUENCES,
  FIELD_READERS_HEADING,
  SECURITY_EVENTS_LOSSES,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Telemetry/FieldReaders/TelemetryFieldReadersList";
import { DataSecurityScrubImpact } from "../../../Types/DataSecurity/DataSecurityApiTypes";
import ObjectID from "../../../Types/ObjectID";
import {
  getEmptyTelemetryFieldReadersByKind,
  SecurityEventsFieldNeed,
  SecurityEventsTelemetrySource,
  TelemetryFieldPart,
  TelemetryFieldReaderKind,
  TelemetryFieldReaders,
  TelemetryFieldUse,
} from "../../../Types/Telemetry/TelemetryFieldReaders";
import {
  DASHBOARD_LANGUAGES,
  readDashboardLocale,
  readDashboardLocaleAsDrawn,
} from "../../Helpers/DashboardLocales";
import { withoutIsolateMarks } from "../../Helpers/IsolateMarks";
import { PROJECT_ID, goTo } from "./SideMenuHarness";

/*
 * SCRUB IT'S WARNING, IN EVERY LANGUAGE (#10433).
 *
 * Scrub It's dialog says whose records its rule changes - the logs of the
 * service the finding was in, the others as they are - and what reads the
 * values it would hide: a monitor that would stop matching, and the address
 * Security Events could no longer block. A reader in Hindi or Arabic is
 * warned as a reader in English is: each sentence is drawn in the reader's
 * language, through the real i18next and the Dashboard's own locale files,
 * with the service's name in it as it was sent.
 */

const LANGUAGES: ReadonlyArray<string> = ["en", ...DASHBOARD_LANGUAGES];

const FINDING_ID: string = "5a5a5a5a-0000-4000-8000-0000000000a1";

function impact(): DataSecurityScrubImpact {
  const readers: TelemetryFieldReaders = {
    kinds: getEmptyTelemetryFieldReadersByKind(true),
    securityEvents: {
      isChecked: true,
      sources: [SecurityEventsTelemetrySource.Logs],
      loses: [SecurityEventsFieldNeed.ClientAddresses],
    },
  };

  readers.kinds[TelemetryFieldReaderKind.Monitor].readers = [
    {
      id: "7c7c7c7c-0000-4000-8000-0000000000c3",
      name: "Blocked sign-ins",
      reads: [
        {
          part: TelemetryFieldPart.Attributes,
          key: "client.address",
          use: TelemetryFieldUse.Filter,
        },
      ],
    },
  ];

  return {
    isAvailable: true,
    rule: {
      signal: "log",
      name: "Data Security: IP address in log attributes of checkout",
      scrubAction: "redact",
      patternType: "ipAddress",
      fieldsToScrub: "attributes",
      dataTypeName: "IP address",
      serviceId: "6b6b6b6b-0000-4000-8000-0000000000b2",
      serviceName: "checkout",
    },
    readers,
  };
}

// The sentences the dialog draws, in English: each also its key.
interface EnglishWords {
  scope: string;
  heading: string;
  monitors: string;
  securityEvents: string;
  title: string;
  button: string;
}

// As the reader reads it: no isolate marks, any space a space.
function plain(text: string): string {
  return withoutIsolateMarks(text)
    .replace(/[\u00a0\u202f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function wordsOf(language: string, english: string): string {
  return readDashboardLocale(language)[english] || english;
}

beforeAll(async () => {
  const resources: Record<string, { translation: Record<string, string> }> = {};

  for (const language of LANGUAGES) {
    resources[language] = {
      translation: readDashboardLocaleAsDrawn(language),
    };
  }

  await i18next.use(initReactI18next).init({
    lng: "en",
    fallbackLng: "en",
    resources: resources,
    interpolation: { escapeValue: false },
    keySeparator: false,
    nsSeparator: false,
  });
});

beforeEach(() => {
  goTo(`/dashboard/${PROJECT_ID}/data-security/issues/x`);
  jest.spyOn(DataSecurityApi, "getScrubImpact").mockResolvedValue(impact());
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
  document.documentElement.removeAttribute("dir");
});

afterAll(async () => {
  await i18next.changeLanguage("en");
});

describe("Scrub It's warning, in the reader's language", () => {
  test("eighteen languages: English and the seventeen the Dashboard offers", () => {
    expect(LANGUAGES).toHaveLength(18);
  });

  test.each(LANGUAGES)("%s", async (language: string) => {
    await i18next.changeLanguage(language);

    if (language === "ar" || language === "fa") {
      document.documentElement.setAttribute("dir", "rtl");
    }

    render(
      <MemoryRouter>
        <ScrubItModal
          findingId={new ObjectID(FINDING_ID)}
          onClose={() => {}}
          onScrubbed={() => {}}
        />
      </MemoryRouter>,
    );

    const scope: HTMLElement = await screen.findByTestId(
      "data-security-scrub-it-scope",
    );
    const dialog: HTMLElement = screen.getByRole("dialog");
    const english: EnglishWords = {
      scope: SCRUB_IT_SCOPE_SENTENCES.log.service,
      heading: FIELD_READERS_HEADING,
      monitors: FIELD_READER_CONSEQUENCES[TelemetryFieldReaderKind.Monitor],
      securityEvents:
        SECURITY_EVENTS_LOSSES[SecurityEventsFieldNeed.ClientAddresses],
      title: "Scrub This Data at Ingest",
      button: "Scrub It",
    };

    // Whose logs: the service's, in the reader's words, its name as sent.
    expect(plain(scope.textContent || "")).toBe(
      plain(
        wordsOf(language, english.scope).replace("{{service}}", "checkout"),
      ),
    );
    // What reads it: the monitor that stops matching, what Security Events loses.
    expect(
      plain(
        screen.getByTestId("telemetry-field-readers-heading").textContent || "",
      ),
    ).toBe(plain(wordsOf(language, english.heading)));
    expect(
      plain(
        screen.getByTestId("telemetry-field-readers-Monitor").textContent || "",
      ),
    ).toContain(plain(wordsOf(language, english.monitors)));
    expect(
      plain(
        screen.getByTestId(
          "telemetry-field-readers-security-events-clientAddresses",
        ).textContent || "",
      ),
    ).toBe(plain(wordsOf(language, english.securityEvents)));
    // The question and its button.
    expect(plain(dialog.textContent || "")).toContain(
      plain(wordsOf(language, english.title)),
    );
    expect(
      within(dialog).getByRole("button", {
        name: plain(wordsOf(language, english.button)),
      }),
    ).toBeEnabled();

    if (language !== "en") {
      // Worded in the language, never left in English.
      for (const key of [
        "scope",
        "heading",
        "monitors",
        "securityEvents",
      ] as Array<keyof EnglishWords>) {
        expect([language, key, wordsOf(language, english[key])]).not.toEqual([
          language,
          key,
          english[key],
        ]);
      }
    }
  });
});

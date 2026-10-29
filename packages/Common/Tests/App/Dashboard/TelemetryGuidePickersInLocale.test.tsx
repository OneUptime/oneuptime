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
import fs from "fs";
import i18next from "i18next";
import path from "path";
import * as React from "react";
import { initReactI18next } from "react-i18next";
import { MemoryRouter } from "react-router-dom";
import TelemetryDocumentation, {
  TELEMETRY_LANGUAGES,
  TelemetryType,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Telemetry/Documentation";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import ProjectUtil from "../../../UI/Utils/Project";
import API from "../../../UI/Utils/API/API";
import TelemetryIngestionKey from "../../../Models/DatabaseModels/TelemetryIngestionKey";
import TelemetryIngestionKeyType from "../../../Types/Telemetry/TelemetryIngestionKeyType";
import ObjectID from "../../../Types/ObjectID";
import {
  OpenTelemetryGuideEntry,
  getGuidesForTelemetryGuideLanguage,
} from "../../../Types/Telemetry/OpenTelemetryGuides";

/*
 * The telemetry guide's two pickers in the reader's language.
 *
 * Above the language buttons, "Select Language"; above the ways to send
 * logs, "Integration Method": each in the reader's language, from the
 * shipped Dashboard locales, and each the name a screen reader gives its
 * buttons as a group. The buttons' names (".NET", "C++") and the
 * names of the website's guides under them (".NET", "ASP.NET Core") are
 * read the way they are written on a right-to-left page too: in Persian,
 * an unisolated ".NET" drew as "NET." and "C++" as "++C".
 */

const LOCALES_DIR: string = path.resolve(
  __dirname,
  "../../../../App/FeatureSet/Dashboard/src/Locales",
);

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

const LABELS: Array<string> = ["Select Language", "Integration Method"];

const PROJECT_ID: ObjectID = new ObjectID(
  "6a000000-0000-4000-8000-0000000000a1",
);

function readLocale(locale: string): Record<string, string> {
  return JSON.parse(
    fs.readFileSync(path.join(LOCALES_DIR, `${locale}.json`), "utf8"),
  ) as Record<string, string>;
}

async function readIn(language: string): Promise<void> {
  await act(async () => {
    await i18next.changeLanguage(language);
  });
}

function renderGuide(telemetryType: TelemetryType): void {
  render(
    <MemoryRouter>
      <TelemetryDocumentation telemetryType={telemetryType} />
    </MemoryRouter>,
  );
}

/*
 * The pickers' captions on screen, as a screen reader names each set of
 * buttons: the uppercase caption a group of choices is labelled by.
 */
function pickerCaptions(): Array<string> {
  return Array.from(
    document.querySelectorAll('[role="group"][aria-labelledby]'),
  ).map((group: Element): string => {
    const caption: HTMLElement | null = document.getElementById(
      group.getAttribute("aria-labelledby") || "",
    );

    return (caption?.textContent || "").trim();
  });
}

beforeAll(async () => {
  const resources: Record<string, { translation: Record<string, string> }> = {
    en: { translation: readLocale("en") },
  };

  for (const language of LANGUAGES) {
    resources[language] = { translation: readLocale(language) };
  }

  await i18next.use(initReactI18next).init({
    lng: "en",
    fallbackLng: "en",
    resources: resources,
    interpolation: { escapeValue: false },
  });
});

beforeEach(() => {
  const key: TelemetryIngestionKey = new TelemetryIngestionKey();
  key.id = new ObjectID("6a000000-0000-4000-8000-0000000000a2");
  key.name = "Production Key";
  key.secretKey = new ObjectID("6a000000-0000-4000-8000-0000000000a3");
  key.keyType = TelemetryIngestionKeyType.Server;

  jest.spyOn(ProjectUtil, "getCurrentProjectId").mockReturnValue(PROJECT_ID);
  jest.spyOn(ModelAPI, "getList").mockResolvedValue({
    data: [key],
    count: 1,
    skip: 0,
    limit: 50,
  } as never);
  jest.spyOn(API, "post").mockResolvedValue({
    data: { activity: [] },
  } as never);
});

afterEach(async () => {
  cleanup();
  jest.restoreAllMocks();
  await readIn("en");
});

describe("the telemetry guide's picker labels", () => {
  test("are worded in every Dashboard locale, not left in English", () => {
    for (const language of LANGUAGES) {
      const locale: Record<string, string> = readLocale(language);

      for (const label of LABELS) {
        expect([language, label, Boolean(locale[label])]).toEqual([
          language,
          label,
          true,
        ]);
        expect([language, locale[label]]).not.toEqual([language, label]);
      }
    }
  });

  test("name a programming language, not a spoken one, where the two words differ", () => {
    expect(readLocale("es")["Select Language"]).toBe("Seleccionar lenguaje");
    expect(readLocale("fr")["Select Language"]).toBe("Sélectionner le langage");
    expect(readLocale("it")["Select Language"]).toBe("Seleziona linguaggio");
    expect(readLocale("pt")["Select Language"]).toBe("Selecionar linguagem");
  });

  test.each(LANGUAGES)(
    "are drawn in %s above the buttons they name",
    async (language: string) => {
      const locale: Record<string, string> = readLocale(language);

      await readIn(language);
      // The logs guide offers several ways to send logs, so both pickers show.
      renderGuide("logs");

      // The ways to send come first in the logs guide, then the languages.
      expect(pickerCaptions()).toEqual([
        locale["Integration Method"],
        locale["Select Language"],
      ]);
    },
  );

  test("are English for an English reader", () => {
    renderGuide("logs");

    expect(pickerCaptions()).toEqual(["Integration Method", "Select Language"]);
  });

  test("name their buttons as a group, so a screen reader says which choice it is", async () => {
    const locale: Record<string, string> = readLocale("de");
    const languagesName: string = locale["Select Language"] || "";
    const methodsName: string = locale["Integration Method"] || "";

    await readIn("de");
    renderGuide("logs");

    expect([languagesName, methodsName]).toEqual([
      "Sprache auswählen",
      "Integrationsmethode",
    ]);
    const languages: HTMLElement = screen.getByRole("group", {
      name: languagesName,
    });
    const methods: HTMLElement = screen.getByRole("group", {
      name: methodsName,
    });

    // Every language button is in the first group, and none in the second.
    expect(within(languages).getAllByRole("button")).toHaveLength(
      TELEMETRY_LANGUAGES.length,
    );
    expect(
      within(languages).getByRole("button", { name: ".NET" }),
    ).toHaveAttribute("aria-pressed", "false");
    expect(
      within(methods).queryByRole("button", { name: ".NET" }),
    ).not.toBeInTheDocument();
    expect(within(methods).getAllByRole("button").length).toBeGreaterThan(1);
    // The captions are text a group is named by, not labels of a form field.
    expect(document.querySelectorAll("label")).toHaveLength(0);
  });
});

describe("the names on a right-to-left page", () => {
  test("every language button holds its name in an isolate that reads as written", async () => {
    await readIn("fa");
    renderGuide("traces");

    for (const language of TELEMETRY_LANGUAGES) {
      const button: HTMLElement = screen.getByRole("button", {
        name: language.shortLabel,
      });
      const isolate: HTMLElement | null = button.querySelector("bdi");

      expect([language.key, isolate?.textContent]).toEqual([
        language.key,
        language.shortLabel,
      ]);
      // Latin letters read left to right, whatever the page's direction.
      expect([language.key, isolate?.getAttribute("dir")]).toEqual([
        language.key,
        "ltr",
      ]);
    }
  });

  test(".NET's guides are named as written in the line under the buttons", async () => {
    await readIn("fa");
    renderGuide("traces");

    fireEvent.click(screen.getByRole("button", { name: ".NET" }));

    const guides: ReturnType<typeof getGuidesForTelemetryGuideLanguage> =
      getGuidesForTelemetryGuideLanguage("dotnet");
    const expected: Array<string> = [
      guides!.languageGuide,
      ...guides!.frameworkGuides,
    ].map((guide: OpenTelemetryGuideEntry): string => {
      return guide.name;
    });
    const line: HTMLElement = screen.getByTestId("telemetry-framework-guides");
    const names: Array<{ text: string; dir: string | null }> = Array.from(
      line.querySelectorAll("a bdi"),
    ).map((isolate: Element): { text: string; dir: string | null } => {
      return {
        text: isolate.textContent || "",
        dir: isolate.getAttribute("dir"),
      };
    });

    expect(expected).toEqual([".NET", "ASP.NET Core", "Worker Service"]);
    expect(names).toEqual(
      expected.map((name: string): { text: string; dir: string } => {
        return { text: name, dir: "ltr" };
      }),
    );
  });

  test("the guides' links keep their accessible names", async () => {
    renderGuide("traces");

    fireEvent.click(screen.getByRole("button", { name: "Java" }));

    for (const name of [
      "Java",
      "Spring Boot",
      "Quarkus",
      "Micronaut",
      "Ktor",
    ]) {
      expect(screen.getByRole("link", { name: name })).toBeInTheDocument();
    }
  });
});

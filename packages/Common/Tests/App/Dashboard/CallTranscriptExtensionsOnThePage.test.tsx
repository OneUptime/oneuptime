import "@testing-library/jest-dom";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, test } from "@jest/globals";
import { createInstance, i18n } from "i18next";
import React from "react";
import { I18nextProvider } from "react-i18next";
import AddCallTranscriptModal, {
  getTranscriptSourceHint,
} from "../../../../App/FeatureSet/Dashboard/src/Components/VideoCall/AddCallTranscriptModal";
import { MAX_TRANSCRIPT_FILE_BYTES } from "../../../../App/FeatureSet/Dashboard/src/Components/VideoCall/CallTranscriptState";
import { formatFileSize } from "../../../Types/File/FileSize";
import arabicLocale from "../../../../App/FeatureSet/Dashboard/src/Locales/ar.json";
import englishLocale from "../../../../App/FeatureSet/Dashboard/src/Locales/en.json";
import persianLocale from "../../../../App/FeatureSet/Dashboard/src/Locales/fa.json";
import { setDateDisplayLanguage } from "../../../Types/DateLanguage";
import ObjectID from "../../../Types/ObjectID";
import VideoCallProvider from "../../../Types/VideoCall/VideoCallProvider";
import {
  codeReadsAsWrittenPostProcessor,
  getTranslationPostProcess,
  whenCodeCanBeSetApart,
  withoutIsolates,
} from "../../../UI/Utils/CodeReadsAsWritten";
import { productNamePostProcessor } from "../../../UI/Utils/ProductNameTranslation";
import {
  DrawnLine,
  drawLine,
  isDrawnAsWritten,
} from "../../Helpers/BidiLayout";

/*
 * THE ADD TRANSCRIPT DIALOG'S FILE EXTENSIONS, ON A PAGE READ FROM THE RIGHT
 * (issue #7419).
 *
 * The dialog names the files it takes - ".vtt, .srt or .txt" under its drop
 * zone, ".vtt" in the line on where each meeting tool keeps its transcript.
 * In a Persian or Arabic sentence an extension's dot is a sign with no
 * direction of its own, so laid out as the locale file holds the sentence it
 * is drawn after its letters: "vtt." - as the offline incident page drew it,
 * whose i18next was set up without the Dashboard's post-processors. The
 * Dashboard's own i18next (Utils/i18n.ts: the product-name and
 * code-reads-as-written post-processors, getTranslationPostProcess) sets each
 * extension apart, so it is drawn as it is written.
 *
 * Each sentence is read from the Dashboard's real locale files, drawn by the
 * dialog itself, and laid out as a page read from the right lays it out
 * (Tests/Helpers/BidiLayout). Handed to the page as the locale files hold
 * them, the extensions are drawn "vtt." - the test's negative control. In
 * English nothing is set apart: the sentences are as en.json writes them.
 */

const EXTENSION: RegExp = /\.(vtt|srt|txt)(?![A-Za-z])/g;

const DROP_ZONE_SENTENCE: string =
  "or drop it here: .vtt, .srt or .txt, up to {{size}}";

const dashboardI18n: i18n = createInstance();
// The negative control: the sentences as the locale files hold them.
const rawI18n: i18n = createInstance();

const RESOURCES: Record<string, { translation: Record<string, unknown> }> = {
  en: { translation: englishLocale as Record<string, unknown> },
  ar: { translation: arabicLocale as Record<string, unknown> },
  fa: { translation: persianLocale as Record<string, unknown> },
};

beforeAll(async () => {
  // The Dashboard's Arabic and Persian words arrive with the rules that set their code apart.
  await whenCodeCanBeSetApart("fa");
  await dashboardI18n
    .use(productNamePostProcessor)
    .use(codeReadsAsWrittenPostProcessor)
    .init({
      lng: "fa",
      fallbackLng: "en",
      postProcess: getTranslationPostProcess(),
      resources: RESOURCES,
      interpolation: { escapeValue: false },
      keySeparator: false,
      nsSeparator: false,
    });
  await rawI18n.init({
    lng: "fa",
    fallbackLng: "en",
    resources: RESOURCES,
    interpolation: { escapeValue: false },
    keySeparator: false,
    nsSeparator: false,
  });
});

afterEach(() => {
  cleanup();
  setDateDisplayLanguage("en");
});

// The dialog for a call on `provider`, in `language`.
const drawDialog: (
  language: string,
  provider: VideoCallProvider | undefined,
  instance?: i18n,
) => Promise<void> = async (
  language: string,
  provider: VideoCallProvider | undefined,
  instance: i18n = dashboardI18n,
): Promise<void> => {
  await instance.changeLanguage(language);
  setDateDisplayLanguage(language);
  render(
    <I18nextProvider i18n={instance}>
      <AddCallTranscriptModal
        callId={new ObjectID("aaaaaaaa-0000-4000-8000-000000000041")}
        callLabel="Zoom meeting"
        provider={provider}
        onClose={() => {}}
        onAdded={() => {}}
      />
    </I18nextProvider>,
  );
};

// The drop zone's line on what it takes, and the line on where a tool keeps its transcript.
const dialogSentences: () => Array<string> = (): Array<string> => {
  const zone: HTMLElement = screen.getByTestId(
    "add-call-transcript-choose-file",
  );
  const takes: Element | undefined = Array.from(
    zone.querySelectorAll("span"),
  ).pop();

  return [
    takes?.textContent || "",
    screen.getByTestId("add-call-transcript-hint").textContent || "",
  ];
};

/*
 * Where each unit of `written` is in `shown`, the same text with isolates'
 * marks added: shown holds every unit of written, in order.
 */
const placesIn: (written: string, shown: string) => Array<number> = (
  written: string,
  shown: string,
): Array<number> => {
  const places: Array<number> = [];
  let at: number = 0;

  for (let index: number = 0; index < shown.length; index++) {
    if (at < written.length && shown[index] === written[at]) {
      places.push(index);
      at++;
    }
  }

  return places;
};

interface DrawnExtension {
  extension: string;
  isDrawnAsWritten: boolean;
}

// Each extension `shown` names, and whether a page read from the right draws it as it is written.
const drawnExtensions: (shown: string) => Array<DrawnExtension> = (
  shown: string,
): Array<DrawnExtension> => {
  const written: string = withoutIsolates(shown);
  const places: Array<number> = placesIn(written, shown);
  const line: DrawnLine = drawLine(shown, "rtl");

  return Array.from(written.matchAll(EXTENSION)).map(
    (match: RegExpMatchArray): DrawnExtension => {
      const start: number = match.index ?? 0;
      const end: number = start + match[0].length;

      return {
        extension: match[0],
        isDrawnAsWritten: isDrawnAsWritten(
          line,
          places[start] as number,
          (places[end - 1] as number) + 1,
        ),
      };
    },
  );
};

// Each provider the dialog words its line for, and the line for any other.
const PROVIDERS: Array<[string, VideoCallProvider | undefined]> = [
  ["Microsoft Teams", VideoCallProvider.MicrosoftTeams],
  ["Zoom", VideoCallProvider.Zoom],
  ["any other tool", undefined],
];

describe.each(["fa", "ar"])(
  "the Add transcript dialog in %s",
  (language: string) => {
    test.each(PROVIDERS)(
      "a call on %s: every file extension it names is drawn as it is written",
      async (_name: string, provider: VideoCallProvider | undefined) => {
        await drawDialog(language, provider);

        const drawn: Array<DrawnExtension> =
          dialogSentences().flatMap(drawnExtensions);

        for (const extension of drawn) {
          expect(extension).toEqual({
            extension: extension.extension,
            isDrawnAsWritten: true,
          });
        }
      },
    );

    // The words around them are the locale file's, as it writes them.
    test.each(PROVIDERS)(
      "a call on %s: the sentences are the locale file's, nothing else added",
      async (_name: string, provider: VideoCallProvider | undefined) => {
        await drawDialog(language, provider);

        const locale: Record<string, unknown> =
          RESOURCES[language]!.translation;
        const size: string = formatFileSize(MAX_TRANSCRIPT_FILE_BYTES, {
          language: language,
        });

        expect(dialogSentences().map(withoutIsolates)).toEqual([
          (locale[DROP_ZONE_SENTENCE] as string).replace("{{size}}", size),
          locale[getTranscriptSourceHint(provider)] as string,
        ]);
        // A line in the reader's language, not English left in place.
        for (const shown of dialogSentences()) {
          expect(shown).toMatch(/[\u0600-\u06FF]/);
        }
      },
    );
  },
);

describe("the extensions the dialog names", () => {
  // Persian writes the extensions as the English does; Arabic names some by their letters.
  test("fa: a Persian page names them in every line, each drawn as it is written", async () => {
    const all: Array<string> = [];

    for (const [, provider] of PROVIDERS) {
      await drawDialog("fa", provider);
      all.push(
        ...dialogSentences()
          .flatMap(drawnExtensions)
          .map((drawn: DrawnExtension): string => {
            return drawn.isDrawnAsWritten ? drawn.extension : "";
          }),
      );
      cleanup();
    }

    // The drop zone's three, three times, and the tools' lines' four.
    expect(all.filter(Boolean)).toHaveLength(13);
    expect(all).not.toContain("");
  });

  test("ar: Zoom's line names .vtt, drawn as it is written", async () => {
    await drawDialog("ar", VideoCallProvider.Zoom);

    expect(dialogSentences().flatMap(drawnExtensions)).toEqual([
      { extension: ".vtt", isDrawnAsWritten: true },
    ]);
  });

  /*
   * The negative control: handed to the page as the locale files hold them,
   * the extensions of a Persian sentence are drawn "vtt." - the offline
   * page's i18next before it was set up as the Dashboard's.
   */
  test("fa, as the locale file holds it: the extensions are not drawn as they are written", async () => {
    await drawDialog("fa", undefined, rawI18n);

    const drawn: Array<DrawnExtension> =
      dialogSentences().flatMap(drawnExtensions);

    expect(drawn.length).toBeGreaterThan(0);
    expect(
      drawn.filter((extension: DrawnExtension): boolean => {
        return !extension.isDrawnAsWritten;
      }).length,
    ).toBeGreaterThan(0);
    // No extension was set apart: only the size, a value of its sentence, is.
    for (const shown of dialogSentences()) {
      expect(shown).not.toMatch(/[\u2066-\u2069]\.(vtt|srt|txt)/);
    }
  });

  /*
   * The pasted transcript's example: its figures in the reader's digits on
   * a Persian page, as every Persian sentence writes them; its time stamp
   * as a transcript writes it, the shape the dialog reads (TranscriptText).
   */
  test("fa: the example transcript's figures are Persian's, its time stamp a transcript's", async () => {
    await drawDialog("fa", VideoCallProvider.Zoom);

    // Read without the marks that set its code apart on a page read from the right.
    const example: string = withoutIsolates(
      screen
        .getByTestId("add-call-transcript-text")
        .getAttribute("placeholder") || "",
    );

    expect(example.startsWith("[00:12:03] ")).toBe(true);
    expect(example.slice("[00:12:03] ".length)).not.toMatch(/[0-9]/);
    expect(example).toContain("\u06F5\u06F0");
    expect(example).toContain("\u06F1\u06F0\u06F0");
  });

  test("ar and en: the example's figures are Latin digits, as their pages write them", async () => {
    for (const language of ["ar", "en"]) {
      await drawDialog(language, VideoCallProvider.Zoom);

      const example: string = withoutIsolates(
        screen
          .getByTestId("add-call-transcript-text")
          .getAttribute("placeholder") || "",
      );

      expect(example.startsWith("[00:12:03] ")).toBe(true);
      expect(example).toContain("50");
      expect(example).toContain("100");
      expect(example).not.toMatch(/[\u06F0-\u06F9\u0660-\u0669]/);
      cleanup();
    }
  });

  test("en: the sentences as English writes them, nothing set apart", async () => {
    await drawDialog("en", VideoCallProvider.Zoom);

    expect(dialogSentences()).toEqual([
      "or drop it here: .vtt, .srt or .txt, up to 5 MB",
      "In Zoom, open Recordings and Transcripts and download the meeting's transcript (.vtt).",
    ]);
  });
});

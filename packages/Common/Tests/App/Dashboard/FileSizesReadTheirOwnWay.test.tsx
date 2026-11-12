import "@testing-library/jest-dom";
import { afterEach, beforeAll, describe, expect, test } from "@jest/globals";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createInstance, i18n } from "i18next";
import React from "react";
import { I18nextProvider } from "react-i18next";
import AddCallTranscriptModal, {
  TRANSCRIPT_FILE_NAME_CLASS_NAME,
} from "../../../../App/FeatureSet/Dashboard/src/Components/VideoCall/AddCallTranscriptModal";
import FileModel from "../../../Models/DatabaseModels/File";
import { CustomFieldFile } from "../../../Types/CustomField/CustomFieldFile";
import { setDateDisplayLanguage } from "../../../Types/DateLanguage";
import MimeType from "../../../Types/File/MimeType";
import ObjectID from "../../../Types/ObjectID";
import {
  FIRST_STRONG_ISOLATE,
  POP_DIRECTIONAL_ISOLATE,
} from "../../../Types/ReadingDirection";
import { getInlineSeparator } from "../../../Types/Translator";
import VideoCallProvider from "../../../Types/VideoCall/VideoCallProvider";
import CustomFieldFileList, {
  CUSTOM_FIELD_FILE_SIZE_CLASS_NAME,
} from "../../../UI/Components/CustomFields/CustomFieldFileList";
import FilePicker from "../../../UI/Components/FilePicker/FilePicker";
import { FILE_PICKER_FILE_NAME_CLASS_NAME } from "../../../UI/Components/FilePicker/FilePickerLayout";
import { readDashboardLocale } from "../../Helpers/DashboardLocales";
import { withoutIsolateMarks } from "../../Helpers/IsolateMarks";

/*
 * A FILE'S SIZE, IN THE READER'S DIGITS AND READ ITS OWN WAY (issue #7233).
 *
 * Every list of files says a file's size the same way (formatFileSize):
 * the Custom Fields card, the file picker a form lists its files in, the
 * incident call's Add transcript dialog. On a Persian page that size was
 * written in Latin digits beside Persian ones, and drawn as bare text in a
 * line read from the right: "KB 47", its unit before its number. The
 * picker joined a file's type and size with a bullet of its own, and drew
 * an English file name the page's way, its ".pdf" at the wrong end.
 *
 * Each size is now in the reader's digits ("۴۷ KB"), a value that reads
 * its own way (a bdi, its direction left to right); the picker's facts are
 * set off by the reader's own separator; a name that reads the other way
 * from the page is a line of its own; and a limit in a sentence ("Max 10
 * MB each.", "up to 5 MB") is a value of that sentence, set apart from its
 * words on a page read from the right. English is drawn as it was.
 */

const LATIN_DIGIT: RegExp = /[0-9]/;
const PERSIAN_DIGIT: RegExp = /[\u06F0-\u06F9]/;

const ENGLISH_NAME: string = "Q3 vendor contract (signed).pdf";
const ARABIC_NAME: string = "عقد المورد للربع الثالث.pdf";

// 47 KB, as the card says it ("47 KB", never "47.1 KB").
const SIZE_IN_BYTES: number = 48213;

const instances: Record<string, i18n> = {};

beforeAll(async () => {
  for (const language of ["en", "ar", "fa"]) {
    const instance: i18n = createInstance();

    await instance.init({
      lng: language,
      fallbackLng: "en",
      resources: {
        [language]: { translation: readDashboardLocale(language) },
      },
      interpolation: { escapeValue: false },
      keySeparator: false,
      nsSeparator: false,
    });

    instances[language] = instance;
  }
});

afterEach(() => {
  cleanup();
  setDateDisplayLanguage("en");
});

// What the page draws in `language`: the frontends set the page's language for its figures too.
function draw(language: string, element: React.ReactElement): void {
  setDateDisplayLanguage(language);
  render(
    <I18nextProvider i18n={instances[language]!}>{element}</I18nextProvider>,
  );
}

/*
 * A value that reads its own way: an isolate (bdi) whose direction is its
 * own, left to right for a number and a Latin unit, so "۴۷ KB" keeps its
 * number first wherever it is drawn.
 */
function readsItsOwnWay(element: HTMLElement): boolean {
  return element.tagName === "BDI" && element.getAttribute("dir") === "ltr";
}

// The size each language writes for SIZE_IN_BYTES.
const SIZE_IN: Record<string, string> = {
  en: "47 KB",
  ar: "47 KB",
  fa: "۴۷ KB",
};

describe("the Custom Fields card's list of files", () => {
  const file: CustomFieldFile = {
    fileId: "aaaaaaaa-0000-4000-8000-000000000021",
    name: ENGLISH_NAME,
    fileType: MimeType.pdf,
    size: SIZE_IN_BYTES,
  };

  test.each(["en", "ar", "fa"])(
    "%s: the size is the reader's, a value of its own beside the name",
    (language: string) => {
      draw(language, <CustomFieldFileList files={[file]} dataTestId="files" />);

      const size: HTMLElement = screen.getByTestId("custom-field-file-size");

      expect(withoutIsolateMarks(size.textContent || "")).toBe(
        SIZE_IN[language],
      );
      expect(readsItsOwnWay(size)).toBe(true);
      // Its look is as it was: never squeezed, its digits one width.
      expect(size.getAttribute("class")).toBe(
        CUSTOM_FIELD_FILE_SIZE_CLASS_NAME,
      );
    },
  );

  test("fa: no Latin digit in any size", () => {
    draw(
      "fa",
      <CustomFieldFileList
        files={[
          file,
          {
            fileId: "aaaaaaaa-0000-4000-8000-000000000022",
            name: ARABIC_NAME,
            fileType: MimeType.pdf,
            size: 1.5 * 1024 * 1024,
          },
        ]}
        dataTestId="files"
      />,
    );

    const sizes: Array<string> = screen
      .getAllByTestId("custom-field-file-size")
      .map((element: HTMLElement): string => {
        return element.textContent || "";
      });

    expect(sizes).toEqual(["۴۷ KB", "۱٫۵ MB"]);

    for (const size of sizes) {
      expect(size).not.toMatch(LATIN_DIGIT);
      expect(size).toMatch(PERSIAN_DIGIT);
    }
  });

  /*
   * Negative control: the size as the card drew it before - bare text in a
   * span, in Latin digits - is what these checks refuse.
   */
  test("negative control: a bare size in a span is refused", () => {
    render(
      <span
        className={CUSTOM_FIELD_FILE_SIZE_CLASS_NAME}
        data-testid="old-size"
      >
        47 KB
      </span>,
    );

    const old: HTMLElement = screen.getByTestId("old-size");

    expect(readsItsOwnWay(old)).toBe(false);
    expect(old.textContent).toMatch(LATIN_DIGIT);
  });
});

describe("the file picker's files", () => {
  function pickedFile(name: string, id: string): FileModel {
    const model: FileModel = new FileModel(new ObjectID(id));
    model.name = name;
    model.fileType = MimeType.pdf;
    model.file = Buffer.from(new Uint8Array(SIZE_IN_BYTES));
    return model;
  }

  const drawPicker: (language: string) => void = (language: string): void => {
    draw(
      language,
      <FilePicker
        isMultiFilePicker={true}
        initialValue={[
          pickedFile(ENGLISH_NAME, "aaaaaaaa-0000-4000-8000-000000000031"),
          pickedFile(ARABIC_NAME, "aaaaaaaa-0000-4000-8000-000000000032"),
        ]}
      />,
    );
  };

  test.each(["en", "ar", "fa"])(
    "%s: each file's type and size, set off by the reader's separator, the size a value of its own",
    (language: string) => {
      drawPicker(language);

      const facts: Array<string> = screen
        .getAllByTestId("file-picker-file-facts")
        .map((element: HTMLElement): string => {
          return withoutIsolateMarks(element.textContent || "");
        });
      const line: string = `PDF${getInlineSeparator(language)}${SIZE_IN[language]}`;

      expect(facts).toEqual([line, line]);

      for (const size of screen.getAllByTestId("file-picker-file-size")) {
        expect(readsItsOwnWay(size)).toBe(true);
      }
    },
  );

  test("fa: a bullet between the facts, as a line whose zero is a dot sets them off, and Persian digits", () => {
    drawPicker("fa");

    const facts: HTMLElement = screen.getAllByTestId(
      "file-picker-file-facts",
    )[0]!;

    expect(facts.textContent).toBe("PDF • ۴۷ KB");
    expect(facts.textContent).not.toMatch(LATIN_DIGIT);
  });

  test("en: the facts as English has always set them off, a middle dot", () => {
    drawPicker("en");

    expect(
      screen.getAllByTestId("file-picker-file-facts")[0]!.textContent,
    ).toBe("PDF · 47 KB");
  });

  test.each(["ar", "fa"])(
    "%s: an English name is a line of its own, read left to right; an Arabic one keeps the page's way",
    (language: string) => {
      drawPicker(language);

      const [english, arabic] = screen.getAllByTestId("file-picker-file-name");

      expect(english).toHaveTextContent(ENGLISH_NAME);
      expect(english).toHaveAttribute("dir", "ltr");
      expect(english!.getAttribute("class")).toContain(
        FILE_PICKER_FILE_NAME_CLASS_NAME,
      );

      expect(arabic).toHaveTextContent(ARABIC_NAME);
      expect(arabic).not.toHaveAttribute("dir");
      expect(arabic!.getAttribute("class")).toBe(
        FILE_PICKER_FILE_NAME_CLASS_NAME,
      );
    },
  );

  test("en: an English name is drawn as it was, a paragraph with the picker's classes", () => {
    drawPicker("en");

    const english: HTMLElement = screen.getAllByTestId(
      "file-picker-file-name",
    )[0]!;

    expect(english.tagName).toBe("P");
    expect(english).not.toHaveAttribute("dir");
    expect(english.getAttribute("class")).toBe(
      FILE_PICKER_FILE_NAME_CLASS_NAME,
    );
  });

  test("fa: the picker's limit is the sentence's value, in Persian digits and set apart", () => {
    draw("fa", <FilePicker mimeTypes={[MimeType.pdf]} />);

    const hint: HTMLElement = screen.getByText((text: string): boolean => {
      return withoutIsolateMarks(text).includes("۱۰ MB");
    });

    expect(hint.textContent).toContain(
      `${FIRST_STRONG_ISOLATE}۱۰ MB${POP_DIRECTIONAL_ISOLATE}`,
    );
    expect(withoutIsolateMarks(hint.textContent || "")).not.toMatch(/10\s?MB/);
  });

  test("en: the limit as English writes it, with nothing set apart", () => {
    draw("en", <FilePicker mimeTypes={[MimeType.pdf]} />);

    expect(screen.getByText("Types: PDF. Max 10 MB each.")).toBeVisible();
  });
});

describe("Add transcript's chosen file", () => {
  function chooseFile(name: string): void {
    const file: File = new File(["WEBVTT"], name, { type: "text/vtt" });
    Object.defineProperty(file, "size", { value: SIZE_IN_BYTES });
    Object.defineProperty(file, "text", {
      value: async (): Promise<string> => {
        return "WEBVTT";
      },
    });

    fireEvent.change(screen.getByTestId("add-call-transcript-file-input"), {
      target: { files: [file] },
    });
  }

  const drawDialog: (language: string) => void = (language: string): void => {
    draw(
      language,
      <AddCallTranscriptModal
        callId={new ObjectID("aaaaaaaa-0000-4000-8000-000000000041")}
        callLabel="Microsoft Teams meeting"
        provider={VideoCallProvider.MicrosoftTeams}
        onClose={() => {}}
        onAdded={() => {}}
      />,
    );
  };

  test.each(["en", "ar", "fa"])(
    "%s: its size is the reader's, a value of its own, from the shared formatFileSize",
    async (language: string) => {
      drawDialog(language);
      chooseFile("checkout-call.vtt");

      const size: HTMLElement = await screen.findByTestId(
        "add-call-transcript-file-size",
      );

      expect(size.textContent).toBe(SIZE_IN[language]);
      expect(readsItsOwnWay(size)).toBe(true);
    },
  );

  test.each(["ar", "fa"])(
    "%s: an English file name is a line of its own; an Arabic one keeps the page's way",
    async (language: string) => {
      drawDialog(language);
      chooseFile("Payments outage call transcript.vtt");

      const english: HTMLElement = await screen.findByTestId(
        "add-call-transcript-file-name",
      );

      expect(english).toHaveAttribute("dir", "ltr");
      expect(english.getAttribute("class")).toContain(
        TRANSCRIPT_FILE_NAME_CLASS_NAME,
      );

      fireEvent.click(screen.getByTestId("add-call-transcript-file-remove"));
      chooseFile("نسخه تماس.vtt");

      const arabic: HTMLElement = await screen.findByTestId(
        "add-call-transcript-file-name",
      );

      expect(arabic).toHaveTextContent("نسخه تماس.vtt");
      expect(arabic).not.toHaveAttribute("dir");
      expect(arabic.getAttribute("class")).toBe(
        TRANSCRIPT_FILE_NAME_CLASS_NAME,
      );
    },
  );

  test("en: the name is drawn as it was, one line cut short at its end", async () => {
    drawDialog("en");
    chooseFile("checkout-call.vtt");

    const name: HTMLElement = await screen.findByTestId(
      "add-call-transcript-file-name",
    );

    expect(name.tagName).toBe("P");
    expect(name).not.toHaveAttribute("dir");
    expect(name.getAttribute("class")).toBe(TRANSCRIPT_FILE_NAME_CLASS_NAME);
  });

  test("fa: the limit in its hint is in Persian digits, set apart from the words", () => {
    drawDialog("fa");

    const hint: HTMLElement = screen.getByText((text: string): boolean => {
      return withoutIsolateMarks(text).includes("۵ MB");
    });

    expect(hint.textContent).toContain(
      `${FIRST_STRONG_ISOLATE}۵ MB${POP_DIRECTIONAL_ISOLATE}`,
    );
    expect(withoutIsolateMarks(hint.textContent || "")).not.toMatch(
      LATIN_DIGIT,
    );
  });

  test("fa: a file too large is refused with the limit in Persian digits", async () => {
    drawDialog("fa");

    const large: File = new File(["x"], "all-hands.vtt", { type: "text/vtt" });
    Object.defineProperty(large, "size", { value: 5 * 1024 * 1024 + 1 });
    fireEvent.change(screen.getByTestId("add-call-transcript-file-input"), {
      target: { files: [large] },
    });

    const refusal: HTMLElement = await screen.findByText(
      (text: string): boolean => {
        return (
          withoutIsolateMarks(text).includes("۵ MB") &&
          !withoutIsolateMarks(text).includes(".vtt")
        );
      },
    );

    expect(refusal.textContent).toContain(
      `${FIRST_STRONG_ISOLATE}۵ MB${POP_DIRECTIONAL_ISOLATE}`,
    );
  });
});

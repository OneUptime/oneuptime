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
import {
  CUSTOM_FIELD_FILE_HINT,
  CUSTOM_FIELD_FILES_HINT,
} from "../../../UI/Components/CustomFields/CustomFieldFormFields";
import FilePicker from "../../../UI/Components/FilePicker/FilePicker";
import {
  FILE_PICKER_FILE_NAME_CLASS_NAME,
  FILE_PICKER_FULL_NOTE,
} from "../../../UI/Components/FilePicker/FilePickerLayout";
import fs from "fs";
import path from "path";
import { readDashboardLocale } from "../../Helpers/DashboardLocales";
import { isolated, withoutIsolateMarks } from "../../Helpers/IsolateMarks";
import {
  ACCOUNTS_LANGUAGES,
  ADMIN_DASHBOARD_LANGUAGES,
  DASHBOARD_LANGUAGES,
} from "../../Helpers/TranslatedLanguages";

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
  for (const language of ["en", "de", "ru", "ar", "fa"]) {
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

/*
 * A file custom field's picker, and a public form's file question, say
 * what they take in a sentence of their own (CUSTOM_FIELD_FILE_HINT,
 * CUSTOM_FIELD_FILES_HINT). Its limit was written into the words as "10
 * MB": in Latin digits on a Persian page, drawn unit first on an Arabic or
 * Persian one ("MB 10"), and 10 MB on a form question that takes less. It
 * is now the sentence's {{size}}: the picker's own limit, in the reader's
 * digits, set apart from the words where a page reads from the right.
 */
describe("a file custom field's hint", () => {
  const hintOf: () => HTMLElement = (): HTMLElement => {
    return screen.getByText((text: string): boolean => {
      return withoutIsolateMarks(text).includes("PCAP");
    });
  };

  // The sentence in `language`, its {{size}} filled with `size` as the page sets it.
  const sentenceIn: (
    language: string,
    key: string,
    size: string,
    count?: string,
  ) => string = (
    language: string,
    key: string,
    size: string,
    count?: string,
  ): string => {
    const words: string = readDashboardLocale(language)[key] || key;

    return words
      .replace("{{size}}", size)
      .replace("{{count}}", count === undefined ? "{{count}}" : count);
  };

  test("en: as English wrote it, with nothing set apart", () => {
    draw(
      "en",
      <FilePicker
        isMultiFilePicker={true}
        maxFiles={10}
        hint={CUSTOM_FIELD_FILES_HINT}
      />,
    );

    expect(hintOf().textContent).toBe(
      "Up to 10 files of 10 MB each: PDF, Office and OpenDocument files, pictures, text, CSV, JSON, ZIP or PCAP.",
    );
  });

  test.each([
    ["ar", "10 MB", "10"],
    ["fa", "۱۰ MB", "۱۰"],
  ])(
    "%s: the limit and the count are the reader's, set apart from the words",
    (language: string, size: string, count: string) => {
      draw(
        language,
        <FilePicker
          isMultiFilePicker={true}
          maxFiles={10}
          hint={CUSTOM_FIELD_FILES_HINT}
        />,
      );

      expect(hintOf().textContent).toBe(
        sentenceIn(
          language,
          CUSTOM_FIELD_FILES_HINT.other,
          isolated(size),
          isolated(count),
        ),
      );
    },
  );

  test("fa: no Latin digit, the count of files included", () => {
    draw("fa", <FilePicker hint={CUSTOM_FIELD_FILE_HINT} />);
    expect(withoutIsolateMarks(hintOf().textContent || "")).not.toMatch(
      LATIN_DIGIT,
    );
    cleanup();

    for (const maxFiles of [1, 3, 10]) {
      draw(
        "fa",
        <FilePicker
          isMultiFilePicker={true}
          maxFiles={maxFiles}
          hint={CUSTOM_FIELD_FILES_HINT}
        />,
      );
      expect(withoutIsolateMarks(hintOf().textContent || "")).not.toMatch(
        LATIN_DIGIT,
      );
      cleanup();
    }
  });

  /*
   * The count is the picker's own most files (issue #7421): a public
   * form's question that takes three says three, never the 10 a Multiple
   * files field holds - in the reader's digits, and in the words the
   * reader's language has for that count: one file in the words for one;
   * Russian's 21 (a count it calls "one") and Arabic's 2 and 11 in a
   * sentence that reads right for any count.
   */
  test.each([
    [
      "en",
      3,
      "Up to 3 files of 10 MB each: PDF, Office and OpenDocument files, pictures, text, CSV, JSON, ZIP or PCAP.",
    ],
    [
      "en",
      1,
      "One file of up to 10 MB: PDF, Office and OpenDocument files, pictures, text, CSV, JSON, ZIP or PCAP.",
    ],
    [
      "de",
      3,
      "Bis zu 3 Dateien mit je 10 MB: PDF-, Office- und OpenDocument-Dateien, Bilder, Text, CSV, JSON, ZIP oder PCAP.",
    ],
    [
      "de",
      1,
      "Eine Datei mit bis zu 10 MB: PDF-, Office- und OpenDocument-Dateien, Bilder, Text, CSV, JSON, ZIP oder PCAP.",
    ],
    [
      "ru",
      3,
      "Максимум файлов: 3, каждый до 10 MB: файлы PDF, Office и OpenDocument, изображения, текст, CSV, JSON, ZIP или PCAP.",
    ],
    [
      "ru",
      5,
      "Максимум файлов: 5, каждый до 10 MB: файлы PDF, Office и OpenDocument, изображения, текст, CSV, JSON, ZIP или PCAP.",
    ],
    [
      "ru",
      21,
      "Максимум файлов: 21, каждый до 10 MB: файлы PDF, Office и OpenDocument, изображения, текст, CSV, JSON, ZIP или PCAP.",
    ],
    [
      "ru",
      1,
      "Один файл до 10 MB: файлы PDF, Office и OpenDocument, изображения, текст, CSV, JSON, ZIP или PCAP.",
    ],
    [
      "ar",
      2,
      "الحد الأقصى للملفات: 2، حتى 10 MB لكل ملف: ملفات PDF وOffice وOpenDocument والصور والنصوص وCSV وJSON وZIP أو PCAP.",
    ],
    [
      "ar",
      3,
      "الحد الأقصى للملفات: 3، حتى 10 MB لكل ملف: ملفات PDF وOffice وOpenDocument والصور والنصوص وCSV وJSON وZIP أو PCAP.",
    ],
    [
      "ar",
      11,
      "الحد الأقصى للملفات: 11، حتى 10 MB لكل ملف: ملفات PDF وOffice وOpenDocument والصور والنصوص وCSV وJSON وZIP أو PCAP.",
    ],
    [
      "ar",
      1,
      "ملف واحد حتى 10 MB: ملفات PDF وOffice وOpenDocument والصور والنصوص وCSV وJSON وZIP أو PCAP.",
    ],
    [
      "fa",
      3,
      "حداکثر ۳ فایل، هر کدام تا ۱۰ MB: فایل‌های PDF، Office و OpenDocument، تصویر، متن، CSV، JSON، ZIP یا PCAP.",
    ],
    [
      "fa",
      1,
      "یک فایل تا ۱۰ MB: فایل‌های PDF، Office و OpenDocument، تصویر، متن، CSV، JSON، ZIP یا PCAP.",
    ],
  ] as Array<[string, number, string]>)(
    "%s: a picker of at most %p files says it",
    (language: string, maxFiles: number, words: string) => {
      draw(
        language,
        <FilePicker
          isMultiFilePicker={true}
          maxFiles={maxFiles}
          hint={CUSTOM_FIELD_FILES_HINT}
        />,
      );

      expect(withoutIsolateMarks(hintOf().textContent || "")).toBe(words);
    },
  );

  // Full, a picker says how many it holds, in the same words for the count.
  test.each([
    ["en", 3, "This field holds up to 3 files. Remove one to add another."],
    ["en", 1, "This field holds one file. Remove it to add another."],
    [
      "de",
      1,
      "Dieses Feld fasst eine Datei. Entfernen Sie sie, um eine andere hinzuzufügen.",
    ],
    [
      "ru",
      21,
      "Максимум файлов в этом поле: 21. Удалите один, чтобы добавить другой.",
    ],
    [
      "ru",
      1,
      "В этом поле может быть только один файл. Удалите его, чтобы добавить другой.",
    ],
    ["ar", 1, "يحمل هذا الحقل ملفًا واحدًا. أزله لإضافة آخر."],
    [
      "fa",
      3,
      "این فیلد حداکثر ۳ فایل می‌پذیرد. برای افزودن فایل دیگر، یکی را حذف کنید.",
    ],
    [
      "fa",
      1,
      "این فیلد یک فایل می‌پذیرد. برای افزودن فایل دیگر، آن را حذف کنید.",
    ],
  ] as Array<[string, number, string]>)(
    "%s: full at %p files, it says so",
    (language: string, maxFiles: number, words: string) => {
      const held: Array<FileModel> = [];

      for (let index: number = 0; index < maxFiles; index++) {
        const file: FileModel = new FileModel(
          new ObjectID(
            `aaaaaaaa-0000-4000-8000-0000000001${String(index).padStart(2, "0")}`,
          ),
        );
        file.name = `scan-${index}.pdf`;
        file.fileType = MimeType.pdf;
        held.push(file);
      }

      draw(
        language,
        <FilePicker
          isMultiFilePicker={true}
          maxFiles={maxFiles}
          initialValue={held}
          hint={CUSTOM_FIELD_FILES_HINT}
        />,
      );

      expect(
        withoutIsolateMarks(
          screen.getByTestId("file-picker-full").textContent || "",
        ),
      ).toBe(words);
    },
  );

  test("a picker with a limit of its own, as a form question may have, says that limit", () => {
    draw(
      "en",
      <FilePicker
        hint={CUSTOM_FIELD_FILE_HINT}
        maxFileSizeInBytes={5 * 1024 * 1024}
      />,
    );
    expect(hintOf().textContent).toBe(
      "PDF, Office and OpenDocument files, pictures, text, CSV, JSON, ZIP or PCAP, up to 5 MB.",
    );
    cleanup();

    draw(
      "fa",
      <FilePicker
        hint={CUSTOM_FIELD_FILE_HINT}
        maxFileSizeInBytes={5 * 1024 * 1024}
      />,
    );
    expect(hintOf().textContent).toBe(
      sentenceIn("fa", CUSTOM_FIELD_FILE_HINT, isolated("۵ MB")),
    );
  });

  /*
   * Every language's sentences leave their limit to the picker: one
   * {{size}} each, and no size of their own ("10 MB", "10MB", "10 Mo",
   * "10 МБ").
   */
  const ACCOUNTS_LOCALES: string = path.resolve(
    __dirname,
    "../../../../App/FeatureSet/Accounts/src/Locales",
  );

  const accountsWords: (language: string) => Record<string, string> = (
    language: string,
  ): Record<string, string> => {
    return JSON.parse(
      fs.readFileSync(path.join(ACCOUNTS_LOCALES, `${language}.json`), "utf8"),
    ) as Record<string, string>;
  };

  test.each([
    ...DASHBOARD_LANGUAGES.map((language: string): [string, string] => {
      return ["Dashboard", language];
    }),
    ...ACCOUNTS_LANGUAGES.map((language: string): [string, string] => {
      return ["Accounts", language];
    }),
  ])(
    "%s %s: both sentences leave their limit to the picker",
    (app: string, language: string) => {
      const words: Record<string, string> =
        app === "Dashboard"
          ? readDashboardLocale(language)
          : accountsWords(language);

      for (const key of [
        CUSTOM_FIELD_FILE_HINT,
        CUSTOM_FIELD_FILES_HINT.other,
        `${CUSTOM_FIELD_FILES_HINT.other}_one`,
      ]) {
        const sentence: string | undefined = words[key];

        expect(sentence).toBeDefined();
        expect(sentence!.split("{{size}}")).toHaveLength(2);
        expect(sentence).not.toMatch(/[0-9۰-۹]\s?(MB|Mo|МБ)/);
      }
    },
  );

  /*
   * The sentence for several leaves its count to the picker too (issue
   * #7421): one {{count}}, and no number of its own - "10", "۱۰" - in
   * every app that draws a file picker. Its one form, for exactly one
   * file, names no count, and a full picker's note has one in every
   * language too.
   */
  const ADMIN_LOCALES: string = path.resolve(
    __dirname,
    "../../../../App/FeatureSet/AdminDashboard/src/Locales",
  );

  const adminWords: (language: string) => Record<string, string> = (
    language: string,
  ): Record<string, string> => {
    return JSON.parse(
      fs.readFileSync(path.join(ADMIN_LOCALES, `${language}.json`), "utf8"),
    ) as Record<string, string>;
  };

  test.each([
    ...["en", ...DASHBOARD_LANGUAGES].map(
      (language: string): [string, string] => {
        return ["Dashboard", language];
      },
    ),
    ...["en", ...ACCOUNTS_LANGUAGES].map(
      (language: string): [string, string] => {
        return ["Accounts", language];
      },
    ),
    ...["en", ...ADMIN_DASHBOARD_LANGUAGES].map(
      (language: string): [string, string] => {
        return ["AdminDashboard", language];
      },
    ),
  ])(
    "%s %s: the count of files is the picker's, in both forms",
    (app: string, language: string) => {
      const words: Record<string, string> =
        app === "Dashboard"
          ? readDashboardLocale(language)
          : app === "Accounts"
            ? accountsWords(language)
            : adminWords(language);

      for (const plural of [CUSTOM_FIELD_FILES_HINT, FILE_PICKER_FULL_NOTE]) {
        const other: string | undefined = words[plural.other];
        const one: string | undefined = words[`${plural.other}_one`];

        expect(other).toBeDefined();
        expect(one).toBeDefined();
        expect(other!.split("{{count}}")).toHaveLength(2);
        /*
         * No number of its own: the hint has none at all; the full note
         * may ask to remove "1 つ" (Japanese), never say a most of its own.
         */
        expect(other).not.toMatch(
          plural === CUSTOM_FIELD_FILES_HINT ? /[0-9۰-۹]/ : /[0-9۰-۹]{2}/,
        );
        expect(one).not.toContain("{{count}}");

        if (language === "en") {
          expect(other).toBe(plural.other);
          expect(one).toBe(plural.one);
        }
      }

      // No sentence keeps the old one's "10" written into its words.
      expect(
        Object.keys(words).filter((key: string): boolean => {
          return key.startsWith("Up to 10 files of {{size}} each");
        }),
      ).toEqual([]);
    },
  );

  /*
   * Russian and Arabic say their general sentence for most counts (2, 5,
   * 21; 2, 3, 11, 100): it names its count as a label's value, so no noun
   * has to agree with a count it cannot see (Locales/ARABIC.md).
   */
  test.each(["ru", "ar"])(
    "%s: the sentence for several reads right for any count",
    (language: string) => {
      for (const plural of [CUSTOM_FIELD_FILES_HINT, FILE_PICKER_FULL_NOTE]) {
        expect(readDashboardLocale(language)[plural.other]).toMatch(
          /: \{\{count\}\}[.,،]/,
        );
      }
    },
  );
});

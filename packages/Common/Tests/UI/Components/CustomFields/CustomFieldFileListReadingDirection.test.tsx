import "@testing-library/jest-dom";
import { afterEach, beforeAll, describe, expect, test } from "@jest/globals";
import { cleanup, render, screen, within } from "@testing-library/react";
import { createInstance, i18n } from "i18next";
import React from "react";
import { I18nextProvider } from "react-i18next";
import CustomFieldFileList, {
  CUSTOM_FIELD_FILE_COMPACT_NAME_CLASS_NAME,
  CUSTOM_FIELD_FILE_NAME_CLASS_NAME,
  CUSTOM_FIELD_FILE_NAME_LINE_CLASS_NAME,
} from "../../../../UI/Components/CustomFields/CustomFieldFileList";
import { isWrappingLineClassName } from "../../../../UI/Components/IsolatedText/IsolatedLine";
import { CustomFieldFile } from "../../../../Types/CustomField/CustomFieldFile";
import MimeType from "../../../../Types/File/MimeType";
import {
  CLAMPED_LINES_ALIGNED_AS_THE_PAGE_CLASS_NAME,
  LINE_ALIGNED_AS_THE_PAGE_CLASS_NAME,
} from "../../../../UI/Utils/LineDirection";

/*
 * A FILE CUSTOM FIELD'S FILE NAMES, READ THE WAY THEY ARE WRITTEN (#7086).
 *
 * A File or Multiple files custom field lists each file by its name - the
 * name it was uploaded with, typed by whoever made the file. On an Arabic
 * or Persian page, laid out from the right, an English name was drawn the
 * page's way: a long one wrapped with each of its lines lined up on the
 * right and its bracket or extension at the wrong end ("(signed).pdf Q3
 * vendor contract"), and a table cell's name, cut short where the cell
 * ends, lost its start.
 *
 * A name that reads the other way from the page is a line of its own now
 * (IsolatedLine): in the list, a box in the room between the file's icon
 * and its size, as wide as its words and wrapping from its own start; in a
 * table cell, one line cut short at its own end. The row keeps the page's
 * way - icon first, size and download last - and stays one link. A name
 * that reads the page's way, and every name on an English page, is drawn
 * exactly as it was.
 */

const RIGHT_TO_LEFT_LANGUAGES: Array<string> = ["ar", "fa"];

// How many more files a cell names: "+1 more", "+۱ more".
const PLUS_COUNT_PATTERN: RegExp = /^\+(?:1|۱) /u;

const ENGLISH_FILE: CustomFieldFile = {
  fileId: "aaaaaaaa-0000-4000-8000-000000000011",
  name: "Q3 vendor contract - Acme Commerce EU West (signed, final).pdf",
  fileType: MimeType.pdf,
  size: 48213,
};

const ARABIC_FILE: CustomFieldFile = {
  fileId: "aaaaaaaa-0000-4000-8000-000000000012",
  name: "عقد المورد للربع الثالث.pdf",
  fileType: MimeType.pdf,
  size: 1572864,
};

const instances: Record<string, i18n> = {};

beforeAll(async () => {
  for (const language of ["en", "ar", "fa"]) {
    const instance: i18n = createInstance();

    await instance.init({
      lng: language,
      fallbackLng: "en",
      resources: { [language]: { translation: {} } },
      interpolation: { escapeValue: false },
      keySeparator: false,
      nsSeparator: false,
    });

    instances[language] = instance;
  }
});

afterEach(() => {
  cleanup();
});

const downloadOf: (file: CustomFieldFile) => string = (
  file: CustomFieldFile,
): string => {
  return `https://oneuptime.example/api/custom-field-file/p/incident/r/${file.fileId}`;
};

const drawList: (
  language: string,
  files: Array<CustomFieldFile>,
  options?: { isCompact?: boolean; withDownload?: boolean },
) => HTMLElement = (
  language: string,
  files: Array<CustomFieldFile>,
  options?: { isCompact?: boolean; withDownload?: boolean },
): HTMLElement => {
  render(
    <I18nextProvider i18n={instances[language]!}>
      <CustomFieldFileList
        files={files}
        getDownloadUrl={
          options?.withDownload === false ? undefined : downloadOf
        }
        isCompact={options?.isCompact}
        dataTestId="files"
      />
    </I18nextProvider>,
  );

  return screen.getByTestId("files");
};

// A row's name box: the room between its icon and its size.
const nameBoxOf: (row: HTMLElement) => HTMLElement = (
  row: HTMLElement,
): HTMLElement => {
  const box: HTMLElement | undefined = Array.from(
    row.children as HTMLCollectionOf<HTMLElement>,
  ).find((child: HTMLElement): boolean => {
    return child.getAttribute("class") === CUSTOM_FIELD_FILE_NAME_CLASS_NAME;
  });

  expect(box).toBeDefined();

  return box!;
};

describe("a file's name in the list", () => {
  test.each(RIGHT_TO_LEFT_LANGUAGES)(
    "%s: an English name is a line of its own, wrapping from its own start beside the icon",
    (language: string) => {
      drawList(language, [ENGLISH_FILE]);

      const row: HTMLElement = screen.getByTestId("custom-field-file");
      const box: HTMLElement = nameBoxOf(row);

      // The box keeps its place and the page's way.
      expect(box).not.toHaveAttribute("dir");
      expect(box.children).toHaveLength(1);

      const line: HTMLElement = box.firstElementChild as HTMLElement;

      expect(line.tagName).toBe("SPAN");
      expect(line.textContent).toBe(ENGLISH_FILE.name);
      expect(line).toHaveAttribute("dir", "ltr");
      // As wide as its words, at the page's start, each line from its start.
      expect(line.getAttribute("class")).toBe(
        `${CUSTOM_FIELD_FILE_NAME_LINE_CLASS_NAME} ${CLAMPED_LINES_ALIGNED_AS_THE_PAGE_CLASS_NAME}`,
      );
      expect(line).not.toHaveClass(LINE_ALIGNED_AS_THE_PAGE_CLASS_NAME);
    },
  );

  test.each(RIGHT_TO_LEFT_LANGUAGES)(
    "%s: the row keeps the page's way and stays one download link",
    (language: string) => {
      drawList(language, [ENGLISH_FILE]);

      const row: HTMLElement = screen.getByTestId("custom-field-file");
      const box: HTMLElement = nameBoxOf(row);
      const children: Array<Element> = Array.from(row.children);

      expect(row.tagName).toBe("A");
      expect(row).toHaveAttribute("href", downloadOf(ENGLISH_FILE));
      expect(row).not.toHaveAttribute("dir");
      // Icon, name, size, download: in that order, the page's way.
      expect(children).toHaveLength(4);
      expect(children[1]).toBe(box);
      expect(
        children[0]!.tagName.toLowerCase() === "svg" ||
          children[0]!.querySelector("svg") !== null,
      ).toBe(true);
      expect(children[0]).not.toHaveAttribute("dir");
      expect(children[2]).toHaveTextContent("47 KB");
      // One link holds the whole row: the name is no link of its own.
      expect(within(row).queryAllByRole("link")).toHaveLength(0);
      expect(screen.getAllByRole("link")).toEqual([row]);
    },
  );

  test.each(RIGHT_TO_LEFT_LANGUAGES)(
    "%s: without a download the row is the name, read its own way",
    (language: string) => {
      drawList(language, [ENGLISH_FILE], { withDownload: false });

      const row: HTMLElement = screen.getByTestId("custom-field-file");

      expect(row.tagName).toBe("DIV");
      expect(nameBoxOf(row).firstElementChild).toHaveAttribute("dir", "ltr");
    },
  );

  test.each(RIGHT_TO_LEFT_LANGUAGES)(
    "%s: an Arabic name reads the page's way and is drawn as it was",
    (language: string) => {
      drawList(language, [ARABIC_FILE]);

      const box: HTMLElement = nameBoxOf(
        screen.getByTestId("custom-field-file"),
      );

      expect(box.children).toHaveLength(0);
      expect(box.textContent).toBe(ARABIC_FILE.name);
      expect(box).not.toHaveAttribute("dir");
    },
  );

  test.each(RIGHT_TO_LEFT_LANGUAGES)(
    "%s: each file of a list reads its own way",
    (language: string) => {
      drawList(language, [ENGLISH_FILE, ARABIC_FILE]);

      const [english, arabic] = screen
        .getAllByTestId("custom-field-file")
        .map(nameBoxOf);

      expect(english!.firstElementChild).toHaveAttribute("dir", "ltr");
      expect(arabic!.children).toHaveLength(0);
    },
  );

  test("on an English page an English name has the markup it always had", () => {
    drawList("en", [ENGLISH_FILE]);

    const box: HTMLElement = nameBoxOf(screen.getByTestId("custom-field-file"));

    expect(box.children).toHaveLength(0);
    expect(box.innerHTML).toBe(
      "Q3 vendor contract - Acme Commerce EU West (signed, final).pdf",
    );
    expect(box.getAttribute("class")).toBe(
      "min-w-0 flex-1 break-words font-medium text-gray-800 [overflow-wrap:anywhere]",
    );
  });

  test("on an English page an Arabic name reads right to left, at the page's start", () => {
    drawList("en", [ARABIC_FILE]);

    const line: HTMLElement = nameBoxOf(screen.getByTestId("custom-field-file"))
      .firstElementChild as HTMLElement;

    expect(line).toHaveAttribute("dir", "rtl");
    expect(line.textContent).toBe(ARABIC_FILE.name);
    expect(line).toHaveClass(
      ...CLAMPED_LINES_ALIGNED_AS_THE_PAGE_CLASS_NAME.split(" "),
    );
  });

  test("a name's line wraps whole, never cut short", () => {
    expect(
      isWrappingLineClassName(CUSTOM_FIELD_FILE_NAME_LINE_CLASS_NAME),
    ).toBe(true);
    expect(CUSTOM_FIELD_FILE_NAME_LINE_CLASS_NAME.split(" ")).toEqual([
      "block",
      "[overflow-wrap:anywhere]",
    ]);
    expect(CUSTOM_FIELD_FILE_NAME_CLASS_NAME).not.toContain("truncate");
  });
});

describe("a table cell's first file name", () => {
  test.each(RIGHT_TO_LEFT_LANGUAGES)(
    "%s: an English name is cut short at its own end, beside the paper clip",
    (language: string) => {
      const cell: HTMLElement = drawList(
        language,
        [ENGLISH_FILE, ARABIC_FILE],
        {
          isCompact: true,
        },
      );

      const name: HTMLElement = cell.children[1] as HTMLElement;

      expect(name.tagName).toBe("SPAN");
      expect(name.textContent).toBe(ENGLISH_FILE.name);
      expect(name).toHaveAttribute("dir", "ltr");
      expect(name.getAttribute("class")).toBe(
        `${CUSTOM_FIELD_FILE_COMPACT_NAME_CLASS_NAME} ${LINE_ALIGNED_AS_THE_PAGE_CLASS_NAME}`,
      );
      // The cell keeps the page's way: the clip first, the count last.
      expect(cell).not.toHaveAttribute("dir");
      expect(cell.children).toHaveLength(3);
      // "+1 more", in the reader's digits.
      expect(cell.children[2]!.textContent).toMatch(PLUS_COUNT_PATTERN);
      expect(cell).toHaveAttribute(
        "title",
        `${ENGLISH_FILE.name}\n${ARABIC_FILE.name}`,
      );
    },
  );

  test.each(RIGHT_TO_LEFT_LANGUAGES)(
    "%s: an Arabic name is drawn as it was",
    (language: string) => {
      const cell: HTMLElement = drawList(language, [ARABIC_FILE], {
        isCompact: true,
      });

      const name: HTMLElement = cell.children[1] as HTMLElement;

      expect(name).not.toHaveAttribute("dir");
      expect(name.getAttribute("class")).toBe("truncate");
    },
  );

  test("on an English page an English name has the markup it always had", () => {
    const cell: HTMLElement = drawList("en", [ENGLISH_FILE], {
      isCompact: true,
    });

    const name: HTMLElement = cell.children[1] as HTMLElement;

    expect(name.outerHTML).toBe(
      '<span class="truncate">Q3 vendor contract - Acme Commerce EU West (signed, final).pdf</span>',
    );
  });

  test("on an English page an Arabic name reads right to left", () => {
    const cell: HTMLElement = drawList("en", [ARABIC_FILE], {
      isCompact: true,
    });

    expect(cell.children[1]).toHaveAttribute("dir", "rtl");
  });
});

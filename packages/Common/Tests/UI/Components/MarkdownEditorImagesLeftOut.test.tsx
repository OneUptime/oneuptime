import "@testing-library/jest-dom";
import { afterEach, beforeAll, describe, expect, test } from "@jest/globals";
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
import MarkdownEditor from "../../../UI/Components/Markdown.tsx/MarkdownEditor";
import {
  IMAGE_NOT_UPLOADED_SENTENCE,
  IMAGE_UPLOADING_SENTENCE,
  MARKDOWN_EDITOR_IMAGE_NOT_UPLOADED_TEST_ID,
  MARKDOWN_EDITOR_IMAGES_REFUSED_TEST_ID,
  MAX_IMAGE_SIZE_BYTES,
} from "../../../UI/Components/Markdown.tsx/MarkdownImageUploads";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import { setDateDisplayLanguage } from "../../../Types/DateLanguage";
import { readDashboardLocale } from "../../Helpers/DashboardLocales";
import { isolated, withoutIsolateMarks } from "../../Helpers/IsolateMarks";
import { ADMIN_DASHBOARD_LANGUAGES } from "../../Helpers/TranslatedLanguages";

/*
 * THE MARKDOWN EDITOR REFUSES AN IMAGE BESIDE ITSELF, NEVER IN THE TEXT
 * (issue #10974).
 *
 * An image over 10 MB was refused by writing `[Image "big.png" exceeds the
 * 10MB limit]` into the note at the cursor, and an upload that failed was
 * replaced by `[Upload failed for "shot.png": ...]`. Both were saved with
 * the note, the announcement or the postmortem unless someone deleted
 * them, read English on every page, and were never said to a screen
 * reader. Now the text is left as it was - an upload's placeholder is
 * taken out again when it fails - and a line under the editor says what
 * was left out and why: an alert, in the reader's language, as the file
 * picker beside it says it.
 *
 * Every place draws the one editor: a note's composer, an announcement's,
 * a postmortem's and every other Markdown field (FormField), so these hold
 * them all. The upload is stood in (ModelAPI.create).
 */

const MB: number = 1024 * 1024;
const APPS_DIR: string = path.resolve(__dirname, "../../../../App/FeatureSet");
const NO_BREAK_SPACE: string = " ";
const LATIN_DIGIT: RegExp = /[0-9]/;

const STORAGE_FULL: string =
  "The server is out of storage. Free some space, then try again.";

const instances: Record<string, i18n> = {};

const newInstance: (
  language: string,
  words: Record<string, unknown>,
) => Promise<i18n> = async (
  language: string,
  words: Record<string, unknown>,
): Promise<i18n> => {
  const instance: i18n = createInstance();

  await instance.init({
    lng: language,
    fallbackLng: "en",
    resources: { [language]: { translation: words } },
    interpolation: { escapeValue: false },
    keySeparator: false,
    nsSeparator: false,
  });

  return instance;
};

beforeAll(async () => {
  for (const language of ["en", "de", "fa", "ar", "ja"]) {
    instances[language] = await newInstance(
      language,
      readDashboardLocale(language),
    );
  }

  // The Admin Dashboard draws the editor too (Settings > Email), in its words.
  instances["admin-de"] = await newInstance(
    "de",
    JSON.parse(
      fs.readFileSync(
        path.join(APPS_DIR, "AdminDashboard/src/Locales/de.json"),
        "utf8",
      ),
    ) as Record<string, unknown>,
  );
});

afterEach(() => {
  cleanup();
  setDateDisplayLanguage("en");
  delete (document as unknown as { execCommand?: unknown }).execCommand;
  window.getSelection()?.removeAllRanges();
  jest.restoreAllMocks();
});

type ImageFunction = (name: string, size?: number, type?: string) => File;

// A file of `size` bytes as the browser reports it; jsdom's cannot read itself.
const imageFile: ImageFunction = (
  name: string,
  size: number = 4,
  type: string = "image/png",
): File => {
  const bytes: ArrayBuffer = new ArrayBuffer(4);
  new Uint8Array(bytes).set([137, 80, 78, 71]);
  const file: File = new File([bytes], name, { type });
  Object.defineProperty(file, "size", { value: size });
  Object.defineProperty(file, "arrayBuffer", {
    value: (): Promise<ArrayBuffer> => {
      return Promise.resolve(bytes);
    },
  });
  return file;
};

interface ClipboardStub {
  types: Array<string>;
  items: Array<{ kind: string; type: string; getAsFile: () => File | null }>;
  getData: (format: string) => string;
}

const clipboardWith: (files: Array<File>) => ClipboardStub = (
  files: Array<File>,
): ClipboardStub => {
  return {
    types: ["Files"],
    items: files.map(
      (file: File): { kind: string; type: string; getAsFile: () => File } => {
        return {
          kind: "file",
          type: file.type,
          getAsFile: (): File => {
            return file;
          },
        };
      },
    ),
    getData: (): string => {
      return "";
    },
  };
};

// Lets the upload's awaited steps run.
const flushUploads: () => Promise<void> = async (): Promise<void> => {
  await act(async () => {
    await new Promise((resolve: (value: unknown) => void) => {
      setTimeout(resolve, 0);
    });
  });
};

const editableOf: () => HTMLElement = (): HTMLElement => {
  return document.querySelector('[contenteditable="true"]') as HTMLElement;
};

const switchToMarkdown: () => HTMLTextAreaElement = (): HTMLTextAreaElement => {
  fireEvent.click(screen.getByRole("button", { name: "Markdown" }));
  return screen.getByRole("textbox") as HTMLTextAreaElement;
};

const lastChange: (onChange: jest.Mock) => string = (
  onChange: jest.Mock,
): string => {
  const calls: Array<Array<unknown>> = onChange.mock.calls;
  return String(calls[calls.length - 1]?.[0] ?? "");
};

const allChanges: (onChange: jest.Mock) => Array<string> = (
  onChange: jest.Mock,
): Array<string> => {
  return onChange.mock.calls.map((call: Array<unknown>): string => {
    return String(call[0]);
  });
};

// Puts the caret `offset` characters into the first text node holding `text`.
const placeCaret: (text: string, offset: number) => void = (
  text: string,
  offset: number,
): void => {
  const editable: HTMLElement = editableOf();
  act(() => {
    editable.focus();
  });
  const walker: TreeWalker = document.createTreeWalker(
    editable,
    NodeFilter.SHOW_TEXT,
  );
  let node: Node | null = walker.nextNode();
  while (node && !(node.textContent || "").includes(text)) {
    node = walker.nextNode();
  }
  if (!node) {
    throw new Error(`no text "${text}" in the editor`);
  }
  const range: Range = document.createRange();
  range.setStart(node, (node.textContent || "").indexOf(text) + offset);
  range.collapse(true);
  window.getSelection()?.removeAllRanges();
  window.getSelection()?.addRange(range);
};

const pasteInto: (target: HTMLElement, files: Array<File>) => void = (
  target: HTMLElement,
  files: Array<File>,
): void => {
  fireEvent.paste(target, { clipboardData: clipboardWith(files) });
};

const dropOn: (target: HTMLElement, files: Array<File>) => void = (
  target: HTMLElement,
  files: Array<File>,
): void => {
  fireEvent.drop(target, { dataTransfer: { types: ["Files"], files } });
};

// The line naming what was refused, as a reader sees it.
const refusedLine: () => HTMLElement = (): HTMLElement => {
  return screen.getByTestId(MARKDOWN_EDITOR_IMAGES_REFUSED_TEST_ID);
};

const failedLines: () => Array<HTMLElement> = (): Array<HTMLElement> => {
  return screen.queryAllByTestId(MARKDOWN_EDITOR_IMAGE_NOT_UPLOADED_TEST_ID);
};

const withPlainSpaces: (text: string | null) => string = (
  text: string | null,
): string => {
  return (text || "").split(NO_BREAK_SPACE).join(" ");
};

const inLanguage: (page: string, element: ReactElement) => ReactElement = (
  page: string,
  element: ReactElement,
): ReactElement => {
  setDateDisplayLanguage(page.replace(/^admin-/, ""));
  return <I18nextProvider i18n={instances[page]!}>{element}</I18nextProvider>;
};

// What the editor wrote into the text for a refusal, before #10974.
const OLD_REFUSALS: RegExp = /exceeds the 10MB limit|Upload failed for/;

describe("an image over the limit", () => {
  test("pasted into the visual editor, leaves the text as it was and is named under it, as an alert", async () => {
    const onChange: jest.Mock = jest.fn();
    const create: jest.SpyInstance = jest.spyOn(ModelAPI, "create");
    render(<MarkdownEditor initialValue="Before" onChange={onChange} />);

    pasteInto(editableOf(), [imageFile("big.png", 11 * MB)]);
    await flushUploads();

    expect(onChange).not.toHaveBeenCalled();
    expect(editableOf().innerHTML).toBe("<p>Before</p>");
    expect(create).not.toHaveBeenCalled();

    const alert: HTMLElement = screen.getByRole("alert");
    expect(alert).toBe(refusedLine());
    expect(withPlainSpaces(alert.textContent)).toBe(
      '"big.png" exceeds the 10 MB limit.',
    );
  });

  test("pasted into the markdown source, leaves the source as it was", async () => {
    const onChange: jest.Mock = jest.fn();
    const create: jest.SpyInstance = jest.spyOn(ModelAPI, "create");
    render(<MarkdownEditor initialValue="hello world" onChange={onChange} />);
    const textarea: HTMLTextAreaElement = switchToMarkdown();
    textarea.setSelectionRange(6, 6);

    pasteInto(textarea, [imageFile("big.png", MAX_IMAGE_SIZE_BYTES + 1)]);
    await flushUploads();

    expect(onChange).not.toHaveBeenCalled();
    expect(textarea.value).toBe("hello world");
    expect(create).not.toHaveBeenCalled();
    expect(withPlainSpaces(refusedLine().textContent)).toBe(
      '"big.png" exceeds the 10 MB limit.',
    );
  });

  test("exactly at the limit uploads", async () => {
    const create: jest.SpyInstance = jest
      .spyOn(ModelAPI, "create")
      .mockReturnValue(new Promise<never>(() => {}) as never);
    render(<MarkdownEditor initialValue="" />);

    pasteInto(editableOf(), [imageFile("edge.png", MAX_IMAGE_SIZE_BYTES)]);
    await flushUploads();

    expect(create).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  test("dropped with one that fits: the one that fits uploads, the other is named", async () => {
    const onChange: jest.Mock = jest.fn();
    const create: jest.SpyInstance = jest
      .spyOn(ModelAPI, "create")
      .mockReturnValue(new Promise<never>(() => {}) as never);
    render(<MarkdownEditor initialValue="" onChange={onChange} />);

    dropOn(editableOf(), [
      imageFile("big.png", 12 * MB),
      imageFile("shot.png", 2 * MB),
    ]);
    await flushUploads();

    expect(create).toHaveBeenCalledTimes(1);
    expect(lastChange(onChange)).toMatch(
      /^!\[Uploading shot\.png…\]\(oneuptime-uploading-[0-9a-f-]+\)$/,
    );
    expect(withPlainSpaces(refusedLine().textContent)).toBe(
      '"big.png" exceeds the 10 MB limit.',
    );
  });

  test("several, named in one sentence", async () => {
    jest.spyOn(ModelAPI, "create");
    render(<MarkdownEditor initialValue="" />);

    dropOn(editableOf(), [
      imageFile("a.png", 11 * MB),
      imageFile("b.png", 20 * MB),
    ]);
    await flushUploads();

    expect(withPlainSpaces(refusedLine().textContent)).toBe(
      "These files exceed the 10 MB limit: a.png, b.png.",
    );
  });

  test("the next image that fits clears the line", async () => {
    jest
      .spyOn(ModelAPI, "create")
      .mockReturnValue(new Promise<never>(() => {}) as never);
    render(<MarkdownEditor initialValue="" />);

    pasteInto(editableOf(), [imageFile("big.png", 11 * MB)]);
    await flushUploads();
    expect(refusedLine()).toBeInTheDocument();

    pasteInto(editableOf(), [imageFile("small.png", MB)]);
    await flushUploads();

    expect(
      screen.queryByTestId(MARKDOWN_EDITOR_IMAGES_REFUSED_TEST_ID),
    ).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  test("is never written into the text, by any way in", async () => {
    const onChange: jest.Mock = jest.fn();
    jest.spyOn(ModelAPI, "create");
    render(<MarkdownEditor initialValue="x" onChange={onChange} />);

    pasteInto(editableOf(), [imageFile("a.png", 11 * MB)]);
    dropOn(editableOf(), [imageFile("b.png", 11 * MB)]);
    const input: HTMLInputElement = document.querySelector(
      'input[type="file"]',
    ) as HTMLInputElement;
    fireEvent.change(input, {
      target: { files: [imageFile("c.png", 11 * MB)] },
    });
    const textarea: HTMLTextAreaElement = switchToMarkdown();
    pasteInto(textarea, [imageFile("d.png", 11 * MB)]);
    await flushUploads();

    expect(onChange).not.toHaveBeenCalled();
    expect(textarea.value).toBe("x");
    expect(withPlainSpaces(refusedLine().textContent)).toBe(
      '"d.png" exceeds the 10 MB limit.',
    );
  });
});

describe("a file that is not an image", () => {
  test("dropped, is named as one the field does not take, and nothing uploads", async () => {
    const onChange: jest.Mock = jest.fn();
    const create: jest.SpyInstance = jest.spyOn(ModelAPI, "create");
    render(<MarkdownEditor initialValue="" onChange={onChange} />);

    dropOn(editableOf(), [imageFile("notes.pdf", MB, "application/pdf")]);
    await flushUploads();

    expect(create).not.toHaveBeenCalled();
    expect(onChange).not.toHaveBeenCalled();
    expect(refusedLine()).toHaveTextContent(
      '"notes.pdf" is not a type of file this field takes.',
    );
  });

  test("picked with an image, is named while the image uploads", async () => {
    const create: jest.SpyInstance = jest
      .spyOn(ModelAPI, "create")
      .mockReturnValue(new Promise<never>(() => {}) as never);
    render(<MarkdownEditor initialValue="" />);

    const input: HTMLInputElement = document.querySelector(
      'input[type="file"]',
    ) as HTMLInputElement;
    fireEvent.change(input, {
      target: {
        files: [
          imageFile("shot.png", MB),
          imageFile("dump.zip", 50 * MB, "application/zip"),
        ],
      },
    });
    await flushUploads();

    expect(create).toHaveBeenCalledTimes(1);
    // Named for its kind, never its size: a smaller one would not do either.
    expect(refusedLine()).toHaveTextContent(
      '"dump.zip" is not a type of file this field takes.',
    );
  });
});

describe("an upload that fails", () => {
  test("in the markdown source, takes its placeholder out cleanly and says why", async () => {
    const onChange: jest.Mock = jest.fn();
    let fail: (error: unknown) => void = (): void => {};
    jest.spyOn(ModelAPI, "create").mockReturnValue(
      new Promise<never>((_resolve: unknown, reject: (e: unknown) => void) => {
        fail = reject;
      }) as never,
    );
    render(<MarkdownEditor initialValue="hello world" onChange={onChange} />);
    const textarea: HTMLTextAreaElement = switchToMarkdown();
    textarea.focus();
    textarea.setSelectionRange(6, 6);

    pasteInto(textarea, [imageFile("shot.png", MB)]);
    await flushUploads();

    // While it uploads, its placeholder stands where the cursor was.
    expect(textarea.value).toMatch(
      /^hello !\[Uploading shot\.png…\]\(oneuptime-uploading-[0-9a-f-]+\)world$/,
    );

    await act(async () => {
      fail(new Error(STORAGE_FULL));
    });
    await flushUploads();

    expect(textarea.value).toBe("hello world");
    expect(lastChange(onChange)).toBe("hello world");
    // The cursor is back between the words it was between.
    expect(textarea.selectionStart).toBe(6);
    expect(textarea.selectionEnd).toBe(6);

    const lines: Array<HTMLElement> = failedLines();
    expect(lines).toHaveLength(1);
    expect(lines[0]).toHaveAttribute("role", "alert");
    expect(lines[0]).toHaveTextContent(
      `"shot.png" was not uploaded. ${STORAGE_FULL}`,
    );
    for (const value of allChanges(onChange)) {
      expect(value).not.toMatch(OLD_REFUSALS);
    }
  });

  test("in the visual editor, takes its image out and leaves the words around it as they were", async () => {
    const onChange: jest.Mock = jest.fn();
    jest
      .spyOn(ModelAPI, "create")
      .mockRejectedValue(new Error(STORAGE_FULL) as never);
    render(<MarkdownEditor initialValue="hello world" onChange={onChange} />);
    placeCaret("world", 0);

    pasteInto(editableOf(), [imageFile("shot.png", MB)]);
    await flushUploads();
    await flushUploads();

    expect(editableOf().querySelector("img")).toBeNull();
    expect(lastChange(onChange)).toBe("hello world");
    expect(failedLines()).toHaveLength(1);
    for (const value of allChanges(onChange)) {
      expect(value).not.toMatch(OLD_REFUSALS);
    }
  });

  test("pasted on a line of its own, leaves the visual editor exactly as it was, no empty line behind", async () => {
    const onChange: jest.Mock = jest.fn();
    jest
      .spyOn(ModelAPI, "create")
      .mockRejectedValue(new Error(STORAGE_FULL) as never);
    render(<MarkdownEditor initialValue="Before" onChange={onChange} />);
    expect(editableOf().innerHTML).toBe("<p>Before</p>");

    // No cursor in the editor: the placeholder goes in as a paragraph of its own.
    pasteInto(editableOf(), [imageFile("shot.png", MB)]);
    expect(editableOf().querySelectorAll("p")).toHaveLength(2);
    await flushUploads();
    await flushUploads();

    expect(editableOf().innerHTML).toBe("<p>Before</p>");
    expect(lastChange(onChange)).toBe("Before");
    expect(failedLines()).toHaveLength(1);
  });

  test("keeps an empty line the person had, beside the placeholder's", async () => {
    jest
      .spyOn(ModelAPI, "create")
      .mockRejectedValue(new Error(STORAGE_FULL) as never);
    render(<MarkdownEditor initialValue="Before" />);
    // An empty line as a browser draws one: a paragraph holding a <br>.
    act(() => {
      editableOf().innerHTML = "<p>Before</p><p><br></p>";
    });
    const emptyLine: HTMLElement = editableOf().querySelectorAll(
      "p",
    )[1] as HTMLElement;
    const range: Range = document.createRange();
    range.setStart(emptyLine, 0);
    range.collapse(true);
    act(() => {
      editableOf().focus();
    });
    window.getSelection()?.removeAllRanges();
    window.getSelection()?.addRange(range);

    pasteInto(editableOf(), [imageFile("shot.png", MB)]);
    await flushUploads();
    await flushUploads();

    expect(editableOf().querySelector("img")).toBeNull();
    expect(editableOf().contains(emptyLine)).toBe(true);
  });

  test("after the person switched to the markdown source, still finds its placeholder there", async () => {
    const onChange: jest.Mock = jest.fn();
    let fail: (error: unknown) => void = (): void => {};
    jest.spyOn(ModelAPI, "create").mockReturnValue(
      new Promise<never>((_resolve: unknown, reject: (e: unknown) => void) => {
        fail = reject;
      }) as never,
    );
    render(<MarkdownEditor initialValue="" onChange={onChange} />);

    // Pasted in the visual editor, whose words the source then reads back.
    pasteInto(editableOf(), [imageFile("my_shot.png", MB)]);
    await flushUploads();
    expect(lastChange(onChange)).toMatch(/oneuptime-uploading-/);

    const textarea: HTMLTextAreaElement = switchToMarkdown();
    await act(async () => {
      fail(new Error(STORAGE_FULL));
    });
    await flushUploads();

    expect(textarea.value).toBe("");
    expect(lastChange(onChange)).toBe("");
    expect(failedLines()).toHaveLength(1);
  });

  test("that the server could not explain, says so with its reference's words", async () => {
    jest
      .spyOn(ModelAPI, "create")
      .mockRejectedValue(new HTTPErrorResponse(502, {}, {}) as never);
    render(<MarkdownEditor initialValue="" />);

    pasteInto(editableOf(), [imageFile("shot.png", MB)]);
    await flushUploads();
    await flushUploads();

    const line: HTMLElement = failedLines()[0]!;
    expect(line.textContent).toMatch(/^"shot\.png" was not uploaded\. /);
    // The unexplained failure's own sentence, never a bare status.
    expect(within(line).getByTestId("error-in-sentence")).toBeInTheDocument();
    expect(line.textContent).not.toContain("502");
  });

  test("each failure is said on a line of its own, and the next paste starts afresh", async () => {
    jest
      .spyOn(ModelAPI, "create")
      .mockRejectedValue(new Error(STORAGE_FULL) as never);
    render(<MarkdownEditor initialValue="" />);

    pasteInto(editableOf(), [
      imageFile("a.png", MB),
      imageFile("b.png", MB),
      imageFile("big.png", 11 * MB),
    ]);
    await flushUploads();
    await flushUploads();

    expect(
      failedLines().map((line: HTMLElement): string => {
        return line.textContent || "";
      }),
    ).toEqual([
      `"a.png" was not uploaded. ${STORAGE_FULL}`,
      `"b.png" was not uploaded. ${STORAGE_FULL}`,
    ]);
    expect(screen.getAllByRole("alert")).toHaveLength(3);
    expect(editableOf().querySelector("img")).toBeNull();

    jest
      .spyOn(ModelAPI, "create")
      .mockReturnValue(new Promise<never>(() => {}) as never);
    pasteInto(editableOf(), [imageFile("c.png", MB)]);
    await flushUploads();

    expect(failedLines()).toHaveLength(0);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  test("an upload that works after the person switched views still lands in the text", async () => {
    const onChange: jest.Mock = jest.fn();
    let succeed: (value: unknown) => void = (): void => {};
    jest.spyOn(ModelAPI, "create").mockReturnValue(
      new Promise<unknown>((resolve: (value: unknown) => void) => {
        succeed = resolve;
      }) as never,
    );
    render(<MarkdownEditor initialValue="" onChange={onChange} />);

    pasteInto(editableOf(), [imageFile("my_shot.png", MB)]);
    await flushUploads();
    const textarea: HTMLTextAreaElement = switchToMarkdown();

    await act(async () => {
      succeed({ data: { imageAccessToken: "abc123" } });
    });
    await flushUploads();

    expect(textarea.value).toMatch(
      /^!\[my_shot\.png\]\([^)]*\/image\/access-token\/abc123\)$/,
    );
    expect(failedLines()).toHaveLength(0);
  });
});

describe("in the reader's language", () => {
  test("German: the refusal and the failure, in the Dashboard's words", async () => {
    jest
      .spyOn(ModelAPI, "create")
      .mockRejectedValue(new HTTPErrorResponse(502, {}, {}) as never);
    render(inLanguage("de", <MarkdownEditor initialValue="" />));

    pasteInto(editableOf(), [
      imageFile("big.png", 11 * MB),
      imageFile("shot.png", MB),
    ]);
    await flushUploads();
    await flushUploads();

    expect(
      withPlainSpaces(withoutIsolateMarks(refusedLine().textContent || "")),
    ).toBe('"big.png" überschreitet das Limit von 10 MB.');
    const failure: string = withoutIsolateMarks(
      failedLines()[0]!.textContent || "",
    );
    expect(failure).toMatch(/^"shot\.png" wurde nicht hochgeladen\. /);
    expect(failure).not.toContain("was not uploaded");
  });

  test("German: its placeholder says what uploads in German", async () => {
    const onChange: jest.Mock = jest.fn();
    jest
      .spyOn(ModelAPI, "create")
      .mockReturnValue(new Promise<never>(() => {}) as never);
    render(
      inLanguage("de", <MarkdownEditor initialValue="" onChange={onChange} />),
    );
    const textarea: HTMLTextAreaElement = switchToMarkdown();

    pasteInto(textarea, [imageFile("shot.png", MB)]);
    await flushUploads();

    expect(textarea.value).toMatch(
      /^!\[shot\.png wird hochgeladen…\]\(oneuptime-uploading-[0-9a-f-]+\)$/,
    );
  });

  test("the Admin Dashboard words it as the Dashboard does", async () => {
    jest
      .spyOn(ModelAPI, "create")
      .mockRejectedValue(new Error(STORAGE_FULL) as never);
    render(inLanguage("admin-de", <MarkdownEditor initialValue="" />));

    pasteInto(editableOf(), [
      imageFile("big.png", 11 * MB),
      imageFile("shot.png", MB),
    ]);
    await flushUploads();
    await flushUploads();

    expect(
      withPlainSpaces(withoutIsolateMarks(refusedLine().textContent || "")),
    ).toBe('"big.png" überschreitet das Limit von 10 MB.');
    expect(withoutIsolateMarks(failedLines()[0]!.textContent || "")).toBe(
      `"shot.png" wurde nicht hochgeladen. ${STORAGE_FULL}`,
    );
  });

  test("Japanese: the failure's sentence in Japanese", async () => {
    jest
      .spyOn(ModelAPI, "create")
      .mockRejectedValue(new Error(STORAGE_FULL) as never);
    render(inLanguage("ja", <MarkdownEditor initialValue="" />));

    pasteInto(editableOf(), [imageFile("shot.png", MB)]);
    await flushUploads();
    await flushUploads();

    expect(withoutIsolateMarks(failedLines()[0]!.textContent || "")).toMatch(
      /^「shot\.png」はアップロードされませんでした。/,
    );
  });

  /*
   * On a page read from the right, the name is a value set apart from the
   * words, so "big.png" keeps its ".png" at its end and the sentence its
   * full stop, and the limit is in the reader's digits.
   */
  test.each([
    ["fa", "«big.png» از سقف ۱۰ MB بزرگ‌تر است."],
    ["ar", "يتجاوز «big.png» الحد البالغ 10 MB."],
  ])(
    "%s: the refusal reads right to left, the name set apart",
    async (page: string, words: string) => {
      jest.spyOn(ModelAPI, "create");
      render(inLanguage(page, <MarkdownEditor initialValue="" />));

      pasteInto(editableOf(), [imageFile("big.png", 11 * MB)]);
      await flushUploads();

      const line: string = refusedLine().textContent || "";
      expect(withPlainSpaces(withoutIsolateMarks(line))).toBe(words);
      expect(line).toContain(isolated("big.png"));
      expect(refusedLine()).toHaveAttribute("role", "alert");
    },
  );

  test("fa: the limit in Persian digits, and no Latin digit outside the name", async () => {
    jest.spyOn(ModelAPI, "create");
    render(inLanguage("fa", <MarkdownEditor initialValue="" />));

    pasteInto(editableOf(), [imageFile("big.png", 11 * MB)]);
    await flushUploads();

    const line: string = withoutIsolateMarks(refusedLine().textContent || "");
    expect(line).toContain("۱۰");
    expect(line.replace("big.png", "")).not.toMatch(LATIN_DIGIT);
  });

  test.each([
    ["fa", "«shot.png» بارگذاری نشد."],
    ["ar", "لم يتم رفع «shot.png»."],
  ])(
    "%s: the failure's sentence reads right to left, the name set apart",
    async (page: string, words: string) => {
      jest
        .spyOn(ModelAPI, "create")
        .mockRejectedValue(new Error(STORAGE_FULL) as never);
      render(inLanguage(page, <MarkdownEditor initialValue="" />));

      pasteInto(editableOf(), [imageFile("shot.png", MB)]);
      await flushUploads();
      await flushUploads();

      const line: string = failedLines()[0]!.textContent || "";
      expect(withoutIsolateMarks(line)).toContain(words);
      expect(line).toContain(isolated("shot.png"));
    },
  );
});

/*
 * Every app that draws the editor with uploads on words both sentences in
 * every language it speaks: the Dashboard (its extraction reads Common/UI)
 * and the Admin Dashboard (its own files). A public form's editor uploads
 * nothing (PublicFormFields), so the sign-in pages draw neither.
 */
describe("the words, in every language of every app that uploads from the editor", () => {
  const readAdmin: (language: string) => Record<string, string> = (
    language: string,
  ): Record<string, string> => {
    return JSON.parse(
      fs.readFileSync(
        path.join(APPS_DIR, `AdminDashboard/src/Locales/${language}.json`),
        "utf8",
      ),
    ) as Record<string, string>;
  };

  test.each([...ADMIN_DASHBOARD_LANGUAGES])("%s", (language: string) => {
    for (const words of [readDashboardLocale(language), readAdmin(language)]) {
      for (const key of [
        IMAGE_NOT_UPLOADED_SENTENCE,
        IMAGE_UPLOADING_SENTENCE,
      ]) {
        const value: string = words[key] || "";

        expect({ key, isWorded: value !== "" && value !== key }).toEqual({
          key,
          isWorded: true,
        });
        // The same values, each once: the name, and the error after it.
        expect(value.match(/\{\{\w+\}\}/g)?.sort()).toEqual(
          key.match(/\{\{\w+\}\}/g)?.sort(),
        );
      }

      expect(words[IMAGE_NOT_UPLOADED_SENTENCE]).toMatch(/\{\{error\}\}$/);
      expect(words[IMAGE_UPLOADING_SENTENCE]).toMatch(/…$/);
    }

    // The Admin Dashboard says them as the Dashboard does.
    expect(readAdmin(language)[IMAGE_NOT_UPLOADED_SENTENCE]).toBe(
      readDashboardLocale(language)[IMAGE_NOT_UPLOADED_SENTENCE],
    );
    expect(readAdmin(language)[IMAGE_UPLOADING_SENTENCE]).toBe(
      readDashboardLocale(language)[IMAGE_UPLOADING_SENTENCE],
    );
  });
});

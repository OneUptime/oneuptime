import { describe, expect, test } from "@jest/globals";
import { DEFAULT_MAX_FILE_SIZE_IN_BYTES } from "../../../UI/Components/FilePicker/FilePickerLayout";
import { FilePickerGivenFile } from "../../../UI/Components/FilePicker/FilePickerLeftOut";
import {
  findUploadPlaceholder,
  getImagesRefusedMessage,
  getOffsetAfterRemoval,
  getUploadPlaceholder,
  ImagesChoice,
  IMAGE_NOT_UPLOADED_SENTENCE,
  IMAGE_UPLOADING_SENTENCE,
  MAX_IMAGE_SIZE_BYTES,
  nothingLeftOut,
  removeUploadPlaceholder,
  replaceUploadPlaceholder,
  sortImagesGiven,
  TextWithoutPlaceholder,
} from "../../../UI/Components/Markdown.tsx/MarkdownImageUploads";
import { createTranslator, Translator } from "../../../Types/Translator";
import { fastestRun } from "../../Helpers/FastestRun";
import { SeededRandom, seededRandom } from "../../Helpers/SeededRandom";

/*
 * WHAT THE MARKDOWN EDITOR LEAVES OUT OF THE TEXT, AND THE LINE THAT SAYS
 * SO (issue #10974).
 *
 * The editor wrote its refusals into the person's text, in English:
 * `[Image "big.png" exceeds the 10MB limit]` for an image over its limit,
 * `[Upload failed for "shot.png": ...]` in place of an upload that failed,
 * and both were saved with the note. It sorts what it is given here now,
 * says what it left out in the file picker's words, and takes an upload's
 * placeholder out of the text, as if it had never gone in.
 */

const MB: number = 1024 * 1024;

const ENGLISH: Translator = createTranslator(undefined, "en");

interface GivenFile extends FilePickerGivenFile {
  type: string;
}

const file: (name: string, size: number, type?: string) => GivenFile = (
  name: string,
  size: number,
  type: string = "image/png",
): GivenFile => {
  return { name, size, type };
};

const isImage: (given: GivenFile) => boolean = (given: GivenFile): boolean => {
  return given.type.startsWith("image/");
};

const placeholderOf: (fileName: string, url: string) => string = (
  fileName: string,
  url: string,
): string => {
  return getUploadPlaceholder({
    translator: ENGLISH,
    fileName: fileName,
    placeholderUrl: url,
  });
};

describe("the images the editor is given", () => {
  test("its limit is the one every upload is held to, 10 MB", () => {
    expect(MAX_IMAGE_SIZE_BYTES).toBe(DEFAULT_MAX_FILE_SIZE_IN_BYTES);
    expect(MAX_IMAGE_SIZE_BYTES).toBe(10 * MB);
  });

  test("uploads every image up to the limit, in the order given, and refuses one over it", () => {
    const choice: ImagesChoice<GivenFile> = sortImagesGiven({
      files: [
        file("a.png", 1),
        file("big.png", MAX_IMAGE_SIZE_BYTES + 1),
        file("b.jpg", MAX_IMAGE_SIZE_BYTES, "image/jpeg"),
        file("c.gif", 2 * MB, "image/gif"),
      ],
      isImage: isImage,
    });

    expect(
      choice.toUpload.map((given: GivenFile): string => {
        return given.name;
      }),
    ).toEqual(["a.png", "b.jpg", "c.gif"]);
    expect(choice.refused).toEqual({
      notTaken: [],
      tooLarge: ["big.png"],
      noRoom: [],
      isSeveralForOne: false,
    });
  });

  test("names a file that is not an image as one it does not take, whatever its size", () => {
    const choice: ImagesChoice<GivenFile> = sortImagesGiven({
      files: [
        file("notes.pdf", 1, "application/pdf"),
        file("dump.zip", 50 * MB, "application/zip"),
        file("shot.png", 1),
      ],
      isImage: isImage,
    });

    expect(choice.toUpload).toHaveLength(1);
    expect(choice.refused.notTaken).toEqual(["notes.pdf", "dump.zip"]);
    // A smaller one would not do either: never named as too large.
    expect(choice.refused.tooLarge).toEqual([]);
  });

  test("holds as many images as it is given: nothing is left out for want of room", () => {
    const files: Array<GivenFile> = Array.from(
      { length: 40 },
      (_: unknown, index: number): GivenFile => {
        return file(`shot-${index}.png`, 1);
      },
    );

    const choice: ImagesChoice<GivenFile> = sortImagesGiven({
      files: files,
      isImage: isImage,
    });

    expect(choice.toUpload).toHaveLength(40);
    expect(choice.refused.noRoom).toEqual([]);
    expect(choice.refused.isSeveralForOne).toBe(false);
  });

  test("a limit of its own, when it is given one", () => {
    const choice: ImagesChoice<GivenFile> = sortImagesGiven({
      files: [file("a.png", 2 * MB), file("b.png", 512 * 1024)],
      isImage: isImage,
      maxSizeInBytes: MB,
    });

    expect(choice.refused.tooLarge).toEqual(["a.png"]);
    expect(choice.toUpload).toHaveLength(1);
  });

  test("nothing left out to begin with, a new record each time", () => {
    const first: ReturnType<typeof nothingLeftOut> = nothingLeftOut();

    first.refused.tooLarge.push("big.png");
    first.failed.push({ fileName: "a.png", error: "x" });

    expect(nothingLeftOut()).toEqual({
      refused: {
        notTaken: [],
        tooLarge: [],
        noRoom: [],
        isSeveralForOne: false,
      },
      failed: [],
    });
  });
});

describe("the line that names what was refused", () => {
  test("says nothing when nothing was refused", () => {
    expect(getImagesRefusedMessage(ENGLISH, nothingLeftOut().refused)).toBe("");
  });

  test("names an image over the limit in the file picker's words, the limit a value: never 10MB", () => {
    const message: string = getImagesRefusedMessage(ENGLISH, {
      ...nothingLeftOut().refused,
      tooLarge: ["big.png"],
    });

    expect(message).toBe('"big.png" exceeds the 10 MB limit.');
    expect(message).not.toContain("10MB");
  });

  test("names several in one sentence, and a file of a kind it does not take", () => {
    expect(
      getImagesRefusedMessage(ENGLISH, {
        ...nothingLeftOut().refused,
        notTaken: ["notes.pdf"],
        tooLarge: ["a.png", "b.png"],
      }),
    ).toBe(
      '"notes.pdf" is not a type of file this field takes. These files exceed the 10 MB limit: a.png, b.png.',
    );
  });

  test("its sentences are the file picker's, which every app that draws the editor words", () => {
    // The keys the picker's line is made of: no new words for a refusal.
    expect(
      getImagesRefusedMessage(ENGLISH, {
        ...nothingLeftOut().refused,
        tooLarge: ["big.png"],
      }),
    ).toBe(
      ENGLISH.translateTemplate('"{{fileName}}" exceeds the {{size}} limit.', {
        fileName: "big.png",
        size: "10 MB",
      }),
    );
  });
});

describe("an upload's placeholder", () => {
  test("says what uploads, in the reader's language, with no marks set around the name", () => {
    const german: Translator = createTranslator((key: string): string => {
      return key === IMAGE_UPLOADING_SENTENCE
        ? "{{fileName}} wird hochgeladen…"
        : key;
    }, "de");
    const persian: Translator = createTranslator((key: string): string => {
      return key === IMAGE_UPLOADING_SENTENCE
        ? "در حال بارگذاری {{fileName}}…"
        : key;
    }, "fa");

    expect(placeholderOf("shot.png", "oneuptime-uploading-1")).toBe(
      "![Uploading shot.png…](oneuptime-uploading-1)",
    );
    expect(
      getUploadPlaceholder({
        translator: german,
        fileName: "shot.png",
        placeholderUrl: "oneuptime-uploading-1",
      }),
    ).toBe("![shot.png wird hochgeladen…](oneuptime-uploading-1)");

    /*
     * It is the person's text until the image replaces it: an isolate's
     * marks would be saved with the note if it were saved mid-upload.
     */
    const persianPlaceholder: string = getUploadPlaceholder({
      translator: persian,
      fileName: "shot.png",
      placeholderUrl: "oneuptime-uploading-1",
    });

    expect(persianPlaceholder).toBe(
      "![در حال بارگذاری shot.png…](oneuptime-uploading-1)",
    );
    expect(persianPlaceholder).not.toMatch(/[⁦-⁩]/);
  });

  test("the failed upload's sentence names the image, then why", () => {
    expect(IMAGE_NOT_UPLOADED_SENTENCE).toBe(
      '"{{fileName}}" was not uploaded. {{error}}',
    );
  });

  test("is found by its address, whatever its words became", () => {
    const url: string = "oneuptime-uploading-18f-2a";
    const text: string = `Before ![Uploading my\\_shot.png…](${url}) after`;

    expect(findUploadPlaceholder(text, url)).toEqual({
      start: 7,
      end: 7 + `![Uploading my\\_shot.png…](${url})`.length,
    });
    expect(findUploadPlaceholder(text, "oneuptime-uploading-other")).toBeNull();
    expect(findUploadPlaceholder(text, "")).toBeNull();
    expect(findUploadPlaceholder("no image here", url)).toBeNull();
  });

  test("is replaced by the uploaded image, and nothing else is touched", () => {
    const url: string = "oneuptime-uploading-1";
    const text: string = `a ${placeholderOf("shot.png", url)} b ![other](x.png)`;

    expect(
      replaceUploadPlaceholder({
        text: text,
        placeholderUrl: url,
        replacement: "![shot.png](https://e.com/image/1)",
      }),
    ).toBe("a ![shot.png](https://e.com/image/1) b ![other](x.png)");
    expect(
      replaceUploadPlaceholder({
        text: "no placeholder",
        placeholderUrl: url,
        replacement: "![x](y)",
      }),
    ).toBe("no placeholder");
  });

  test("is taken out cleanly: its own characters, nothing around them", () => {
    const url: string = "oneuptime-uploading-1";
    const placeholder: string = placeholderOf("shot.png", url);
    const removal: TextWithoutPlaceholder = removeUploadPlaceholder(
      `hello ${placeholder}world`,
      url,
    );

    expect(removal).toEqual({
      text: "hello world",
      removedAt: 6,
      removedLength: placeholder.length,
    });
    expect(removeUploadPlaceholder("hello world", url)).toEqual({
      text: "hello world",
      removedAt: -1,
      removedLength: 0,
    });
  });

  /*
   * Wherever the placeholder went in - the start, the end, the middle of a
   * word, between two lines, after another image - taking it out gives back
   * the text exactly as it was.
   */
  test("taken out of a thousand drawn texts, gives back each text as it was", () => {
    const random: SeededRandom = seededRandom(10974);
    const pieces: Array<string> = [
      "a",
      " ",
      "\n",
      "![",
      "](",
      ")",
      "![x](y.png)",
      "**b**",
      "(",
      "]",
      "…",
    ];

    for (let draw: number = 0; draw < 1000; draw++) {
      let before: string = "";
      const length: number = random(30);

      for (let index: number = 0; index < length; index++) {
        before += pieces[random(pieces.length)];
      }

      const at: number = random(before.length + 1);
      const url: string = `oneuptime-uploading-${draw.toString(16)}`;
      const placeholder: string = placeholderOf(`shot-${draw}.png`, url);
      const withPlaceholder: string = `${before.slice(0, at)}${placeholder}${before.slice(at)}`;
      const removal: TextWithoutPlaceholder = removeUploadPlaceholder(
        withPlaceholder,
        url,
      );

      expect({ draw, text: removal.text }).toEqual({ draw, text: before });
      expect({ draw, at: removal.removedAt }).toEqual({ draw, at });
    }
  });

  /*
   * Found with indexOf from its address, never a pattern tried from every
   * "![" in the text: a note full of image openers is read once.
   */
  test("is found quickly in a long text of image openers", () => {
    const LENGTH: number = 400000;
    const url: string = "oneuptime-uploading-1";
    const openers: string = "![](".repeat(LENGTH / 4);
    const text: string = `${openers}${placeholderOf("shot.png", url)}${"![".repeat(LENGTH / 2)}`;

    const timed: { inMs: number } = fastestRun({
      run: (): TextWithoutPlaceholder => {
        return removeUploadPlaceholder(`${text} `, url);
      },
      limitInMs: 2000,
    });

    expect(timed.inMs).toBeLessThan(2000);
    expect(removeUploadPlaceholder(text, url).text).toBe(
      `${openers}${"![".repeat(LENGTH / 2)}`,
    );
  });
});

describe("the cursor once the placeholder is out", () => {
  test.each([
    // [offset, where it stays]
    [0, 0],
    [5, 5],
    [6, 6],
    [10, 6],
    [26, 6],
    [27, 7],
    [40, 20],
  ])("a cursor at %i is at %i", (offset: number, expected: number) => {
    // 20 characters taken out at 6.
    expect(getOffsetAfterRemoval({ offset, removedAt: 6, length: 20 })).toBe(
      expected,
    );
  });

  test("stays where it is when nothing was taken out", () => {
    expect(getOffsetAfterRemoval({ offset: 9, removedAt: -1, length: 0 })).toBe(
      9,
    );
  });
});

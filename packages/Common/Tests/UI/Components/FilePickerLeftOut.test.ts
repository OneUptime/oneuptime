import { describe, expect, test } from "@jest/globals";
import {
  FILE_INVALID_TYPE_CODE,
  FILE_PICKER_NO_ROOM_FOR_FILE,
  FILE_PICKER_NO_ROOM_FOR_FILES,
  FilePickerChoice,
  FilePickerGivenFile,
  FilePickerLeftOut,
  FilePickerRefusedFile,
  getFilePickerLeftOutMessage,
  isNothingLeftOut,
  sortFilePickerChoice,
  TOO_MANY_FILES_CODE,
} from "../../../UI/Components/FilePicker/FilePickerLeftOut";
import { createTranslator, Translator } from "../../../Types/Translator";
import {
  SeededRandom,
  seededRandom,
  shuffled,
} from "../../Helpers/SeededRandom";

/*
 * WHAT A FILE PICKER LEAVES OUT OF A CHOICE, AND THE LINE THAT NAMES IT
 * (issue #8041).
 *
 * A picker of several files added what fit and dropped the rest without a
 * word, and named one reason at a time. It sorts every choice in one place
 * now: what it adds, in the order given, and each file it leaves out with
 * why - of a kind it does not take, over its limit, past its room, several
 * for a picker of one - named once, in one line.
 */

const KB: number = 1024;
const LIMIT: number = 10 * KB;

const ENGLISH: Translator = createTranslator(undefined, "en");

type GivenFunction = (name: string, size?: number) => FilePickerGivenFile;

const given: GivenFunction = (
  name: string,
  size: number = 16,
): FilePickerGivenFile => {
  return { name, size };
};

type RefusedFunction = (
  file: FilePickerGivenFile,
  ...codes: Array<string>
) => FilePickerRefusedFile<FilePickerGivenFile>;

const refused: RefusedFunction = (
  file: FilePickerGivenFile,
  ...codes: Array<string>
): FilePickerRefusedFile<FilePickerGivenFile> => {
  return {
    file,
    errors: codes.map((code: string): { code: string } => {
      return { code };
    }),
  };
};

type NamesFunction = (files: Array<FilePickerGivenFile>) => Array<string>;

const namesOf: NamesFunction = (
  files: Array<FilePickerGivenFile>,
): Array<string> => {
  return files.map((file: FilePickerGivenFile): string => {
    return file.name;
  });
};

const NOTHING: FilePickerLeftOut = {
  notTaken: [],
  tooLarge: [],
  noRoom: [],
  isSeveralForOne: false,
};

describe("what a choice adds", () => {
  test("a picker with no most files adds everything it takes, in the order given", () => {
    const choice: FilePickerChoice<FilePickerGivenFile> = sortFilePickerChoice({
      accepted: [given("c.log"), given("a.log"), given("b.log")],
      refused: [],
      room: null,
      maxFileSizeInBytes: LIMIT,
    });

    expect(namesOf(choice.toAdd)).toEqual(["c.log", "a.log", "b.log"]);
    expect(choice.leftOut).toEqual(NOTHING);
    expect(isNothingLeftOut(choice.leftOut)).toBe(true);
  });

  test("a picker of several adds what fits, and leaves the rest out for want of room, in order", () => {
    const choice: FilePickerChoice<FilePickerGivenFile> = sortFilePickerChoice({
      accepted: ["1", "2", "3", "4", "5"].map((name: string) => {
        return given(`log-${name}.csv`);
      }),
      refused: [],
      room: 3,
      maxFileSizeInBytes: LIMIT,
    });

    expect(namesOf(choice.toAdd)).toEqual([
      "log-1.csv",
      "log-2.csv",
      "log-3.csv",
    ]);
    expect(choice.leftOut).toEqual({
      ...NOTHING,
      noRoom: ["log-4.csv", "log-5.csv"],
    });
    expect(isNothingLeftOut(choice.leftOut)).toBe(false);
  });

  test("a full picker adds nothing, and leaves every file out", () => {
    const choice: FilePickerChoice<FilePickerGivenFile> = sortFilePickerChoice({
      accepted: [given("a.png"), given("b.png")],
      refused: [],
      room: 0,
      maxFileSizeInBytes: LIMIT,
    });

    expect(choice.toAdd).toEqual([]);
    expect(choice.leftOut.noRoom).toEqual(["a.png", "b.png"]);
  });

  test("a room that is no whole number is read as the whole rooms it holds, never fewer than none", () => {
    for (const [room, added] of [
      [-2, 0],
      [0.5, 0],
      [1.9, 1],
      [2, 2],
    ] as Array<[number, number]>) {
      const choice: FilePickerChoice<FilePickerGivenFile> =
        sortFilePickerChoice({
          accepted: [given("a"), given("b"), given("c")],
          refused: [],
          room,
          maxFileSizeInBytes: LIMIT,
        });

      expect({ room, added: choice.toAdd.length }).toEqual({ room, added });
      expect(choice.leftOut.noRoom).toHaveLength(3 - added);
    }
  });

  test("a file it takes over its limit is too large, and takes no room", () => {
    const choice: FilePickerChoice<FilePickerGivenFile> = sortFilePickerChoice({
      accepted: [given("a.png"), given("big.png", LIMIT + 1), given("b.png")],
      refused: [],
      room: 2,
      maxFileSizeInBytes: LIMIT,
    });

    expect(namesOf(choice.toAdd)).toEqual(["a.png", "b.png"]);
    expect(choice.leftOut).toEqual({ ...NOTHING, tooLarge: ["big.png"] });
  });

  test("a file of exactly its limit is taken", () => {
    const choice: FilePickerChoice<FilePickerGivenFile> = sortFilePickerChoice({
      accepted: [given("exact.png", LIMIT)],
      refused: [],
      room: null,
      maxFileSizeInBytes: LIMIT,
    });

    expect(namesOf(choice.toAdd)).toEqual(["exact.png"]);
    expect(isNothingLeftOut(choice.leftOut)).toBe(true);
  });
});

describe("why a refused file was left out", () => {
  test("of a kind it does not take", () => {
    expect(
      sortFilePickerChoice({
        accepted: [],
        refused: [refused(given("setup.exe"), FILE_INVALID_TYPE_CODE)],
        room: null,
        maxFileSizeInBytes: LIMIT,
      }).leftOut,
    ).toEqual({ ...NOTHING, notTaken: ["setup.exe"] });
  });

  test("over its limit", () => {
    expect(
      sortFilePickerChoice({
        accepted: [],
        refused: [refused(given("big.pdf", LIMIT + 1), "file-too-large")],
        room: null,
        maxFileSizeInBytes: LIMIT,
      }).leftOut,
    ).toEqual({ ...NOTHING, tooLarge: ["big.pdf"] });
  });

  // Told it is too large, someone makes it smaller, and has it refused again.
  test("too large and of a kind it does not take: named for its kind", () => {
    expect(
      sortFilePickerChoice({
        accepted: [],
        refused: [
          refused(
            given("big.exe", LIMIT * 3),
            FILE_INVALID_TYPE_CODE,
            "file-too-large",
          ),
        ],
        room: null,
        maxFileSizeInBytes: LIMIT,
      }).leftOut,
    ).toEqual({ ...NOTHING, notTaken: ["big.exe"] });
  });

  test("several for a picker of one, which adds none of them", () => {
    const choice: FilePickerChoice<FilePickerGivenFile> = sortFilePickerChoice({
      accepted: [],
      refused: [
        refused(given("a.png"), TOO_MANY_FILES_CODE),
        refused(given("b.png"), TOO_MANY_FILES_CODE),
      ],
      room: null,
      maxFileSizeInBytes: LIMIT,
    });

    expect(choice.toAdd).toEqual([]);
    expect(choice.leftOut).toEqual({ ...NOTHING, isSeveralForOne: true });
  });

  test("for a reason the picker sets no limit for: still named, never dropped without a word", () => {
    expect(
      sortFilePickerChoice({
        accepted: [],
        refused: [refused(given("empty.txt", 0), "file-too-small")],
        room: null,
        maxFileSizeInBytes: LIMIT,
      }).leftOut,
    ).toEqual({ ...NOTHING, notTaken: ["empty.txt"] });
  });

  test("every reason in one choice, each file named once", () => {
    const choice: FilePickerChoice<FilePickerGivenFile> = sortFilePickerChoice({
      accepted: [given("a.log"), given("b.log"), given("c.log")],
      refused: [
        refused(given("setup.exe"), FILE_INVALID_TYPE_CODE),
        refused(given("capture.pcap", LIMIT * 2), "file-too-large"),
      ],
      room: 1,
      maxFileSizeInBytes: LIMIT,
    });

    expect(namesOf(choice.toAdd)).toEqual(["a.log"]);
    expect(choice.leftOut).toEqual({
      notTaken: ["setup.exe"],
      tooLarge: ["capture.pcap"],
      noRoom: ["b.log", "c.log"],
      isSeveralForOne: false,
    });
  });
});

/*
 * Seeded choices of every shape: files the browser accepted or refused for
 * any mix of reasons, sizes on either side of the limit, any room. Whatever
 * the choice, every file is added or left out - never both, never neither -
 * and the picker adds the files it takes in the order given, as many as
 * fit.
 */
describe("whatever the choice, no file is lost", () => {
  test("each file is added or named once, and the room is spent in order", () => {
    const random: SeededRandom = seededRandom(80410);

    for (let run: number = 0; run < 2000; run++) {
      const maxFileSizeInBytes: number = 1 + random(4 * KB);
      const room: number | null = random(4) === 0 ? null : random(6);
      const accepted: Array<FilePickerGivenFile> = [];
      const refusals: Array<FilePickerRefusedFile<FilePickerGivenFile>> = [];
      const count: number = random(9);

      for (let index: number = 0; index < count; index++) {
        const file: FilePickerGivenFile = given(
          `file-${run}-${index}.bin`,
          random(2 * maxFileSizeInBytes + 1),
        );
        const fate: number = random(5);

        if (fate === 0) {
          refusals.push(refused(file, FILE_INVALID_TYPE_CODE));
        } else if (fate === 1 && file.size > maxFileSizeInBytes) {
          refusals.push(refused(file, "file-too-large"));
        } else if (fate === 2 && file.size <= maxFileSizeInBytes) {
          refusals.push(refused(file, TOO_MANY_FILES_CODE));
        } else {
          accepted.push(file);
        }
      }

      const order: Array<FilePickerGivenFile> = shuffled(accepted, random);
      const choice: FilePickerChoice<FilePickerGivenFile> =
        sortFilePickerChoice({
          accepted: order,
          refused: refusals,
          room,
          maxFileSizeInBytes,
        });

      const everyName: Array<string> = [
        ...namesOf(accepted),
        ...namesOf(
          refusals.map(
            (
              refusal: FilePickerRefusedFile<FilePickerGivenFile>,
            ): FilePickerGivenFile => {
              return refusal.file;
            },
          ),
        ),
      ].sort();
      const severalForOne: Array<string> = refusals
        .filter((refusal: FilePickerRefusedFile<FilePickerGivenFile>) => {
          return refusal.errors[0]?.code === TOO_MANY_FILES_CODE;
        })
        .map((refusal: FilePickerRefusedFile<FilePickerGivenFile>) => {
          return refusal.file.name;
        });
      const accounted: Array<string> = [
        ...namesOf(choice.toAdd),
        ...choice.leftOut.notTaken,
        ...choice.leftOut.tooLarge,
        ...choice.leftOut.noRoom,
        ...severalForOne,
      ].sort();

      expect({ run, accounted }).toEqual({ run, accounted: everyName });
      expect({ run, severalForOne: choice.leftOut.isSeveralForOne }).toEqual({
        run,
        severalForOne: severalForOne.length > 0,
      });

      /*
       * Nothing added over the limit, and as many of the rest as fit, in
       * the order given: the first ones, and the others left out for room.
       */
      const fitting: Array<FilePickerGivenFile> = order.filter(
        (file: FilePickerGivenFile): boolean => {
          return file.size <= maxFileSizeInBytes;
        },
      );

      expect({ run, added: namesOf(choice.toAdd) }).toEqual({
        run,
        added: namesOf(room === null ? fitting : fitting.slice(0, room)),
      });
      expect({ run, noRoom: choice.leftOut.noRoom }).toEqual({
        run,
        noRoom: namesOf(room === null ? [] : fitting.slice(room)),
      });
    }
  });
});

describe("the line that names what a choice left out, in English", () => {
  const LIMITS: { maxFiles: number | null; maxFileSizeInBytes: number } = {
    maxFiles: 3,
    maxFileSizeInBytes: LIMIT,
  };

  test("is empty when nothing was left out, so the next choice clears it", () => {
    expect(getFilePickerLeftOutMessage(ENGLISH, NOTHING, LIMITS)).toBe("");
  });

  test("names one file left out for want of room, with how many the field holds", () => {
    expect(
      getFilePickerLeftOutMessage(
        ENGLISH,
        { ...NOTHING, noRoom: ["log-4.csv"] },
        LIMITS,
      ),
    ).toBe('"log-4.csv" was not added: this field holds up to 3 files.');
  });

  test("names several, why first, in the order given", () => {
    expect(
      getFilePickerLeftOutMessage(
        ENGLISH,
        { ...NOTHING, noRoom: ["log-11.csv", "log-12.csv"] },
        { ...LIMITS, maxFiles: 10 },
      ),
    ).toBe(
      "These files were not added, as this field holds up to 10 files: log-11.csv, log-12.csv.",
    );
  });

  test("says one file for a field of one, in the words for one", () => {
    expect(
      getFilePickerLeftOutMessage(
        ENGLISH,
        { ...NOTHING, noRoom: ["b.png"] },
        { ...LIMITS, maxFiles: 1 },
      ),
    ).toBe('"b.png" was not added: this field holds one file.');
    expect(
      getFilePickerLeftOutMessage(
        ENGLISH,
        { ...NOTHING, noRoom: ["b.png", "c.png"] },
        { ...LIMITS, maxFiles: 1 },
      ),
    ).toBe(
      "These files were not added, as this field holds one file: b.png, c.png.",
    );
  });

  test("says the field's own count, never a number written into its words", () => {
    for (const maxFiles of [2, 3, 7, 10, 21, 100]) {
      expect(
        getFilePickerLeftOutMessage(
          ENGLISH,
          { ...NOTHING, noRoom: ["x.log"] },
          { ...LIMITS, maxFiles },
        ),
      ).toBe(
        `"x.log" was not added: this field holds up to ${maxFiles} files.`,
      );
    }
  });

  test("its plurals keep the count where English names it, and the one forms name none", () => {
    for (const plural of [
      FILE_PICKER_NO_ROOM_FOR_FILE,
      FILE_PICKER_NO_ROOM_FOR_FILES,
    ]) {
      expect(plural.other.split("{{count}}")).toHaveLength(2);
      expect(plural.one).not.toContain("{{count}}");
      expect(`${plural.one} ${plural.other}`).not.toMatch(/[0-9]/);
    }
  });

  test("says every reason in one line, each its own sentence", () => {
    expect(
      getFilePickerLeftOutMessage(
        ENGLISH,
        {
          notTaken: ["setup.exe", "run.sh"],
          tooLarge: ["capture.pcap"],
          noRoom: ["c.log"],
          isSeveralForOne: false,
        },
        LIMITS,
      ),
    ).toBe(
      'These files are not a type this field takes: setup.exe, run.sh. "capture.pcap" exceeds the 10\u00A0KB limit. "c.log" was not added: this field holds up to 3 files.',
    );
  });

  test("names several too large together, with the picker's own limit", () => {
    expect(
      getFilePickerLeftOutMessage(
        ENGLISH,
        { ...NOTHING, tooLarge: ["a.pdf", "b.pdf"] },
        { maxFiles: null, maxFileSizeInBytes: 512 * KB },
      ),
    ).toBe("These files exceed the 512\u00A0KB limit: a.pdf, b.pdf.");
  });

  test("tells a picker of one to take one file at a time, after any file it refused", () => {
    expect(
      getFilePickerLeftOutMessage(
        ENGLISH,
        { ...NOTHING, notTaken: ["c.exe"], isSeveralForOne: true },
        { maxFiles: null, maxFileSizeInBytes: LIMIT },
      ),
    ).toBe(
      '"c.exe" is not a type of file this field takes. Add one file at a time.',
    );
  });

  // A picker with no most files has no room to run out of.
  test("says nothing of room for a picker with no most files", () => {
    expect(
      getFilePickerLeftOutMessage(
        ENGLISH,
        { ...NOTHING, noRoom: ["x.log"] },
        { maxFiles: null, maxFileSizeInBytes: LIMIT },
      ),
    ).toBe("");
  });

  /*
   * Seeded sets of left-out files: the line names every one of them, once,
   * and nothing else.
   */
  test("names every file left out, once, whatever the mix", () => {
    const random: SeededRandom = seededRandom(7423);

    for (let run: number = 0; run < 500; run++) {
      const take: (prefix: string) => Array<string> = (
        prefix: string,
      ): Array<string> => {
        const names: Array<string> = [];
        const count: number = random(4);

        for (let index: number = 0; index < count; index++) {
          names.push(`${prefix}-${run}-${index}.dat`);
        }

        return names;
      };
      const leftOut: FilePickerLeftOut = {
        notTaken: take("kind"),
        tooLarge: take("large"),
        noRoom: take("room"),
        isSeveralForOne: random(2) === 0,
      };
      const line: string = getFilePickerLeftOutMessage(ENGLISH, leftOut, {
        maxFiles: 1 + random(12),
        maxFileSizeInBytes: LIMIT,
      });

      for (const name of [
        ...leftOut.notTaken,
        ...leftOut.tooLarge,
        ...leftOut.noRoom,
      ]) {
        expect({ run, name, times: line.split(name).length - 1 }).toEqual({
          run,
          name,
          times: 1,
        });
      }

      expect({
        run,
        oneAtATime: line.includes("Add one file at a time."),
      }).toEqual({ run, oneAtATime: leftOut.isSeveralForOne });
      expect({ run, empty: line === "" }).toEqual({
        run,
        empty: isNothingLeftOut(leftOut),
      });
    }
  });
});

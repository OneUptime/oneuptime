import { formatFileSizeLimit } from "./FilePickerLayout";
import { joinSentences } from "../../Utils/SentenceSeparator";
import {
  ComposedValue,
  composedValue,
  formatList,
  PluralTemplate,
  Translator,
} from "../../Utils/TranslateTemplate";

/*
 * WHAT A CHOICE OR A DROP LEFT OUT, AND WHY.
 *
 * A file picker takes what it can of the files it is given - a choice in
 * the browser's file chooser or a drop - and leaves out the rest: a file of
 * a kind it does not take, a file over its limit, and, in a picker of
 * several, every file past the room it has left. It names each file it
 * leaves out, with why, in one line under its zone, in the reader's
 * language (getFilePickerLeftOutMessage).
 *
 * It named the first two kinds, but quietly dropped a file it had no room
 * for (issue #8041): someone who chose 12 log files for a field of 10 saw
 * 10 rows and had to compare names to find the two missing, and a public
 * form's submitter could send the form without noticing. It said only one
 * kind at a time, too: a drop with a file too large and one of a kind it
 * does not take named the large one and dropped the other without a word.
 *
 * Pure: the picker sorts what it is given here, and tests read the sorting
 * and its words without a browser.
 */

// A file the picker is given: all the sorting reads of it.
export interface FilePickerGivenFile {
  name: string;
  size: number;
}

/*
 * A file the browser's chooser or the drop refused (react-dropzone's
 * FileRejection): its errors' codes say why.
 */
export interface FilePickerRefusedFile<FileType extends FilePickerGivenFile> {
  file: FileType;
  errors: ReadonlyArray<{ code: string }>;
}

// The codes react-dropzone refuses a file with (its ErrorCode).
export const FILE_INVALID_TYPE_CODE: string = "file-invalid-type";
export const TOO_MANY_FILES_CODE: string = "too-many-files";

// The files a choice left out, each named once, by why.
export interface FilePickerLeftOut {
  // Of a kind the picker does not take: a smaller one would not do either.
  notTaken: Array<string>;
  // Over the picker's limit.
  tooLarge: Array<string>;
  // Past the room a picker of several had left.
  noRoom: Array<string>;
  // Several files given to a picker of one, which then adds none of them.
  isSeveralForOne: boolean;
}

export interface FilePickerChoice<FileType extends FilePickerGivenFile> {
  // What the picker adds, in the order it was given.
  toAdd: Array<FileType>;
  leftOut: FilePickerLeftOut;
}

export interface SortFilePickerChoiceData<
  FileType extends FilePickerGivenFile,
> {
  // What react-dropzone accepted, in the order given.
  accepted: ReadonlyArray<FileType>;
  // What it refused, with why.
  refused: ReadonlyArray<FilePickerRefusedFile<FileType>>;
  // How many more files a picker of several has room for; null for no limit.
  room: number | null;
  // The largest file the picker takes (getMaxFileSizeInBytes).
  maxFileSizeInBytes: number;
}

/*
 * What the picker adds of a choice and what it leaves out. A file of a
 * kind the picker does not take is named as that whatever its size: told
 * it is too large, someone would make it smaller, and have it refused
 * again. A file it takes that is over its limit is too large - the browser
 * refuses those first; this holds whatever slips past. The room a picker of
 * several has left goes to the files it takes, in the order given, and the
 * rest are left out for want of it.
 */
export const sortFilePickerChoice: <FileType extends FilePickerGivenFile>(
  data: SortFilePickerChoiceData<FileType>,
) => FilePickerChoice<FileType> = <FileType extends FilePickerGivenFile>(
  data: SortFilePickerChoiceData<FileType>,
): FilePickerChoice<FileType> => {
  const leftOut: FilePickerLeftOut = {
    notTaken: [],
    tooLarge: [],
    noRoom: [],
    isSeveralForOne: false,
  };

  for (const refusal of data.refused) {
    const codes: Array<string> = refusal.errors.map(
      (error: { code: string }): string => {
        return error.code;
      },
    );

    if (codes.includes(FILE_INVALID_TYPE_CODE)) {
      leftOut.notTaken.push(refusal.file.name);
    } else if (refusal.file.size > data.maxFileSizeInBytes) {
      leftOut.tooLarge.push(refusal.file.name);
    } else if (codes.includes(TOO_MANY_FILES_CODE)) {
      leftOut.isSeveralForOne = true;
    } else {
      /*
       * Refused for a reason the picker sets no limit for today (a file
       * too small, a check of its own): still named, as a file it does not
       * take, never dropped without a word.
       */
      leftOut.notTaken.push(refusal.file.name);
    }
  }

  const taken: Array<FileType> = [];

  for (const file of data.accepted) {
    if (file.size > data.maxFileSizeInBytes) {
      leftOut.tooLarge.push(file.name);
    } else {
      taken.push(file);
    }
  }

  const room: number | null =
    data.room === null ? null : Math.max(0, Math.floor(data.room));
  const toAdd: Array<FileType> = room === null ? taken : taken.slice(0, room);

  for (const file of room === null ? [] : taken.slice(room)) {
    leftOut.noRoom.push(file.name);
  }

  return { toAdd: toAdd, leftOut: leftOut };
};

// Whether a choice left nothing out.
export const isNothingLeftOut: (leftOut: FilePickerLeftOut) => boolean = (
  leftOut: FilePickerLeftOut,
): boolean => {
  return (
    leftOut.notTaken.length === 0 &&
    leftOut.tooLarge.length === 0 &&
    leftOut.noRoom.length === 0 &&
    !leftOut.isSeveralForOne
  );
};

/*
 * A file a picker of several had no room for, named: how many files the
 * field holds is the plural's count, the picker's own most files, so a
 * field of three says three and a field of one says one file.
 */
export const FILE_PICKER_NO_ROOM_FOR_FILE: PluralTemplate = {
  one: '"{{fileName}}" was not added: this field holds one file.',
  other:
    '"{{fileName}}" was not added: this field holds up to {{count}} files.',
};

/*
 * Several files it had no room for: why first, then their names, as the
 * picker names the files it refuses for their kind or their size.
 */
export const FILE_PICKER_NO_ROOM_FOR_FILES: PluralTemplate = {
  one: "These files were not added, as this field holds one file: {{fileNames}}.",
  other:
    "These files were not added, as this field holds up to {{count}} files: {{fileNames}}.",
};

export interface FilePickerLimits {
  // A picker of several: the most files it holds (getFilePickerLayout).
  maxFiles: number | null;
  // The largest file it takes (getMaxFileSizeInBytes).
  maxFileSizeInBytes: number;
}

/*
 * The line the picker shows under its zone for what a choice left out:
 * one sentence for each reason, each naming its files, or nothing when it
 * left nothing out - so a choice that leaves nothing out clears what the
 * last one said.
 *
 * Every name, every limit and every count is a value of its sentence: in
 * the reader's digits, and set apart on a page read from the right, so a
 * name in Latin letters keeps its ".pdf" at its end and the sentence its
 * full stop (setsValuesApart). Several names are listed with the
 * language's own separator ("a.log، b.log" in Persian, formatList), built
 * in the sentence's own language. Drawn on the page only, so its isolate
 * marks never reach a record.
 */
export const getFilePickerLeftOutMessage: (
  translator: Translator,
  leftOut: FilePickerLeftOut,
  limits: FilePickerLimits,
) => string = (
  translator: Translator,
  leftOut: FilePickerLeftOut,
  limits: FilePickerLimits,
): string => {
  const sentences: Array<string> = [];

  // Names listed in the language the sentence is drawn in.
  const namesOf: (names: Array<string>) => ComposedValue = (
    names: Array<string>,
  ): ComposedValue => {
    return composedValue((sentence: Translator): string => {
      return formatList(names, sentence);
    });
  };

  if (leftOut.notTaken.length === 1) {
    sentences.push(
      translator.translateTemplate(
        '"{{fileName}}" is not a type of file this field takes.',
        { fileName: leftOut.notTaken[0] || "" },
        { setsValuesApart: true },
      ),
    );
  } else if (leftOut.notTaken.length > 1) {
    sentences.push(
      translator.translateTemplate(
        "These files are not a type this field takes: {{fileNames}}.",
        { fileNames: namesOf(leftOut.notTaken) },
        { setsValuesApart: true },
      ),
    );
  }

  if (leftOut.tooLarge.length > 0) {
    /*
     * The limit, the everyday 10 MB too, is a value of the sentence: in the
     * reader's digits and set apart, as a file's name is, so a page read
     * from the right draws "۱۰ MB" (issue #7233).
     */
    const size: string = formatFileSizeLimit(limits.maxFileSizeInBytes, {
      language: translator.language,
    });

    sentences.push(
      leftOut.tooLarge.length === 1
        ? translator.translateTemplate(
            '"{{fileName}}" exceeds the {{size}} limit.',
            { fileName: leftOut.tooLarge[0] || "", size: size },
            { setsValuesApart: true },
          )
        : translator.translateTemplate(
            "These files exceed the {{size}} limit: {{fileNames}}.",
            { fileNames: namesOf(leftOut.tooLarge), size: size },
            { setsValuesApart: true },
          ),
    );
  }

  if (leftOut.noRoom.length > 0 && limits.maxFiles !== null) {
    sentences.push(
      leftOut.noRoom.length === 1
        ? translator.translatePlural(
            FILE_PICKER_NO_ROOM_FOR_FILE,
            limits.maxFiles,
            { fileName: leftOut.noRoom[0] || "" },
            { setsValuesApart: true },
          )
        : translator.translatePlural(
            FILE_PICKER_NO_ROOM_FOR_FILES,
            limits.maxFiles,
            { fileNames: namesOf(leftOut.noRoom) },
            { setsValuesApart: true },
          ),
    );
  }

  // Several files on a picker of one, which added none of them.
  if (leftOut.isSeveralForOne) {
    sentences.push(translator.translateText("Add one file at a time.") || "");
  }

  return joinSentences(sentences);
};

import { DEFAULT_MAX_FILE_SIZE_IN_BYTES } from "../FilePicker/FilePickerLayout";
import {
  FilePickerGivenFile,
  FilePickerLeftOut,
  getFilePickerLeftOutMessage,
} from "../FilePicker/FilePickerLeftOut";
import { translationKey, Translator } from "../../Utils/TranslateTemplate";

/*
 * WHAT THE MARKDOWN EDITOR SAYS OF AN IMAGE IT DID NOT PUT IN THE TEXT
 * (issue #10974).
 *
 * The editor uploads an image pasted, dropped or picked into it, and puts
 * it in the text where the cursor is. It refused an image over its limit,
 * and gave up on an upload that failed, by writing English into the
 * person's own text - `[Image "big.png" exceeds the 10MB limit]`, `[Upload
 * failed for "shot.png": ...]` - which was saved with the note, the
 * announcement or the postmortem unless someone spotted it and deleted it,
 * read the same in every language with the limit written into its words,
 * and was never said to a screen reader.
 *
 * Now nothing goes into the text for an image the editor does not keep:
 * an upload's placeholder is taken out again when it fails, and why is
 * said in a line under the editor, in the reader's language, as the file
 * picker beside it says it (FilePickerLeftOut): its sentences, its limit
 * as a value in the reader's digits, its names set apart on a page read
 * from the right. A file that is not an image, dropped or picked, is named
 * too, as the picker names a file of a kind it does not take; it was left
 * out without a word. The next paste, drop or pick says only what it left
 * out, or nothing.
 *
 * Pure: the editor sorts what it is given here, and tests read the sorting
 * and its words without a browser.
 */

/*
 * The largest image the editor uploads: the limit every upload is held to,
 * which the file picker says too.
 */
export const MAX_IMAGE_SIZE_BYTES: number = DEFAULT_MAX_FILE_SIZE_IN_BYTES;

// The line naming what a paste, a drop or a pick left out, and why.
export const MARKDOWN_EDITOR_IMAGES_REFUSED_TEST_ID: string =
  "markdown-editor-images-refused";

// The line saying an image's upload failed, and why.
export const MARKDOWN_EDITOR_IMAGE_NOT_UPLOADED_TEST_ID: string =
  "markdown-editor-image-not-uploaded";

/*
 * An upload that failed: the image is not in the text, and the sentence
 * says which one, then why, in the reader's language (ErrorSentence).
 */
export const IMAGE_NOT_UPLOADED_SENTENCE: string = translationKey(
  '"{{fileName}}" was not uploaded. {{error}}',
);

/*
 * The words an image's placeholder shows in the text while it uploads (its
 * alt text): in the reader's language, as written into the text, with no
 * marks set around the name, since it is the person's text until the image
 * replaces it.
 */
export const IMAGE_UPLOADING_SENTENCE: string = translationKey(
  "Uploading {{fileName}}…",
);

// An image whose upload failed, and why (API.getFriendlyMessage).
export interface FailedImageUpload {
  fileName: string;
  error: string;
}

// What the editor left out of the images it was given, and why.
export interface MarkdownImagesLeftOut {
  // Refused before anything was uploaded: not an image, or over the limit.
  refused: FilePickerLeftOut;
  // Uploaded and failed, in the order they failed: out of the text again.
  failed: Array<FailedImageUpload>;
}

export const nothingLeftOut: () => MarkdownImagesLeftOut =
  (): MarkdownImagesLeftOut => {
    return {
      refused: {
        notTaken: [],
        tooLarge: [],
        noRoom: [],
        isSeveralForOne: false,
      },
      failed: [],
    };
  };

export interface ImagesChoice<FileType extends FilePickerGivenFile> {
  // The images it uploads, in the order given.
  toUpload: Array<FileType>;
  // The files it refused, each named once, by why.
  refused: FilePickerLeftOut;
}

/*
 * What the editor uploads of the files it is given, and what it refuses: a
 * file that is not an image - whatever its size, as a smaller one would not
 * do either - and an image over the limit. The editor holds as many images
 * as it is given, so nothing is left out for want of room.
 */
export const sortImagesGiven: <FileType extends FilePickerGivenFile>(data: {
  files: ReadonlyArray<FileType>;
  isImage: (file: FileType) => boolean;
  maxSizeInBytes?: number | undefined;
}) => ImagesChoice<FileType> = <FileType extends FilePickerGivenFile>(data: {
  files: ReadonlyArray<FileType>;
  isImage: (file: FileType) => boolean;
  maxSizeInBytes?: number | undefined;
}): ImagesChoice<FileType> => {
  const maxSizeInBytes: number = data.maxSizeInBytes ?? MAX_IMAGE_SIZE_BYTES;
  const choice: ImagesChoice<FileType> = {
    toUpload: [],
    refused: nothingLeftOut().refused,
  };

  for (const file of data.files) {
    if (!data.isImage(file)) {
      choice.refused.notTaken.push(file.name);
    } else if (file.size > maxSizeInBytes) {
      choice.refused.tooLarge.push(file.name);
    } else {
      choice.toUpload.push(file);
    }
  }

  return choice;
};

/*
 * The line naming the files refused, in the reader's language: the file
 * picker's own sentences (getFilePickerLeftOutMessage), the limit a value of
 * its sentence - "۱۰ MB" on a Persian page - or nothing when nothing was
 * refused.
 */
export const getImagesRefusedMessage: (
  translator: Translator,
  refused: FilePickerLeftOut,
  maxSizeInBytes?: number | undefined,
) => string = (
  translator: Translator,
  refused: FilePickerLeftOut,
  maxSizeInBytes?: number | undefined,
): string => {
  return getFilePickerLeftOutMessage(translator, refused, {
    maxFiles: null,
    maxFileSizeInBytes: maxSizeInBytes ?? MAX_IMAGE_SIZE_BYTES,
  });
};

/*
 * The markdown that stands in an image's place while it uploads: its words
 * (IMAGE_UPLOADING_SENTENCE, in the reader's language) and an address no
 * other image has, which the editor finds it by again.
 */
export const getUploadPlaceholder: (data: {
  translator: Translator;
  fileName: string;
  placeholderUrl: string;
}) => string = (data: {
  translator: Translator;
  fileName: string;
  placeholderUrl: string;
}): string => {
  const words: string = data.translator.translateTemplate(
    IMAGE_UPLOADING_SENTENCE,
    { fileName: data.fileName },
  );

  return `![${words}](${data.placeholderUrl})`;
};

export interface PlaceholderSpan {
  // Where its "![" starts.
  start: number;
  // Just after its ")".
  end: number;
}

/*
 * Where an upload's placeholder is in the markdown, found by its address,
 * which no other image has: its words may have been written back by the
 * visual editor with a character escaped ("my\_shot.png"), so they are not
 * looked for. Found with indexOf, never a pattern that could read a long
 * text once for each "![" in it.
 */
export const findUploadPlaceholder: (
  text: string,
  placeholderUrl: string,
) => PlaceholderSpan | null = (
  text: string,
  placeholderUrl: string,
): PlaceholderSpan | null => {
  if (!placeholderUrl) {
    return null;
  }

  const tail: string = `](${placeholderUrl})`;
  const tailAt: number = text.indexOf(tail);

  if (tailAt === -1) {
    return null;
  }

  const start: number = text.lastIndexOf("![", tailAt);

  if (start === -1) {
    return null;
  }

  return { start: start, end: tailAt + tail.length };
};

// The markdown with an upload's placeholder replaced: by the uploaded image.
export const replaceUploadPlaceholder: (data: {
  text: string;
  placeholderUrl: string;
  replacement: string;
}) => string = (data: {
  text: string;
  placeholderUrl: string;
  replacement: string;
}): string => {
  const span: PlaceholderSpan | null = findUploadPlaceholder(
    data.text,
    data.placeholderUrl,
  );

  if (!span) {
    return data.text;
  }

  return `${data.text.slice(0, span.start)}${data.replacement}${data.text.slice(span.end)}`;
};

export interface TextWithoutPlaceholder {
  text: string;
  // Where the placeholder started in the text, or -1 when it was not in it.
  removedAt: number;
  // How many characters it took.
  removedLength: number;
}

/*
 * The markdown with an upload's placeholder taken out, as if it had never
 * gone in: the placeholder's own characters, and nothing around them.
 */
export const removeUploadPlaceholder: (
  text: string,
  placeholderUrl: string,
) => TextWithoutPlaceholder = (
  text: string,
  placeholderUrl: string,
): TextWithoutPlaceholder => {
  const span: PlaceholderSpan | null = findUploadPlaceholder(
    text,
    placeholderUrl,
  );

  if (!span) {
    return { text: text, removedAt: -1, removedLength: 0 };
  }

  return {
    text: `${text.slice(0, span.start)}${text.slice(span.end)}`,
    removedAt: span.start,
    removedLength: span.end - span.start,
  };
};

/*
 * Where a cursor at `offset` is once `length` characters at `removedAt` are
 * taken out: moved back by them when it was after them, to where they were
 * when it was inside them, and left where it was before them.
 */
export const getOffsetAfterRemoval: (data: {
  offset: number;
  removedAt: number;
  length: number;
}) => number = (data: {
  offset: number;
  removedAt: number;
  length: number;
}): number => {
  if (data.removedAt < 0 || data.offset <= data.removedAt) {
    return data.offset;
  }

  if (data.offset >= data.removedAt + data.length) {
    return data.offset - data.length;
  }

  return data.removedAt;
};

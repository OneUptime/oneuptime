import ObjectID from "../../../Types/ObjectID";

/*
 * THE SIZES OF STORED FILES THIS PAGE HAS BEEN TOLD, BY FILE ID.
 *
 * A stored file reaches a file picker as a File with its id, its name and
 * its type, never its bytes: a form names the files a field holds, and a
 * form library copies each file down to those three before it hands the
 * value back. So the picker had no size to show for a file it did not
 * upload itself - "PDF" in the Edit dialog, where the card above it said
 * "PDF, 47 KB" - and lost the size of one it did as soon as the form copied
 * it.
 *
 * Whoever knows a stored file's size says so here: a file custom field's
 * value carries each file's size (CustomFieldFile), and an upload knows the
 * size of what it sent. The picker and a form's review step read it back
 * for a file that holds no bytes. A size is a fact about a file that never
 * changes, so one remembered for an id is always right; the page keeps the
 * most recent ones only.
 */

// More files than any page shows; the oldest are let go first.
export const KNOWN_FILE_SIZES_MAX_ENTRIES: number = 2000;

const sizes: Map<string, number> = new Map<string, number>();

type ReadIdFunction = (fileId: unknown) => string | null;

const readId: ReadIdFunction = (fileId: unknown): string | null => {
  const id: string =
    fileId instanceof ObjectID
      ? fileId.toString()
      : typeof fileId === "string"
        ? fileId
        : "";

  return id.trim() ? id.trim().toLowerCase() : null;
};

export type RememberFileSizeFunction = (
  fileId: unknown,
  bytes: unknown,
) => void;

// What a stored file's size is, for whoever lists it without its bytes.
export const rememberFileSize: RememberFileSizeFunction = (
  fileId: unknown,
  bytes: unknown,
): void => {
  const id: string | null = readId(fileId);

  if (
    !id ||
    typeof bytes !== "number" ||
    !Number.isFinite(bytes) ||
    bytes <= 0
  ) {
    return;
  }

  // Most recent last: a file told again moves to the end.
  sizes.delete(id);
  sizes.set(id, Math.floor(bytes));

  while (sizes.size > KNOWN_FILE_SIZES_MAX_ENTRIES) {
    const oldest: string | undefined = sizes.keys().next().value;

    if (oldest === undefined) {
      break;
    }

    sizes.delete(oldest);
  }
};

export type GetKnownFileSizeFunction = (fileId: unknown) => number | null;

// A stored file's size in bytes, when this page has been told it.
export const getKnownFileSize: GetKnownFileSizeFunction = (
  fileId: unknown,
): number | null => {
  const id: string | null = readId(fileId);

  if (!id) {
    return null;
  }

  const size: number | undefined = sizes.get(id);

  return size === undefined ? null : size;
};

// For tests: forget every size.
export const forgetKnownFileSizes: () => void = (): void => {
  sizes.clear();
};

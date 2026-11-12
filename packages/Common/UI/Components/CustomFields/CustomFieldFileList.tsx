import Icon from "../Icon/Icon";
import IsolatedLine from "../IsolatedText/IsolatedLine";
import IsolatedText from "../IsolatedText/IsolatedText";
import {
  CustomFieldFile,
  formatCustomFieldFileSize,
  readCustomFieldFileReference,
  readCustomFieldFiles,
} from "../../../Types/CustomField/CustomFieldFile";
import IconProp from "../../../Types/Icon/IconProp";
import { getFileTypeIcon } from "../../../Types/File/FileTypeIcon";
import { PLACEHOLDER_TEXT_CLASS_NAME } from "../Detail/PlaceholderText";
import { getKnownFileSize } from "../FilePicker/KnownFileSizes";
import { getLineDirection } from "../../Utils/LineDirection";
import { handleAuthenticatedLinkClick } from "../../Utils/OpenAuthenticatedUrl";
import { Translator } from "../../Utils/TranslateTemplate";
import useTranslator from "../../Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * THE FILES A FILE OR MULTIPLE FILES CUSTOM FIELD HOLDS, AS A LIST.
 *
 * One row a file: what kind of file it is, its whole name (wrapped, never
 * cut short) and its size, and - where
 * the reader may download it - the whole row is the download link, opened in
 * a new tab with the session refreshed first (the route authenticates with
 * the session cookie, which lapses with the access token). Where there is no
 * link to give - a form's review step, before the record exists - the row
 * is the file's name only.
 *
 * Compact, for a table cell: the first file's name and how many more there
 * are, every name on hover, never a link (a click on a row opens the record).
 */

export interface ComponentProps {
  files: Array<CustomFieldFile>;
  /*
   * Where a file downloads from: the download route for the record that
   * holds it. Null - or left out - draws the file without a link.
   */
  getDownloadUrl?: ((file: CustomFieldFile) => string | null) | undefined;
  // What to show for a field with no file.
  emptyText?: string | undefined;
  // A table cell's: the first file, and a count of the rest.
  isCompact?: boolean | undefined;
  dataTestId?: string | undefined;
}

/*
 * A file's name in the list: the room between its icon and its size,
 * wrapped where it has to be, never cut short.
 */
export const CUSTOM_FIELD_FILE_NAME_CLASS_NAME: string =
  "min-w-0 flex-1 break-words font-medium text-gray-800 [overflow-wrap:anywhere]";

// A file's size beside its name: never squeezed, its digits all one width.
export const CUSTOM_FIELD_FILE_SIZE_CLASS_NAME: string =
  "shrink-0 text-xs tabular-nums text-gray-500";

/*
 * A name that reads the other way from the page - "Q3 vendor contract
 * (signed).pdf" on an Arabic or Persian page - is a line of its own in that
 * room (IsolatedLine's box for wrapping words): as wide as its words beside
 * the icon, each wrapped line from the name's own start, its brackets and
 * extension where they were typed. Laid out the page's way, a long English
 * name lined up each wrapped line at its end and drew ".pdf" at its start.
 */
export const CUSTOM_FIELD_FILE_NAME_LINE_CLASS_NAME: string =
  "block [overflow-wrap:anywhere]";

// A table cell's first name: one line, cut short at its own end.
export const CUSTOM_FIELD_FILE_COMPACT_NAME_CLASS_NAME: string = "truncate";

type GetFileIconFunction = (fileType: string) => IconProp;

/*
 * A picture, a spreadsheet, an archive, or another document: the icon the
 * file picker draws the same file with (Types/File/FileTypeIcon).
 */
export const getCustomFieldFileIcon: GetFileIconFunction = (
  fileType: string,
): IconProp => {
  return getFileTypeIcon(fileType);
};

export type ReadCustomFieldFileEntriesFunction = (
  value: unknown,
) => Array<CustomFieldFile>;

/**
 * The files a value holds, for showing: a stored value's references, or
 * what a file picker holds - the File models it lists, with their bytes'
 * size when it has them (a form's review step, before anything is saved).
 * Each file once, in order. Never throws.
 */
export const readCustomFieldFileEntries: ReadCustomFieldFileEntriesFunction = (
  value: unknown,
): Array<CustomFieldFile> => {
  const stored: Array<CustomFieldFile> = readCustomFieldFiles(value);

  if (stored.length > 0) {
    return stored;
  }

  const entries: Array<unknown> = Array.isArray(value) ? value : [value];
  const files: Array<CustomFieldFile> = [];

  for (const entry of entries) {
    if (!entry || typeof entry !== "object") {
      continue;
    }

    const record: Record<string, unknown> = entry as Record<string, unknown>;
    const fileId: string | null = readCustomFieldFileReference(entry);
    const name: unknown = record["name"];

    if (!fileId && typeof name !== "string") {
      continue;
    }

    const bytes: unknown = record["file"];

    files.push({
      fileId: fileId || "",
      name: typeof name === "string" && name ? name : fileId || "",
      fileType:
        typeof record["fileType"] === "string" ? record["fileType"] : "",
      // Its bytes' size, or - for a stored file - the size it was stored at.
      size: ArrayBuffer.isView(bytes)
        ? bytes.byteLength
        : getKnownFileSize(fileId) || 0,
    });
  }

  return files;
};

const CustomFieldFileList: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();

  /*
   * No file: the field's own words for that, drawn as a detail card draws
   * an empty value's (PlaceholderText) - "No data entered" read paler than
   * the same words under the text field beside it.
   */
  if (props.files.length === 0) {
    return (
      <span
        className={PLACEHOLDER_TEXT_CLASS_NAME}
        data-testid={props.dataTestId}
      >
        {translator.translateText(props.emptyText || "-") || "-"}
      </span>
    );
  }

  if (props.isCompact) {
    const first: CustomFieldFile = props.files[0]!;
    const more: number = props.files.length - 1;

    return (
      <span
        className="inline-flex min-w-0 max-w-full items-center gap-1.5 text-sm text-gray-700"
        title={props.files
          .map((file: CustomFieldFile): string => {
            return file.name;
          })
          .join("\n")}
        data-testid={props.dataTestId}
      >
        <Icon
          icon={IconProp.PaperClip}
          className="h-3.5 w-3.5 shrink-0 text-gray-400"
        />
        {/*
         * Cut short at its own end (IsolatedLine): an English name on an
         * Arabic page keeps its start ("Q3 vendor contr..."), not its
         * extension.
         */}
        <IsolatedLine
          as="span"
          text={first.name}
          className={CUSTOM_FIELD_FILE_COMPACT_NAME_CLASS_NAME}
        />
        {more > 0 ? (
          <span className="shrink-0 text-xs text-gray-500">
            {translator.translatePlural(
              { one: "+{{count}} more", other: "+{{count}} more" },
              more,
            )}
          </span>
        ) : (
          <></>
        )}
      </span>
    );
  }

  return (
    <ul
      className="flex w-full max-w-xl flex-col gap-1.5"
      aria-label={translator.translatePlural(
        { one: "{{count}} file", other: "{{count}} files" },
        props.files.length,
      )}
      data-testid={props.dataTestId}
    >
      {props.files.map((file: CustomFieldFile): ReactElement => {
        const downloadUrl: string | null = props.getDownloadUrl
          ? props.getDownloadUrl(file)
          : null;
        const size: string = file.size
          ? formatCustomFieldFileSize(file.size)
          : "";

        const content: ReactElement = (
          <>
            <Icon
              icon={getCustomFieldFileIcon(file.fileType)}
              className="h-4 w-4 shrink-0 text-gray-400 group-hover:text-gray-600"
            />
            {/*
             * The whole name, wrapped where it has to be: two files often
             * differ only at the end ("-signed.pdf", "-draft.pdf"), which
             * an ellipsis would hide on a phone.
             */}
            <span className={CUSTOM_FIELD_FILE_NAME_CLASS_NAME}>
              {getLineDirection(file.name, translator.language) ? (
                <IsolatedLine
                  as="span"
                  text={file.name}
                  className={CUSTOM_FIELD_FILE_NAME_LINE_CLASS_NAME}
                />
              ) : (
                file.name
              )}
            </span>
            {/*
             * The size in the reader's digits, reading its own way: "۴۷ KB"
             * with its number first on a page read from the right, where a
             * bare "47 KB" was drawn "KB 47" (issue #7233).
             */}
            {size ? (
              <IsolatedText
                text={size}
                className={CUSTOM_FIELD_FILE_SIZE_CLASS_NAME}
                dataTestId="custom-field-file-size"
              />
            ) : (
              <></>
            )}
            {downloadUrl ? (
              <Icon
                icon={IconProp.Download}
                className="h-4 w-4 shrink-0 text-gray-400 group-hover:text-indigo-600"
              />
            ) : (
              <></>
            )}
          </>
        );

        const rowClassName: string =
          "flex min-w-0 items-center gap-2.5 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm";

        return (
          <li key={file.fileId} className="min-w-0">
            {downloadUrl ? (
              <a
                href={downloadUrl}
                target="_blank"
                rel="noopener noreferrer"
                title={translator.translateTemplate("Download {{name}}", {
                  name: file.name,
                })}
                data-testid="custom-field-file"
                onClick={(event: React.MouseEvent<HTMLAnchorElement>): void => {
                  handleAuthenticatedLinkClick(event, downloadUrl);
                }}
                className={`group ${rowClassName} transition hover:border-gray-300 hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500`}
              >
                {content}
              </a>
            ) : (
              <div className={rowClassName} data-testid="custom-field-file">
                {content}
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
};

export default CustomFieldFileList;

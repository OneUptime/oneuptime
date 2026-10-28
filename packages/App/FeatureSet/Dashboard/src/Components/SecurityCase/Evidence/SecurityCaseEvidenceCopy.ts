import SecurityCaseEvidence from "Common/Models/DatabaseModels/SecurityCaseEvidence";
import URL from "Common/Types/API/URL";
import MimeType from "Common/Types/File/MimeType";
import SecurityCaseEvidenceKind from "Common/Types/SecurityCase/SecurityCaseEvidenceKind";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";

/*
 * Every word a case's Evidence page is drawn with, as English keys the
 * locales translate, the test ids the offline browser suite reads, and the
 * small rules the page follows - where a file downloads from, how a size and
 * a hash read. React-free, so a plain test pins them.
 */
export const SECURITY_CASE_EVIDENCE_COPY: {
  title: string;
  description: string;
  singularName: string;
  pluralName: string;
  addFile: string;
  addLink: string;
  addFileTitle: string;
  addFileDescription: string;
  addLinkTitle: string;
  addLinkDescription: string;
  fileField: string;
  fileFieldDescription: string;
  filePlaceholder: string;
  urlField: string;
  urlFieldDescription: string;
  nameField: string;
  fileNamePlaceholder: string;
  linkNamePlaceholder: string;
  descriptionField: string;
  descriptionPlaceholder: string;
  evidenceColumn: string;
  addedBy: string;
  addedAt: string;
  sha256Label: string;
  sha256Tooltip: string;
  download: string;
  openLink: string;
  copySha256: string;
  emptyTitle: string;
  emptyDescription: string;
  deleteWarning: string;
} = {
  title: translationKey("Evidence"),
  description: translationKey(
    "Files and links kept on this case, each with who added it and when. A file keeps the SHA-256 of what was uploaded, to check a download against.",
  ),
  singularName: translationKey("Evidence"),
  pluralName: translationKey("Evidence"),
  addFile: translationKey("Add File"),
  addLink: translationKey("Add Link"),
  addFileTitle: translationKey("Add a File as Evidence"),
  addFileDescription: translationKey(
    "Upload what shows what happened: a log excerpt, a screenshot, a packet capture.",
  ),
  addLinkTitle: translationKey("Add a Link as Evidence"),
  addLinkDescription: translationKey(
    "Point to evidence kept somewhere else: an EDR console's page, a ticket, your own evidence store.",
  ),
  fileField: translationKey("File"),
  /*
   * The picker under it lists the kinds a file may be and its 10 MB: this
   * says what to do with the rest.
   */
  fileFieldDescription: translationKey(
    "Put any other kind of file, or several files, in a .zip.",
  ),
  // The picker's own words: one file, as "Upload logo" is one logo.
  filePlaceholder: translationKey("Upload a file"),
  urlField: translationKey("Link"),
  urlFieldDescription: translationKey("An http or https address."),
  nameField: translationKey("Name"),
  fileNamePlaceholder: translationKey("The file's own name"),
  linkNamePlaceholder: translationKey("The link itself"),
  descriptionField: translationKey("Description"),
  descriptionPlaceholder: translationKey(
    "What it shows, and where and how it was collected",
  ),
  evidenceColumn: translationKey("Evidence"),
  // Under a piece of evidence: who added it and when.
  addedBy: translationKey("Added by {{name}} {{time}}"),
  addedAt: translationKey("Added {{time}}"),
  // A file's SHA-256, under its name and size.
  sha256Label: translationKey("SHA-256"),
  sha256Tooltip: translationKey(
    "The SHA-256 of the file as it was uploaded. A download whose SHA-256 is the same is what was kept.",
  ),
  download: translationKey("Download"),
  openLink: translationKey("Open Link"),
  copySha256: translationKey("Copy SHA-256"),
  emptyTitle: translationKey("No evidence yet"),
  emptyDescription: translationKey(
    "Keep what shows what happened on the case: logs, screenshots, captures, or links to where they are.",
  ),
  deleteWarning: translationKey(
    "The case's timeline keeps a record of what was removed, and by whom.",
  ),
};

export const SECURITY_CASE_EVIDENCE_TEST_IDS: {
  table: string;
  name: string;
  meta: string;
  sha256: string;
  added: string;
  addFile: string;
  addLink: string;
} = {
  table: "security-case-evidence-table",
  name: "security-case-evidence-name",
  meta: "security-case-evidence-meta",
  sha256: "security-case-evidence-sha256",
  added: "security-case-evidence-added",
  addFile: "security-case-evidence-add-file",
  addLink: "security-case-evidence-add-link",
};

/*
 * The kinds of file evidence takes: every type an upload may be, one entry
 * each. Anything else goes in a .zip.
 */
export const SECURITY_CASE_EVIDENCE_FILE_TYPES: Array<MimeType> = Array.from(
  new Set<MimeType>(Object.values(MimeType)),
);

// Where a piece of evidence's file downloads from, for whoever can read the case.
export function getEvidenceDownloadUrl(data: {
  apiUrl: URL;
  projectId: string;
  evidenceId: string;
}): string {
  return URL.fromURL(data.apiUrl)
    .addRoute("/security-case-evidence/file")
    .addRoute(`/${data.projectId}`)
    .addRoute(`/${data.evidenceId}`)
    .toString();
}

// "a3f9c2d1…7be0": a SHA-256 short enough for a column, its ends kept.
export function shortenSha256(sha256: string | undefined | null): string {
  const value: string = (sha256 || "").trim();

  if (value.length <= 16) {
    return value;
  }

  return `${value.substring(0, 8)}…${value.substring(value.length - 4)}`;
}

// A file's size as people read it: "820 B", "12.4 KB", "3.1 MB".
export function formatEvidenceSize(bytes: number | undefined | null): string {
  if (bytes === undefined || bytes === null || !Number.isFinite(bytes)) {
    return "";
  }

  if (bytes < 1024) {
    return `${bytes} B`;
  }

  const kilobytes: number = bytes / 1024;

  if (kilobytes < 1024) {
    return `${Math.round(kilobytes * 10) / 10} KB`;
  }

  return `${Math.round((kilobytes / 1024) * 10) / 10} MB`;
}

/*
 * The small line under a piece of evidence's name: a file's own name and
 * size, or a link's address - without what the name already says. Evidence
 * added without a name of its own is named after its file or its address,
 * and a line that repeated it said nothing new: then a file says its size
 * alone, and a link nothing more.
 */
export function getEvidenceMeta(data: {
  name?: string | undefined | null;
  isFile: boolean;
  fileName?: string | undefined | null;
  // As formatEvidenceSize writes it; empty when unknown.
  size: string;
  link: string | null;
}): string {
  const name: string = (data.name || "").trim();

  if (data.isFile) {
    const fileName: string = (data.fileName || "").trim();

    return [fileName === name ? "" : fileName, data.size]
      .filter((part: string): boolean => {
        return Boolean(part);
      })
      .join(" · ");
  }

  const link: string = (data.link || "").trim();

  return link === name ? "" : link;
}

// Whether a piece of evidence is a file kept in OneUptime, which downloads.
export function isFileEvidence(
  evidence: Pick<SecurityCaseEvidence, "kind">,
): boolean {
  return evidence.kind === SecurityCaseEvidenceKind.File;
}

// A link's address, when it is one: what opens in a new tab.
export function getEvidenceLink(
  evidence: Pick<SecurityCaseEvidence, "kind" | "url">,
): string | null {
  if (evidence.kind !== SecurityCaseEvidenceKind.Link || !evidence.url) {
    return null;
  }

  const text: string = evidence.url.toString();

  // Read as a browser reads it: only an http or https address opens.
  try {
    const protocol: string = new globalThis.URL(text).protocol;

    return protocol === "https:" || protocol === "http:" ? text : null;
  } catch {
    return null;
  }
}

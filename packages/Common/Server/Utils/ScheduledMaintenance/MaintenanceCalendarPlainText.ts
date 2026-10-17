import Markdown from "../../Types/Markdown";

/*
 * An event's Markdown description as the plain text a calendar app shows.
 *
 * A calendar shows a paragraph, and MaintenanceCalendar cuts the text at
 * 2,000 characters, so a description of megabytes - a pasted log, an inline
 * screenshot - is never read whole: the Markdown is read up to
 * MAINTENANCE_CALENDAR_MAX_MARKDOWN_READ characters, never a character cut
 * in two, and Markdown.convertToPlainText (built for long, awkward text)
 * turns it into text: links read as their words, images as their alt text,
 * code as written.
 */
export const MAINTENANCE_CALENDAR_MAX_MARKDOWN_READ: number = 20000;

export const maintenanceDescriptionToPlainText: (
  markdown: string | null | undefined,
) => string = (markdown: string | null | undefined): string => {
  if (!markdown || typeof markdown !== "string") {
    return "";
  }

  let head: string = markdown.slice(0, MAINTENANCE_CALENDAR_MAX_MARKDOWN_READ);

  // A high surrogate left at the end is half a character.
  const last: number = head.charCodeAt(head.length - 1);

  if (last >= 0xd800 && last <= 0xdbff) {
    head = head.slice(0, -1);
  }

  return Markdown.convertToPlainText(head);
};

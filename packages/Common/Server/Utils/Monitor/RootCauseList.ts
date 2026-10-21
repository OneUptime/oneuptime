/*
 * The numbered list a root cause uses for a per-item breakdown.
 *
 * Two blocks of an incident / alert root cause break a breach down item by
 * item: a platform monitor's "Affected Resources" (see AffectedResourceList)
 * and a metric monitor's "Breaching Samples". Both used to be
 * GitHub-flavoured tables, and a table reads badly everywhere a root cause
 * is shown — it wraps into fragments in the ~416px email card, reaches Slack
 * as raw pipe rows (mrkdwn has no tables), and lets its widest column
 * squeeze the rest on the dashboard. So each item is a numbered list item
 * instead: a title and a value on its first line, and everything else
 * about it as labelled bullets nested underneath.
 *
 *     1. **Pod** `checkout-7d9f` — **3**
 *        - Namespace: `payments`
 *
 *     1. `2026-08-14T10:30:00.000Z` — **1.07 GB**
 *        - `a`: 537 MB
 *        - `k8s.pod.name`: `web-1`
 *
 * A detail with no value is simply left out, where a table had to print
 * "-" in its cell.
 *
 * Plain markdown, deliberately: marked (email), react-markdown (dashboard),
 * slackify-markdown (Slack), the dashboard editor's WYSIWYG converters and
 * Markdown.convertToPlainText all understand a nested list, so nothing
 * downstream needs to know these blocks exist.
 */

import FeedMarkdown, {
  MarkdownText,
  MarkdownValue,
  NumberedListItem,
  isMarkdownText,
  mdText,
} from "../../../Utils/Markdown/FeedMarkdown";

/*
 * Each part is text, placed as text where it lands in the list, or a
 * MarkdownText - written with mdText, or an identifier wrapped with
 * RootCauseList.code() - placed as it is.
 */
export interface RootCauseListDetail {
  // An empty label leaves just the value.
  label: MarkdownValue;
  // An empty value drops the whole detail.
  value: MarkdownValue;
}

export interface RootCauseListItem {
  // What the item is.
  title: MarkdownValue;
  // How bad it is, normally a bold value.
  value: MarkdownValue;
  details: Array<RootCauseListDetail>;
}

type TrimFunction = (part: MarkdownValue) => MarkdownValue;

// A part without the white space around it.
const trim: TrimFunction = (part: MarkdownValue): MarkdownValue => {
  if (isMarkdownText(part)) {
    return part.trim();
  }

  return typeof part === "string" ? part.trim() : part;
};

type IsBlankFunction = (part: MarkdownValue) => boolean;

const isBlank: IsBlankFunction = (part: MarkdownValue): boolean => {
  return part === null || part === undefined || String(part).trim() === "";
};

export default class RootCauseList {
  /*
   * The items as one ordered list, numbered from 1 in the order given
   * (FeedMarkdown.numberedList, which indents each item's details to its
   * content column). The result is just the list: the caller puts its
   * heading above it and any summary below it, each separated from the list
   * by a blank line.
   */
  public static render(items: Array<RootCauseListItem>): MarkdownText {
    return FeedMarkdown.numberedList(
      items.map((item: RootCauseListItem): NumberedListItem => {
        const head: Array<MarkdownValue> = [
          trim(item.title),
          trim(item.value),
        ].filter((part: MarkdownValue): boolean => {
          return !isBlank(part);
        });

        const bullets: Array<MarkdownValue> = [];

        for (const detail of item.details) {
          if (isBlank(detail.value)) {
            continue;
          }

          const value: MarkdownValue = trim(detail.value);

          bullets.push(
            isBlank(detail.label)
              ? value
              : mdText`${trim(detail.label)}: ${value}`,
          );
        }

        return {
          line: FeedMarkdown.join(head, " — "),
          bullets: bullets,
        };
      }),
    );
  }

  /*
   * A value as an inline code span.
   *
   * What goes in here comes from telemetry — resource names, attribute keys
   * and values — and can contain anything. Wrapping a value that contains a
   * backtick in single backticks closes the span early and spills the rest
   * of it — and whatever markdown it contains — into the list. So the fence
   * is always one backtick longer than the longest run inside the value,
   * and padded with a space on each side when the value has any backticks
   * at all (CommonMark strips exactly one from each side, so the padding
   * never shows). Line breaks become spaces: a newline inside a list item
   * would end the item.
   *
   * A value without backticks is a plain single-backtick span, so an ISO
   * timestamp still reaches the dashboard as the bare inline code the
   * MarkdownViewer re-renders in the viewer's timezone.
   *
   * Slack's Markdown conversion passes code through untouched, so a chat
   * mention in a value ("<!channel>", "<@U123>") is broken with an invisible
   * word joiner: it reads as reported, and notifies nobody.
   *
   * The span itself is FeedMarkdown.code, which every other place that shows
   * a reported value as code uses too.
   */
  public static code(value: string | undefined | null): MarkdownText {
    return FeedMarkdown.code(value);
  }
}

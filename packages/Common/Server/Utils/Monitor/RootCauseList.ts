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

export interface RootCauseListDetail {
  /*
   * Markdown, rendered as-is — escape plain text, or wrap an identifier
   * with RootCauseList.code(). An empty label leaves just the value.
   */
  label: string;
  // Markdown, rendered as-is. An empty value drops the whole detail.
  value: string;
}

export interface RootCauseListItem {
  // Markdown, rendered as-is: what the item is.
  title: string;
  // Markdown, rendered as-is: how bad it is, normally a bold value.
  value: string;
  details: Array<RootCauseListDetail>;
}

export default class RootCauseList {
  /*
   * The items as one ordered list, numbered from 1 in the order given. The
   * result is just the list: the caller puts its heading above it and any
   * summary below it, each separated from the list by a blank line.
   */
  public static render(items: Array<RootCauseListItem>): string {
    const lines: Array<string> = [];

    items.forEach((item: RootCauseListItem, index: number): void => {
      const marker: string = `${index + 1}.`;

      /*
       * A nested bullet belongs to its item only when it is indented to
       * the item's content column, which is one past the marker — three
       * spaces under "1.", four under "10.". A fixed three-space indent
       * would push item 10's details out into a separate top-level list.
       */
      const indent: string = " ".repeat(marker.length + 1);

      const head: string = [item.title.trim(), item.value.trim()]
        .filter((part: string): boolean => {
          return part.length > 0;
        })
        .join(" — ");

      lines.push(`${marker} ${head}`);

      for (const detail of item.details) {
        const value: string = detail.value ? detail.value.trim() : "";

        if (value.length === 0) {
          continue;
        }

        const label: string = detail.label ? detail.label.trim() : "";

        lines.push(`${indent}- ${label ? `${label}: ${value}` : value}`);
      }
    });

    return lines.join("\n");
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
   */
  public static code(value: string | undefined | null): string {
    if (value === undefined || value === null) {
      return "";
    }

    const text: string = String(value)
      .replace(/\s*[\r\n]+\s*/g, " ")
      .trim();

    if (text.length === 0) {
      return "";
    }

    const backtickRuns: Array<string> = text.match(/`+/g) || [];

    const longestRun: number = backtickRuns.reduce(
      (longest: number, run: string): number => {
        return Math.max(longest, run.length);
      },
      0,
    );

    if (longestRun === 0) {
      return `\`${text}\``;
    }

    const fence: string = "`".repeat(longestRun + 1);

    return `${fence} ${text} ${fence}`;
  }
}

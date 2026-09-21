import { escapeMarkdownInline } from "../../../Utils/Markdown/MarkdownEscape";

/*
 * The "Affected Resources" block of a platform monitor's root cause.
 *
 * Kubernetes, Proxmox, VMware, Docker Swarm and Ceph monitors each attach a
 * per-resource breakdown to the incident / alert they open, and each one
 * used to render it as a GitHub-flavoured table: up to six columns of long,
 * unbreakable identifiers (pod names, node names, pool paths). That table
 * is read in three places, and it read badly in all of them:
 *
 *   - the email: the DetailBox card leaves roughly 416px for the root
 *     cause, so every cell wrapped mid-identifier and a ten-row table
 *     became a wall of fragments,
 *   - Slack: mrkdwn has no tables, so the incident feed posted the raw
 *     "| … |" pipe rows, and convertMarkdownToSlackRichText unrolled each
 *     row into a "_Row 1_" block of "*Header:* value" lines,
 *   - the dashboard: the widest column decided the layout, and a single
 *     long node name squeezed the rest into two-line cells.
 *
 * So the breakdown is a ranked list instead. Each resource is one numbered
 * item — worst first, the same order the table used — that says what the
 * resource is, names it, and gives its value:
 *
 *     1. **Pod** `checkout-7d9f` — **3**
 *        - Namespace: `payments`
 *        - Deployment: `checkout`
 *        - Node: `gke-prod-pool-1-abcd`
 *
 * and the rest of its identity sits underneath as labelled bullets. A
 * missing attribute is simply left out, where the table had to print "-".
 *
 * Plain markdown, deliberately: marked (email), react-markdown (dashboard),
 * slackify-markdown (Slack), the dashboard editor's WYSIWYG converters and
 * Markdown.convertToPlainText all understand a nested list, so nothing
 * downstream needs to know this block exists.
 */

export interface AffectedResourceListDetail {
  // Plain text. Escaped when rendered.
  label: string;
  // Markdown, rendered as-is. An empty value drops the whole detail.
  value: string;
}

export interface AffectedResourceListEntry {
  // Plain text, e.g. "Pod" or "Virtual Machine". Escaped when rendered.
  kind: string;
  // Markdown, normally built with AffectedResourceList.code().
  name: string;
  // Markdown — the formatted metric value.
  value: string;
  details: Array<AffectedResourceListDetail>;
}

export default class AffectedResourceList {
  // How many resources the list shows before it summarises the rest.
  public static readonly MAX_ENTRIES: number = 10;

  public static render(input: {
    // Plain text, e.g. "Affected Resources".
    heading: string;
    // Plain text, e.g. "affected resources" in "... and 3 more affected resources".
    overflowNoun: string;
    // Every resource that qualified for the list, including those not shown.
    totalCount: number;
    // The resources to show, already sorted worst first.
    entries: Array<AffectedResourceListEntry>;
  }): string {
    const lines: Array<string> = [];

    input.entries.forEach(
      (entry: AffectedResourceListEntry, index: number): void => {
        const marker: string = `${index + 1}.`;

        /*
         * A nested bullet belongs to its item only when it is indented to
         * the item's content column, which is one past the marker — three
         * spaces under "1.", four under "10.". A fixed three-space indent
         * would push item 10's details out into a separate top-level list.
         */
        const indent: string = " ".repeat(marker.length + 1);

        /*
         * The kind is bold so each item's first line stands out from the
         * detail bullets under it — the value at the end of the line is
         * bold too, so the eye lands on what it is and how bad it is.
         */
        const kind: string = escapeMarkdownInline(entry.kind).trim();
        const title: string = [kind ? `**${kind}**` : "", entry.name.trim()]
          .filter((part: string): boolean => {
            return part.length > 0;
          })
          .join(" ");

        lines.push(`${marker} ${title} — ${entry.value}`);

        for (const detail of entry.details) {
          if (!detail.value || detail.value.trim().length === 0) {
            continue;
          }

          lines.push(
            `${indent}- ${escapeMarkdownInline(detail.label)}: ${detail.value}`,
          );
        }
      },
    );

    const hiddenCount: number = input.totalCount - input.entries.length;

    if (hiddenCount > 0) {
      /*
       * The blank line matters: without it the summary is a lazy
       * continuation of the last item's final bullet, not a paragraph of
       * its own.
       */
      lines.push("");
      lines.push(
        `*... and ${hiddenCount} more ${escapeMarkdownInline(input.overflowNoun)}*`,
      );
    }

    return `\n\n**${escapeMarkdownInline(input.heading)}** (${input.totalCount} total)\n\n${lines.join("\n")}`;
  }

  /*
   * A resource identifier as an inline code span.
   *
   * The identifiers come from telemetry attributes, and a VMware VM or a
   * Proxmox guest can be named anything. Wrapping a name that contains a
   * backtick in single backticks closes the span early and spills the rest
   * of the name — and whatever markdown it contains — into the list. So the
   * fence is always one backtick longer than the longest run inside the
   * value, and padded with a space on each side when the value has any
   * backticks at all (CommonMark strips exactly one from each side, so the
   * padding never shows). Line breaks become spaces: a newline inside a
   * list item would end the item.
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

  /*
   * A display name alongside the identifier it abbreviates — a Proxmox
   * guest's name and its `qemu/100` id, a Ceph pool's name and number, a
   * vSphere resource pool's name and inventory path. Either half may be
   * missing; when both are the same only one is shown.
   */
  public static codeWithId(input: {
    name?: string | undefined;
    id?: string | undefined;
  }): string {
    const name: string = AffectedResourceList.code(input.name);
    const id: string = AffectedResourceList.code(input.id);

    if (name && id && name !== id) {
      return `${name} (${id})`;
    }

    return name || id;
  }
}

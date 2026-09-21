import { escapeMarkdownInline } from "../../../Utils/Markdown/MarkdownEscape";
import RootCauseList, {
  RootCauseListDetail,
  RootCauseListItem,
} from "./RootCauseList";

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
 * The list itself is a RootCauseList, the shape the Breaching Samples block
 * of a metric monitor's root cause uses too.
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
    const items: Array<RootCauseListItem> = input.entries.map(
      (entry: AffectedResourceListEntry): RootCauseListItem => {
        /*
         * The kind is bold so each item's first line stands out from the
         * detail bullets under it — the value at the end of the line is
         * bold too, so the eye lands on what it is and how bad it is.
         */
        const kind: string = escapeMarkdownInline(entry.kind).trim();

        return {
          title: [kind ? `**${kind}**` : "", entry.name.trim()]
            .filter((part: string): boolean => {
              return part.length > 0;
            })
            .join(" "),
          value: entry.value,
          details: entry.details.map(
            (detail: AffectedResourceListDetail): RootCauseListDetail => {
              return {
                label: escapeMarkdownInline(detail.label),
                value: detail.value,
              };
            },
          ),
        };
      },
    );

    const lines: Array<string> = [RootCauseList.render(items)];

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
   * A resource identifier as an inline code span. The identifiers come from
   * telemetry attributes, and a VMware VM or a Proxmox guest can be named
   * anything — RootCauseList.code keeps a name with backticks or line breaks
   * inside its span.
   */
  public static code(value: string | undefined | null): string {
    return RootCauseList.code(value);
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

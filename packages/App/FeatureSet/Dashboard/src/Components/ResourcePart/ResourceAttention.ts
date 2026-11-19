import Route from "Common/Types/API/Route";
import IconProp from "Common/Types/Icon/IconProp";

/*
 * WHAT ON A RESOURCE NEEDS SOMEONE NOW, FOR EVERY RESOURCE PRODUCT.
 *
 * A Proxmox cluster, a Kubernetes cluster, a vCenter, a host: each has parts
 * (nodes, guests, pods, VMs, disks) and each part can be fine, need a look,
 * or be broken. A product works out its own rules - a Proxmox guest stopped
 * although it starts on boot, a storage almost full - and hands the result
 * here as items: what the part is, why it needs attention, how bad that is
 * and where its page is. The Overview's Needs attention card, a part's own
 * page and the resource's health pill all read the same list, so they can
 * never disagree about what is wrong.
 *
 * Words are English, written once with translationKey() where a product
 * defines them, and looked up in the reader's language when they are drawn.
 * React-free, so App tests can read it.
 */

export enum ResourceAttentionSeverity {
  // Broken or about to be: an offline node, a guest HA gave up on.
  Critical = "critical",
  // Needs a look soon: a storage filling up, a guest in no backup job.
  Warning = "warning",
}

export type ResourceHealth = "Healthy" | "Degraded" | "Unhealthy";

/*
 * One reason, as an English template and its values ("{{percent}} full",
 * { percent: "91%" }): looked up in the reader's language when drawn. A
 * count-dependent reason ("3 failed syncs") carries its "one" form and the
 * count; `text` is then its general form.
 */
export interface ResourceAttentionText {
  text: string;
  values?: Record<string, string> | undefined;
  plural?: { one: string; count: number } | undefined;
}

/*
 * A fact about the part that a list of what failed shows under its name -
 * its namespace, its owner, the node it ran on - so the reader knows which
 * one it is without opening it. The value is the resource's own and reads
 * as written; the fact links to the value's own page where it has one (the
 * Deployment a pod belongs to).
 */
export interface ResourceAttentionFact {
  key: string;
  // What the fact is, in English, looked up where it is drawn: "Namespace".
  label: string;
  // Its value, as the resource writes it: never translated.
  value: string;
  /*
   * A kind before the value, as the product writes it in every language -
   * "Deployment" in "Deployment checkout".
   */
  valueKind?: string | undefined;
  // The value is a count, written in the reader's digits ("۱۴").
  isCount?: boolean | undefined;
  route?: Route | undefined;
}

/*
 * Something the resource itself reported about the part lately - a
 * Kubernetes warning Event: "BackOff", "Back-off restarting failed
 * container", 12 times, the last 2 minutes ago - in its own words.
 */
export interface ResourceAttentionEvent {
  key: string;
  reason: string;
  message: string;
  // How many times it happened; 1 or less draws no count.
  count: number;
  lastSeenAt?: Date | undefined;
}

/*
 * When what is wrong began, and the sentence that says it: an English
 * template with {{time}} ("Failing since {{time}}", "Failed {{time}}"),
 * looked up where it is drawn, the time relative ("2 hours ago").
 */
export interface ResourceAttentionSince {
  at: Date;
  template: string;
}

export interface ResourceAttentionItem {
  // Unique within the list, stable across reloads (a test id reads it).
  key: string;
  // What the part is, in English: "Node", "Guest", "Storage".
  kind: string;
  /*
   * The kind is a name of the product's own and reads the same in every
   * language - a Kubernetes kind ("Deployment", "StatefulSet") as kubectl
   * and the object's YAML write it - rather than a word to translate.
   */
  kindAsWritten?: boolean | undefined;
  icon: IconProp;
  // The part's own name, as its product writes it.
  name: string;
  // A short identifier under the name ("qemu/104"), not translated.
  detail?: string | undefined;
  severity: ResourceAttentionSeverity;
  reasons: Array<ResourceAttentionText>;
  /*
   * Why, as whole sentences already in the reader's words - what a
   * monitor's criteria found ("Response Status Code was 503, at or above
   * the 500 threshold.") - drawn under its name, before its facts. A
   * reason too long for a chip; never looked up again.
   */
  explanation?: string | undefined;
  /*
   * What the resource itself says about it, as it wrote it - the
   * scheduler's "0/3 nodes are available: 3 Insufficient memory." - drawn
   * under the reasons, two lines at most. Never translated.
   */
  message?: string | undefined;
  /*
   * When the part last reported, for a part that has stopped: drawn under
   * its name as "Last reported 3 hours ago", in the reader's language.
   */
  lastReportAt?: Date | undefined;
  // The part's own page.
  route?: Route | undefined;
  /*
   * What a list of what failed says about each part besides why - which
   * one it is, since when, what the resource reported lately. The Needs
   * attention card leaves them out; a dialog that answers "what failed?"
   * (ResourceAttentionDialog) draws them.
   */
  facts?: Array<ResourceAttentionFact> | undefined;
  since?: ResourceAttentionSince | undefined;
  events?: Array<ResourceAttentionEvent> | undefined;
}

export interface ResourceAttentionCounts {
  critical: number;
  warning: number;
}

const SEVERITY_ORDER: Record<ResourceAttentionSeverity, number> = {
  [ResourceAttentionSeverity.Critical]: 0,
  [ResourceAttentionSeverity.Warning]: 1,
};

/*
 * Most urgent first: critical before warning; within a severity, the kinds
 * in the order the product names them (a cluster's nodes before its
 * guests), then by name as people read numbers in names (web-2 before
 * web-10).
 */
export function sortResourceAttention(
  items: Array<ResourceAttentionItem>,
  kindOrder: Array<string> = [],
): Array<ResourceAttentionItem> {
  const kindRank: (kind: string) => number = (kind: string): number => {
    const index: number = kindOrder.indexOf(kind);
    return index === -1 ? kindOrder.length : index;
  };

  return [...items].sort(
    (a: ResourceAttentionItem, b: ResourceAttentionItem): number => {
      const severity: number =
        SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity];
      if (severity !== 0) {
        return severity;
      }
      const kind: number = kindRank(a.kind) - kindRank(b.kind);
      if (kind !== 0) {
        return kind;
      }
      return a.name.localeCompare(b.name, undefined, {
        numeric: true,
        sensitivity: "base",
      });
    },
  );
}

export function countResourceAttention(
  items: Array<ResourceAttentionItem>,
): ResourceAttentionCounts {
  let critical: number = 0;
  let warning: number = 0;
  for (const item of items) {
    if (item.severity === ResourceAttentionSeverity.Critical) {
      critical++;
    } else {
      warning++;
    }
  }
  return { critical: critical, warning: warning };
}

/*
 * The resource's health from what needs attention on it: anything critical
 * makes it Unhealthy, anything else Degraded, nothing Healthy.
 */
export function getResourceAttentionHealth(
  items: Array<ResourceAttentionItem>,
): ResourceHealth {
  const counts: ResourceAttentionCounts = countResourceAttention(items);
  if (counts.critical > 0) {
    return "Unhealthy";
  }
  if (counts.warning > 0) {
    return "Degraded";
  }
  return "Healthy";
}

/*
 * One item from several of a part's findings: the worst severity, every
 * reason in turn.
 */
export function mergeResourceAttentionSeverity(
  severities: Array<ResourceAttentionSeverity>,
): ResourceAttentionSeverity | null {
  if (severities.length === 0) {
    return null;
  }
  return severities.includes(ResourceAttentionSeverity.Critical)
    ? ResourceAttentionSeverity.Critical
    : ResourceAttentionSeverity.Warning;
}

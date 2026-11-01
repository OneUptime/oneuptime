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

export interface ResourceAttentionItem {
  // Unique within the list, stable across reloads (a test id reads it).
  key: string;
  // What the part is, in English: "Node", "Guest", "Storage".
  kind: string;
  icon: IconProp;
  // The part's own name, as its product writes it.
  name: string;
  // A short identifier under the name ("qemu/104"), not translated.
  detail?: string | undefined;
  severity: ResourceAttentionSeverity;
  reasons: Array<ResourceAttentionText>;
  // The part's own page.
  route?: Route | undefined;
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

import IconProp from "Common/Types/Icon/IconProp";
import {
  ResourceAttentionCurrent,
  ResourceAttentionItem,
} from "./ResourceAttention";
import type { ResourceAttentionDialogProps } from "./ResourceAttentionDialogProps";

/*
 * The words and looks a part's page is built from - its status, its badges,
 * its chips - for every resource product. React-free, so a product's own
 * rules (Pages/Proxmox/Utils/ProxmoxPartFacts) can say what a part shows and
 * App tests can read them; ResourcePartHero draws them.
 */

export type ResourcePartTone = "positive" | "warning" | "danger" | "neutral";

export interface ResourcePartStatus {
  // "Online", "Running", "Stopped", "Unavailable" - English.
  label: string;
  /*
   * The label's values when it is a template ("{{ready}} of {{desired}}
   * ready"). A template with no words of its own ("{{reason}}") reads as
   * its values in every language: a Kubernetes reason as Kubernetes writes
   * it.
   */
  values?: Record<string, string> | undefined;
  tone: ResourcePartTone;
  /*
   * What the status means, in a sentence a screen reader hears after the
   * word and a pointer sees on hover. English.
   */
  description?: string | undefined;
}

export interface ResourcePartBadge {
  key: string;
  // English, or a template with values ("HA: {{state}}").
  label: string;
  values?: Record<string, string> | undefined;
  tone: ResourcePartTone;
}

export interface ResourcePartChip {
  key: string;
  icon: IconProp;
  // Already in the reader's language (a count or a size is built per chip).
  label: string;
  /*
   * A count of something wrong ("3 pods failed"): pressed, it opens exactly
   * what it counts and why (ResourceAttentionPill), where a plain chip only
   * said how many.
   */
  attention?: ResourcePartChipAttention | undefined;
}

/*
 * What a chip that counts something wrong opens, and how bad it is: the
 * pill's tone, what a press shows (English, "Show which pods and why") and
 * the dialog (ResourceAttentionDialog), its items or the read that fetches
 * them when it opens.
 */
export interface ResourcePartChipAttention {
  tone: ResourcePartTone;
  hint: string;
  dialog: Omit<ResourceAttentionDialogProps, "onClose" | "testId">;
  // The pill's test id; the hero's `${testId}-chip-${key}` when left out.
  testId?: string | undefined;
}

/*
 * What needs attention on a part and what it runs - the list its Overview's
 * Needs attention card draws, its own row named as the card names it ("This
 * node"). A status that says something is wrong opens it, so the hero's
 * "Offline" or "CrashLoopBackOff" says why where it is read (#9594).
 */
export interface ResourcePartAttention {
  items: Array<ResourceAttentionItem>;
  // What the list is, in English: the card's description.
  description?: string | undefined;
  current?: ResourceAttentionCurrent | undefined;
  // False when every row is the same kind of part.
  showKind?: boolean | undefined;
}

// A Kubernetes part takes violet, as its cluster's own hero does.
export type ResourcePartAccent =
  | "orange"
  | "indigo"
  | "sky"
  | "emerald"
  | "violet";

import {
  PluralTemplate,
  Translator,
  translationKey,
} from "Common/UI/Utils/TranslateTemplate";
import { ComponentProps as ResourceAttentionPillProps } from "../ResourcePart/ResourceAttentionPill";
import {
  ResourceAttentionItem,
  getResourceAttentionTone,
} from "../ResourcePart/ResourceAttention";
import { ResourcePartTone } from "../ResourcePart/ResourcePartTypes";
import { XcpNgProblem } from "../../Pages/XcpNg/Utils/XcpNgHealth";

/*
 * WHAT EACH COUNT OF WHAT IS WRONG ON AN XCP-NG POOL'S OVERVIEW OPENS.
 *
 * "1 offline" after the hosts chip, "2 stopped" after the VMs', "1 nearly
 * full" after the storage repositories' - and the same under the tiles:
 * pressed, each opens exactly the parts it counts, why, where each one is
 * and since when (ResourceAttentionDialog, #9594), the items worked out by
 * the pool's rules (XcpNgHealth.getXcpNgProblemItems). No pill while
 * nothing is wrong.
 *
 * A disabled host is someone's choice - maintenance mode - so its count is
 * grey, never red (Docs/ux/README.md#side-menus); it still opens which
 * hosts, as a count must.
 */

interface ProblemWords {
  // The pill: a count and its word, after the chip it qualifies.
  label: PluralTemplate;
  // Whole sentences, English, looked up where drawn.
  title: PluralTemplate;
  hint: string;
  description: string;
  emptyMessage: string;
  // Grey for a choice; else the tone of what it lists.
  tone?: ResourcePartTone | undefined;
}

export const XCP_NG_PROBLEM_WORDS: Record<XcpNgProblem["kind"], ProblemWords> =
  {
    hostsOffline: {
      label: { one: "{{count}} offline", other: "{{count}} offline" },
      title: {
        one: "{{count}} host is offline",
        other: "{{count}} hosts are offline",
      },
      hint: translationKey("Show which hosts and why"),
      description: translationKey(
        "Hosts Xen Orchestra reports Halted, or whose state the pool cannot tell. Their VMs are down with them, or may be.",
      ),
      emptyMessage: translationKey("Every host is running now."),
    },
    hostsDisabled: {
      label: { one: "{{count}} disabled", other: "{{count}} disabled" },
      title: {
        one: "{{count}} host is disabled",
        other: "{{count}} hosts are disabled",
      },
      hint: translationKey("Show which hosts"),
      description: translationKey(
        "Hosts in maintenance mode or being evacuated: XAPI starts no VM on them until they are enabled again.",
      ),
      emptyMessage: translationKey("No host is disabled now."),
      tone: "neutral",
    },
    vmsStopped: {
      label: { one: "{{count}} stopped", other: "{{count}} stopped" },
      title: {
        one: "{{count}} VM stopped after running",
        other: "{{count}} VMs stopped after running",
      },
      hint: translationKey("Show which VMs and why"),
      description: translationKey(
        "VMs halted or paused although they ran in the last 24 hours. A VM someone shut down on purpose leaves this list a day after it stopped; a suspended VM is never in it.",
      ),
      emptyMessage: translationKey(
        "No VM stopped after running in the last 24 hours.",
      ),
    },
    storageFull: {
      label: { one: "{{count}} nearly full", other: "{{count}} nearly full" },
      title: {
        one: "{{count}} storage repository is nearly full",
        other: "{{count}} storage repositories are nearly full",
      },
      hint: translationKey("Show which storage repositories"),
      description: translationKey(
        "Storage repositories more than 90% full. When one fills, VMs with disks on it stop writing, and snapshots fail.",
      ),
      emptyMessage: translationKey("No storage repository is nearly full now."),
    },
    storageOverAllocated: {
      label: {
        one: "{{count}} over-provisioned",
        other: "{{count}} over-provisioned",
      },
      title: {
        one: "{{count}} storage repository is over-provisioned",
        other: "{{count}} storage repositories are over-provisioned",
      },
      hint: translationKey("Show which storage repositories"),
      description: translationKey(
        "Storage repositories whose disks are allocated past their size. Thin-provisioned disks can fill them as they grow.",
      ),
      emptyMessage: translationKey(
        "No storage repository is allocated past its size now.",
      ),
    },
  };

/*
 * The pill after a count, or none while nothing it counts is wrong: its
 * words in the reader's language, its tone (grey for a disabled host, red
 * while any part it lists is broken, else amber) and the dialog it opens.
 */
export function getXcpNgProblemPill(data: {
  problem: XcpNgProblem;
  items: Array<ResourceAttentionItem>;
  translator: Translator;
  testId: string;
}): ResourceAttentionPillProps | undefined {
  if (data.items.length === 0) {
    return undefined;
  }
  const words: ProblemWords = XCP_NG_PROBLEM_WORDS[data.problem.kind];
  return {
    testId: data.testId,
    label: data.translator.translatePlural(words.label, data.items.length),
    tone: words.tone || getResourceAttentionTone(data.items),
    hint: words.hint,
    dialog: {
      title: data.translator.translatePlural(words.title, data.items.length),
      description: words.description,
      items: data.items,
      emptyMessage: words.emptyMessage,
      // Every row is the same kind of part.
      showKind: false,
    },
  };
}

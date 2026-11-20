import { PluralTemplate } from "Common/UI/Utils/TranslateTemplate";
import {
  ResourceAttentionCurrent,
  ResourceAttentionItem,
} from "./ResourceAttention";

/*
 * What the dialog a count or a health pill opens (ResourceAttentionDialog)
 * is handed: the parts, or the read that fetches them when it opens.
 * React-free, so ResourcePartTypes and a page's reads can name them and
 * App's tests can still reach those: App has no react
 * (Tests/FeatureSetImportsStayReactFree.test.ts). ResourceAttentionDialog
 * re-exports both.
 */

export interface ResourceAttentionDialogRead {
  items: Array<ResourceAttentionItem>;
  // More matched than one read lists: the most urgent are shown.
  isTruncated?: boolean | undefined;
}

export interface ResourceAttentionDialogProps {
  /*
   * In the reader's words already, a count in it: "3 failed pods". A page
   * builds it with translatePlural, so it is never looked up again.
   */
  title: string;
  // What the list is, in English - one fixed sentence, looked up here.
  description?: string | undefined;
  // The parts, when the page holds them; else `load` reads them on open.
  items?: Array<ResourceAttentionItem> | undefined;
  /*
   * With `items`: more matched than the page holds, so the list says it
   * shows the first of them (as a read that says so does).
   */
  isTruncated?: boolean | undefined;
  /*
   * What a list cut short says under it, in English, with the count shown:
   * the first of them, the most urgent first, unless the list is in another
   * order and says its own (the newest first).
   */
  truncatedMessage?: PluralTemplate | undefined;
  load?: (() => Promise<ResourceAttentionDialogRead>) | undefined;
  // What it says when nothing matches any more, in English.
  emptyMessage: string;
  // What failed while reading, in English: "Couldn't read the failed pods."
  whatFailed?: string | undefined;
  // Prefix of its test ids.
  testId: string;
  onClose: () => void;
  // False when every row is the same kind of part (a list of pods).
  showKind?: boolean | undefined;
  /*
   * The part whose page this is, when the list is about it and what it
   * runs (its hero's status, pressed): its row reads "This node", as in
   * its Needs attention card, with no View - that is the page the reader
   * is on.
   */
  current?: ResourceAttentionCurrent | undefined;
}

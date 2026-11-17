import { translationKey } from "../../Types/Translator";
import { ReactNode } from "react";

/*
 * A SHORT WORD THAT SOMETHING HAPPENED, WITHOUT BLOCKING THE PAGE (#9120).
 *
 * "Changes saved", "Nightly Backup deleted", "Couldn't pin Logs.": a card in
 * the corner of the page (ToastRegion, Common/UI/Components/Toast) that the
 * reader does not have to click away. Before it there was nothing - a card's
 * edit closed and the page read again, a row disappeared - or a dialog that
 * said "Saved" with a Got it button over whatever the person was doing.
 *
 * - A success or a note goes by itself after a few seconds, and stays while
 *   the pointer or the focus is on it. One with an action (Undo, View)
 *   stays longer, so there is time to reach it.
 * - An error stays until it is dismissed: the reader has to see it to know
 *   that what they did did not happen.
 * - A few at a time. A new one past the limit takes the place of the oldest
 *   that is not an error; the same words twice in a row are one toast,
 *   shown again.
 *
 * The words are the caller's, in the reader's language already: a toast is
 * shown once, as it happens, so the sentence is looked up where it is
 * written (`translator.translateText("Changes saved")`), which is also where
 * the i18n extractor finds it. The card draws them as given.
 *
 * React-free on purpose: a model component, a utility or a test calls
 * Toast.success() without a hook, and the region of the app's root draws
 * what is here. With no region mounted (a unit test), a toast is kept and
 * drawn by nobody.
 */

/*
 * What the shared model components say after a change (#9120), in English:
 * looked up where they are shown.
 */
// A card's or a row's edit, saved.
export const CHANGES_SAVED: string = translationKey("Changes saved");
// A record a list created: its name, or its kind when it has none.
export const ITEM_CREATED: string = translationKey("{{itemName}} created");

/*
 * A list whose create button has a verb of its own says it in the past:
 * "Add Member" adds, it does not create. A verb not listed says "created".
 */
const ITEM_CREATED_BY_VERB: Record<string, string> = {
  Add: translationKey("{{itemName}} added"),
  "Add to Team": translationKey("{{itemName}} added"),
  Attach: translationKey("{{itemName}} attached"),
  Connect: translationKey("{{itemName}} connected"),
  Declare: translationKey("{{itemName}} declared"),
  Invite: translationKey("{{itemName}} invited"),
  Link: translationKey("{{itemName}} linked"),
  Start: translationKey("{{itemName}} started"),
};

export const getItemCreatedTemplate: (
  createVerb: string | undefined,
) => string = (createVerb: string | undefined): string => {
  const verb: string = createVerb?.trim() || "";

  return Object.prototype.hasOwnProperty.call(ITEM_CREATED_BY_VERB, verb)
    ? ITEM_CREATED_BY_VERB[verb]!
    : ITEM_CREATED;
};
// A record deleted from its list or its own page.
export const ITEM_DELETED: string = translationKey("{{itemName}} deleted");
/*
 * A row a list takes away without deleting what it points at - Remove,
 * Unlink, Disconnect, Reject (a table's own word for its delete).
 */
export const ITEM_REMOVED: string = translationKey("{{itemName}} removed");

export enum ToastType {
  Success = "success",
  Error = "error",
  Info = "info",
}

export interface ToastAction {
  // In the reader's words already ("Undo", "View").
  title: string;
  onClick: () => void;
}

export interface ToastOptions {
  /*
   * A second line under the title: why it failed (ErrorLine), or what
   * happens next. Drawn as given.
   */
  description?: ReactNode | undefined;
  // One button in the toast: Undo, View. Choosing it closes the toast.
  action?: ToastAction | undefined;
  /*
   * How long it stays, in milliseconds. Null keeps it until it is
   * dismissed. Defaults by type (getDefaultDurationInMs).
   */
  durationInMs?: number | null | undefined;
  dataTestId?: string | undefined;
}

export interface ToastItem {
  id: string;
  type: ToastType;
  title: string;
  description?: ReactNode | undefined;
  action?: ToastAction | undefined;
  durationInMs: number | null;
  /*
   * Bumped when the same toast is shown again, so the card starts its
   * time again.
   */
  revision: number;
  dataTestId?: string | undefined;
}

export type ToastListener = (toasts: ReadonlyArray<ToastItem>) => void;

// How many toasts are on the page at once.
export const MAX_TOASTS: number = 4;

export const SUCCESS_DURATION_IN_MS: number = 5000;
export const INFO_DURATION_IN_MS: number = 6000;
// A second line to read: what went out and where to look for it.
export const DESCRIPTION_DURATION_IN_MS: number = 8000;
// Long enough to read the toast and reach its button.
export const ACTION_DURATION_IN_MS: number = 10000;

export const getDefaultDurationInMs: (data: {
  type: ToastType;
  hasAction: boolean;
  hasDescription?: boolean | undefined;
}) => number | null = (data: {
  type: ToastType;
  hasAction: boolean;
  hasDescription?: boolean | undefined;
}): number | null => {
  if (data.type === ToastType.Error) {
    return null;
  }

  if (data.hasAction) {
    return ACTION_DURATION_IN_MS;
  }

  if (data.hasDescription) {
    return DESCRIPTION_DURATION_IN_MS;
  }

  return data.type === ToastType.Info
    ? INFO_DURATION_IN_MS
    : SUCCESS_DURATION_IN_MS;
};

export default class Toast {
  private static toasts: Array<ToastItem> = [];
  private static listeners: Set<ToastListener> = new Set<ToastListener>();
  private static nextId: number = 1;

  public static success(title: string, options?: ToastOptions): string {
    return Toast.show(ToastType.Success, title, options);
  }

  public static error(title: string, options?: ToastOptions): string {
    return Toast.show(ToastType.Error, title, options);
  }

  public static info(title: string, options?: ToastOptions): string {
    return Toast.show(ToastType.Info, title, options);
  }

  public static show(
    type: ToastType,
    title: string,
    options?: ToastOptions,
  ): string {
    const durationInMs: number | null =
      options?.durationInMs !== undefined
        ? options.durationInMs
        : getDefaultDurationInMs({
            type: type,
            hasAction: Boolean(options?.action),
            hasDescription: Boolean(options?.description),
          });

    /*
     * The same words again - Save pressed twice, the same row type deleted
     * one after another - is the toast already there, shown again. Only
     * plain toasts: one with a description or an action may say more.
     */
    if (!options?.description && !options?.action) {
      const same: ToastItem | undefined = Toast.toasts.find(
        (toast: ToastItem): boolean => {
          return (
            toast.type === type &&
            toast.title === title &&
            !toast.description &&
            !toast.action
          );
        },
      );

      if (same) {
        Toast.toasts = [
          ...Toast.toasts.filter((toast: ToastItem): boolean => {
            return toast.id !== same.id;
          }),
          { ...same, durationInMs: durationInMs, revision: same.revision + 1 },
        ];
        Toast.notify();
        return same.id;
      }
    }

    const toast: ToastItem = {
      id: `toast-${Toast.nextId++}`,
      type: type,
      title: title,
      description: options?.description,
      action: options?.action,
      durationInMs: durationInMs,
      revision: 0,
      dataTestId: options?.dataTestId,
    };

    const next: Array<ToastItem> = [...Toast.toasts, toast];

    while (next.length > MAX_TOASTS) {
      /*
       * The oldest that goes by itself makes room; an error is kept while
       * there is anything else to drop.
       */
      const dropIndex: number = next.findIndex((item: ToastItem): boolean => {
        return item.type !== ToastType.Error;
      });

      next.splice(dropIndex >= 0 ? dropIndex : 0, 1);
    }

    Toast.toasts = next;
    Toast.notify();

    return toast.id;
  }

  public static dismiss(id: string): void {
    const remaining: Array<ToastItem> = Toast.toasts.filter(
      (toast: ToastItem): boolean => {
        return toast.id !== id;
      },
    );

    if (remaining.length === Toast.toasts.length) {
      return;
    }

    Toast.toasts = remaining;
    Toast.notify();
  }

  public static dismissAll(): void {
    if (Toast.toasts.length === 0) {
      return;
    }

    Toast.toasts = [];
    Toast.notify();
  }

  public static getToasts(): ReadonlyArray<ToastItem> {
    return Toast.toasts;
  }

  public static subscribe(listener: ToastListener): () => void {
    Toast.listeners.add(listener);

    return (): void => {
      Toast.listeners.delete(listener);
    };
  }

  private static notify(): void {
    for (const listener of Array.from(Toast.listeners)) {
      listener(Toast.toasts);
    }
  }
}

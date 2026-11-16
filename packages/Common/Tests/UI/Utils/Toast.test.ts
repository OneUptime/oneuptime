import { afterEach, describe, expect, test } from "@jest/globals";
import Toast, {
  ACTION_DURATION_IN_MS,
  DESCRIPTION_DURATION_IN_MS,
  getDefaultDurationInMs,
  getItemCreatedTemplate,
  INFO_DURATION_IN_MS,
  ITEM_CREATED,
  MAX_TOASTS,
  SUCCESS_DURATION_IN_MS,
  ToastItem,
  ToastType,
} from "../../../UI/Utils/Toast";

/*
 * The toasts' store (#9120): what is on the page, how long each stays, how
 * many at once, and the same words shown twice as one.
 */

const titles: () => Array<string> = (): Array<string> => {
  return Toast.getToasts().map((toast: ToastItem): string => {
    return toast.title;
  });
};

afterEach(() => {
  Toast.dismissAll();
});

describe("Toast", () => {
  test("a success goes by itself, an error stays until it is dismissed", () => {
    expect(
      getDefaultDurationInMs({ type: ToastType.Success, hasAction: false }),
    ).toBe(SUCCESS_DURATION_IN_MS);
    expect(
      getDefaultDurationInMs({ type: ToastType.Info, hasAction: false }),
    ).toBe(INFO_DURATION_IN_MS);
    expect(
      getDefaultDurationInMs({ type: ToastType.Error, hasAction: false }),
    ).toBeNull();
    expect(
      getDefaultDurationInMs({ type: ToastType.Error, hasAction: true }),
    ).toBeNull();

    Toast.success("Changes saved");
    Toast.error("Couldn't pin Logs.");

    const [success, error] = Toast.getToasts();

    expect(success?.type).toBe(ToastType.Success);
    expect(success?.durationInMs).toBe(SUCCESS_DURATION_IN_MS);
    expect(error?.type).toBe(ToastType.Error);
    expect(error?.durationInMs).toBeNull();
  });

  test("one with a second line stays long enough to read it", () => {
    Toast.success("Test SMS Sent", {
      description: "It should arrive within a few minutes.",
    });

    expect(Toast.getToasts()[0]?.durationInMs).toBe(DESCRIPTION_DURATION_IN_MS);
  });

  test("one with an action stays long enough to reach it", () => {
    Toast.success("Monitor deleted", {
      action: { title: "Undo", onClick: () => {} },
    });

    expect(Toast.getToasts()[0]?.durationInMs).toBe(ACTION_DURATION_IN_MS);
  });

  test("a time of its own wins, null included", () => {
    Toast.success("Copied", { durationInMs: 1500 });
    Toast.info("Exporting", { durationInMs: null });

    expect(
      Toast.getToasts().map((toast: ToastItem) => {
        return toast.durationInMs;
      }),
    ).toEqual([1500, null]);
  });

  test("the same words twice are one toast, shown again", () => {
    const first: string = Toast.success("Changes saved");
    Toast.success("Monitor created");
    const second: string = Toast.success("Changes saved");

    expect(second).toBe(first);
    // Moved to the end, the newest, and its time starts again.
    expect(titles()).toEqual(["Monitor created", "Changes saved"]);
    expect(Toast.getToasts()[1]?.revision).toBe(1);
  });

  test("the same words as an error and as a success are two toasts", () => {
    Toast.success("Saved");
    Toast.error("Saved");

    expect(Toast.getToasts()).toHaveLength(2);
  });

  test("past the limit, the oldest that goes by itself makes room and errors stay", () => {
    Toast.error("First error");

    for (let i: number = 1; i <= MAX_TOASTS + 2; i++) {
      Toast.success(`Saved ${i}`);
    }

    expect(Toast.getToasts()).toHaveLength(MAX_TOASTS);
    expect(titles()[0]).toBe("First error");
    expect(titles()).toContain(`Saved ${MAX_TOASTS + 2}`);
    expect(titles()).not.toContain("Saved 1");
  });

  test("only errors past the limit: the oldest goes", () => {
    for (let i: number = 1; i <= MAX_TOASTS + 1; i++) {
      Toast.error(`Error ${i}`);
    }

    expect(titles()).toEqual(
      Array.from({ length: MAX_TOASTS }, (_: unknown, index: number) => {
        return `Error ${index + 2}`;
      }),
    );
  });

  test("subscribers hear every change, and stop hearing once they leave", () => {
    const heard: Array<number> = [];
    const unsubscribe: () => void = Toast.subscribe(
      (toasts: ReadonlyArray<ToastItem>) => {
        heard.push(toasts.length);
      },
    );

    const id: string = Toast.success("Changes saved");
    Toast.dismiss(id);
    // Dismissing one that is gone says nothing.
    Toast.dismiss(id);
    unsubscribe();
    Toast.success("Monitor created");

    expect(heard).toEqual([1, 0]);
  });

  test("a create verb says what happened in its own past tense", () => {
    expect(getItemCreatedTemplate(undefined)).toBe(ITEM_CREATED);
    expect(getItemCreatedTemplate("Create")).toBe(ITEM_CREATED);
    expect(getItemCreatedTemplate("Add")).toBe("{{itemName}} added");
    expect(getItemCreatedTemplate(" Invite ")).toBe("{{itemName}} invited");
    expect(getItemCreatedTemplate("Link")).toBe("{{itemName}} linked");
    // Never a property every object has.
    expect(getItemCreatedTemplate("constructor")).toBe(ITEM_CREATED);
  });
});

import AsyncStorage from "@react-native-async-storage/async-storage";
import { beforeEach, describe, expect, test } from "@jest/globals";
import {
  LIST_PANE_WIDTH_KEY,
  MAX_STORED_LIST_PANE_WIDTH,
  MIN_STORED_LIST_PANE_WIDTH,
  getListPaneWidthPreference,
  setListPaneWidthPreference,
} from "./listPaneWidth";

/*
 * Where the reader left the divider is a convenience, not data: anything this
 * build did not write reads as "where the layout puts it", and putting the
 * divider back there forgets the width rather than storing it.
 */

describe("the remembered list width", () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
  });

  test("a device that never moved the divider has no width", async () => {
    expect(await getListPaneWidthPreference()).toBeNull();
  });

  test("round-trips a width, in whole points", async () => {
    await setListPaneWidthPreference(410.4);

    expect(await AsyncStorage.getItem(LIST_PANE_WIDTH_KEY)).toBe("410");
    expect(await getListPaneWidthPreference()).toBe(410);
  });

  test("putting the divider back forgets the width", async () => {
    await setListPaneWidthPreference(410);
    await setListPaneWidthPreference(null);

    expect(await AsyncStorage.getItem(LIST_PANE_WIDTH_KEY)).toBeNull();
    expect(await getListPaneWidthPreference()).toBeNull();
  });

  test.each([
    ["not a number", "wide"],
    ["empty", ""],
    ["blank", "   "],
    ["narrower than any pane", String(MIN_STORED_LIST_PANE_WIDTH - 1)],
    ["wider than any window", String(MAX_STORED_LIST_PANE_WIDTH + 1)],
    ["infinite", "Infinity"],
    ["negative", "-400"],
  ])(
    "a stored value that is %s is ignored",
    async (_name: string, stored: string) => {
      await AsyncStorage.setItem(LIST_PANE_WIDTH_KEY, stored);

      expect(await getListPaneWidthPreference()).toBeNull();
    },
  );

  test("a width this build would never write is not stored either", async () => {
    await setListPaneWidthPreference(410);
    await setListPaneWidthPreference(NaN);

    expect(await AsyncStorage.getItem(LIST_PANE_WIDTH_KEY)).toBeNull();

    await setListPaneWidthPreference(50);
    expect(await AsyncStorage.getItem(LIST_PANE_WIDTH_KEY)).toBeNull();
  });

  test("the ends of the readable range are kept", async () => {
    await setListPaneWidthPreference(MIN_STORED_LIST_PANE_WIDTH);
    expect(await getListPaneWidthPreference()).toBe(MIN_STORED_LIST_PANE_WIDTH);

    await setListPaneWidthPreference(MAX_STORED_LIST_PANE_WIDTH);
    expect(await getListPaneWidthPreference()).toBe(MAX_STORED_LIST_PANE_WIDTH);
  });
});

import { describe, expect, test } from "@jest/globals";
import IconProp from "../../../../Types/Icon/IconProp";
import { TranslateFunction } from "../../../../UI/Components/Table/EmptyTableMessage";
import {
  TableEmptyStateAction,
  TableEmptyStateKind,
  TableEmptyStateProps,
} from "../../../../UI/Components/Table/TableEmptyState";
import {
  CLEAR_FILTERS,
  EMPTY_TABLE_CLEAR_FILTERS_TEST_ID,
  TABLE_RETRY_BUTTON_TEST_ID,
  TRY_AGAIN,
  getFilteredEmptyStateProps,
  getLoadErrorStateProps,
  getMessageEmptyStateParts,
  hasFilterValues,
  isFilterValueSet,
} from "../../../../UI/Components/Table/TableEmptyStateBuilders";

/*
 * The states a Table or List builds for itself when its caller hands it no
 * more than a sentence: a failed load, a filter that hides every row, and a
 * page's own message made into a title and a description.
 */

const IDENTITY: TranslateFunction = (value: string): string => {
  return value;
};

const GERMAN: TranslateFunction = (value: string): string => {
  const dictionary: Record<string, string> = {
    "Couldn't load this list.": "Diese Liste konnte nicht geladen werden.",
    "Nothing here yet.": "Hier ist noch nichts.",
    "No site types yet. Add one.": "Noch keine Standorttypen. Fügen Sie einen hinzu.",
  };

  return dictionary[value] ?? value;
};

describe("getLoadErrorStateProps", () => {
  test("names what failed, gives the server's reason, and offers to try again", () => {
    let retries: number = 0;

    const props: TableEmptyStateProps = getLoadErrorStateProps({
      pluralLabel: "Monitors",
      error: "The server took too long to answer.",
      onRetry: () => {
        retries++;
      },
      translate: IDENTITY,
    });

    expect(props.kind).toBe(TableEmptyStateKind.Error);
    expect(props.title).toBe("Couldn't load monitors");
    expect(props.description).toBe("The server took too long to answer.");
    expect(props.actions).toHaveLength(1);

    const retry: TableEmptyStateAction = props.actions![0]!;
    expect(retry.title).toBe(TRY_AGAIN);
    expect(retry.icon).toBe(IconProp.Refresh);
    // The hook every table's Refresh link had, so retry flows keep working.
    expect(retry.dataTestId).toBe(TABLE_RETRY_BUTTON_TEST_ID);
    expect(TABLE_RETRY_BUTTON_TEST_ID).toBe("refresh-button");

    retry.onClick();
    expect(retries).toBe(1);
  });

  test("without a way to retry there is no button that does nothing", () => {
    const props: TableEmptyStateProps = getLoadErrorStateProps({
      pluralLabel: "Monitors",
      error: "Boom",
      translate: IDENTITY,
    });

    expect(props.actions).toEqual([]);
  });

  test("a locale heads it with its own sentence", () => {
    expect(
      getLoadErrorStateProps({
        pluralLabel: "Monitors",
        error: "Boom",
        translate: GERMAN,
      }).title,
    ).toBe("Diese Liste konnte nicht geladen werden");
  });
});

describe("getMessageEmptyStateParts", () => {
  test("with no message, the table's own title and no description", () => {
    expect(
      getMessageEmptyStateParts({
        pluralLabel: "Incident Measurements",
        translate: IDENTITY,
      }),
    ).toEqual({ title: "No incident measurements yet" });
  });

  test("a blank message is no message", () => {
    expect(
      getMessageEmptyStateParts({
        pluralLabel: "Monitors",
        noItemsMessage: "   ",
        translate: IDENTITY,
      }),
    ).toEqual({ title: "No monitors yet" });
  });

  test("a page's message is split into a title and a description", () => {
    expect(
      getMessageEmptyStateParts({
        pluralLabel: "Site Types",
        noItemsMessage: "No site types yet. Add one.",
        translate: IDENTITY,
      }),
    ).toEqual({ title: "No site types yet", description: "Add one." });
  });

  test("the message is translated whole, then split in the reader's language", () => {
    expect(
      getMessageEmptyStateParts({
        pluralLabel: "Site Types",
        noItemsMessage: "No site types yet. Add one.",
        translate: GERMAN,
      }),
    ).toEqual({
      title: "Noch keine Standorttypen",
      description: "Fügen Sie einen hinzu.",
    });
  });

  test("a locale without the table's sentence heads it with its noun-free one", () => {
    expect(
      getMessageEmptyStateParts({
        pluralLabel: "Widgets",
        translate: GERMAN,
      }),
    ).toEqual({ title: "Hier ist noch nichts" });
  });
});

describe("getFilteredEmptyStateProps", () => {
  test("says nothing matches and offers the way back", () => {
    let clears: number = 0;

    const props: TableEmptyStateProps = getFilteredEmptyStateProps({
      title: "No services match the current filters.",
      onClear: () => {
        clears++;
      },
    });

    expect(props.kind).toBe(TableEmptyStateKind.Filtered);
    expect(props.title).toBe("No services match the current filters.");
    expect(props.actions).toHaveLength(1);
    expect(props.actions![0]!.title).toBe(CLEAR_FILTERS);
    expect(props.actions![0]!.icon).toBe(IconProp.Close);
    expect(props.actions![0]!.dataTestId).toBe(
      EMPTY_TABLE_CLEAR_FILTERS_TEST_ID,
    );

    props.actions![0]!.onClick();
    expect(clears).toBe(1);
  });

  test("names the button for what it clears when told to", () => {
    expect(
      getFilteredEmptyStateProps({
        title: "No monitors match your search or filters",
        onClear: () => {},
        clearTitle: "Clear Search",
      }).actions![0]!.title,
    ).toBe("Clear Search");
  });

  test("carries a description when there is one", () => {
    expect(
      getFilteredEmptyStateProps({
        title: "No events match",
        description: "Events older than a day are not kept.",
      }).description,
    ).toBe("Events older than a day are not kept.");
  });

  test("offers no button when nothing can clear the filters", () => {
    expect(
      getFilteredEmptyStateProps({ title: "No events match" }).actions,
    ).toEqual([]);
  });

  test("never offers to create one", () => {
    const props: TableEmptyStateProps = getFilteredEmptyStateProps({
      title: "No events match",
      onClear: () => {},
    });

    for (const action of props.actions || []) {
      expect(action.icon).not.toBe(IconProp.Add);
      expect(action.dataTestId).not.toBe("empty-table-create-button");
    }
  });
});

describe("hasFilterValues", () => {
  test.each([
    [undefined, false],
    [{}, false],
    [{ name: undefined }, false],
    [{ name: "" }, false],
    [{ name: null }, false],
    [{ labels: [] }, false],
    [{ name: "checkout" }, true],
    [{ name: undefined, isEnabled: true }, true],
    [{ createdAt: { startValue: "x" } }, true],
    [{ labels: ["a"] }, true],
  ])("%j -> %s", (filterData: unknown, expected: boolean) => {
    expect(
      hasFilterValues(filterData as { [key: string]: unknown } | undefined),
    ).toBe(expected);
  });

  /*
   * The regression: "Enabled: No" is stored as false and sent to the server
   * as a filter, but truthiness called the table unfiltered - "No X yet"
   * and a Create button under a list the filter had emptied.
   */
  test("a yes/no filter set to No narrows the rows", () => {
    expect(hasFilterValues({ isEnabled: false })).toBe(true);
    expect(isFilterValueSet(false)).toBe(true);
  });

  test("a number filter set to 0 narrows the rows", () => {
    expect(hasFilterValues({ retries: 0 })).toBe(true);
    expect(isFilterValueSet(0)).toBe(true);
  });
});

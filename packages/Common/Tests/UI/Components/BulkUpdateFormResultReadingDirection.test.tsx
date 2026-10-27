import { describe, expect, test } from "@jest/globals";
import { fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import * as React from "react";
import BulkUpdateForm, {
  BulkActionButtonSchema,
  BulkActionOnClickProps,
  BulkUpdateBarLayout,
} from "../../../UI/Components/BulkUpdate/BulkUpdateForm";
import {
  BulkItemOutcome,
  bulkItemUnchanged,
  runBulkAction,
} from "../../../UI/Components/BulkUpdate/BulkActionRunner";
import { ButtonStyleType } from "../../../UI/Components/Button/Button";
import IconProp from "../../../Types/Icon/IconProp";

/*
 * A BULK ACTION'S RESULT, READ THE WAY EACH LINE IS WRITTEN.
 *
 * The result lists the records an action left alone or could not change,
 * each by its name, under the reason - often the server's, in English. On a
 * Persian page (right to left) the list drew them as part of the page's
 * own text: an English refusal put its full stop at its start
 * (".Telemetry Exception not found"), as values someone wrote did
 * everywhere until they were isolated (IsolatedText). Names and reasons
 * now read the way most of their letters do, in a bdi of their own; the
 * line still starts where the dialog's lines do.
 */

jest.mock("react-i18next", () => {
  return {
    useTranslation: () => {
      return {
        t: (key: string, opts?: { defaultValue?: string }): string => {
          return opts?.defaultValue ?? key;
        },
      };
    },
  };
});

interface Row {
  _id: string;
  name: string;
}

const ENGLISH_REFUSAL: string = "Telemetry Exception not found.";
const PERSIAN_REASON: string = "قبلاً برطرف شده است.";

const ROWS: Array<Row> = [
  { _id: "1", name: "TypeError: x is undefined" },
  { _id: "2", name: "خطای پرداخت در سرویس سفارش" },
  { _id: "3", name: "ConnectionResetError: reset by peer" },
];

const ACTION: BulkActionButtonSchema<Row> = {
  title: "Resolve",
  icon: IconProp.Check,
  buttonStyleType: ButtonStyleType.NORMAL,
  onClick: async (props: BulkActionOnClickProps<Row>): Promise<void> => {
    await runBulkAction<Row>({
      actionProps: props,
      step: async (row: Row): Promise<BulkItemOutcome | void> => {
        if (row._id === "3") {
          return bulkItemUnchanged(PERSIAN_REASON);
        }

        throw new Error(ENGLISH_REFUSAL);
      },
    });
  },
};

async function runIn(layout: BulkUpdateBarLayout | undefined): Promise<void> {
  render(
    <BulkUpdateForm<Row>
      selectedItems={ROWS}
      isAllItemsSelected={true}
      onSelectAllClick={() => {}}
      onClearSelectionClick={() => {}}
      singularLabel="Exception"
      pluralLabel="Exceptions"
      buttons={[ACTION]}
      itemToString={(row: Row): string => {
        return row.name;
      }}
      layout={layout}
    />,
  );

  fireEvent.click(screen.getByRole("button", { name: "Bulk Actions" }));
  fireEvent.click(screen.getByRole("menuitem", { name: "Resolve" }));

  await screen.findByTestId("bulk-action-failed-items");
}

// The bdi a line of the result is drawn in, found by its words.
function isolateOf(text: string): HTMLElement {
  const element: HTMLElement = screen.getByText(text);

  expect(element.tagName).toBe("BDI");

  return element;
}

describe.each([
  ["a table's bar", undefined],
  ["a list's header line", BulkUpdateBarLayout.Row],
])("the result of %s", (_name: string, layout?: BulkUpdateBarLayout) => {
  test("names each record the way its name is written", async () => {
    await runIn(layout);

    expect(isolateOf("TypeError: x is undefined")).toHaveAttribute(
      "dir",
      "ltr",
    );
    expect(isolateOf("خطای پرداخت در سرویس سفارش")).toHaveAttribute(
      "dir",
      "rtl",
    );
    expect(isolateOf("ConnectionResetError: reset by peer")).toHaveAttribute(
      "dir",
      "ltr",
    );
  });

  test("keeps an English refusal's full stop at its end, and a Persian reason's at its own", async () => {
    await runIn(layout);

    expect(isolateOf(ENGLISH_REFUSAL)).toHaveAttribute("dir", "ltr");
    expect(isolateOf(PERSIAN_REASON)).toHaveAttribute("dir", "rtl");
  });
});

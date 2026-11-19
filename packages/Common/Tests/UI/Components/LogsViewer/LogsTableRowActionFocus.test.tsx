import "@testing-library/jest-dom";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { UserEvent } from "@testing-library/user-event/dist/types/setup/setup";
import React from "react";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import LogsTable, {
  LOGS_TABLE_ROW_ACTION_CLASS_NAME,
} from "../../../../UI/Components/LogsViewer/components/LogsTable";
import Log from "../../../../Models/AnalyticsModels/Log";
import LogSeverity from "../../../../Types/Log/LogSeverity";

/*
 * A log row's own action, Copy log message, is drawn only under the
 * pointer - and was never drawn for the keyboard: Tab reached it, and its
 * focus ring went round something unseen. It shows once the keyboard's
 * focus is on it, or anywhere in its row (found while making Copy Link,
 * #9794). The look is CSS, which jsdom does not draw, so the classes that
 * make it are pinned.
 */

afterEach(() => {
  cleanup();
});

function makeLog(): Log {
  const log: Log = new Log();
  log.body = "GET /admin 403";
  log.time = new Date("2026-10-27T06:45:12.345Z");
  log.severityText = LogSeverity.Warning;
  log.setColumnValue("_id", "0192f1a0-0000-7000-8000-000000000001");

  return log;
}

describe("a log row's Copy log message", () => {
  test("is shown to the keyboard as well as under the pointer", () => {
    expect(LOGS_TABLE_ROW_ACTION_CLASS_NAME.split(" ")).toEqual(
      expect.arrayContaining([
        "opacity-0",
        "group-hover:opacity-100",
        "group-focus-within:opacity-100",
        "focus-visible:opacity-100",
      ]),
    );
  });

  test("Tab reaches it, drawn so it can be seen there", async () => {
    render(
      <LogsTable
        logs={[makeLog()]}
        serviceMap={{}}
        isLoading={false}
        onRowClick={jest.fn()}
      />,
    );

    const user: UserEvent = userEvent.setup({ delay: null });
    const button: HTMLElement = screen.getByRole("button", {
      name: "Copy log message",
    });

    while (document.activeElement !== button) {
      await user.tab();

      if (document.activeElement === document.body) {
        break;
      }
    }

    expect(button).toHaveFocus();

    for (const className of LOGS_TABLE_ROW_ACTION_CLASS_NAME.split(" ")) {
      expect(button).toHaveClass(className);
    }

    // Its row is the group whose focus shows it.
    expect(button.closest("tr")).toHaveClass("group");
  });
});

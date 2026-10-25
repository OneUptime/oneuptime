import "@testing-library/jest-dom";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import { cleanup, render, screen, within } from "@testing-library/react";
import * as React from "react";
import ExceptionRow from "../../../../App/FeatureSet/Dashboard/src/Components/Exceptions/ExceptionRow";
import ActionButtonSchema, {
  ActionButtonPlacement,
} from "../../../UI/Components/ActionButton/ActionButtonSchema";
import { ButtonStyleType } from "../../../UI/Components/Button/Button";
import TelemetryException from "../../../Models/DatabaseModels/TelemetryException";
import Service from "../../../Models/DatabaseModels/Service";
import IconProp from "../../../Types/Icon/IconProp";
import { findNestedControls } from "../../Helpers/NestedControls";

/*
 * An exception's row on the exceptions list, with its ⋯ menu (Resolve or
 * Reopen, Archive or Unarchive) beside the button that opens it.
 *
 * From sm up the exception's status sits at the row's top right, by the ⋯.
 * On a phone it leads the service line instead: beside the ⋯ the pill took
 * the message's width, and "context deadline exceeded calling
 * payments-worker /charge" wrapped a word or two to a line, the service
 * chip broken over two. Its chips never break inside, and the ⋯ is never a
 * control inside the row's button.
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

const exceptionOf: (data: {
  isResolved?: boolean;
  isArchived?: boolean;
}) => TelemetryException = (data: {
  isResolved?: boolean;
  isArchived?: boolean;
}): TelemetryException => {
  const exception: TelemetryException = new TelemetryException();
  exception._id = "70000000-0000-4000-8000-000000000001";
  exception.exceptionType = "DeadlineExceededError";
  exception.message =
    "context deadline exceeded calling payments-worker /charge";
  exception.environment = "production";
  exception.occuranceCount = 412;
  exception.isResolved = Boolean(data.isResolved);
  exception.isArchived = Boolean(data.isArchived);

  return exception;
};

const SERVICE: Service = (() => {
  const service: Service = new Service();
  service.name = "payments-worker";

  return service;
})();

const ACTIONS: Array<ActionButtonSchema<TelemetryException>> = [
  {
    title: "Resolve",
    icon: IconProp.Check,
    buttonStyleType: ButtonStyleType.OUTLINE,
    placement: ActionButtonPlacement.MoreMenu,
    onClick: (): void => {},
  },
];

afterEach(() => {
  cleanup();
});

describe("an exception's row", () => {
  test.each([
    [{}, "Unresolved"],
    [{ isResolved: true }, "Resolved"],
    [{ isArchived: true }, "Archived"],
  ] as Array<[{ isResolved?: boolean; isArchived?: boolean }, string]>)(
    "draws its status at the top right from sm up, and first on its service line on a phone (%j)",
    (state: { isResolved?: boolean; isArchived?: boolean }, word: string) => {
      render(
        <ExceptionRow
          exception={exceptionOf(state)}
          service={SERVICE}
          actionButtons={ACTIONS}
        />,
      );

      const corner: HTMLElement = screen.getByTestId("exception-row-status");
      const inline: HTMLElement = screen.getByTestId(
        "exception-row-status-inline",
      );

      expect(corner).toHaveTextContent(word);
      expect(inline).toHaveTextContent(word);
      // One or the other, never both: hidden below sm, hidden from sm up.
      expect(corner.className.split(" ")).toContain("max-sm:hidden");
      expect(inline.className.split(" ")).toContain("sm:hidden");
      expect(inline.className.split(" ")).not.toContain("hidden");

      // The phone's pill leads the line that names the service.
      const serviceLine: HTMLElement = inline.parentElement!;

      expect(serviceLine.firstElementChild).toBe(inline);
      expect(serviceLine).toHaveTextContent("payments-worker");
      expect(serviceLine.className.split(" ")).toContain("flex-wrap");
    },
  );

  test("its service and environment chips never break inside", () => {
    render(
      <ExceptionRow
        exception={exceptionOf({})}
        service={SERVICE}
        actionButtons={ACTIONS}
      />,
    );

    const serviceLine: HTMLElement = screen.getByTestId(
      "exception-row-status-inline",
    ).parentElement!;

    for (const chip of [
      within(serviceLine).getByText("payments-worker"),
      within(serviceLine).getByText("production"),
    ]) {
      expect(chip.className.split(" ")).toContain("whitespace-nowrap");
    }
  });

  test("its ⋯ sits beside the button that opens it, not inside it", () => {
    const { container } = render(
      <ExceptionRow
        exception={exceptionOf({})}
        service={SERVICE}
        actionButtons={ACTIONS}
      />,
    );

    const actions: HTMLElement = screen.getByTestId("exception-row-actions");

    expect(within(actions).getByTestId("row-actions-more-button")).toBeTruthy();
    expect(actions.closest("button")).toBeNull();
    expect(findNestedControls(container)).toEqual([]);
  });

  test("a list that offers no actions draws no ⋯, and still says where the exception stands", () => {
    render(<ExceptionRow exception={exceptionOf({})} service={SERVICE} />);

    expect(screen.queryByTestId("exception-row-actions")).toBeNull();
    expect(screen.getByTestId("exception-row-status")).toHaveTextContent(
      "Unresolved",
    );
  });
});

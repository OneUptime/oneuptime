import "@testing-library/jest-dom";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import * as React from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";
import InvestigationNotice, {
  noticeDoneIcon,
  noticeFailedIcon,
} from "../../../../App/FeatureSet/Dashboard/src/Components/AI/InvestigationNotice";

/*
 * The AI Investigation card says everything that is not the report in one
 * way: a small mark, a sentence and a quieter line under it. The run that
 * stopped, the report still being written, a fix task created or refused, a
 * verdict that could not be saved and a question that could not be sent all
 * use it. Several of those were tinted alert boxes, the loudest things in a
 * card that draws no boxes, so the notice must never become one.
 */

const BOX_CLASS: RegExp =
  /(^|\s)(border(-[a-z]+-\d{3})?|rounded-(lg|xl|2xl)|shadow(-sm|-md|-lg)?|bg-[a-z]+-(50|100)(\/\d+)?)(\s|$)/;

function boxes(root: HTMLElement): Array<string> {
  return [root, ...Array.from(root.querySelectorAll("*"))]
    .filter((node: Element): boolean => {
      return (
        node.tagName !== "BUTTON" &&
        BOX_CLASS.test(node.getAttribute("class") || "")
      );
    })
    .map((node: Element): string => {
      return node.getAttribute("class") || "";
    });
}

afterEach(() => {
  cleanup();
});

describe("InvestigationNotice", () => {
  test("is a mark, a sentence and a quieter line under it", () => {
    render(
      <InvestigationNotice
        testId="notice"
        indicator={noticeFailedIcon}
        title="Could not save your verdict"
      >
        Verdict storage is unavailable.
      </InvestigationNotice>,
    );

    const notice: HTMLElement = screen.getByTestId("notice");
    const title: HTMLElement = screen.getByText("Could not save your verdict");
    const detail: HTMLElement = screen.getByText(
      "Verdict storage is unavailable.",
    );

    expect(notice.className).toBe("flex items-start gap-3");
    expect(title.tagName).toBe("P");
    expect(title).toHaveClass("text-sm", "font-medium", "text-gray-900");
    expect(detail.tagName).toBe("P");
    expect(detail).toHaveClass("text-sm", "leading-6", "text-gray-600");
    // The mark comes first, then the words.
    expect(notice.firstElementChild!.querySelector("svg")).not.toBeNull();
    expect(notice.firstElementChild!.tagName).toBe("DIV");
  });

  test("never draws a box", () => {
    render(
      <InvestigationNotice
        testId="notice"
        role="alert"
        indicator={noticeFailedIcon}
        title="Could not create the fix task"
        onDismiss={() => {}}
      >
        No AI agent is online.
      </InvestigationNotice>,
    );

    expect(boxes(screen.getByTestId("notice"))).toEqual([]);
  });

  test("a sentence alone has no second line", () => {
    render(
      <InvestigationNotice
        testId="notice"
        indicator={noticeFailedIcon}
        title="AI is turned off for this project."
      />,
    );

    expect(screen.getByTestId("notice").querySelectorAll("p")).toHaveLength(1);
  });

  test.each([["status"], ["alert"]] as Array<["status" | "alert"]>)(
    "is announced as %s when asked to be",
    (role: "status" | "alert") => {
      render(
        <InvestigationNotice
          role={role}
          indicator={noticeFailedIcon}
          title="Something happened"
        />,
      );

      expect(screen.getByRole(role)).toHaveTextContent("Something happened");
    },
  );

  test("carries no role unless it is given one", () => {
    render(
      <InvestigationNotice
        testId="notice"
        indicator={noticeFailedIcon}
        title="The investigation stopped before it could report."
      />,
    );

    expect(screen.getByTestId("notice")).not.toHaveAttribute("role");
  });

  test("a long, unbroken reason wraps instead of pushing the card wider", () => {
    render(
      <InvestigationNotice
        testId="notice"
        indicator={noticeFailedIcon}
        title={"x".repeat(300)}
      >
        {"y".repeat(300)}
      </InvestigationNotice>,
    );

    for (const paragraph of Array.from(
      screen.getByTestId("notice").querySelectorAll("p"),
    )) {
      expect(paragraph).toHaveClass("break-words");
    }
    // The words' column may shrink; the mark's may not.
    expect(screen.getByTestId("notice").children[1]).toHaveClass(
      "min-w-0",
      "flex-1",
    );
    expect(screen.getByTestId("notice").children[0]).toHaveClass(
      "flex-shrink-0",
    );
  });

  test("can hold a link in its second line without nesting a block in a paragraph", () => {
    const consoleError: ReturnType<typeof jest.spyOn> = jest
      .spyOn(console, "error")
      .mockImplementation(() => {});

    try {
      render(
        <InvestigationNotice
          testId="notice"
          role="alert"
          indicator={noticeDoneIcon}
          title="Fix task created"
        >
          AI will open a pull request. <a href="/task">View task progress</a>.
        </InvestigationNotice>,
      );

      expect(
        screen.getByRole("link", { name: "View task progress" }),
      ).toBeVisible();
      expect(
        screen.getByTestId("notice").querySelectorAll("p div"),
      ).toHaveLength(0);
      expect(
        consoleError.mock.calls.some((args: Array<unknown>): boolean => {
          return args.some((value: unknown): boolean => {
            return (
              typeof value === "string" && value.includes("validateDOMNesting")
            );
          });
        }),
      ).toBe(false);
    } finally {
      consoleError.mockRestore();
    }
  });

  describe("a notice the reader can put away", () => {
    test("has a Dismiss button that calls back", () => {
      const onDismiss: MockFunction = getJestMockFunction();

      render(
        <InvestigationNotice
          role="alert"
          indicator={noticeFailedIcon}
          title="Busy."
          onDismiss={onDismiss}
        />,
      );

      const dismiss: HTMLElement = screen.getByRole("button", {
        name: "Dismiss",
      });
      expect(dismiss).toHaveAttribute("type", "button");
      expect(dismiss).toHaveAttribute("title", "Dismiss");

      fireEvent.click(dismiss);

      expect(onDismiss).toHaveBeenCalledTimes(1);
    });

    test("without a handler there is nothing to press", () => {
      render(
        <InvestigationNotice indicator={noticeFailedIcon} title="Busy." />,
      );

      expect(screen.queryByRole("button")).toBeNull();
    });

    test("the button is reachable by keyboard and shows its focus", () => {
      render(
        <InvestigationNotice
          indicator={noticeFailedIcon}
          title="Busy."
          onDismiss={() => {}}
        />,
      );

      const dismiss: HTMLElement = screen.getByRole("button", {
        name: "Dismiss",
      });
      dismiss.focus();

      expect(document.activeElement).toBe(dismiss);
      expect(dismiss).toHaveClass(
        "focus-visible:ring-2",
        "focus-visible:ring-indigo-500",
      );
    });
  });

  describe("the usual marks", () => {
    test("a failure is a red warning sign", () => {
      render(
        <InvestigationNotice
          testId="notice"
          indicator={noticeFailedIcon}
          title="Failed"
        />,
      );

      expect(screen.getByTestId("notice").querySelector("svg")).toHaveClass(
        "h-4",
        "w-4",
        "text-red-600",
      );
    });

    test("a success is a green tick", () => {
      render(
        <InvestigationNotice
          testId="notice"
          indicator={noticeDoneIcon}
          title="Done"
        />,
      );

      expect(screen.getByTestId("notice").querySelector("svg")).toHaveClass(
        "h-4",
        "w-4",
        "text-emerald-600",
      );
    });

    test("the two are different glyphs, so colour is not the only signal", () => {
      const first: ReturnType<typeof render> = render(
        <InvestigationNotice
          testId="notice"
          indicator={noticeFailedIcon}
          title="Failed"
        />,
      );
      const failedPath: string | null | undefined = screen
        .getByTestId("notice")
        .querySelector("path")
        ?.getAttribute("d");
      first.unmount();

      render(
        <InvestigationNotice
          testId="notice"
          indicator={noticeDoneIcon}
          title="Done"
        />,
      );

      expect(
        screen.getByTestId("notice").querySelector("path")?.getAttribute("d"),
      ).not.toBe(failedPath);
    });
  });
});

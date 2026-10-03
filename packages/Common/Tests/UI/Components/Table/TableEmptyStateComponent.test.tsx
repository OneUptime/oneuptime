import "@testing-library/jest-dom";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import * as React from "react";
import IconProp from "../../../../Types/Icon/IconProp";
import TableEmptyState, {
  TABLE_EMPTY_STATE_KIND_STYLES,
  TABLE_EMPTY_STATE_TEST_ID,
  TableEmptyStateActionStyle,
  TableEmptyStateKind,
} from "../../../../UI/Components/Table/TableEmptyState";

/*
 * TableEmptyState: what every table and list shows in place of rows - an
 * illustration, a title that says what is true, a sentence on what the list
 * is for, and the actions that are the way forward.
 *
 * react-i18next answers from a per-test dictionary, so the translation path
 * the real component takes is the one exercised.
 */

let dictionary: Record<string, string> = {};

jest.mock("react-i18next", () => {
  return {
    useTranslation: () => {
      return {
        t: (key: string, opts?: { defaultValue?: string }): string => {
          return dictionary[key] ?? opts?.defaultValue ?? key;
        },
      };
    },
  };
});

const ROOT: string = TABLE_EMPTY_STATE_TEST_ID;

afterEach(() => {
  cleanup();
  dictionary = {};
});

describe("the title", () => {
  test("is a heading, and a sentence is drawn without its full stop", () => {
    render(
      <TableEmptyState
        kind={TableEmptyStateKind.Empty}
        title="No services match the current filters."
      />,
    );

    const title: HTMLElement = screen.getByTestId(`${ROOT}-title`);

    expect(title.tagName).toBe("H3");
    expect(title).toHaveTextContent(/^No services match the current filters$/);
    expect(
      screen.getByRole("heading", {
        name: "No services match the current filters",
      }),
    ).toBeInTheDocument();
  });

  test("is translated whole, then headed", () => {
    dictionary = { "No monitors yet.": "Noch keine Monitore." };

    render(
      <TableEmptyState
        kind={TableEmptyStateKind.Empty}
        title="No monitors yet."
      />,
    );

    expect(screen.getByTestId(`${ROOT}-title`)).toHaveTextContent(
      /^Noch keine Monitore$/,
    );
  });

  test("keeps the marks that say something", () => {
    render(
      <TableEmptyState
        kind={TableEmptyStateKind.AllClear}
        title="Nice work!"
      />,
    );

    expect(screen.getByTestId(`${ROOT}-title`)).toHaveTextContent(
      /^Nice work!$/,
    );
  });

  test("an element is drawn as given", () => {
    render(
      <TableEmptyState
        kind={TableEmptyStateKind.Empty}
        title={<span data-testid="own-title">Custom.</span>}
      />,
    );

    expect(screen.getByTestId("own-title")).toHaveTextContent("Custom.");
  });
});

describe("the description", () => {
  test("is drawn under the title, translated", () => {
    dictionary = {
      "Labels help you organize resources.": "Labels helfen beim Ordnen.",
    };

    render(
      <TableEmptyState
        kind={TableEmptyStateKind.Empty}
        title="No labels yet"
        description="Labels help you organize resources."
      />,
    );

    expect(screen.getByTestId(`${ROOT}-description`)).toHaveTextContent(
      "Labels helfen beim Ordnen.",
    );
  });

  test("keeps its full stop: it is a sentence, not a heading", () => {
    render(
      <TableEmptyState
        kind={TableEmptyStateKind.Empty}
        title="No labels yet"
        description="Add one."
      />,
    );

    expect(screen.getByTestId(`${ROOT}-description`)).toHaveTextContent(
      /^Add one\.$/,
    );
  });

  test("an element (a card description with a link, say) is drawn as given", () => {
    render(
      <TableEmptyState
        kind={TableEmptyStateKind.Empty}
        title="No labels yet"
        description={
          <span>
            Read <a href="/docs">the docs</a>.
          </span>
        }
      />,
    );

    expect(screen.getByRole("link", { name: "the docs" })).toBeInTheDocument();
  });

  test("is left out entirely when there is none", () => {
    render(
      <TableEmptyState
        kind={TableEmptyStateKind.Empty}
        title="No labels yet"
      />,
    );

    expect(screen.queryByTestId(`${ROOT}-description`)).toBeNull();
  });
});

describe("the illustration", () => {
  test("is decoration only: hidden from screen readers", () => {
    render(
      <TableEmptyState
        kind={TableEmptyStateKind.Empty}
        title="No labels yet"
      />,
    );

    expect(screen.getByTestId(`${ROOT}-illustration`)).toHaveAttribute(
      "aria-hidden",
      "true",
    );
  });

  test.each([
    [TableEmptyStateKind.Empty, IconProp.TableCells],
    [TableEmptyStateKind.Filtered, IconProp.Search],
    [TableEmptyStateKind.AllClear, IconProp.CheckCircle],
    [TableEmptyStateKind.Error, IconProp.Error],
    [TableEmptyStateKind.NoAccess, IconProp.Lock],
  ])(
    "%s draws %s unless told otherwise",
    (kind: TableEmptyStateKind, icon: IconProp) => {
      render(<TableEmptyState kind={kind} title="Title" />);

      expect(
        screen.getByTestId(`${ROOT}-illustration`).querySelector("[data-icon]"),
      ).toHaveAttribute("data-icon", icon);
      expect(screen.getByTestId(ROOT)).toHaveAttribute(
        "data-empty-state-kind",
        kind,
      );
    },
  );

  test("a table's own icon wins", () => {
    render(
      <TableEmptyState
        kind={TableEmptyStateKind.Empty}
        title="No measurements yet"
        icon={IconProp.Clock}
      />,
    );

    expect(
      screen.getByTestId(`${ROOT}-illustration`).querySelector("[data-icon]"),
    ).toHaveAttribute("data-icon", IconProp.Clock);
  });

  test("every kind has its own colour on the card behind", () => {
    const backCards: Array<string> = Object.values(
      TABLE_EMPTY_STATE_KIND_STYLES,
    ).map((style: { backCardClassName: string }) => {
      return style.backCardClassName;
    });

    // Filtered and no-access share the quiet grey; the rest differ.
    expect(new Set(backCards).size).toBe(4);
    expect(
      TABLE_EMPTY_STATE_KIND_STYLES[TableEmptyStateKind.AllClear]
        .backCardClassName,
    ).toContain("emerald");
    expect(
      TABLE_EMPTY_STATE_KIND_STYLES[TableEmptyStateKind.Error]
        .backCardClassName,
    ).toContain("red");
  });
});

describe("the actions", () => {
  test("a plain action is drawn as a plain button, like a card header's", () => {
    let clicks: number = 0;

    render(
      <TableEmptyState
        kind={TableEmptyStateKind.Empty}
        title="No labels yet"
        actions={[
          {
            title: "Create Label",
            icon: IconProp.Add,
            dataTestId: "create-label",
            onClick: () => {
              clicks++;
            },
          },
        ]}
      />,
    );

    const button: HTMLElement = screen.getByTestId("create-label");

    expect(button).toHaveTextContent("Create Label");
    expect(button.className).toContain("bg-white");
    expect(button.className).toContain("border-gray-300");
    expect(button.className).not.toContain("bg-indigo-600");

    fireEvent.click(button);
    expect(clicks).toBe(1);
  });

  test("a link action is drawn as a quiet link", () => {
    render(
      <TableEmptyState
        kind={TableEmptyStateKind.Empty}
        title="No labels yet"
        actions={[
          {
            title: "How Labels Work",
            icon: IconProp.Help,
            style: TableEmptyStateActionStyle.Link,
            dataTestId: "help",
            onClick: () => {},
          },
        ]}
      />,
    );

    const link: HTMLElement = screen.getByTestId("help");

    expect(link.className).toContain("text-indigo-600");
    expect(link.className).not.toContain("border-gray-300");
  });

  test("they come in the order given", () => {
    render(
      <TableEmptyState
        kind={TableEmptyStateKind.Empty}
        title="No labels yet"
        actions={[
          { title: "First", onClick: () => {} },
          { title: "Second", onClick: () => {} },
        ]}
      />,
    );

    const buttons: Array<HTMLElement> = Array.from(
      screen.getByTestId(`${ROOT}-actions`).querySelectorAll("button"),
    );

    expect(
      buttons.map((button: HTMLElement) => {
        return button.textContent;
      }),
    ).toEqual(["First", "Second"]);
  });

  test("a locked action is disabled, dimmed, and does nothing", () => {
    let clicks: number = 0;

    render(
      <TableEmptyState
        kind={TableEmptyStateKind.Empty}
        title="No labels yet"
        actions={[
          {
            title: "Create Label",
            disabled: true,
            dataTestId: "create-label",
            onClick: () => {
              clicks++;
            },
          },
        ]}
      />,
    );

    const button: HTMLElement = screen.getByTestId("create-label");

    expect(button).toBeDisabled();
    expect(button.className).toContain("disabled:opacity-60");

    fireEvent.click(button);
    expect(clicks).toBe(0);
  });

  test("a locked action says why on hover", async () => {
    render(
      <TableEmptyState
        kind={TableEmptyStateKind.Empty}
        title="No labels yet"
        actions={[
          {
            title: "Create Label",
            disabled: true,
            tooltip: "You do not have permission to create this Label.",
            dataTestId: "create-label",
            onClick: () => {},
          },
        ]}
      />,
    );

    fireEvent.mouseEnter(screen.getByTestId("create-label-disabled-wrapper"));

    await waitFor(() => {
      expect(screen.getByRole("tooltip")).toHaveTextContent(
        "You do not have permission to create this Label.",
      );
    });
  });

  test("an element of the caller's own comes after the actions", () => {
    render(
      <TableEmptyState
        kind={TableEmptyStateKind.Empty}
        title="No labels yet"
        actions={[{ title: "Create Label", onClick: () => {} }]}
        actionElement={<button data-testid="own-action">Import</button>}
      />,
    );

    const row: HTMLElement = screen.getByTestId(`${ROOT}-actions`);
    const buttons: Array<HTMLElement> = Array.from(
      row.querySelectorAll("button"),
    );

    expect(buttons[buttons.length - 1]).toBe(screen.getByTestId("own-action"));
  });

  test("with no actions there is no empty row of them", () => {
    render(
      <TableEmptyState kind={TableEmptyStateKind.AllClear} title="All clear" />,
    );

    expect(screen.queryByTestId(`${ROOT}-actions`)).toBeNull();
  });

  test("they stack, full width, on a phone and sit in a row from sm up", () => {
    render(
      <TableEmptyState
        kind={TableEmptyStateKind.Empty}
        title="No labels yet"
        actions={[{ title: "Create Label", onClick: () => {} }]}
      />,
    );

    const row: HTMLElement = screen.getByTestId(`${ROOT}-actions`);

    expect(row.className).toContain("flex-col");
    expect(row.className).toContain("sm:flex-row");
    expect(row.querySelector("div")!.className).toContain("w-full");
    expect(row.querySelector("div")!.className).toContain("sm:w-auto");
  });
});

describe("the note", () => {
  test("is small print under the actions, translated", () => {
    dictionary = {
      "You don't have permission to create these. Ask a project admin for access.":
        "Sie haben keine Berechtigung, diese zu erstellen.",
    };

    render(
      <TableEmptyState
        kind={TableEmptyStateKind.Empty}
        title="No labels yet"
        note="You don't have permission to create these. Ask a project admin for access."
      />,
    );

    expect(screen.getByTestId(`${ROOT}-note`)).toHaveTextContent(
      "Sie haben keine Berechtigung, diese zu erstellen.",
    );
  });

  test("is left out when there is nothing to say", () => {
    render(
      <TableEmptyState
        kind={TableEmptyStateKind.Empty}
        title="No labels yet"
      />,
    );

    expect(screen.queryByTestId(`${ROOT}-note`)).toBeNull();
  });
});

describe("its size and hooks", () => {
  test("a table's empty state has room around it; a compact one less", () => {
    const { unmount } = render(
      <TableEmptyState
        kind={TableEmptyStateKind.Empty}
        title="No labels yet"
      />,
    );

    expect(screen.getByTestId(ROOT).className).toContain("py-12");
    unmount();

    render(
      <TableEmptyState
        kind={TableEmptyStateKind.Empty}
        title="No labels yet"
        isCompact={true}
      />,
    );

    expect(screen.getByTestId(ROOT).className).toContain("py-8");
    expect(screen.getByTestId(ROOT).className).not.toContain("py-12");
  });

  test("a caller's own test id names every part", () => {
    render(
      <TableEmptyState
        kind={TableEmptyStateKind.Empty}
        title="No labels yet"
        description="Labels help."
        note="A note."
        actions={[{ title: "Create Label", onClick: () => {} }]}
        dataTestId="labels-empty"
      />,
    );

    expect(screen.getByTestId("labels-empty")).toBeInTheDocument();
    expect(screen.getByTestId("labels-empty-title")).toBeInTheDocument();
    expect(screen.getByTestId("labels-empty-description")).toBeInTheDocument();
    expect(screen.getByTestId("labels-empty-actions")).toBeInTheDocument();
    expect(screen.getByTestId("labels-empty-note")).toBeInTheDocument();
    expect(screen.getByTestId("labels-empty-illustration")).toBeInTheDocument();
  });
});

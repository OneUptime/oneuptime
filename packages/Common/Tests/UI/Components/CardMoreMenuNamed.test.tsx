import "@testing-library/jest-dom";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import React, { ReactElement } from "react";
import IconProp from "../../../Types/Icon/IconProp";
import CardMoreMenu from "../../../UI/Components/Card/CardMoreMenu";
import MoreMenuItem from "../../../UI/Components/MoreMenu/MoreMenuItem";
import { getGlyphOfIcon, getGlyphOfMenuItem } from "./MenuItemIcons";

jest.mock("react-i18next", () => {
  return {
    useTranslation: () => {
      return {
        t: (key: string, options?: { defaultValue?: string }): string => {
          return options?.defaultValue ?? key;
        },
      };
    },
  };
});

/*
 * A card header's ⋯ (CardMoreMenu) is one button wherever it is: three dots,
 * outlined, no visible label. A table's and a feed's are named "More
 * options". A card whose ⋯ holds one thing's actions - an AI agent's Test
 * connection and Reset agent - names it for them instead, and gives it a
 * test id, so a screen reader hears whose options they are; nothing else
 * about the button changes. The items can carry a test id of their own.
 */

function items(): Array<ReactElement> {
  return [
    <MoreMenuItem
      key="test"
      text="Test connection"
      icon={IconProp.Play}
      dataTestId="test-item"
      onClick={() => {}}
    />,
    <MoreMenuItem
      key="refresh"
      text="Refresh"
      icon={IconProp.Refresh}
      onClick={() => {}}
    />,
  ];
}

afterEach(() => {
  cleanup();
});

describe("CardMoreMenu", () => {
  test("is named More options and carries no test id when the card does not name it", () => {
    render(<CardMoreMenu>{items()}</CardMoreMenu>);

    const trigger: HTMLElement = screen.getByRole("button", {
      name: "More options",
    });

    expect(trigger).toHaveAttribute("aria-label", "More options");
    expect(trigger).not.toHaveAttribute("data-testid");
    expect(trigger.textContent).toBe("");
  });

  test("takes the name and the test id a card gives it", () => {
    render(
      <CardMoreMenu ariaLabel="AI agent actions" dataTestId="agent-actions">
        {items()}
      </CardMoreMenu>,
    );

    const trigger: HTMLElement = screen.getByRole("button", {
      name: "AI agent actions",
    });

    expect(trigger).toHaveAttribute("data-testid", "agent-actions");
    expect(trigger).toHaveAttribute("aria-haspopup", "menu");
    expect(
      screen.queryByRole("button", { name: "More options" }),
    ).not.toBeInTheDocument();
  });

  test("a named ⋯ looks exactly like an unnamed one: the dots, no label, the same classes", () => {
    render(<CardMoreMenu>{items()}</CardMoreMenu>);
    const unnamed: HTMLElement = screen.getByRole("button", {
      name: "More options",
    });
    const unnamedClassName: string = unnamed.className;
    const unnamedGlyph: string = getGlyphOfMenuItem(unnamed);
    cleanup();

    render(
      <CardMoreMenu ariaLabel="AI agent actions" dataTestId="agent-actions">
        {items()}
      </CardMoreMenu>,
    );
    const named: HTMLElement = screen.getByRole("button", {
      name: "AI agent actions",
    });

    expect(named.className).toBe(unnamedClassName);
    expect(named.textContent).toBe("");
    expect(getGlyphOfMenuItem(named)).toBe(unnamedGlyph);
    expect(unnamedGlyph).toBe(getGlyphOfIcon(IconProp.EllipsisHorizontal));
  });

  test("an empty name is no name: it falls back to More options", () => {
    render(<CardMoreMenu ariaLabel="">{items()}</CardMoreMenu>);

    expect(
      screen.getByRole("button", { name: "More options" }),
    ).toBeInTheDocument();
  });

  test("its menu is labelled by the button, under the name the card gave it", () => {
    render(<CardMoreMenu ariaLabel="AI agent actions">{items()}</CardMoreMenu>);

    fireEvent.click(screen.getByRole("button", { name: "AI agent actions" }));

    expect(
      screen.getByRole("menu", { name: "AI agent actions" }),
    ).toBeInTheDocument();
  });
});

describe("MoreMenuItem's test id", () => {
  test("is on the item itself, and only on the item that has one", () => {
    render(<CardMoreMenu>{items()}</CardMoreMenu>);
    fireEvent.click(screen.getByRole("button", { name: "More options" }));
    const menu: HTMLElement = screen.getByRole("menu");

    const testItem: HTMLElement = within(menu).getByTestId("test-item");
    expect(testItem).toHaveAttribute("role", "menuitem");
    expect(testItem).toHaveTextContent("Test connection");

    const refresh: HTMLElement = within(menu).getByRole("menuitem", {
      name: "Refresh",
    });
    expect(refresh).not.toHaveAttribute("data-testid");
  });

  test("is on a locked item that explains itself, not on its tooltip", () => {
    render(
      <MoreMenuItem
        text="Test connection"
        icon={IconProp.Play}
        isDisabled={true}
        tooltip="Testing the connection needs permission to edit this cluster."
        dataTestId="locked-item"
        onClick={() => {}}
      />,
    );

    const item: HTMLElement = screen.getByTestId("locked-item");

    expect(item.tagName).toBe("BUTTON");
    expect(item).toHaveAttribute("role", "menuitem");
    expect(item).toHaveAttribute("aria-disabled", "true");
    expect(item).toHaveAccessibleDescription(
      "Testing the connection needs permission to edit this cluster.",
    );
  });

  test("is on a natively locked item too", () => {
    render(
      <MoreMenuItem
        text="Reset agent"
        icon={IconProp.Refresh}
        isDisabled={true}
        dataTestId="busy-item"
        onClick={() => {}}
      />,
    );

    const item: HTMLElement = screen.getByTestId("busy-item");

    expect(item.tagName).toBe("BUTTON");
    expect(item).toBeDisabled();
  });
});

import EmptyState from "../../../../UI/Components/EmptyState/EmptyState";
import Button, {
  ButtonStyleType,
} from "../../../../UI/Components/Button/Button";
import "@testing-library/jest-dom";
import { beforeAll, describe, expect, test } from "@jest/globals";
import { render, screen } from "@testing-library/react";
import { createInstance, i18n } from "i18next";
import IconProp from "../../../../Types/Icon/IconProp";
import React, { ReactElement } from "react";
import { I18nextProvider } from "react-i18next";

const german: i18n = createInstance();

beforeAll(async () => {
  await german.init({
    lng: "de",
    fallbackLng: "de",
    resources: {
      de: {
        translation: {
          "No monitors yet": "Noch keine Monitore",
          "Create one to start monitoring.":
            "Erstellen Sie einen, um mit der Überwachung zu beginnen.",
        },
      },
    },
    interpolation: { escapeValue: false },
  });
});

describe("EmptyState", () => {
  test("renders correctly with all props", () => {
    const { container } = render(
      <EmptyState
        id="empty-state"
        title="Empty State Title"
        description="This is an empty state description"
        icon={IconProp.User}
        footer={<div>This is a footer element</div>}
      />,
    );
    const titleElement: HTMLElement = screen.getByText("Empty State Title");
    const descriptionElement: HTMLElement = screen.getByText(
      "This is an empty state description",
    );
    // The icon renders an inline <svg> (no invalid role="icon"; WCAG 4.1.2).
    const iconElement: Element | null = container.querySelector("svg");
    const footerElement: HTMLElement = screen.getByText(
      "This is a footer element",
    );
    expect(titleElement).toBeInTheDocument();
    expect(descriptionElement).toBeInTheDocument();
    expect(iconElement).not.toBeNull();
    expect(footerElement).toBeInTheDocument();
  });

  test("renders without an icon", () => {
    const { container } = render(
      <EmptyState
        id="empty-state"
        icon={undefined}
        title="Title"
        description="Description"
      />,
    );
    const title: HTMLElement = screen.getByText("Title");
    const description: HTMLElement = screen.getByText("Description");
    expect(title).toBeInTheDocument();
    expect(description).toBeInTheDocument();
    expect(container.querySelector("svg")).toBeNull();
  });

  test("the title is a level-3 heading", () => {
    render(
      <EmptyState
        id="empty-state"
        icon={IconProp.User}
        title="Nothing here"
        description="Description"
      />,
    );

    expect(
      screen.getByRole("heading", { level: 3, name: "Nothing here" }),
    ).toBeInTheDocument();
  });

  test("the root carries the id so a page can target it", () => {
    const { container } = render(
      <EmptyState
        id="monitors-empty-state"
        icon={IconProp.User}
        title="Title"
        description="Description"
      />,
    );

    expect(container.firstElementChild).toHaveAttribute(
      "id",
      "monitors-empty-state",
    );
  });

  /*
   * Inside a wide table an uncapped description ran edge to edge as one
   * line. It is held to a readable measure and centred under the title.
   */
  test("caps the description at a readable width and centres it", () => {
    render(
      <EmptyState
        id="empty-state"
        icon={IconProp.User}
        title="Title"
        description="A long description that would otherwise run edge to edge."
      />,
    );

    const description: HTMLElement = screen.getByTestId(
      "empty-state-description",
    );
    expect(description.tagName).toBe("P");
    expect(description).toHaveClass("max-w-xl", "mx-auto", "leading-6");
    expect(description).toHaveTextContent(
      "A long description that would otherwise run edge to edge.",
    );
  });

  test("the content column spans the full width and centres its text", () => {
    render(
      <EmptyState
        id="empty-state"
        icon={IconProp.User}
        title="Title"
        description="Description"
      />,
    );

    const column: HTMLElement = screen.getByRole("heading", {
      name: "Title",
    }).parentElement as HTMLElement;
    expect(column).toHaveClass("m-auto", "w-full", "text-center");
  });

  /*
   * An OUTLINE Button is a block-level flex box, so under a plain block
   * footer it stretched across the row with its label pinned to the left
   * edge while everything above it was centred.
   */
  test("centres the footer in a flex row", () => {
    render(
      <EmptyState
        id="empty-state"
        icon={IconProp.User}
        title="Title"
        description="Description"
        footer={
          <Button
            title="Read the setup guide"
            icon={IconProp.Book}
            buttonStyle={ButtonStyleType.OUTLINE}
          />
        }
      />,
    );

    const footer: HTMLElement = screen.getByTestId("empty-state-footer");
    expect(footer).toHaveClass("mt-6", "flex", "justify-center");
    expect(footer).toContainElement(
      screen.getByRole("button", { name: "Read the setup guide" }),
    );
  });

  test("renders no footer wrapper without a footer", () => {
    render(
      <EmptyState
        id="empty-state"
        icon={IconProp.User}
        title="Title"
        description="Description"
      />,
    );

    expect(screen.queryByTestId("empty-state-footer")).not.toBeInTheDocument();
  });

  test("the footer's own controls stay interactive", () => {
    const clicks: Array<string> = [];

    render(
      <EmptyState
        id="empty-state"
        icon={IconProp.User}
        title="Title"
        description="Description"
        footer={
          <Button
            title="Create monitor"
            onClick={() => {
              clicks.push("create");
            }}
          />
        }
      />,
    );

    screen.getByRole("button", { name: "Create monitor" }).click();
    expect(clicks).toEqual(["create"]);
  });

  describe("padding", () => {
    test("keeps the tall full-page padding by default", () => {
      const { container } = render(
        <EmptyState
          id="empty-state"
          icon={IconProp.User}
          title="Title"
          description="Description"
        />,
      );

      expect(container.firstElementChild).toHaveClass("pt-52", "pb-52");
    });

    test("uses the caller's padding instead of the default", () => {
      const { container } = render(
        <EmptyState
          id="empty-state"
          icon={IconProp.User}
          title="Title"
          description="Description"
          paddingClassName="py-4"
        />,
      );

      expect(container.firstElementChild).toHaveClass("py-4");
      expect(container.firstElementChild).not.toHaveClass("pt-52");
      expect(container.firstElementChild).not.toHaveClass("pb-52");
    });
  });

  describe("background", () => {
    test("has no card background unless asked", () => {
      const { container } = render(
        <EmptyState
          id="empty-state"
          icon={IconProp.User}
          title="Title"
          description="Description"
        />,
      );

      expect(container.firstElementChild).not.toHaveClass("bg-white");
      expect(container.firstElementChild).not.toHaveClass("shadow");
    });

    test("draws a card background with showSolidBackground", () => {
      const { container } = render(
        <EmptyState
          id="empty-state"
          icon={IconProp.User}
          title="Title"
          description="Description"
          showSolidBackground={true}
        />,
      );

      expect(container.firstElementChild).toHaveClass(
        "bg-white",
        "rounded",
        "shadow",
      );
    });
  });

  describe("icon", () => {
    test("uses the default muted icon size and colour", () => {
      const { container } = render(
        <EmptyState
          id="empty-state"
          icon={IconProp.User}
          title="Title"
          description="Description"
        />,
      );

      const svg: Element | null = container.querySelector("svg");
      expect(svg).toHaveClass("mx-auto", "h-12", "w-12", "text-gray-400");
    });

    test("uses the caller's icon classes when given", () => {
      const { container } = render(
        <EmptyState
          id="empty-state"
          icon={IconProp.User}
          iconClassName="h-6 w-6 text-indigo-500"
          title="Title"
          description="Description"
        />,
      );

      const svg: Element | null = container.querySelector("svg");
      expect(svg).toHaveClass("h-6", "w-6", "text-indigo-500");
      expect(svg).not.toHaveClass("h-12");
    });
  });

  describe("translation", () => {
    test("translates a string title and description", () => {
      render(
        <I18nextProvider i18n={german}>
          <EmptyState
            id="empty-state"
            icon={IconProp.User}
            title="No monitors yet"
            description="Create one to start monitoring."
          />
        </I18nextProvider>,
      );

      expect(
        screen.getByRole("heading", { name: "Noch keine Monitore" }),
      ).toBeInTheDocument();
      expect(screen.getByTestId("empty-state-description")).toHaveTextContent(
        "Erstellen Sie einen, um mit der Überwachung zu beginnen.",
      );
    });

    test("falls back to the source text without a translation", () => {
      render(
        <I18nextProvider i18n={german}>
          <EmptyState
            id="empty-state"
            icon={IconProp.User}
            title="Untranslated title"
            description="Untranslated description"
          />
        </I18nextProvider>,
      );

      expect(
        screen.getByRole("heading", { name: "Untranslated title" }),
      ).toBeInTheDocument();
      expect(screen.getByTestId("empty-state-description")).toHaveTextContent(
        "Untranslated description",
      );
    });

    test("renders element titles and descriptions as given", () => {
      const title: ReactElement = (
        <span data-testid="custom-title">Custom title</span>
      );
      const description: ReactElement = (
        <span data-testid="custom-description">Custom description</span>
      );

      render(
        <I18nextProvider i18n={german}>
          <EmptyState
            id="empty-state"
            icon={IconProp.User}
            title={title}
            description={description}
          />
        </I18nextProvider>,
      );

      expect(screen.getByTestId("custom-title")).toHaveTextContent(
        "Custom title",
      );
      expect(screen.getByTestId("empty-state-description")).toContainElement(
        screen.getByTestId("custom-description"),
      );
    });
  });
});

import EmptyState, {
  ComponentProps,
} from "../../../../UI/Components/EmptyState/EmptyState";
import Button, {
  ButtonStyleType,
} from "../../../../UI/Components/Button/Button";
import "@testing-library/jest-dom";
import { beforeAll, describe, expect, test } from "@jest/globals";
import {
  cleanup,
  fireEvent,
  render,
  RenderResult,
  screen,
} from "@testing-library/react";
import IconProp from "../../../../Types/Icon/IconProp";
import getJestMockFunction, { MockFunction } from "../../../MockType";
import fs from "fs";
import { createInstance, i18n } from "i18next";
import path from "path";
import React, { ReactElement, ReactNode } from "react";
import { I18nextProvider } from "react-i18next";

/*
 * EmptyState is shared by more than a hundred screens. Its footer used to be
 * a bare block that relied on the parent's text-center, which cannot centre
 * a block-level flex Button (OUTLINE fills the row and left-aligns its
 * label), and the description ran the full page width on one line. These
 * tests pin the layout that fixed that for every caller, while keeping the
 * 13rem default padding that NetworkMap and SiteContainerGraph cancel with
 * negative margins.
 */

const ROOT_ID: string = "empty-state";

const german: i18n = createInstance();

beforeAll(async () => {
  await german.init({
    lng: "de",
    fallbackLng: "de",
    resources: {
      de: {
        translation: {
          "Nothing here yet": "Noch nichts hier",
          "Add a monitor to get started.":
            "Fügen Sie einen Monitor hinzu, um zu beginnen.",
          "Footer text": "Fußzeilentext",
        },
      },
    },
    interpolation: { escapeValue: false },
  });
});

type GermanWrapperFunction = (props: { children?: ReactNode }) => ReactElement;

const GermanWrapper: GermanWrapperFunction = ({
  children,
}: {
  children?: ReactNode;
}): ReactElement => {
  return <I18nextProvider i18n={german}>{children}</I18nextProvider>;
};

type RenderEmptyStateFunction = (
  props?: Partial<ComponentProps>,
) => RenderResult;

const renderEmptyState: RenderEmptyStateFunction = (
  props?: Partial<ComponentProps>,
): RenderResult => {
  const emptyStateProps: ComponentProps = {
    id: ROOT_ID,
    icon: IconProp.ShieldCheck,
    title: "Nothing here yet",
    description: "Add a monitor to get started.",
    ...props,
  };

  return render(<EmptyState {...emptyStateProps} />);
};

type GetRootFunction = () => HTMLElement;

const getRoot: GetRootFunction = (): HTMLElement => {
  const root: HTMLElement | null = document.getElementById(ROOT_ID);

  if (!root) {
    throw new Error(`EmptyState root #${ROOT_ID} was not rendered`);
  }

  return root;
};

type GetFooterWrapperFunction = (footerText: string) => HTMLElement;

const getFooterWrapper: GetFooterWrapperFunction = (
  footerText: string,
): HTMLElement => {
  const wrapper: HTMLElement | null =
    screen.getByText(footerText).parentElement;

  if (!wrapper) {
    throw new Error(`"${footerText}" has no parent element`);
  }

  return wrapper;
};

const FOOTER_ROW_CLASSES: Array<string> = [
  "mt-6",
  "flex",
  "flex-wrap",
  "items-center",
  "justify-center",
  "gap-3",
  "[&_button]:ml-0",
];

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
});

describe("EmptyState structure", () => {
  test("puts the id on the outer element", () => {
    renderEmptyState();

    expect(getRoot()).toHaveClass("flex");
    expect(getRoot()).toContainElement(screen.getByText("Nothing here yet"));
  });

  test("renders the title as a level-3 heading", () => {
    renderEmptyState();

    const heading: HTMLElement = screen.getByRole("heading", { level: 3 });

    expect(heading).toHaveTextContent("Nothing here yet");
    expect(heading).toHaveClass("text-sm", "font-medium", "text-gray-900");
  });

  test("centres the content column", () => {
    renderEmptyState();

    const column: HTMLElement | null =
      screen.getByText("Nothing here yet").parentElement;

    expect(column).toHaveClass("m-auto", "text-center");
    expect(column?.parentElement).toBe(getRoot());
  });

  test("renders ReactElement titles and descriptions as given", () => {
    renderEmptyState({
      title: <span data-testid="custom-title">Custom title</span>,
      description: (
        <span data-testid="custom-description">
          Read <a href="/docs">the docs</a>
        </span>
      ),
    });

    expect(screen.getByRole("heading", { level: 3 })).toContainElement(
      screen.getByTestId("custom-title"),
    );
    expect(screen.getByTestId("custom-description")).toHaveTextContent(
      "Read the docs",
    );
    expect(screen.getByRole("link", { name: "the docs" })).toHaveAttribute(
      "href",
      "/docs",
    );
  });
});

describe("EmptyState description", () => {
  test("wraps to a readable, centred measure", () => {
    renderEmptyState();

    const description: HTMLElement = screen.getByText(
      "Add a monitor to get started.",
    );

    expect(description.tagName).toBe("P");
    expect(description).toHaveClass(
      "mx-auto",
      "mt-1",
      "max-w-lg",
      "text-sm",
      "text-gray-500",
    );
  });

  test("keeps the measure for a long description", () => {
    const longDescription: string =
      "Any source that can POST JSON — a SIEM, a SOAR webhook, a log forwarder — can feed this table. Events are normalized to OCSF whatever dialect they arrive in.";

    renderEmptyState({ description: longDescription });

    expect(screen.getByText(longDescription)).toHaveClass(
      "max-w-lg",
      "mx-auto",
    );
  });
});

describe("EmptyState padding", () => {
  test("defaults to 13rem top and bottom", () => {
    renderEmptyState();

    expect(getRoot()).toHaveClass("pt-52", "pb-52");
  });

  test("an override replaces the default entirely", () => {
    renderEmptyState({ paddingClassName: "py-12" });

    expect(getRoot()).toHaveClass("flex", "py-12");
    expect(getRoot()).not.toHaveClass("pt-52");
    expect(getRoot()).not.toHaveClass("pb-52");
  });

  test("an override may carry several classes", () => {
    renderEmptyState({ paddingClassName: "px-4 py-12" });

    expect(getRoot()).toHaveClass("px-4", "py-12");
    expect(getRoot()).not.toHaveClass("pt-52");
  });

  test("an empty override falls back to the default", () => {
    renderEmptyState({ paddingClassName: "" });

    expect(getRoot()).toHaveClass("pt-52", "pb-52");
  });
});

describe("EmptyState background", () => {
  test("is transparent by default", () => {
    renderEmptyState();

    expect(getRoot()).not.toHaveClass("bg-white");
    expect(getRoot()).not.toHaveClass("shadow");
  });

  test("showSolidBackground draws a white card", () => {
    renderEmptyState({ showSolidBackground: true });

    expect(getRoot()).toHaveClass("bg-white", "rounded", "shadow");
  });
});

describe("EmptyState icon", () => {
  test("uses the default size and colour", () => {
    const { container } = renderEmptyState();
    const icon: SVGElement | null = container.querySelector("svg");

    expect(icon).not.toBeNull();
    expect(icon).toHaveClass("mx-auto", "h-12", "w-12", "text-gray-400");
  });

  test("iconClassName replaces the default classes", () => {
    const { container } = renderEmptyState({
      iconClassName: "h-8 w-8 text-indigo-500",
    });
    const icon: SVGElement | null = container.querySelector("svg");

    expect(icon).toHaveClass("h-8", "w-8", "text-indigo-500");
    expect(icon).not.toHaveClass("h-12");
    expect(icon).not.toHaveClass("text-gray-400");
  });
});

describe("EmptyState footer", () => {
  test("wraps the footer in a centred flex row", () => {
    renderEmptyState({ footer: <span>Footer text</span> });

    const wrapper: HTMLElement = getFooterWrapper("Footer text");

    for (const className of FOOTER_ROW_CLASSES) {
      expect(wrapper).toHaveClass(className);
    }
  });

  test("the row sits after the description inside the content column", () => {
    renderEmptyState({ footer: <span>Footer text</span> });

    const wrapper: HTMLElement = getFooterWrapper("Footer text");
    const description: HTMLElement = screen.getByText(
      "Add a monitor to get started.",
    );

    expect(wrapper.parentElement).toBe(description.parentElement);
    expect(description.nextElementSibling).toBe(wrapper);
  });

  test("centres a lone Button and cancels its left margin", () => {
    const onClick: MockFunction = getJestMockFunction();

    renderEmptyState({
      footer: (
        <Button
          title="Read the setup guide"
          icon={IconProp.Book}
          buttonStyle={ButtonStyleType.NORMAL}
          onClick={onClick}
        />
      ),
    });

    const button: HTMLElement = screen.getByRole("button", {
      name: "Read the setup guide",
    });
    const wrapper: HTMLElement | null = button.parentElement;

    expect(wrapper).toHaveClass("flex", "justify-center", "items-center");
    /*
     * Button carries md:ml-3 for toolbars; the row's descendant rule is what
     * stops that from nudging the button off centre.
     */
    expect(button).toHaveClass("md:ml-3");
    expect(wrapper).toHaveClass("[&_button]:ml-0");

    fireEvent.click(button);

    expect(onClick).toHaveBeenCalledTimes(1);
  });

  test("centres a block-level OUTLINE Button too", () => {
    renderEmptyState({
      footer: (
        <Button title="Outline action" buttonStyle={ButtonStyleType.OUTLINE} />
      ),
    });

    const button: HTMLElement = screen.getByRole("button", {
      name: "Outline action",
    });

    // OUTLINE is display:flex, which text-center alone never centred.
    expect(button).toHaveClass("flex");
    expect(button.parentElement).toHaveClass("flex", "justify-center");
  });

  test("lays a Fragment of buttons out side by side in one row", () => {
    const onPrimary: MockFunction = getJestMockFunction();
    const onSecondary: MockFunction = getJestMockFunction();

    renderEmptyState({
      footer: (
        <React.Fragment>
          <Button
            title="Create monitor"
            buttonStyle={ButtonStyleType.PRIMARY}
            onClick={onPrimary}
          />
          <Button
            title="Read the docs"
            buttonStyle={ButtonStyleType.NORMAL}
            onClick={onSecondary}
          />
        </React.Fragment>
      ),
    });

    const buttons: Array<HTMLElement> = screen.getAllByRole("button");

    expect(buttons).toHaveLength(2);
    expect(buttons[0]).toHaveAccessibleName("Create monitor");
    expect(buttons[1]).toHaveAccessibleName("Read the docs");

    const wrapper: HTMLElement | null = buttons[0]!.parentElement;

    expect(buttons[1]!.parentElement).toBe(wrapper);
    expect(wrapper).toHaveClass("flex", "flex-wrap", "gap-3");
    expect(wrapper?.children).toHaveLength(2);

    fireEvent.click(buttons[1]!);

    expect(onSecondary).toHaveBeenCalledTimes(1);
    expect(onPrimary).not.toHaveBeenCalled();
  });

  test("renders no footer row without a footer", () => {
    const { container } = renderEmptyState();

    const column: HTMLElement | null =
      screen.getByText("Nothing here yet").parentElement;

    expect(container.querySelector(".justify-center")).toBeNull();
    expect(container.querySelector(".mt-6")).toBeNull();
    // Icon, heading and description only.
    expect(column?.children).toHaveLength(3);
  });

  test("renders no footer row for an explicit undefined footer", () => {
    const { container } = renderEmptyState({ footer: undefined });

    expect(container.querySelector(".justify-center")).toBeNull();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});

describe("EmptyState translation", () => {
  test("translates string titles and descriptions", () => {
    render(
      <EmptyState
        id={ROOT_ID}
        icon={IconProp.ShieldCheck}
        title="Nothing here yet"
        description="Add a monitor to get started."
      />,
      { wrapper: GermanWrapper },
    );

    expect(
      screen.getByRole("heading", { level: 3, name: "Noch nichts hier" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Fügen Sie einen Monitor hinzu, um zu beginnen.")
        .tagName,
    ).toBe("P");
    expect(screen.queryByText("Nothing here yet")).not.toBeInTheDocument();
  });

  test("leaves the footer to the caller", () => {
    render(
      <EmptyState
        id={ROOT_ID}
        icon={undefined}
        title="Nothing here yet"
        description="Add a monitor to get started."
        footer={<span>Footer text</span>}
      />,
      { wrapper: GermanWrapper },
    );

    expect(screen.getByText("Footer text")).toBeInTheDocument();
    expect(screen.queryByText("Fußzeilentext")).not.toBeInTheDocument();
  });

  test("falls back to the English string when no entry exists", () => {
    render(
      <EmptyState
        id={ROOT_ID}
        icon={undefined}
        title="Untranslated title"
        description="Untranslated description"
      />,
      { wrapper: GermanWrapper },
    );

    expect(screen.getByText("Untranslated title")).toBeInTheDocument();
    expect(screen.getByText("Untranslated description")).toBeInTheDocument();
  });
});

describe("EmptyState dark theme", () => {
  test("uses only colour classes the dark theme remaps", () => {
    const themeCss: string = fs.readFileSync(
      path.join(__dirname, "..", "..", "..", "..", "UI", "Styles", "Theme.css"),
      "utf8",
    );
    const colourClass: RegExp = /^(bg|border|text)-(white|[a-z]+-\d{2,3})$/;
    const used: Set<string> = new Set<string>();

    const variants: Array<Partial<ComponentProps>> = [
      {},
      { showSolidBackground: true },
      { footer: <span>Footer text</span> },
    ];

    for (const variant of variants) {
      renderEmptyState(variant);

      const root: HTMLElement = getRoot();

      for (const element of [root, ...Array.from(root.querySelectorAll("*"))]) {
        const className: string = element.getAttribute("class") || "";

        for (const token of className.split(/\s+/)) {
          if (colourClass.test(token)) {
            used.add(token);
          }
        }
      }

      cleanup();
    }

    expect(used.size).toBeGreaterThan(0);
    expect(Array.from(used)).toEqual(
      expect.arrayContaining(["text-gray-900", "text-gray-500", "bg-white"]),
    );

    for (const token of Array.from(used)) {
      expect({
        token: token,
        remapped: new RegExp(`\\.${token}(?![\\w-])`).test(themeCss),
      }).toEqual({ token: token, remapped: true });
    }
  });
});

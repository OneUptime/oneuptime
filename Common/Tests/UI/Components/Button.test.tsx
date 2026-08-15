import Button, {
  ButtonSize,
  ButtonStyleType,
  ComponentProps,
} from "../../../UI/Components/Button/Button";
import ButtonType from "../../../UI/Components/Button/ButtonTypes";
import ShortcutKey from "../../../UI/Components/ShortcutKey/ShortcutKey";
import "@testing-library/jest-dom";
import { fireEvent, render, screen } from "@testing-library/react";
import IconProp from "../../../Types/Icon/IconProp";
import React from "react";
import { describe, expect, jest } from "@jest/globals";

describe("Button", () => {
  test("it should render correctly with title and icon", () => {
    const { container } = render(
      <Button
        dataTestId="test-id"
        title="sample title"
        disabled={true}
        type={ButtonType.Button}
        icon={IconProp.Add}
      />,
    );
    const title: HTMLElement = screen.getByText("sample title");
    const testId: HTMLElement = screen.getByTestId("test-id");

    expect(title).toBeInTheDocument();
    expect(testId).toBeInTheDocument();
    expect(testId).toHaveAttribute("type", "button");
    expect(testId).toHaveAttribute("disabled");
    // The icon renders an inline <svg> (no invalid role="icon"; WCAG 4.1.2).
    expect(container.querySelector("svg")).not.toBeNull();
  });

  test("it should have shortcutKey Setting", () => {
    render(<Button dataTestId="test-id" shortcutKey={ShortcutKey.Settings} />);
    const testId: HTMLElement = screen.getByTestId("test-id");

    expect(testId).toHaveTextContent(ShortcutKey.Settings);
  });

  test("it should have buttonStyle NORMAL", () => {
    render(
      <Button dataTestId="test-id" buttonStyle={ButtonStyleType.NORMAL} />,
    );
    const testId: HTMLElement = screen.getByTestId("test-id");

    expect(testId).toHaveClass(
      "inline-flex w-full justify-center rounded-md border border-gray-300 bg-white text-base font-medium text-gray-700 shadow-sm hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 md:mt-0 md:ml-3 md:w-auto md:text-sm px-3 py-2",
    );
  });

  test("it should have buttonStyle DANGER", () => {
    render(
      <Button dataTestId="test-id" buttonStyle={ButtonStyleType.DANGER} />,
    );
    const testId: HTMLElement = screen.getByTestId("test-id");

    expect(testId).toHaveClass(
      "inline-flex w-full justify-center rounded-md border border-transparent bg-red-600 text-base font-medium text-white shadow-sm focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2 md:ml-3 md:w-auto md:text-sm px-3 py-2",
    );
  });

  test("it should have buttonStyle DANGER_OUTLINE", () => {
    render(
      <Button
        dataTestId="test-id"
        buttonStyle={ButtonStyleType.DANGER_OUTLINE}
      />,
    );
    const testId: HTMLElement = screen.getByTestId("test-id");

    expect(testId).toHaveClass(
      "inline-flex w-full justify-center rounded-md border border-red-700 bg-white text-base font-medium text-red-700 shadow-sm focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2 md:mt-0 md:ml-3 md:w-auto md:text-sm px-3 py-2",
    );
  });

  test("it should have buttonStyle PRIMARY", () => {
    render(
      <Button dataTestId="test-id" buttonStyle={ButtonStyleType.PRIMARY} />,
    );
    const testId: HTMLElement = screen.getByTestId("test-id");

    expect(testId).toHaveClass(
      "inline-flex w-full justify-center rounded-md border border-transparent bg-indigo-600 text-base font-medium text-white shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 md:ml-3 md:w-auto md:text-sm px-3 py-2",
    );
  });

  test("it should have buttonStyle SECONDARY", () => {
    render(
      <Button dataTestId="test-id" buttonStyle={ButtonStyleType.SECONDARY} />,
    );
    const testId: HTMLElement = screen.getByTestId("test-id");

    expect(testId).toHaveClass(
      "inline-flex items-center rounded-md border border-transparent bg-indigo-100 text-sm font-medium text-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 px-3 py-2",
    );
  });

  test("it should have buttonStyle OUTLINE", () => {
    render(
      <Button dataTestId="test-id" buttonStyle={ButtonStyleType.NORMAL} />,
    );
    const testId: HTMLElement = screen.getByTestId("test-id");

    expect(testId).toHaveClass(
      "inline-flex w-full justify-center rounded-md border border-gray-300 bg-white text-base font-medium text-gray-700 shadow-sm hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 md:mt-0 md:ml-3 md:w-auto md:text-sm px-3 py-2",
    );
  });

  test("it should have buttonStyle SUCCESS", () => {
    render(
      <Button dataTestId="test-id" buttonStyle={ButtonStyleType.SUCCESS} />,
    );
    const testId: HTMLElement = screen.getByTestId("test-id");

    expect(testId).toHaveClass(
      "inline-flex w-full justify-center rounded-md border border-transparent bg-green-600 text-base font-medium text-white shadow-sm focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2 md:ml-3 md:w-auto md:text-sm px-3 py-2",
    );
  });

  test("it should have buttonStyle SUCCESS_OUTLINE", () => {
    render(
      <Button
        dataTestId="test-id"
        buttonStyle={ButtonStyleType.SUCCESS_OUTLINE}
      />,
    );
    const testId: HTMLElement = screen.getByTestId("test-id");

    expect(testId).toHaveClass(
      "inline-flex w-full justify-center rounded-md border border-green-700 bg-white text-base font-medium text-green-700 shadow-sm focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2 md:mt-0 md:ml-3 md:w-auto md:text-sm px-3 py-2",
    );
  });

  test("it should have buttonStyle WARNING", () => {
    render(
      <Button dataTestId="test-id" buttonStyle={ButtonStyleType.WARNING} />,
    );
    const testId: HTMLElement = screen.getByTestId("test-id");

    expect(testId).toHaveClass(
      "inline-flex w-full justify-center rounded-md border border-transparent bg-yellow-600 text-base font-medium text-white shadow-sm focus:outline-none focus:ring-2 focus:ring-yellow-500 focus:ring-offset-2 md:ml-3 md:w-auto md:text-sm px-3 py-2",
    );
  });

  test("it should have buttonStyle WARNING_OUTLINE", () => {
    render(
      <Button
        dataTestId="test-id"
        buttonStyle={ButtonStyleType.WARNING_OUTLINE}
      />,
    );
    const testId: HTMLElement = screen.getByTestId("test-id");

    expect(testId).toHaveClass(
      " inline-flex w-full justify-center rounded-md border border-yellow-700 bg-white text-base font-medium text-yellow-700 shadow-sm focus:outline-none focus:ring-2 focus:ring-yellow-500 focus:ring-offset-2 md:mt-0 md:ml-3 md:w-auto md:text-sm px-3 py-2",
    );
  });

  test("it should have buttonSize Normal", () => {
    render(<Button dataTestId="test-id" buttonSize={ButtonSize.Normal} />);
    const testId: HTMLElement = screen.getByTestId("test-id");

    expect(testId).toHaveClass(
      " inline-flex w-full justify-center rounded-md border border-gray-300 bg-white text-base font-medium text-gray-700 shadow-sm hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 md:mt-0 md:ml-3 md:w-auto md:text-sm px-3 py-2",
    );
  });

  test("it should have buttonSize Small", () => {
    render(<Button dataTestId="test-id" buttonSize={ButtonSize.Small} />);
    const testId: HTMLElement = screen.getByTestId("test-id");

    expect(testId).toHaveClass(
      "inline-flex w-full justify-center rounded-md border border-gray-300 bg-white text-base font-medium text-gray-700 shadow-sm hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 md:mt-0 md:ml-3 md:w-auto md:text-sm px-2 py-1",
    );
  });

  test("it should have buttonSize Large", () => {
    render(<Button dataTestId="test-id" buttonSize={ButtonSize.Large} />);
    const testId: HTMLElement = screen.getByTestId("test-id");

    expect(testId).toHaveClass(
      " inline-flex w-full justify-center rounded-md border border-gray-300 bg-white text-base font-medium text-gray-700 shadow-sm hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 md:mt-0 md:ml-3 md:w-auto md:text-sm px-4 py-2",
    );
  });

  test("it should be enabled", () => {
    render(<Button dataTestId="test-id" disabled={false} />);
    const testId: HTMLElement = screen.getByTestId("test-id");

    expect(testId).not.toBeDisabled();
  });

  test("it should handle onClick event", () => {
    const handleClick: undefined | (() => void) = jest.fn();
    render(<Button dataTestId="test-id" onClick={handleClick} />);
    const testId: HTMLElement = screen.getByTestId("test-id");
    fireEvent.click(testId);
    expect(handleClick).toBeCalled();
  });
});

type RenderButtonFunction = (props: Partial<ComponentProps>) => HTMLElement;

const renderButton: RenderButtonFunction = (
  props: Partial<ComponentProps>,
): HTMLElement => {
  const { unmount } = render(<Button dataTestId="test-id" {...props} />);
  const button: HTMLElement = screen.getByTestId("test-id");
  // Clone so assertions survive the unmount and each case starts from a clean DOM.
  const clone: HTMLElement = button.cloneNode(true) as HTMLElement;
  unmount();
  return clone;
};

type ClassesOfFunction = (element: HTMLElement) => Array<string>;

const classesOf: ClassesOfFunction = (element: HTMLElement): Array<string> => {
  return element.className.split(/\s+/).filter((cssClass: string) => {
    return cssClass.length > 0;
  });
};

/*
 * Every ButtonStyleType, so new styles are covered by the invariants below
 * without anyone having to remember to add them here.
 */
const ALL_BUTTON_STYLES: Array<[string, ButtonStyleType]> = Object.keys(
  ButtonStyleType,
)
  .filter((key: string) => {
    return isNaN(Number(key));
  })
  .map((key: string) => {
    return [key, ButtonStyleType[key as keyof typeof ButtonStyleType]] as [
      string,
      ButtonStyleType,
    ];
  });

describe("Button disabled styling", () => {
  /*
   * The regression this suite exists for: the disabled background used to be
   * appended alongside the enabled one, and Tailwind emits .bg-indigo-300
   * before .bg-indigo-600, so the enabled colour won the cascade and every
   * disabled primary button rendered at full saturation.
   */
  test("disabled PRIMARY does not carry the enabled background class", () => {
    const button: HTMLElement = renderButton({
      buttonStyle: ButtonStyleType.PRIMARY,
      disabled: true,
    });

    expect(button).not.toHaveClass("bg-indigo-600");
    expect(button).toHaveClass("bg-indigo-300");
  });

  test("disabled SECONDARY does not carry the enabled background class", () => {
    const button: HTMLElement = renderButton({
      buttonStyle: ButtonStyleType.SECONDARY,
      disabled: true,
    });

    expect(button).not.toHaveClass("bg-indigo-100");
    expect(button).toHaveClass("bg-indigo-300");
  });

  test("enabled PRIMARY keeps the enabled background and no disabled background", () => {
    const button: HTMLElement = renderButton({
      buttonStyle: ButtonStyleType.PRIMARY,
      disabled: false,
    });

    expect(button).toHaveClass("bg-indigo-600");
    expect(button).not.toHaveClass("bg-indigo-300");
  });

  test("enabled SECONDARY keeps the enabled background and no disabled background", () => {
    const button: HTMLElement = renderButton({
      buttonStyle: ButtonStyleType.SECONDARY,
      disabled: false,
    });

    expect(button).toHaveClass("bg-indigo-100");
    expect(button).not.toHaveClass("bg-indigo-300");
  });

  test("an omitted disabled prop styles PRIMARY as enabled", () => {
    const button: HTMLElement = renderButton({
      buttonStyle: ButtonStyleType.PRIMARY,
    });

    expect(button).toHaveClass("bg-indigo-600");
    expect(button).not.toHaveClass("bg-indigo-300");
  });

  test("an omitted disabled prop styles SECONDARY as enabled", () => {
    const button: HTMLElement = renderButton({
      buttonStyle: ButtonStyleType.SECONDARY,
    });

    expect(button).toHaveClass("bg-indigo-100");
    expect(button).not.toHaveClass("bg-indigo-300");
  });

  test.each(ALL_BUTTON_STYLES)(
    "%s emits at most one background utility when disabled",
    (_name: string, buttonStyle: ButtonStyleType) => {
      const button: HTMLElement = renderButton({ buttonStyle, disabled: true });

      const backgrounds: Array<string> = classesOf(button).filter(
        (cssClass: string) => {
          return cssClass.startsWith("bg-");
        },
      );

      expect(backgrounds.length).toBeLessThanOrEqual(1);
    },
  );

  test.each(ALL_BUTTON_STYLES)(
    "%s emits at most one background utility when enabled",
    (_name: string, buttonStyle: ButtonStyleType) => {
      const button: HTMLElement = renderButton({
        buttonStyle,
        disabled: false,
      });

      const backgrounds: Array<string> = classesOf(button).filter(
        (cssClass: string) => {
          return cssClass.startsWith("bg-");
        },
      );

      expect(backgrounds.length).toBeLessThanOrEqual(1);
    },
  );

  const DIMMING_STYLES: Array<[string, ButtonStyleType]> = [
    ["PRIMARY", ButtonStyleType.PRIMARY],
    ["SECONDARY", ButtonStyleType.SECONDARY],
  ];

  test.each(DIMMING_STYLES)(
    "%s resolves to a different background when disabled",
    (_name: string, buttonStyle: ButtonStyleType) => {
      type BackgroundOfFunction = (disabled: boolean) => string | undefined;

      const backgroundOf: BackgroundOfFunction = (
        disabled: boolean,
      ): string | undefined => {
        return classesOf(renderButton({ buttonStyle, disabled })).find(
          (cssClass: string) => {
            return cssClass.startsWith("bg-");
          },
        );
      };

      const enabled: string | undefined = backgroundOf(false);
      const disabled: string | undefined = backgroundOf(true);

      expect(enabled).toBeDefined();
      expect(disabled).toBeDefined();
      expect(disabled).not.toBe(enabled);
    },
  );
});

describe("Button hover styling", () => {
  /*
   * Hover affordances are gated on `disabled`; the ternary used to be inverted,
   * so hover styles applied to exactly the buttons that could not be clicked.
   */
  const HOVER_GATED_STYLES: Array<[string, ButtonStyleType, string]> = [
    ["PRIMARY", ButtonStyleType.PRIMARY, "hover:bg-indigo-700"],
    ["SECONDARY", ButtonStyleType.SECONDARY, "hover:bg-indigo-200"],
    ["DANGER", ButtonStyleType.DANGER, "hover:bg-red-700"],
    ["DANGER_OUTLINE", ButtonStyleType.DANGER_OUTLINE, "hover:bg-red-50"],
    ["SUCCESS", ButtonStyleType.SUCCESS, "hover:bg-green-700"],
    ["SUCCESS_OUTLINE", ButtonStyleType.SUCCESS_OUTLINE, "hover:bg-green-50"],
    ["WARNING", ButtonStyleType.WARNING, "hover:bg-yellow-700"],
    ["WARNING_OUTLINE", ButtonStyleType.WARNING_OUTLINE, "hover:bg-yellow-50"],
    ["ICON", ButtonStyleType.ICON, "hover:text-gray-900"],
    ["ICON_LIGHT", ButtonStyleType.ICON_LIGHT, "hover:text-gray-500"],
  ];

  test.each(HOVER_GATED_STYLES)(
    "%s applies its hover class only when enabled",
    (_name: string, buttonStyle: ButtonStyleType, hoverClass: string) => {
      expect(renderButton({ buttonStyle, disabled: false })).toHaveClass(
        hoverClass,
      );
      expect(renderButton({ buttonStyle, disabled: true })).not.toHaveClass(
        hoverClass,
      );
    },
  );
});

describe("Button class list composition", () => {
  test("the size class is appended for every style", () => {
    ALL_BUTTON_STYLES.forEach(([, buttonStyle]: [string, ButtonStyleType]) => {
      expect(
        renderButton({ buttonStyle, buttonSize: ButtonSize.Small }),
      ).toHaveClass("px-2", "py-1");
    });
  });

  test("a caller-supplied className is appended alongside the style classes", () => {
    const button: HTMLElement = renderButton({
      buttonStyle: ButtonStyleType.PRIMARY,
      className: "my-custom-class",
      disabled: true,
    });

    expect(button).toHaveClass("my-custom-class");
    expect(button).toHaveClass("bg-indigo-300");
  });

  test("every style resolves to a non-empty class list in both states", () => {
    ALL_BUTTON_STYLES.forEach(([, buttonStyle]: [string, ButtonStyleType]) => {
      [true, false].forEach((disabled: boolean) => {
        expect(
          classesOf(renderButton({ buttonStyle, disabled })).length,
        ).toBeGreaterThan(0);
      });
    });
  });

  test("no style emits a class twice", () => {
    ALL_BUTTON_STYLES.forEach(([, buttonStyle]: [string, ButtonStyleType]) => {
      [true, false].forEach((disabled: boolean) => {
        const classes: Array<string> = classesOf(
          renderButton({ buttonStyle, disabled }),
        );

        expect(classes).toHaveLength(new Set(classes).size);
      });
    });
  });
});

describe("Button disabled behaviour", () => {
  test("a disabled button is marked disabled to assistive technology", () => {
    const button: HTMLElement = renderButton({
      buttonStyle: ButtonStyleType.PRIMARY,
      disabled: true,
    });

    expect(button).toHaveAttribute("disabled");
    expect(button).toHaveAttribute("aria-disabled", "true");
  });

  test("a loading button is disabled", () => {
    const button: HTMLElement = renderButton({
      buttonStyle: ButtonStyleType.PRIMARY,
      isLoading: true,
    });

    expect(button).toHaveAttribute("disabled");
    expect(button).toHaveAttribute("aria-disabled", "true");
  });

  test("a disabled button does not fire onClick", () => {
    const handleClick: () => void = jest.fn();
    render(
      <Button
        dataTestId="test-id"
        buttonStyle={ButtonStyleType.PRIMARY}
        disabled={true}
        onClick={handleClick}
      />,
    );

    fireEvent.click(screen.getByTestId("test-id"));

    expect(handleClick).not.toBeCalled();
  });
});

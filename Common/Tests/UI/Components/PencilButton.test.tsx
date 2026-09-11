import IconProp from "../../../Types/Icon/IconProp";
import Button, {
  ButtonSize,
  ButtonStyleType,
} from "../../../UI/Components/Button/Button";
import { describe, expect, it, jest } from "@jest/globals";
import "@testing-library/jest-dom";
import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";

const BUTTON_STYLES: Array<[string, ButtonStyleType]> = Object.keys(
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

const BUTTON_SIZES: Array<[string, ButtonSize]> = [
  ["extra small", ButtonSize.ExtraSmall],
  ["small", ButtonSize.Small],
  ["normal", ButtonSize.Normal],
  ["large", ButtonSize.Large],
];

/*
 * Render the real Button -> Icon stack. The glyph's proportions are covered
 * by IconOpticalSize; these checks protect the space and alignment around it
 * and the edit action that users reach through each button variant.
 */
describe.each([IconProp.Edit, IconProp.Pencil])(
  "%s buttons",
  (icon: IconProp) => {
    it.each(BUTTON_STYLES)(
      "centers the icon and preserves its accessible name in the %s style",
      (_name: string, buttonStyle: ButtonStyleType) => {
        render(
          <Button title="Edit Project" icon={icon} buttonStyle={buttonStyle} />,
        );

        const button: HTMLElement = screen.getByRole("button", {
          name: "Edit Project",
        });
        const svg: SVGSVGElement | null = button.querySelector("svg");
        const path: SVGPathElement | null = button.querySelector("path");

        // Centering matters when a mobile label has a 24px line height and the
        // icon occupies 20px. jsdom cannot lay out these boxes; the shared class
        // is the CSS contract also exercised by the browser regression.
        expect(button).toHaveClass("items-center");
        expect(button).toBeEnabled();
        expect(svg).toHaveClass("w-5", "h-5");
        expect(svg).toHaveAttribute("viewBox", "0 0 24 24");
        expect(svg).toHaveAttribute("stroke-width", "1.5");
        expect(svg).toHaveAttribute("stroke", "currentColor");
        expect(svg).toHaveAttribute("aria-hidden", "true");
        expect(path).toHaveAttribute("stroke-linecap", "round");
        expect(path).toHaveAttribute("stroke-linejoin", "round");
        expect(screen.queryByRole("img")).not.toBeInTheDocument();

        if (
          buttonStyle === ButtonStyleType.ICON ||
          buttonStyle === ButtonStyleType.ICON_LIGHT
        ) {
          expect(svg).toHaveClass("m-1");
          expect(button).toHaveAttribute("aria-label", "Edit Project");
        } else {
          expect(svg).toHaveClass("mr-1");
        }

        if (buttonStyle === ButtonStyleType.ICON) {
          expect(button).not.toHaveTextContent("Edit Project");
        } else {
          expect(button).toHaveTextContent("Edit Project");
        }
      },
    );

    it.each(BUTTON_SIZES)(
      "retains the icon footprint and padding in a %s button",
      (_name: string, buttonSize: ButtonSize) => {
        render(
          <Button title="Edit Project" icon={icon} buttonSize={buttonSize} />,
        );

        const button: HTMLElement = screen.getByRole("button", {
          name: "Edit Project",
        });

        expect(button).toHaveClass(...buttonSize.split(" "), "items-center");
        expect(button.querySelector("svg")).toHaveClass("w-5", "h-5", "mr-1");
      },
    );

    it.each([ButtonStyleType.NORMAL, ButtonStyleType.ICON])(
      "invokes edit once when the pencil is clicked in style %s",
      (buttonStyle: ButtonStyleType) => {
        const onClick: ReturnType<typeof jest.fn> = jest.fn();
        render(
          <Button
            title="Edit Project"
            icon={icon}
            buttonStyle={buttonStyle}
            onClick={onClick}
          />,
        );

        const button: HTMLElement = screen.getByRole("button", {
          name: "Edit Project",
        });
        const path: SVGPathElement | null = button.querySelector("path");

        expect(path).not.toBeNull();
        fireEvent.click(path as SVGPathElement);
        expect(onClick).toHaveBeenCalledTimes(1);
      },
    );

    it.each([ButtonStyleType.NORMAL, ButtonStyleType.ICON])(
      "keeps a disabled edit action inert in style %s",
      (buttonStyle: ButtonStyleType) => {
        const onClick: ReturnType<typeof jest.fn> = jest.fn();
        render(
          <Button
            title="Edit Project"
            icon={icon}
            buttonStyle={buttonStyle}
            disabled={true}
            onClick={onClick}
          />,
        );

        const button: HTMLElement = screen.getByRole("button", {
          name: "Edit Project",
        });
        const path: SVGPathElement | null = button.querySelector("path");

        expect(button).toBeDisabled();
        expect(button).toHaveAttribute("aria-disabled", "true");
        expect(path).not.toBeNull();
        fireEvent.click(path as SVGPathElement);
        expect(onClick).not.toHaveBeenCalled();
      },
    );

    it("replaces the pencil with a centered spinner while an edit action loads", () => {
      const onClick: ReturnType<typeof jest.fn> = jest.fn();
      const { rerender } = render(
        <Button title="Edit Project" icon={icon} onClick={onClick} />,
      );
      const button: HTMLElement = screen.getByRole("button", {
        name: "Edit Project",
      });

      expect(button.querySelector("svg")).not.toHaveClass("animate-spin");

      rerender(
        <Button
          title="Edit Project"
          icon={icon}
          isLoading={true}
          onClick={onClick}
        />,
      );

      expect(button).toBeDisabled();
      expect(button).toHaveClass("items-center");
      expect(button.querySelectorAll("svg")).toHaveLength(1);
      expect(button.querySelector("svg")).toHaveClass(
        "animate-spin",
        "w-5",
        "h-5",
      );
      fireEvent.click(button);
      expect(onClick).not.toHaveBeenCalled();

      rerender(<Button title="Edit Project" icon={icon} onClick={onClick} />);

      expect(button).toBeEnabled();
      expect(button.querySelectorAll("svg")).toHaveLength(1);
      expect(button.querySelector("svg")).not.toHaveClass("animate-spin");
      fireEvent.click(button);
      expect(onClick).toHaveBeenCalledTimes(1);
    });

    it("retains an explicit accessible name for an icon-only edit action", () => {
      render(
        <Button
          icon={icon}
          buttonStyle={ButtonStyleType.ICON}
          title="Edit"
          ariaLabel="Rename project"
        />,
      );

      expect(
        screen.getByRole("button", { name: "Rename project" }),
      ).toBeEnabled();
      expect(
        screen.queryByRole("button", { name: "Edit" }),
      ).not.toBeInTheDocument();
    });
  },
);

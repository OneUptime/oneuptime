import Color from "../../../Types/Color";
import IconProp from "../../../Types/Icon/IconProp";
import Alert, {
  AlertSize,
  AlertType,
  ComponentProps,
} from "../../../UI/Components/Alerts/Alert";
import Icon from "../../../UI/Components/Icon/Icon";
import "@testing-library/jest-dom";
import { beforeAll, describe, expect, jest, test } from "@jest/globals";
import {
  act,
  fireEvent,
  render,
  RenderResult,
  screen,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createInstance, i18n } from "i18next";
import React, { FormEvent, ReactElement, ReactNode } from "react";
import { I18nextProvider } from "react-i18next";

const english: i18n = createInstance();

beforeAll(async () => {
  await english.init({
    lng: "en",
    fallbackLng: "en",
    resources: { en: { translation: {} } },
    interpolation: { escapeValue: false },
  });
});

type TranslationWrapperFunction = (props: {
  children?: ReactNode;
}) => ReactElement;

const TranslationWrapper: TranslationWrapperFunction = ({
  children,
}: {
  children?: ReactNode;
}): ReactElement => {
  return <I18nextProvider i18n={english}>{children}</I18nextProvider>;
};

type RenderAlertFunction = (props?: ComponentProps) => RenderResult;

const renderAlert: RenderAlertFunction = (
  props: ComponentProps = {},
): RenderResult => {
  return render(<Alert {...props} />, { wrapper: TranslationWrapper });
};

interface AlertVariant {
  name: string;
  type: AlertType;
  background: string;
  border: string;
  icon: IconProp;
}

const variants: Array<AlertVariant> = [
  {
    name: "information",
    type: AlertType.INFO,
    background: "bg-blue-50",
    border: "border-blue-200",
    icon: IconProp.Info,
  },
  {
    name: "success",
    type: AlertType.SUCCESS,
    background: "bg-emerald-50",
    border: "border-emerald-200",
    icon: IconProp.CheckCircle,
  },
  {
    name: "warning",
    type: AlertType.WARNING,
    background: "bg-amber-50",
    border: "border-amber-200",
    icon: IconProp.Alert,
  },
  {
    name: "danger",
    type: AlertType.DANGER,
    background: "bg-red-50",
    border: "border-red-200",
    icon: IconProp.Alert,
  },
];

describe("Alert variants and accessibility", () => {
  test.each(variants)(
    "$name has a distinct, softly tinted surface and the correct decorative icon",
    ({ type, background, border, icon }: AlertVariant) => {
      renderAlert({ type, title: "Status message" });

      const alert: HTMLElement = screen.getByRole("alert");
      const leadingIcon: SVGSVGElement | null = alert.querySelector("svg");
      const expectedIcon: RenderResult = render(<Icon icon={icon} />);

      expect(alert).toHaveAttribute("aria-live", "polite");
      expect(alert).toHaveClass(background, border, "border", "rounded-lg");
      expect(leadingIcon).toHaveAttribute("aria-hidden", "true");
      expect(leadingIcon?.innerHTML).toBe(
        expectedIcon.container.querySelector("svg")?.innerHTML,
      );
      expect(within(alert).queryByRole("img")).not.toBeInTheDocument();
    },
  );

  test("defaults to the information appearance when no type is passed", () => {
    renderAlert({ title: "Helpful information" });

    expect(screen.getByRole("alert")).toHaveClass(
      "bg-blue-50",
      "border-blue-200",
    );
  });

  test.each(variants)(
    "a custom icon overrides the $name icon",
    ({ type }: AlertVariant) => {
      renderAlert({ type, icon: IconProp.Billing, title: "Billing notice" });

      const actualIcon: SVGSVGElement | null = screen
        .getByRole("alert")
        .querySelector("svg");
      const expectedIcon: RenderResult = render(<Icon icon={IconProp.Billing} />);

      expect(actualIcon?.innerHTML).toBe(
        expectedIcon.container.querySelector("svg")?.innerHTML,
      );
    },
  );

  test("hiding the icon removes its entire badge, even with an override", () => {
    renderAlert({
      type: AlertType.DANGER,
      icon: IconProp.Billing,
      doNotShowIcon: true,
      title: "Important information",
    });

    const alert: HTMLElement = screen.getByRole("alert");
    expect(alert.querySelector(".alert-icon")).not.toBeInTheDocument();
    expect(alert.querySelector("svg")).not.toBeInTheDocument();
    expect(screen.getByText("Important information")).toBeVisible();
  });

  test("hiding the leading icon preserves the accessible dismiss button", () => {
    renderAlert({ doNotShowIcon: true, onClose: jest.fn() });

    const closeButton: HTMLElement = screen.getByRole("button", {
      name: "Close",
    });
    expect(closeButton.querySelector("svg")).toHaveAttribute(
      "aria-hidden",
      "true",
    );
    expect(screen.getByRole("alert").querySelectorAll("svg")).toHaveLength(1);
  });

  test("updates the surface and icon when the severity changes", () => {
    const { rerender } = renderAlert({ type: AlertType.INFO, title: "Status" });

    rerender(<Alert type={AlertType.SUCCESS} title="Status" />);

    const alert: HTMLElement = screen.getByRole("alert");
    const expectedIcon: RenderResult = render(<Icon icon={IconProp.CheckCircle} />);
    expect(alert).toHaveClass("bg-emerald-50", "border-emerald-200");
    expect(alert).not.toHaveClass("bg-blue-50", "border-blue-200");
    expect(alert.querySelector("svg")?.innerHTML).toBe(
      expectedIcon.container.querySelector("svg")?.innerHTML,
    );
  });
});

describe("Alert content and caller customizations", () => {
  test("separates the heading from the message without inserting a hyphen", () => {
    renderAlert({
      strongTitle: "Danger zone",
      title: "Deleting this project cannot be undone.",
    });

    const heading: HTMLElement = screen.getByText("Danger zone");
    const message: HTMLElement = screen.getByText(
      "Deleting this project cannot be undone.",
    );

    expect(heading).not.toContainElement(message);
    expect(heading.nextElementSibling).toContainElement(message);
    expect(screen.getByRole("alert").textContent).not.toContain(" - ");
  });

  test.each([
    { props: { strongTitle: "Heading only" }, expected: "Heading only" },
    { props: { title: "Message only" }, expected: "Message only" },
    {
      props: { strongTitle: "", title: "Message only" },
      expected: "Message only",
    },
    {
      props: { strongTitle: "Heading only", title: "" },
      expected: "Heading only",
    },
  ])(
    "renders the supplied content without empty separators: $expected",
    ({ props, expected }: { props: ComponentProps; expected: string }) => {
      renderAlert(props);

      expect(screen.getByRole("alert")).toHaveTextContent(expected);
      expect(screen.getByRole("alert").textContent?.trim()).toBe(expected);
    },
  );

  test("supports an alert with no text without rendering undefined values", () => {
    renderAlert();

    const alert: HTMLElement = screen.getByRole("alert");
    expect(alert.textContent).toBe("");
    expect(alert.className).not.toContain("undefined");
    expect(alert.querySelector(".alert-text")?.className).not.toContain(
      "undefined",
    );
  });

  test("preserves rich message markup and interactive callbacks", () => {
    const onAction: () => void = jest.fn();
    const onAlertClick: () => void = jest.fn();
    renderAlert({
      strongTitle: "Action required",
      onClick: onAlertClick,
      title: (
        <div>
          <p>
            Review the <a href="/settings">project settings</a>.
          </p>
          <button type="button" onClick={onAction}>
            Review now
          </button>
        </div>
      ),
    });

    expect(screen.getByRole("link", { name: "project settings" })).toHaveAttribute(
      "href",
      "/settings",
    );
    fireEvent.click(screen.getByRole("button", { name: "Review now" }));
    expect(onAction).toHaveBeenCalledTimes(1);
    expect(onAlertClick).not.toHaveBeenCalled();
    expect(screen.getByText("Action required")).toBeVisible();
  });

  test("keeps supplementary text available alongside the message", () => {
    renderAlert({ title: "Trial active", textOnRight: "12 days remaining" });

    expect(screen.getByText("Trial active")).toBeVisible();
    expect(screen.getByText("12 days remaining")).toBeVisible();
  });

  test("renders supplementary text even without a title", () => {
    renderAlert({ textOnRight: "12 days remaining" });

    expect(screen.getByRole("alert")).toHaveTextContent("12 days remaining");
  });

  test("preserves caller identifiers and class customization hooks", () => {
    renderAlert({
      id: "project-warning",
      dataTestId: "danger-banner",
      className: "caller-alert-class",
      textClassName: "caller-text-class",
      title: "Warning",
    });

    const alert: HTMLElement = screen.getByTestId("danger-banner");
    expect(alert).toHaveAttribute("id", "project-warning");
    expect(alert).toHaveClass("caller-alert-class");
    expect(alert.querySelector(".alert-text")).toHaveClass("caller-text-class");
  });

  test("preserves a custom filled background with a white foreground", () => {
    renderAlert({ color: new Color("#123456"), title: "Custom banner" });

    const alert: HTMLElement = screen.getByRole("alert");
    expect(alert).toHaveStyle({ backgroundColor: "#123456" });
    expect(alert).toHaveClass("text-white", "border-transparent");
  });

  test.each([
    { label: "default", size: undefined, expected: "text-sm", absent: "text-lg" },
    {
      label: "normal",
      size: AlertSize.Normal,
      expected: "text-sm",
      absent: "text-lg",
    },
    {
      label: "large",
      size: AlertSize.Large,
      expected: "text-lg",
      absent: "text-sm",
    },
  ])("uses a single message size for $label alerts", ({ size, expected, absent }) => {
    renderAlert({ size, title: "Readable message" });

    const message: Element | null = screen
      .getByRole("alert")
      .querySelector(".alert-message");
    expect(message).toHaveClass(expected);
    expect(message).not.toHaveClass(absent);
  });
});

describe("Alert actions and dismissal", () => {
  test("does not render a button without an action or onClose callback", () => {
    renderAlert({ title: "Persistent notice" });

    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  test("clicking the message invokes the alert callback once", () => {
    const onClick: () => void = jest.fn();
    renderAlert({ title: "Clickable message", onClick });

    fireEvent.click(screen.getByText("Clickable message"));

    expect(onClick).toHaveBeenCalledTimes(1);
  });

  test.each(["{Enter}", " "])(
    "supports activating the alert action with %s",
    async (key: string) => {
      const user: ReturnType<typeof userEvent.setup> = userEvent.setup();
      const onClick: () => void = jest.fn();
      renderAlert({ title: "View incident", onClick });

      const action: HTMLElement = screen.getByRole("button", { name: "View incident" });
      expect(action).toHaveAttribute("type", "button");
      await user.tab();
      expect(action).toHaveFocus();
      await user.keyboard(key);

      expect(onClick).toHaveBeenCalledTimes(1);
    },
  );

  test("dismisses without triggering the alert or its parent's click action", () => {
    const onClose: () => void = jest.fn();
    const onAlertClick: () => void = jest.fn();
    const onParentClick: () => void = jest.fn();
    render(
      <div onClick={onParentClick}>
        <Alert title="Dismiss this notice" onClick={onAlertClick} onClose={onClose} />
      </div>,
      { wrapper: TranslationWrapper },
    );

    const closeButton: HTMLElement = screen.getByRole("button", { name: "Close" });
    fireEvent.click(closeButton);

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onAlertClick).not.toHaveBeenCalled();
    expect(onParentClick).not.toHaveBeenCalled();
    expect(closeButton).toHaveAttribute("type", "button");
    expect(closeButton).not.toHaveAttribute("role", "alert-close-button");
  });

  test("clicking the dismiss icon also avoids the alert's click action", () => {
    const onClose: () => void = jest.fn();
    const onClick: () => void = jest.fn();
    renderAlert({ onClose, onClick });

    const closeIcon: SVGSVGElement | null = screen
      .getByRole("button", { name: "Close" })
      .querySelector("svg");
    expect(closeIcon).not.toBeNull();
    fireEvent.click(closeIcon!);

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onClick).not.toHaveBeenCalled();
  });

  test("dismissing an alert inside a form does not submit the form", async () => {
    const user: ReturnType<typeof userEvent.setup> = userEvent.setup();
    const onClose: () => void = jest.fn();
    const onSubmit: () => void = jest.fn();
    render(
      <form
        onSubmit={(event: FormEvent<HTMLFormElement>) => {
          event.preventDefault();
          onSubmit();
        }}
      >
        <Alert title="Check your input" onClose={onClose} />
      </form>,
      { wrapper: TranslationWrapper },
    );

    await user.click(screen.getByRole("button", { name: "Close" }));

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  test.each(["{Enter}", " "])(
    "supports keyboard dismissal with %s",
    async (key: string) => {
      const user: ReturnType<typeof userEvent.setup> = userEvent.setup();
      const onClose: () => void = jest.fn();
      const onClick: () => void = jest.fn();
      renderAlert({ title: "Dismiss with the keyboard", onClose, onClick });

      const closeButton: HTMLElement = screen.getByRole("button", { name: "Close" });
      closeButton.focus();
      expect(closeButton).toHaveFocus();
      await user.keyboard(key);

      expect(onClose).toHaveBeenCalledTimes(1);
      expect(onClick).not.toHaveBeenCalled();
    },
  );

  test("updates the dismiss callback and removes the control when it is unset", () => {
    const firstOnClose: () => void = jest.fn();
    const nextOnClose: () => void = jest.fn();
    const { rerender } = renderAlert({ onClose: firstOnClose });

    rerender(<Alert onClose={nextOnClose} />);
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(nextOnClose).toHaveBeenCalledTimes(1);
    expect(firstOnClose).not.toHaveBeenCalled();

    rerender(<Alert />);
    expect(screen.queryByRole("button", { name: "Close" })).not.toBeInTheDocument();
  });
});

describe("Alert translation integration", () => {
  test("translates all plain-text content and the accessible dismiss label", async () => {
    const translations: i18n = createInstance();
    await translations.init({
      lng: "fr",
      fallbackLng: "en",
      resources: {
        fr: {
          translation: {
            "Danger zone": "Zone de danger",
            "Project: v1.0": "Projet : v1.0",
            "12 days remaining": "12 jours restants",
            Close: "Fermer",
          },
        },
      },
      interpolation: { escapeValue: false },
    });

    render(
      <I18nextProvider i18n={translations}>
        <Alert
          strongTitle="Danger zone"
          title="Project: v1.0"
          textOnRight="12 days remaining"
          onClose={jest.fn()}
        />
      </I18nextProvider>,
    );

    expect(screen.getByText("Zone de danger")).toBeVisible();
    expect(screen.getByText("Projet : v1.0")).toBeVisible();
    expect(screen.getByText("12 jours restants")).toBeVisible();
    expect(screen.getByRole("button", { name: "Fermer" })).toBeVisible();
    expect(screen.queryByRole("button", { name: "Close" })).not.toBeInTheDocument();

    await act(async () => {
      await translations.changeLanguage("en");
    });

    expect(screen.getByText("Danger zone")).toBeVisible();
    expect(screen.getByText("Project: v1.0")).toBeVisible();
    expect(screen.getByRole("button", { name: "Close" })).toBeVisible();
  });

  test("preserves rich JSX while translating surrounding strings", async () => {
    const translations: i18n = createInstance();
    await translations.init({
      lng: "fr",
      resources: {
        fr: {
          translation: {
            "Action required": "Action requise",
            "Project settings": "Paramètres du projet",
          },
        },
      },
    });

    render(
      <I18nextProvider i18n={translations}>
        <Alert
          strongTitle="Action required"
          title={<a href="/settings">Project settings</a>}
        />
      </I18nextProvider>,
    );

    expect(screen.getByText("Action requise")).toBeVisible();
    expect(screen.getByRole("link", { name: "Project settings" })).toHaveAttribute(
      "href",
      "/settings",
    );
  });
});

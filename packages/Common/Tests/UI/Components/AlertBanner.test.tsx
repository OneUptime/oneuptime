import IconProp from "../../../Types/Icon/IconProp";
import AlertBanner, {
  ALERT_BANNER_ACTION_PLACE_CLASS_NAME,
  ALERT_BANNER_ACTION_TEST_ID,
  ALERT_BANNER_BODY_PLACE_CLASS_NAME,
  ALERT_BANNER_CONTENT_CLASS_NAME,
  ALERT_BANNER_LAYOUT_CLASS_NAME,
  ALERT_BANNER_TITLE_PLACE_CLASS_NAME,
  AlertBannerType,
  ComponentProps,
} from "../../../UI/Components/AlertBanner/AlertBanner";
import "@testing-library/jest-dom";
import { beforeAll, describe, expect, test } from "@jest/globals";
import {
  cleanup,
  render,
  RenderResult,
  screen,
  within,
} from "@testing-library/react";
import fs from "fs";
import { createInstance, i18n } from "i18next";
import path from "path";
import React, { ReactElement, ReactNode } from "react";
import { I18nextProvider } from "react-i18next";

/*
 * AlertBanner is shared by the SLO notice banner, the Kubernetes node
 * pressure warning and the Runner key warning. It was restyled from a loud
 * full-bleed tinted block into a compact callout, and these tests pin what
 * that restyle promised every caller:
 *
 *  - Info and Success read as context (neutral surface, polite role), only
 *    Warning and Danger ask for attention (tint, assertive role);
 *  - the title stays its own text node, so callers' getByText still works;
 *  - rightElement, className, children, icon and dataTestId pass through;
 *  - every colour class is one the dashboard's hand-written dark theme
 *    remaps, so no variant renders as a white box on a dark page.
 */

const english: i18n = createInstance();

beforeAll(async () => {
  await english.init({
    lng: "en",
    fallbackLng: "en",
    resources: {
      en: {
        translation: {
          "Window not measured": "Fenster nicht gemessen",
        },
      },
    },
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

type RenderBannerFunction = (
  props: Partial<ComponentProps> & { type: AlertBannerType },
) => RenderResult;

const renderBanner: RenderBannerFunction = (
  props: Partial<ComponentProps> & { type: AlertBannerType },
): RenderResult => {
  const bannerProps: ComponentProps = {
    title: "Heads up",
    dataTestId: "banner",
    ...props,
  };

  return render(<AlertBanner {...bannerProps} />, {
    wrapper: TranslationWrapper,
  });
};

interface BannerVariant {
  name: string;
  type: AlertBannerType;
  surface: Array<string>;
  role: "alert" | "status";
}

const VARIANTS: Array<BannerVariant> = [
  {
    name: "Info",
    type: AlertBannerType.Info,
    surface: ["bg-white", "border-gray-200"],
    role: "status",
  },
  {
    name: "Success",
    type: AlertBannerType.Success,
    surface: ["bg-white", "border-gray-200"],
    role: "status",
  },
  {
    name: "Warning",
    type: AlertBannerType.Warning,
    surface: ["bg-amber-50", "border-amber-200"],
    role: "alert",
  },
  {
    name: "Danger",
    type: AlertBannerType.Danger,
    surface: ["bg-red-50", "border-red-200"],
    role: "alert",
  },
];

function bannerSvgMarkup(type: AlertBannerType, icon?: IconProp): string {
  const { unmount } = renderBanner({ type: type, icon: icon });
  const markup: string =
    screen.getByTestId("banner").querySelector("svg")?.innerHTML || "";
  unmount();
  return markup;
}

describe("AlertBanner", () => {
  describe.each(VARIANTS)("$name", (variant: BannerVariant) => {
    test("uses its surface and a compact callout shape", () => {
      renderBanner({ type: variant.type });

      const banner: HTMLElement = screen.getByTestId("banner");

      for (const className of variant.surface) {
        expect(banner).toHaveClass(className);
      }

      expect(banner).toHaveClass("rounded-lg", "border", "px-4", "py-3");
      expect(banner).not.toHaveClass("p-4");
    });

    test(`announces itself with role="${variant.role}"`, () => {
      renderBanner({ type: variant.type });

      expect(screen.getByTestId("banner")).toHaveAttribute(
        "role",
        variant.role,
      );
    });

    test("keeps the title as its own text node at body size", () => {
      renderBanner({ type: variant.type });

      const title: HTMLElement = screen.getByText("Heads up");

      expect(title.tagName).toBe("P");
      expect(title.childNodes).toHaveLength(1);
      expect(title.firstChild?.nodeType).toBe(Node.TEXT_NODE);
      expect(title).toHaveClass("text-sm", "font-semibold");
      expect(title).not.toHaveClass("text-lg");
    });

    test("leads with a decorative icon", () => {
      renderBanner({ type: variant.type });

      const banner: HTMLElement = screen.getByTestId("banner");
      const svg: SVGElement | null = banner.querySelector("svg");

      expect(svg).not.toBeNull();
      expect(
        svg!.compareDocumentPosition(screen.getByText("Heads up")) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
      // The title already says what kind of banner this is.
      expect(within(banner).queryByRole("img")).toBeNull();
    });

    test("uses the icon a caller passes instead of its default", () => {
      expect(bannerSvgMarkup(variant.type, IconProp.Archive)).not.toBe(
        bannerSvgMarkup(variant.type),
      );
      expect(bannerSvgMarkup(variant.type, IconProp.Archive)).toBe(
        bannerSvgMarkup(AlertBannerType.Info, IconProp.Archive),
      );
    });
  });

  test("Info and Success carry no tint — only problems do", () => {
    for (const type of [AlertBannerType.Info, AlertBannerType.Success]) {
      renderBanner({ type: type });

      expect(screen.getByTestId("banner").className).not.toMatch(
        /\bbg-[a-z]+-50\b/,
      );

      cleanup();
    }
  });

  test("gives each type a default icon of its own", () => {
    const markups: Array<string> = VARIANTS.map(
      (variant: BannerVariant): string => {
        return bannerSvgMarkup(variant.type);
      },
    );

    expect(new Set(markups).size).toBe(VARIANTS.length);
  });

  test("renders children in the body under the title", () => {
    renderBanner({
      type: AlertBannerType.Warning,
      children: <span>Only a Project Owner can read this key.</span>,
    });

    const body: HTMLElement = screen.getByText(
      "Only a Project Owner can read this key.",
    ).parentElement as HTMLElement;

    expect(body).toHaveClass("text-sm", "text-gray-600");
    expect(
      screen.getByText("Heads up").compareDocumentPosition(body) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  test("renders no empty body without children", () => {
    renderBanner({ type: AlertBannerType.Info });

    expect(
      screen.getByTestId("banner").querySelector(".text-gray-600"),
    ).toBeNull();
  });

  test("passes rightElement through", () => {
    renderBanner({
      type: AlertBannerType.Info,
      rightElement: <button type="button">Open Settings</button>,
    });

    expect(
      within(screen.getByTestId("banner")).getByRole("button", {
        name: "Open Settings",
      }),
    ).toBeInTheDocument();
  });

  /*
   * The action acts on what the sentence says (#8034): on a 390px phone,
   * or beside a long Danish title, it wrapped under the title and sat
   * between the title and the sentence it acts on. It comes after the
   * sentence now - in the page's order, which a screen reader and Tab
   * follow, and on screen while the banner is narrow - and stays at the
   * end of the title's line where the banner has room for both.
   */
  describe("its action", () => {
    const TITLE: string = "Denne arbejdsgang er arkiveret";
    const SENTENCE: string =
      'Den køres ikke af nogen trigger og er skjult på listen "Arbejdsgange". Fjern den fra arkivet for at få den tilbage.';

    function renderArchivedBanner(): {
      title: HTMLElement;
      body: HTMLElement;
      action: HTMLElement;
      button: HTMLElement;
    } {
      renderBanner({
        type: AlertBannerType.Warning,
        title: TITLE,
        children: <span>{SENTENCE}</span>,
        rightElement: <button type="button">Fjern fra arkivet</button>,
      });

      const button: HTMLElement = screen.getByRole("button", {
        name: "Fjern fra arkivet",
      });

      return {
        title: screen.getByText(TITLE),
        body: screen.getByText(SENTENCE).parentElement as HTMLElement,
        action: screen.getByTestId(ALERT_BANNER_ACTION_TEST_ID),
        button: button,
      };
    }

    function follows(first: Node, second: Node): boolean {
      return Boolean(
        first.compareDocumentPosition(second) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      );
    }

    test("comes after the sentence it acts on, which comes after the title", () => {
      const { title, body, action, button } = renderArchivedBanner();

      expect(action).toContainElement(button);
      expect(follows(title, body)).toBe(true);
      expect(follows(body, action)).toBe(true);
      // The title, the sentence and the action, in that order, in one box.
      expect(Array.from(title.parentElement!.children)).toEqual([
        title,
        body,
        action,
      ]);
    });

    test("is reached by Tab after the sentence: nothing focusable comes before it", () => {
      const { title, body, button } = renderArchivedBanner();
      const banner: HTMLElement = screen.getByTestId("banner");
      const focusable: Array<Element> = Array.from(
        banner.querySelectorAll("button, a[href], input, [tabindex]"),
      );

      expect(focusable).toEqual([button]);
      expect(follows(title, button)).toBe(true);
      expect(follows(body, button)).toBe(true);
    });

    test("is laid out by the banner's own width, not the window's", () => {
      const { title } = renderArchivedBanner();
      const layout: HTMLElement = title.parentElement as HTMLElement;
      const content: HTMLElement = layout.parentElement as HTMLElement;

      expect(content.className).toBe(ALERT_BANNER_CONTENT_CLASS_NAME);
      expect(content).toHaveClass("[container-type:inline-size]");
      expect(layout.className).toBe(ALERT_BANNER_LAYOUT_CLASS_NAME);
      // No window breakpoint decides it: a banner sits in narrow cards too.
      for (const element of [content, ...Array.from(content.querySelectorAll("*"))]) {
        expect(element.getAttribute("class") || "").not.toMatch(
          /(^|\s)(sm|md|lg|xl|2xl):/,
        );
      }
    });

    test("narrow, it starts under the sentence; wide, it ends the title's line", () => {
      const { title, body, action } = renderArchivedBanner();

      // One column: title, sentence, action - the action at its start.
      expect(ALERT_BANNER_LAYOUT_CLASS_NAME).toContain(
        "grid-cols-[minmax(0,1fr)]",
      );
      expect(action).toHaveClass("justify-self-start", "mt-3");
      // From 32rem, the title and the action share the first line.
      expect(ALERT_BANNER_LAYOUT_CLASS_NAME).toContain(
        "[@container(min-width:32rem)]:grid-cols-[minmax(0,1fr)_auto]",
      );
      expect(title).toHaveClass(
        "[@container(min-width:32rem)]:col-start-1",
        "[@container(min-width:32rem)]:row-start-1",
      );
      expect(action).toHaveClass(
        "[@container(min-width:32rem)]:col-start-2",
        "[@container(min-width:32rem)]:row-start-1",
        "[@container(min-width:32rem)]:justify-self-end",
        "[@container(min-width:32rem)]:mt-0",
      );
      // ...and the sentence runs under both.
      expect(body).toHaveClass(
        "[@container(min-width:32rem)]:col-span-2",
        "[@container(min-width:32rem)]:row-start-2",
      );
    });

    test("is placed by start and end, so it mirrors on a page read from the right", () => {
      const { action } = renderArchivedBanner();
      const placement: string = [
        ALERT_BANNER_LAYOUT_CLASS_NAME,
        ALERT_BANNER_TITLE_PLACE_CLASS_NAME,
        ALERT_BANNER_BODY_PLACE_CLASS_NAME,
        ALERT_BANNER_ACTION_PLACE_CLASS_NAME,
      ].join(" ");

      expect(action.className).toBe(ALERT_BANNER_ACTION_PLACE_CLASS_NAME);
      expect(placement).not.toMatch(/\b(left|right)\b|\b[mp][lr]-|text-(left|right)/);
    });

    test("a banner with an action and no sentence keeps the title first", () => {
      renderBanner({
        type: AlertBannerType.Info,
        title: "Monitoring is turned off",
        rightElement: <button type="button">Turn monitoring on</button>,
      });

      const title: HTMLElement = screen.getByText("Monitoring is turned off");
      const action: HTMLElement = screen.getByTestId(
        ALERT_BANNER_ACTION_TEST_ID,
      );

      expect(Array.from(title.parentElement!.children)).toEqual([
        title,
        action,
      ]);
    });

    test("a banner with no action draws no box for one", () => {
      renderBanner({
        type: AlertBannerType.Info,
        children: <span>Only words.</span>,
      });

      expect(screen.queryByTestId(ALERT_BANNER_ACTION_TEST_ID)).toBeNull();
    });
  });

  test("appends the caller's className to its own", () => {
    renderBanner({ type: AlertBannerType.Danger, className: "mb-5 w-full" });

    expect(screen.getByTestId("banner")).toHaveClass(
      "mb-5",
      "w-full",
      "rounded-lg",
    );
  });

  test("renders without a test id when none is given", () => {
    const { container } = render(
      <AlertBanner title="No id" type={AlertBannerType.Info} />,
      { wrapper: TranslationWrapper },
    );

    expect(
      (container.firstChild as HTMLElement).hasAttribute("data-testid"),
    ).toBe(false);
    expect(screen.getByText("No id")).toBeInTheDocument();
  });

  test("translates the title", () => {
    renderBanner({ type: AlertBannerType.Info, title: "Window not measured" });

    expect(screen.getByText("Fenster nicht gemessen")).toBeInTheDocument();
  });

  /*
   * A title a page words itself - a count in its language's form, "3 Regeln
   * haben Probleme ..." - is in the reader's words already, and is drawn as
   * given (#8296). Looked up again, a translation that is itself an English
   * key would come back as another word: here the page's words are the key
   * "Window not measured", and the banner must not turn them into German.
   */
  test("draws a title said to be translated as given, never looking it up again", () => {
    renderBanner({
      type: AlertBannerType.Warning,
      title: "Window not measured",
      isTitleTranslated: true,
    });

    expect(screen.getByText("Window not measured")).toBeInTheDocument();
    expect(screen.queryByText("Fenster nicht gemessen")).toBeNull();
  });

  test("looks a title up when it is not said to be translated", () => {
    renderBanner({
      type: AlertBannerType.Warning,
      title: "Window not measured",
      isTitleTranslated: false,
    });

    expect(screen.getByText("Fenster nicht gemessen")).toBeInTheDocument();
  });

  /*
   * The dashboard's dark theme is a list of specific classes remapped under
   * html.dark in Theme.css. A colour class outside that list keeps its light
   * value on a dark page — a white banner in the middle of a dark screen.
   */
  test("uses only colour classes the dark theme remaps", () => {
    const themeCss: string = fs.readFileSync(
      path.join(__dirname, "..", "..", "..", "UI", "Styles", "Theme.css"),
      "utf8",
    );
    const colourClass: RegExp = /^(bg|border|text)-(white|[a-z]+-\d{2,3})$/;
    const used: Set<string> = new Set<string>();

    for (const variant of VARIANTS) {
      renderBanner({
        type: variant.type,
        children: <span>Body</span>,
      });

      const banner: HTMLElement = screen.getByTestId("banner");

      for (const element of [
        banner,
        ...Array.from(banner.querySelectorAll("*")),
      ]) {
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

    for (const token of Array.from(used)) {
      expect({
        token: token,
        remapped: new RegExp(`\\.${token}(?![\\w-])`).test(themeCss),
      }).toEqual({ token: token, remapped: true });
    }
  });
});

import React from "react";
import {
  Alert,
  Image,
  Linking as ReactNativeLinking,
  StyleSheet,
} from "react-native";
import {
  render,
  screen,
  fireEvent,
  waitFor,
} from "@testing-library/react-native";
import { describe, expect, test, beforeEach, afterEach } from "@jest/globals";
import AsyncStorage from "@react-native-async-storage/async-storage";
import MarkdownContent, { createMarkdownStyles } from "./MarkdownContent";
import { ThemeProvider, darkColors, lightColors } from "../theme";
import { typography } from "../theme/tokens";

let mockSystemScheme: "light" | "dark" | null = "light";

/*
 * Both the app theme and react-native-marked read the device appearance
 * through this module, so replacing it drives the two together.
 */
jest.mock("react-native/Libraries/Utilities/useColorScheme", () => {
  return {
    __esModule: true,
    default: (): "light" | "dark" | null => {
      return mockSystemScheme;
    },
  };
});

/*
 * Every piece of prose the server sends comes through here: an incident
 * description, a feed entry, a monitor's notes. Two properties matter.
 *
 * The first is that whatever the server sent renders as text rather than as a
 * crash or as JSON. These fields are not always strings - the API wraps some
 * of them in a { _type, value } envelope, and nulls the rest - and a detail
 * screen that throws while rendering its own description takes the entire
 * screen down with it.
 *
 * The second is the links. A responder taps a runbook link in the middle of an
 * outage; if nothing on the handset can open it, they must be TOLD, not left
 * tapping a link that silently does nothing while they wonder whether the app
 * has frozen.
 */

const mockOpenUrl: jest.Mock = jest.fn();

jest.mock("expo-linking", () => {
  return {
    openURL: (url: string) => {
      return mockOpenUrl(url);
    },
  };
});

type Rendered = ReturnType<typeof screen.getByText>;

function renderedTextCount(): number {
  return screen.container.queryAll((node: Rendered) => {
    return node.type === "Text";
  }).length;
}

beforeEach(async () => {
  mockSystemScheme = "light";
  await AsyncStorage.clear();
  mockOpenUrl.mockResolvedValue(true);
  jest
    .spyOn(Image, "getSize")
    .mockImplementation(
      async (): Promise<{ width: number; height: number }> => {
        return { width: 320, height: 240 };
      },
    );
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("Rendering what the server sent", () => {
  test("plain prose is shown as written", async () => {
    await render(<MarkdownContent content="Checkout returns 500s." />);

    expect(screen.getByText("Checkout returns 500s.")).toBeTruthy();
  });

  test("markdown emphasis is rendered, not printed as asterisks", async () => {
    await render(
      <MarkdownContent content="**Acknowledged** by Ada Lovelace" />,
    );

    expect(screen.getByText("Acknowledged")).toBeTruthy();
    expect(screen.queryByText(/\*\*/)).toBeNull();
  });

  test("a list renders each of its items", async () => {
    await render(
      <MarkdownContent content={"- Restarted pods\n- Watching latency"} />,
    );

    expect(screen.getByText("Restarted pods")).toBeTruthy();
    expect(screen.getByText("Watching latency")).toBeTruthy();
  });

  test("a value the API wrapped in an envelope is unwrapped", async () => {
    /*
     * Several of these columns arrive as { _type: "Markdown", value: "..." }
     * rather than as a bare string. Rendered naively that is a screenful of
     * JSON where the description should be.
     */
    await render(
      <MarkdownContent
        content={{ _type: "Markdown", value: "Paged the database team." }}
      />,
    );

    expect(screen.getByText("Paged the database team.")).toBeTruthy();
  });

  test("the secondary variant is dimmed rather than full strength", async () => {
    await render(
      <MarkdownContent content="Supporting detail." variant="secondary" />,
    );

    const text: Rendered = screen.getByText("Supporting detail.");
    expect(StyleSheet.flatten(text.props.style).color).toBe(
      lightColors.textSecondary,
    );
  });

  test("the primary variant is not", async () => {
    await render(<MarkdownContent content="The headline detail." />);

    const text: Rendered = screen.getByText("The headline detail.");
    expect(StyleSheet.flatten(text.props.style).color).toBe(
      lightColors.textPrimary,
    );
  });
});

describe("A field the server left empty", () => {
  test("an absent value renders nothing at all", async () => {
    await render(<MarkdownContent content={undefined} />);

    expect(renderedTextCount()).toBe(0);
  });

  test("a null value renders nothing at all", async () => {
    /*
     * The common case: a monitor with no description, an incident whose
     * remediation notes were never filled in.
     */
    await render(<MarkdownContent content={null} />);

    expect(renderedTextCount()).toBe(0);
  });

  test("an empty string renders nothing at all", async () => {
    await render(<MarkdownContent content="" />);

    expect(renderedTextCount()).toBe(0);
  });

  test("and none of those throw out of render", async () => {
    /*
     * This is the whole point of the three above: a throw here is not a blank
     * paragraph, it is the detail screen the responder was reading.
     */
    const view: { unmount: () => Promise<void> } = await render(
      <MarkdownContent content={null} />,
    );

    expect(screen.container).toBeTruthy();
    await view.unmount();
  });
});

describe("Following a link", () => {
  const CONTENT: string =
    "See the [runbook](https://example.com/runbook) before restarting.";

  test("the link text is shown", async () => {
    await render(<MarkdownContent content={CONTENT} />);

    expect(screen.getByText("runbook")).toBeTruthy();
  });

  test("an untitled link keeps its visible text as its accessible name", async () => {
    await render(<MarkdownContent content={CONTENT} />);

    expect(screen.getByRole("link", { name: "runbook" })).toBeTruthy();
  });

  test("pressing it opens that exact URL", async () => {
    await render(<MarkdownContent content={CONTENT} />);

    await fireEvent.press(screen.getByText("runbook"));

    expect(mockOpenUrl).toHaveBeenCalledWith("https://example.com/runbook");
    expect(mockOpenUrl).toHaveBeenCalledTimes(1);
  });

  test("the right link is opened when there are several", async () => {
    await render(
      <MarkdownContent
        content={
          "[status page](https://example.com/status) and [runbook](https://example.com/runbook)"
        }
      />,
    );

    await fireEvent.press(screen.getByText("runbook"));

    expect(mockOpenUrl).toHaveBeenCalledWith("https://example.com/runbook");
  });

  test("the markdown library is not left to open it a second time", async () => {
    /*
     * The renderer dependency has its own React Native Linking handler. Our
     * custom renderer must bypass it, or a tap can launch two browser tabs (or
     * two Android Activities) after this dependency migration.
     */
    const nativeOpen: jest.SpyInstance = jest
      .spyOn(ReactNativeLinking, "openURL")
      .mockResolvedValue(true);

    await render(<MarkdownContent content={CONTENT} />);

    await fireEvent.press(screen.getByText("runbook"));

    expect(nativeOpen).not.toHaveBeenCalled();
  });

  test("nothing is said when the link opens fine", async () => {
    const alert: jest.SpyInstance = jest.spyOn(Alert, "alert");

    await render(<MarkdownContent content={CONTENT} />);

    await fireEvent.press(screen.getByText("runbook"));

    await waitFor(() => {
      expect(mockOpenUrl).toHaveBeenCalled();
    });

    expect(alert).not.toHaveBeenCalled();
  });
});

describe("The marked renderer migration", () => {
  test("keeps inline code readable with the app theme", async () => {
    await render(<MarkdownContent content="Run `kubectl get pods` first." />);

    const code: Rendered = screen.getByText("kubectl get pods");
    expect(StyleSheet.flatten(code.props.style).color).toBe(
      lightColors.textPrimary,
    );
  });

  test("renders raw HTML as text rather than executing or dropping it", async () => {
    await render(
      <MarkdownContent content={'<script>alert("incident")</script>'} />,
    );

    expect(screen.getByText(/alert\("incident"\)/)).toBeTruthy();
  });

  test("a linked image uses the same single-open link handler", async () => {
    const nativeOpen: jest.SpyInstance = jest
      .spyOn(ReactNativeLinking, "openURL")
      .mockResolvedValue(true);

    await render(
      <MarkdownContent
        content={
          "[![runbook diagram](https://example.com/runbook.png)](https://example.com/runbook)"
        }
      />,
    );

    await fireEvent.press(
      screen.getByRole("link", { name: "runbook diagram" }),
    );

    expect(mockOpenUrl).toHaveBeenCalledWith("https://example.com/runbook");
    expect(mockOpenUrl).toHaveBeenCalledTimes(1);
    expect(nativeOpen).not.toHaveBeenCalled();
  });

  test("a linked-image failure is surfaced to the responder", async () => {
    const alert: jest.SpyInstance = jest.spyOn(Alert, "alert");
    mockOpenUrl.mockRejectedValue(
      new Error("No Activity found to handle Intent"),
    );

    await render(
      <MarkdownContent
        content={
          "[![runbook diagram](https://example.com/runbook.png)](oneuptime://missing)"
        }
      />,
    );

    await fireEvent.press(
      screen.getByRole("link", { name: "runbook diagram" }),
    );

    await waitFor(() => {
      expect(alert).toHaveBeenCalledWith(
        "Could not open link",
        "Nothing on this device could open that link.",
      );
    });
  });
});

describe("A link this handset cannot open", () => {
  /*
   * openURL rejects when nothing claims the scheme - a mailto: with no mail
   * account, a deep link into an app that is not installed, http on a device
   * with no browser. The rejection used to be dropped, which made the tap a
   * silent no-op.
   */
  const CONTENT: string = "Escalate by [email](mailto:oncall@example.com).";

  beforeEach(() => {
    mockOpenUrl.mockRejectedValue(
      new Error("No Activity found to handle Intent"),
    );
  });

  test("the responder is told, rather than left tapping a dead link", async () => {
    const alert: jest.SpyInstance = jest.spyOn(Alert, "alert");

    await render(<MarkdownContent content={CONTENT} />);

    await fireEvent.press(screen.getByText("email"));

    await waitFor(() => {
      expect(alert).toHaveBeenCalled();
    });
  });

  test("and told in terms that name the link as the thing that failed", async () => {
    const alert: jest.SpyInstance = jest.spyOn(Alert, "alert");

    await render(<MarkdownContent content={CONTENT} />);

    await fireEvent.press(screen.getByText("email"));

    await waitFor(() => {
      expect(alert.mock.calls[0][0]).toMatch(/link/i);
    });
  });

  test("the prose around the link is still on screen afterwards", async () => {
    /*
     * A failed link must not take the paragraph, or the screen, with it.
     */
    await render(<MarkdownContent content={CONTENT} />);

    await fireEvent.press(screen.getByText("email"));

    await waitFor(() => {
      expect(mockOpenUrl).toHaveBeenCalled();
    });

    expect(screen.getByText("email")).toBeTruthy();
  });
});

describe("Headings and inline styles", () => {
  const HEADINGS: string =
    "# Checkout outage\n\n## Impact\n\n### Timeline\n\nPayments fail.";

  test("a top-level heading uses the title2 size in the primary text colour", async () => {
    await render(<MarkdownContent content={HEADINGS} />);

    expect(screen.getByText("Checkout outage")).toHaveStyle({
      fontSize: typography.title2.fontSize,
      lineHeight: typography.title2.lineHeight,
      fontWeight: "700",
      color: lightColors.textPrimary,
    });
  });

  test("a second-level heading is a step down, still bold", async () => {
    await render(<MarkdownContent content={HEADINGS} />);

    expect(screen.getByText("Impact")).toHaveStyle({
      fontSize: typography.title3.fontSize,
      lineHeight: typography.title3.lineHeight,
      fontWeight: "700",
      color: lightColors.textPrimary,
    });
  });

  test("headings stay larger than the body text around them", async () => {
    await render(<MarkdownContent content={HEADINGS} />);

    const body: number = StyleSheet.flatten(
      screen.getByText("Payments fail.").props.style,
    ).fontSize as number;
    const h1: number = StyleSheet.flatten(
      screen.getByText("Checkout outage").props.style,
    ).fontSize as number;
    const h2: number = StyleSheet.flatten(
      screen.getByText("Impact").props.style,
    ).fontSize as number;
    const h3: number = StyleSheet.flatten(
      screen.getByText("Timeline").props.style,
    ).fontSize as number;

    expect(h1).toBeGreaterThan(h2);
    expect(h2).toBeGreaterThan(h3);
    expect(h3).toBeGreaterThan(body);
  });

  test("headings do not draw the library's underline rule inside a card", async () => {
    await render(<MarkdownContent content={HEADINGS} />);

    expect(
      StyleSheet.flatten(screen.getByText("Checkout outage").props.style)
        .borderBottomWidth,
    ).toBe(0);
    expect(
      StyleSheet.flatten(screen.getByText("Impact").props.style)
        .borderBottomWidth,
    ).toBe(0);
  });

  test("bold words keep the size of the sentence they are in", async () => {
    await render(<MarkdownContent content="**Acknowledged** by Ada" />);

    expect(screen.getByText("Acknowledged")).toHaveStyle({
      fontSize: typography.callout.fontSize,
      fontWeight: "700",
    });
  });

  test("links are upright, underlined and in the action colour", async () => {
    await render(
      <MarkdownContent content="See the [runbook](https://example.com/runbook)." />,
    );

    expect(screen.getByText("runbook")).toHaveStyle({
      color: lightColors.actionPrimary,
      fontStyle: "normal",
      textDecorationLine: "underline",
      fontSize: typography.callout.fontSize,
    });
  });

  test("the secondary variant uses the smaller subhead size", () => {
    const styles: ReturnType<typeof createMarkdownStyles> =
      createMarkdownStyles(lightColors, true);

    expect(StyleSheet.flatten(styles.text)).toMatchObject({
      fontSize: typography.subhead.fontSize,
      color: lightColors.textSecondary,
    });
  });

  test.each([false, true])(
    "list bullets stay level with their text (secondary: %s)",
    (isSecondary: boolean) => {
      /*
       * The library applies `list` to each bullet's marker box only. A
       * vertical margin there dropped the "•" to the baseline, where it read as
       * a full stop beside every list item.
       */
      const styles: ReturnType<typeof createMarkdownStyles> =
        createMarkdownStyles(lightColors, isSecondary);
      const marker: Record<string, unknown> = StyleSheet.flatten(
        styles.list,
      ) as Record<string, unknown>;

      for (const key of [
        "margin",
        "marginVertical",
        "marginTop",
        "marginBottom",
        "paddingTop",
        "paddingVertical",
      ]) {
        expect(marker[key]).toBeUndefined();
      }
      // The marker inherits the item's text size, so the dot matches the line.
      expect(StyleSheet.flatten(styles.li)).toMatchObject({
        fontSize: StyleSheet.flatten(styles.text).fontSize,
        lineHeight: StyleSheet.flatten(styles.text).lineHeight,
      });
    },
  );
});

describe("In dark mode", () => {
  beforeEach(() => {
    mockSystemScheme = "dark";
  });

  test("body text, headings, links and inline code use the dark palette", async () => {
    await render(
      <ThemeProvider>
        <MarkdownContent
          content={
            "## Impact\n\nRun `kubectl get pods` and read the [runbook](https://example.com)."
          }
        />
      </ThemeProvider>,
    );

    expect(screen.getByText("Impact")).toHaveStyle({
      color: darkColors.textPrimary,
    });
    expect(screen.getByText("runbook")).toHaveStyle({
      color: darkColors.actionPrimary,
    });
    expect(screen.getByText("kubectl get pods")).toHaveStyle({
      color: darkColors.textPrimary,
      backgroundColor: darkColors.backgroundTertiary,
    });
  });

  test("an explicit Light choice wins over a dark device for the library defaults too", () => {
    /*
     * react-native-marked colours its defaults from the device appearance. The
     * styles handed to it come from the app palette, so a light app on a dark
     * phone never gets the library's dark code background.
     */
    const styles: ReturnType<typeof createMarkdownStyles> =
      createMarkdownStyles(lightColors, false);

    expect(StyleSheet.flatten(styles.codespan)?.backgroundColor).toBe(
      lightColors.backgroundTertiary,
    );
    expect(StyleSheet.flatten(styles.code)?.backgroundColor).toBe(
      lightColors.backgroundTertiary,
    );
    expect(StyleSheet.flatten(styles.hr)?.backgroundColor).toBe(
      lightColors.borderSubtle,
    );
  });
});

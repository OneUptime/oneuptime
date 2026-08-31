import React from "react";
import { Alert, Linking as ReactNativeLinking } from "react-native";
import {
  render,
  screen,
  fireEvent,
  waitFor,
} from "@testing-library/react-native";
import { describe, expect, test, beforeEach, afterEach } from "@jest/globals";
import MarkdownContent from "./MarkdownContent";
import { darkColors } from "../theme";

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

beforeEach(() => {
  mockOpenUrl.mockResolvedValue(true);
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
    expect((text.props.style as { color: string }[])[0].color).toBe(
      darkColors.textSecondary,
    );
  });

  test("the primary variant is not", async () => {
    await render(<MarkdownContent content="The headline detail." />);

    const text: Rendered = screen.getByText("The headline detail.");
    expect((text.props.style as { color: string }[])[0].color).toBe(
      darkColors.textPrimary,
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
     * react-native-markdown-display opens the URL itself with React Native's
     * own Linking whenever the handler returns true. Two openURL calls for one
     * tap is two browser tabs, or on Android two Activity launches.
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

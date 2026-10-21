import "@testing-library/jest-dom";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import * as React from "react";
import type { SpyInstance } from "jest-mock";
import CopyableCommand from "../../../../App/FeatureSet/Dashboard/src/Components/SetupGuide/CopyableCommand";
import { COMMAND_WORD_KEPT_WHOLE_MAX_LENGTH } from "../../../../App/FeatureSet/Dashboard/src/Components/SetupGuide/CommandDisplay";
import Clipboard from "../../../UI/Utils/Clipboard";

/*
 * One command on a host's Collector page ("On the host"): a compact line
 * with a copy button. What reaches the screen is the command, character for
 * character; a word short enough for a line is drawn whole (nowrap), so a
 * long command wraps only at a space - never "sh -" / "s" - and in the
 * code's monospace, which the Dashboard's `* { font-family: Inter }` would
 * otherwise give each word's span.
 */

const UNINSTALL: string =
  "curl -fsSL https://oneuptime.example.com/docs/static/scripts/host-collector/install.sh | sudo sh -s -- --uninstall";

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

function code(): HTMLElement {
  return screen.getByTestId("copyable-command").querySelector("code")!;
}

describe("CopyableCommand", () => {
  test("draws the command exactly as written", () => {
    render(<CopyableCommand command={UNINSTALL} />);

    expect(code().textContent).toBe(UNINSTALL);
  });

  test("keeps every word short enough for a line whole, in monospace", () => {
    render(<CopyableCommand command={UNINSTALL} />);

    const kept: Array<string> = Array.from(code().querySelectorAll("span")).map(
      (span: Element): string => {
        expect(span.className).toContain("whitespace-nowrap");
        expect(span.className).toContain("font-mono");
        return span.textContent || "";
      },
    );

    expect(kept).toEqual([
      "curl",
      "-fsSL",
      "|",
      "sudo",
      "sh",
      "-s",
      "--",
      "--uninstall",
    ]);
    // The address is longer than a phone's line: it may break where it must.
    expect(kept.join(" ")).not.toContain("https://");
    expect(
      "https://oneuptime.example.com/docs/static/scripts/host-collector/install.sh"
        .length,
    ).toBeGreaterThan(COMMAND_WORD_KEPT_WHOLE_MAX_LENGTH);
  });

  test("wraps at a space instead of scrolling sideways", () => {
    render(<CopyableCommand command={UNINSTALL} />);

    expect(code().className).toContain("whitespace-pre-wrap");
    expect(code().className).toContain("[overflow-wrap:anywhere]");
    expect(code().className).not.toContain("break-all");
  });

  test("copies the command exactly as written", async () => {
    const copy: SpyInstance<typeof Clipboard.copyToClipboard> = jest
      .spyOn(Clipboard, "copyToClipboard")
      .mockResolvedValue(true);

    render(<CopyableCommand command={UNINSTALL} />);
    fireEvent.click(screen.getByRole("button"));

    expect(copy).toHaveBeenCalledWith(UNINSTALL);
  });

  test("takes a test id of its own", () => {
    render(
      <CopyableCommand command="sudo systemctl status x" dataTestId="status" />,
    );

    expect(screen.getByTestId("status")).toHaveTextContent(
      "sudo systemctl status x",
    );
  });
});

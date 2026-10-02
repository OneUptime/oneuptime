import ErrorBoundary from "../../../UI/Components/ErrorBoundary";
import MasterPage from "../../../UI/Components/MasterPage/MasterPage";
import ForeignDomMutationGuard from "../../../UI/Utils/ForeignDomMutationGuard";
import ThemeUtil from "../../../UI/Utils/Theme";
import { act, cleanup, render, RenderResult } from "@testing-library/react";
import React, { ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * What the page goes through when 1Password's "Sign in" prompt comes up, run
 * against the shell every frontend renders inside (MasterPage under the root
 * ErrorBoundary, with the foreign-DOM-mutation guard installed and the theme
 * listening for other tabs, as the Dashboard's Index.tsx sets them up).
 *
 * The blank Dashboard in the report was the page's own ::backdrop rule
 * painting over the app from underneath the prompt (see
 * Tests/UI/Styles/TopLayerBackdrop.test.ts); jsdom cannot paint, so that part
 * is held at the stylesheet. The other suspects were the window and document
 * events the prompt sets off - the extension's element landing in <html>, its
 * frame taking focus, the tab's visibility and storage events - in case
 * something in the shell unmounted, hid or reset the app on one of them.
 * Nothing does. This is a characterization test that keeps it that way: it
 * passed before the fix as well, and fails if a handler added later blanks
 * the shell on any of these events.
 */

const SHELL_TEST_IDS: Array<string> = [
  "app-header",
  "app-navbar",
  "app-page",
  "app-footer",
];

type RenderShellFunction = () => RenderResult;

const renderShell: RenderShellFunction = (): RenderResult => {
  const page: ReactElement = (
    <div data-testid="app-page">
      <h1>Incidents</h1>
      <input aria-label="Search incidents" />
    </div>
  );

  return render(
    <ErrorBoundary>
      <MasterPage
        isLoading={false}
        error=""
        header={<div data-testid="app-header">Header</div>}
        navBar={<nav data-testid="app-navbar">Navigation</nav>}
        footer={<footer data-testid="app-footer">Footer</footer>}
      >
        {page}
      </MasterPage>
    </ErrorBoundary>,
  );
};

type ExpectShellFunction = (result: RenderResult) => void;

const expectShellStillRendered: ExpectShellFunction = (
  result: RenderResult,
): void => {
  expect(result.queryByTestId("error-boundary-fallback")).toBeNull();

  for (const testId of SHELL_TEST_IDS) {
    expect(result.queryByTestId(testId)).not.toBeNull();
  }

  expect(result.getByTestId("app-page").textContent).toContain("Incidents");
};

type ShowPromptFunction = () => HTMLElement;

// The element 1Password appends for its prompt, shown the way it shows it.
const showSignInPrompt: ShowPromptFunction = (): HTMLElement => {
  const prompt: HTMLElement = document.createElement("com-1password-uso");
  prompt.setAttribute("popover", "manual");
  prompt.attachShadow({ mode: "open" }).innerHTML =
    "<div role='dialog'>OneUptime (Prod Status Page) - Sign in</div>";
  document.documentElement.appendChild(prompt);

  const showPopover: (() => void) | undefined = (
    prompt as HTMLElement & { showPopover?: () => void }
  ).showPopover;

  if (typeof showPopover === "function") {
    showPopover.call(prompt);
  }

  return prompt;
};

type SetVisibilityFunction = (state: DocumentVisibilityState) => void;

const setVisibility: SetVisibilityFunction = (
  state: DocumentVisibilityState,
): void => {
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: (): DocumentVisibilityState => {
      return state;
    },
  });
  Object.defineProperty(document, "hidden", {
    configurable: true,
    get: (): boolean => {
      return state === "hidden";
    },
  });
  document.dispatchEvent(new Event("visibilitychange"));
};

beforeEach(() => {
  ForeignDomMutationGuard.install();
  ThemeUtil.initialize();
});

afterEach(() => {
  cleanup();
  ForeignDomMutationGuard.uninstallForTesting();
  document
    .querySelectorAll("com-1password-uso, iframe")
    .forEach((element: Element): void => {
      element.remove();
    });
  setVisibility("visible");
});

describe("the shell stays rendered through everything 1Password's prompt does to the page", () => {
  test("the prompt's element landing in <html>, beside the app", () => {
    const result: RenderResult = renderShell();

    act(() => {
      showSignInPrompt();
    });

    expectShellStillRendered(result);
    expect(document.querySelector("com-1password-uso")).not.toBeNull();
  });

  test("focus moving out of the app into the extension's frame, and back", () => {
    const result: RenderResult = renderShell();
    const search: HTMLInputElement = result.getByLabelText(
      "Search incidents",
    ) as HTMLInputElement;

    act(() => {
      search.focus();
    });

    act(() => {
      const frame: HTMLIFrameElement = document.createElement("iframe");
      document.body.appendChild(frame);
      search.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
      search.blur();
      window.dispatchEvent(new FocusEvent("blur"));
    });

    expectShellStillRendered(result);

    act(() => {
      window.dispatchEvent(new FocusEvent("focus"));
      search.focus();
      search.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
    });

    expectShellStillRendered(result);
    expect(document.activeElement).toBe(search);
  });

  test("the tab going hidden and visible again, and being put away and restored", () => {
    const result: RenderResult = renderShell();

    act(() => {
      setVisibility("hidden");
      window.dispatchEvent(new Event("pagehide"));
    });

    expectShellStillRendered(result);

    act(() => {
      window.dispatchEvent(new Event("pageshow"));
      setVisibility("visible");
    });

    expectShellStillRendered(result);
  });

  test("storage events from another tab or from the extension, including a cleared store", () => {
    const result: RenderResult = renderShell();

    act(() => {
      window.dispatchEvent(
        new StorageEvent("storage", { key: "1p-state", newValue: "{}" }),
      );
      window.dispatchEvent(new StorageEvent("storage", { key: null }));
    });

    expectShellStillRendered(result);
  });

  test("all of it at once, with the app updating underneath the prompt", () => {
    const result: RenderResult = renderShell();

    act(() => {
      showSignInPrompt();
      window.dispatchEvent(new FocusEvent("blur"));
      setVisibility("hidden");
      setVisibility("visible");
      window.dispatchEvent(new FocusEvent("focus"));
    });

    act(() => {
      result.rerender(
        <ErrorBoundary>
          <MasterPage
            isLoading={false}
            error=""
            header={<div data-testid="app-header">Header</div>}
            navBar={<nav data-testid="app-navbar">Navigation</nav>}
            footer={<footer data-testid="app-footer">Footer</footer>}
          >
            <div data-testid="app-page">
              <h1>Incidents</h1>
              <p>3 active</p>
            </div>
          </MasterPage>
        </ErrorBoundary>,
      );
    });

    expectShellStillRendered(result);
    expect(result.getByTestId("app-page").textContent).toContain("3 active");
  });
});

import "@testing-library/jest-dom";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { createInstance, i18n } from "i18next";
import { I18nextProvider } from "react-i18next";
import React, { ReactElement } from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * Values somebody copies into another system, one row each with a button
 * that copies it (Common/UI/Components/CopyableValueList): the SAML Entity
 * ID and Reply URL, the OIDC redirect URI and identifier, in the setup
 * dialogs of a project's and a status page's single sign-on, and on the
 * Admin Dashboard's global providers.
 *
 * They were a bold "Name:" line over the value as plain text, with line
 * breaks between them and nothing to copy with: a long address had to be
 * selected by hand, and a character missed at either end only showed when
 * signing in failed.
 */

const copyMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/Clipboard", () => {
  return {
    __esModule: true,
    default: {
      copyToClipboard: (...args: Array<unknown>): unknown => {
        return copyMock(...args);
      },
    },
  };
});

import CopyableValueList, {
  getCopyableValueName,
} from "../../../UI/Components/CopyableValueList/CopyableValueList";

const ENTITY_ID: string =
  "https://oneuptime.example.com/7a7a7a7a-0000-4000-8000-0000000000aa/7b7b7b7b-0000-4000-8000-0000000000bb";
const REPLY_URL: string =
  "https://oneuptime.example.com/identity/idp-login/7a7a7a7a-0000-4000-8000-0000000000aa/7b7b7b7b-0000-4000-8000-0000000000bb";

const VALUES: Array<{ label: string; value: string; dataTestId: string }> = [
  {
    label: "Identifier (Entity ID):",
    value: ENTITY_ID,
    dataTestId: "entity-id",
  },
  {
    label: "Reply URL (Assertion Consumer Service URL):",
    value: REPLY_URL,
    dataTestId: "reply-url",
  },
];

beforeEach(() => {
  copyMock.mockReset();
  copyMock.mockImplementation(async (): Promise<boolean> => {
    return true;
  });
});

afterEach(() => {
  cleanup();
});

function list(): ReactElement {
  return <CopyableValueList values={VALUES} dataTestId="the-values" />;
}

describe("one row per value", () => {
  test("each value's name over the value, in a list of terms", () => {
    render(list());

    const list_: HTMLElement = screen.getByTestId("the-values");

    expect(list_.tagName).toBe("DL");

    const terms: Array<string> = Array.from(list_.querySelectorAll("dt")).map(
      (term: Element): string => {
        return term.textContent || "";
      },
    );

    expect(terms).toEqual([
      "Identifier (Entity ID):",
      "Reply URL (Assertion Consumer Service URL):",
    ]);

    // The value is its term's next sibling, and nothing else.
    for (const item of VALUES) {
      const term: HTMLElement = screen.getByText(item.label);

      expect(term.nextElementSibling?.textContent).toBe(item.value);
      expect(screen.getByTestId(item.dataTestId)).toHaveTextContent(
        item.value,
      );
      expect(screen.getByText(item.value, { exact: true })).toBe(
        screen.getByTestId(item.dataTestId),
      );
    }
  });

  test("the value is drawn in the code font, on its own element, wrapping anywhere", () => {
    render(list());

    const value: HTMLElement = screen.getByTestId("entity-id");

    expect(value).toHaveClass("font-mono", "break-all");
    // No element inside it the page's `* { font-family }` rule would redraw.
    expect(value.children).toHaveLength(0);
  });
});

describe("copying", () => {
  test("each row's button copies its value exactly, named for the value", async () => {
    render(list());

    for (const item of VALUES) {
      const name: string = `Copy ${getCopyableValueName(item.label)}`;
      const button: HTMLElement = screen.getByRole("button", { name: name });

      await act(async () => {
        fireEvent.click(button);
      });

      expect(copyMock).toHaveBeenLastCalledWith(item.value);
    }

    expect(copyMock).toHaveBeenCalledTimes(2);
  });

  test("the button sits in the value's row, beside it", () => {
    render(list());

    const row: HTMLElement = screen.getByTestId("entity-id").closest(
      "div.flex",
    ) as HTMLElement;

    expect(
      within(row).getByRole("button", {
        name: "Copy Identifier (Entity ID)",
      }),
    ).toBeInTheDocument();
    expect(
      within(row).queryByRole("button", { name: /Reply URL/ }),
    ).not.toBeInTheDocument();
  });
});

describe("a value's name, as its copy button says it", () => {
  test.each([
    ["Identifier (Entity ID):", "Identifier (Entity ID)"],
    ["Redirect URI (Callback URL):", "Redirect URI (Callback URL)"],
    ["  Issuer (Entity ID) :  ", "Issuer (Entity ID)"],
    ["\u{8B58}\u{5225}\u{5B50}\u{FF1A}", "\u{8B58}\u{5225}\u{5B50}"],
    ["Value", "Value"],
  ])("%s -> %s", (label: string, name: string) => {
    expect(getCopyableValueName(label)).toBe(name);
  });
});

describe("in the reader's language", () => {
  let german: i18n;

  beforeAll(async () => {
    german = createInstance();

    await german.init({
      lng: "de",
      fallbackLng: false,
      resources: {
        de: {
          translation: {
            "Identifier (Entity ID):": "Kennung (Entitäts-ID):",
            "Copy {{name}}": "{{name}} kopieren",
          },
        },
      },
      keySeparator: false,
      nsSeparator: false,
      interpolation: { escapeValue: false },
    });
  });

  test("the name and the button are German; the value is as it is", () => {
    render(<I18nextProvider i18n={german}>{list()}</I18nextProvider>);

    expect(screen.getByText("Kennung (Entitäts-ID):")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Kennung (Entitäts-ID) kopieren" }),
    ).toBeInTheDocument();
    expect(screen.getByTestId("entity-id")).toHaveTextContent(ENTITY_ID);
    // A name with no German yet stays English, whole.
    expect(
      screen.getByText("Reply URL (Assertion Consumer Service URL):"),
    ).toBeInTheDocument();
  });
});

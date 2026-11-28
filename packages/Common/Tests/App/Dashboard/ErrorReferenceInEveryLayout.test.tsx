// UX rule: Docs/ux/README.md#errors
import "@testing-library/jest-dom";
import {
  afterEach,
  beforeAll,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { act, cleanup, render, within } from "@testing-library/react";
import i18next from "i18next";
import * as React from "react";
import { initReactI18next } from "react-i18next";
import ErrorReference, {
  ERROR_REFERENCE_LINE_TEST_ID,
  ERROR_REFERENCE_TEST_ID,
} from "../../../UI/Components/ErrorMessage/ErrorReference";
import ErrorExplanation from "../../../UI/Components/ErrorMessage/ErrorExplanation";
import ErrorLine from "../../../UI/Components/ErrorMessage/ErrorLine";
import ErrorMessage from "../../../UI/Components/ErrorMessage/ErrorMessage";
import ErrorMessageText from "../../../UI/Components/ErrorMessage/ErrorMessageText";
import ErrorSentence, {
  ErrorInSentence,
} from "../../../UI/Components/ErrorMessage/ErrorSentence";
import Alert, { AlertType } from "../../../UI/Components/Alerts/Alert";
import ModalBody from "../../../UI/Components/Modal/ModalBody";
import TableEmptyState, {
  TableEmptyStateKind,
} from "../../../UI/Components/Table/TableEmptyState";
import DashboardWidgetError from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Components/DashboardWidgetError";
import WidgetPlaceholder from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Components/WidgetPlaceholder";
import IconProp from "../../../Types/Icon/IconProp";
import { getUnexplainedServerErrorMessage } from "../../../Types/Exception/UnexplainedError";
import { readDashboardLocale } from "../../Helpers/DashboardLocales";
import { scanDarkMode } from "../../Helpers/DarkModeScan";
import {
  getReferenceAlignment,
  getWordsAlignment,
  ReferenceAlignment,
} from "../../Helpers/ReferenceLineAlignment";

/*
 * A FAILURE'S REFERENCE SITS UNDER ITS LINES AS THEY SIT (#7622).
 *
 * A failure the server could not explain names a reference for its log
 * lines, drawn with a copy button (ErrorReference). In a centred error
 * layout the reference's row sat at the lines' start unless the layout
 * said to centre it (isCentered): a list that did not load (ErrorMessage)
 * and the notes feed said so, a table's failed load (TableEmptyState) never
 * did, and its reference sat about 150px off the centre of the lines above
 * it, left of them on an English page and right of them on a Persian one.
 *
 * The reference is one inline box on a line of its own now, which its
 * line's alignment places, whatever the layout: every centred layout
 * centres it, and every layout whose lines start at the start keeps it
 * there - the right on a page read from the right. Each layout is drawn
 * here as the product draws it, in English, in German (long words) and in
 * Persian (right to left), with the Dashboard's own words; the reference is
 * where the words above it are, drawn as written, left to right, with its
 * copy button. (The notes feed's is pinned by EventNotesLoadFailure.)
 */

jest.mock("../../../UI/Utils/User", () => {
  return {
    __esModule: true,
    default: {
      isMasterAdmin: (): boolean => {
        return true;
      },
    },
  };
});

/*
 * A self-hosted server's admin, who is told where to look in its logs: on
 * OneUptime's cloud nobody is (getExplanationWords), and CI's config.env
 * sets BILLING_ENABLED=true (test-setup.sh), so the suite says which it is.
 */
jest.mock("../../../UI/Config", () => {
  const actualConfig: Record<string, unknown> = jest.requireActual(
    "../../../UI/Config",
  ) as Record<string, unknown>;

  const mockedConfig: Record<string, unknown> = { ...actualConfig };

  Object.defineProperty(mockedConfig, "BILLING_ENABLED", {
    get: (): boolean => {
      return false;
    },
  });

  return mockedConfig;
});

const REFERENCE: string = "9c4e1a07";
const WITH_REFERENCE: string = getUnexplainedServerErrorMessage(REFERENCE);

const LANGUAGES: Array<string> = ["en", "de", "fa"];

beforeAll(async () => {
  await i18next.use(initReactI18next).init({
    lng: "en",
    fallbackLng: "en",
    resources: {},
    interpolation: { escapeValue: false },
    keySeparator: false,
    nsSeparator: false,
  });
});

afterEach(() => {
  cleanup();
});

// The page in `language`, with the Dashboard's words as it ships them.
const speak: (language: string) => Promise<void> = async (
  language: string,
): Promise<void> => {
  await act(async () => {
    for (const code of [language, "en"]) {
      i18next.removeResourceBundle(code, "translation");
      i18next.addResourceBundle(
        code,
        "translation",
        readDashboardLocale(code),
        true,
        true,
      );
    }

    await i18next.changeLanguage(language);
  });
};

interface Layout {
  name: string;
  // Where the layout's own lines sit, and so where the reference must.
  alignment: ReferenceAlignment;
  draw: () => React.ReactElement;
}

/*
 * Every error layout that draws a reference on a line of its own, as the
 * product draws it.
 */
const LAYOUTS: Array<Layout> = [
  {
    name: "a list that did not load (ErrorMessage)",
    alignment: "center",
    draw: (): React.ReactElement => {
      return (
        <ErrorMessage message={WITH_REFERENCE} onRefreshClick={() => {}} />
      );
    },
  },
  {
    name: "a table's failed load (TableEmptyState)",
    alignment: "center",
    draw: (): React.ReactElement => {
      return (
        <TableEmptyState
          kind={TableEmptyStateKind.Error}
          title="Monitors could not be loaded"
          description={WITH_REFERENCE}
          actions={[{ title: "Try again", onClick: () => {} }]}
        />
      );
    },
  },
  {
    name: "a dashboard widget's error (DashboardWidgetError)",
    alignment: "center",
    draw: (): React.ReactElement => {
      return (
        <DashboardWidgetError icon={IconProp.ChartBar} error={WITH_REFERENCE} />
      );
    },
  },
  {
    name: "a public dashboard's placeholder (WidgetPlaceholder)",
    alignment: "center",
    draw: (): React.ReactElement => {
      return (
        <WidgetPlaceholder icon={IconProp.Logs} message={WITH_REFERENCE} />
      );
    },
  },
  {
    name: "a card's red line (ErrorLine)",
    alignment: "start",
    draw: (): React.ReactElement => {
      return (
        <ErrorLine
          message={WITH_REFERENCE}
          whatFailed="The check was not written."
        />
      );
    },
  },
  {
    name: "a dialog's alert (ModalBody)",
    alignment: "start",
    draw: (): React.ReactElement => {
      return (
        <ModalBody error={WITH_REFERENCE} whatFailed="The key was not rotated.">
          <p>Rotate the key?</p>
        </ModalBody>
      );
    },
  },
  {
    name: "words a piece lays out itself, at their start (ErrorMessageText)",
    alignment: "start",
    draw: (): React.ReactElement => {
      return (
        <div className="text-sm">
          <ErrorMessageText message={WITH_REFERENCE} />
        </div>
      );
    },
  },
];

describe("the reference sits where the lines above it sit, in every layout", () => {
  for (const language of LANGUAGES) {
    for (const layout of LAYOUTS) {
      test(`${layout.name}, in ${language}`, async () => {
        await speak(language);

        const view: ReturnType<typeof render> = render(layout.draw());

        const reference: HTMLElement = within(view.container).getByTestId(
          ERROR_REFERENCE_TEST_ID,
        );

        // Where the layout's lines are, and so where the reference is.
        expect(
          getWordsAlignment(
            within(view.container).getByTestId("error-why-and-next"),
          ),
        ).toBe(layout.alignment);
        expect(getReferenceAlignment(reference)).toBe(layout.alignment);

        // Drawn as written, left to right in every script, with its copy button.
        const code: HTMLElement | null = reference.querySelector("code");

        expect(code).toHaveTextContent(REFERENCE);
        expect(code).toHaveAttribute("dir", "ltr");
        expect(within(reference).getAllByRole("button")).toHaveLength(1);

        // Said once, on its own line.
        expect(
          within(view.container).getAllByTestId(ERROR_REFERENCE_TEST_ID),
        ).toHaveLength(1);
        expect(
          within(view.container).getAllByTestId(ERROR_REFERENCE_LINE_TEST_ID),
        ).toHaveLength(1);
      });
    }
  }

  test("no layout places it by a side of the page, which a page read from the right would not turn round", async () => {
    await speak("fa");

    for (const layout of LAYOUTS) {
      const view: ReturnType<typeof render> = render(layout.draw());

      expect(["center", "start"]).toContain(
        getReferenceAlignment(
          within(view.container).getByTestId(ERROR_REFERENCE_TEST_ID),
        ),
      );

      view.unmount();
    }
  });
});

describe("the reference on a line of its own", () => {
  test("is one inline box on a plain block line, which its line's alignment places", () => {
    const view: ReturnType<typeof render> = render(
      <div className="text-center">
        <ErrorReference reference={REFERENCE} />
      </div>,
    );

    const line: HTMLElement = within(view.container).getByTestId(
      ERROR_REFERENCE_LINE_TEST_ID,
    );
    const reference: HTMLElement = within(view.container).getByTestId(
      ERROR_REFERENCE_TEST_ID,
    );

    expect(line).toHaveClass("block");
    expect(line).not.toHaveClass("flex");
    expect(line).not.toHaveClass("justify-center");
    expect(reference).toHaveClass("inline-flex");
    expect(reference).not.toHaveClass("flex");
    expect(reference.parentElement).toBe(line);
    expect(getReferenceAlignment(reference)).toBe("center");
  });

  /*
   * On a 390px phone, or in a narrow widget, the button goes under the
   * reference rather than past the edge of its box.
   */
  test("wraps on a narrow line, never wider than it", () => {
    const view: ReturnType<typeof render> = render(
      <ErrorReference reference={REFERENCE} />,
    );

    const reference: HTMLElement = within(view.container).getByTestId(
      ERROR_REFERENCE_TEST_ID,
    );

    expect(reference).toHaveClass("flex-wrap", "max-w-full");
    expect(reference).not.toHaveClass("whitespace-nowrap");
  });

  test("follows a line that starts at the start, and one that ends at the end", () => {
    for (const [className, alignment] of [
      ["", "start"],
      ["text-start", "start"],
      ["text-end", "end"],
      ["text-center", "center"],
    ] as Array<[string, ReferenceAlignment]>) {
      const view: ReturnType<typeof render> = render(
        <div className={className}>
          <ErrorReference reference={REFERENCE} />
        </div>,
      );

      expect(
        getReferenceAlignment(
          within(view.container).getByTestId(ERROR_REFERENCE_TEST_ID),
        ),
      ).toBe(alignment);

      view.unmount();
    }
  });

  test("the explanation draws it with ErrorReference, after its words and before where to look", () => {
    const view: ReturnType<typeof render> = render(
      <ErrorExplanation message={WITH_REFERENCE} />,
    );

    const explanation: HTMLElement = within(view.container).getByTestId(
      "error-explanation",
    );
    const parts: Array<string> = Array.from(explanation.children).map(
      (child: Element): string => {
        return child.getAttribute("data-testid") || "";
      },
    );

    expect(parts).toEqual([
      "error-what-failed",
      "error-why-and-next",
      ERROR_REFERENCE_LINE_TEST_ID,
      "error-where-to-look",
    ]);
  });
});

describe("the reference inside a sentence", () => {
  test("closes the sentence with its full stop, with a copy button of its icon alone", async () => {
    await speak("en");

    const view: ReturnType<typeof render> = render(
      <p className="text-center">
        <ErrorInSentence message={WITH_REFERENCE} />
      </p>,
    );

    const reference: HTMLElement = within(view.container).getByTestId(
      ERROR_REFERENCE_TEST_ID,
    );

    // Inline, in the sentence's own line: no line of its own.
    expect(reference).toHaveClass("inline-flex");
    expect(
      within(view.container).queryByTestId(ERROR_REFERENCE_LINE_TEST_ID),
    ).toBeNull();
    expect(reference.textContent || "").toMatch(new RegExp(`^${REFERENCE}\\.`));
    expect(reference.querySelector("code")).toHaveAttribute("dir", "ltr");
    expect(within(reference).getAllByRole("button")).toHaveLength(1);
  });

  test.each(LANGUAGES)(
    "in %s, a card's sentence keeps the reference inside it, once",
    async (language: string) => {
      await speak(language);

      const view: ReturnType<typeof render> = render(
        <p>
          <ErrorSentence
            template="Couldn't work out who is told. {{error}}"
            error={WITH_REFERENCE}
          />
        </p>,
      );

      expect(
        within(view.container).getAllByTestId(ERROR_REFERENCE_TEST_ID),
      ).toHaveLength(1);
      expect(
        within(view.container).getByTestId(ERROR_REFERENCE_TEST_ID),
      ).toHaveTextContent(REFERENCE);
    },
  );

  test("an alert's title says it in its sentence, as cards do", async () => {
    await speak("en");

    const view: ReturnType<typeof render> = render(
      <Alert title={WITH_REFERENCE} type={AlertType.DANGER} />,
    );

    expect(
      within(view.container).getByTestId(ERROR_REFERENCE_TEST_ID),
    ).toHaveTextContent(REFERENCE);
  });
});

describe("the reference in the dark theme", () => {
  test("every colour it is drawn in is re-coloured by the dark theme", () => {
    expect(
      scanDarkMode({
        files: [
          "Components/ErrorMessage/ErrorReference.tsx",
          "Components/ErrorMessage/ErrorExplanation.tsx",
        ],
      }).unmapped,
    ).toEqual([]);
  });
});

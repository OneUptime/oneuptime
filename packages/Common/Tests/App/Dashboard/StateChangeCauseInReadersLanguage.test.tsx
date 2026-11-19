/**
 * @timezone UTC
 */
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
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import * as React from "react";
import StateChangeCauseModal, {
  useWordStateChangeCause,
  wordStateChangeCause,
} from "../../../../App/FeatureSet/Dashboard/src/Components/StateTimeline/StateChangeCause";
import {
  EvaluationSentence,
  englishOfEvaluationSentence,
  translatableSentence,
} from "../../../Types/Monitor/EvaluationSentence";
import { mdText } from "../../../Utils/Markdown/FeedMarkdown";
import { STATUS_CHANGED_TO_DEFAULT } from "../../../Utils/Monitor/StatusChangeNotes";
import {
  dashboardTranslator,
  readDashboardLocale,
} from "../../Helpers/DashboardLocales";
import { withoutIsolateMarks } from "../../Helpers/IsolateMarks";

jest.mock("../../../UI/Components/Markdown.tsx/LazyMarkdownViewer", () => {
  return {
    __esModule: true,
    default: (props: { text: string }): React.ReactElement => {
      return React.createElement(
        "div",
        { "data-testid": "markdown" },
        props.text,
      );
    },
  };
});

/*
 * VIEW CAUSE IN THE READER'S LANGUAGE, RENDERED (#9752).
 *
 * A monitor's Status Timeline - and an incident's and an alert's State
 * Timeline - open a change's root cause from View Cause. It read in English
 * on every page: OneUptime's labels, its yes or no, its figures, the
 * finding the criteria wrote. StateChangeCause draws it worded, from the
 * Dashboard's own locale files, each finding from the sentence the change's
 * own check kept.
 */

const NO_ROOT_CAUSE: string =
  "No root cause. This monitor status could be created manually.";

// A finding the engine writes from its sentence (APIRequestCriteria).
const FINDING: EvaluationSentence = translatableSentence(
  "Response body contains {{text}}.",
  { text: "maintenance" },
);

const ROOT_CAUSE: string = mdText`
**Created because the following criteria was met**:

**Criteria Name**: ${"Website is down"}

**Filter Conditions Met**: ${englishOfEvaluationSentence(FINDING)}

**Response Snapshot**
- Response Status Code: ${503}
- Timed Out: ${"No"}
`.toString();

// The check the status event kept, with the evaluation that changed it.
const CHANGE_LOG: unknown = {
  responseCode: 503,
  evaluationSummary: {
    criteriaResults: [
      {
        criteriaName: "Website is down",
        met: true,
        filters: [
          {
            checkOn: "Response Body",
            met: true,
            message: englishOfEvaluationSentence(FINDING),
            messageSentence: FINDING,
          },
        ],
      },
    ],
    events: [],
  },
};

function shownCause(): string {
  return withoutIsolateMarks(screen.getByTestId("markdown").textContent || "");
}

beforeAll(async () => {
  await i18next.use(initReactI18next).init({
    lng: "fa",
    fallbackLng: "en",
    resources: {
      fa: { translation: readDashboardLocale("fa") },
      ar: { translation: readDashboardLocale("ar") },
      en: { translation: readDashboardLocale("en") },
    },
    interpolation: { escapeValue: false },
  });
});

beforeEach(async () => {
  await i18next.changeLanguage("fa");
});

afterEach(() => {
  cleanup();
});

describe("View Cause's dialog", () => {
  test("reads a criteria's root cause in Persian, its finding from the change's own check", () => {
    render(
      <StateChangeCauseModal
        rootCause={ROOT_CAUSE}
        changeLog={CHANGE_LOG}
        noCauseText={NO_ROOT_CAUSE}
        onClose={() => {}}
      />,
    );

    const text: string = shownCause();
    const persian: Record<string, string> = readDashboardLocale("fa");

    expect(text).toContain(
      `**${persian["Criteria Name"] as string}**: Website is down`,
    );
    expect(text).toContain("بدنه پاسخ شامل maintenance است.");
    for (const english of [
      "Created because",
      "Criteria Name",
      "Filter Conditions Met",
      "Response Snapshot",
      "Response body contains",
      "Timed Out",
    ]) {
      expect(text).not.toContain(english);
    }
  });

  test("reads OneUptime's own note in Arabic", async () => {
    await i18next.changeLanguage("ar");

    render(
      <StateChangeCauseModal
        rootCause="No monitoring criteria met. Change to default status. "
        noCauseText={NO_ROOT_CAUSE}
        onClose={() => {}}
      />,
    );

    expect(shownCause()).toBe(
      readDashboardLocale("ar")[STATUS_CHANGED_TO_DEFAULT],
    );
  });

  test("a change with no cause says so in the reader's language", () => {
    render(
      <StateChangeCauseModal
        rootCause=""
        noCauseText={NO_ROOT_CAUSE}
        onClose={() => {}}
      />,
    );

    expect(shownCause()).toBe(readDashboardLocale("fa")[NO_ROOT_CAUSE]);
  });

  test("reads in English as stored", async () => {
    await i18next.changeLanguage("en");

    render(
      <StateChangeCauseModal
        rootCause={ROOT_CAUSE}
        changeLog={CHANGE_LOG}
        noCauseText={NO_ROOT_CAUSE}
        onClose={() => {}}
      />,
    );

    expect(screen.getByTestId("markdown").textContent).toBe(ROOT_CAUSE);
  });

  test("Close closes it", () => {
    const onClose: jest.Mock = jest.fn();

    render(
      <StateChangeCauseModal
        rootCause={ROOT_CAUSE}
        noCauseText={NO_ROOT_CAUSE}
        onClose={onClose as unknown as () => void}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /بستن|Close/ }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe("the timeline view's wording", () => {
  test("is the dialog's: one wording for both views", () => {
    let worded: string = "";

    const Probe: React.FunctionComponent = (): React.ReactElement => {
      const wordCause: (data: { cause: string; log: unknown }) => string =
        useWordStateChangeCause();
      worded = wordCause({ cause: ROOT_CAUSE, log: CHANGE_LOG });
      return <></>;
    };

    render(<Probe />);

    expect(worded).toBe(
      wordStateChangeCause({
        translator: dashboardTranslator("fa"),
        cause: ROOT_CAUSE,
        log: CHANGE_LOG,
      }),
    );
    expect(withoutIsolateMarks(worded)).toContain(
      "بدنه پاسخ شامل maintenance است.",
    );
  });
});

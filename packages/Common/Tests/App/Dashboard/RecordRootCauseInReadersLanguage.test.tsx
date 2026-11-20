import "@testing-library/jest-dom";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import { cleanup, render, RenderResult } from "@testing-library/react";
import { createInstance, i18n } from "i18next";
import * as React from "react";
import { I18nextProvider } from "react-i18next";
import MonitorRootCauseValue from "../../../../App/FeatureSet/Dashboard/src/Components/EventView/MonitorRootCauseValue";
import StateChangeCauseModal from "../../../../App/FeatureSet/Dashboard/src/Components/StateTimeline/StateChangeCause";
import FeedMarkdown, { mdText } from "../../../Utils/Markdown/FeedMarkdown";
import { readDashboardLocale } from "../../Helpers/DashboardLocales";
import { isolated, withoutIsolateMarks } from "../../Helpers/IsolateMarks";

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
 * AN INCIDENT'S OR AN ALERT'S OWN ROOT CAUSE ON ITS ROOT CAUSE PAGE, AND ON
 * ITS FIRST STATE'S VIEW CAUSE, RENDERED (#10125).
 *
 * When OneUptime opens a record itself it writes why, once, in English: a
 * Sigma rule or a threat intel feed matched, a Data Security check failed,
 * an SLO's burn rate or error budget crossed its line, a network site
 * rolled up, what cost the most of a budget, a page from a workflow or a
 * chat - and, on older records, who opened it. The Root Cause page drew it
 * as stored, and so did View Cause on the record's first state, which
 * holds a copy. Both say it in the reader's words now, from the
 * Dashboard's own locale files, each value as written.
 */

const USER_LINK: string =
  mdText`[${"Jane Doe"}](${"https://oneuptime.example/dashboard/p/users/u"})`.toString();

interface RecordRootCause {
  name: string;
  stored: string;
  // What reads as written in every language.
  keeps: Array<string>;
  // English it never reads in, in another language.
  never: string;
}

const ROOT_CAUSES: Array<RecordRootCause> = [
  {
    name: "a Sigma rule's match",
    stored:
      mdText`Sigma detection rule "${"Sudo to root"}" matched security events.`.toString(),
    keeps: ["Sudo to root"],
    never: "matched security events",
  },
  {
    name: "a threat intel feed's indicator",
    stored:
      mdText`Threat intel feed "${"URLhaus"}" indicator matched security events.`.toString(),
    keeps: ["URLhaus"],
    never: "indicator matched",
  },
  {
    name: "a Data Security check",
    stored:
      mdText`The Data Security check "${"s3-public-bucket"}" failed on ${"customer-exports"}.`.toString(),
    keeps: ["s3-public-bucket", "customer-exports"],
    never: "failed on",
  },
  {
    name: "an incoming request's grouping key",
    stored:
      mdText`Incoming request matched grouping key \`${"checkout-42"}\`.`.toString(),
    keeps: ["`checkout-42`"],
    never: "matched grouping key",
  },
  {
    name: "an SLO's burn rate rule",
    stored:
      mdText`Error budget burn rate breached the "${"Fast burn"}" rule of SLO "${"Checkout availability"}".`.toString(),
    keeps: ["Fast burn", "Checkout availability"],
    never: "burn rate breached",
  },
  {
    name: "an SLO's policy tier",
    stored:
      mdText`The error budget left of SLO "${"Checkout availability"}" is at or below ${"25%"}, the "${"Freeze"}" tier of its error budget policy.`.toString(),
    keeps: ["Checkout availability", "Freeze"],
    never: "error budget policy",
  },
  {
    name: "a network site's rollup",
    stored:
      mdText`Network site **${"Head Office"}** rolled up to **${"Partial Outage"}**.`.toString(),
    keeps: ["Head Office", "Partial Outage"],
    never: "rolled up to",
  },
  {
    name: "a cloud budget's costs",
    stored:
      "What cost the most this month: Amazon EC2 ($437.87), Amazon S3 ($272.74) and AWS Lambda ($34.84).",
    keeps: ["Amazon EC2 ($437.87)", "AWS Lambda ($34.84)"],
    never: "What cost the most",
  },
  {
    name: "a workflow's page",
    stored:
      mdText`Created by workflow **${"Page on 5xx"}** to page people.`.toString(),
    keeps: ["Page on 5xx"],
    never: "to page people",
  },
  {
    name: "a page from Slack",
    stored:
      mdText`Created by **${"Jane Doe"}** from ${"Slack"} to page people.`.toString(),
    keeps: ["Jane Doe", "Slack"],
    never: "to page people",
  },
  {
    name: "an older record a person declared",
    stored:
      mdText`Incident created by ${FeedMarkdown.asMarkdown(USER_LINK)}`.toString(),
    keeps: [USER_LINK],
    never: "Incident created by",
  },
  {
    name: "an older record declared from Slack",
    stored: mdText`Incident created by @${"maya.chen"} on Slack.`.toString(),
    keeps: ["@maya.chen"],
    never: "Incident created by",
  },
  {
    name: "an older record the OneUptime AI copilot declared",
    stored: "Incident created via the OneUptime AI copilot.",
    keeps: [],
    never: "copilot",
  },
];

const instances: Record<string, i18n> = {};

function translationIn(language: string): i18n {
  if (!instances[language]) {
    const instance: i18n = createInstance();
    void instance.init({
      lng: language,
      fallbackLng: "en",
      resources: {
        [language]: { translation: readDashboardLocale(language) },
      },
      interpolation: { escapeValue: false },
      keySeparator: false,
      nsSeparator: false,
      initImmediate: false,
    });
    instances[language] = instance;
  }

  return instances[language]!;
}

// The Root Cause page's value, as its detail card draws it.
function renderRootCausePage(language: string, stored: string): RenderResult {
  return render(
    <I18nextProvider i18n={translationIn(language)}>
      <MonitorRootCauseValue
        rootCause={stored}
        placeholder="No root cause identified for this incident."
      />
    </I18nextProvider>,
  );
}

// View Cause on the record's first state, which holds the root cause's copy.
function renderFirstStateCause(language: string, stored: string): RenderResult {
  return render(
    <I18nextProvider i18n={translationIn(language)}>
      <StateChangeCauseModal
        rootCause={stored}
        noCauseText="No root cause."
        onClose={(): void => {}}
      />
    </I18nextProvider>,
  );
}

function shown(view: RenderResult): string {
  return view.getByTestId("markdown").textContent || "";
}

afterEach(() => {
  cleanup();
});

describe.each(["fa", "ar", "de", "ja"])(
  "a record's own root cause on a page in %s",
  (language: string) => {
    test.each(
      ROOT_CAUSES.map((cause: RecordRootCause): [string, RecordRootCause] => {
        return [cause.name, cause];
      }),
    )(
      "%s: in the reader's words on the Root Cause page and the first state's View Cause alike",
      (_name: string, cause: RecordRootCause) => {
        const page: string = shown(renderRootCausePage(language, cause.stored));
        cleanup();
        const firstState: string = shown(
          renderFirstStateCause(language, cause.stored),
        );

        expect(firstState).toBe(page);
        expect(withoutIsolateMarks(page)).not.toContain(cause.never);

        for (const value of cause.keeps) {
          expect({
            value,
            kept: withoutIsolateMarks(page).includes(value),
          }).toEqual({ value, kept: true });
        }
      },
    );
  },
);

describe("values, as a page read from the right holds them", () => {
  test.each(["fa", "ar"])(
    "in %s, a rule's name, a store and a person's link are each set apart, whole",
    (language: string) => {
      expect(
        shown(renderRootCausePage(language, ROOT_CAUSES[0]!.stored)),
      ).toContain(isolated("Sudo to root"));
      cleanup();
      expect(
        shown(renderRootCausePage(language, ROOT_CAUSES[2]!.stored)),
      ).toContain(isolated("customer-exports"));
      cleanup();
      expect(
        shown(renderRootCausePage(language, ROOT_CAUSES[10]!.stored)),
      ).toContain(isolated(USER_LINK));
    },
  );

  test("in Persian, a policy tier's threshold in Persian digits, and the costs joined as Persian joins a list", () => {
    expect(
      withoutIsolateMarks(
        shown(renderRootCausePage("fa", ROOT_CAUSES[5]!.stored)),
      ),
    ).toContain("۲۵٪");
    cleanup();
    expect(
      withoutIsolateMarks(
        shown(renderRootCausePage("fa", ROOT_CAUSES[7]!.stored)),
      ),
    ).toContain(
      "Amazon EC2 ($437.87)، Amazon S3 ($272.74) و AWS Lambda ($34.84)",
    );
  });

  test("in German, the costs joined with und, the threshold as German writes a percentage", () => {
    expect(
      withoutIsolateMarks(
        shown(renderRootCausePage("de", ROOT_CAUSES[7]!.stored)),
      ),
    ).toContain("Amazon S3 ($272.74) und AWS Lambda ($34.84)");
    cleanup();
    expect(
      withoutIsolateMarks(
        shown(renderRootCausePage("de", ROOT_CAUSES[5]!.stored)),
      )
        .split(" ")
        .join(" "),
    ).toContain("25 %");
  });
});

describe("in English, and a root cause a person wrote", () => {
  test("in English, each reads as OneUptime stored it, an older who-opened-it line as who declared it", () => {
    for (const cause of ROOT_CAUSES.slice(0, 10)) {
      expect(shown(renderRootCausePage("en", cause.stored))).toBe(cause.stored);
      cleanup();
    }

    expect(
      withoutIsolateMarks(
        shown(renderRootCausePage("en", ROOT_CAUSES[10]!.stored)),
      ),
    ).toBe(`Declared by ${USER_LINK}`);
  });

  test("a root cause a person typed that starts as OneUptime's reads as typed, in Persian too", () => {
    for (const typed of [
      "Incident created by a bad deploy of checkout-api.",
      'Sigma detection rule "Sudo" matched security events. It was a drill.',
      "The pool size was cut to 10 (was 40).",
    ]) {
      expect(shown(renderRootCausePage("fa", typed))).toBe(typed);
      cleanup();
    }
  });

  test("no root cause draws the page's placeholder, worded", () => {
    const view: RenderResult = renderRootCausePage("de", "");

    expect(view.queryByTestId("markdown")).toBeNull();
  });
});

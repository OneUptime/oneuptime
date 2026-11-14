// UX rule: Docs/ux/README.md#in-every-language
import "@testing-library/jest-dom";
import {
  afterEach,
  beforeAll,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { cleanup, render, screen, within } from "@testing-library/react";
import fs from "fs";
import { createInstance, i18n } from "i18next";
import path from "path";
import React from "react";
import { I18nextProvider } from "react-i18next";
import {
  drawLine,
  DrawnLine,
  isDrawnAsWritten,
  ParagraphDirection,
} from "../../Helpers/BidiLayout";
import { getPathArrows, PathArrow } from "../../Helpers/PathArrows";
import {
  FIRST_STRONG_ISOLATE,
  POP_DIRECTIONAL_ISOLATE,
} from "../../../Types/ReadingDirection";

/*
 * AN ARROW BETWEEN TWO VALUES, OR AFTER A LINK'S WORDS, POINTS THE WAY THE
 * PAGE READS (#7666).
 *
 * A browser never turns "→" round. The Dashboard wrote it into its
 * components - between the two moments of a measurement, two shares of a
 * function's time, the first and last time of a folded breadcrumb, after a
 * link's words - so on an Arabic or Persian page it pointed from the second
 * value back at the first, and from the link back into its words. Each now
 * draws DirectionArrow: "←" on a page read from the right, "→" on one read
 * from the left, with the values beside it set apart.
 *
 * Drawn here with the real Dashboard locales and laid out with the copy of
 * the bidi algorithm in BidiLayout: on a page read from the right the first
 * value is drawn at the right, the arrow to its left points on to the
 * second, and a link's arrow is drawn after its words, at their left. An
 * English page is drawn as it was.
 */

const LOCALES: string = path.resolve(
  __dirname,
  "../../../../App/FeatureSet/Dashboard/src/Locales",
);

const LANGUAGES: Array<string> = ["en", "fa", "ar"];

const RIGHT_TO_LEFT_LANGUAGES: ReadonlyArray<string> = ["fa", "ar"];

const instances: Record<string, i18n> = {};
const locales: Record<string, Record<string, string>> = {};

beforeAll(async () => {
  for (const language of LANGUAGES) {
    const instance: i18n = createInstance();

    locales[language] = JSON.parse(
      fs.readFileSync(path.join(LOCALES, `${language}.json`), "utf8"),
    ) as Record<string, string>;

    await instance.init({
      lng: language,
      fallbackLng: "en",
      resources: { [language]: { translation: locales[language]! } },
      interpolation: { escapeValue: false },
      keySeparator: false,
      nsSeparator: false,
    });

    instances[language] = instance;
  }
});

afterEach(() => {
  cleanup();
});

// The diff's flame graph fetches its two windows; here it hands its tree up once drawn.
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Profiles/DiffFlamegraph",
  () => {
    return {
      __esModule: true,
      default: (props: {
        onDataLoaded?: (root: unknown) => void;
      }): React.ReactElement => {
        React.useEffect(() => {
          const timer: ReturnType<typeof setTimeout> = setTimeout(() => {
            props.onDataLoaded?.(mockDiffTree);
          }, 0);

          return () => {
            clearTimeout(timer);
          };
        }, []);

        return <div data-testid="diff-flamegraph" />;
      },
    };
  },
);

import MeasurementSummaryElement from "../../../../App/FeatureSet/Dashboard/src/Components/Measurement/MeasurementSummaryElement";
import DiffFlamegraphWithPresets from "../../../../App/FeatureSet/Dashboard/src/Components/Profiles/DiffFlamegraphWithPresets";
import { DiffFlamegraphNode } from "../../../../App/FeatureSet/Dashboard/src/Components/Profiles/DiffFlamegraph";
import BreadcrumbTimeline, {
  BreadcrumbEvent,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Exceptions/BreadcrumbTimeline";
import SetupChecklistTile from "../../../../App/FeatureSet/Dashboard/src/Components/UserSettings/SetupChecklist/SetupChecklistTile";
import {
  SetupStepImportance,
  SetupStepStatus,
} from "../../../../App/FeatureSet/Dashboard/src/Components/UserSettings/SetupChecklist/ChecklistModel";
import {
  ALERT_MEASUREMENT_FORM,
  INCIDENT_MEASUREMENT_FORM,
  MeasurementForm,
  MeasurementValues,
} from "../../../../App/FeatureSet/Dashboard/src/Utils/Measurement/MeasurementSetup";
import PageMap from "../../../../App/FeatureSet/Dashboard/src/Utils/PageMap";
import IconProp from "../../../Types/Icon/IconProp";
import ProviderLogo from "../../../Types/ProviderLogo/ProviderLogo";

const frame: (
  data: Partial<DiffFlamegraphNode> & { functionName: string },
) => DiffFlamegraphNode = (
  data: Partial<DiffFlamegraphNode> & { functionName: string },
): DiffFlamegraphNode => {
  return {
    fileName: "",
    lineNumber: 0,
    baselineValue: 0,
    comparisonValue: 0,
    delta: 0,
    deltaPercent: 0,
    selfBaselineValue: 0,
    selfComparisonValue: 0,
    selfDelta: 0,
    children: [],
    frameType: "",
    ...data,
  };
};

/*
 * One function's share of the self time went from 12.5% to 15.0% between
 * the two windows: the diff's table lists it as regressed.
 */
const mockDiffTree: DiffFlamegraphNode = frame({
  functionName: "root",
  baselineValue: 1000,
  comparisonValue: 1000,
  children: [
    frame({
      functionName: "reserveStock",
      fileName: "src/inventory/reserve.ts",
      baselineValue: 125,
      comparisonValue: 150,
      selfBaselineValue: 125,
      selfComparisonValue: 150,
    }),
    frame({
      functionName: "renderCart",
      fileName: "src/cart/render.ts",
      baselineValue: 875,
      comparisonValue: 850,
      selfBaselineValue: 875,
      selfComparisonValue: 850,
    }),
  ],
});

const RIGHTWARDS_ARROW: string = "→";
const LEFTWARDS_ARROW: string = "←";

// The paragraph a line is laid out in: the page's direction.
const directionOf: (language: string) => ParagraphDirection = (
  language: string,
): ParagraphDirection => {
  return RIGHT_TO_LEFT_LANGUAGES.includes(language) ? "rtl" : "ltr";
};

// "→" on a page read from the left, "←" on one read from the right.
const arrowOnFor: (language: string) => string = (language: string): string => {
  return directionOf(language) === "rtl" ? LEFTWARDS_ARROW : RIGHTWARDS_ARROW;
};

const LEFT_TO_RIGHT_ISOLATE: string = String.fromCharCode(0x2066);
const RIGHT_TO_LEFT_ISOLATE: string = String.fromCharCode(0x2067);

/*
 * An element's text as the bidi algorithm reads it: a <bdi> and an
 * element with a dir of its own are isolates (the HTML spec's
 * unicode-bidi: isolate), FSI, LRI or RLI ... PDI.
 */
const lineOf: (node: Node) => string = (node: Node): string => {
  if (node.nodeType === Node.TEXT_NODE) {
    return node.textContent || "";
  }

  if (node.nodeType !== Node.ELEMENT_NODE) {
    return "";
  }

  const element: Element = node as Element;
  const inner: string = Array.from(element.childNodes).map(lineOf).join("");
  const dir: string | null = element.getAttribute("dir");

  if (dir === "ltr") {
    return `${LEFT_TO_RIGHT_ISOLATE}${inner}${POP_DIRECTIONAL_ISOLATE}`;
  }

  if (dir === "rtl") {
    return `${RIGHT_TO_LEFT_ISOLATE}${inner}${POP_DIRECTIONAL_ISOLATE}`;
  }

  if (element.tagName === "BDI" || dir === "auto") {
    return `${FIRST_STRONG_ISOLATE}${inner}${POP_DIRECTIONAL_ISOLATE}`;
  }

  return inner;
};

// The one arrow a line holds, whichever way it points.
const arrowIn: (line: string) => string = (line: string): string => {
  const arrows: Array<string> = Array.from(line).filter(
    (character: string): boolean => {
      return character === RIGHTWARDS_ARROW || character === LEFTWARDS_ARROW;
    },
  );

  expect(arrows).toHaveLength(1);

  return arrows[0]!;
};

/*
 * The pieces of a line, found in the order they are written, in the order
 * they are drawn from the left.
 */
const drawnFromTheLeft: (data: {
  line: string;
  pieces: Array<string>;
  direction: ParagraphDirection;
}) => Array<string> = (data: {
  line: string;
  pieces: Array<string>;
  direction: ParagraphDirection;
}): Array<string> => {
  const drawn: DrawnLine = drawLine(data.line, data.direction);
  let from: number = 0;

  return data.pieces
    .map((piece: string): { piece: string; left: number } => {
      const at: number = data.line.indexOf(piece, from);

      expect({ piece, isInLine: at >= 0 }).toEqual({ piece, isInLine: true });

      from = at + piece.length;

      const positions: Array<number> = [];

      for (let index: number = at; index < at + piece.length; index++) {
        positions.push(drawn.drawnAt[index] as number);
      }

      return { piece, left: Math.min(...positions) };
    })
    .sort(
      (
        first: { piece: string; left: number },
        second: { piece: string; left: number },
      ): number => {
        return first.left - second.left;
      },
    )
    .map((placed: { piece: string; left: number }): string => {
      return placed.piece;
    });
};

// A value in Latin letters or digits, with signs and spaces: drawn as written.
const IN_LATIN_LETTERS_OR_DIGITS: RegExp =
  /^[\p{Script=Latin}\p{Nd}\p{P}\p{S}\s]+$/u;

/*
 * A line that leads from `first` to `second`: its arrow points on, the
 * values are drawn in the order the page reads (the first at the right on
 * a page read from the right), and a value in Latin letters or digits is
 * drawn as it is written.
 */
const expectToLeadFromFirstToSecond: (data: {
  line: string;
  first: string;
  second: string;
  language: string;
}) => void = (data: {
  line: string;
  first: string;
  second: string;
  language: string;
}): void => {
  const direction: ParagraphDirection = directionOf(data.language);
  const arrow: string = arrowIn(data.line);

  expect({ language: data.language, arrow }).toEqual({
    language: data.language,
    arrow: arrowOnFor(data.language),
  });

  expect(
    drawnFromTheLeft({
      line: data.line,
      pieces: [data.first, arrow, data.second],
      direction,
    }),
  ).toEqual(
    direction === "rtl"
      ? [data.second, LEFTWARDS_ARROW, data.first]
      : [data.first, RIGHTWARDS_ARROW, data.second],
  );

  expect(
    getPathArrows(data.line, direction).map((pathArrow: PathArrow): boolean => {
      return pathArrow.pointsBack;
    }),
  ).toEqual([false]);

  const drawn: DrawnLine = drawLine(data.line, direction);

  for (const value of [data.first, data.second]) {
    if (IN_LATIN_LETTERS_OR_DIGITS.test(value)) {
      const at: number = data.line.indexOf(value);

      expect({
        value,
        isDrawnAsWritten: isDrawnAsWritten(drawn, at, at + value.length),
      }).toEqual({ value, isDrawnAsWritten: true });
    }
  }
};

const inLanguage: (language: string, element: React.ReactElement) => void = (
  language: string,
  element: React.ReactElement,
): void => {
  render(
    <I18nextProvider i18n={instances[language]!}>{element}</I18nextProvider>,
  );
};

const translated: (language: string, text: string) => string = (
  language: string,
  text: string,
): string => {
  const words: string | undefined = locales[language]![text];

  expect({ text, language, isTranslated: Boolean(words) }).toEqual({
    text,
    language,
    isTranslated: true,
  });

  return words!;
};

describe("a measurement's two moments", () => {
  const drawSummary: (data: {
    language: string;
    form: MeasurementForm;
    measurement: MeasurementValues;
  }) => string = (data: {
    language: string;
    form: MeasurementForm;
    measurement: MeasurementValues;
  }): string => {
    inLanguage(
      data.language,
      <MeasurementSummaryElement
        form={data.form}
        measurement={data.measurement}
      />,
    );

    return lineOf(screen.getByTestId("measurement-summary"));
  };

  test.each(LANGUAGES)(
    "%s: from the moment it starts to the one it ends, in the page's words",
    (language: string) => {
      expectToLeadFromFirstToSecond({
        line: drawSummary({
          language,
          form: INCIDENT_MEASUREMENT_FORM,
          measurement: {
            startAnchorType: "Declared At",
            endAnchorType: "State Role Entered",
            endIncidentStateRole: "Acknowledged",
          },
        }),
        first: translated(language, "Declared"),
        second: translated(language, "Acknowledged"),
        language,
      });
    },
  );

  test.each(LANGUAGES)(
    "%s: to a state the project named in Latin letters",
    (language: string) => {
      expectToLeadFromFirstToSecond({
        line: drawSummary({
          language,
          form: ALERT_MEASUREMENT_FORM,
          measurement: {
            startAnchorType: "Created At",
            endAnchorType: "State Entered",
            endAlertState: { name: "Investigating" },
          },
        }),
        first: translated(language, "Created"),
        second: "Investigating",
        language,
      });
    },
  );

  /*
   * Between two names in Latin letters a bare arrow is drawn from the left,
   * the way the names read: each is set apart, so the arrow is the page's.
   */
  test.each(LANGUAGES)(
    "%s: between two states the project named in Latin letters",
    (language: string) => {
      expectToLeadFromFirstToSecond({
        line: drawSummary({
          language,
          form: ALERT_MEASUREMENT_FORM,
          measurement: {
            startAnchorType: "State Entered",
            startAlertState: { name: "Triggered" },
            endAnchorType: "State Entered",
            endAlertState: { name: "Resolved" },
          },
        }),
        first: "Triggered",
        second: "Resolved",
        language,
      });
    },
  );

  test("an English page reads as it did: Declared → Acknowledged", () => {
    drawSummary({
      language: "en",
      form: INCIDENT_MEASUREMENT_FORM,
      measurement: {
        startAnchorType: "Declared At",
        endAnchorType: "State Role Entered",
        endIncidentStateRole: "Acknowledged",
      },
    });

    expect(screen.getByTestId("measurement-summary")).toHaveTextContent(
      "Declared→Acknowledged",
    );
  });
});

describe("a function's share of the time, before and after", () => {
  test.each(LANGUAGES)(
    "%s: from the baseline's share to the comparison's",
    async (language: string) => {
      inLanguage(language, <DiffFlamegraphWithPresets windowMinutes={60} />);

      const change: HTMLElement = await screen.findByTestId(
        "profile-function-share-change",
      );

      expectToLeadFromFirstToSecond({
        line: lineOf(change),
        first: "12.5%",
        second: "15.0%",
        language,
      });
    },
  );

  test("an English page reads as it did: 12.5% → 15.0%", async () => {
    inLanguage("en", <DiffFlamegraphWithPresets windowMinutes={60} />);

    expect(
      await screen.findByTestId("profile-function-share-change"),
    ).toHaveTextContent("12.5% → 15.0%");
  });
});

describe("a folded breadcrumb's first and last time", () => {
  const EXCEPTION_TIME: Date = new Date(2026, 8, 14, 11, 56, 0, 0);

  const query: (offsetMs: number) => BreadcrumbEvent = (
    offsetMs: number,
  ): BreadcrumbEvent => {
    const time: Date = new Date(EXCEPTION_TIME.getTime() + offsetMs);

    return {
      name: "db.query",
      time,
      timeUnixNano: time.getTime() * 1000000,
      attributes: {
        "db.system": "postgresql",
        "db.statement": "SELECT * FROM stock WHERE sku = $1",
      },
    };
  };

  // The one row two identical queries fold into: its times, first to last.
  const drawFoldedTimes: (language: string) => string = (
    language: string,
  ): string => {
    inLanguage(
      language,
      <BreadcrumbTimeline
        events={[query(-410), query(-380)]}
        exceptionTime={EXCEPTION_TIME}
      />,
    );

    const rows: Array<HTMLElement> = screen.getAllByTestId("breadcrumb-row");

    expect(rows).toHaveLength(1);

    return lineOf(within(rows[0]!).getByTestId("breadcrumb-time"));
  };

  test.each(LANGUAGES)(
    "%s: from the first query's time to the last one's",
    (language: string) => {
      expectToLeadFromFirstToSecond({
        line: drawFoldedTimes(language),
        first: "-410 ms",
        second: "-380 ms",
        language,
      });
    },
  );

  test("an English page reads as it did: -410 ms → -380 ms", () => {
    drawFoldedTimes("en");

    expect(screen.getByTestId("breadcrumb-time")).toHaveTextContent(
      "-410 ms → -380 ms",
    );
  });
});

describe("a link's arrow, after its words", () => {
  const ENDS_IN_AN_ARROW: RegExp = /[←→]$/;

  // The innermost element of the step whose text ends with an arrow: its action line.
  const lineEndingInArrow: () => HTMLElement = (): HTMLElement => {
    const tile: HTMLElement = screen.getByTestId("setup-checklist-step-slack");
    const endingInArrow: Array<HTMLElement> = Array.from(
      tile.querySelectorAll<HTMLElement>("*"),
    ).filter((element: HTMLElement): boolean => {
      const text: string = (element.textContent || "").trim();

      return text.length > 1 && ENDS_IN_AN_ARROW.test(text);
    });
    const innermost: Array<HTMLElement> = endingInArrow.filter(
      (element: HTMLElement): boolean => {
        return !endingInArrow.some((other: HTMLElement): boolean => {
          return other !== element && element.contains(other);
        });
      },
    );

    expect(innermost).toHaveLength(1);

    return innermost[0]!;
  };

  // The words of a step to do, and its arrow: where the step is done.
  const drawActionLine: (language: string) => string = (
    language: string,
  ): string => {
    inLanguage(
      language,
      <SetupChecklistTile
        step={{
          key: "slack",
          title: "Connect Slack",
          description: "Get notified in Slack.",
          detail: "",
          status: SetupStepStatus.Incomplete,
          importance: SetupStepImportance.Optional,
          icon: IconProp.Slack,
          iconBackgroundClassName: "bg-fuchsia-500",
          logo: ProviderLogo.Slack,
          pageMap: PageMap.USER_SETTINGS_SLACK_INTEGRATION,
          actionTitle: "Connect Slack",
        }}
      />,
    );

    return lineOf(lineEndingInArrow());
  };

  test.each(LANGUAGES)(
    "%s: points on from the words, drawn after them",
    (language: string) => {
      const line: string = drawActionLine(language);
      const words: string = translated(language, "Connect Slack");
      const direction: ParagraphDirection = directionOf(language);
      const arrow: string = arrowIn(line);

      expect({ language, arrow }).toEqual({
        language,
        arrow: arrowOnFor(language),
      });

      expect(
        drawnFromTheLeft({ line, pieces: [words, arrow], direction }),
      ).toEqual(
        direction === "rtl"
          ? [LEFTWARDS_ARROW, words]
          : [words, RIGHTWARDS_ARROW],
      );
    },
  );

  test("its arrow only repeats what the words say: it is not read out", () => {
    drawActionLine("fa");

    expect(within(lineEndingInArrow()).getByText(/^[←→]$/)).toHaveAttribute(
      "aria-hidden",
      "true",
    );
  });

  test("an English page reads as it did: Connect Slack →", () => {
    expect(drawActionLine("en")).toBe("Connect Slack →");
  });
});

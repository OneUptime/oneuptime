import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import "@testing-library/jest-dom";
import * as React from "react";
import BulkUpdateForm, {
  BULK_KEEP_PAGE_OPEN,
  BULK_KEEP_PAGE_OPEN_NOT_STOPPABLE,
  BULK_NOT_STARTED_COUNT,
  BULK_STOPPING,
  BULK_TIME_LEFT_HOURS,
  BULK_TIME_LEFT_MINUTES,
  BULK_TIME_LEFT_UNDER_A_MINUTE,
  BulkActionButtonSchema,
  BulkActionOnClickProps,
  getBulkTimeLeftText,
} from "../../../UI/Components/BulkUpdate/BulkUpdateForm";
import {
  BulkItemOutcome,
  runBulkAction,
} from "../../../UI/Components/BulkUpdate/BulkActionRunner";
import { ButtonStyleType } from "../../../UI/Components/Button/Button";
import IconProp from "../../../Types/Icon/IconProp";
import { createTranslator } from "../../../UI/Utils/TranslateTemplate";

/*
 * THE BULK PROGRESS DIALOG, WHILE A RUN GOES ON AND WHEN IT ENDS (#5299).
 *
 * A customer resolving 4,594 alerts watched "1,432 of 4,594" for hours with
 * nothing to do but wait: the dialog's only button, Close, could not be
 * pressed, and nothing said how long it would take or what had failed so
 * far. Now, while a run goes on, the dialog:
 *
 *   - offers Stop: no more items are started, the ones running finish, and
 *     the end lists the items never reached;
 *   - counts what happened so far, in the words the summary will use;
 *   - says how long is left, once it can tell;
 *   - says to keep the page open, and the browser asks before it closes.
 */

jest.mock("react-i18next", () => {
  return {
    useTranslation: () => {
      return {
        t: (key: string, opts?: { defaultValue?: string }): string => {
          return opts?.defaultValue ?? key;
        },
      };
    },
  };
});

interface Row {
  _id: string;
  name: string;
}

function rows(count: number): Array<Row> {
  return Array.from({ length: count }, (_value: unknown, index: number) => {
    return { _id: `row-${index + 1}`, name: `Device ${index + 1}` };
  });
}

interface Gate {
  promise: Promise<void>;
  release: () => void;
  fail: (error: Error) => void;
}

function gate(): Gate {
  let release: () => void = () => {};
  let fail: (error: Error) => void = () => {};
  const promise: Promise<void> = new Promise<void>(
    (resolve: () => void, reject: (error: Error) => void) => {
      release = resolve;
      fail = reject;
    },
  );
  return { promise, release, fail };
}

function renderWith(
  items: Array<Row>,
  action: BulkActionButtonSchema<Row>,
): void {
  render(
    <BulkUpdateForm<Row>
      selectedItems={items}
      isAllItemsSelected={false}
      onSelectAllClick={() => {}}
      onClearSelectionClick={() => {}}
      singularLabel="Device"
      pluralLabel="Devices"
      buttons={[action]}
      itemToString={(row: Row): string => {
        return row.name;
      }}
    />,
  );

  fireEvent.click(screen.getByText("Bulk Actions"));
  fireEvent.click(screen.getByRole("menuitem", { name: action.title }));
}

// The dialog's one footer button: Stop, Stopping…, or Close.
function footerButton(): HTMLButtonElement {
  return screen.getByTestId("modal-footer-submit-button") as HTMLButtonElement;
}

function gatedAction(data: {
  gates: Array<Gate>;
  concurrency?: number;
  isStoppable?: boolean;
}): BulkActionButtonSchema<Row> {
  return {
    title: "Apply",
    icon: IconProp.Check,
    buttonStyleType: ButtonStyleType.NORMAL,
    onClick: async (props: BulkActionOnClickProps<Row>): Promise<void> => {
      await runBulkAction<Row>({
        actionProps: props,
        concurrency: data.concurrency ?? 2,
        isStoppable: data.isStoppable,
        progressIntervalInMs: 0,
        step: async (
          _row: Row,
          index: number,
        ): Promise<BulkItemOutcome | void> => {
          await data.gates[index]!.promise;
        },
      });
    },
  };
}

async function flush(): Promise<void> {
  await act(async () => {
    for (let i: number = 0; i < 10; i++) {
      await Promise.resolve();
    }
  });
}

describe("BulkUpdateForm while a run goes on", () => {
  test("its one button is Stop, and the note says to keep the page open and that a Stop keeps what is done", async () => {
    const gates: Array<Gate> = rows(3).map(() => {
      return gate();
    });
    renderWith(rows(3), gatedAction({ gates }));

    await screen.findByText("In Progress");

    expect(footerButton()).toHaveTextContent("Stop");
    expect(footerButton()).not.toBeDisabled();
    expect(screen.getByTestId("bulk-action-note")).toHaveTextContent(
      BULK_KEEP_PAGE_OPEN,
    );

    await act(async () => {
      gates.forEach((g: Gate) => {
        g.release();
      });
    });

    await screen.findByText("Completed");
    expect(footerButton()).toHaveTextContent("Close");
  });

  /*
   * Stop is the dialog's one button while a run goes on, and the focus used
   * to start on it: the Enter that confirmed the action, held a moment too
   * long, stopped the run it had just started. The focus starts on the
   * dialog instead, as it did when the one button was a Close that could
   * not be pressed.
   */
  test("the dialog opens with the focus on itself, not on Stop", async () => {
    const gates: Array<Gate> = rows(2).map(() => {
      return gate();
    });
    renderWith(rows(2), gatedAction({ gates }));

    await screen.findByText("In Progress");

    expect(footerButton()).toHaveTextContent("Stop");
    expect(footerButton()).not.toBeDisabled();
    expect(footerButton()).not.toHaveFocus();
    expect(screen.getByRole("dialog")).toHaveFocus();

    await act(async () => {
      gates.forEach((g: Gate) => {
        g.release();
      });
    });

    // Nothing stopped it: every item ran.
    await screen.findByText("Completed");
    expect(screen.queryByTestId("bulk-action-not-started-count")).toBeNull();
  });

  test("Stop starts no more items, finishes the ones running, and the end says how many were not started", async () => {
    const items: Array<Row> = rows(6);
    const gates: Array<Gate> = items.map(() => {
      return gate();
    });
    renderWith(items, gatedAction({ gates, concurrency: 2 }));

    await screen.findByText("In Progress");

    await act(async () => {
      fireEvent.click(footerButton());
    });

    // Stopping: the two running finish; nothing else starts.
    expect(footerButton()).toHaveTextContent("Stopping…");
    expect(footerButton()).toBeDisabled();
    expect(screen.getByTestId("bulk-action-note")).toHaveTextContent(
      BULK_STOPPING,
    );

    await act(async () => {
      gates[0]!.release();
      gates[1]!.release();
    });

    await screen.findByText("Stopped");

    expect(screen.getByTestId("bulk-action-succeeded-count")).toHaveTextContent(
      "2 Devices succeeded",
    );
    expect(
      screen.getByTestId("bulk-action-not-started-count"),
    ).toHaveTextContent("4 Devices not started: you stopped the action");
    expect(footerButton()).toHaveTextContent("Close");
    expect(footerButton()).not.toBeDisabled();
  });

  test("a Stop as the last items finish leaves nothing out, and the run reads Completed", async () => {
    const items: Array<Row> = rows(2);
    const gates: Array<Gate> = items.map(() => {
      return gate();
    });
    renderWith(items, gatedAction({ gates, concurrency: 2 }));

    await screen.findByText("In Progress");

    await act(async () => {
      fireEvent.click(footerButton());
    });
    await act(async () => {
      gates.forEach((g: Gate) => {
        g.release();
      });
    });

    await screen.findByText("Completed");
    expect(screen.queryByTestId("bulk-action-not-started-count")).toBeNull();
  });

  test("an action that cannot stop keeps its Close, unavailable until it ends, and says only to keep the page open", async () => {
    const gates: Array<Gate> = rows(2).map(() => {
      return gate();
    });
    renderWith(rows(2), gatedAction({ gates, isStoppable: false }));

    await screen.findByText("In Progress");

    expect(footerButton()).toHaveTextContent("Close");
    expect(footerButton()).toBeDisabled();
    expect(screen.getByTestId("bulk-action-note")).toHaveTextContent(
      BULK_KEEP_PAGE_OPEN_NOT_STOPPABLE,
    );

    await act(async () => {
      gates.forEach((g: Gate) => {
        g.release();
      });
    });

    await screen.findByText("Completed");
    expect(footerButton()).not.toBeDisabled();
  });

  test("counts what happened so far, in the summary's words, while the run goes on", async () => {
    const items: Array<Row> = rows(4);
    const gates: Array<Gate> = items.map(() => {
      return gate();
    });
    renderWith(items, gatedAction({ gates, concurrency: 4 }));

    await screen.findByText("In Progress");
    expect(screen.queryByTestId("bulk-action-live-counts")).toBeNull();

    await act(async () => {
      gates[0]!.release();
      gates[1]!.fail(new Error("You need the Edit Device permission."));
    });
    await flush();

    await waitFor(() => {
      expect(
        screen.getByTestId("bulk-action-live-succeeded"),
      ).toHaveTextContent("1 Device succeeded");
    });
    expect(screen.getByTestId("bulk-action-live-failed")).toHaveTextContent(
      "1 Device failed",
    );
    expect(screen.queryByTestId("bulk-action-live-unchanged")).toBeNull();

    await act(async () => {
      gates[2]!.release();
      gates[3]!.release();
    });
    await screen.findByText("Completed");
  });

  test("the browser asks before the page goes while a run goes on, and not once it has ended", async () => {
    const gates: Array<Gate> = rows(1).map(() => {
      return gate();
    });
    renderWith(rows(1), gatedAction({ gates }));

    await screen.findByText("In Progress");

    const whileRunning: Event = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(whileRunning);
    expect(whileRunning.defaultPrevented).toBe(true);

    await act(async () => {
      gates[0]!.release();
    });
    await screen.findByText("Completed");

    const afterwards: Event = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(afterwards);
    expect(afterwards.defaultPrevented).toBe(false);
  });

  test("says how long is left once the run can tell", async () => {
    const action: BulkActionButtonSchema<Row> = {
      title: "Apply",
      icon: IconProp.Check,
      buttonStyleType: ButtonStyleType.NORMAL,
      onClick: async (props: BulkActionOnClickProps<Row>): Promise<void> => {
        props.onBulkActionStart({ isStoppable: true });
        props.onProgressInfo({
          totalItems: props.items,
          successItems: [props.items[0]!],
          failed: [],
          unchanged: [],
          inProgressItems: props.items.slice(1),
          estimatedTimeLeftInMs: 4 * 60 * 1000,
        });
      },
    };

    renderWith(rows(3), action);

    await waitFor(() => {
      expect(screen.getByTestId("bulk-action-time-left")).toHaveTextContent(
        "About 4 minutes left",
      );
    });
  });
});

describe("getBulkTimeLeftText", () => {
  const english: ReturnType<typeof createTranslator> = createTranslator(
    undefined,
    "en",
  );

  test.each([
    [undefined, undefined],
    [-1, undefined],
    [Number.NaN, undefined],
    [0, "Less than a minute left"],
    [59 * 1000, "Less than a minute left"],
    [60 * 1000, "About 1 minute left"],
    [90 * 1000, "About 2 minutes left"],
    [44 * 60 * 1000, "About 44 minutes left"],
    [60 * 60 * 1000, "About 1 hour left"],
    [2.8 * 60 * 60 * 1000, "About 3 hours left"],
  ])("%p ms reads %p", (ms: number | undefined, text: string | undefined) => {
    expect(getBulkTimeLeftText(ms, english)).toBe(text);
  });
});

describe("the words", () => {
  test("say what a Stop left in one form for one item and another for several", () => {
    expect(BULK_NOT_STARTED_COUNT.one).toBe(
      "{{count}} {{itemName}} not started: you stopped the action",
    );
    expect(BULK_NOT_STARTED_COUNT.other).toBe(
      "{{count}} {{itemsName}} not started: you stopped the action",
    );
  });
});

describe("the words in every language", () => {
  /*
   * The dialog is drawn by the Dashboard and the Admin Dashboard, each
   * looking its strings up in its own locale files: a string missing from
   * one stays English there.
   */
  const LOCALE_DIRECTORIES: Array<[string, string]> = [
    [
      "Dashboard",
      path.resolve(
        __dirname,
        "../../../../App/FeatureSet/Dashboard/src/Locales",
      ),
    ],
    [
      "Admin Dashboard",
      path.resolve(
        __dirname,
        "../../../../App/FeatureSet/AdminDashboard/src/Locales",
      ),
    ],
  ];

  const OTHER_LANGUAGES: Array<string> = [
    "de",
    "fr",
    "es",
    "it",
    "pt",
    "nl",
    "da",
    "no",
    "sv",
    "ru",
    "ja",
    "ko",
    "zh-CN",
    "zh-TW",
    "hi",
    "fa",
  ];

  // Each key with the English the dialog shows for it.
  const KEYS: Array<[string, string]> = [
    [BULK_KEEP_PAGE_OPEN, BULK_KEEP_PAGE_OPEN],
    [BULK_KEEP_PAGE_OPEN_NOT_STOPPABLE, BULK_KEEP_PAGE_OPEN_NOT_STOPPABLE],
    [BULK_STOPPING, BULK_STOPPING],
    [BULK_TIME_LEFT_UNDER_A_MINUTE, BULK_TIME_LEFT_UNDER_A_MINUTE],
    [BULK_TIME_LEFT_MINUTES.other, BULK_TIME_LEFT_MINUTES.other],
    [`${BULK_TIME_LEFT_MINUTES.other}_one`, BULK_TIME_LEFT_MINUTES.one],
    [BULK_TIME_LEFT_HOURS.other, BULK_TIME_LEFT_HOURS.other],
    [`${BULK_TIME_LEFT_HOURS.other}_one`, BULK_TIME_LEFT_HOURS.one],
    [BULK_NOT_STARTED_COUNT.other, BULK_NOT_STARTED_COUNT.other],
    [`${BULK_NOT_STARTED_COUNT.other}_one`, BULK_NOT_STARTED_COUNT.one],
  ];

  const PLACEHOLDER: RegExp = /{{\s*(\w+)\s*}}/g;

  const placeholdersOf: (text: string) => Array<string> = (
    text: string,
  ): Array<string> => {
    return (text.match(PLACEHOLDER) || []).sort();
  };

  const localeCache: Map<string, Record<string, unknown>> = new Map<
    string,
    Record<string, unknown>
  >();

  const readLocale: (
    directory: string,
    language: string,
  ) => Record<string, unknown> = (
    directory: string,
    language: string,
  ): Record<string, unknown> => {
    // The Dashboard's files are large: each is read once.
    const file: string = path.join(directory, `${language}.json`);

    if (!localeCache.has(file)) {
      localeCache.set(
        file,
        JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, unknown>,
      );
    }

    return localeCache.get(file)!;
  };

  test.each(LOCALE_DIRECTORIES)(
    "the %s has each in English and translated in every other language, with its placeholders",
    (_frontend: string, directory: string) => {
      const english: Record<string, unknown> = readLocale(directory, "en");

      for (const [key, englishText] of KEYS) {
        expect({ key, english: english[key] }).toEqual({
          key,
          english: englishText,
        });

        for (const language of OTHER_LANGUAGES) {
          const translated: unknown = readLocale(directory, language)[key];

          expect({
            key,
            language,
            isText: typeof translated === "string",
          }).toEqual({ key, language, isText: true });
          expect({ key, language, same: translated === englishText }).toEqual({
            key,
            language,
            same: false,
          });
          expect(placeholdersOf(translated as string)).toEqual(
            placeholdersOf(englishText),
          );
        }
      }
    },
  );

  test.each(LOCALE_DIRECTORIES)(
    "the %s says the same as the other in each language",
    (_frontend: string, directory: string) => {
      const dashboard: string = LOCALE_DIRECTORIES[0]![1];

      for (const language of OTHER_LANGUAGES) {
        const here: Record<string, unknown> = readLocale(directory, language);
        const there: Record<string, unknown> = readLocale(dashboard, language);

        for (const [key] of KEYS) {
          expect({ key, language, text: here[key] }).toEqual({
            key,
            language,
            text: there[key],
          });
        }
      }
    },
  );

  test("the old note, which no dialog shows any more, is gone from both", () => {
    for (const [, directory] of LOCALE_DIRECTORIES) {
      for (const language of ["en", ...OTHER_LANGUAGES]) {
        expect(
          Object.keys(readLocale(directory, language)).filter((key: string) => {
            return key.startsWith("Please wait while the bulk action");
          }),
        ).toEqual([]);
      }
    }
  });

  test("a German reader is told how long is left in German", () => {
    const german: Record<string, unknown> = readLocale(
      LOCALE_DIRECTORIES[0]![1],
      "de",
    );

    const translator: ReturnType<typeof createTranslator> = createTranslator(
      (key: string): string | undefined => {
        const value: unknown = german[key];
        return typeof value === "string" ? value : undefined;
      },
      "de",
    );

    expect(getBulkTimeLeftText(30 * 1000, translator)).toBe(
      "Noch weniger als eine Minute",
    );
    expect(getBulkTimeLeftText(60 * 1000, translator)).toBe(
      "Noch etwa 1 Minute",
    );
    expect(getBulkTimeLeftText(12 * 60 * 1000, translator)).toBe(
      "Noch etwa 12 Minuten",
    );
    expect(getBulkTimeLeftText(3 * 60 * 60 * 1000, translator)).toBe(
      "Noch etwa 3 Stunden",
    );
  });
});

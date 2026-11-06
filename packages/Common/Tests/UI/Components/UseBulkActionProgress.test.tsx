import { afterEach, describe, expect, jest, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import "@testing-library/jest-dom";
import * as React from "react";
import {
  BULK_FAILED_COUNT,
  BULK_KEEP_PAGE_OPEN,
  BULK_KEEP_PAGE_OPEN_NOT_STOPPABLE,
  BULK_NOT_STARTED_COUNT,
  BULK_STOPPING,
  BULK_SUCCEEDED_COUNT,
  BULK_UNCHANGED_COUNT,
  BulkActionProgress,
  BulkRunWords,
  useBulkActionProgress,
} from "../../../UI/Components/BulkUpdate/BulkUpdateForm";
import {
  BulkItemOutcome,
  bulkItemUnchanged,
  runBulkAction,
} from "../../../UI/Components/BulkUpdate/BulkActionRunner";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * A BULK RUN'S PROGRESS AND RESULT, OUTSIDE A TABLE (fu-bulk-actions).
 *
 * The dialog a table's Bulk Actions show while a run goes on and once it
 * has ended is a hook of its own (useBulkActionProgress), so bulk work that
 * does not start from a table's selection - Add in Bulk on a status page's
 * subscriber lists - runs the same way: several at once through
 * runBulkAction, with the count, the time left, Stop, and a result that
 * says what happened to every item. Before, each such page drew a dialog
 * of its own, one item at a time and with no Stop.
 *
 * Driven here through a page of its own: a button that starts a run over
 * the items, and the hook's dialog.
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
    return { _id: `row-${index + 1}`, name: `person${index + 1}@example.com` };
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

const ADD_WORDS: BulkRunWords<Row> = {
  resultLabels: {
    succeeded: {
      one: "{{count}} {{itemName}} added",
      other: "{{count}} {{itemsName}} added",
    },
    failed: {
      one: "{{count}} {{itemName}} not added",
      other: "{{count}} {{itemsName}} not added",
    },
    unchanged: {
      one: "{{count}} {{itemName}} skipped",
      other: "{{count}} {{itemsName}} skipped",
    },
  },
};

interface HarnessProps {
  items: Array<Row>;
  step: (row: Row, index: number) => Promise<BulkItemOutcome | void>;
  words?: BulkRunWords<Row> | undefined;
  concurrency?: number | undefined;
  isStoppable?: boolean | undefined;
  onActionStart?: (() => void) | undefined;
  onActionEnd?: (() => void) | undefined;
  onRender?: ((progress: BulkActionProgress<Row>) => void) | undefined;
}

const Harness: React.FunctionComponent<HarnessProps> = (
  props: HarnessProps,
): React.ReactElement => {
  const progress: BulkActionProgress<Row> = useBulkActionProgress<Row>({
    singularLabel: "Subscriber",
    pluralLabel: "Subscribers",
    itemToString: (row: Row): string => {
      return row.name;
    },
    onActionStart: props.onActionStart,
    onActionEnd: props.onActionEnd,
  });

  props.onRender?.(progress);

  return (
    <div>
      <button
        type="button"
        onClick={() => {
          void runBulkAction<Row>({
            actionProps: progress.getActionProps(props.items, props.words),
            concurrency: props.concurrency ?? 2,
            isStoppable: props.isStoppable,
            progressIntervalInMs: 0,
            step: props.step,
          });
        }}
      >
        Start
      </button>
      {progress.dialog}
    </div>
  );
};

function gatedStep(
  gates: Array<Gate>,
): (row: Row, index: number) => Promise<void> {
  return async (_row: Row, index: number): Promise<void> => {
    await gates[index]!.promise;
  };
}

async function flush(): Promise<void> {
  await act(async () => {
    for (let i: number = 0; i < 10; i++) {
      await Promise.resolve();
    }
  });
}

function start(): void {
  fireEvent.click(screen.getByText("Start"));
}

// The dialog's one footer button: Stop, Stopping…, or Close.
function footerButton(): HTMLButtonElement {
  return screen.getByTestId("modal-footer-submit-button") as HTMLButtonElement;
}

async function releaseAll(gates: Array<Gate>): Promise<void> {
  await act(async () => {
    gates.forEach((g: Gate) => {
      g.release();
    });
  });
  await flush();
}

afterEach(() => {
  cleanup();
});

describe("useBulkActionProgress before and while a run goes on", () => {
  test("draws nothing until a run starts", () => {
    render(<Harness items={rows(2)} step={gatedStep([gate(), gate()])} />);

    expect(screen.queryByTestId("modal-title")).toBeNull();
    expect(screen.queryByTestId("bulk-action-in-progress")).toBeNull();
  });

  test("opens as the run starts, counting the items in their own name, with Stop and the keep-open note", async () => {
    const gates: Array<Gate> = [gate(), gate(), gate()];
    render(<Harness items={rows(3)} step={gatedStep(gates)} />);

    start();

    await screen.findByText("In Progress");
    expect(screen.getByTestId("progress-bar-count")).toHaveTextContent(
      "0 of 3 Subscribers",
    );
    expect(screen.getByTestId("bulk-action-note")).toHaveTextContent(
      BULK_KEEP_PAGE_OPEN,
    );
    expect(footerButton()).toHaveTextContent("Stop");
    expect(footerButton()).not.toBeDisabled();
    // The Enter that started it must not stop it: the focus is on the dialog.
    expect(footerButton()).not.toHaveFocus();
    expect(screen.getByRole("dialog")).toHaveFocus();

    await releaseAll(gates);
    await screen.findByText("Completed");
  });

  test("counts what has happened so far in the run's own words", async () => {
    const gates: Array<Gate> = [gate(), gate(), gate()];
    render(
      <Harness items={rows(3)} step={gatedStep(gates)} words={ADD_WORDS} />,
    );

    start();
    await screen.findByText("In Progress");

    await act(async () => {
      gates[0]!.release();
    });
    await flush();

    expect(screen.getByTestId("bulk-action-live-succeeded")).toHaveTextContent(
      "1 Subscriber added",
    );
    expect(screen.getByTestId("progress-bar-count")).toHaveTextContent(
      "1 of 3 Subscribers",
    );

    await act(async () => {
      gates[1]!.fail(new Error("You are already subscribed to this page."));
    });
    await flush();

    expect(screen.getByTestId("bulk-action-live-failed")).toHaveTextContent(
      "1 Subscriber not added",
    );

    await releaseAll(gates);
    await screen.findByText("Completed");
  });

  test("tells the page it is running, and when it is done", async () => {
    const gates: Array<Gate> = [gate()];
    const seen: Array<boolean> = [];
    render(
      <Harness
        items={rows(1)}
        step={gatedStep(gates)}
        onRender={(progress: BulkActionProgress<Row>) => {
          seen.push(progress.isRunning);
        }}
      />,
    );

    expect(seen[seen.length - 1]).toBe(false);

    start();
    await screen.findByText("In Progress");
    expect(seen[seen.length - 1]).toBe(true);

    await releaseAll(gates);
    await screen.findByText("Completed");
    expect(seen[seen.length - 1]).toBe(false);
  });

  test("calls the page's onActionStart once, as the run starts", async () => {
    const onActionStart: MockFunction = getJestMockFunction();
    const gates: Array<Gate> = [gate(), gate()];
    render(
      <Harness
        items={rows(2)}
        step={gatedStep(gates)}
        onActionStart={onActionStart as unknown as () => void}
      />,
    );

    expect(onActionStart).not.toHaveBeenCalled();

    start();
    await screen.findByText("In Progress");
    expect(onActionStart).toHaveBeenCalledTimes(1);

    await releaseAll(gates);
    expect(onActionStart).toHaveBeenCalledTimes(1);
  });

  test("the browser asks before the page goes while the run goes on, and not once it has ended", async () => {
    const gates: Array<Gate> = [gate()];
    render(<Harness items={rows(1)} step={gatedStep(gates)} />);

    start();
    await screen.findByText("In Progress");

    const during: Event = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(during);
    expect(during.defaultPrevented).toBe(true);

    await releaseAll(gates);
    await screen.findByText("Completed");

    const after: Event = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(after);
    expect(after.defaultPrevented).toBe(false);
  });

  test("a run that cannot stop keeps Close, held until it ends, and says only to keep the page open", async () => {
    const gates: Array<Gate> = [gate(), gate()];
    render(
      <Harness items={rows(2)} step={gatedStep(gates)} isStoppable={false} />,
    );

    start();
    await screen.findByText("In Progress");

    expect(footerButton()).toHaveTextContent("Close");
    expect(footerButton()).toBeDisabled();
    expect(screen.getByTestId("bulk-action-note")).toHaveTextContent(
      BULK_KEEP_PAGE_OPEN_NOT_STOPPABLE,
    );

    await releaseAll(gates);
    await screen.findByText("Completed");
    expect(footerButton()).not.toBeDisabled();
  });
});

describe("useBulkActionProgress when the person stops the run", () => {
  test("Stop starts no more: the ones running finish, and the end counts the rest as never started", async () => {
    const gates: Array<Gate> = rows(6).map(() => {
      return gate();
    });
    const started: Array<number> = [];

    render(
      <Harness
        items={rows(6)}
        concurrency={2}
        step={async (_row: Row, index: number): Promise<void> => {
          started.push(index);
          await gates[index]!.promise;
        }}
      />,
    );

    start();
    await screen.findByText("In Progress");
    expect(started).toEqual([0, 1]);

    fireEvent.click(footerButton());

    expect(footerButton()).toHaveTextContent("Stopping…");
    expect(footerButton()).toBeDisabled();
    expect(screen.getByTestId("bulk-action-note")).toHaveTextContent(
      BULK_STOPPING,
    );

    await releaseAll(gates);
    await screen.findByText("Stopped");

    // The two that had started finished; the other four were never begun.
    expect(started).toEqual([0, 1]);
    expect(screen.getByTestId("bulk-action-succeeded-count")).toHaveTextContent(
      "2 Subscribers succeeded",
    );
    expect(
      screen.getByTestId("bulk-action-not-started-count"),
    ).toHaveTextContent(
      BULK_NOT_STARTED_COUNT.other
        .replace("{{count}}", "4")
        .replace("{{itemsName}}", "Subscribers"),
    );
    expect(footerButton()).toHaveTextContent("Close");
  });
});

describe("useBulkActionProgress once the run has ended", () => {
  test("says what happened to every item, by name and with why, in the run's own words", async () => {
    render(
      <Harness
        items={rows(5)}
        words={ADD_WORDS}
        step={async (
          _row: Row,
          index: number,
        ): Promise<BulkItemOutcome | void> => {
          if (index === 1) {
            throw new Error("You are already subscribed to this status page.");
          }

          if (index === 3) {
            return bulkItemUnchanged("Email is not valid.");
          }

          return undefined;
        }}
      />,
    );

    start();
    await screen.findByText("Completed");

    expect(screen.getByTestId("bulk-action-succeeded-count")).toHaveTextContent(
      "3 Subscribers added",
    );
    expect(screen.getByTestId("bulk-action-failed-count")).toHaveTextContent(
      "1 Subscriber not added",
    );
    expect(screen.getByTestId("bulk-action-unchanged-count")).toHaveTextContent(
      "1 Subscriber skipped",
    );

    const failed: HTMLElement = screen.getByTestId("bulk-action-failed-items");
    expect(within(failed).getByText("person2@example.com")).toBeInTheDocument();
    expect(
      within(failed).getByText(
        "You are already subscribed to this status page.",
      ),
    ).toBeInTheDocument();

    const skipped: HTMLElement = screen.getByTestId(
      "bulk-action-unchanged-items",
    );
    expect(
      within(skipped).getByText("person4@example.com"),
    ).toBeInTheDocument();
    expect(
      within(skipped).getByText("Email is not valid."),
    ).toBeInTheDocument();
  });

  test("a run without words of its own uses the shared ones", async () => {
    render(
      <Harness
        items={rows(3)}
        step={async (
          _row: Row,
          index: number,
        ): Promise<BulkItemOutcome | void> => {
          if (index === 0) {
            throw new Error("Refused.");
          }

          if (index === 1) {
            return bulkItemUnchanged("Already there.");
          }

          return undefined;
        }}
      />,
    );

    start();
    await screen.findByText("Completed");

    expect(screen.getByTestId("bulk-action-succeeded-count")).toHaveTextContent(
      BULK_SUCCEEDED_COUNT.one
        .replace("{{count}}", "1")
        .replace("{{itemName}}", "Subscriber"),
    );
    expect(screen.getByTestId("bulk-action-failed-count")).toHaveTextContent(
      BULK_FAILED_COUNT.one
        .replace("{{count}}", "1")
        .replace("{{itemName}}", "Subscriber"),
    );
    expect(screen.getByTestId("bulk-action-unchanged-count")).toHaveTextContent(
      BULK_UNCHANGED_COUNT.one
        .replace("{{count}}", "1")
        .replace("{{itemName}}", "Subscriber"),
    );
  });

  test("Close takes the dialog away and tells the page once", async () => {
    const onActionEnd: MockFunction = getJestMockFunction();
    render(
      <Harness
        items={rows(2)}
        step={async (): Promise<void> => {}}
        onActionEnd={onActionEnd as unknown as () => void}
      />,
    );

    start();
    await screen.findByText("Completed");
    expect(onActionEnd).not.toHaveBeenCalled();

    fireEvent.click(footerButton());

    expect(screen.queryByTestId("modal-title")).toBeNull();
    expect(onActionEnd).toHaveBeenCalledTimes(1);
  });

  test("a second run starts clean: its own count, its own words and a Stop of its own", async () => {
    const firstGates: Array<Gate> = [gate()];
    const { rerender } = render(
      <Harness items={rows(1)} step={gatedStep(firstGates)} />,
    );

    start();
    await screen.findByText("In Progress");

    // The first run is stopped, and ends stopped.
    fireEvent.click(footerButton());
    await releaseAll(firstGates);
    await screen.findByText("Completed");
    fireEvent.click(footerButton());
    expect(screen.queryByTestId("modal-title")).toBeNull();

    const secondGates: Array<Gate> = [gate(), gate(), gate(), gate()];
    rerender(
      <Harness
        items={rows(4)}
        step={gatedStep(secondGates)}
        words={ADD_WORDS}
      />,
    );

    start();
    await screen.findByText("In Progress");

    expect(screen.getByTestId("progress-bar-count")).toHaveTextContent(
      "0 of 4 Subscribers",
    );
    // Not stopping: the first run's Stop was its own.
    expect(footerButton()).toHaveTextContent("Stop");
    expect(footerButton()).not.toBeDisabled();

    await releaseAll(secondGates);
    await screen.findByText("Completed");
    expect(screen.getByTestId("bulk-action-succeeded-count")).toHaveTextContent(
      "4 Subscribers added",
    );
    expect(screen.queryByTestId("bulk-action-not-started-count")).toBeNull();
  });
});

/*
 * One dialog for every bulk run: a table's Bulk Actions draw theirs through
 * the same hook, so the two cannot drift apart.
 */
describe("the table's Bulk Actions", () => {
  const source: string = fs.readFileSync(
    path.join(
      __dirname,
      "..",
      "..",
      "..",
      "UI",
      "Components",
      "BulkUpdate",
      "BulkUpdateForm.tsx",
    ),
    "utf8",
  );

  const componentSource: string = source.slice(
    source.indexOf("const BulkUpdateForm: <T extends GenericObject>("),
  );

  test("run through useBulkActionProgress, and draw its dialog", () => {
    expect(componentSource).toContain("useBulkActionProgress<T>({");
    expect(componentSource).toContain(
      "progress.getActionProps(props.selectedItems, button)",
    );
    expect(componentSource).toContain("{progress.dialog}");
  });

  test("keep no progress of their own", () => {
    expect(componentSource).not.toContain("setProgressInfo");
    expect(componentSource).not.toContain("setShowProgressInfoModal");
    expect(componentSource).not.toContain("new AbortController()");
  });
});

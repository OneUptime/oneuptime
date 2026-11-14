import { describe, expect, test } from "@jest/globals";
import DashboardSignals, {
  BACK_AND_FORTH_WINDOW_MS,
  DashboardSignalHit,
  DashboardSignalName,
  FORM_REFUSALS_FOR_SIGNAL,
  QUICK_EXIT_MS,
} from "../../../../App/FeatureSet/Dashboard/src/Utils/DashboardRecording/DashboardSignals";

/*
 * The Dashboard's own signs that somebody is stuck (#6834): a form refused
 * again and again, a page left within seconds, going back and forth
 * between two pages. Each names the page it happened on.
 */

const HOME: string = "/dashboard/:projectId/home";
const CREATE: string = "/dashboard/:projectId/monitors/create";
const SETTINGS: string = "/dashboard/:projectId/settings";

const names: (hits: Array<DashboardSignalHit>) => Array<string> = (
  hits: Array<DashboardSignalHit>,
): Array<string> => {
  return hits.map((hit: DashboardSignalHit): string => {
    return hit.name;
  });
};

describe("a page left within seconds", () => {
  test("is a signal on the page that was left, when the person left it", () => {
    const signals: DashboardSignals = new DashboardSignals();

    signals.notePage(HOME, 0);
    signals.noteInput();

    expect(signals.notePage(CREATE, QUICK_EXIT_MS - 1)).toEqual([
      { name: DashboardSignalName.PageLeftQuickly, page: HOME },
    ]);
  });

  test("is not a redirect: nothing the person did on the page", () => {
    const signals: DashboardSignals = new DashboardSignals();

    signals.notePage(HOME, 0);

    expect(signals.notePage(CREATE, 100)).toEqual([]);
  });

  test("is not a page the person stayed on", () => {
    const signals: DashboardSignals = new DashboardSignals();

    signals.notePage(HOME, 0);
    signals.noteInput();

    expect(signals.notePage(CREATE, QUICK_EXIT_MS)).toEqual([]);
  });

  test("starts counting again on each page", () => {
    const signals: DashboardSignals = new DashboardSignals();

    signals.notePage(HOME, 0);
    signals.noteInput();
    signals.notePage(CREATE, 10 * QUICK_EXIT_MS);

    // Input on Home does not carry over to Create.
    expect(signals.notePage(SETTINGS, 10 * QUICK_EXIT_MS + 10)).toEqual([]);
  });

  test("is not the same page noted twice", () => {
    const signals: DashboardSignals = new DashboardSignals();

    signals.notePage(HOME, 0);
    signals.noteInput();

    expect(signals.notePage(HOME, 10)).toEqual([]);
  });
});

describe("going back and forth", () => {
  test("is A, B, A, B within the window, on the page arrived at", () => {
    const signals: DashboardSignals = new DashboardSignals();

    signals.notePage(HOME, 0);
    signals.notePage(SETTINGS, 10 * 1000);
    signals.notePage(HOME, 20 * 1000);

    expect(names(signals.notePage(SETTINGS, 30 * 1000))).toContain(
      DashboardSignalName.BackAndForth,
    );
  });

  test("names the page it ended on", () => {
    const signals: DashboardSignals = new DashboardSignals();

    signals.notePage(HOME, 0);
    signals.notePage(SETTINGS, 10 * 1000);
    signals.notePage(HOME, 20 * 1000);

    expect(signals.notePage(SETTINGS, 30 * 1000)).toContainEqual({
      name: DashboardSignalName.BackAndForth,
      page: SETTINGS,
    });
  });

  test("is not three pages", () => {
    const signals: DashboardSignals = new DashboardSignals();

    signals.notePage(HOME, 0);
    signals.notePage(SETTINGS, 10 * 1000);
    signals.notePage(CREATE, 20 * 1000);

    expect(names(signals.notePage(SETTINGS, 30 * 1000))).not.toContain(
      DashboardSignalName.BackAndForth,
    );
  });

  test("is not slower than the window", () => {
    const signals: DashboardSignals = new DashboardSignals();

    signals.notePage(HOME, 0);
    signals.notePage(SETTINGS, 10 * 1000);
    signals.notePage(HOME, 20 * 1000);

    expect(
      names(signals.notePage(SETTINGS, BACK_AND_FORTH_WINDOW_MS + 1)),
    ).not.toContain(DashboardSignalName.BackAndForth);
  });

  test("says so once, then needs a new A, B, A, B", () => {
    const signals: DashboardSignals = new DashboardSignals();

    signals.notePage(HOME, 0);
    signals.notePage(SETTINGS, 1000);
    signals.notePage(HOME, 2000);
    signals.notePage(SETTINGS, 3000);

    expect(names(signals.notePage(HOME, 4000))).not.toContain(
      DashboardSignalName.BackAndForth,
    );
    expect(names(signals.notePage(SETTINGS, 5000))).not.toContain(
      DashboardSignalName.BackAndForth,
    );
    expect(names(signals.notePage(HOME, 6000))).toContain(
      DashboardSignalName.BackAndForth,
    );
  });
});

describe("a form refused again and again", () => {
  test("is a signal on the page at the refusal that makes it repeated", () => {
    const signals: DashboardSignals = new DashboardSignals();

    signals.notePage(CREATE, 0);

    for (let i: number = 1; i < FORM_REFUSALS_FOR_SIGNAL; i++) {
      expect(signals.noteFormRefusal()).toEqual([]);
    }

    expect(signals.noteFormRefusal()).toEqual([
      { name: DashboardSignalName.FormRefusedRepeatedly, page: CREATE },
    ]);
  });

  test("says so once per visit to the page", () => {
    const signals: DashboardSignals = new DashboardSignals();

    signals.notePage(CREATE, 0);

    for (let i: number = 0; i < FORM_REFUSALS_FOR_SIGNAL; i++) {
      signals.noteFormRefusal();
    }

    expect(signals.noteFormRefusal()).toEqual([]);

    signals.notePage(HOME, 1000 * 1000);
    signals.notePage(CREATE, 2000 * 1000);

    for (let i: number = 1; i < FORM_REFUSALS_FOR_SIGNAL; i++) {
      signals.noteFormRefusal();
    }

    expect(names(signals.noteFormRefusal())).toEqual([
      DashboardSignalName.FormRefusedRepeatedly,
    ]);
  });

  test("counts per page: refusals on one page do not add up on the next", () => {
    const signals: DashboardSignals = new DashboardSignals();

    signals.notePage(CREATE, 0);
    signals.noteFormRefusal();
    signals.noteFormRefusal();
    signals.notePage(SETTINGS, 1000 * 1000);

    expect(signals.noteFormRefusal()).toEqual([]);
  });

  test("is nothing before any page is known", () => {
    expect(new DashboardSignals().noteFormRefusal()).toEqual([]);
  });

  test("a refusal is the person on the page, so leaving fast after it is a quick exit", () => {
    const signals: DashboardSignals = new DashboardSignals();

    signals.notePage(CREATE, 0);
    signals.noteFormRefusal();

    expect(names(signals.notePage(HOME, 1000))).toEqual([
      DashboardSignalName.PageLeftQuickly,
    ]);
  });

  test("is named in the product's event style, area/thing_happened", () => {
    for (const name of Object.values(DashboardSignalName)) {
      expect(name).toMatch(/^frustration\/[a-z_]+$/);
    }
  });
});

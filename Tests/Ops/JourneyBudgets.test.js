"use strict";

/**
 * The journey budgets (#6831): what each core job costs a newcomer, kept in
 * Tests/Ops/JourneyBudgets.json and held by the offline journeys in
 * packages/E2E/Journeys (npm run test-journeys-ui, a Dashboard Offline UI
 * group in App Test).
 *
 * This holds the budget file and what reads it, without a browser:
 *   - the file's shape: every journey has a title, a path, where it starts
 *     and ends, and a whole number for every measure, and nothing else;
 *   - the seven core jobs of #6831 each have a budget;
 *   - every journey Journeys.spec.ts runs has a budget, and every budget is
 *     a journey it runs: a budget nobody checks would stay forever;
 *   - the decision #6831 asked for: a run fails on the structural measures
 *     (screens, dialogs, clicks, fields typed, products crossed) whichever
 *     way they move, and only reports the ones that move with copy edits;
 *   - what a failure says: the journey, the measure, both numbers, what was
 *     counted and what to do - and the table a pull request pastes;
 *   - the README says how to read a failure and how to lower a budget.
 */

const fs = require("fs");
const path = require("path");

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const JOURNEYS_DIR = "packages/E2E/Journeys";
const {
  BUDGET_FILE,
  MEASURES,
  FAIL_ON,
  REPORTED,
  MEASURE_NAMES,
  problemsWithBudgetFile,
  compareWithBudget,
  reportTable,
} = require(path.join(REPO_ROOT, JOURNEYS_DIR, "JourneyBudget.js"));

function read(relativePath) {
  return fs.readFileSync(path.join(REPO_ROOT, relativePath), "utf8");
}

const budgets = JSON.parse(read(BUDGET_FILE));

// The seven core jobs #6831 asked for, by the ids the journeys use.
const CORE_JOBS = [
  "website-monitor",
  "told-when-down",
  "paged-by-phone",
  "status-page",
  "first-telemetry",
  "member-reachable",
  "server-email",
];

// The journeys Journeys.spec.ts runs: journey("<id>", ...).
function journeysInSpec() {
  const source = read(`${JOURNEYS_DIR}/Journeys.spec.ts`);
  return Array.from(source.matchAll(/\bjourney\(\s*"([a-z0-9-]+)"/g)).map(
    (match) => {
      return match[1];
    },
  );
}

function counts(overrides) {
  return {
    screens: 2,
    dialogs: 0,
    clicks: 9,
    fieldsTyped: 2,
    products: 1,
    keystrokes: 41,
    defaultsKept: 2,
    choices: 13,
    words: 315,
    ...(overrides || {}),
  };
}

function fileWith(budget, extra) {
  return {
    failOn: [...FAIL_ON],
    reported: [...REPORTED],
    journeys: {
      "website-monitor": {
        title: "Create a website monitor",
        path: "manual",
        startsAt: "Home",
        endsWhen: "the monitor's page opens",
        budget: counts(budget),
      },
      ...(extra || {}),
    },
  };
}

function runWith(measures, details) {
  return {
    measures: counts(measures),
    details: {
      screens: ["/dashboard/:id/monitors", "/dashboard/:id/monitors/create"],
      dialogs: [],
      products: ["monitors"],
      fieldsTyped: ["Name", "Website URL"],
      defaultsKept: [],
      choices: [],
      steps: [],
      ...(details || {}),
    },
  };
}

describe("Tests/Ops/JourneyBudgets.json", () => {
  test("is shaped as the journeys read it", () => {
    expect(problemsWithBudgetFile(budgets)).toEqual([]);
  });

  test("has a budget for each of the seven core jobs of #6831", () => {
    expect(Object.keys(budgets.journeys)).toEqual(
      expect.arrayContaining(CORE_JOBS),
    );
  });

  test("has a budget for every journey the spec runs, and runs every journey it has a budget for", () => {
    const run = journeysInSpec();

    expect(run.length).toBeGreaterThanOrEqual(CORE_JOBS.length);
    expect(new Set(run).size).toBe(run.length);
    expect({
      withoutBudget: run.filter((id) => {
        return !budgets.journeys[id];
      }),
      notRun: Object.keys(budgets.journeys).filter((id) => {
        return !run.includes(id);
      }),
    }).toEqual({ withoutBudget: [], notRun: [] });
  });

  test("lists the journeys in the order the spec runs them, so the table reads as the spec does", () => {
    expect(Object.keys(budgets.journeys)).toEqual(journeysInSpec());
  });

  test("fails on the structural measures and reports the ones copy edits move (#6831's decision)", () => {
    expect(FAIL_ON).toEqual([
      "screens",
      "dialogs",
      "clicks",
      "fieldsTyped",
      "products",
    ]);
    expect(REPORTED).toEqual([
      "keystrokes",
      "defaultsKept",
      "choices",
      "words",
    ]);
    expect([...FAIL_ON, ...REPORTED].sort()).toEqual([...MEASURES].sort());
    expect(budgets.failOn).toEqual(FAIL_ON);
    expect(budgets.reported).toEqual(REPORTED);
  });

  test("keeps one measure per line, so lowering a budget is a one-line change", () => {
    const lines = read(BUDGET_FILE).split("\n");
    for (const measure of MEASURES) {
      const measureLines = lines.filter((line) => {
        return new RegExp(`^\\s+"${measure}": \\d+,?$`).test(line);
      });
      expect({ measure, lines: measureLines.length }).toEqual({
        measure,
        lines: Object.keys(budgets.journeys).length,
      });
    }
  });

  test("says where to read about it", () => {
    expect(budgets.about.join(" ")).toContain(`${JOURNEYS_DIR}/README.md`);
  });
});

describe("what a run of a journey is held to", () => {
  test("a run that counts what its budget holds passes", () => {
    expect(compareWithBudget(fileWith(), "website-monitor", runWith())).toEqual(
      [],
    );
  });

  test("a dialog added to a job fails it, naming the journey, the measure, both numbers and the dialog", () => {
    const messages = compareWithBudget(
      fileWith(),
      "website-monitor",
      runWith({ dialogs: 1 }, { dialogs: ["Confirm the monitor"] }),
    );

    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain(
      'Journey "Create a website monitor" (website-monitor)',
    );
    expect(messages[0]).toContain("dialogs went up from 0 to 1");
    expect(messages[0]).toContain('"Confirm the monitor"');
    expect(messages[0]).toContain("The job got longer");
    expect(messages[0]).toContain(
      `raise budget.dialogs to 1 in ${BUDGET_FILE}`,
    );
    expect(messages[0]).toContain("say in the pull request why");
  });

  test("a required field added to a job fails it, naming the field", () => {
    const messages = compareWithBudget(
      fileWith(),
      "website-monitor",
      runWith(
        { fieldsTyped: 3 },
        { fieldsTyped: ["Name", "Website URL", "Team"] },
      ),
    );

    expect(messages).toEqual([
      expect.stringContaining("fields typed went up from 2 to 3"),
    ]);
    expect(messages[0]).toContain('"Team"');
  });

  test("a job that got shorter fails too, asking for the budget to be lowered to the new number", () => {
    const messages = compareWithBudget(
      fileWith(),
      "website-monitor",
      runWith({ screens: 1 }, { screens: ["/dashboard/:id/monitors/create"] }),
    );

    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain("screens went down from 2 to 1");
    expect(messages[0]).toContain("The job got shorter");
    expect(messages[0]).toContain(
      `lower budget.screens to 1 in ${BUDGET_FILE}, so the gain is kept`,
    );
  });

  test("each structural measure that moved has a message of its own, in the order the file lists them", () => {
    const messages = compareWithBudget(
      fileWith(),
      "website-monitor",
      runWith({ clicks: 12, products: 2, screens: 3 }),
    );

    expect(
      messages.map((message) => {
        return message.split(": ")[1].split(" went")[0];
      }),
    ).toEqual(["screens", "clicks", "products crossed"]);
  });

  test.each(REPORTED)(
    "%s moving either way never fails a run",
    (measure) => {
      expect(
        compareWithBudget(
          fileWith(),
          "website-monitor",
          runWith({ [measure]: counts()[measure] + 50 }),
        ),
      ).toEqual([]);
      expect(
        compareWithBudget(
          fileWith(),
          "website-monitor",
          runWith({ [measure]: 0 }),
        ),
      ).toEqual([]);
    },
  );

  test.each(FAIL_ON)("%s moving by one fails a run", (measure) => {
    expect(
      compareWithBudget(
        fileWith(),
        "website-monitor",
        runWith({ [measure]: counts()[measure] + 1 }),
      ),
    ).toEqual([expect.stringContaining(`${MEASURE_NAMES[measure]} went up`)]);
  });

  test("a journey with no budget fails, with today's numbers to paste in", () => {
    const messages = compareWithBudget(
      fileWith(),
      "status-page",
      runWith({ screens: 3, dialogs: 2 }),
    );

    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain(
      `Journey "status-page" (status-page) has no budget in ${BUDGET_FILE}`,
    );
    const pasted = JSON.parse(messages[0].match(/\{.*\}/)[0]);
    expect(pasted).toEqual(runWith({ screens: 3, dialogs: 2 }).measures);
  });

  test("a run that did not count a measure fails, saying which", () => {
    const run = runWith();
    delete run.measures.words;

    expect(compareWithBudget(fileWith(), "website-monitor", run)).toEqual([
      expect.stringContaining("the run did not count words on screen"),
    ]);
  });
});

describe("a budget file with something wrong", () => {
  test.each([
    [
      "a measure left out",
      (file) => {
        delete file.journeys["website-monitor"].budget.clicks;
      },
      "website-monitor: budget.clicks must be a whole number of zero or more",
    ],
    [
      "a number that is not whole",
      (file) => {
        file.journeys["website-monitor"].budget.words = 1.5;
      },
      "website-monitor: budget.words must be a whole number of zero or more",
    ],
    [
      "a number below zero",
      (file) => {
        file.journeys["website-monitor"].budget.dialogs = -1;
      },
      "website-monitor: budget.dialogs must be a whole number of zero or more",
    ],
    [
      "a measure nothing counts",
      (file) => {
        file.journeys["website-monitor"].budget.concepts = 3;
      },
      "website-monitor: budget.concepts is not a measure",
    ],
    [
      "a path that is neither manual nor guided",
      (file) => {
        file.journeys["website-monitor"].path = "wizard";
      },
      'website-monitor: path must be "manual" or "guided"',
    ],
    [
      "no title",
      (file) => {
        file.journeys["website-monitor"].title = "";
      },
      "website-monitor: has no title",
    ],
    [
      "no start",
      (file) => {
        delete file.journeys["website-monitor"].startsAt;
      },
      "website-monitor: has no startsAt (where the journey begins)",
    ],
    [
      "no end",
      (file) => {
        delete file.journeys["website-monitor"].endsWhen;
      },
      "website-monitor: has no endsWhen (what is true when it is done)",
    ],
    [
      "an id that is not lower-case words joined by hyphens",
      (file) => {
        file.journeys["Website Monitor"] = file.journeys["website-monitor"];
      },
      "Website Monitor: an id is lower-case words joined by hyphens",
    ],
    [
      "a structural measure taken off failOn",
      (file) => {
        file.failOn = ["screens", "dialogs", "fieldsTyped"];
      },
      'failOn must be ["screens","dialogs","clicks","fieldsTyped","products"], the structural measures, in that order',
    ],
    [
      "a measure moved to reported",
      (file) => {
        file.reported = ["keystrokes", "choices", "words"];
      },
      'reported must be ["keystrokes","defaultsKept","choices","words"], every other measure, in that order',
    ],
  ])("%s is named", (_name, breakIt, problem) => {
    const file = fileWith();
    breakIt(file);

    expect(problemsWithBudgetFile(file)).toContain(problem);
  });

  test("a file with no journeys is named", () => {
    expect(
      problemsWithBudgetFile({ failOn: FAIL_ON, reported: REPORTED }),
    ).toEqual(["journeys must be an object of journeys by id"]);
    expect(problemsWithBudgetFile(null)).toEqual([
      `${BUDGET_FILE} is not a JSON object`,
    ]);
  });
});

describe("the table a run writes", () => {
  const file = fileWith(
    {},
    {
      "status-page": {
        title: "Publish a status page that shows the monitor",
        path: "manual",
        startsAt: "Home",
        endsWhen: "the status page shows the monitor",
        budget: counts({ screens: 3, dialogs: 2 }),
      },
    },
  );

  test("has a column for every measure, the reported ones marked", () => {
    const [header] = reportTable(file, {}).split("\n");

    expect(header).toBe(
      "| Journey | Path | Screens | Dialogs | Clicks | Fields typed | Products | Keystrokes* | Defaults kept* | Choices* | Words* |",
    );
  });

  test("shows each count, and its difference from the budget where it moved", () => {
    const table = reportTable(file, {
      "website-monitor": runWith({ dialogs: 1, words: 300 }),
      "status-page": runWith({ screens: 3, dialogs: 2 }),
    });

    expect(table.split("\n")[2]).toBe(
      "| Create a website monitor | manual | 2 | 1 (+1) | 9 | 2 | 1 | 41 | 2 | 13 | 300 (-15) |",
    );
    expect(table.split("\n")[3]).toBe(
      "| Publish a status page that shows the monitor | manual | 3 | 2 | 9 | 2 | 1 | 41 | 2 | 13 | 315 |",
    );
  });

  test("says which journeys did not finish, and which ran with no budget", () => {
    const table = reportTable(file, {
      "status-page": runWith({ screens: 3, dialogs: 2 }),
      "brand-new-job": runWith(),
    });

    expect(table).toContain(
      "| Create a website monitor (did not finish) | manual | - | - | - | - | - | - | - | - | - |",
    );
    expect(table).toContain(
      "| brand-new-job (no budget) | - | 2 | 0 | 9 | 2 | 1 | 41 | 2 | 13 | 315 |",
    );
  });

  test("says what the brackets and the stars mean", () => {
    expect(reportTable(file, {})).toContain(
      `A number in brackets is the difference from the budget in ${BUDGET_FILE}. * Reported, never failing`,
    );
  });
});

describe("packages/E2E/Journeys/README.md", () => {
  const readme = read(`${JOURNEYS_DIR}/README.md`);

  test("says how to read a failure and how to lower a budget", () => {
    expect(readme).toContain("## How to read a failure");
    expect(readme).toContain("## When a job gets shorter: lower its budget");
    expect(readme).toContain("## When a job gets longer");
    expect(readme).toContain(BUDGET_FILE);
  });

  test("says how each measure is counted", () => {
    for (const measure of MEASURES) {
      expect({ measure, documented: readme.includes(`\`${measure}\``) }).toEqual(
        { measure, documented: true },
      );
    }
  });

  test("names every journey", () => {
    for (const journey of Object.values(budgets.journeys)) {
      expect({ journey: journey.title, named: readme.includes(journey.title) })
        .toEqual({ journey: journey.title, named: true });
    }
  });
});

describe("the suite", () => {
  test("is a script of packages/E2E, run with its own config over Journeys.spec.ts", () => {
    const scripts = JSON.parse(read("packages/E2E/package.json")).scripts;
    const config = read("packages/E2E/playwright.journeys-ui.config.ts");

    expect(scripts["test-journeys-ui"]).toBe(
      "playwright test --config playwright.journeys-ui.config.ts",
    );
    expect(config).toContain('testDir: "./Journeys"');
    expect(config).toContain('"Journeys.spec.ts"');
    expect(config).toContain('"./Journeys/JourneyReport.ts"');
  });
});

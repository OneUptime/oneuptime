"use strict";

/*
 * The journey budgets: what each core job costs a newcomer, kept in
 * Tests/Ops/JourneyBudgets.json, and what a run of the journeys is held to.
 *
 * The structural measures (FAIL_ON) fail a run whichever way they move:
 *   - up: the job got longer. Make it short again, or raise the budget and
 *     say why in the pull request.
 *   - down: the job got shorter. Lower the budget to the new number, so
 *     the gain is kept and the file keeps holding today's numbers.
 * The other measures (REPORTED) move with every copy edit: they are in the
 * report, beside their budget, and never fail a run.
 *
 * Plain CommonJS with no dependencies: the journeys' spec reads it
 * (packages/E2E/Journeys/Journeys.spec.ts), and so does the guard over the
 * budget file (Tests/Ops/JourneyBudgets.test.js), which runs where no
 * package is installed.
 */

const BUDGET_FILE = "Tests/Ops/JourneyBudgets.json";

// Measured by Journeys/Counter/InPageCounter.js; the README says how to read each.
const MEASURES = [
  "screens",
  "dialogs",
  "clicks",
  "fieldsTyped",
  "products",
  "keystrokes",
  "defaultsKept",
  "choices",
  "words",
];

const FAIL_ON = ["screens", "dialogs", "clicks", "fieldsTyped", "products"];

const REPORTED = MEASURES.filter((measure) => {
  return !FAIL_ON.includes(measure);
});

// What each measure is called in a message and in the report's header.
const MEASURE_NAMES = {
  screens: "screens",
  dialogs: "dialogs",
  clicks: "clicks",
  fieldsTyped: "fields typed",
  products: "products crossed",
  keystrokes: "keystrokes",
  defaultsKept: "fields left at their default",
  choices: "choices offered",
  words: "words on screen",
};

const REPORT_HEADERS = {
  screens: "Screens",
  dialogs: "Dialogs",
  clicks: "Clicks",
  fieldsTyped: "Fields typed",
  products: "Products",
  keystrokes: "Keystrokes",
  defaultsKept: "Defaults kept",
  choices: "Choices",
  words: "Words",
};

// Which of a run's details explain a measure in a message.
const DETAIL_OF = {
  screens: "screens",
  dialogs: "dialogs",
  fieldsTyped: "fieldsTyped",
  products: "products",
  defaultsKept: "defaultsKept",
};

function isCount(value) {
  return Number.isInteger(value) && value >= 0;
}

function quoteList(values) {
  return (values || [])
    .map((value) => {
      return `"${value}"`;
    })
    .join(", ");
}

/*
 * What is wrong with a budget file's shape, one line each: an empty list
 * means every journey has a title, a path and a count for every measure,
 * and nothing else.
 */
function problemsWithBudgetFile(file) {
  const problems = [];

  if (!file || typeof file !== "object") {
    return [`${BUDGET_FILE} is not a JSON object`];
  }
  if (JSON.stringify(file.failOn) !== JSON.stringify(FAIL_ON)) {
    problems.push(
      `failOn must be ${JSON.stringify(FAIL_ON)}, the structural measures, in that order`,
    );
  }
  if (JSON.stringify(file.reported) !== JSON.stringify(REPORTED)) {
    problems.push(
      `reported must be ${JSON.stringify(REPORTED)}, every other measure, in that order`,
    );
  }
  if (!file.journeys || typeof file.journeys !== "object") {
    problems.push("journeys must be an object of journeys by id");
    return problems;
  }

  for (const [id, journey] of Object.entries(file.journeys)) {
    if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(id)) {
      problems.push(`${id}: an id is lower-case words joined by hyphens`);
    }
    if (!journey || typeof journey !== "object") {
      problems.push(`${id}: must be an object`);
      continue;
    }
    if (typeof journey.title !== "string" || !journey.title.trim()) {
      problems.push(`${id}: has no title`);
    }
    if (!["manual", "guided"].includes(journey.path)) {
      problems.push(`${id}: path must be "manual" or "guided"`);
    }
    if (typeof journey.startsAt !== "string" || !journey.startsAt.trim()) {
      problems.push(`${id}: has no startsAt (where the journey begins)`);
    }
    if (typeof journey.endsWhen !== "string" || !journey.endsWhen.trim()) {
      problems.push(`${id}: has no endsWhen (what is true when it is done)`);
    }
    const budget = journey.budget || {};
    for (const measure of MEASURES) {
      if (!isCount(budget[measure])) {
        problems.push(
          `${id}: budget.${measure} must be a whole number of zero or more`,
        );
      }
    }
    for (const key of Object.keys(budget)) {
      if (!MEASURES.includes(key)) {
        problems.push(`${id}: budget.${key} is not a measure`);
      }
    }
  }

  return problems;
}

/*
 * How a run of one journey compares with its budget, one message for each
 * structural measure that moved. Each message names the journey, the
 * measure, both numbers and what to do. An empty list means the run is
 * within its budget.
 */
function compareWithBudget(file, id, run) {
  const journey = file.journeys ? file.journeys[id] : undefined;
  const title = journey ? journey.title : id;
  const lead = `Journey "${title}" (${id})`;

  if (!journey) {
    const counts = MEASURES.map((measure) => {
      return `"${measure}": ${run.measures[measure]}`;
    }).join(", ");
    return [
      `${lead} has no budget in ${BUDGET_FILE}. Add one with today's numbers: { ${counts} }.`,
    ];
  }

  const messages = [];

  for (const measure of MEASURES) {
    if (!isCount(run.measures[measure])) {
      messages.push(
        `${lead}: the run did not count ${MEASURE_NAMES[measure]} (got ${JSON.stringify(run.measures[measure])}).`,
      );
    }
  }
  if (messages.length) {
    return messages;
  }

  for (const measure of FAIL_ON) {
    const budget = journey.budget[measure];
    const measured = run.measures[measure];
    const name = MEASURE_NAMES[measure];
    const detailKey = DETAIL_OF[measure];
    const detail =
      detailKey && run.details && run.details[detailKey]
        ? ` (${name}: ${quoteList(run.details[detailKey])})`
        : "";

    if (measured > budget) {
      messages.push(
        `${lead}: ${name} went up from ${budget} to ${measured}${detail}. The job got longer for a newcomer. Make it short again, or raise budget.${measure} to ${measured} in ${BUDGET_FILE} and say in the pull request why the job needs it.`,
      );
    } else if (measured < budget) {
      messages.push(
        `${lead}: ${name} went down from ${budget} to ${measured}${detail}. The job got shorter: lower budget.${measure} to ${measured} in ${BUDGET_FILE}, so the gain is kept.`,
      );
    }
  }

  return messages;
}

function cell(measured, budget) {
  if (!isCount(measured)) {
    return "-";
  }
  if (!isCount(budget) || measured === budget) {
    return String(measured);
  }
  const difference = measured - budget;
  return `${measured} (${difference > 0 ? "+" : ""}${difference})`;
}

/*
 * The table a pull request can paste: every journey of the file, in its
 * order, with each measure and its difference from the budget. A journey
 * the run did not finish says so.
 */
function reportTable(file, runs) {
  const header = [
    "Journey",
    "Path",
    ...MEASURES.map((measure) => {
      return FAIL_ON.includes(measure)
        ? `${REPORT_HEADERS[measure]}`
        : `${REPORT_HEADERS[measure]}*`;
    }),
  ];
  const lines = [
    `| ${header.join(" | ")} |`,
    `| ${header
      .map(() => {
        return "---";
      })
      .join(" | ")} |`,
  ];

  for (const [id, journey] of Object.entries(file.journeys || {})) {
    const run = runs[id];
    const cells = MEASURES.map((measure) => {
      return run ? cell(run.measures[measure], journey.budget[measure]) : "-";
    });
    lines.push(
      `| ${journey.title}${run ? "" : " (did not finish)"} | ${journey.path} | ${cells.join(" | ")} |`,
    );
  }

  for (const [id, run] of Object.entries(runs)) {
    if (!file.journeys || !file.journeys[id]) {
      lines.push(
        `| ${id} (no budget) | - | ${MEASURES.map((measure) => {
          return cell(run.measures[measure]);
        }).join(" | ")} |`,
      );
    }
  }

  lines.push("");
  lines.push(
    `A number in brackets is the difference from the budget in ${BUDGET_FILE}. * Reported, never failing: these move with copy edits.`,
  );

  return lines.join("\n");
}

module.exports = {
  BUDGET_FILE,
  MEASURES,
  FAIL_ON,
  REPORTED,
  MEASURE_NAMES,
  problemsWithBudgetFile,
  compareWithBudget,
  reportTable,
};

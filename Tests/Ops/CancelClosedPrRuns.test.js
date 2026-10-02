"use strict";

/**
 * cancel-closed-pr-runs.yml stops a pull request's CI when the pull request is
 * closed or merged.
 *
 * It does that without calling the API. Every workflow that runs on
 * pull_request has a workflow-level concurrency group, "<workflow name>-<PR
 * number>", and the canceller has one job per workflow that joins the same
 * group with cancel-in-progress. Concurrency groups are shared by every job and
 * workflow in the repository, so GitHub cancels the pull request's run as soon
 * as the job is queued, before the job has a runner.
 *
 * Nothing checks that at runtime: a group that stops matching just means the
 * job joins a group nobody else is in, succeeds, and cancels nothing. So this
 * suite pins both sides:
 *
 *   - the canceller: it runs on pull_request_target `closed` only, with no
 *     permissions, checks out and runs nothing from the pull request, and
 *     interpolates nothing into a script; its job is queued the moment the run
 *     starts (no `needs`, no `if`); it joins "<matrix.workflow>-<PR number>"
 *     with cancel-in-progress; and its matrix is exactly the names of the
 *     workflows that run on pull_request.
 *   - each of those workflows: for a pull_request event its group evaluates to
 *     the string the canceller's group evaluates to for it, and a push to
 *     master lands in a different group (so a merge's own push runs are never
 *     cancelled); it does not itself run on `closed`; and its name is unique.
 *
 * Groups are evaluated with a small reader of GitHub's expressions that
 * understands context paths and `||`, the only things the groups use. Anything
 * else throws instead of being misread.
 */

const fs = require("fs");
const path = require("path");
const yaml = require("js-yaml");

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const WORKFLOWS_DIR = ".github/workflows";
const CANCELLER = `${WORKFLOWS_DIR}/cancel-closed-pr-runs.yml`;

const PR_NUMBER = 4222;

function read(relativePath) {
  return fs.readFileSync(path.join(REPO_ROOT, relativePath), "utf8");
}

function readYaml(relativePath) {
  return yaml.load(read(relativePath));
}

/**
 * A workflow's triggers as a map. `on:` can be an event name, a list of them,
 * or a map of event to its filters.
 * @param {object} workflow - The parsed workflow
 * @returns {object} event name -> filters (null when it has none)
 */
function triggers(workflow) {
  // js-yaml reads `on` as a string; a YAML 1.1 reader would make it `true`.
  const on = workflow.on === undefined ? workflow[true] : workflow.on;
  if (typeof on === "string") {
    return { [on]: null };
  }
  if (Array.isArray(on)) {
    return Object.fromEntries(
      on.map((event) => {
        return [event, null];
      }),
    );
  }
  return on || {};
}

function runsOn(workflow, event) {
  return Object.prototype.hasOwnProperty.call(triggers(workflow), event);
}

/**
 * The workflow-level concurrency group. `concurrency:` is either the group
 * itself or a map with `group` and `cancel-in-progress`.
 * @param {object} workflow - The parsed workflow
 * @returns {string|undefined} The group expression, as written
 */
function concurrencyGroup(workflow) {
  const concurrency = workflow.concurrency;
  if (typeof concurrency === "string") {
    return concurrency;
  }
  return concurrency ? concurrency.group : undefined;
}

/**
 * A string with `${{ }}` expressions, evaluated the way GitHub evaluates
 * them, for the two forms concurrency groups here use: a context path
 * (`github.workflow`), and `||` between them, which yields the first truthy
 * operand, else the last one. Anything else throws.
 * @param {string} template - The string as written in the workflow
 * @param {object} context - The contexts, e.g. { github: {...}, matrix: {...} }
 * @returns {string} The evaluated string
 */
function evaluate(template, context) {
  return template.replace(/\$\{\{(.*?)\}\}/g, (whole, expression) => {
    let value;
    for (const operand of expression.split("||")) {
      const contextPath = operand.trim();
      if (!/^[A-Za-z_][\w-]*(\.[A-Za-z_][\w-]*)+$/.test(contextPath)) {
        throw new Error(
          `This suite cannot evaluate "${contextPath}" in "${template}": it reads context paths and "||" only`,
        );
      }
      value = contextPath.split(".").reduce((object, key) => {
        return object === undefined || object === null
          ? undefined
          : object[key];
      }, context);
      if (value) {
        break;
      }
    }
    return value === undefined || value === null ? "" : String(value);
  });
}

// The contexts GitHub gives a workflow run, for the events that matter here.
function pullRequestContext(workflowName) {
  return {
    github: {
      workflow: workflowName,
      event_name: "pull_request",
      event: {
        action: "synchronize",
        number: PR_NUMBER,
        pull_request: { number: PR_NUMBER },
      },
      ref: `refs/pull/${PR_NUMBER}/merge`,
      head_ref: "feature",
      base_ref: "master",
      sha: "1".repeat(40),
      run_id: "101",
    },
  };
}

function pushToMasterContext(workflowName) {
  return {
    github: {
      workflow: workflowName,
      event_name: "push",
      event: {},
      ref: "refs/heads/master",
      head_ref: "",
      base_ref: "",
      sha: "2".repeat(40),
      run_id: "102",
    },
  };
}

// The canceller's context: pull_request_target runs on the base branch's ref.
function closedContext(cancellerName, matrixWorkflow) {
  return {
    github: {
      workflow: cancellerName,
      event_name: "pull_request_target",
      event: {
        action: "closed",
        number: PR_NUMBER,
        pull_request: { number: PR_NUMBER, merged: true },
      },
      ref: "refs/heads/master",
      head_ref: "feature",
      base_ref: "master",
      sha: "3".repeat(40),
      run_id: "103",
    },
    matrix: { workflow: matrixWorkflow },
  };
}

const workflowFiles = fs
  .readdirSync(path.join(REPO_ROOT, WORKFLOWS_DIR))
  .filter((file) => {
    return /\.ya?ml$/.test(file);
  })
  .sort()
  .map((file) => {
    return `${WORKFLOWS_DIR}/${file}`;
  });

// Every workflow that runs on pull_request, with the name it runs under:
// github.workflow is the workflow's `name`, or its file's path without one.
const pullRequestWorkflows = workflowFiles
  .map((file) => {
    return { file, workflow: readYaml(file) };
  })
  .filter(({ workflow }) => {
    return runsOn(workflow, "pull_request");
  })
  .map(({ file, workflow }) => {
    return { file, workflow, name: workflow.name || file };
  });

const canceller = readYaml(CANCELLER);
const cancelJob = canceller.jobs.cancel;

function cancellerGroupFor(workflowName) {
  return evaluate(
    cancelJob.concurrency.group,
    closedContext(canceller.name, workflowName),
  );
}

describe("the expression reader this suite uses", () => {
  const group =
    "${{ github.workflow }}-${{ github.event.pull_request.number || github.ref }}";

  test("takes the first truthy operand of ||, else the last", () => {
    expect(evaluate(group, pullRequestContext("Compile"))).toBe(
      `Compile-${PR_NUMBER}`,
    );
    expect(evaluate(group, pushToMasterContext("Compile"))).toBe(
      "Compile-refs/heads/master",
    );
    expect(
      evaluate("${{ github.head_ref || github.base_ref }}", {
        github: { head_ref: "", base_ref: "" },
      }),
    ).toBe("");
  });

  test("refuses what it does not understand", () => {
    expect(() => {
      return evaluate("${{ format('{0}', github.ref) }}", {});
    }).toThrow(/cannot evaluate/);
    expect(() => {
      return evaluate("${{ github.event_name == 'push' }}", {});
    }).toThrow(/cannot evaluate/);
  });
});

describe(CANCELLER, () => {
  test("runs on pull_request_target when a pull request closes, and on nothing else", () => {
    expect(triggers(canceller)).toEqual({
      pull_request_target: { types: ["closed"] },
    });
  });

  test("has a token with no permissions, and no job asks for any", () => {
    expect(canceller.permissions).toEqual({});
    for (const job of Object.values(canceller.jobs)) {
      expect(job.permissions).toBeUndefined();
    }
  });

  /*
   * pull_request_target runs with the base repository's context even for a
   * pull request from a fork. That is safe while the workflow checks out and
   * runs nothing from the pull request and nothing from the event (a branch
   * name, a title) is pasted into a script. Every step is a plain `run`, and
   * values reach it through `env`.
   */
  test("checks out nothing, uses no action, and interpolates nothing into a script", () => {
    for (const job of Object.values(canceller.jobs)) {
      for (const step of job.steps) {
        expect(step.uses).toBeUndefined();
        expect(typeof step.run).toBe("string");
        expect(step.run).not.toContain("${{");
      }
    }
  });

  /*
   * The cancel happens when the job is queued. A job with `needs` is not
   * queued until the job it needs has had a runner and finished, which is the
   * wait this design exists to avoid, and a job skipped by `if` joins no group
   * at all.
   */
  test("queues its job the moment the run starts", () => {
    expect(cancelJob.needs).toBeUndefined();
    expect(cancelJob.if).toBeUndefined();
  });

  test("joins each workflow's group with cancel-in-progress", () => {
    expect(cancelJob.concurrency["cancel-in-progress"]).toBe(true);
    expect(cancellerGroupFor("Compile")).toBe(`Compile-${PR_NUMBER}`);
  });

  /*
   * A reopened pull request's new run takes its group back and cancels that
   * group's job here; with fail-fast that would cancel the other jobs too.
   */
  test("does not let one cancelled job cancel the others", () => {
    expect(cancelJob.strategy["fail-fast"]).toBe(false);
  });

  test("has one job for every workflow that runs on pull_request, and no other", () => {
    const matrix = cancelJob.strategy.matrix;
    // No include/exclude: the list below is the whole matrix.
    expect(Object.keys(matrix)).toEqual(["workflow"]);
    expect(new Set(matrix.workflow).size).toBe(matrix.workflow.length);
    expect([...matrix.workflow].sort()).toEqual(
      pullRequestWorkflows
        .map(({ name }) => {
          return name;
        })
        .sort(),
    );
  });

  test("is not itself one of the workflows it cancels", () => {
    expect(runsOn(canceller, "pull_request")).toBe(false);
    expect(cancelJob.strategy.matrix.workflow).not.toContain(canceller.name);
  });
});

describe("the workflows that run on pull_request", () => {
  test("there are some", () => {
    expect(pullRequestWorkflows.length).toBeGreaterThan(0);
  });

  /*
   * Two workflows with one name would share a concurrency group, cancel each
   * other's runs, and get only one job in the canceller.
   */
  test("have unique names", () => {
    const names = pullRequestWorkflows.map(({ name }) => {
      return name;
    });
    expect(new Set(names).size).toBe(names.length);
  });
});

describe.each(pullRequestWorkflows)("$file", ({ workflow, name }) => {
  test("has the group the canceller joins for it: <name>-<PR number>", () => {
    const group = concurrencyGroup(workflow);
    expect(typeof group).toBe("string");
    expect(evaluate(group, pullRequestContext(name))).toBe(
      cancellerGroupFor(name),
    );
  });

  // The merge commit's own push runs, which must not be cancelled.
  test("puts a push to master in a different group", () => {
    const group = concurrencyGroup(workflow);
    expect(evaluate(group, pushToMasterContext(name))).not.toBe(
      cancellerGroupFor(name),
    );
  });

  /*
   * A run that started on `closed` would join its group at the moment the
   * canceller's job does, and one of the two would cancel the other. Work
   * that has to run when a pull request closes belongs in a workflow with a
   * group of its own, outside the canceller's matrix.
   */
  test("does not run when a pull request closes", () => {
    const filters = triggers(workflow).pull_request;
    const types = (filters && filters.types) || [];
    expect(types).not.toContain("closed");
  });
});

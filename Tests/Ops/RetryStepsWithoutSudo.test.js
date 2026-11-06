"use strict";

/**
 * No nick-fields/retry step runs its command through sudo.
 *
 * nick-fields/retry stops an attempt that reaches its timeout_minutes by
 * killing the command's processes, as the runner's user. A process sudo
 * started is root's, so that kill fails - and the action does not try again:
 * it dies on "Error: kill EPERM" and fails the step. That is how the Build
 * workflow's Home image job failed in release 14.0.103's gate (run
 * 41681440927, 2026-11-03) once its blog clone stalled: its three attempts
 * were one. The "Preinstall" steps failed the same way on a hung
 * `sudo apt-get update` (Scripts/Install/configure.sh now skips it when
 * nothing is missing).
 *
 * The runner's own user is in the docker group, so a `docker build` needs no
 * sudo.
 */

const fs = require("fs");
const path = require("path");
const yaml = require("js-yaml");

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const WORKFLOWS = path.join(REPO_ROOT, ".github", "workflows");

// Every nick-fields/retry step in the workflows, with where it is.
function retrySteps() {
  const steps = [];
  const files = fs
    .readdirSync(WORKFLOWS)
    .filter((file) => {
      return /\.ya?ml$/.test(file);
    })
    .sort();
  for (const file of files) {
    const workflow = yaml.load(
      fs.readFileSync(path.join(WORKFLOWS, file), "utf8"),
    );
    for (const [job, definition] of Object.entries(
      (workflow && workflow.jobs) || {},
    )) {
      for (const step of (definition && definition.steps) || []) {
        if (
          typeof step.uses === "string" &&
          step.uses.startsWith("nick-fields/retry@")
        ) {
          steps.push({
            file,
            job,
            name: step.name || "(unnamed)",
            with: step.with || {},
          });
        }
      }
    }
  }
  return steps;
}

// The shell a retry step runs, without its comment lines.
function commandOf(step) {
  return String(step.with.command || "")
    .split("\n")
    .filter((line) => {
      return !line.trim().startsWith("#");
    })
    .join("\n");
}

// Whether a shell command runs anything through sudo: sudo as a word of its
// own, not part of another (pseudo, sudoers).
function runsSudo(command) {
  return /(^|[^\w./-])sudo(?=\s|$)/m.test(command);
}

describe("nick-fields/retry steps", () => {
  const steps = retrySteps();

  test("are found, the Build workflow's docker builds among them (the checks below are not vacuous)", () => {
    const builds = steps.filter((step) => {
      return (
        step.file === "build.yml" && /\bdocker build\b/.test(commandOf(step))
      );
    });

    // An image added to or removed from the Build workflow changes this list.
    expect(
      builds.map((step) => {
        return step.job;
      }),
    ).toEqual([
      "docker-build-home",
      "docker-build-app",
      "docker-build-app",
      "docker-build-e2e",
      "docker-build-probe",
      "docker-build-runner",
      "docker-build-kubernetes-ai-agent",
      "docker-build-resource-ai-agent",
      "docker-build-kubernetes-cost-agent",
      "docker-build-kubernetes-log-tailer",
      "docker-build-test-server",
    ]);
  });

  test("never run their command through sudo, so a timed-out attempt can be stopped and tried again", () => {
    const offenders = steps
      .filter((step) => {
        return runsSudo(commandOf(step));
      })
      .map((step) => {
        return `${step.file} ${step.job} / ${step.name}: ${commandOf(step).trim()}`;
      });

    expect(offenders).toEqual([]);
  });

  test("the Build workflow's docker builds run docker as the runner, each with a timeout to stop it at", () => {
    for (const step of steps.filter((candidate) => {
      return (
        candidate.file === "build.yml" &&
        /\bdocker build\b/.test(commandOf(candidate))
      );
    })) {
      expect({
        job: step.job,
        command: commandOf(step).trim().split(/\s+/)[0],
        timeout: typeof step.with.timeout_minutes,
      }).toEqual({ job: step.job, command: "docker", timeout: "number" });
    }
  });

  test("the check sees sudo however a command spells it (negative control)", () => {
    for (const command of [
      "sudo docker build --no-cache -f ./packages/Home/Dockerfile .",
      "cd packages/Home && sudo docker build .",
      "set -e\nsudo apt-get update",
      "echo x | sudo tee /etc/thing",
      "(sudo make install)",
      "FOO=1 sudo -E bash ./x.sh",
      "sudo",
    ]) {
      expect({ command, sudo: runsSudo(command) }).toEqual({
        command,
        sudo: true,
      });
    }
    for (const command of [
      "docker build --no-cache -f ./packages/Home/Dockerfile .",
      "bash ./Scripts/pseudo-build.sh",
      "cat /etc/sudoers.d/runner",
      "./sudo-free.sh",
      "npm run prerun",
    ]) {
      expect({ command, sudo: runsSudo(command) }).toEqual({
        command,
        sudo: false,
      });
    }
    // A comment line is no command.
    expect(
      runsSudo(
        commandOf({
          with: { command: "# not sudo docker build any more\ndocker build ." },
        }),
      ),
    ).toBe(false);
  });
});

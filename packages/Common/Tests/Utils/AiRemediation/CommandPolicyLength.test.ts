import RunnerJobService from "../../../Server/Services/RunnerJobService";
import { MAX_COMMAND_LENGTH_CHARS } from "../../../Types/AutoRemediation/AiRemediationCommandPolicyVerdict";
import BadDataException from "../../../Types/Exception/BadDataException";
import ObjectID from "../../../Types/ObjectID";
import RunbookStepType from "../../../Types/Runbook/RunbookStepType";
import CommandPolicy, {
  CommandPolicyResult,
} from "../../../Utils/AiRemediation/CommandPolicy";
import { describe, expect, test } from "@jest/globals";
import { FastestRun, fastestRun } from "../../Helpers/FastestRun";

/*
 * ---------------------------------------------------------------------------
 * THE DENY LIST NEVER READS A COMMAND LONGER THAN A COMMAND MAY BE.
 *
 * A model proposes the commands the remediation deny list reads, and what
 * the model reads - logs, events, tool output - can steer what it proposes.
 * Some of the deny rules read on to the end of the command from more than
 * one place, so their time grows faster than the command's length: tens of
 * milliseconds at the longest a command may be (MAX_COMMAND_LENGTH_CHARS),
 * but minutes at a few hundred thousand characters. evaluateCommand always
 * refused a longer command before the rules read it; the deny check that a
 * model's tool call, a stored plan step, the server's enqueue and the
 * Runner call directly now refuses it too, in the same words wherever it is
 * asked.
 * ---------------------------------------------------------------------------
 */

const repeat: (unit: string, length: number) => string = (
  unit: string,
  length: number,
): string => {
  return unit.repeat(Math.ceil(length / unit.length)).slice(0, length);
};

// The shapes each slow rule reads longest on, at a given length.
const slowShapes: (length: number) => Array<[string, string]> = (
  length: number,
): Array<[string, string]> => {
  return [
    [
      "an rm option holding r, then a digit",
      "rm -v" + repeat("rm", length - 6) + "0",
    ],
    ["dd words", repeat("dd ", length)],
    ["curl words", repeat("curl ", length)],
    ["sh -c words", repeat("sh -c ", length)],
    [
      "chmod options, then -r",
      "chmod " +
        repeat("-chmod -d ", length / 2 - 6) +
        repeat(" -r ", length / 2),
    ],
    [
      "chown words, then -r",
      "w" +
        repeat("r/chown/o", length / 2 - 2) +
        "r " +
        repeat("/ -r\u0000", length / 2 - 2),
    ],
    ["iptables options", " " + repeat(" -iptables -e ", length - 12) + " ufw"],
    ["crontab options", "0" + repeat("n -crontab -n", length - 2) + "c"],
  ].map(([label, command]: Array<string>): [string, string] => {
    return [label!, command!.slice(0, length)];
  });
};

const LONG: number = 400000;
const LENGTH_REASON: string = `a command longer than ${MAX_COMMAND_LENGTH_CHARS} characters`;

describe("a command longer than a command may be is refused before it is read", () => {
  test.each(slowShapes(LONG))("%s", (_label: string, command: string) => {
    const timed: FastestRun<void> = fastestRun({
      run: (): void => {
        expect(CommandPolicy.getDenyReason(command)).toBe(LENGTH_REASON);
      },
      limitInMs: 2000,
    });
    expect(timed.inMs).toBeLessThan(2000);
  });

  test("one character over the limit is refused, the limit itself is read", () => {
    const atLimit: string = "echo " + repeat("a", MAX_COMMAND_LENGTH_CHARS - 5);

    expect(atLimit.length).toBe(MAX_COMMAND_LENGTH_CHARS);
    expect(CommandPolicy.getDenyReason(atLimit)).toBeNull();
    expect(CommandPolicy.getDenyReason(atLimit + "a")).toBe(LENGTH_REASON);
  });

  test("a denied command at the limit is denied for what it does", () => {
    const command: string =
      "rm -rf /" + repeat(" ", MAX_COMMAND_LENGTH_CHARS - 8);

    expect(command.length).toBe(MAX_COMMAND_LENGTH_CHARS);
    expect(CommandPolicy.getDenyReason(command)).toBe(
      "recursive or forced file deletion",
    );
  });

  test("a missing command still reads as no command at all", () => {
    expect(
      CommandPolicy.getDenyReason(undefined as unknown as string),
    ).toBeNull();
  });

  test("evaluateCommand still says the command is over the limit, in its own words", () => {
    const result: CommandPolicyResult = CommandPolicy.evaluateCommand({
      command: slowShapes(LONG)[4]![1],
      allowlistPatterns: ["*"],
    });

    expect(result.reason).toBe(
      `Command exceeds the ${MAX_COMMAND_LENGTH_CHARS}-character limit.`,
    );
  });

  test("the server's enqueue refuses an over-long AI command before anything is stored", async () => {
    const startedAt: number = Date.now();

    await expect(
      RunnerJobService.enqueueAiCommand({
        projectId: new ObjectID("22222222-2222-4222-8222-222222222222"),
        aiRunId: new ObjectID("88888888-8888-4888-8888-888888888888"),
        autoRemediationSuggestionId: new ObjectID(
          "77777777-7777-4777-8777-777777777777",
        ),
        stepId: "step-1",
        stepType: RunbookStepType.Bash,
        targetAgentId: new ObjectID("44444444-4444-4444-8444-444444444444"),
        command: slowShapes(LONG)[5]![1],
        timeoutInMs: 30000,
      }),
    ).rejects.toThrow(
      new BadDataException(
        `Denied by the remediation command policy: ${LENGTH_REASON}.`,
      ),
    );
    expect(Date.now() - startedAt).toBeLessThan(2000);
  });
});

describe("at the longest a command may be, every rule reads it quickly", () => {
  test.each(slowShapes(MAX_COMMAND_LENGTH_CHARS))(
    "%s",
    (_label: string, command: string) => {
      expect(command.length).toBeLessThanOrEqual(MAX_COMMAND_LENGTH_CHARS);

      const timed: FastestRun<void> = fastestRun({
        run: (): void => {
          CommandPolicy.getDenyReason(command);
        },
        limitInMs: 1000,
      });

      // Measured at about 25 ms; generous for a slow machine.
      expect(timed.inMs).toBeLessThan(1000);
    },
  );
});

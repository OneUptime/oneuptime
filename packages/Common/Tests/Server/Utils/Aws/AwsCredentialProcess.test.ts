import {
  AwsCommandLineSplit,
  CREDENTIAL_PROCESS_TIMEOUT_MS,
  MAX_CREDENTIAL_PROCESS_OUTPUT_BYTES,
  isFullProgramPath,
  splitCommandLine,
} from "../../../../Server/Utils/Aws/AwsCredentialProcess";
import { describe, expect, test } from "@jest/globals";

/*
 * A PROFILE'S credential_process LINE (#7381), as the words of one program
 * run with no shell: split as a shell splits words, and refused wherever a
 * shell would do more than split - a pipe, a redirect, a variable, a
 * command in backquotes, a glob, ~, a second command. The real runner, which
 * needs a real process, is driven in App's AwsCredentialProcessRunner.test.ts.
 */

const HELPER: string = "/usr/local/bin/aws_signing_helper";

const wordsOf: (line: string) => Array<string> = (
  line: string,
): Array<string> => {
  const split: AwsCommandLineSplit = splitCommandLine(line);

  if ("problem" in split) {
    throw new Error(`Refused: ${split.problem}`);
  }

  return split.words;
};

const problemOf: (line: string) => string = (line: string): string => {
  const split: AwsCommandLineSplit = splitCommandLine(line);

  if (!("problem" in split)) {
    throw new Error(`Split into ${JSON.stringify(split.words)}`);
  }

  return split.problem;
};

describe("splitting the line into words", () => {
  test("IAM Roles Anywhere's helper, as its guide writes it", () => {
    expect(
      wordsOf(
        `${HELPER} credential-process --certificate /etc/oneuptime/aws/cert.pem --private-key /etc/oneuptime/aws/key.pem --trust-anchor-arn arn:aws:rolesanywhere:us-east-1:111122223333:trust-anchor/0a1b --profile-arn arn:aws:rolesanywhere:us-east-1:111122223333:profile/2c3d --role-arn arn:aws:iam::111122223333:role/oneuptime`,
      ),
    ).toEqual([
      HELPER,
      "credential-process",
      "--certificate",
      "/etc/oneuptime/aws/cert.pem",
      "--private-key",
      "/etc/oneuptime/aws/key.pem",
      "--trust-anchor-arn",
      "arn:aws:rolesanywhere:us-east-1:111122223333:trust-anchor/0a1b",
      "--profile-arn",
      "arn:aws:rolesanywhere:us-east-1:111122223333:profile/2c3d",
      "--role-arn",
      "arn:aws:iam::111122223333:role/oneuptime",
    ]);
  });

  test("runs of spaces and tabs part words; quotes and backslashes join them", () => {
    expect(
      wordsOf(
        `  /opt/my tool\\ dir/run   'single quoted; | $HOME'\t"double \\"quoted\\" \\\\ ok" mixed'one'"two"three  `,
      ),
    ).toEqual([
      "/opt/my",
      "tool dir/run",
      "single quoted; | $HOME",
      'double "quoted" \\ ok',
      "mixedonetwothree",
    ]);
  });

  test("an empty quoted word is a word; a ~ inside a word is kept", () => {
    expect(wordsOf(`/bin/run '' "" a~b`)).toEqual(["/bin/run", "", "", "a~b"]);
  });

  test("inside double quotes, a backslash before anything else stays", () => {
    expect(wordsOf(`/bin/run "a\\nb\\c"`)).toEqual(["/bin/run", "a\\nb\\c"]);
  });
});

describe("what only a shell would read is refused", () => {
  test.each([
    [`${HELPER} credential-process | jq .`, "|"],
    [`${HELPER} credential-process > /tmp/out`, ">"],
    [`${HELPER} credential-process < /dev/null`, "<"],
    [`${HELPER} credential-process; rm -rf /`, ";"],
    [`${HELPER} credential-process && curl evil.test`, "&"],
    [`${HELPER} --certificate $HOME/cert.pem`, "$"],
    [`${HELPER} --certificate $(cat /path)`, "$"],
    ["/bin/run `whoami`", "`"],
    [`${HELPER} --certificate /certs/*.pem`, "*"],
    [`${HELPER} --certificate /certs/cert?.pem`, "?"],
    [`${HELPER} --certificate /certs/{a,b}.pem`, "{"],
    [`${HELPER} --certificate /certs/[ab].pem`, "["],
    [`(${HELPER})`, "("],
    [`${HELPER} --certificate ~/cert.pem`, "~"],
    [`${HELPER} "--certificate=$HOME/cert.pem"`, "$"],
    [`${HELPER} "\`whoami\`"`, "`"],
  ])("%s", (line: string, character: string) => {
    const problem: string = problemOf(line);

    expect(problem).toContain(`it holds ${character}`);
    expect(problem).toContain("no shell");
  });

  test.each([
    [`${HELPER} 'never closed`, "a ' in it is never closed"],
    [`${HELPER} "never closed`, 'a " in it is never closed'],
    [`${HELPER} trailing\\`, "it ends with a backslash"],
    [`${HELPER} a\u0000b`, "it holds a control character"],
    [`${HELPER} "a\u0007b"`, "it holds a control character"],
    ["", "it is empty"],
    ["   \t ", "it is empty"],
    ["'' /bin/run", "its first word, the program, is empty"],
  ])("%j: %s", (line: string, problem: string) => {
    expect(problemOf(line)).toBe(problem);
  });

  test("an argument never reaches the problem: it may be a secret", () => {
    const problem: string = problemOf(
      `${HELPER} --pin s3cr3t-pin-value | tee /tmp/x`,
    );

    expect(problem).not.toContain("s3cr3t-pin-value");
    expect(problem).not.toContain(HELPER);
  });
});

describe("the program, and how it is run", () => {
  test.each([
    [HELPER, true],
    ["/opt/oneuptime/bin/creds.sh", true],
    ["aws_signing_helper", false],
    ["./aws_signing_helper", false],
    ["bin/aws_signing_helper", false],
    ["", false],
  ])("%j is a full path: %s", (program: string, isFull: boolean) => {
    expect(isFullProgramPath(program)).toBe(isFull);
  });

  test("it has thirty seconds, and 64 KB to print in", () => {
    expect(CREDENTIAL_PROCESS_TIMEOUT_MS).toBe(30 * 1000);
    expect(MAX_CREDENTIAL_PROCESS_OUTPUT_BYTES).toBe(64 * 1024);
  });
});

/*
 * Index MUST be imported before the tool modules (see CodeWriteTools.test.ts):
 * the toolbox sits in an import cycle that production always enters here.
 */
import "../../../../Server/Utils/AI/Toolbox/Index";
import {
  CommitCodeToBranchTool,
  OpenCodePullRequestTool,
} from "../../../../Server/Utils/AI/Toolbox/CodeWriteTools";
import { ReadCodeFileTool } from "../../../../Server/Utils/AI/Toolbox/CodeTools";
import {
  CODE_UNSEEN_SUMMARIES,
  CodeChangeKind,
  CodeFileTextNow,
  describeLineRanges,
  fingerprintCodeFileVersion,
  readCodeFileTextsNow,
} from "../../../../Server/Utils/AI/Toolbox/CodeFilesSeen";
import ToolResultSerializer, {
  REDACTION_PLACEHOLDERS,
} from "../../../../Server/Utils/AI/Toolbox/Serializer";
import {
  ObservabilityTool,
  PreparedMutation,
  ToolContext,
  ToolExecutionResult,
} from "../../../../Server/Utils/AI/Toolbox/ToolTypes";
import {
  getActionArgumentParts,
  getToolActionLeavesOutLists,
  ActionArgumentPart,
} from "../../../../../App/FeatureSet/Dashboard/src/Components/AIChat/ToolActionWords";
import { AIChatToolActionStatus } from "../../../../Types/AI/AIChatTypes";
import {
  AIChatLineRange,
  getLatestAIChatRecordsSeen,
  listAIChatRecordsSeen,
} from "../../../../Types/AI/AIChatRecordSeen";
import {
  AI_ACTION_PLURAL_LINES,
  AIActionSentence,
  describeAIActionSentence,
  isKnownAIActionWords,
} from "../../../../Types/AI/AIActionWords";
import { CODE_CHANGE_PROPOSED_ON_KEY } from "../../../../Types/CodeRepository/CodeChangeProposedOnKey";
import {
  CodeChangeProposedOn,
  CodeFileUnseen,
  CodeFileUnseenFinding,
  readCodeChangeProposedOn,
} from "../../../../Types/CodeRepository/CodeFileSeen";
import { CodeFilePlaceholderWritten } from "../../../../Types/CodeRepository/CodeFileValuesHidden";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import { createTranslator, Translator } from "../../../../Types/Translator";
import {
  CONNECTED_PROJECT_ID,
  disconnectRepository,
} from "../CodeRepository/CodeHost/ConnectedRepository";
import {
  FakeGitRepository,
  blobOf,
  makeRepository,
  push,
  serveOnForgejo,
  serveOnGitHub,
  serveOnGitLab,
} from "./FakeGitRepository";
import { actionLineText, actionTitleText } from "../../../Helpers/AIActionText";
import { SeededRandom, seededRandom } from "../../../Helpers/SeededRandom";
import { afterEach, describe, expect, test } from "@jest/globals";

/*
 * ISSUE #6364, THROUGH THE REAL TOOLS.
 *
 * read_code_file shows what looks like a secret or personal data as a
 * placeholder - "10.0.0.12" reads "[redacted-ip]", "ops@acme.com" reads
 * "[redacted-email]" - and a commit writes the file whole, from what the
 * model was shown: a model that changes one line of config/servers.ts
 * writes "[redacted-ip]" where every address was. So:
 *
 *   - the model reads exactly the redaction it always read, and is told
 *     which lines had values hidden and that it cannot write them back;
 *   - a file whose new version holds a placeholder more often than the
 *     file on the branch does is named on the card before anyone approves;
 *     in Auto-run it is not made, and the model is told it cannot write
 *     those values back;
 *   - placeholder text the file holds itself, kept, says nothing; neither
 *     does a change that takes a hidden value out or puts another in;
 *   - only such a file's text is read; a pull request approved anyway
 *     tells its reviewer where the placeholders are.
 */

afterEach(() => {
  disconnectRepository();
});

const USER_ID: ObjectID = ObjectID.generate();

const GITHUB_CONTEXT: ToolContext = {
  projectId: ObjectID.generate(),
  props: { isRoot: true, userId: USER_ID },
};

const CONNECTED_CONTEXT: ToolContext = {
  projectId: CONNECTED_PROJECT_ID,
  props: { isRoot: true, userId: USER_ID },
};

const ENGLISH: Translator = createTranslator(undefined, "en");

const SERVERS: string = "config/servers.ts";

// The issue's file: two addresses and an email, and a line to change.
const SERVERS_ON_BRANCH: string = [
  'export const PRIMARY_HOST = "10.0.0.12";',
  'export const BACKUP_HOST = "10.0.0.13";',
  'export const ON_CALL = "ops@acme.com";',
  "export const RETRIES = 3;",
  "",
].join("\n");

// One conversation: what each result showed the model, kept as the chat runner keeps it.
class Conversation {
  public records: Array<unknown> = [];

  public constructor(public readonly context: ToolContext) {}

  public keep(result: ToolExecutionResult): void {
    this.records.push(...listAIChatRecordsSeen(result.recordSeen));
  }

  public seen(): ToolContext {
    return {
      ...this.context,
      recordsSeen: getLatestAIChatRecordsSeen(this.records),
    };
  }

  public async read(
    filePath: string,
    args?: JSONObject,
  ): Promise<ToolExecutionResult> {
    const result: ToolExecutionResult = await ReadCodeFileTool.execute(
      { filePath, ...(args || {}) },
      this.context,
    );

    this.keep(result);

    return result;
  }

  public async propose(
    tool: ObservabilityTool,
    args: JSONObject,
  ): Promise<PreparedMutation> {
    return await tool.prepareMutation!(
      JSON.parse(JSON.stringify(args)) as JSONObject,
      this.seen(),
    );
  }

  public async run(
    tool: ObservabilityTool,
    prepared: PreparedMutation,
  ): Promise<ToolExecutionResult> {
    const result: ToolExecutionResult = await tool.execute(
      JSON.parse(JSON.stringify(prepared.arguments)) as JSONObject,
      this.context,
    );

    this.keep(result);

    return result;
  }
}

const commit: (
  branchName: string,
  changes: Array<{ filePath: string; content: string }>,
) => JSONObject = (
  branchName: string,
  changes: Array<{ filePath: string; content: string }>,
): JSONObject => {
  return {
    branchName,
    commitMessage: "fix: retries",
    changes: changes as unknown as JSONObject[],
  } as unknown as JSONObject;
};

const pullRequest: (
  changes: Array<{ filePath: string; content: string }>,
) => JSONObject = (
  changes: Array<{ filePath: string; content: string }>,
): JSONObject => {
  return {
    title: "More retries",
    description: "Retry five times.",
    changes: changes as unknown as JSONObject[],
  } as unknown as JSONObject;
};

// The card a person reads: its title and its line, in English.
const cardOf: (
  tool: ObservabilityTool,
  prepared: PreparedMutation,
) => { title: string | undefined; line: string | undefined } = (
  tool: ObservabilityTool,
  prepared: PreparedMutation,
): { title: string | undefined; line: string | undefined } => {
  return {
    title: actionTitleText(
      prepared.title || tool.buildActionTitle!(prepared.arguments),
    ),
    line: actionLineText(prepared.description),
  };
};

// The card as the Dashboard draws it, arguments and all.
const drawnCard: (
  tool: ObservabilityTool,
  args: JSONObject,
  description?: Array<AIActionSentence> | undefined,
) => {
  title: string;
  line: string | undefined;
  arguments: Array<ActionArgumentPart>;
} = (
  tool: ObservabilityTool,
  args: JSONObject,
  description?: Array<AIActionSentence> | undefined,
): {
  title: string;
  line: string | undefined;
  arguments: Array<ActionArgumentPart>;
} => {
  return {
    title: describeAIActionSentence(tool.buildActionTitle!(args)),
    line: actionLineText(description),
    arguments: getActionArgumentParts(
      args,
      {
        leaveOutLists: getToolActionLeavesOutLists({
          id: "card",
          toolName: tool.name,
          title: describeAIActionSentence(tool.buildActionTitle!(args)),
          arguments: args,
          isMutation: true,
          requiresApproval: true,
          status: AIChatToolActionStatus.Pending,
          words: {
            title: tool.buildActionTitle!(args),
            ...(description ? { description } : {}),
          },
        }),
        toolName: tool.name,
      },
      ENGLISH,
    ),
  };
};

const proposedOnOf: (
  prepared: PreparedMutation,
) => CodeChangeProposedOn | null = (
  prepared: PreparedMutation,
): CodeChangeProposedOn | null => {
  return readCodeChangeProposedOn(
    prepared.arguments[CODE_CHANGE_PROPOSED_ON_KEY],
  );
};

const range: (first: number, last: number) => AIChatLineRange = (
  first: number,
  last: number,
): AIChatLineRange => {
  return { first, last };
};

// A file's lines as read_code_file has them: split at each newline, none after a last one.
const linesOfFile: (content: string) => Array<string> = (
  content: string,
): Array<string> => {
  if (content === "") {
    return [];
  }

  const lines: Array<string> = content.split("\n");

  return content.endsWith("\n") ? lines.slice(0, -1) : lines;
};

// A window of a file numbered as read_code_file numbers it: "NNN| " and the line.
const numberedAsRead: (lines: Array<string>, startLine: number) => string = (
  lines: Array<string>,
  startLine: number,
): string => {
  const width: number = String(startLine + lines.length - 1).length;

  return lines
    .map((line: string, index: number): string => {
      return `${String(startLine + index).padStart(width, " ")}| ${line}`;
    })
    .join("\n");
};

// The block of a read's answer: after its header, before any footer.
const blockOf: (answer: string) => string = (answer: string): string => {
  const body: string = answer.slice(answer.indexOf("\n\n") + 2);
  const footer: number = body.indexOf("\n… [");

  return footer === -1 ? body : body.slice(0, footer);
};

// A line's number, as read_code_file writes it before "| ".
const LINE_NUMBER: RegExp = /^\d+$/;

// What a model writes whole from a read of all of a file: each line as it was shown, its number taken off.
const writtenFrom: (answer: string, endsWithNewline: boolean) => string = (
  answer: string,
  endsWithNewline: boolean,
): string => {
  const lines: Array<string> = blockOf(answer)
    .split("\n")
    .map((line: string): string => {
      const bar: number = line.indexOf("| ");
      const number: string = bar > 0 ? line.slice(0, bar).trim() : "";

      return LINE_NUMBER.test(number) ? line.slice(bar + 2) : line;
    });

  return lines.join("\n") + (endsWithNewline ? "\n" : "");
};

// The note a read adds when it hid values, or null.
const hiddenNoteOf: (answer: string) => string | null = (
  answer: string,
): string | null => {
  const at: number = answer.indexOf("\n… [values that look like secrets");

  return at === -1 ? null : answer.slice(at + 1);
};

const HIDDEN_IN_SERVERS: string = `Values that look like secrets or personal data were hidden from Ask AI, and its version of this file writes placeholders in their place: ${SERVERS}.`;

const repositoryWithServers: () => FakeGitRepository =
  (): FakeGitRepository => {
    return makeRepository({
      files: {
        main: { [SERVERS]: SERVERS_ON_BRANCH, "README.md": "# checkout\n" },
        "fix/login": {
          [SERVERS]: SERVERS_ON_BRANCH,
          "README.md": "# checkout\n",
        },
      },
    });
  };

// What the model writes from its read: the one line it changed, every other line as it saw it.
const retriesFive: (written: string) => string = (written: string): string => {
  return written.replace("RETRIES = 3;", "RETRIES = 5;");
};

describe("read_code_file: the model reads exactly the redaction it always read, and is told where", () => {
  test("the block is the serializer's own redaction of the numbered lines, byte for byte", async () => {
    serveOnGitHub(repositoryWithServers());

    const result: ToolExecutionResult = await new Conversation(
      GITHUB_CONTEXT,
    ).read(SERVERS, { branchName: "fix/login" });
    const lines: Array<string> = linesOfFile(SERVERS_ON_BRANCH);

    expect(blockOf(result.dataForLlm)).toBe(
      ToolResultSerializer.serializeText(numberedAsRead(lines, 1), lines.length)
        .text,
    );
    expect(result.redactionCount).toBe(3);
  });

  test("no hidden value reaches the model: not in the block, not in the note", async () => {
    serveOnGitHub(repositoryWithServers());

    const answer: string = (
      await new Conversation(GITHUB_CONTEXT).read(SERVERS, {
        branchName: "fix/login",
      })
    ).dataForLlm;

    for (const value of ["10.0.0.12", "10.0.0.13", "ops@acme.com"]) {
      expect(answer).not.toContain(value);
    }
    expect(answer).toContain('PRIMARY_HOST = "[redacted-ip]"');
  });

  test("the note says which lines, as what, and that it cannot write them back", async () => {
    serveOnGitHub(repositoryWithServers());

    const answer: string = (
      await new Conversation(GITHUB_CONTEXT).read(SERVERS, {
        branchName: "fix/login",
      })
    ).dataForLlm;

    expect(hiddenNoteOf(answer)).toBe(
      "… [values that look like secrets or personal data are hidden from you on lines 1-3, as [redacted-ip] and [redacted-email]. You cannot write them back: a commit or pull request writes this file whole, so a version that keeps a placeholder puts it where the real value is. Leave a change to this file to a person, or change only files without hidden values.]",
    );
  });

  test("a window says only its own lines, after the footer that says where to read on", async () => {
    const lines: Array<string> = [];

    for (let line: number = 1; line <= 500; line++) {
      lines.push(
        line === 450 ? 'const HOST = "10.1.2.3";' : `v${line} = ${line};`,
      );
    }

    serveOnGitHub(
      makeRepository({
        files: { main: { [SERVERS]: `${lines.join("\n")}\n` } },
      }),
    );
    const conversation: Conversation = new Conversation(GITHUB_CONTEXT);

    const top: string = (await conversation.read(SERVERS)).dataForLlm;
    expect(top).toContain("stopped at line 400");
    expect(hiddenNoteOf(top)).toBeNull();

    const rest: string = (await conversation.read(SERVERS, { startLine: 401 }))
      .dataForLlm;
    expect(hiddenNoteOf(rest)).toContain(
      "hidden from you on line 450, as [redacted-ip].",
    );
  });

  test("a private key block is hidden whole: every line of it is named", async () => {
    const content: string = [
      "const a = 1;",
      "-----BEGIN RSA PRIVATE KEY-----",
      "MIIEowIBAAKCAQEAx",
      "qwertyuiopasdfgh",
      "-----END RSA PRIVATE KEY-----",
      "const b = 2;",
      "",
    ].join("\n");
    serveOnGitHub(
      makeRepository({ files: { main: { "keys/dev.pem.ts": content } } }),
    );

    const answer: string = (
      await new Conversation(GITHUB_CONTEXT).read("keys/dev.pem.ts")
    ).dataForLlm;

    expect(blockOf(answer)).toBe(
      "1| const a = 1;\n2| [redacted-private-key]\n6| const b = 2;",
    );
    expect(hiddenNoteOf(answer)).toContain(
      "hidden from you on lines 2-5, as [redacted-private-key].",
    );
  });

  test("a line's number read as a value is named too: the model never saw that line as the file has it", async () => {
    const lines: Array<string> = [];

    for (let line: number = 1; line <= 120; line++) {
      lines.push(line === 99 ? "const password =" : `v${line} = ${line};`);
    }

    serveOnGitHub(
      makeRepository({
        files: { main: { "src/auth.ts": `${lines.join("\n")}\n` } },
      }),
    );

    const answer: string = (
      await new Conversation(GITHUB_CONTEXT).read("src/auth.ts")
    ).dataForLlm;

    // The key-value rule reads "100|" as the password's value, as it always did.
    expect(blockOf(answer)).toContain(
      " 99| const password =\n[redacted] v100 = 100;",
    );
    expect(hiddenNoteOf(answer)).toContain(
      "hidden from you on line 100, as [redacted].",
    );
  });

  test.each<[string, string]>([
    [
      "no value hidden",
      'export const RETRIES = 3;\nexport const NAME = "checkout";\n',
    ],
    [
      "only the placeholder text the file holds itself",
      'expect(redact("ip x")).toBe("ip [redacted-ip]");\nconst SHOWN = "[redacted]";\n',
    ],
    [
      "embedded data left out, which is not a hidden value",
      `const LOGO = "data:image/png;base64,${"iVBORw0KGgo".repeat(40)}";\n`,
    ],
  ])(
    "%s: no note, and the answer as it always was",
    async (_case: string, content: string) => {
      serveOnGitHub(
        makeRepository({ files: { main: { "src/a.ts": content } } }),
      );

      const answer: string = (
        await new Conversation(GITHUB_CONTEXT).read("src/a.ts")
      ).dataForLlm;
      const lines: Array<string> = linesOfFile(content);

      expect(hiddenNoteOf(answer)).toBeNull();
      expect(answer).toBe(
        [
          "file: src/a.ts",
          "repository: acme/checkout@main",
          `showing lines 1-${lines.length} of ${lines.length}`,
          "",
          ToolResultSerializer.serializeText(
            numberedAsRead(lines, 1),
            lines.length,
          ).text,
        ].join("\n"),
      );
    },
  );
});

describe("the issue's case: a file with IP addresses and an email, read whole and committed with one line changed", () => {
  test("before anyone approves, the card says values were hidden from Ask AI, and nothing is committed", async () => {
    const repository: FakeGitRepository = repositoryWithServers();
    serveOnGitHub(repository);
    const conversation: Conversation = new Conversation(GITHUB_CONTEXT);

    const read: ToolExecutionResult = await conversation.read(SERVERS, {
      branchName: "fix/login",
    });
    const prepared: PreparedMutation = await conversation.propose(
      CommitCodeToBranchTool,
      commit("fix/login", [
        {
          filePath: SERVERS,
          content: retriesFive(writtenFrom(read.dataForLlm, true)),
        },
      ]),
    );

    expect(cardOf(CommitCodeToBranchTool, prepared)).toEqual({
      title: "Commit 1 file to fix/login",
      line: HIDDEN_IN_SERVERS,
    });
    expect(
      prepared.description!.map((sentence: AIActionSentence) => {
        return sentence.template;
      }),
    ).toEqual([AI_ACTION_PLURAL_LINES.codeFilesValuesHidden.other]);
    expect(
      isKnownAIActionWords({
        title: CommitCodeToBranchTool.buildActionTitle!(prepared.arguments),
        description: prepared.description,
      }),
    ).toBe(true);
    // A pull request's or a commit's card still says how many files it writes (issue #6331).
    expect(
      drawnCard(
        CommitCodeToBranchTool,
        prepared.arguments,
        prepared.description,
      ).line,
    ).toBe(HIDDEN_IN_SERVERS);
    expect(repository.commits).toEqual([]);
  });

  test("in Auto-run it is not made, and the model is told it cannot write those values back", async () => {
    serveOnGitHub(repositoryWithServers());
    const conversation: Conversation = new Conversation(GITHUB_CONTEXT);

    const read: ToolExecutionResult = await conversation.read(SERVERS, {
      branchName: "fix/login",
    });
    const prepared: PreparedMutation = await conversation.propose(
      CommitCodeToBranchTool,
      commit("fix/login", [
        {
          filePath: SERVERS,
          content: retriesFive(writtenFrom(read.dataForLlm, true)),
        },
      ]),
    );

    expect(prepared.notRunWithoutApproval).toEqual({
      toldModel: [
        "Not done: nothing was committed to fix/login, because your version of these files writes placeholders where values were hidden from you:",
        `- ${SERVERS}: your version writes [redacted-ip] on lines 1-2; [redacted-email] on line 3. These are placeholders for values hidden from you, and the file on fix/login does not hold them.`,
        `You cannot write a value hidden from you back: it reads as a placeholder however often you read the file again, so writing ${SERVERS} whole puts the placeholders where the real values are. Leave the change to ${SERVERS} to a person - tell the user what to change, and where - or change only files without hidden values. Never write a placeholder, or a value you guess, in place of a hidden one. If the user asked you to write that placeholder text itself, tell them they can approve it with Ask to act.`,
      ].join("\n"),
      summary:
        CODE_UNSEEN_SUMMARIES[CodeChangeKind.Commit][
          CodeFileUnseen.ValuesHidden
        ],
    });
    expect(prepared.notRunWithoutApproval!.toldModel).not.toContain(
      "Read each of these files",
    );
  });

  test("what the card was shown on keeps the placeholders and their lines, for the approval and a reviewer", async () => {
    serveOnGitHub(repositoryWithServers());
    const conversation: Conversation = new Conversation(GITHUB_CONTEXT);

    const read: ToolExecutionResult = await conversation.read(SERVERS, {
      branchName: "fix/login",
    });
    const prepared: PreparedMutation = await conversation.propose(
      CommitCodeToBranchTool,
      commit("fix/login", [
        {
          filePath: SERVERS,
          content: retriesFive(writtenFrom(read.dataForLlm, true)),
        },
      ]),
    );

    expect(proposedOnOf(prepared)).toEqual({
      branchName: "fix/login",
      files: [
        {
          filePath: SERVERS,
          fingerprint: fingerprintCodeFileVersion(blobOf(SERVERS_ON_BRANCH)),
        },
      ],
      unseen: [
        {
          filePath: SERVERS,
          unseen: CodeFileUnseen.ValuesHidden,
          placeholdersWritten: [
            {
              placeholder: "[redacted-ip]",
              written: 2,
              onBranch: 0,
              lines: [range(1, 2)],
            },
            {
              placeholder: "[redacted-email]",
              written: 1,
              onBranch: 0,
              lines: [range(3, 3)],
            },
          ],
        },
      ],
    });
    // Never the values themselves.
    expect(JSON.stringify(prepared)).not.toContain("10.0.0.12");
    expect(JSON.stringify(prepared)).not.toContain("ops@acme.com");
  });

  test("approved anyway, it is committed as the card said: the person chose", async () => {
    const repository: FakeGitRepository = repositoryWithServers();
    serveOnGitHub(repository);
    const conversation: Conversation = new Conversation(GITHUB_CONTEXT);

    const read: ToolExecutionResult = await conversation.read(SERVERS, {
      branchName: "fix/login",
    });
    const content: string = retriesFive(writtenFrom(read.dataForLlm, true));
    await conversation.run(
      CommitCodeToBranchTool,
      await conversation.propose(
        CommitCodeToBranchTool,
        commit("fix/login", [{ filePath: SERVERS, content }]),
      ),
    );

    expect(repository.commits).toHaveLength(1);
    expect(repository.branches.get("fix/login")!.get(SERVERS)).toBe(content);
  });

  test("a version that takes the hidden values out, or puts the person's in, writes over nothing hidden: the card as it always was", async () => {
    serveOnGitHub(repositoryWithServers());
    const conversation: Conversation = new Conversation(GITHUB_CONTEXT);

    await conversation.read(SERVERS, { branchName: "fix/login" });

    for (const content of [
      // The hard-coded hosts and address replaced, as the person asked.
      [
        "export const PRIMARY_HOST = process.env.PRIMARY_HOST;",
        "export const BACKUP_HOST = process.env.BACKUP_HOST;",
        "export const ON_CALL = process.env.ON_CALL;",
        "export const RETRIES = 3;",
        "",
      ].join("\n"),
      // The lines that held them taken out.
      "export const RETRIES = 5;\n",
      // Values the person gave in the conversation, written as they gave them.
      'export const PRIMARY_HOST = "10.9.9.9";\nexport const RETRIES = 3;\n',
    ]) {
      const args: JSONObject = commit("fix/login", [
        { filePath: SERVERS, content },
      ]);
      const prepared: PreparedMutation = await conversation.propose(
        CommitCodeToBranchTool,
        args,
      );

      expect(Object.keys(prepared)).toEqual(["arguments"]);
      expect(drawnCard(CommitCodeToBranchTool, prepared.arguments)).toEqual(
        drawnCard(CommitCodeToBranchTool, args),
      );
    }
  });
});

/*
 * Every rule of the serializer: a value of its kind in a file, read whole,
 * and the file written back as the model was shown it, one other line
 * changed.
 */
const VALUES_OF_EVERY_RULE: Array<
  [string, Array<string>, string, AIChatLineRange]
> = [
  [
    "a JWT",
    [
      'const TOKEN = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U";',
    ],
    "[redacted-jwt]",
    range(2, 2),
  ],
  [
    "a bearer token",
    ['const AUTH = "Bearer abcdefghijklmnopqrstuvwxyz0123";'],
    "[redacted-token]",
    range(2, 2),
  ],
  [
    "a private key block, over several lines",
    [
      "const KEY = `",
      "-----BEGIN RSA PRIVATE KEY-----",
      "MIIEowIBAAKCAQEAx",
      "-----END RSA PRIVATE KEY-----",
      "`;",
    ],
    "[redacted-private-key]",
    range(3, 3),
  ],
  [
    "an AWS key",
    ['const AWS = "AKIAIOSFODNN7EXAMPLE";'],
    "[redacted-aws-key]",
    range(2, 2),
  ],
  [
    "a GitHub token",
    ['const GH = "ghp_abcdefghijklmnopqrstuvwxyz0123456789";'],
    "[redacted-github-token]",
    range(2, 2),
  ],
  [
    "a Slack token",
    ['const SLACK = "xoxb-1234567890-abcdefghij";'],
    "[redacted-slack-token]",
    range(2, 2),
  ],
  [
    "a Google API key",
    ['const MAPS = "AIzaSyA1234567890abcdefghijklmnopqrstuv";'],
    "[redacted-google-api-key]",
    range(2, 2),
  ],
  [
    "an email address",
    ['const TO = "ops@acme.com";'],
    "[redacted-email]",
    range(2, 2),
  ],
  [
    "an IPv4 address",
    ['const HOST = "10.0.0.12";'],
    "[redacted-ip]",
    range(2, 2),
  ],
  [
    "a card number",
    ['const CARD = "4111 1111 1111 1111";'],
    "[redacted-card]",
    range(2, 2),
  ],
  [
    "a long hex digest",
    [
      'const DIGEST = "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08";',
    ],
    "[redacted-hex]",
    range(2, 2),
  ],
  [
    "a labelled secret - and a TypeScript field read as one",
    [
      'const config = { password: "hunter22" };',
      "interface Login { password: string; }",
    ],
    "[redacted]",
    range(2, 3),
  ],
];

describe("every redaction rule: a value of its kind, written back as the model was shown it", () => {
  test.each(VALUES_OF_EVERY_RULE)(
    "%s",
    async (
      _kind: string,
      valueLines: Array<string>,
      placeholder: string,
      lines: AIChatLineRange,
    ) => {
      const filePath: string = "src/settings.ts";
      const content: string = [
        "// settings",
        ...valueLines,
        "export const RETRIES = 3;",
        "",
      ].join("\n");
      serveOnGitHub(
        makeRepository({ files: { "fix/login": { [filePath]: content } } }),
      );
      const conversation: Conversation = new Conversation(GITHUB_CONTEXT);

      const read: ToolExecutionResult = await conversation.read(filePath, {
        branchName: "fix/login",
      });
      const prepared: PreparedMutation = await conversation.propose(
        CommitCodeToBranchTool,
        commit("fix/login", [
          {
            filePath,
            content: retriesFive(writtenFrom(read.dataForLlm, true)),
          },
        ]),
      );

      expect(cardOf(CommitCodeToBranchTool, prepared).line).toBe(
        `Values that look like secrets or personal data were hidden from Ask AI, and its version of this file writes placeholders in their place: ${filePath}.`,
      );
      const finding: CodeFileUnseenFinding = proposedOnOf(prepared)!.unseen[0]!;
      expect(finding.unseen).toBe(CodeFileUnseen.ValuesHidden);
      expect(finding.placeholdersWritten).toEqual([
        {
          placeholder,
          written: lines.last - lines.first + 1,
          onBranch: 0,
          lines: [lines],
        },
      ]);
      expect(prepared.notRunWithoutApproval!.toldModel).toContain(
        `- ${filePath}: your version writes ${placeholder} on`,
      );
      // The model was told before it wrote anything.
      expect(hiddenNoteOf(read.dataForLlm)).toContain(`as ${placeholder}.`);
      expect(REDACTION_PLACEHOLDERS).toContain(placeholder);
    },
  );

  test("the cases cover every rule's placeholder", () => {
    expect(
      VALUES_OF_EVERY_RULE.map(
        (value: [string, Array<string>, string, AIChatLineRange]) => {
          return value[2];
        },
      ).sort(),
    ).toEqual([...REDACTION_PLACEHOLDERS].sort());
  });
});

describe("placeholder text the file on the branch holds itself", () => {
  // OneUptime's own kind of redaction test: its expected outputs are placeholders, its inputs not values.
  const TESTS_WITHOUT_VALUES: string = [
    'test("an address", () => {',
    '  expect(redact("host x")).toBe("host [redacted-ip]");',
    '  expect(shown).toBe("[redacted]");',
    "});",
    "",
  ].join("\n");

  test("kept as it is, a change elsewhere in the file: the card as it always was", async () => {
    serveOnGitHub(
      makeRepository({
        files: {
          "fix/login": { "Tests/Redact.test.ts": TESTS_WITHOUT_VALUES },
        },
      }),
    );
    const conversation: Conversation = new Conversation(GITHUB_CONTEXT);

    const read: ToolExecutionResult = await conversation.read(
      "Tests/Redact.test.ts",
      {
        branchName: "fix/login",
      },
    );
    expect(hiddenNoteOf(read.dataForLlm)).toBeNull();

    const args: JSONObject = commit("fix/login", [
      {
        filePath: "Tests/Redact.test.ts",
        content: writtenFrom(read.dataForLlm, true).replace(
          '"an address"',
          '"an IP address"',
        ),
      },
    ]);
    const prepared: PreparedMutation = await conversation.propose(
      CommitCodeToBranchTool,
      args,
    );

    expect(Object.keys(prepared)).toEqual(["arguments"]);
    expect(drawnCard(CommitCodeToBranchTool, prepared.arguments)).toEqual(
      drawnCard(CommitCodeToBranchTool, args),
    );
  });

  test("beside values hidden in it: said, with how many the file holds itself", async () => {
    const tests: string = [
      'test("an address", () => {',
      '  expect(redact("host 10.0.0.1")).toBe("host [redacted-ip]");',
      "});",
      "",
    ].join("\n");
    serveOnGitHub(
      makeRepository({
        files: { "fix/login": { "Tests/Redact.test.ts": tests } },
      }),
    );
    const conversation: Conversation = new Conversation(GITHUB_CONTEXT);

    const read: ToolExecutionResult = await conversation.read(
      "Tests/Redact.test.ts",
      {
        branchName: "fix/login",
      },
    );
    // The model cannot tell the input's placeholder from the expected one: line 2 is named.
    expect(hiddenNoteOf(read.dataForLlm)).toContain(
      "hidden from you on line 2, as [redacted-ip].",
    );

    const prepared: PreparedMutation = await conversation.propose(
      CommitCodeToBranchTool,
      commit("fix/login", [
        {
          filePath: "Tests/Redact.test.ts",
          content: writtenFrom(read.dataForLlm, true).replace(
            '"an address"',
            '"an IP address"',
          ),
        },
      ]),
    );

    expect(cardOf(CommitCodeToBranchTool, prepared).line).toBe(
      "Values that look like secrets or personal data were hidden from Ask AI, and its version of this file writes placeholders in their place: Tests/Redact.test.ts.",
    );
    expect(prepared.notRunWithoutApproval!.toldModel).toContain(
      "- Tests/Redact.test.ts: your version writes [redacted-ip] twice, on line 2, where the file on fix/login has it once. These are placeholders for values hidden from you, and the file on fix/login holds fewer of them.",
    );
  });

  test("held to the file on the branch committed to, not on another", async () => {
    const repository: FakeGitRepository = makeRepository({
      files: {
        // The placeholder text is the branch's own; main never had it.
        main: { "Tests/Redact.test.ts": "// no tests yet\n" },
        "fix/login": { "Tests/Redact.test.ts": TESTS_WITHOUT_VALUES },
      },
    });
    serveOnGitHub(repository);
    const conversation: Conversation = new Conversation(GITHUB_CONTEXT);

    const read: ToolExecutionResult = await conversation.read(
      "Tests/Redact.test.ts",
      {
        branchName: "fix/login",
      },
    );
    const reads: number = repository.contentReads.length;
    const prepared: PreparedMutation = await conversation.propose(
      CommitCodeToBranchTool,
      commit("fix/login", [
        {
          filePath: "Tests/Redact.test.ts",
          content: `${writtenFrom(read.dataForLlm, true)}// one more\n`,
        },
      ]),
    );

    expect(Object.keys(prepared)).toEqual(["arguments"]);
    expect(repository.contentReads.slice(reads)).toEqual([
      { branchName: "fix/login", filePath: "Tests/Redact.test.ts" },
    ]);
  });

  test("placeholder text the person asks for, new in the file: said, so they approve it knowingly", async () => {
    const repository: FakeGitRepository = makeRepository({
      files: { "fix/login": { "Tests/Redact.test.ts": TESTS_WITHOUT_VALUES } },
    });
    serveOnGitHub(repository);
    const conversation: Conversation = new Conversation(GITHUB_CONTEXT);

    await conversation.read("Tests/Redact.test.ts", {
      branchName: "fix/login",
    });
    const content: string = `${TESTS_WITHOUT_VALUES}test("an email", () => {\n  expect(redact("to x")).toBe("to [redacted-email]");\n});\n`;
    const prepared: PreparedMutation = await conversation.propose(
      CommitCodeToBranchTool,
      commit("fix/login", [{ filePath: "Tests/Redact.test.ts", content }]),
    );

    expect(prepared.notRunWithoutApproval!.toldModel).toContain(
      "If the user asked you to write that placeholder text itself, tell them they can approve it with Ask to act.",
    );

    await conversation.run(CommitCodeToBranchTool, prepared);
    expect(
      repository.branches.get("fix/login")!.get("Tests/Redact.test.ts"),
    ).toBe(content);
  });
});

describe("only a file written with a placeholder in it is read for its text", () => {
  test("a commit without one reads no text at all, as before", async () => {
    const repository: FakeGitRepository = repositoryWithServers();
    serveOnGitHub(repository);
    const conversation: Conversation = new Conversation(GITHUB_CONTEXT);

    await conversation.read("README.md", { branchName: "fix/login" });
    const reads: number = repository.contentReads.length;

    await conversation.propose(
      CommitCodeToBranchTool,
      commit("fix/login", [
        { filePath: "README.md", content: "# checkout!\n" },
      ]),
    );

    expect(repository.contentReads).toHaveLength(reads);
  });

  test("of two files, only the one with a placeholder, on the branch committed to", async () => {
    const repository: FakeGitRepository = repositoryWithServers();
    serveOnGitHub(repository);
    const conversation: Conversation = new Conversation(GITHUB_CONTEXT);

    const read: ToolExecutionResult = await conversation.read(SERVERS, {
      branchName: "fix/login",
    });
    await conversation.read("README.md", { branchName: "fix/login" });
    const reads: number = repository.contentReads.length;

    await conversation.propose(
      CommitCodeToBranchTool,
      commit("fix/login", [
        { filePath: "README.md", content: "# checkout!\n" },
        {
          filePath: SERVERS,
          content: retriesFive(writtenFrom(read.dataForLlm, true)),
        },
      ]),
    );

    expect(repository.contentReads.slice(reads)).toEqual([
      { branchName: "fix/login", filePath: SERVERS },
    ]);
  });
});

describe("a new file, and a file whose text cannot be read", () => {
  test("a new file holding placeholders copied from a redacted read: said", async () => {
    serveOnGitHub(repositoryWithServers());
    const conversation: Conversation = new Conversation(GITHUB_CONTEXT);

    const read: ToolExecutionResult = await conversation.read(SERVERS, {
      branchName: "fix/login",
    });
    const prepared: PreparedMutation = await conversation.propose(
      CommitCodeToBranchTool,
      commit("fix/login", [
        {
          filePath: "config/servers.prod.ts",
          content: writtenFrom(read.dataForLlm, true),
        },
      ]),
    );

    expect(cardOf(CommitCodeToBranchTool, prepared).line).toBe(
      "Values that look like secrets or personal data were hidden from Ask AI, and its version of this file writes placeholders in their place: config/servers.prod.ts.",
    );
  });

  test("the branch's text cannot be read: said all the same, and the model told why", async () => {
    const repository: FakeGitRepository = repositoryWithServers();
    serveOnGitHub(repository);
    const conversation: Conversation = new Conversation(GITHUB_CONTEXT);

    const read: ToolExecutionResult = await conversation.read(SERVERS, {
      branchName: "fix/login",
    });
    repository.textUnreadable.set(SERVERS, "GitHub answered 502.");

    const prepared: PreparedMutation = await conversation.propose(
      CommitCodeToBranchTool,
      commit("fix/login", [
        {
          filePath: SERVERS,
          content: retriesFive(writtenFrom(read.dataForLlm, true)),
        },
      ]),
    );

    expect(cardOf(CommitCodeToBranchTool, prepared).line).toBe(
      HIDDEN_IN_SERVERS,
    );
    expect(proposedOnOf(prepared)!.unseen[0]!.branchTextNotRead).toBe(true);
    expect(prepared.notRunWithoutApproval!.toldModel).toContain(
      "These are placeholders for values hidden from you, and OneUptime could not read the file on fix/login to see whether it holds them itself.",
    );
  });

  test("a read past its deadline is unreadable, never taken for a file with none", async () => {
    const texts: Map<string, CodeFileTextNow> = await readCodeFileTextsNow({
      filePaths: ["a.ts", "b.ts"],
      read: (): Promise<string | null> => {
        return new Promise<string | null>((): void => {
          // Never answers.
        });
      },
      deadlineInMs: 20,
    });

    expect(Array.from(texts.entries())).toEqual([
      [
        "a.ts",
        {
          state: "unreadable",
          reason: "The code host did not answer in time to check it.",
        },
      ],
      [
        "b.ts",
        {
          state: "unreadable",
          reason: "The code host did not answer in time to check it.",
        },
      ],
    ]);
  });

  test("each read on its own: text, nothing there, or a failure, never stopping the others", async () => {
    const texts: Map<string, CodeFileTextNow> = await readCodeFileTextsNow({
      filePaths: ["a.ts", "gone.ts", "broken.ts"],
      read: async (filePath: string): Promise<string | null> => {
        if (filePath === "broken.ts") {
          throw new Error("boom");
        }

        return filePath === "gone.ts" ? null : "x\n";
      },
    });

    expect(Array.from(texts.entries())).toEqual([
      ["a.ts", { state: "text", text: "x\n" }],
      ["gone.ts", { state: "absent" }],
      [
        "broken.ts",
        { state: "unreadable", reason: "The code host could not be read." },
      ],
    ]);
    expect(
      (
        await readCodeFileTextsNow({
          filePaths: [],
          read: async (): Promise<string | null> => {
            throw new Error("never asked");
          },
        })
      ).size,
    ).toBe(0);
  });
});

describe("beside what Ask AI never saw of a file", () => {
  test("changed since the read and written with placeholders: two lines, the placeholders first, and the model told both", async () => {
    const repository: FakeGitRepository = repositoryWithServers();
    serveOnGitHub(repository);
    const conversation: Conversation = new Conversation(GITHUB_CONTEXT);

    const read: ToolExecutionResult = await conversation.read(SERVERS, {
      branchName: "fix/login",
    });
    push(
      repository,
      "fix/login",
      SERVERS,
      `${SERVERS_ON_BRANCH}export const TIMEOUT = 30;\n`,
    );

    const prepared: PreparedMutation = await conversation.propose(
      CommitCodeToBranchTool,
      commit("fix/login", [
        {
          filePath: SERVERS,
          content: retriesFive(writtenFrom(read.dataForLlm, true)),
        },
      ]),
    );

    expect(
      prepared.description!.map((sentence: AIActionSentence) => {
        return describeAIActionSentence(sentence);
      }),
    ).toEqual([
      HIDDEN_IN_SERVERS,
      `This file changed on fix/login after Ask AI read it, and Ask AI's version undoes that change: ${SERVERS}.`,
    ]);
    expect(prepared.notRunWithoutApproval!.summary).toBe(
      CODE_UNSEEN_SUMMARIES[CodeChangeKind.Commit][CodeFileUnseen.ValuesHidden],
    );

    const told: Array<string> =
      prepared.notRunWithoutApproval!.toldModel.split("\n");
    expect(told[0]).toBe(
      "Not done: nothing was committed to fix/login, because writing these files whole would undo or replace what you have not read there:",
    );
    expect(told[1]!.startsWith(`- ${SERVERS}: your version writes`)).toBe(true);
    expect(told[2]).toBe(
      `- ${SERVERS} changed on fix/login after you last read it there.`,
    );
    expect(told.join("\n")).toContain(
      'Read each of these files on fix/login with read_code_file and branchName "fix/login"',
    );
    expect(told.join("\n")).toContain(
      "You cannot write a value hidden from you back",
    );
    expect(
      proposedOnOf(prepared)!.unseen.map((finding: CodeFileUnseenFinding) => {
        return finding.unseen;
      }),
    ).toEqual([CodeFileUnseen.ValuesHidden, CodeFileUnseen.ChangedSinceRead]);
  });

  test("read only in part and written with placeholders: both lines", async () => {
    const lines: Array<string> = [];

    for (let line: number = 1; line <= 900; line++) {
      lines.push(
        line === 10 ? 'const HOST = "10.1.2.3";' : `v${line} = ${line};`,
      );
    }

    serveOnGitHub(
      makeRepository({
        files: { "fix/login": { [SERVERS]: `${lines.join("\n")}\n` } },
      }),
    );
    const conversation: Conversation = new Conversation(GITHUB_CONTEXT);

    const read: ToolExecutionResult = await conversation.read(SERVERS, {
      branchName: "fix/login",
    });
    const prepared: PreparedMutation = await conversation.propose(
      CommitCodeToBranchTool,
      commit("fix/login", [
        { filePath: SERVERS, content: writtenFrom(read.dataForLlm, true) },
      ]),
    );

    expect(
      prepared.description!.map((sentence: AIActionSentence) => {
        return sentence.template;
      }),
    ).toEqual([
      AI_ACTION_PLURAL_LINES.codeFilesValuesHidden.other,
      AI_ACTION_PLURAL_LINES.codeFilesReadInPart.other,
    ]);
  });

  test("five files written with placeholders: one line, three named and the rest counted; the model told every one", async () => {
    const names: Array<string> = ["a.ts", "b.ts", "c.ts", "d.ts", "e.ts"];
    const files: Record<string, string> = {};

    for (const name of names) {
      files[`config/${name}`] = 'export const HOST = "10.0.0.1";\n';
    }

    serveOnGitHub(makeRepository({ files: { "fix/login": files } }));
    const conversation: Conversation = new Conversation(GITHUB_CONTEXT);
    const changes: Array<{ filePath: string; content: string }> = [];

    for (const name of names) {
      const read: ToolExecutionResult = await conversation.read(
        `config/${name}`,
        {
          branchName: "fix/login",
        },
      );
      changes.push({
        filePath: `config/${name}`,
        content: writtenFrom(read.dataForLlm, true),
      });
    }

    const prepared: PreparedMutation = await conversation.propose(
      CommitCodeToBranchTool,
      commit("fix/login", changes),
    );

    expect(cardOf(CommitCodeToBranchTool, prepared).line).toBe(
      "Values that look like secrets or personal data were hidden from Ask AI, and its versions of these 5 files write placeholders in their place: config/a.ts, config/b.ts, config/c.ts, 2 more files.",
    );

    for (const name of names) {
      expect(prepared.notRunWithoutApproval!.toldModel).toContain(
        `- config/${name}: your version writes [redacted-ip] on line 1.`,
      );
    }
    expect(prepared.notRunWithoutApproval!.toldModel).toContain(
      "Leave the change to config/a.ts, config/b.ts, config/c.ts, config/d.ts and config/e.ts to a person",
    );
  });
});

describe("open_code_pull_request, written with placeholders on the default branch", () => {
  test("the card names it; Auto-run does not open it; approved anyway, its reviewer is told where the placeholders are", async () => {
    const repository: FakeGitRepository = repositoryWithServers();
    serveOnGitHub(repository);
    const conversation: Conversation = new Conversation(GITHUB_CONTEXT);

    const read: ToolExecutionResult = await conversation.read(SERVERS);
    const prepared: PreparedMutation = await conversation.propose(
      OpenCodePullRequestTool,
      pullRequest([
        {
          filePath: SERVERS,
          content: retriesFive(writtenFrom(read.dataForLlm, true)),
        },
      ]),
    );

    expect(cardOf(OpenCodePullRequestTool, prepared)).toEqual({
      title: "Open pull request: More retries",
      line: HIDDEN_IN_SERVERS,
    });
    expect(prepared.notRunWithoutApproval!.summary).toBe(
      CODE_UNSEEN_SUMMARIES[CodeChangeKind.PullRequest][
        CodeFileUnseen.ValuesHidden
      ],
    );
    expect(prepared.notRunWithoutApproval!.toldModel).toMatch(
      /^Not done: no pull request was opened, because your version of these files writes placeholders where values were hidden from you:/,
    );
    // The card still says how many files the pull request writes (issue #6331).
    expect(
      drawnCard(
        OpenCodePullRequestTool,
        prepared.arguments,
        prepared.description,
      ).arguments,
    ).toContainEqual({ key: "changes", label: "Files", value: "1" });

    await conversation.run(OpenCodePullRequestTool, prepared);

    expect(repository.pullRequests).toHaveLength(1);
    expect(repository.pullRequests[0]!.body).toBe(
      [
        "Retry five times.",
        "",
        "---",
        "_Proposed by OneUptime AI from a chat conversation. Review carefully before merging: this change was written by an agent that reads production telemetry._",
        "",
        "**Check these files' diffs.** Before this was approved, OneUptime said AI's versions of them may undo or replace what it did not read:",
        `- \`${SERVERS}\`: AI's version writes \`[redacted-ip]\` on lines 1-2; \`[redacted-email]\` on line 3, placeholders for values hidden from AI, where the real values belong.`,
      ].join("\n"),
    );
  });

  test("a version that writes no placeholder: the pull request exactly as it always was", async () => {
    const repository: FakeGitRepository = repositoryWithServers();
    serveOnGitHub(repository);
    const conversation: Conversation = new Conversation(GITHUB_CONTEXT);

    await conversation.read(SERVERS);
    const prepared: PreparedMutation = await conversation.propose(
      OpenCodePullRequestTool,
      pullRequest([
        { filePath: SERVERS, content: "export const RETRIES = 5;\n" },
      ]),
    );

    expect(Object.keys(prepared)).toEqual(["arguments"]);
    await conversation.run(OpenCodePullRequestTool, prepared);
    expect(repository.pullRequests[0]!.body).not.toContain("Check these files");
  });
});

// The repository the GitLab and Forgejo cases serve.
let gitlabOrForgejo: FakeGitRepository;

describe("beyond GitHub", () => {
  test.each<[string, () => void]>([
    [
      "GitLab",
      (): void => {
        serveOnGitLab(gitlabOrForgejo);
      },
    ],
    [
      "Forgejo and Gitea",
      (): void => {
        serveOnForgejo(gitlabOrForgejo);
      },
    ],
  ])(
    "%s: written with placeholders, the card says so; written without, nothing",
    async (_host: string, serve: () => void) => {
      gitlabOrForgejo = repositoryWithServers();
      serve();
      const conversation: Conversation = new Conversation(CONNECTED_CONTEXT);

      const read: ToolExecutionResult = await conversation.read(SERVERS, {
        branchName: "fix/login",
      });
      expect(hiddenNoteOf(read.dataForLlm)).toContain("on lines 1-3");

      expect(
        cardOf(
          CommitCodeToBranchTool,
          await conversation.propose(
            CommitCodeToBranchTool,
            commit("fix/login", [
              {
                filePath: SERVERS,
                content: retriesFive(writtenFrom(read.dataForLlm, true)),
              },
            ]),
          ),
        ).line,
      ).toBe(HIDDEN_IN_SERVERS);

      expect(
        Object.keys(
          await conversation.propose(
            CommitCodeToBranchTool,
            commit("fix/login", [
              { filePath: SERVERS, content: "export const RETRIES = 5;\n" },
            ]),
          ),
        ),
      ).toEqual(["arguments"]);
    },
  );
});

/*
 * ---------------------------------------------------------------------------
 * Every file, against the serializer's rules: files drawn from a seed, each
 * line plain code, a value of a random rule's kind, the file's own
 * placeholder text, or a private key block over several lines. The model
 * reads each whole; then:
 *
 *   - written back whole as it was shown, one plain line changed: said
 *     exactly when the file holds a value, of every placeholder whose
 *     count rose, on the lines an oracle that counts its own way finds;
 *   - written as the branch has it, one plain line changed - every value
 *     and every placeholder of the file's own left alone: never said;
 *   - written as it was shown, without the lines that held values: never
 *     said.
 *
 * And no value drawn ever reaches the model, while the note it reads
 * names exactly the lines that held one.
 * ---------------------------------------------------------------------------
 */

// Letters and marks no redaction reads as a value: no digits, no hex runs, no @, no keyword.
const PLAIN_PIECES: Array<string> = [
  "let ",
  "g",
  "h",
  "k",
  "m",
  "n",
  "p",
  "q",
  "r",
  "s",
  "t",
  "u",
  "v",
  "w",
  "x",
  "y",
  "z",
  " = ",
  ";",
  "(",
  ")",
  " ",
];

const draw: (
  random: SeededRandom,
  alphabet: string,
  length: number,
) => string = (
  random: SeededRandom,
  alphabet: string,
  length: number,
): string => {
  let text: string = "";

  for (let index: number = 0; index < length; index++) {
    text += alphabet[random(alphabet.length)];
  }

  return text;
};

const LOWER: string = "abcdefghijklmnopqrstuvwxyz";
const UPPER: string = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const DIGITS: string = "0123456789";
const HEX: string = "0123456789abcdef";
const BASE64URL: string = `${LOWER}${UPPER}${DIGITS}_-`;

// A value each rule hides, drawn: its lines (most one), the values in them, and the placeholder it reads as.
interface DrawnValue {
  lines: Array<string>;
  secrets: Array<string>;
  placeholder: string;
}

const VALUES: Array<(random: SeededRandom) => DrawnValue> = [
  (random: SeededRandom): DrawnValue => {
    const token: string = `eyJ${draw(random, BASE64URL, 10 + random(20))}.${draw(random, BASE64URL, 10 + random(20))}.${draw(random, BASE64URL, 5 + random(20))}`;

    return {
      lines: [`const t = "${token}";`],
      secrets: [token],
      placeholder: "[redacted-jwt]",
    };
  },
  (random: SeededRandom): DrawnValue => {
    const token: string = draw(random, `${LOWER}${DIGITS}`, 16 + random(20));

    return {
      lines: [`const b = "Bearer ${token}";`],
      secrets: [token],
      placeholder: "[redacted-token]",
    };
  },
  (random: SeededRandom): DrawnValue => {
    const body: Array<string> = [];

    for (let line: number = 0; line < 1 + random(4); line++) {
      body.push(draw(random, `${LOWER}${UPPER}${DIGITS}+/`, 16 + random(40)));
    }

    return {
      lines: [
        "-----BEGIN PRIVATE KEY-----",
        ...body,
        "-----END PRIVATE KEY-----",
      ],
      secrets: body,
      placeholder: "[redacted-private-key]",
    };
  },
  (random: SeededRandom): DrawnValue => {
    const key: string = `AKIA${draw(random, `${UPPER}${DIGITS}`, 16)}`;

    return {
      lines: [`const a = "${key}";`],
      secrets: [key],
      placeholder: "[redacted-aws-key]",
    };
  },
  (random: SeededRandom): DrawnValue => {
    const token: string = `ghp_${draw(random, `${LOWER}${UPPER}${DIGITS}`, 36 + random(8))}`;

    return {
      lines: [`const g = "${token}";`],
      secrets: [token],
      placeholder: "[redacted-github-token]",
    };
  },
  (random: SeededRandom): DrawnValue => {
    // Letters and digits only: a token ending in "-" would end its match short.
    const token: string = `xoxb-${draw(random, `${LOWER}${DIGITS}`, 10 + random(20))}`;

    return {
      lines: [`const s = "${token}";`],
      secrets: [token],
      placeholder: "[redacted-slack-token]",
    };
  },
  (random: SeededRandom): DrawnValue => {
    // No "-": the rule ends the key at a word boundary.
    const key: string = `AIza${draw(random, `${LOWER}${UPPER}${DIGITS}_`, 35)}`;

    return {
      lines: [`const k = "${key}";`],
      secrets: [key],
      placeholder: "[redacted-google-api-key]",
    };
  },
  (random: SeededRandom): DrawnValue => {
    const email: string = `${draw(random, LOWER, 1 + random(10))}@${draw(random, LOWER, 1 + random(10))}.${draw(random, LOWER, 2 + random(4))}`;

    return {
      lines: [`const e = "${email}";`],
      secrets: [email],
      placeholder: "[redacted-email]",
    };
  },
  (random: SeededRandom): DrawnValue => {
    const address: string = `${1 + random(254)}.${random(256)}.${random(256)}.${random(256)}`;

    return {
      lines: [`const i = "${address}";`],
      secrets: [address],
      placeholder: "[redacted-ip]",
    };
  },
  (random: SeededRandom): DrawnValue => {
    const separator: string = random(2) === 0 ? " " : "-";
    const card: string = [0, 1, 2, 3]
      .map((): string => {
        return draw(random, DIGITS, 4);
      })
      .join(separator);

    return {
      lines: [`const c = "${card}";`],
      secrets: [card],
      placeholder: "[redacted-card]",
    };
  },
  (random: SeededRandom): DrawnValue => {
    const digest: string = draw(random, HEX, 33 + random(32));

    return {
      lines: [`const h = "${digest}";`],
      secrets: [digest],
      placeholder: "[redacted-hex]",
    };
  },
  (random: SeededRandom): DrawnValue => {
    const key: string = ["password", "secret", "api_key", "access_token"][
      random(4)
    ]!;
    const value: string = draw(random, LOWER, 10 + random(10));

    return {
      lines: [`${key} = "${value}";`],
      secrets: [value],
      placeholder: "[redacted]",
    };
  },
];

// The file's own placeholder text, on a line of its own that no rule reads again.
const OWN_PLACEHOLDER_LINES: Array<string> = [
  'expect(shown).toBe("[redacted-ip]");',
  'expect(shown).toBe("[redacted-email]");',
  'const SHOWN = "[redacted]";',
  'const SHOWN = "[redacted-hex]";',
];

interface DrawnFile {
  lines: Array<string>;
  // Which lines (1-based) hold a value drawn, and every value drawn.
  valueLines: Set<number>;
  secrets: Array<string>;
  plainLines: Array<number>;
}

const drawFile: (random: SeededRandom) => DrawnFile = (
  random: SeededRandom,
): DrawnFile => {
  const file: DrawnFile = {
    lines: [],
    valueLines: new Set(),
    secrets: [],
    plainLines: [],
  };
  const count: number = 2 + random(40);

  while (file.lines.length < count) {
    const kind: number = random(10);

    if (kind < 6) {
      let text: string = "";

      for (let piece: number = 0; piece < 1 + random(12); piece++) {
        text += PLAIN_PIECES[random(PLAIN_PIECES.length)];
      }

      file.lines.push(text);
      file.plainLines.push(file.lines.length);
    } else if (kind < 9) {
      const value: DrawnValue = VALUES[random(VALUES.length)]!(random);

      for (const line of value.lines) {
        file.lines.push(line);
        file.valueLines.add(file.lines.length);
      }

      file.secrets.push(...value.secrets);
    } else {
      file.lines.push(
        OWN_PLACEHOLDER_LINES[random(OWN_PLACEHOLDER_LINES.length)]!,
      );
    }
  }

  return file;
};

// The oracle: each placeholder counted by splitting, the lines of each found by reading every line.
const placeholdersRisen: (
  content: string,
  branchContent: string,
) => Array<CodeFilePlaceholderWritten> = (
  content: string,
  branchContent: string,
): Array<CodeFilePlaceholderWritten> => {
  const risen: Array<CodeFilePlaceholderWritten> = [];

  for (const placeholder of REDACTION_PLACEHOLDERS) {
    const written: number = content.split(placeholder).length - 1;
    const onBranch: number = branchContent.split(placeholder).length - 1;

    if (written <= onBranch) {
      continue;
    }

    const lines: Array<AIChatLineRange> = [];

    content.split("\n").forEach((line: string, index: number): void => {
      if (line.includes(placeholder)) {
        const previous: AIChatLineRange | undefined = lines[lines.length - 1];

        if (previous && previous.last === index) {
          previous.last = index + 1;
        } else {
          lines.push(range(index + 1, index + 1));
        }
      }
    });

    risen.push({ placeholder, written, onBranch, lines });
  }

  return risen.sort(
    (a: CodeFilePlaceholderWritten, b: CodeFilePlaceholderWritten): number => {
      return a.lines[0]!.first - b.lines[0]!.first;
    },
  );
};

// The runs of lines a set of line numbers holds.
const runsOf: (lines: Set<number>) => Array<AIChatLineRange> = (
  lines: Set<number>,
): Array<AIChatLineRange> => {
  const runs: Array<AIChatLineRange> = [];

  for (const line of Array.from(lines).sort((a: number, b: number) => {
    return a - b;
  })) {
    const previous: AIChatLineRange | undefined = runs[runs.length - 1];

    if (previous && previous.last === line - 1) {
      previous.last = line;
    } else {
      runs.push(range(line, line));
    }
  }

  return runs;
};

describe("every file, against the serializer's rules", () => {
  test("written back as shown: said exactly when a value was hidden; with the values left alone or taken out: never", async () => {
    const random: SeededRandom = seededRandom(63641);
    const repository: FakeGitRepository = makeRepository({
      files: { "fix/login": {} },
    });
    serveOnGitHub(repository);

    let said: number = 0;
    let withOwnPlaceholders: number = 0;
    let multiLine: number = 0;
    const placeholdersSeen: Set<string> = new Set<string>();

    for (let round: number = 0; round < 150; round++) {
      const filePath: string = `src/round${round}.ts`;
      const file: DrawnFile = drawFile(random);
      const content: string = `${file.lines.join("\n")}\n`;
      // Each round's file alone on the branch, so the host's head stays small to hash.
      repository.branches.set("fix/login", new Map([[filePath, content]]));

      const conversation: Conversation = new Conversation(GITHUB_CONTEXT);
      const read: ToolExecutionResult = await conversation.read(filePath, {
        branchName: "fix/login",
      });

      // No value drawn reaches the model.
      for (const secret of file.secrets) {
        expect({
          round,
          secret,
          shown: read.dataForLlm.includes(secret),
        }).toEqual({
          round,
          secret,
          shown: false,
        });
      }

      const shown: string = writtenFrom(read.dataForLlm, true);

      // The note names exactly the lines that held a value, and every placeholder it reads there.
      const note: string | null = hiddenNoteOf(read.dataForLlm);
      expect({ round, noted: note !== null }).toEqual({
        round,
        noted: file.valueLines.size > 0,
      });

      if (note) {
        expect({ round, note }).toEqual({
          round,
          note: expect.stringContaining(
            `hidden from you on ${describeLineRanges(runsOf(file.valueLines))}, as `,
          ),
        });

        for (const written of placeholdersRisen(shown, content)) {
          expect({ round, names: note.includes(written.placeholder) }).toEqual({
            round,
            names: true,
          });
        }
      }
      const plain: number | undefined =
        file.plainLines[random(Math.max(1, file.plainLines.length))];
      const edit: (text: string) => string = (text: string): string => {
        if (plain === undefined) {
          return `${text}let edited;\n`;
        }

        const lines: Array<string> = text.split("\n");
        const original: string = file.lines[plain - 1]!;
        const at: number = lines.indexOf(original);

        lines[at === -1 ? 0 : at] = `${original} let edited;`;

        return lines.join("\n");
      };

      // Written back whole as shown, one plain line changed.
      const fromTheRead: string = edit(shown);
      const prepared: PreparedMutation = await conversation.propose(
        CommitCodeToBranchTool,
        commit("fix/login", [{ filePath, content: fromTheRead }]),
      );
      const findings: Array<CodeFileUnseenFinding> =
        proposedOnOf(prepared)!.unseen;
      const expected: Array<CodeFilePlaceholderWritten> = placeholdersRisen(
        fromTheRead,
        content,
      );

      expect({ round, said: findings.length > 0 }).toEqual({
        round,
        said: file.valueLines.size > 0,
      });
      expect({ round, findings }).toEqual({
        round,
        findings:
          expected.length > 0
            ? [
                {
                  filePath,
                  unseen: CodeFileUnseen.ValuesHidden,
                  placeholdersWritten: expected,
                },
              ]
            : [],
      });

      if (findings.length > 0) {
        said++;
        expect(cardOf(CommitCodeToBranchTool, prepared).line).toBe(
          `Values that look like secrets or personal data were hidden from Ask AI, and its version of this file writes placeholders in their place: ${filePath}.`,
        );
        expect(prepared.notRunWithoutApproval!.summary).toBe(
          CODE_UNSEEN_SUMMARIES[CodeChangeKind.Commit][
            CodeFileUnseen.ValuesHidden
          ],
        );

        for (const written of expected) {
          placeholdersSeen.add(written.placeholder);
        }
      }

      if (
        file.lines.some((line: string) => {
          return OWN_PLACEHOLDER_LINES.includes(line);
        })
      ) {
        withOwnPlaceholders++;
      }

      if (
        file.lines.some((line: string) => {
          return line.startsWith("-----BEGIN");
        })
      ) {
        multiLine++;
      }

      // Written as the branch has it, one plain line changed: every value left alone.
      expect({
        round,
        card: Object.keys(
          await conversation.propose(
            CommitCodeToBranchTool,
            commit("fix/login", [{ filePath, content: edit(content) }]),
          ),
        ),
      }).toEqual({ round, card: ["arguments"] });

      // Written as shown, without the lines that held values: nothing written over a hidden one.
      const withoutValues: string = shown
        .split("\n")
        .filter((line: string): boolean => {
          return !REDACTION_PLACEHOLDERS.some(
            (placeholder: string): boolean => {
              return (
                line.includes(placeholder) &&
                !OWN_PLACEHOLDER_LINES.includes(line)
              );
            },
          );
        })
        .join("\n");
      const withoutPrepared: PreparedMutation = await conversation.propose(
        CommitCodeToBranchTool,
        commit("fix/login", [{ filePath, content: withoutValues }]),
      );

      expect({
        round,
        valuesHidden: (proposedOnOf(withoutPrepared)?.unseen || []).some(
          (finding: CodeFileUnseenFinding): boolean => {
            return finding.unseen === CodeFileUnseen.ValuesHidden;
          },
        ),
      }).toEqual({ round, valuesHidden: false });
    }

    // The draws reach every case, many times, and every rule's placeholder.
    expect(said).toBeGreaterThan(80);
    expect(withOwnPlaceholders).toBeGreaterThan(30);
    expect(multiLine).toBeGreaterThan(20);
    expect(Array.from(placeholdersSeen).sort()).toEqual(
      [...REDACTION_PLACEHOLDERS].sort(),
    );
  });
});

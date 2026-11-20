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
import logger from "../../../../Server/Utils/Logger";
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
} from "../../../../Types/AI/AIActionWords";
import { CODE_CHANGE_PROPOSED_ON_KEY } from "../../../../Types/CodeRepository/CodeChangeProposedOnKey";
import {
  CodeChangeProposedOn,
  CodeFileUnseen,
  CodeFileUnseenFinding,
  readCodeChangeProposedOn,
} from "../../../../Types/CodeRepository/CodeFileSeen";
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
 * ISSUES #6364 AND #6388, THROUGH THE REAL TOOLS.
 *
 * read_code_file shows what looks like a secret or personal data as a
 * placeholder - "10.0.0.12" reads "[redacted-ip]", "ops@acme.com" reads
 * "[redacted-email]" - and a commit writes the file whole, from what the
 * model was shown: a model that changes one line of config/servers.ts
 * writes "[redacted-ip]" where every address was. So:
 *
 *   - the model reads exactly the redaction it always read, a private key
 *     block never cut by its window, and is told which lines had values
 *     hidden and that a line it keeps exactly as shown has its value
 *     written back;
 *   - each line kept exactly as shown, that no other line of the file
 *     reads like with another value, is written as the file has it, in the
 *     version the commit is held to - for that commit of that file only
 *     (#6388): the card says nothing, and Auto-run makes the change;
 *   - a placeholder that cannot be written back - a line the model changed,
 *     two lines that read the same, a new file - is named on the card
 *     before anyone approves; in Auto-run the change is not made (#6364);
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

// The values config/servers.ts holds: never anywhere but its commit.
const HIDDEN_IN_SERVERS_VALUES: Array<string> = [
  "10.0.0.12",
  "10.0.0.13",
  "ops@acme.com",
];

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

/*
 * A line with a placeholder the model changed (issue #6388): it no longer
 * reads as shown, so its value is never written back - it may no longer
 * belong there - and the placeholder stays.
 */
const primaryEdited: (written: string) => string = (
  written: string,
): string => {
  return written.replace(
    'PRIMARY_HOST = "[redacted-ip]";',
    'PRIMARY_HOST = "[redacted-ip]"; // the main one',
  );
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

  test("the note says which lines, as what, and that a line kept exactly as shown has its value written back", async () => {
    serveOnGitHub(repositoryWithServers());

    const answer: string = (
      await new Conversation(GITHUB_CONTEXT).read(SERVERS, {
        branchName: "fix/login",
      })
    ).dataForLlm;

    expect(hiddenNoteOf(answer)).toBe(
      "… [values that look like secrets or personal data are hidden from you on lines 1-3, as [redacted-ip] and [redacted-email]. A commit or pull request writes this file whole: keep each of those lines exactly as you see it here, and OneUptime writes its value back as the file has it. Do not change those lines, and never write a placeholder anywhere else: OneUptime cannot write a value back there, so the change would put the placeholder where a real value belongs. If one of those lines needs to change, leave that change to a person.]",
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
  test("before anyone approves, the card says nothing: every value is written back", async () => {
    const repository: FakeGitRepository = repositoryWithServers();
    serveOnGitHub(repository);
    const conversation: Conversation = new Conversation(GITHUB_CONTEXT);

    const read: ToolExecutionResult = await conversation.read(SERVERS, {
      branchName: "fix/login",
    });
    const args: JSONObject = commit("fix/login", [
      {
        filePath: SERVERS,
        content: retriesFive(writtenFrom(read.dataForLlm, true)),
      },
    ]);
    const prepared: PreparedMutation = await conversation.propose(
      CommitCodeToBranchTool,
      args,
    );

    expect(Object.keys(prepared)).toEqual(["arguments"]);
    expect(cardOf(CommitCodeToBranchTool, prepared)).toEqual({
      title: "Commit 1 file to fix/login",
      line: undefined,
    });
    // A commit's card still says how many files it writes (issue #6331).
    expect(drawnCard(CommitCodeToBranchTool, prepared.arguments)).toEqual(
      drawnCard(CommitCodeToBranchTool, args),
    );
    expect(repository.commits).toEqual([]);
  });

  test("in Auto-run nothing holds it back", async () => {
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

    expect(prepared.notRunWithoutApproval).toBeUndefined();
    expect(prepared.description).toBeUndefined();
  });

  test("what the card was shown on is the file as the branch had it, and nothing of its values", async () => {
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
      unseen: [],
    });
    // Never the values themselves: the arguments keep the model's version.
    for (const value of HIDDEN_IN_SERVERS_VALUES) {
      expect(JSON.stringify(prepared)).not.toContain(value);
    }
    expect(JSON.stringify(prepared)).toContain("[redacted-ip]");
  });

  test("committed with the real values, as the file has them: only the line changed differs", async () => {
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
    const result: ToolExecutionResult = await conversation.run(
      CommitCodeToBranchTool,
      prepared,
    );

    expect(repository.commits).toHaveLength(1);
    expect(repository.branches.get("fix/login")!.get(SERVERS)).toBe(
      SERVERS_ON_BRANCH.replace("RETRIES = 3;", "RETRIES = 5;"),
    );
    // Only the commit holds them: not the tool's result, nor what it keeps of the file.
    for (const value of HIDDEN_IN_SERVERS_VALUES) {
      expect(JSON.stringify(result)).not.toContain(value);
      expect(JSON.stringify(prepared.arguments)).not.toContain(value);
    }
  });

  test("Ask AI then knows the file as it was committed: the next change of it says nothing", async () => {
    serveOnGitHub(repositoryWithServers());
    const conversation: Conversation = new Conversation(GITHUB_CONTEXT);

    const read: ToolExecutionResult = await conversation.read(SERVERS, {
      branchName: "fix/login",
    });
    const shown: string = writtenFrom(read.dataForLlm, true);

    await conversation.run(
      CommitCodeToBranchTool,
      await conversation.propose(
        CommitCodeToBranchTool,
        commit("fix/login", [
          { filePath: SERVERS, content: retriesFive(shown) },
        ]),
      ),
    );

    // Written from what it wrote, one more line changed: never "changed since read".
    const next: PreparedMutation = await conversation.propose(
      CommitCodeToBranchTool,
      commit("fix/login", [
        {
          filePath: SERVERS,
          content: retriesFive(shown).replace("RETRIES = 5;", "RETRIES = 6;"),
        },
      ]),
    );

    expect(Object.keys(next)).toEqual(["arguments"]);
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

describe("every redaction rule: a value of its kind, kept as the model was shown it, is written back", () => {
  test.each(VALUES_OF_EVERY_RULE)(
    "%s",
    async (_kind: string, valueLines: Array<string>, placeholder: string) => {
      const filePath: string = "src/settings.ts";
      const content: string = [
        "// settings",
        ...valueLines,
        "export const RETRIES = 3;",
        "",
      ].join("\n");
      const repository: FakeGitRepository = makeRepository({
        files: { "fix/login": { [filePath]: content } },
      });
      serveOnGitHub(repository);
      const conversation: Conversation = new Conversation(GITHUB_CONTEXT);

      const read: ToolExecutionResult = await conversation.read(filePath, {
        branchName: "fix/login",
      });
      const written: string = retriesFive(writtenFrom(read.dataForLlm, true));
      const prepared: PreparedMutation = await conversation.propose(
        CommitCodeToBranchTool,
        commit("fix/login", [{ filePath, content: written }]),
      );

      // The model was shown the placeholder, was told, and wrote it back as shown.
      expect(hiddenNoteOf(read.dataForLlm)).toContain(`as ${placeholder}.`);
      expect(written).toContain(placeholder);
      expect(REDACTION_PLACEHOLDERS).toContain(placeholder);

      // Nothing on the card; committed with the value as the file has it.
      expect(Object.keys(prepared)).toEqual(["arguments"]);
      await conversation.run(CommitCodeToBranchTool, prepared);
      expect(repository.branches.get("fix/login")!.get(filePath)).toBe(
        retriesFive(content),
      );
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

/*
 * ---------------------------------------------------------------------------
 * Issue #6388: what is written back, and what is not. A line of the model's
 * version is written as the file has it only when it reads exactly as
 * read_code_file shows one text of that same file, in the version the
 * commit is held to, and no other text of the file reads the same.
 * ---------------------------------------------------------------------------
 */

// A file on fix/login, read whole by a new conversation: the model's view of it, and the repository.
const readWhole: (data: { filePath: string; content: string }) => Promise<{
  repository: FakeGitRepository;
  conversation: Conversation;
  shown: string;
}> = async (data: {
  filePath: string;
  content: string;
}): Promise<{
  repository: FakeGitRepository;
  conversation: Conversation;
  shown: string;
}> => {
  const repository: FakeGitRepository = makeRepository({
    files: {
      "fix/login": { [data.filePath]: data.content, "README.md": "# app\n" },
    },
  });
  serveOnGitHub(repository);
  const conversation: Conversation = new Conversation(GITHUB_CONTEXT);
  const read: ToolExecutionResult = await conversation.read(data.filePath, {
    branchName: "fix/login",
  });

  return {
    repository,
    conversation,
    shown: writtenFrom(read.dataForLlm, data.content.endsWith("\n")),
  };
};

describe("issue #6388: what is written back, and what is not", () => {
  test("an interface's password: string, kept as shown and another line changed: committed with password: string", async () => {
    const filePath: string = "src/login.ts";
    const content: string = [
      "interface Login {",
      "  user: string;",
      "  password: string;",
      "}",
      "export const RETRIES = 3;",
      "",
    ].join("\n");
    const { repository, conversation, shown } = await readWhole({
      filePath,
      content,
    });

    expect(shown).toContain("  password: [redacted];");

    const prepared: PreparedMutation = await conversation.propose(
      CommitCodeToBranchTool,
      commit("fix/login", [{ filePath, content: retriesFive(shown) }]),
    );

    expect(Object.keys(prepared)).toEqual(["arguments"]);
    await conversation.run(CommitCodeToBranchTool, prepared);
    expect(repository.branches.get("fix/login")!.get(filePath)).toBe(
      retriesFive(content),
    );
  });

  test("the same mask on two lines with two values: neither written back, and the card says so; approved anyway, every other value is", async () => {
    const filePath: string = "config/hosts.ts";
    const content: string = [
      'host = "10.0.0.1"',
      'host = "10.0.0.2"',
      'owner = "ops@acme.com"',
      "export const RETRIES = 3;",
      "",
    ].join("\n");
    const { repository, conversation, shown } = await readWhole({
      filePath,
      content,
    });

    expect(shown.split("\n").slice(0, 2)).toEqual([
      'host = "[redacted-ip]"',
      'host = "[redacted-ip]"',
    ]);

    const prepared: PreparedMutation = await conversation.propose(
      CommitCodeToBranchTool,
      commit("fix/login", [{ filePath, content: retriesFive(shown) }]),
    );

    expect(cardOf(CommitCodeToBranchTool, prepared).line).toBe(
      `Values that look like secrets or personal data were hidden from Ask AI, and its version of this file writes placeholders in their place: ${filePath}.`,
    );
    expect(proposedOnOf(prepared)!.unseen).toEqual([
      {
        filePath,
        unseen: CodeFileUnseen.ValuesHidden,
        placeholdersWritten: [
          {
            placeholder: "[redacted-ip]",
            written: 2,
            onBranch: 0,
            lines: [range(1, 2)],
          },
        ],
      },
    ]);
    expect(prepared.notRunWithoutApproval!.toldModel).toContain(
      `if such a line needs to change, or reads the same as another, leave the change to ${filePath} to a person`,
    );

    await conversation.run(CommitCodeToBranchTool, prepared);
    // As the card said: the two addresses' placeholders; the address's value back.
    expect(repository.branches.get("fix/login")!.get(filePath)).toBe(
      [
        'host = "[redacted-ip]"',
        'host = "[redacted-ip]"',
        'owner = "ops@acme.com"',
        "export const RETRIES = 5;",
        "",
      ].join("\n"),
    );
  });

  test("the same mask on two lines with one value: both written back", async () => {
    const filePath: string = "config/hosts.ts";
    const content: string = [
      'primary = "10.0.0.1"',
      "",
      'primary = "10.0.0.1"',
      "export const RETRIES = 3;",
      "",
    ].join("\n");
    const { repository, conversation, shown } = await readWhole({
      filePath,
      content,
    });

    const prepared: PreparedMutation = await conversation.propose(
      CommitCodeToBranchTool,
      commit("fix/login", [{ filePath, content: retriesFive(shown) }]),
    );

    expect(Object.keys(prepared)).toEqual(["arguments"]);
    await conversation.run(CommitCodeToBranchTool, prepared);
    expect(repository.branches.get("fix/login")!.get(filePath)).toBe(
      retriesFive(content),
    );
  });

  test("lines moved: each value goes with its line", async () => {
    const { repository, conversation, shown } = await readWhole({
      filePath: SERVERS,
      content: SERVERS_ON_BRANCH,
    });
    const reorder: (lines: string) => string = (lines: string): string => {
      const [primary, backup, onCall, retries]: Array<string> =
        lines.split("\n");

      return [onCall, retries, backup, primary, ""].join("\n");
    };

    const prepared: PreparedMutation = await conversation.propose(
      CommitCodeToBranchTool,
      commit("fix/login", [{ filePath: SERVERS, content: reorder(shown) }]),
    );

    expect(Object.keys(prepared)).toEqual(["arguments"]);
    await conversation.run(CommitCodeToBranchTool, prepared);
    expect(repository.branches.get("fix/login")!.get(SERVERS)).toBe(
      reorder(SERVERS_ON_BRANCH),
    );
  });

  test("a line copied exactly as shown takes the same value, in the same file", async () => {
    const { repository, conversation, shown } = await readWhole({
      filePath: SERVERS,
      content: SERVERS_ON_BRANCH,
    });
    const copied: (text: string, line: string) => string = (
      text: string,
      line: string,
    ): string => {
      return `${text}${line.replace("ON_CALL", "ESCALATE_TO")}\n`;
    };

    const prepared: PreparedMutation = await conversation.propose(
      CommitCodeToBranchTool,
      commit("fix/login", [
        {
          filePath: SERVERS,
          content: copied(shown, 'export const ON_CALL = "[redacted-email]";'),
        },
      ]),
    );

    // Renamed, the copy is a changed line: its placeholder stays, and the card says so.
    expect(cardOf(CommitCodeToBranchTool, prepared).line).toBe(
      HIDDEN_IN_SERVERS,
    );

    const exact: PreparedMutation = await conversation.propose(
      CommitCodeToBranchTool,
      commit("fix/login", [
        {
          filePath: SERVERS,
          content: `${shown}export const ON_CALL = "[redacted-email]";\n`,
        },
      ]),
    );

    expect(Object.keys(exact)).toEqual(["arguments"]);
    await conversation.run(CommitCodeToBranchTool, exact);
    expect(repository.branches.get("fix/login")!.get(SERVERS)).toBe(
      `${SERVERS_ON_BRANCH}export const ON_CALL = "ops@acme.com";\n`,
    );
  });

  test("a masked line edited keeps its placeholder: the card names that line only, and Auto-run does not make it", async () => {
    const { repository, conversation, shown } = await readWhole({
      filePath: SERVERS,
      content: SERVERS_ON_BRANCH,
    });

    const prepared: PreparedMutation = await conversation.propose(
      CommitCodeToBranchTool,
      commit("fix/login", [
        { filePath: SERVERS, content: primaryEdited(retriesFive(shown)) },
      ]),
    );

    expect(cardOf(CommitCodeToBranchTool, prepared).line).toBe(
      HIDDEN_IN_SERVERS,
    );
    expect(proposedOnOf(prepared)!.unseen[0]!.placeholdersWritten).toEqual([
      {
        placeholder: "[redacted-ip]",
        written: 1,
        onBranch: 0,
        lines: [range(1, 1)],
      },
    ]);
    expect(prepared.notRunWithoutApproval!.toldModel).toContain(
      `- ${SERVERS}: your version writes [redacted-ip] on line 1.`,
    );
    expect(repository.commits).toEqual([]);
  });

  test("a private key block, shown as one placeholder, is written back whole; a placeholder after it is named on the model's own line", async () => {
    const filePath: string = "src/keys.ts";
    const content: string = [
      "export const KEY = `",
      "-----BEGIN RSA PRIVATE KEY-----",
      "MIIEowIBAAKCAQEAx",
      "qwertyuiopasdfgh",
      "-----END RSA PRIVATE KEY-----",
      "`;",
      'export const HOST = "10.0.0.7";',
      "export const RETRIES = 3;",
      "",
    ].join("\n");
    const { repository, conversation, shown } = await readWhole({
      filePath,
      content,
    });

    expect(shown.split("\n").slice(0, 4)).toEqual([
      "export const KEY = `",
      "[redacted-private-key]",
      "`;",
      'export const HOST = "[redacted-ip]";',
    ]);

    // The host's line changed: the key goes back whole, the host's placeholder stays, on line 4.
    const edited: PreparedMutation = await conversation.propose(
      CommitCodeToBranchTool,
      commit("fix/login", [
        {
          filePath,
          content: retriesFive(shown).replace(
            'HOST = "[redacted-ip]";',
            'HOST = "[redacted-ip]"; // edge',
          ),
        },
      ]),
    );

    expect(proposedOnOf(edited)!.unseen[0]!.placeholdersWritten).toEqual([
      {
        placeholder: "[redacted-ip]",
        written: 1,
        onBranch: 0,
        lines: [range(4, 4)],
      },
    ]);

    const prepared: PreparedMutation = await conversation.propose(
      CommitCodeToBranchTool,
      commit("fix/login", [{ filePath, content: retriesFive(shown) }]),
    );

    expect(Object.keys(prepared)).toEqual(["arguments"]);
    await conversation.run(CommitCodeToBranchTool, prepared);
    expect(repository.branches.get("fix/login")!.get(filePath)).toBe(
      retriesFive(content),
    );
  });

  test("two private key blocks show the same: neither is written back", async () => {
    const filePath: string = "src/keys.ts";
    const block: (body: string) => Array<string> = (
      body: string,
    ): Array<string> => {
      return ["-----BEGIN PRIVATE KEY-----", body, "-----END PRIVATE KEY-----"];
    };
    const content: string = [
      ...block("Zmlyc3Qga2V5IGJvZHk"),
      ...block("c2Vjb25kIGtleSBib2R5"),
      "export const RETRIES = 3;",
      "",
    ].join("\n");
    const { conversation, shown } = await readWhole({ filePath, content });

    const prepared: PreparedMutation = await conversation.propose(
      CommitCodeToBranchTool,
      commit("fix/login", [{ filePath, content: retriesFive(shown) }]),
    );

    expect(proposedOnOf(prepared)!.unseen[0]!.placeholdersWritten).toEqual([
      {
        placeholder: "[redacted-private-key]",
        written: 2,
        onBranch: 0,
        lines: [range(1, 2)],
      },
    ]);
  });

  test("a Windows file: each line written back, ending as the model ended it", async () => {
    const filePath: string = "config/servers.ps1";
    const content: string =
      '$Primary = "10.0.0.12"\r\n$Retries = 3\r\n$OnCall = "ops@acme.com"\r\n';
    const { repository, conversation, shown } = await readWhole({
      filePath,
      content,
    });

    // The model writes Unix line endings.
    const unix: string = shown.replace(/\r/g, "").replace("= 3", "= 5");
    const prepared: PreparedMutation = await conversation.propose(
      CommitCodeToBranchTool,
      commit("fix/login", [{ filePath, content: unix }]),
    );

    expect(Object.keys(prepared)).toEqual(["arguments"]);
    await conversation.run(CommitCodeToBranchTool, prepared);
    expect(repository.branches.get("fix/login")!.get(filePath)).toBe(
      '$Primary = "10.0.0.12"\n$Retries = 5\n$OnCall = "ops@acme.com"\n',
    );

    // Its own line endings kept, as it wrote them.
    const windows: string = shown.replace("= 3", "= 7");
    repository.branches.get("fix/login")!.set(filePath, content);
    const again: Conversation = new Conversation(GITHUB_CONTEXT);
    await again.read(filePath, { branchName: "fix/login" });
    await again.run(
      CommitCodeToBranchTool,
      await again.propose(
        CommitCodeToBranchTool,
        commit("fix/login", [{ filePath, content: windows }]),
      ),
    );
    expect(repository.branches.get("fix/login")!.get(filePath)).toBe(
      content.replace("= 3", "= 7"),
    );
  });

  test("a value never goes into another file: copied into a new file, its placeholder stays, and the card says so", async () => {
    const { repository, conversation, shown } = await readWhole({
      filePath: SERVERS,
      content: SERVERS_ON_BRANCH,
    });

    const prepared: PreparedMutation = await conversation.propose(
      CommitCodeToBranchTool,
      commit("fix/login", [
        { filePath: SERVERS, content: retriesFive(shown) },
        { filePath: "config/servers.prod.ts", content: shown },
      ]),
    );

    expect(cardOf(CommitCodeToBranchTool, prepared).line).toBe(
      "Values that look like secrets or personal data were hidden from Ask AI, and its version of this file writes placeholders in their place: config/servers.prod.ts.",
    );

    await conversation.run(CommitCodeToBranchTool, prepared);

    // Each file's values from itself: the copy has none of its own, so it keeps the placeholders.
    expect(repository.branches.get("fix/login")!.get(SERVERS)).toBe(
      retriesFive(SERVERS_ON_BRANCH),
    );
    expect(
      repository.branches.get("fix/login")!.get("config/servers.prod.ts"),
    ).toBe(shown);
    for (const value of HIDDEN_IN_SERVERS_VALUES) {
      expect(
        repository.branches.get("fix/login")!.get("config/servers.prod.ts"),
      ).not.toContain(value);
    }
  });

  test("the file changed after the card was shown: nothing committed, and the refusal holds no value", async () => {
    const { repository, conversation, shown } = await readWhole({
      filePath: SERVERS,
      content: SERVERS_ON_BRANCH,
    });
    const prepared: PreparedMutation = await conversation.propose(
      CommitCodeToBranchTool,
      commit("fix/login", [{ filePath: SERVERS, content: retriesFive(shown) }]),
    );

    push(
      repository,
      "fix/login",
      SERVERS,
      SERVERS_ON_BRANCH.replace("10.0.0.13", "10.0.0.99"),
    );

    const failure: Error = await conversation
      .run(CommitCodeToBranchTool, prepared)
      .then(
        (): Error => {
          return new Error("committed");
        },
        (error: Error): Error => {
          return error;
        },
      );

    expect(failure.message).toContain(
      "Nothing was committed: config/servers.ts changed on fix/login after this commit was shown for approval",
    );
    expect(repository.commits).toEqual([]);
    for (const value of [...HIDDEN_IN_SERVERS_VALUES, "10.0.0.99"]) {
      expect(failure.message).not.toContain(value);
    }
  });

  test("pushed between the approval's read of the version and the read of its text: nothing committed, never values of another version", async () => {
    const { repository, conversation, shown } = await readWhole({
      filePath: SERVERS,
      content: SERVERS_ON_BRANCH,
    });
    const prepared: PreparedMutation = await conversation.propose(
      CommitCodeToBranchTool,
      commit("fix/login", [{ filePath: SERVERS, content: retriesFive(shown) }]),
    );

    // Right after the approval reads the version, a teammate pushes.
    let pushed: boolean = false;
    repository.afterVersionRead = (filePath: string): void => {
      if (!pushed && filePath === SERVERS) {
        pushed = true;
        push(
          repository,
          "fix/login",
          SERVERS,
          SERVERS_ON_BRANCH.replace("10.0.0.13", "10.0.0.99"),
        );
      }
    };

    const failure: Error = await conversation
      .run(CommitCodeToBranchTool, prepared)
      .then(
        (): Error => {
          return new Error("committed");
        },
        (error: Error): Error => {
          return error;
        },
      );

    expect(pushed).toBe(true);
    expect(failure.message).toBe(
      `Nothing was committed: OneUptime could not write back the values hidden from you in ${SERVERS} as the file on fix/login has them, so committing it would put placeholders where those values are. Read each of them again with read_code_file and branchName "fix/login", keep each line with a placeholder exactly as you are shown it, and propose the commit again.`,
    );
    expect(repository.commits).toEqual([]);
  });

  test("its text cannot be read again after the card said nothing: nothing committed", async () => {
    const { repository, conversation, shown } = await readWhole({
      filePath: SERVERS,
      content: SERVERS_ON_BRANCH,
    });
    const prepared: PreparedMutation = await conversation.propose(
      CommitCodeToBranchTool,
      commit("fix/login", [{ filePath: SERVERS, content: retriesFive(shown) }]),
    );

    expect(Object.keys(prepared)).toEqual(["arguments"]);
    repository.textUnreadable.set(SERVERS, "GitHub answered 502.");

    await expect(
      conversation.run(CommitCodeToBranchTool, prepared),
    ).rejects.toThrow(
      `Nothing was committed: OneUptime could not write back the values hidden from you in ${SERVERS}`,
    );
    expect(repository.commits).toEqual([]);
  });

  test("a pull request that can no longer write its values back opens nothing, not even its branch", async () => {
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
    const branches: number = repository.branches.size;

    repository.textUnreadable.set(SERVERS, "GitHub answered 502.");

    await expect(
      conversation.run(OpenCodePullRequestTool, prepared),
    ).rejects.toThrow(
      `No pull request was opened: OneUptime could not write back the values hidden from you in ${SERVERS} as the file on main has them`,
    );
    expect(repository.branches.size).toBe(branches);
    expect(repository.pullRequests).toEqual([]);
  });

  test("no value reaches a log, the arguments or the tool's result, from the card to the commit", async () => {
    const logged: Array<unknown> = [];
    for (const level of ["debug", "info", "warn", "error"] as const) {
      jest.spyOn(logger, level).mockImplementation(((
        ...args: Array<unknown>
      ): void => {
        logged.push(args);
      }) as never);
    }

    try {
      await expectNoValueOutsideTheCommit(logged);
    } finally {
      jest.restoreAllMocks();
    }
  });

  const expectNoValueOutsideTheCommit: (
    logged: Array<unknown>,
  ) => Promise<void> = async (logged: Array<unknown>): Promise<void> => {
    const { repository, conversation, shown } = await readWhole({
      filePath: SERVERS,
      content: SERVERS_ON_BRANCH,
    });
    const prepared: PreparedMutation = await conversation.propose(
      CommitCodeToBranchTool,
      commit("fix/login", [{ filePath: SERVERS, content: retriesFive(shown) }]),
    );
    const result: ToolExecutionResult = await conversation.run(
      CommitCodeToBranchTool,
      prepared,
    );

    // Committed, with the values ...
    expect(repository.branches.get("fix/login")!.get(SERVERS)).toBe(
      retriesFive(SERVERS_ON_BRANCH),
    );
    // ... and nowhere else.
    const everythingElse: string = JSON.stringify([
      logged,
      prepared,
      result,
      conversation.records,
    ]);
    for (const value of HIDDEN_IN_SERVERS_VALUES) {
      expect(everythingElse).not.toContain(value);
    }
  };
});

describe("issue #6388: read_code_file never shows part of a private key block", () => {
  const KEY_BODY: Array<string> = [
    "S2V5Qm9keUxpbmVPbmVJc05vdEFSZWFsS2V5QnV0SXRMb29rc0xpa2VPbmU",
    "S2V5Qm9keUxpbmVUd29Jc05vdEFSZWFsS2V5QnV0SXRMb29rc0xpa2VPbmU",
    "S2V5Qm9keUxpbmVUaHJlZUlzTm90QVJlYWxLZXlCdXRJdExvb2tzTGlrZU8",
  ];

  // A file of `lines` lines with a key block from line `at`: header, body, footer.
  const fileWithKeyAt: (at: number, lines: number, width?: number) => string = (
    at: number,
    lines: number,
    width: number = 10,
  ): string => {
    const all: Array<string> = [];

    while (all.length < lines) {
      if (all.length + 1 === at) {
        all.push(
          "-----BEGIN RSA PRIVATE KEY-----",
          ...KEY_BODY,
          "-----END RSA PRIVATE KEY-----",
        );
        continue;
      }

      all.push(`const v${all.length + 1} = 1;`.padEnd(width, " "));
    }

    return `${all.join("\n")}\n`;
  };

  const readOf: (
    content: string,
    args?: JSONObject,
  ) => Promise<ToolExecutionResult> = async (
    content: string,
    args?: JSONObject,
  ): Promise<ToolExecutionResult> => {
    serveOnGitHub(
      makeRepository({ files: { main: { "src/key.ts": content } } }),
    );

    return await new Conversation(GITHUB_CONTEXT).read("src/key.ts", args);
  };

  const expectNoKey: (answer: string) => void = (answer: string): void => {
    for (const line of KEY_BODY) {
      expect(answer).not.toContain(line);
    }
  };

  test("the 400 lines a read shows end inside a block: the read goes on to its footer", async () => {
    const answer: string = (await readOf(fileWithKeyAt(398, 600))).dataForLlm;

    expectNoKey(answer);
    expect(answer).toContain("showing lines 1-402 of 600");
    expect(answer).toContain("398| [redacted-private-key]");
    expect(answer).toContain("call again with startLine=403 to read on");
  });

  test("the byte budget ends inside a block: the read goes on to its footer", async () => {
    // Lines of 118 characters: the 12 KB budget ends on line 100, the block's first line of key.
    const answer: string = (await readOf(fileWithKeyAt(99, 300, 118)))
      .dataForLlm;

    expectNoKey(answer);
    expect(answer).toContain(" 99| [redacted-private-key]");
    expect(answer).toMatch(/showing lines 1-103 of 300/);
  });

  test("a startLine inside a block starts at its header", async () => {
    const answer: string = (
      await readOf(fileWithKeyAt(20, 60), { startLine: 22, endLine: 40 })
    ).dataForLlm;

    expectNoKey(answer);
    expect(answer).toContain("showing lines 20-40 of 60");
    expect(answer).toContain("20| [redacted-private-key]");
  });

  test("an endLine inside a block ends at its footer", async () => {
    const answer: string = (
      await readOf(fileWithKeyAt(20, 60), { startLine: 1, endLine: 21 })
    ).dataForLlm;

    expectNoKey(answer);
    expect(answer).toContain("showing lines 1-24 of 60");
  });

  test("a window inside a block, and one around a line in it, show the block whole", async () => {
    for (const args of [
      { startLine: 21, endLine: 23 },
      { aroundLine: 22 },
    ] as Array<JSONObject>) {
      const answer: string = (await readOf(fileWithKeyAt(20, 200), args))
        .dataForLlm;

      expectNoKey(answer);
      expect(answer).toContain("20| [redacted-private-key]");
    }
  });

  test("any window of a file with blocks, drawn from a seed: never a line of a key", async () => {
    const random: SeededRandom = seededRandom(6388);
    const content: string = [
      fileWithKeyAt(5, 30).trimEnd(),
      fileWithKeyAt(3, 25).trimEnd(),
      fileWithKeyAt(10, 40).trimEnd(),
    ].join("\n");
    const lines: number = content.split("\n").length;

    serveOnGitHub(
      makeRepository({ files: { main: { "src/key.ts": content } } }),
    );

    for (let round: number = 0; round < 60; round++) {
      const startLine: number = 1 + random(lines);
      const endLine: number = startLine + random(lines - startLine + 1);
      const answer: string = (
        await new Conversation(GITHUB_CONTEXT).read(
          "src/key.ts",
          random(2) === 0 ? { startLine, endLine } : { aroundLine: startLine },
        )
      ).dataForLlm;

      for (const line of KEY_BODY) {
        expect({
          round,
          startLine,
          endLine,
          shown: answer.includes(line),
        }).toEqual({ round, startLine, endLine, shown: false });
      }
    }
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

  const MIXED: string = [
    'test("an address", () => {',
    '  expect(redact("host 10.0.0.1")).toBe("host [redacted-ip]");',
    "});",
    "",
  ].join("\n");

  const readMixed: () => Promise<{
    repository: FakeGitRepository;
    conversation: Conversation;
    shown: string;
  }> = async (): Promise<{
    repository: FakeGitRepository;
    conversation: Conversation;
    shown: string;
  }> => {
    const repository: FakeGitRepository = makeRepository({
      files: { "fix/login": { "Tests/Redact.test.ts": MIXED } },
    });
    serveOnGitHub(repository);
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

    return {
      repository,
      conversation,
      shown: writtenFrom(read.dataForLlm, true),
    };
  };

  test("beside a value hidden in it, kept as shown: written back, the file's own placeholder with it", async () => {
    const { repository, conversation, shown } = await readMixed();

    const prepared: PreparedMutation = await conversation.propose(
      CommitCodeToBranchTool,
      commit("fix/login", [
        {
          filePath: "Tests/Redact.test.ts",
          content: shown.replace('"an address"', '"an IP address"'),
        },
      ]),
    );

    expect(Object.keys(prepared)).toEqual(["arguments"]);
    await conversation.run(CommitCodeToBranchTool, prepared);
    expect(
      repository.branches.get("fix/login")!.get("Tests/Redact.test.ts"),
    ).toBe(MIXED.replace('"an address"', '"an IP address"'));
  });

  test("beside a value hidden in it, the line changed: said, with how many the file holds itself", async () => {
    const { conversation, shown } = await readMixed();

    const prepared: PreparedMutation = await conversation.propose(
      CommitCodeToBranchTool,
      commit("fix/login", [
        {
          filePath: "Tests/Redact.test.ts",
          content: shown.replace('toBe("host', 'toBe("server'),
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
  test("changed since the read, its lines kept as shown: only the change is said; approved, the values are the ones the branch has now", async () => {
    const repository: FakeGitRepository = repositoryWithServers();
    serveOnGitHub(repository);
    const conversation: Conversation = new Conversation(GITHUB_CONTEXT);

    const read: ToolExecutionResult = await conversation.read(SERVERS, {
      branchName: "fix/login",
    });
    // A teammate moves the backup host: the model never saw either address.
    const moved: string = SERVERS_ON_BRANCH.replace("10.0.0.13", "10.0.0.99");
    push(repository, "fix/login", SERVERS, moved);

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
      `This file changed on fix/login after Ask AI read it, and Ask AI's version undoes that change: ${SERVERS}.`,
    ]);
    expect(prepared.notRunWithoutApproval!.summary).toBe(
      CODE_UNSEEN_SUMMARIES[CodeChangeKind.Commit][
        CodeFileUnseen.ChangedSinceRead
      ],
    );

    // Approved anyway: each value as the branch has it now, never the one before.
    await conversation.run(CommitCodeToBranchTool, prepared);
    expect(repository.branches.get("fix/login")!.get(SERVERS)).toBe(
      retriesFive(moved),
    );
  });

  test("changed since the read and a line with a placeholder changed: two lines, the placeholders first, and the model told both", async () => {
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
          content: primaryEdited(
            retriesFive(writtenFrom(read.dataForLlm, true)),
          ),
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
    expect(told[1]).toBe(
      `- ${SERVERS}: your version writes [redacted-ip] on line 1. These are placeholders for values hidden from you, and the file on fix/login does not hold them.`,
    );
    expect(told[2]).toBe(
      `- ${SERVERS} changed on fix/login after you last read it there.`,
    );
    expect(told.join("\n")).toContain(
      'Read each of these files on fix/login with read_code_file and branchName "fix/login"',
    );
    expect(told.join("\n")).toContain(
      "OneUptime writes a hidden value back only on a line you keep exactly as read_code_file showed it",
    );
    expect(
      proposedOnOf(prepared)!.unseen.map((finding: CodeFileUnseenFinding) => {
        return finding.unseen;
      }),
    ).toEqual([CodeFileUnseen.ValuesHidden, CodeFileUnseen.ChangedSinceRead]);
  });

  test("read only in part and a line with a placeholder changed: both lines", async () => {
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
    const written: string = writtenFrom(read.dataForLlm, true);

    // Kept as shown, only the part it read is said.
    expect(
      (
        await conversation.propose(
          CommitCodeToBranchTool,
          commit("fix/login", [{ filePath: SERVERS, content: written }]),
        )
      ).description!.map((sentence: AIActionSentence) => {
        return sentence.template;
      }),
    ).toEqual([AI_ACTION_PLURAL_LINES.codeFilesReadInPart.other]);

    const prepared: PreparedMutation = await conversation.propose(
      CommitCodeToBranchTool,
      commit("fix/login", [
        {
          filePath: SERVERS,
          content: written.replace(
            'const HOST = "[redacted-ip]";',
            'const HOST = "[redacted-ip]"; // the host',
          ),
        },
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

  test("five files, a line with a placeholder changed in each: one line, three named and the rest counted; the model told every one", async () => {
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
        content: writtenFrom(read.dataForLlm, true).replace(
          "HOST =",
          "API_HOST =",
        ),
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
      "leave the change to config/a.ts, config/b.ts, config/c.ts, config/d.ts and config/e.ts to a person",
    );
  });
});

describe("open_code_pull_request, written with placeholders on the default branch", () => {
  test("kept as shown: nothing on the card, Auto-run opens it, and its branch holds the real values, no note for the reviewer", async () => {
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

    expect(Object.keys(prepared)).toEqual(["arguments"]);
    expect(cardOf(OpenCodePullRequestTool, prepared)).toEqual({
      title: "Open pull request: More retries",
      line: undefined,
    });

    const result: ToolExecutionResult = await conversation.run(
      OpenCodePullRequestTool,
      prepared,
    );

    expect(repository.pullRequests).toHaveLength(1);
    const head: string = repository.pullRequests[0]!.headBranchName;
    expect(repository.branches.get(head)!.get(SERVERS)).toBe(
      retriesFive(SERVERS_ON_BRANCH),
    );
    // The base is left alone, and the reviewer is told nothing of values.
    expect(repository.branches.get("main")!.get(SERVERS)).toBe(
      SERVERS_ON_BRANCH,
    );
    expect(repository.pullRequests[0]!.body).not.toContain("Check these files");
    for (const value of HIDDEN_IN_SERVERS_VALUES) {
      expect(JSON.stringify(result)).not.toContain(value);
      expect(repository.pullRequests[0]!.body).not.toContain(value);
    }
  });

  test("a line changed: the card names it; Auto-run does not open it; approved anyway, its reviewer is told where the placeholder is", async () => {
    const repository: FakeGitRepository = repositoryWithServers();
    serveOnGitHub(repository);
    const conversation: Conversation = new Conversation(GITHUB_CONTEXT);

    const read: ToolExecutionResult = await conversation.read(SERVERS);
    const prepared: PreparedMutation = await conversation.propose(
      OpenCodePullRequestTool,
      pullRequest([
        {
          filePath: SERVERS,
          content: primaryEdited(
            retriesFive(writtenFrom(read.dataForLlm, true)),
          ),
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
        `- \`${SERVERS}\`: AI's version writes \`[redacted-ip]\` on line 1, placeholders for values hidden from AI, where the real values belong.`,
      ].join("\n"),
    );
    // The other lines' values written back on its branch.
    expect(
      repository.branches
        .get(repository.pullRequests[0]!.headBranchName)!
        .get(SERVERS),
    ).toBe(
      primaryEdited(
        retriesFive(
          SERVERS_ON_BRANCH.replace(
            'PRIMARY_HOST = "10.0.0.12";',
            'PRIMARY_HOST = "[redacted-ip]";',
          ),
        ),
      ),
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
    "%s: kept as shown, written back and committed; a line changed, the card says so",
    async (_host: string, serve: () => void) => {
      gitlabOrForgejo = repositoryWithServers();
      serve();
      const conversation: Conversation = new Conversation(CONNECTED_CONTEXT);

      const read: ToolExecutionResult = await conversation.read(SERVERS, {
        branchName: "fix/login",
      });
      expect(hiddenNoteOf(read.dataForLlm)).toContain("on lines 1-3");
      const shown: string = retriesFive(writtenFrom(read.dataForLlm, true));

      expect(
        cardOf(
          CommitCodeToBranchTool,
          await conversation.propose(
            CommitCodeToBranchTool,
            commit("fix/login", [
              { filePath: SERVERS, content: primaryEdited(shown) },
            ]),
          ),
        ).line,
      ).toBe(HIDDEN_IN_SERVERS);

      const prepared: PreparedMutation = await conversation.propose(
        CommitCodeToBranchTool,
        commit("fix/login", [{ filePath: SERVERS, content: shown }]),
      );

      expect(Object.keys(prepared)).toEqual(["arguments"]);
      await conversation.run(CommitCodeToBranchTool, prepared);
      expect(gitlabOrForgejo.branches.get("fix/login")!.get(SERVERS)).toBe(
        retriesFive(SERVERS_ON_BRANCH),
      );
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
 *   - written back whole as it was shown, one plain line changed: every
 *     value written back, and the commit exactly the file as it was with
 *     that one line changed (issue #6388) - unless two lines with different
 *     values read the same, which an oracle reads off the draw: then said,
 *     and nothing committed in Auto-run;
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
  /*
   * What was drawn, in order - a plain line, a value (its lines, joined),
   * the file's own placeholder text - each of which a read shows as one
   * line (issue #6388): a private key block as one placeholder.
   */
  items: Array<{ isValue: boolean; text: string }>;
}

const drawFile: (random: SeededRandom) => DrawnFile = (
  random: SeededRandom,
): DrawnFile => {
  const file: DrawnFile = {
    lines: [],
    valueLines: new Set(),
    secrets: [],
    plainLines: [],
    items: [],
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
      file.items.push({ isValue: false, text });
    } else if (kind < 9) {
      const value: DrawnValue = VALUES[random(VALUES.length)]!(random);

      for (const line of value.lines) {
        file.lines.push(line);
        file.valueLines.add(file.lines.length);
      }

      file.secrets.push(...value.secrets);
      file.items.push({ isValue: true, text: value.lines.join("\n") });
    } else {
      const own: string =
        OWN_PLACEHOLDER_LINES[random(OWN_PLACEHOLDER_LINES.length)]!;

      file.lines.push(own);
      file.items.push({ isValue: false, text: own });
    }
  }

  return file;
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
  test("written back as shown, one plain line changed: committed as the file was with that line changed, unless two lines read the same; with the values left alone or taken out: never said", async () => {
    const random: SeededRandom = seededRandom(63881);
    const repository: FakeGitRepository = makeRepository({
      files: { "fix/login": {} },
    });
    serveOnGitHub(repository);

    let writtenBack: number = 0;
    let ambiguous: number = 0;
    let withOwnPlaceholders: number = 0;
    let multiLine: number = 0;
    const placeholdersBack: Set<string> = new Set<string>();

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

      // The note names exactly the lines that held a value.
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
      }

      /*
       * The oracle: each thing drawn is one line of what the model was
       * shown - a key block too - so the lines that read alike, and what
       * each stood for, are read off the draw itself.
       */
      const shownLines: Array<string> = shown.split("\n").slice(0, -1);
      expect({ round, lines: shownLines.length }).toEqual({
        round,
        lines: file.items.length,
      });

      const standsFor: Map<string, Set<string>> = new Map<
        string,
        Set<string>
      >();

      file.items.forEach(
        (item: { isValue: boolean; text: string }, index: number): void => {
          const line: string = shownLines[index]!;

          if (
            REDACTION_PLACEHOLDERS.some((placeholder: string): boolean => {
              return line.includes(placeholder);
            })
          ) {
            standsFor.set(
              line,
              new Set([...(standsFor.get(line) || []), item.text]),
            );
          }
        },
      );

      const isAmbiguous: boolean = Array.from(standsFor.values()).some(
        (texts: Set<string>): boolean => {
          return texts.size > 1;
        },
      );
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
      const prepared: PreparedMutation = await conversation.propose(
        CommitCodeToBranchTool,
        commit("fix/login", [{ filePath, content: edit(shown) }]),
      );
      const valuesHidden: boolean = (proposedOnOf(prepared)?.unseen || []).some(
        (finding: CodeFileUnseenFinding): boolean => {
          return finding.unseen === CodeFileUnseen.ValuesHidden;
        },
      );

      expect({ round, said: valuesHidden }).toEqual({
        round,
        said: isAmbiguous,
      });

      if (isAmbiguous) {
        ambiguous++;
        expect(cardOf(CommitCodeToBranchTool, prepared).line).toBe(
          `Values that look like secrets or personal data were hidden from Ask AI, and its version of this file writes placeholders in their place: ${filePath}.`,
        );
        expect(prepared.notRunWithoutApproval!.summary).toBe(
          CODE_UNSEEN_SUMMARIES[CodeChangeKind.Commit][
            CodeFileUnseen.ValuesHidden
          ],
        );
      } else {
        // Nothing on the card: committed last in the round, below.
        expect({ round, card: Object.keys(prepared) }).toEqual({
          round,
          card: ["arguments"],
        });
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

      // Unless two lines read the same: committed as the file was, that one line changed.
      if (!isAmbiguous) {
        await conversation.run(CommitCodeToBranchTool, prepared);
        expect({
          round,
          committed: repository.branches.get("fix/login")!.get(filePath),
        }).toEqual({ round, committed: edit(content) });

        if (file.valueLines.size > 0) {
          writtenBack++;

          for (const line of standsFor.keys()) {
            for (const placeholder of REDACTION_PLACEHOLDERS) {
              if (line.includes(placeholder)) {
                placeholdersBack.add(placeholder);
              }
            }
          }
        }
      }
    }

    // The draws reach every case, many times, and every rule's placeholder is written back.
    expect(writtenBack).toBeGreaterThan(40);
    expect(ambiguous).toBeGreaterThan(20);
    expect(withOwnPlaceholders).toBeGreaterThan(30);
    expect(multiLine).toBeGreaterThan(20);
    expect(Array.from(placeholdersBack).sort()).toEqual(
      [...REDACTION_PLACEHOLDERS].sort(),
    );
  });
});

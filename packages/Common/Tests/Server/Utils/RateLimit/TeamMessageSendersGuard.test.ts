import { listProductFiles } from "../../../Helpers/CodeScanning";
import { REPOSITORY_DIRECTORY } from "../../../Helpers/TagStripScan";
import { TeamMessageKind } from "../../../../Server/Utils/RateLimit/PublicMessageRateLimit";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import ts from "typescript";

/*
 * EVERY MESSAGE THE TEAM SENDS TO A CONTACT IT NAMES IS COUNTED FIRST.
 *
 * A subscriber the team adds is sent its confirmation email or its "you have
 * been subscribed" message, and a person it invites - to its project or to a
 * private status page - an invitation, each from this installation's mail
 * server or SMS sender. PublicMessageRateLimit.assertTeamMaySend counts each
 * such contact; the services that send are driven in
 * TeamSubscriberMessageLimits.test.ts and InvitationMessageLimits.test.ts.
 * This guard holds the wiring, read from the code with its comments
 * removed:
 *
 *  - each sender asks, for its own kind, in the hook named here - before the
 *    write the message goes out after, or before the account an invitation
 *    makes and the email it sends;
 *  - the emails these sends are made of are sent from these services only,
 *    so a new path that sends one is listed here, with its ask;
 *  - nothing else asks, and every kind is asked for.
 */

interface TeamSender {
  file: string;
  // The method that asks.
  asksIn: string;
  kind: TeamMessageKind;
  // Calls in the asking method that must come after its ask.
  after: Array<string>;
  // The method a create that failed before sending gives the count back in.
  givesBackIn?: string | undefined;
}

const SUBSCRIBER_SERVICE: string =
  "packages/Common/Server/Services/StatusPageSubscriberService.ts";
const TEAM_MEMBER_SERVICE: string =
  "packages/Common/Server/Services/TeamMemberService.ts";
const PRIVATE_USER_SERVICE: string =
  "packages/Common/Server/Services/StatusPagePrivateUserService.ts";

const TEAM_SENDERS: Array<TeamSender> = [
  {
    // Asked after every check of the create, right before its INSERT.
    file: SUBSCRIBER_SERVICE,
    asksIn: "onCreatePermitted",
    kind: TeamMessageKind.SubscriberAdded,
    after: [],
    givesBackIn: "onCreateError",
  },
  {
    // Asked before the invitee's account is made, and before the email.
    file: TEAM_MEMBER_SERVICE,
    asksIn: "onBeforeCreate",
    kind: TeamMessageKind.Invitation,
    after: ["UserService.createByEmail(", "MailService.sendMail("],
  },
  {
    file: PRIVATE_USER_SERVICE,
    asksIn: "onCreatePermitted",
    kind: TeamMessageKind.Invitation,
    after: [],
    givesBackIn: "onCreateError",
  },
];

/*
 * The emails the team's sends are made of, and the one file that may send
 * each. A subscriber's confirmation and welcome go out from its service
 * alone - to a sign-up and to a subscriber the team adds alike.
 */
const TEAM_EMAILS: Record<string, string> = {
  "EmailTemplateType.InviteMember": TEAM_MEMBER_SERVICE,
  "EmailTemplateType.StatusPageWelcomeEmail": PRIVATE_USER_SERVICE,
  "EmailTemplateType.ConfirmStatusPageSubscription": SUBSCRIBER_SERVICE,
  "EmailTemplateType.SubscribedToStatusPage": SUBSCRIBER_SERVICE,
};

const ASKS: string = "PublicMessageRateLimit.assertTeamMaySend(";
const CODE_FILE: RegExp = /\.(?:ts|tsx)$/;

function sourceOf(relativePath: string): ts.SourceFile {
  return ts.createSourceFile(
    path.basename(relativePath),
    fs.readFileSync(path.join(REPOSITORY_DIRECTORY, relativePath), "utf8"),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
}

// A node's code, its comments removed by TypeScript's own printer.
function codeOf(node: ts.Node, sourceFile: ts.SourceFile): string {
  return ts
    .createPrinter({ removeComments: true })
    .printNode(ts.EmitHint.Unspecified, node, sourceFile);
}

function methodCode(file: string, name: string): string {
  const sourceFile: ts.SourceFile = sourceOf(file);
  let found: ts.MethodDeclaration | undefined = undefined;

  const visit: (node: ts.Node) => void = (node: ts.Node): void => {
    if (
      ts.isMethodDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === name
    ) {
      found = node;
      return;
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);

  if (!found) {
    throw new Error(`${file}: no method ${name}`);
  }

  return codeOf(found, sourceFile);
}

function fileCode(file: string): string {
  const sourceFile: ts.SourceFile = sourceOf(file);
  return codeOf(sourceFile, sourceFile);
}

function occurrences(code: string, text: string): number {
  return code.split(text).length - 1;
}

function kindNameOf(kind: TeamMessageKind): string {
  return Object.keys(TeamMessageKind).find((key: string): boolean => {
    return TeamMessageKind[key as keyof typeof TeamMessageKind] === kind;
  })!;
}

// What is wrong with one sender's wiring, in words.
function wiringProblems(code: string, sender: TeamSender): Array<string> {
  const problems: Array<string> = [];
  const ask: number = code.indexOf(ASKS);

  if (ask === -1) {
    return [`${sender.asksIn} does not ask`];
  }

  if (occurrences(code, ASKS) !== 1) {
    problems.push(`${sender.asksIn} asks ${occurrences(code, ASKS)} times`);
  }

  if (
    !code
      .slice(ask, ask + 200)
      .includes(`kind: TeamMessageKind.${kindNameOf(sender.kind)},`)
  ) {
    problems.push(`${sender.asksIn} asks for another kind`);
  }

  for (const call of sender.after) {
    const at: number = code.indexOf(call);

    if (at === -1) {
      problems.push(`${call} is not in ${sender.asksIn}`);
    } else if (at < ask) {
      problems.push(`${call} comes before the ask`);
    }
  }

  return problems;
}

describe("every sender of the team's messages asks first, for its own kind", () => {
  test.each(
    TEAM_SENDERS.map((sender: TeamSender): [string, TeamSender] => {
      return [`${sender.file} ${sender.asksIn}`, sender];
    }),
  )("%s", (_name: string, sender: TeamSender) => {
    expect(
      wiringProblems(methodCode(sender.file, sender.asksIn), sender),
    ).toEqual([]);
  });

  test.each(
    TEAM_SENDERS.filter((sender: TeamSender): boolean => {
      return Boolean(sender.givesBackIn);
    }).map((sender: TeamSender): [string, TeamSender] => {
      return [`${sender.file} ${sender.givesBackIn}`, sender];
    }),
  )(
    "%s gives the count back when nothing was sent",
    (_name: string, sender: TeamSender) => {
      const code: string = methodCode(sender.file, sender.givesBackIn!);

      expect(code).toContain(".giveBack()");
      expect(code).toContain("isSending");
    },
  );

  test("the subscriber service and the private user service mark their creates as sending as onCreateSuccess starts", () => {
    for (const file of [SUBSCRIBER_SERVICE, PRIVATE_USER_SERVICE]) {
      const code: string = methodCode(file, "onCreateSuccess");
      const marked: number = code.indexOf("isSending = true");

      expect([file, marked > -1]).toEqual([file, true]);

      // Before anything is sent.
      for (const send of [
        "MailService.sendMail(",
        "this.sendText(",
        "SmsService.sendSms(",
      ]) {
        const at: number = code.indexOf(send);

        if (at > -1) {
          expect([file, send, at > marked]).toEqual([file, send, true]);
        }
      }
    }
  });
});

describe("the team's emails go out from their services only", () => {
  const productFiles: Array<string> = listProductFiles(REPOSITORY_DIRECTORY, [
    "packages",
    "ee",
  ]).filter((relativePath: string): boolean => {
    return CODE_FILE.test(relativePath);
  });

  test.each(Object.entries(TEAM_EMAILS))(
    "%s is sent from %s alone",
    (template: string, sender: string) => {
      const senders: Array<string> = productFiles.filter(
        (relativePath: string): boolean => {
          const text: string = fs.readFileSync(
            path.join(REPOSITORY_DIRECTORY, relativePath),
            "utf8",
          );

          return (
            text.includes(template) && fileCode(relativePath).includes(template)
          );
        },
      );

      // The enum's own file names every template; it sends nothing.
      expect(
        senders.filter((relativePath: string): boolean => {
          return !relativePath.endsWith("Types/Email/EmailTemplateType.ts");
        }),
      ).toEqual([sender]);
    },
  );
});

describe("nothing else asks, and every kind is asked for", () => {
  test("the files that ask are the senders listed here", () => {
    const askers: Array<string> = listProductFiles(REPOSITORY_DIRECTORY, [
      "packages",
      "ee",
    ])
      .filter((relativePath: string): boolean => {
        return CODE_FILE.test(relativePath);
      })
      .filter((relativePath: string): boolean => {
        return fs
          .readFileSync(path.join(REPOSITORY_DIRECTORY, relativePath), "utf8")
          .includes(ASKS);
      })
      .filter((relativePath: string): boolean => {
        return fileCode(relativePath).includes(ASKS);
      });

    expect(askers.sort()).toEqual(
      Array.from(
        new Set<string>(
          TEAM_SENDERS.map((sender: TeamSender): string => {
            return sender.file;
          }),
        ),
      ).sort(),
    );
  });

  test("each listed file asks only from its listed method", () => {
    for (const file of new Set<string>(
      TEAM_SENDERS.map((sender: TeamSender): string => {
        return sender.file;
      }),
    )) {
      const inFile: number = occurrences(fileCode(file), ASKS);
      const inMethods: number = TEAM_SENDERS.filter(
        (sender: TeamSender): boolean => {
          return sender.file === file;
        },
      ).reduce((total: number, sender: TeamSender): number => {
        return total + occurrences(methodCode(file, sender.asksIn), ASKS);
      }, 0);

      expect([file, inFile]).toEqual([file, inMethods]);
    }
  });

  test("every kind is a listed sender's", () => {
    expect(
      Array.from(
        new Set<string>(
          TEAM_SENDERS.map((sender: TeamSender): string => {
            return sender.kind;
          }),
        ),
      ).sort(),
    ).toEqual(Object.values(TeamMessageKind).sort());
  });
});

describe("the guard's own reading", () => {
  const sender: TeamSender = {
    file: "x.ts",
    asksIn: "invite",
    kind: TeamMessageKind.Invitation,
    after: ["createAccount(", "sendMail("],
  };

  const ask: (kind: string) => string = (kind: string): string => {
    return `await PublicMessageRateLimit.assertTeamMaySend({\n  kind: TeamMessageKind.${kind},\n  contacts: [contact],\n});\n`;
  };

  test("passes a method that asks first, for its own kind", () => {
    expect(
      wiringProblems(
        `${ask("Invitation")}createAccount();\nsendMail();`,
        sender,
      ),
    ).toEqual([]);
  });

  test("fails a method that sends before it asks, or asks for another kind, or not at all", () => {
    expect(
      wiringProblems(
        `createAccount();\n${ask("Invitation")}sendMail();`,
        sender,
      ),
    ).toEqual(["createAccount( comes before the ask"]);
    expect(
      wiringProblems(
        `${ask("SubscriberAdded")}createAccount();\nsendMail();`,
        sender,
      ),
    ).toEqual(["invite asks for another kind"]);
    expect(wiringProblems("createAccount();\nsendMail();", sender)).toEqual([
      "invite does not ask",
    ]);
  });

  test("reads code, not the comments around it", () => {
    const sourceFile: ts.SourceFile = ts.createSourceFile(
      "x.ts",
      "function f() {\n  // PublicMessageRateLimit.assertTeamMaySend(\n  return 1;\n}\n",
      ts.ScriptTarget.Latest,
      true,
    );

    expect(codeOf(sourceFile, sourceFile)).not.toContain(ASKS);
  });
});

import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import {
  ServerChannelStatus,
  ServerSendingChannel,
  ServerSendingState,
} from "../../../Types/ServerSending/ServerSendingStatus";
import ServerSetupChecklistUtil, {
  FINISHED_SERVER_SETUP_STATUSES,
  SERVER_SETUP_ADMIN_PATHS,
  SERVER_SETUP_CHECKED_WORDS,
  SERVER_SETUP_CHECKS,
  SERVER_SETUP_GUIDES,
  SERVER_SETUP_STATUS_WORDS,
  ServerSetupCheckDefinition,
  ServerSetupCheckId,
  ServerSetupCheckResult,
  ServerSetupCheckTier,
  ServerSetupChecklistAnswer,
  ServerSetupChoiceKind,
  ServerSetupChoices,
  ServerSetupFacts,
  ServerSetupStatus,
} from "../../../Types/ServerSetup/ServerSetupChecklist";
import { getTemplatePlaceholders } from "../../../Types/Translator";
import { seededRandom, SeededRandom } from "../../Helpers/SeededRandom";

/*
 * WHAT A NEW SERVER NEEDS, AS PURE RULES (#6824).
 *
 * Every check of the server's setup checklist is decided from facts the
 * server reads - never from a form being filled in:
 *
 *   - Email is done once an email the server sent through its own settings
 *     was accepted since they were last saved (#6825's "working"); set up
 *     and untested, or failing, is not done;
 *   - HTTPS once HTTP_PROTOCOL=https; sign-ups once they are off, or an
 *     admin chose to keep them open;
 *   - SMS and calls once every channel that is set up has worked, or an
 *     admin chose email and push only - a choice that counts only while
 *     nothing is set up;
 *   - a probe once a global probe reports; backups once the last backup
 *     the server made succeeded, or an admin confirmed one; update checks
 *     while on and not failing;
 *   - browser push, an LLM provider and single sign-on: optional.
 *
 * The card counts required checks only, and "Hide" lasts until a required
 * check opens that was not open then. What is stored and what a browser
 * reads back are held to the catalogue: a choice a check does not allow is
 * neither made nor read.
 */

const NOW: Date = new Date("2026-11-11T10:00:00.000Z");

// A Markdown heading line of a docs page.
const HEADING_LINE: RegExp = /^#{1,6} /;
const EARLIER: string = "2026-11-10T09:30:00.000Z";

function channel(
  name: ServerSendingChannel,
  state: ServerSendingState,
  overrides: Partial<ServerChannelStatus> = {},
): ServerChannelStatus {
  return {
    channel: name,
    state: state,
    hasWorked: state === ServerSendingState.Working,
    lastWorkedAt: state === ServerSendingState.Working ? EARLIER : null,
    failingSince: state === ServerSendingState.Failing ? EARLIER : null,
    lastFailure:
      state === ServerSendingState.Failing ? "535 Authentication failed" : null,
    setUpProblem:
      state === ServerSendingState.NotSetUp
        ? "Nothing is set up under Settings > Emails yet."
        : null,
    ...overrides,
  };
}

// A server that has just started: nothing set up, nothing chosen.
function freshFacts(
  overrides: Partial<ServerSetupFacts> = {},
): ServerSetupFacts {
  return {
    isHttpsSetUp: false,
    areSignupsClosed: false,
    email: channel(ServerSendingChannel.Email, ServerSendingState.NotSetUp),
    sms: channel(ServerSendingChannel.SMS, ServerSendingState.NotSetUp),
    call: channel(ServerSendingChannel.Call, ServerSendingState.NotSetUp),
    emailSentThrough: null,
    smsSentThrough: "Twilio",
    callSentThrough: "Twilio",
    globalProbes: { total: 1, reporting: 0 },
    updateChecks: { isDisabled: false, lastCheckedAt: null, lastFailure: null },
    lastBackup: null,
    hasScheduledBackups: false,
    isBrowserPushSetUp: false,
    hasAiProvider: false,
    hasSingleSignOn: false,
    choices: { choices: {}, hiddenBy: {} },
    ...overrides,
  };
}

// A server with everything done.
function finishedFacts(): ServerSetupFacts {
  return freshFacts({
    isHttpsSetUp: true,
    areSignupsClosed: true,
    email: channel(ServerSendingChannel.Email, ServerSendingState.Working),
    sms: channel(ServerSendingChannel.SMS, ServerSendingState.Working),
    call: channel(ServerSendingChannel.Call, ServerSendingState.Working),
    emailSentThrough: "smtp.example.com",
    globalProbes: { total: 1, reporting: 1 },
    updateChecks: {
      isDisabled: false,
      lastCheckedAt: EARLIER,
      lastFailure: null,
    },
    lastBackup: { succeeded: true, finishedAt: EARLIER, error: null },
    isBrowserPushSetUp: true,
    hasAiProvider: true,
    hasSingleSignOn: true,
  });
}

function chose(
  check: ServerSetupCheckId,
  kind: ServerSetupChoiceKind,
): ServerSetupChoices {
  return {
    choices: {
      [check]: { kind: kind, at: EARLIER, byUserId: "user-1" },
    },
    hiddenBy: {},
  };
}

function check(
  facts: ServerSetupFacts,
  id: ServerSetupCheckId,
): ServerSetupCheckResult {
  return ServerSetupChecklistUtil.evaluate(facts).find(
    (result: ServerSetupCheckResult) => {
      return result.id === id;
    },
  )!;
}

describe("the catalogue", () => {
  test("every check, once, in the order it matters: required, recommended, optional", () => {
    expect(
      SERVER_SETUP_CHECKS.map((definition: ServerSetupCheckDefinition) => {
        return definition.id;
      }),
    ).toEqual([
      ServerSetupCheckId.Email,
      ServerSetupCheckId.Https,
      ServerSetupCheckId.Signups,
      ServerSetupCheckId.SmsAndCalls,
      ServerSetupCheckId.Probes,
      ServerSetupCheckId.Backups,
      ServerSetupCheckId.UpdateChecks,
      ServerSetupCheckId.BrowserPush,
      ServerSetupCheckId.AiProvider,
      ServerSetupCheckId.SingleSignOn,
    ]);

    const tiers: Array<ServerSetupCheckTier> = SERVER_SETUP_CHECKS.map(
      (definition: ServerSetupCheckDefinition) => {
        return definition.tier;
      },
    );

    expect(tiers).toEqual([
      ServerSetupCheckTier.Required,
      ServerSetupCheckTier.Required,
      ServerSetupCheckTier.Required,
      ServerSetupCheckTier.Recommended,
      ServerSetupCheckTier.Recommended,
      ServerSetupCheckTier.Recommended,
      ServerSetupCheckTier.Recommended,
      ServerSetupCheckTier.Optional,
      ServerSetupCheckTier.Optional,
      ServerSetupCheckTier.Optional,
    ]);
  });

  test("each says where it is fixed: an Admin Dashboard page or a guide", () => {
    for (const definition of SERVER_SETUP_CHECKS) {
      expect({
        id: definition.id,
        hasFix: Boolean(definition.adminPath || definition.guidePath),
      }).toEqual({ id: definition.id, hasFix: true });
    }
  });

  test("only email, SMS and calls have test sends; only checks the server cannot decide alone take a choice", () => {
    const tested: Record<string, Array<ServerSendingChannel>> = {};
    const choices: Record<string, ServerSetupChoiceKind | null> = {};

    for (const definition of SERVER_SETUP_CHECKS) {
      if (definition.tests.length > 0) {
        tested[definition.id] = [...definition.tests];
      }
      choices[definition.id] = definition.choice;
    }

    expect(tested).toEqual({
      [ServerSetupCheckId.Email]: [ServerSendingChannel.Email],
      [ServerSetupCheckId.SmsAndCalls]: [
        ServerSendingChannel.SMS,
        ServerSendingChannel.Call,
      ],
    });
    expect(choices).toEqual({
      [ServerSetupCheckId.Email]: null,
      [ServerSetupCheckId.Https]: null,
      [ServerSetupCheckId.Signups]: ServerSetupChoiceKind.Skipped,
      [ServerSetupCheckId.SmsAndCalls]: ServerSetupChoiceKind.Skipped,
      [ServerSetupCheckId.Probes]: ServerSetupChoiceKind.Skipped,
      [ServerSetupCheckId.Backups]: ServerSetupChoiceKind.Confirmed,
      [ServerSetupCheckId.UpdateChecks]: ServerSetupChoiceKind.Skipped,
      [ServerSetupCheckId.BrowserPush]: null,
      [ServerSetupCheckId.AiProvider]: null,
      [ServerSetupCheckId.SingleSignOn]: null,
    });
  });

  test("every status a check can take has its line, with only the placeholders the page fills", () => {
    const random: SeededRandom = seededRandom(6824);
    const seen: Set<string> = new Set();

    // Every status each check takes, over many seeded servers.
    for (let i: number = 0; i < 3000; i++) {
      const states: Array<ServerSendingState> =
        Object.values(ServerSendingState);
      const pick: () => ServerSendingState = (): ServerSendingState => {
        return states[random(states.length)]!;
      };
      const facts: ServerSetupFacts = freshFacts({
        isHttpsSetUp: random(2) === 1,
        areSignupsClosed: random(2) === 1,
        email: channel(ServerSendingChannel.Email, pick()),
        sms: channel(ServerSendingChannel.SMS, pick()),
        call: channel(ServerSendingChannel.Call, pick()),
        globalProbes:
          random(3) === 0 ? null : { total: 2, reporting: random(3) },
        updateChecks: {
          isDisabled: random(3) === 0,
          lastCheckedAt: random(2) ? EARLIER : null,
          lastFailure: random(3) === 0 ? "unreachable" : null,
        },
        lastBackup:
          random(3) === 0
            ? null
            : {
                succeeded: random(2) === 1,
                finishedAt: EARLIER,
                error: "boom",
              },
        isBrowserPushSetUp: random(2) === 1,
        hasAiProvider: random(2) === 1,
        hasSingleSignOn: random(2) === 1,
        choices: {
          choices: Object.fromEntries(
            SERVER_SETUP_CHECKS.filter(
              (definition: ServerSetupCheckDefinition) => {
                return definition.choice && random(2) === 1;
              },
            ).map((definition: ServerSetupCheckDefinition) => {
              return [
                definition.id,
                { kind: definition.choice!, at: EARLIER, byUserId: null },
              ];
            }),
          ),
          hiddenBy: {},
        },
      });

      for (const result of ServerSetupChecklistUtil.evaluate(facts)) {
        seen.add(`${result.id}:${result.status}`);

        const words: string = ServerSetupChecklistUtil.getStatusWords(result);

        expect({
          id: result.id,
          status: result.status,
          hasWords: Boolean(words),
        }).toEqual({
          id: result.id,
          status: result.status,
          hasWords: true,
        });

        for (const placeholder of getTemplatePlaceholders(words)) {
          expect(["time"]).toContain(placeholder);
        }
      }
    }

    // And no line is written for a status no check takes.
    for (const [id, lines] of Object.entries(SERVER_SETUP_STATUS_WORDS)) {
      for (const status of Object.keys(lines)) {
        expect(seen.has(`${id}:${status}`)).toBe(true);
      }
    }
  });

  test("the checked-against lines fill only what the page hands them", () => {
    const allowed: Record<string, Array<string>> = {
      emailAccepted: ["sentThrough", "time"],
      smsAccepted: ["sentThrough", "time"],
      callAccepted: ["sentThrough", "time"],
      providerSaid: ["sentThrough", "reason"],
      lastBackup: ["time"],
      lastUpdateCheck: ["time"],
      chosenBy: ["name", "time"],
      chosenOn: ["time"],
    };

    for (const [key, template] of Object.entries(SERVER_SETUP_CHECKED_WORDS)) {
      expect(getTemplatePlaceholders(template).sort()).toEqual(
        [...allowed[key]!].sort(),
      );
    }
  });

  test("every Admin Dashboard page a check names is one of its routes", () => {
    const routeMap: string = fs.readFileSync(
      path.join(
        __dirname,
        "../../../../App/FeatureSet/AdminDashboard/src/Utils/RouteMap.ts",
      ),
      "utf8",
    );

    for (const adminPath of Object.values(SERVER_SETUP_ADMIN_PATHS)) {
      // Backups are the Enterprise Edition's page (ee/AdminDashboard/Backups).
      if (adminPath === SERVER_SETUP_ADMIN_PATHS.backups) {
        continue;
      }

      expect({
        adminPath,
        isRoute: new RegExp(
          `new Route\\(\\s*\`${adminPath}\`\\s*,?\\s*\\)`,
        ).test(routeMap),
      }).toEqual({ adminPath, isRoute: true });
    }
  });

  test("every guide a check opens is a docs page, at a heading it has", () => {
    const docs: string = path.join(
      __dirname,
      "../../../../App/FeatureSet/Docs/Content/en",
    );

    for (const guide of Object.values(SERVER_SETUP_GUIDES)) {
      const [page, anchor] = guide.replace("/docs/", "").split("#");
      const markdown: string = fs.readFileSync(
        path.join(docs, `${page}.md`),
        "utf8",
      );

      if (anchor) {
        const headings: Array<string> = markdown
          .split("\n")
          .filter((line: string) => {
            return HEADING_LINE.test(line);
          })
          .map((line: string) => {
            return line
              .replace(/^#+ /, "")
              .trim()
              .toLowerCase()
              .replace(/[^a-z0-9 -]/g, "")
              .replace(/ /g, "-");
          });

        expect({ guide, found: headings.includes(anchor) }).toEqual({
          guide,
          found: true,
        });
      }
    }
  });
});

describe("a server that has just started", () => {
  test("has every required check open, and the card counts them", () => {
    const answer: ServerSetupChecklistAnswer =
      ServerSetupChecklistUtil.getAnswer({
        facts: freshFacts(),
        readerUserId: "user-1",
      });

    expect(answer.openRequired).toEqual([
      ServerSetupCheckId.Email,
      ServerSetupCheckId.Https,
      ServerSetupCheckId.Signups,
    ]);
    expect(answer.isHiddenForReader).toBe(false);
    expect(
      answer.checks.map((result: ServerSetupCheckResult) => {
        return [result.id, result.status];
      }),
    ).toEqual([
      [ServerSetupCheckId.Email, ServerSetupStatus.NotSetUp],
      [ServerSetupCheckId.Https, ServerSetupStatus.NotSetUp],
      [ServerSetupCheckId.Signups, ServerSetupStatus.NotSetUp],
      [ServerSetupCheckId.SmsAndCalls, ServerSetupStatus.NotSetUp],
      [ServerSetupCheckId.Probes, ServerSetupStatus.NotSetUp],
      [ServerSetupCheckId.Backups, ServerSetupStatus.NotSetUp],
      [ServerSetupCheckId.UpdateChecks, ServerSetupStatus.Done],
      [ServerSetupCheckId.BrowserPush, ServerSetupStatus.NotSetUp],
      [ServerSetupCheckId.AiProvider, ServerSetupStatus.NotSetUp],
      [ServerSetupCheckId.SingleSignOn, ServerSetupStatus.NotSetUp],
    ]);
  });

  test("a finished server has nothing open, and every check is finished", () => {
    const answer: ServerSetupChecklistAnswer =
      ServerSetupChecklistUtil.getAnswer({
        facts: finishedFacts(),
        readerUserId: null,
      });

    expect(answer.openRequired).toEqual([]);
    expect(
      answer.checks.every((result: ServerSetupCheckResult) => {
        return result.isFinished;
      }),
    ).toBe(true);
  });
});

describe("Email: done when an email went out since the settings were saved", () => {
  test("not set up is open, says what is missing, and offers no test", () => {
    const result: ServerSetupCheckResult = check(
      freshFacts({
        email: channel(
          ServerSendingChannel.Email,
          ServerSendingState.NotSetUp,
          {
            setUpProblem: "SMTP: the Port is not set under Settings > Emails.",
          },
        ),
      }),
      ServerSetupCheckId.Email,
    );

    expect(result.status).toBe(ServerSetupStatus.NotSetUp);
    expect(result.isFinished).toBe(false);
    expect(result.reason).toBe(
      "SMTP: the Port is not set under Settings > Emails.",
    );
    expect(result.tests).toEqual([]);
  });

  test("set up but untested - the form filled in - is not done, and offers the test", () => {
    const result: ServerSetupCheckResult = check(
      freshFacts({
        email: channel(ServerSendingChannel.Email, ServerSendingState.Untested),
        emailSentThrough: "smtp.example.com",
      }),
      ServerSetupCheckId.Email,
    );

    expect(result.status).toBe(ServerSetupStatus.Untested);
    expect(result.isFinished).toBe(false);
    expect(result.tests).toEqual([ServerSendingChannel.Email]);
    expect(result.sentThrough).toBe("smtp.example.com");
  });

  test("working is done, with what accepted it and when", () => {
    const result: ServerSetupCheckResult = check(
      freshFacts({
        email: channel(ServerSendingChannel.Email, ServerSendingState.Working),
        emailSentThrough: "smtp.example.com",
      }),
      ServerSetupCheckId.Email,
    );

    expect(result.status).toBe(ServerSetupStatus.Done);
    expect(result.isFinished).toBe(true);
    expect(result.time).toBe(EARLIER);
    expect(result.sentThrough).toBe("smtp.example.com");
    expect(result.tests).toEqual([ServerSendingChannel.Email]);
  });

  test("failing is open, since when, in the mail server's words", () => {
    const result: ServerSetupCheckResult = check(
      freshFacts({
        email: channel(ServerSendingChannel.Email, ServerSendingState.Failing),
        emailSentThrough: "smtp.example.com",
      }),
      ServerSetupCheckId.Email,
    );

    expect(result.status).toBe(ServerSetupStatus.Failing);
    expect(result.isFinished).toBe(false);
    expect(result.time).toBe(EARLIER);
    expect(result.reason).toBe("535 Authentication failed");
  });

  test("cannot be skipped: no choice is offered or read", () => {
    const facts: ServerSetupFacts = freshFacts({
      choices: {
        choices: {
          [ServerSetupCheckId.Email]: {
            kind: ServerSetupChoiceKind.Skipped,
            at: EARLIER,
            byUserId: null,
          },
        },
        hiddenBy: {},
      },
    });

    const result: ServerSetupCheckResult = check(
      facts,
      ServerSetupCheckId.Email,
    );

    expect(result.status).toBe(ServerSetupStatus.NotSetUp);
    expect(result.canChoose).toBeNull();
    expect(result.choice).toBeNull();
  });
});

describe("HTTPS and sign-ups", () => {
  test("HTTPS is done once HTTP_PROTOCOL=https, and cannot be skipped", () => {
    expect(check(freshFacts(), ServerSetupCheckId.Https).status).toBe(
      ServerSetupStatus.NotSetUp,
    );
    expect(
      check(freshFacts({ isHttpsSetUp: true }), ServerSetupCheckId.Https)
        .status,
    ).toBe(ServerSetupStatus.Done);
    expect(check(freshFacts(), ServerSetupCheckId.Https).canChoose).toBeNull();
  });

  test("sign-ups are done once off, or once an admin chose to keep them open", () => {
    expect(check(freshFacts(), ServerSetupCheckId.Signups).status).toBe(
      ServerSetupStatus.NotSetUp,
    );
    expect(
      check(freshFacts({ areSignupsClosed: true }), ServerSetupCheckId.Signups)
        .status,
    ).toBe(ServerSetupStatus.Done);

    const keptOpen: ServerSetupCheckResult = check(
      freshFacts({
        choices: chose(
          ServerSetupCheckId.Signups,
          ServerSetupChoiceKind.Skipped,
        ),
      }),
      ServerSetupCheckId.Signups,
    );

    expect(keptOpen.status).toBe(ServerSetupStatus.Skipped);
    expect(keptOpen.isFinished).toBe(true);
    expect(keptOpen.choice?.byUserId).toBe("user-1");
    // Still undoable.
    expect(keptOpen.canChoose).toBe(ServerSetupChoiceKind.Skipped);
  });

  test("once sign-ups are off, the old choice is neither shown nor offered", () => {
    const result: ServerSetupCheckResult = check(
      freshFacts({
        areSignupsClosed: true,
        choices: chose(
          ServerSetupCheckId.Signups,
          ServerSetupChoiceKind.Skipped,
        ),
      }),
      ServerSetupCheckId.Signups,
    );

    expect(result.status).toBe(ServerSetupStatus.Done);
    expect(result.choice).toBeNull();
    expect(result.canChoose).toBeNull();
  });
});

describe("SMS and calls", () => {
  test("nothing set up is open, with the choice of email and push only", () => {
    const result: ServerSetupCheckResult = check(
      freshFacts(),
      ServerSetupCheckId.SmsAndCalls,
    );

    expect(result.status).toBe(ServerSetupStatus.NotSetUp);
    expect(result.canChoose).toBe(ServerSetupChoiceKind.Skipped);
    expect(result.tests).toEqual([]);
  });

  test("email and push only, chosen, is done while nothing is set up", () => {
    const result: ServerSetupCheckResult = check(
      freshFacts({
        choices: chose(
          ServerSetupCheckId.SmsAndCalls,
          ServerSetupChoiceKind.Skipped,
        ),
      }),
      ServerSetupCheckId.SmsAndCalls,
    );

    expect(result.status).toBe(ServerSetupStatus.Skipped);
    expect(result.isFinished).toBe(true);
    expect(result.choice?.kind).toBe(ServerSetupChoiceKind.Skipped);
  });

  test("once Twilio is set up, the real state decides, whatever was chosen", () => {
    const result: ServerSetupCheckResult = check(
      freshFacts({
        sms: channel(ServerSendingChannel.SMS, ServerSendingState.Untested),
        call: channel(ServerSendingChannel.Call, ServerSendingState.Untested),
        choices: chose(
          ServerSetupCheckId.SmsAndCalls,
          ServerSetupChoiceKind.Skipped,
        ),
      }),
      ServerSetupCheckId.SmsAndCalls,
    );

    expect(result.status).toBe(ServerSetupStatus.Untested);
    expect(result.isFinished).toBe(false);
    expect(result.choice).toBeNull();
    // A choice that would change nothing now is not offered.
    expect(result.canChoose).toBeNull();
    expect(result.tests).toEqual([
      ServerSendingChannel.SMS,
      ServerSendingChannel.Call,
    ]);
  });

  test("done only once every channel that is set up has worked", () => {
    expect(
      check(
        freshFacts({
          sms: channel(ServerSendingChannel.SMS, ServerSendingState.Working),
          call: channel(ServerSendingChannel.Call, ServerSendingState.Untested),
        }),
        ServerSetupCheckId.SmsAndCalls,
      ).status,
    ).toBe(ServerSetupStatus.Untested);

    expect(
      check(
        freshFacts({
          sms: channel(ServerSendingChannel.SMS, ServerSendingState.Working),
          call: channel(ServerSendingChannel.Call, ServerSendingState.Working),
        }),
        ServerSetupCheckId.SmsAndCalls,
      ).status,
    ).toBe(ServerSetupStatus.Done);
  });

  test("an account used for SMS only needs no calls: its SMS working is done, and only SMS is tested", () => {
    const result: ServerSetupCheckResult = check(
      freshFacts({
        sms: channel(ServerSendingChannel.SMS, ServerSendingState.Working),
        call: channel(ServerSendingChannel.Call, ServerSendingState.NotSetUp),
      }),
      ServerSetupCheckId.SmsAndCalls,
    );

    expect(result.status).toBe(ServerSetupStatus.Done);
    expect(result.tests).toEqual([ServerSendingChannel.SMS]);
  });

  test("failing wins, with what refused it and why", () => {
    const result: ServerSetupCheckResult = check(
      freshFacts({
        sms: channel(ServerSendingChannel.SMS, ServerSendingState.Working),
        call: channel(ServerSendingChannel.Call, ServerSendingState.Failing, {
          lastFailure: "The number is not verified.",
        }),
        callSentThrough: "sms-gateway.example.com",
      }),
      ServerSetupCheckId.SmsAndCalls,
    );

    expect(result.status).toBe(ServerSetupStatus.Failing);
    expect(result.reason).toBe("The number is not verified.");
    expect(result.sentThrough).toBe("sms-gateway.example.com");
    expect(result.time).toBe(EARLIER);
  });

  test("names what took each channel", () => {
    const result: ServerSetupCheckResult = check(
      freshFacts({
        sms: channel(ServerSendingChannel.SMS, ServerSendingState.Working),
        call: channel(ServerSendingChannel.Call, ServerSendingState.Working),
        smsSentThrough: "Twilio",
        callSentThrough: "Twilio",
      }),
      ServerSetupCheckId.SmsAndCalls,
    );

    expect(
      result.channels.map(
        (status: ServerChannelStatus & { sentThrough: string | null }) => {
          return [status.channel, status.sentThrough, status.lastWorkedAt];
        },
      ),
    ).toEqual([
      [ServerSendingChannel.SMS, "Twilio", EARLIER],
      [ServerSendingChannel.Call, "Twilio", EARLIER],
    ]);
  });
});

describe("probes, backups and update checks", () => {
  test("probes: done once a global probe reports; none reporting, or none at all, is open", () => {
    expect(
      check(
        freshFacts({ globalProbes: { total: 2, reporting: 1 } }),
        ServerSetupCheckId.Probes,
      ).status,
    ).toBe(ServerSetupStatus.Done);
    expect(
      check(
        freshFacts({ globalProbes: { total: 2, reporting: 0 } }),
        ServerSetupCheckId.Probes,
      ).status,
    ).toBe(ServerSetupStatus.NotSetUp);
    expect(
      check(freshFacts({ globalProbes: null }), ServerSetupCheckId.Probes)
        .status,
    ).toBe(ServerSetupStatus.NotSetUp);
    expect(
      check(
        freshFacts({
          globalProbes: null,
          choices: chose(
            ServerSetupCheckId.Probes,
            ServerSetupChoiceKind.Skipped,
          ),
        }),
        ServerSetupCheckId.Probes,
      ).status,
    ).toBe(ServerSetupStatus.Skipped);
  });

  test("backups: a backup the server made says more than a confirmation", () => {
    const confirmed: ServerSetupChoices = chose(
      ServerSetupCheckId.Backups,
      ServerSetupChoiceKind.Confirmed,
    );

    expect(check(freshFacts(), ServerSetupCheckId.Backups).status).toBe(
      ServerSetupStatus.NotSetUp,
    );
    expect(
      check(freshFacts({ choices: confirmed }), ServerSetupCheckId.Backups)
        .status,
    ).toBe(ServerSetupStatus.Confirmed);

    const made: ServerSetupCheckResult = check(
      freshFacts({
        choices: confirmed,
        lastBackup: { succeeded: true, finishedAt: EARLIER, error: null },
      }),
      ServerSetupCheckId.Backups,
    );

    expect(made.status).toBe(ServerSetupStatus.Done);
    expect(made.time).toBe(EARLIER);
    expect(made.choice).toBeNull();

    const failed: ServerSetupCheckResult = check(
      freshFacts({
        choices: confirmed,
        lastBackup: {
          succeeded: false,
          finishedAt: EARLIER,
          error: "The bucket refused the upload.",
        },
      }),
      ServerSetupCheckId.Backups,
    );

    expect(failed.status).toBe(ServerSetupStatus.Failing);
    expect(failed.reason).toBe("The bucket refused the upload.");
    expect(failed.isFinished).toBe(false);
    // A confirmation would not undo a backup that failed: not offered.
    expect(failed.canChoose).toBeNull();
  });

  test("backups say whether scheduled backups can be set up here", () => {
    expect(
      check(
        freshFacts({ hasScheduledBackups: true }),
        ServerSetupCheckId.Backups,
      ).hasScheduledBackups,
    ).toBe(true);
    expect(
      check(freshFacts(), ServerSetupCheckId.Backups).hasScheduledBackups,
    ).toBe(false);
  });

  test("backups can only be confirmed, never skipped", () => {
    const result: ServerSetupCheckResult = check(
      freshFacts({
        choices: {
          choices: {
            [ServerSetupCheckId.Backups]: {
              kind: ServerSetupChoiceKind.Skipped,
              at: EARLIER,
              byUserId: null,
            },
          },
          hiddenBy: {},
        },
      }),
      ServerSetupCheckId.Backups,
    );

    // A skip stored by hand counts for nothing: it reads as confirmed only if confirmed.
    expect(result.canChoose).toBe(ServerSetupChoiceKind.Confirmed);
  });

  test("update checks: on is done, off or failing is open, and either can be marked not needed", () => {
    expect(
      check(
        freshFacts({
          updateChecks: {
            isDisabled: false,
            lastCheckedAt: EARLIER,
            lastFailure: null,
          },
        }),
        ServerSetupCheckId.UpdateChecks,
      ).time,
    ).toBe(EARLIER);

    expect(
      check(
        freshFacts({
          updateChecks: {
            isDisabled: true,
            lastCheckedAt: EARLIER,
            lastFailure: null,
          },
        }),
        ServerSetupCheckId.UpdateChecks,
      ).status,
    ).toBe(ServerSetupStatus.NotSetUp);

    const failing: ServerSetupCheckResult = check(
      freshFacts({
        updateChecks: {
          isDisabled: false,
          lastCheckedAt: EARLIER,
          lastFailure: "unreachable",
        },
      }),
      ServerSetupCheckId.UpdateChecks,
    );

    expect(failing.status).toBe(ServerSetupStatus.Failing);
    expect(failing.reason).toBe("unreachable");

    expect(
      check(
        freshFacts({
          updateChecks: {
            isDisabled: true,
            lastCheckedAt: null,
            lastFailure: null,
          },
          choices: chose(
            ServerSetupCheckId.UpdateChecks,
            ServerSetupChoiceKind.Skipped,
          ),
        }),
        ServerSetupCheckId.UpdateChecks,
      ).status,
    ).toBe(ServerSetupStatus.Skipped);
  });
});

describe("optional checks", () => {
  test("browser push, an LLM provider and single sign-on: done from what the server has, never skipped", () => {
    for (const [id, field] of [
      [ServerSetupCheckId.BrowserPush, "isBrowserPushSetUp"],
      [ServerSetupCheckId.AiProvider, "hasAiProvider"],
      [ServerSetupCheckId.SingleSignOn, "hasSingleSignOn"],
    ] as Array<[ServerSetupCheckId, keyof ServerSetupFacts]>) {
      expect(check(freshFacts(), id).status).toBe(ServerSetupStatus.NotSetUp);
      expect(check(freshFacts({ [field]: true }), id).status).toBe(
        ServerSetupStatus.Done,
      );
      expect(check(freshFacts(), id).canChoose).toBeNull();
      expect(check(freshFacts(), id).tier).toBe(ServerSetupCheckTier.Optional);
    }
  });

  test("never counted by the card", () => {
    const answer: ServerSetupChecklistAnswer =
      ServerSetupChecklistUtil.getAnswer({
        facts: {
          ...finishedFacts(),
          isBrowserPushSetUp: false,
          hasAiProvider: false,
          hasSingleSignOn: false,
        },
        readerUserId: null,
      });

    expect(answer.openRequired).toEqual([]);
  });
});

describe("what is finished", () => {
  test("done, skipped and confirmed; nothing else", () => {
    expect([...FINISHED_SERVER_SETUP_STATUSES].sort()).toEqual(
      [
        ServerSetupStatus.Done,
        ServerSetupStatus.Skipped,
        ServerSetupStatus.Confirmed,
      ].sort(),
    );

    for (const status of Object.values(ServerSetupStatus)) {
      expect(ServerSetupChecklistUtil.isFinished(status)).toBe(
        FINISHED_SERVER_SETUP_STATUSES.includes(status),
      );
    }
  });
});

describe("choices", () => {
  test("a choice is kept with who made it and when, and undone with null", () => {
    const made: ServerSetupChoices = ServerSetupChecklistUtil.withChoice({
      choices: { choices: {}, hiddenBy: {} },
      check: ServerSetupCheckId.SmsAndCalls,
      kind: ServerSetupChoiceKind.Skipped,
      byUserId: "user-1",
      now: NOW,
    });

    expect(made.choices[ServerSetupCheckId.SmsAndCalls]).toEqual({
      kind: ServerSetupChoiceKind.Skipped,
      at: NOW.toISOString(),
      byUserId: "user-1",
    });

    const undone: ServerSetupChoices = ServerSetupChecklistUtil.withChoice({
      choices: made,
      check: ServerSetupCheckId.SmsAndCalls,
      kind: null,
      byUserId: "user-1",
      now: NOW,
    });

    expect(undone.choices[ServerSetupCheckId.SmsAndCalls]).toBeUndefined();
    // The one it was made on is left as it was.
    expect(made.choices[ServerSetupCheckId.SmsAndCalls]).toBeDefined();
  });

  test("a choice a check does not allow is refused", () => {
    for (const definition of SERVER_SETUP_CHECKS) {
      for (const kind of Object.values(ServerSetupChoiceKind)) {
        const make: () => ServerSetupChoices = () => {
          return ServerSetupChecklistUtil.withChoice({
            choices: { choices: {}, hiddenBy: {} },
            check: definition.id,
            kind: kind,
            byUserId: null,
            now: NOW,
          });
        };

        if (definition.choice === kind) {
          expect(make).not.toThrow();
        } else {
          expect(make).toThrow();
        }
      }
    }
  });

  test("what is read back is held to the catalogue: unknown checks, wrong kinds and bad dates are left out", () => {
    const read: ServerSetupChoices = ServerSetupChecklistUtil.readChoices({
      choices: {
        [ServerSetupCheckId.SmsAndCalls]: {
          kind: "skipped",
          at: EARLIER,
          byUserId: "user-1",
        },
        [ServerSetupCheckId.Email]: { kind: "skipped", at: EARLIER },
        [ServerSetupCheckId.Backups]: { kind: "skipped", at: EARLIER },
        [ServerSetupCheckId.Probes]: { kind: "skipped", at: "not a date" },
        "something-else": { kind: "skipped", at: EARLIER },
        [ServerSetupCheckId.UpdateChecks]: "skipped",
      },
      hiddenBy: {
        "user-1": { at: EARLIER, openRequired: ["email", "nope", 3] },
        "user-2": { at: "never" },
        "user-3": "yes",
      },
    });

    expect(read).toEqual({
      choices: {
        [ServerSetupCheckId.SmsAndCalls]: {
          kind: ServerSetupChoiceKind.Skipped,
          at: EARLIER,
          byUserId: "user-1",
        },
      },
      hiddenBy: {
        "user-1": { at: EARLIER, openRequired: [ServerSetupCheckId.Email] },
      },
    });

    for (const nothing of [null, undefined, "x", 3, [], { choices: [] }]) {
      expect(ServerSetupChecklistUtil.readChoices(nothing)).toEqual({
        choices: {},
        hiddenBy: {},
      });
    }
  });
});

describe("Hide: per admin, until something new opens", () => {
  const OPEN: Array<ServerSetupCheckId> = [
    ServerSetupCheckId.Email,
    ServerSetupCheckId.Https,
  ];

  test("hidden for the admin who hid it, and nobody else", () => {
    const hidden: ServerSetupChoices = ServerSetupChecklistUtil.withHidden({
      choices: { choices: {}, hiddenBy: {} },
      userId: "ada",
      openRequired: OPEN,
      now: NOW,
    });

    expect(hidden.hiddenBy["ada"]).toEqual({
      at: NOW.toISOString(),
      openRequired: OPEN,
    });
    expect(
      ServerSetupChecklistUtil.isHiddenFor({
        choices: hidden,
        userId: "ada",
        openRequired: OPEN,
      }),
    ).toBe(true);
    expect(
      ServerSetupChecklistUtil.isHiddenFor({
        choices: hidden,
        userId: "grace",
        openRequired: OPEN,
      }),
    ).toBe(false);
    expect(
      ServerSetupChecklistUtil.isHiddenFor({
        choices: hidden,
        userId: null,
        openRequired: OPEN,
      }),
    ).toBe(false);
  });

  test("stays hidden as checks get done, and comes back when one opens that was not open", () => {
    const hidden: ServerSetupChoices = ServerSetupChecklistUtil.withHidden({
      choices: { choices: {}, hiddenBy: {} },
      userId: "ada",
      openRequired: OPEN,
      now: NOW,
    });

    expect(
      ServerSetupChecklistUtil.isHiddenFor({
        choices: hidden,
        userId: "ada",
        openRequired: [ServerSetupCheckId.Https],
      }),
    ).toBe(true);
    expect(
      ServerSetupChecklistUtil.isHiddenFor({
        choices: hidden,
        userId: "ada",
        openRequired: [ServerSetupCheckId.Https, ServerSetupCheckId.Signups],
      }),
    ).toBe(false);
  });

  test("the answer says it for the reader", () => {
    const facts: ServerSetupFacts = freshFacts({
      choices: {
        choices: {},
        hiddenBy: {
          ada: {
            at: EARLIER,
            openRequired: [
              ServerSetupCheckId.Email,
              ServerSetupCheckId.Https,
              ServerSetupCheckId.Signups,
            ],
          },
        },
      },
    });

    expect(
      ServerSetupChecklistUtil.getAnswer({ facts, readerUserId: "ada" })
        .isHiddenForReader,
    ).toBe(true);
    expect(
      ServerSetupChecklistUtil.getAnswer({ facts, readerUserId: "grace" })
        .isHiddenForReader,
    ).toBe(false);
  });
});

describe("the answer, read in a browser", () => {
  test("reads back what the server sent, whole", () => {
    const sent: ServerSetupChecklistAnswer = ServerSetupChecklistUtil.getAnswer(
      {
        facts: freshFacts({
          email: channel(
            ServerSendingChannel.Email,
            ServerSendingState.Failing,
          ),
          emailSentThrough: "smtp.example.com",
          sms: channel(ServerSendingChannel.SMS, ServerSendingState.Working),
          choices: chose(
            ServerSetupCheckId.Backups,
            ServerSetupChoiceKind.Confirmed,
          ),
          hasScheduledBackups: true,
        }),
        readerUserId: null,
      },
    );

    const named: ServerSetupChecklistAnswer = JSON.parse(JSON.stringify(sent));
    named.checks.find((result: ServerSetupCheckResult) => {
      return result.id === ServerSetupCheckId.Backups;
    })!.choice!.byName = "Ada Lovelace";

    const read: ServerSetupChecklistAnswer | null =
      ServerSetupChecklistUtil.parseAnswer(JSON.parse(JSON.stringify(named)));

    expect(read).toEqual(named);
  });

  test("anything that is not an answer reads as none; a row that is not a check is left out", () => {
    for (const nothing of [null, "x", 3, {}, { checks: "x" }]) {
      expect(ServerSetupChecklistUtil.parseAnswer(nothing)).toBeNull();
    }

    const read: ServerSetupChecklistAnswer | null =
      ServerSetupChecklistUtil.parseAnswer({
        checks: [
          { id: "email", status: "done" },
          { id: "nope", status: "done" },
          { id: "https", status: "maybe" },
          "x",
        ],
        isHiddenForReader: "yes",
      });

    expect(
      read?.checks.map((result: ServerSetupCheckResult) => {
        return result.id;
      }),
    ).toEqual([ServerSetupCheckId.Email]);
    expect(read?.isHiddenForReader).toBe(false);
  });

  test("a forged choice, test or open count is held to the catalogue", () => {
    const read: ServerSetupChecklistAnswer | null =
      ServerSetupChecklistUtil.parseAnswer({
        checks: [
          {
            id: "email",
            status: "not-set-up",
            canChoose: "skipped",
            choice: { kind: "skipped", at: EARLIER },
            tests: ["sms", "email", "push"],
          },
          { id: "https", status: "done" },
        ],
        openRequired: ["https", "signups"],
      });

    const email: ServerSetupCheckResult = read!.checks[0]!;

    expect(email.canChoose).toBeNull();
    expect(email.choice).toBeNull();
    expect(email.tests).toEqual([ServerSendingChannel.Email]);
    // What is open is worked out from the rows, not taken on trust.
    expect(read!.openRequired).toEqual([ServerSetupCheckId.Email]);
  });
});

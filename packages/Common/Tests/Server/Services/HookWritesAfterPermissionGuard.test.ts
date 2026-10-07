import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * WHAT A WRITE DOES BEFORE ITS PERMISSION CHECK IS KEPT TO WHAT CANNOT HURT.
 *
 * A service's onBeforeCreate, onBeforeUpdate and onBeforeDelete run before
 * DatabaseService's full permission check. Two things keep that safe:
 *
 *  1. DatabaseService refuses a caller who may not write the table at all
 *     before any of those hooks run, and narrows an update or delete to the
 *     rows the caller may write first (see DatabaseServicePermissionBeforeHooks).
 *     The first half of this file holds DatabaseService to that order.
 *
 *  2. The hooks themselves write nothing that a refused or failed write would
 *     leave behind. Making room for a row - taking a project's default from
 *     its other rows, moving the rows of a numbered list, replacing a row -
 *     belongs in onCreateSuccess / onUpdateSuccess, once the write succeeded
 *     (ProjectDefaultRow, ContiguousOrder), or in onUpdatePermitted /
 *     onCreatePermitted, once every permission check has passed, for what
 *     must come before it.
 *     The second half reads every service's onBefore* hooks - and the
 *     helpers of the same class they call - for writes, and for calls that
 *     charge, mail or change something outside OneUptime, and holds each one
 *     it finds to the list below with the reason it may stay.
 *
 * A hook that starts writing has to be put on that list, by whoever adds it.
 */

// packages/Common/Tests/Server/Services -> packages/Common
const COMMON_DIR: string = path.resolve(__dirname, "..", "..", "..");
const SERVICES_DIR: string = path.join(COMMON_DIR, "Server", "Services");

const HOOKS: Array<string> = [
  "onBeforeCreate",
  "onBeforeUpdate",
  "onBeforeDelete",
];

// A database write through a service or its repository.
const WRITE_CALL: RegExp =
  /\.(updateBy|updateOneBy|updateOneById|updateOneByIdAndFetch|deleteBy|deleteOneBy|deleteOneById|hardDeleteBy|create|createMany|createByEmail|insert|save|query|updateColumnsByIdWithoutHooks|compareAndSetColumnsByIdWithoutHooks|updateColumnsByIdIfUnlockedWithoutHooks|atomicAddToColumnsByIdWithoutHooks|atomicIncrementColumnValueByOneAndGetValue|atomicIncrementColumnValueByOne|atomicDecrementColumnValueBy)\s*\(/g;

// A method body that runs one of DatabaseService's write hooks.
const RUNS_A_WRITE_HOOK: RegExp =
  /this\.(_?onBeforeCreate|onBeforeUpdate|onBeforeDelete)\s*\(/;

// A call that charges, mails, messages or changes something outside OneUptime.
const OUTSIDE_CALL: RegExp =
  /\b(MailService\.sendMail|SmsService\.sendSms|CallService\.makeCall|NotificationService\.recharge\w*|BillingService\.(?!is|get|has|validate|find)\w+|WorkspaceNotificationRuleService\.archive\w*|GreenlockUtil\.orderCert|\w+FeedService\.create\w*FeedItem|OnCallDutyPolicyTimeLogService\.end\w*)\s*\(/g;

/*
 * Every hook that may still write before the permission check, and why.
 * Keyed "<file>#<hook>".
 */
const CASCADE_REASON: string =
  "Deletes the rows that reference the deleted one first. DatabaseService has already narrowed the delete to the rows the caller may delete, so only their children go.";
const FEED_REASON: string =
  "Records the removal in the on-call policy's feed (and its workspace channel) while the row can still be read. DatabaseService has already narrowed the delete to the rows the caller may delete, and nothing in the hook refuses after it.";
const NOTE_REASON: string =
  "Creates the note that comes with the state change as the caller, so the note's own permission check applies: it is only ever a note the caller may add anyway. It goes first so that a note the caller may not add refuses the state change too, rather than failing after the change is saved.";
const TIMELINE_REASON: string =
  "Joins the neighbours of the deleted timeline entry so the timeline has no gap. DatabaseService has already narrowed the delete to the entries the caller may delete.";

const ALLOWED_HOOK_WRITES: Record<string, string> = {
  "AlertEpisodeStateTimelineService.ts#onBeforeDelete": TIMELINE_REASON,
  "AlertStateTimelineService.ts#onBeforeDelete": TIMELINE_REASON,
  "IncidentEpisodeStateTimelineService.ts#onBeforeDelete": TIMELINE_REASON,
  "IncidentStateTimelineService.ts#onBeforeDelete": TIMELINE_REASON,
  "MonitorStatusTimelineService.ts#onBeforeDelete": TIMELINE_REASON,
  "ScheduledMaintenanceStateTimelineService.ts#onBeforeDelete": TIMELINE_REASON,
  "MonitorGroupService.ts#onBeforeDelete": CASCADE_REASON,
  "MonitorService.ts#onBeforeDelete":
    CASCADE_REASON +
    " It also archives the monitor's workspace channels, which the monitor being deleted owns.",
  "NetworkDeviceService.ts#onBeforeDelete":
    CASCADE_REASON +
    " Every device's monitors are proved deletable by the caller before the first one goes.",
  "OnCallDutyPolicyEscalationRuleService.ts#onBeforeDelete": CASCADE_REASON,
  "OnCallDutyPolicyEscalationRuleScheduleService.ts#onBeforeDelete":
    FEED_REASON,
  "OnCallDutyPolicyEscalationRuleTeamService.ts#onBeforeDelete": FEED_REASON,
  "OnCallDutyPolicyEscalationRuleUserService.ts#onBeforeDelete":
    FEED_REASON + " It also closes the removed user's on-call time log.",
  "OnCallDutyPolicyUserOverrideService.ts#onBeforeDelete": FEED_REASON,
  "OnCallDutyPolicyScheduleService.ts#onBeforeDelete":
    "Closes the on-call time logs of the schedule being deleted. DatabaseService has already narrowed the delete to the schedules the caller may delete, and nothing in the hook refuses after it.",
  "OnCallDutyPolicyService.ts#onBeforeDelete":
    "Archives the workspace channels of the policy being deleted. DatabaseService has already narrowed the delete to the policies the caller may delete.",
  "ProjectCallSMSConfigService.ts#onBeforeDelete":
    CASCADE_REASON +
    " The hook also narrows the query itself before it releases any phone number.",
  "TeamService.ts#onBeforeDelete": CASCADE_REASON,
  "UserCallService.ts#onBeforeDelete": CASCADE_REASON,
  "UserEmailService.ts#onBeforeDelete": CASCADE_REASON,
  "UserMicrosoftTeamsService.ts#onBeforeDelete": CASCADE_REASON,
  "UserSlackService.ts#onBeforeDelete": CASCADE_REASON,
  "UserSmsService.ts#onBeforeDelete": CASCADE_REASON,
  "UserTelegramService.ts#onBeforeDelete": CASCADE_REASON,
  "UserWebhookService.ts#onBeforeDelete": CASCADE_REASON,
  "UserWhatsAppService.ts#onBeforeDelete": CASCADE_REASON,
  "WorkspaceProjectAuthTokenService.ts#onBeforeDelete": CASCADE_REASON,
  "WorkspaceUserAuthTokenService.ts#onBeforeDelete": CASCADE_REASON,
  "BillingPaymentMethodService.ts#onBeforeDelete":
    "Detaches the card being deleted at the payment provider, which refuses to detach a project's last card. DatabaseService has already narrowed the delete to the cards the caller may delete.",
  "ScheduledMaintenanceStateTimelineService.ts#onBeforeCreate": NOTE_REASON,
  "DatabaseServerService.ts#onBeforeCreate":
    "A read: hasKubernetesClusters runs a SELECT through the repository's manager.",
  "NetworkSiteService.ts#onBeforeCreate":
    "Heals the stored materialized path of the parent site (checked to be in the same project first): it writes only the value the parent chain already implies.",
  "NetworkSiteService.ts#onBeforeUpdate":
    "Heals the stored materialized path of the new parent site (checked to be in the same project first): it writes only the value the parent chain already implies.",
  "StatusPagePrivateUserService.ts#onBeforeUpdate":
    "Clears the password reset token of a user whose email changes - it only ever takes access away, and only from users the caller may read and update.",
  "UserService.ts#onBeforeUpdate":
    "Clears the password reset token of an account whose email changes - it only ever takes access away, and only from accounts the caller may update.",
  "TeamMemberService.ts#onBeforeCreate":
    "Invites by email: the account and the invitation are made only after the hook's own checks - the request's project, a team of it, the grant ceiling, SCIM and the seat limits - and after DatabaseService refused anyone who may not invite.",
};

// --- source reading -------------------------------------------------------

/*
 * The source with comments blanked and string contents replaced, keeping
 * every offset and line, so braces and calls inside them do not count.
 */
function stripCommentsAndStrings(source: string): string {
  let out: string = "";
  let i: number = 0;

  while (i < source.length) {
    const char: string = source[i]!;

    if (source.startsWith("//", i)) {
      let end: number = source.indexOf("\n", i);
      end = end === -1 ? source.length : end;
      out += " ".repeat(end - i);
      i = end;
      continue;
    }

    if (source.startsWith("/*", i)) {
      let end: number = source.indexOf("*/", i + 2);
      end = end === -1 ? source.length : end + 2;
      out += source.slice(i, end).replace(/[^\n]/g, " ");
      i = end;
      continue;
    }

    if (char === '"' || char === "'" || char === "`") {
      let end: number = i + 1;

      while (end < source.length) {
        if (source[end] === "\\") {
          end += 2;
          continue;
        }

        if (source[end] === char) {
          end++;
          break;
        }

        end++;
      }

      out += char + source.slice(i + 1, end - 1).replace(/[^\n]/g, "_") + char;
      i = end;
      continue;
    }

    out += char;
    i++;
  }

  return out;
}

const METHOD_HEADER: RegExp =
  /\n[ \t]*(?:public|protected|private)\s+(?:static\s+)?(?:override\s+)?(?:async\s+)?([A-Za-z_]\w*)\s*(?:<[^>]*>)?\s*\(/g;

interface MethodBody {
  start: number;
  end: number;
}

// The class methods of a file, by name: a header at brace depth 1.
function methodsOf(source: string): Map<string, Array<MethodBody>> {
  const depth: Array<number> = new Array<number>(source.length + 1);
  let level: number = 0;

  for (let i: number = 0; i < source.length; i++) {
    depth[i] = level;

    if (source[i] === "{") {
      level++;
    } else if (source[i] === "}") {
      level--;
    }
  }

  const methods: Map<string, Array<MethodBody>> = new Map();

  for (const match of source.matchAll(METHOD_HEADER)) {
    const headerAt: number = match.index! + 1;

    if (depth[headerAt] !== 1) {
      continue;
    }

    // Past the parameter list.
    let i: number = match.index! + match[0].length - 1;
    let parens: number = 0;

    for (; i < source.length; i++) {
      if (source[i] === "(") {
        parens++;
      } else if (source[i] === ")") {
        parens--;

        if (parens === 0) {
          break;
        }
      }
    }

    // The body opens at the first "{" at depth 1 that is not a type literal.
    let bodyStart: number = -1;

    for (let j: number = i + 1; j < source.length; j++) {
      if (source[j] === ";" && depth[j] === 1) {
        break;
      }

      if (source[j] === "{" && depth[j] === 1) {
        const before: string = source.slice(0, j).trimEnd();
        const previous: string = before[before.length - 1] || "";

        if (":|&,<(".includes(previous)) {
          // A type literal in the return type: skip it.
          let braces: number = 0;

          for (; j < source.length; j++) {
            if (source[j] === "{") {
              braces++;
            } else if (source[j] === "}") {
              braces--;

              if (braces === 0) {
                break;
              }
            }
          }

          continue;
        }

        bodyStart = j;
        break;
      }
    }

    if (bodyStart === -1) {
      continue;
    }

    let bodyEnd: number = bodyStart + 1;

    while (
      bodyEnd < source.length &&
      !(source[bodyEnd] === "}" && depth[bodyEnd] === 2)
    ) {
      bodyEnd++;
    }

    const bodies: Array<MethodBody> = methods.get(match[1]!) || [];
    bodies.push({ start: bodyStart, end: bodyEnd + 1 });
    methods.set(match[1]!, bodies);
  }

  return methods;
}

// The methods a method reaches through `this.<method>(` calls, itself included.
function reachableFrom(
  source: string,
  methods: Map<string, Array<MethodBody>>,
  start: string,
): Set<string> {
  const reached: Set<string> = new Set();
  const pending: Array<string> = [start];

  while (pending.length > 0) {
    const name: string = pending.pop()!;

    if (reached.has(name) || !methods.has(name)) {
      continue;
    }

    reached.add(name);

    for (const body of methods.get(name)!) {
      for (const call of source
        .slice(body.start, body.end)
        .matchAll(/this\.([A-Za-z_]\w*)\s*\(/g)) {
        pending.push(call[1]!);
      }
    }
  }

  return reached;
}

interface HookWrite {
  key: string;
  calls: Array<string>;
}

function hookWritesOf(file: string): Array<HookWrite> {
  const raw: string = fs.readFileSync(path.join(SERVICES_DIR, file), "utf8");
  const source: string = stripCommentsAndStrings(raw);
  const methods: Map<string, Array<MethodBody>> = methodsOf(source);
  const writes: Array<HookWrite> = [];

  for (const hook of HOOKS) {
    if (!methods.has(hook)) {
      continue;
    }

    const calls: Array<string> = [];

    for (const name of reachableFrom(source, methods, hook)) {
      for (const body of methods.get(name)!) {
        const text: string = source.slice(body.start, body.end);

        for (const pattern of [WRITE_CALL, OUTSIDE_CALL]) {
          for (const call of text.matchAll(pattern)) {
            const line: number = raw
              .slice(0, body.start + call.index!)
              .split("\n").length;
            calls.push(`${name} (line ${line}): ${call[0].trim()}`);
          }
        }
      }
    }

    if (calls.length > 0) {
      writes.push({ key: `${file}#${hook}`, calls });
    }
  }

  return writes;
}

function serviceFiles(): Array<string> {
  return fs
    .readdirSync(SERVICES_DIR)
    .filter((file: string): boolean => {
      return file.endsWith(".ts");
    })
    .sort();
}

// Everything the scan finds, read once for the whole file.
const HOOK_WRITES: Array<HookWrite> = serviceFiles().flatMap(hookWritesOf);

// --- the tests ------------------------------------------------------------

describe("DatabaseService checks the caller before any write hook", () => {
  const raw: string = fs.readFileSync(
    path.join(SERVICES_DIR, "DatabaseService.ts"),
    "utf8",
  );
  const source: string = stripCommentsAndStrings(raw);
  const methods: Map<string, Array<MethodBody>> = methodsOf(source);

  function bodyOf(name: string): string {
    const bodies: Array<MethodBody> | undefined = methods.get(name);
    expect({ method: name, found: Boolean(bodies) }).toEqual({
      method: name,
      found: true,
    });
    return source.slice(bodies![0]!.start, bodies![0]!.end);
  }

  function expectInOrder(method: string, calls: Array<string>): void {
    const body: string = bodyOf(method);
    const positions: Array<number> = calls.map((call: string): number => {
      return body.indexOf(call);
    });

    for (let i: number = 0; i < calls.length; i++) {
      expect({ method, call: calls[i], found: positions[i]! >= 0 }).toEqual({
        method,
        call: calls[i],
        found: true,
      });

      if (i > 0) {
        expect({
          method,
          before: calls[i - 1],
          after: calls[i],
          inOrder: positions[i - 1]! < positions[i]!,
        }).toEqual({
          method,
          before: calls[i - 1],
          after: calls[i],
          inOrder: true,
        });
      }
    }
  }

  test("asking whether the caller may write the table is part of the check made before hooks", () => {
    expect(bodyOf("checkCallerBeforeHooks")).toContain(
      "ModelPermission.checkTableWritePermission(",
    );
  });

  test("create asks before onBeforeCreate", () => {
    expectInOrder("create", [
      "this.checkCallerBeforeHooks(",
      "this._onBeforeCreate(",
    ]);
  });

  test("an update finds the rows the caller may write before onBeforeUpdate", () => {
    expectInOrder("_updateBy", [
      "this.checkCallerBeforeHooks(",
      "this.keepRowsCallerMayWrite(",
      "this.onBeforeUpdate(",
    ]);
  });

  test("an update runs onUpdatePermitted only once every permission check has passed, and before the write", () => {
    expectInOrder("_updateBy", [
      "this.onBeforeUpdate(",
      "ModelPermission.checkUpdateQueryPermissions(",
      "this.onBeforeUpdateUniqueCheck(",
      "this.onUpdatePermitted(",
      "this.getRepository().update(",
    ]);
  });

  test("a create runs onCreatePermitted only once every permission check has passed, and before the write", () => {
    expectInOrder("create", [
      "this.checkCallerBeforeHooks(",
      "this._onBeforeCreate(",
      "ModelPermission.checkCreatePermissions(",
      "this.onBeforeCreateUniqueCheck(",
      "this.onCreatePermitted(",
      "this.getRepository().save(",
    ]);
  });

  test.each(["_deleteBy", "hardDeleteBy"])(
    "%s finds the rows the caller may delete before onBeforeDelete",
    (method: string) => {
      expectInOrder(method, [
        "this.checkCallerBeforeHooks(",
        "this.keepRowsCallerMayWrite(",
        "this.onBeforeDelete(",
      ]);
    },
  );

  test("no other method runs a write hook", () => {
    const runners: Array<string> = [];

    for (const [name, bodies] of methods) {
      for (const body of bodies) {
        if (RUNS_A_WRITE_HOOK.test(source.slice(body.start, body.end))) {
          runners.push(name);
        }
      }
    }

    expect(runners.sort()).toEqual(
      [
        "_deleteBy",
        "_onBeforeCreate",
        "_updateBy",
        "create",
        "hardDeleteBy",
      ].sort(),
    );
  });
});

describe("service write hooks write nothing a refused or failed write would leave behind", () => {
  test("the scan sees the hooks it is meant to read", () => {
    // A scan that found nothing would pass everything below.
    expect(HOOK_WRITES.length).toBeGreaterThan(10);
    expect(
      HOOK_WRITES.map((write: HookWrite): string => {
        return write.key;
      }),
    ).toContain("TeamService.ts#onBeforeDelete");
  });

  test("every hook that writes is on the list, with the reason it may", () => {
    const unexpected: Array<HookWrite> = HOOK_WRITES.filter(
      (write: HookWrite): boolean => {
        return !ALLOWED_HOOK_WRITES[write.key];
      },
    );

    expect(unexpected).toEqual([]);
  });

  test("every hook on the list still writes, so the list says what is true", () => {
    const found: Set<string> = new Set(
      HOOK_WRITES.map((write: HookWrite): string => {
        return write.key;
      }),
    );

    const stale: Array<string> = Object.keys(ALLOWED_HOOK_WRITES).filter(
      (key: string): boolean => {
        return !found.has(key);
      },
    );

    expect(stale).toEqual([]);
  });

  test.each([
    "AIAgentService.ts",
    "LlmProviderService.ts",
    "LogSavedViewService.ts",
    "MetricSavedViewService.ts",
    "TraceSavedViewService.ts",
    "ProjectCallSMSConfigService.ts",
    "OnCallDutyPolicyEscalationRuleService.ts",
    "OnCallDutyPolicyScheduleLayerService.ts",
    "OnCallDutyPolicyScheduleLayerUserService.ts",
    "StatusPageGroupService.ts",
    "StatusPageResourceService.ts",
    "StatusPageSubscriberService.ts",
    "ProjectService.ts",
  ])(
    "%s makes room for a row only after the write: nothing in onBeforeCreate or onBeforeUpdate",
    (file: string) => {
      const writes: Array<string> = HOOK_WRITES.filter(
        (write: HookWrite): boolean => {
          return (
            write.key === `${file}#onBeforeCreate` ||
            write.key === `${file}#onBeforeUpdate`
          );
        },
      ).flatMap((write: HookWrite): Array<string> => {
        return write.calls;
      });

      expect(writes).toEqual([]);
    },
  );
});

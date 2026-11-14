import Monitor from "../../../../Models/DatabaseModels/Monitor";
import { AIChatCitationTargetType } from "../../../../Types/AI/AIChatTypes";
import SortOrder from "../../../../Types/BaseDatabase/SortOrder";
import BadDataException from "../../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../../Types/JSON";
import {
  WhoIsToldBreak,
  WhoIsToldCriteria,
  WhoIsToldEvent,
  WhoIsToldOwners,
  WhoIsToldOwnersSource,
  WhoIsToldPerson,
  WhoIsToldPolicy,
  WhoIsToldResult,
  WhoIsToldRule,
  WhoIsToldStatusPage,
} from "../../../../Types/Monitor/WhoIsTold";
import ObjectID from "../../../../Types/ObjectID";
import { getOnCallPageChannelName } from "../../../../Types/OnCallDutyPolicy/OnCallPageChannel";
import Permission from "../../../../Types/Permission";
import { parseWebsiteAddress } from "../../../../Utils/GuidedSetup/WebsiteMonitorRecords";
import QueryHelper from "../../../Types/Database/QueryHelper";
import MonitorService from "../../../Services/MonitorService";
import WhoIsToldService from "../../../Services/WhoIsToldService";
import ToolResultSerializer, { SerializedResult } from "./Serializer";
import {
  ObservabilityTool,
  ToolArgs,
  ToolContext,
  ToolExecutionResult,
} from "./ToolTypes";

/*
 * WHO IS TOLD WHEN A MONITOR GOES DOWN, FOR ASK AI (issues #6829, #6810).
 *
 * After Ask AI set a monitor up, the next question is "who is told when
 * example.com goes down?". The monitor's overview answers it ("When this goes
 * down") from #6810's resolver, WhoIsToldService, which reads the whole
 * chain - the monitor's criteria, the on-call rules that match what they
 * open, each policy's first level and how a page reaches each person, the
 * project's channels - and names every place it breaks. This read hands the
 * model that same answer, as the person may see it (getForMonitor takes out
 * the policies and rules they may not read), so Ask AI says what the monitor
 * page says, never a guess.
 */

let cachedReadPermissions: Array<Permission> | null = null;
const getMonitorReadPermissions: () => Array<Permission> =
  (): Array<Permission> => {
    if (!cachedReadPermissions) {
      cachedReadPermissions = new Monitor().getReadPermissions();
    }
    return cachedReadPermissions;
  };

/*
 * The monitor a call names: by its id, else by its name (without case), else
 * - for "https://example.com" - by the name the website setup gives an
 * address. Read as the person.
 */
async function findMonitor(
  args: JSONObject,
  ctx: ToolContext,
): Promise<Monitor | null> {
  const named: string | undefined = ToolArgs.getString(args, "monitor");

  if (!named) {
    return null;
  }

  if (ObjectID.isValidUUID(named)) {
    return await MonitorService.findOneBy({
      query: { _id: named, projectId: ctx.projectId },
      select: { _id: true, name: true },
      props: ctx.props,
    });
  }

  const candidates: Array<string> = [named];
  const monitorName: string | undefined =
    parseWebsiteAddress(named)?.monitorName;

  if (monitorName) {
    candidates.push(monitorName);
  }

  const monitors: Array<Monitor> = await MonitorService.findBy({
    query: {
      projectId: ctx.projectId,
      name: QueryHelper.findWithSameTextAnyOf(candidates),
    },
    select: { _id: true, name: true },
    sort: { createdAt: SortOrder.Descending },
    limit: 10,
    skip: 0,
    props: ctx.props,
  });

  const lower: string = named.trim().toLowerCase();

  return (
    monitors.find((monitor: Monitor): boolean => {
      return (monitor.name || "").trim().toLowerCase() === lower;
    }) ||
    monitors[0] ||
    null
  );
}

/*
 * Who an incident, an alert or a status change emails, for each source as
 * Types/Monitor/WhoIsTold defines it and in the words the monitor's "When
 * this goes down" card says it (the Dashboard's WhoIsToldWords, "It emails
 * ..."), so Ask AI and the page never disagree (#7396):
 *   - Named: the owners the criteria names (and the network device's), with
 *     whom owner rules add;
 *   - OwnerRules: nobody is named, and only the project's owner rules add
 *     owners;
 *   - ProjectOwners: nobody is named or added by a rule (or, for a status
 *     change, the monitor has no owners), so the project's owners are
 *     emailed instead;
 *   - MonitorOwners: a status change emails the monitor's own owners.
 * A Record, so a new source does not compile until it is worded here.
 */
const OWNERS_WORDS: Readonly<Record<WhoIsToldOwnersSource, string>> = {
  [WhoIsToldOwnersSource.Named]: "its owners",
  [WhoIsToldOwnersSource.OwnerRules]: "the owners added by owner rules",
  [WhoIsToldOwnersSource.ProjectOwners]: "the project's owners",
  [WhoIsToldOwnersSource.MonitorOwners]: "the monitor's owners",
};

// "the owners added by owner rules (Dana Reyes, team Platform)".
function describeOwners(owners: WhoIsToldOwners): string {
  const named: Array<string> = [
    ...owners.userNames,
    ...owners.teamNames.map((team: string): string => {
      return `team ${team}`;
    }),
  ];
  const who: string = OWNERS_WORDS[owners.source];

  return named.length > 0 ? `${who} (${named.join(", ")})` : who;
}

/*
 * The owner rules that add owners to what opens, by name, as the card's
 * "Owner Rules" row lists them; one the person may not read keeps its
 * place without its name.
 */
function describeOwnerRules(rules: Array<WhoIsToldRule>): string {
  return rules
    .map((rule: WhoIsToldRule): string => {
      return rule.name
        ? `"${rule.name}"`
        : "an owner rule the person may not read";
    })
    .join(", ");
}

function describePerson(person: WhoIsToldPerson): string {
  const through: string = person.reachedThrough
    ? ` (${person.reachedThrough})`
    : "";

  if (!person.isReachable) {
    return `${person.name}${through}: cannot be reached by this page${
      person.problem ? ` (${person.problem})` : ""
    }`;
  }

  const channels: string = person.channels
    .map(getOnCallPageChannelName)
    .join(", ");
  const fallback: string = person.isFallback
    ? " (their verified methods, as no rule of theirs covers this severity)"
    : "";

  return `${person.name}${through}: by ${channels}${fallback}`;
}

function describePolicy(policy: WhoIsToldPolicy): string {
  if (policy.isHidden) {
    return "an on-call policy the person may not read (paging is set up, and who is hidden)";
  }

  const people: string =
    policy.people.length > 0
      ? policy.people.map(describePerson).join("; ")
      : "nobody right now";

  return `on-call policy "${policy.name}" (${policy.levelCount} escalation level${
    policy.levelCount === 1 ? "" : "s"
  }), whose first level pages: ${people}${
    policy.notPaged.length > 0
      ? `. Not paged: ${policy.notPaged.join("; ")}`
      : ""
  }`;
}

function describeEvent(event: WhoIsToldEvent): Array<string> {
  const lines: Array<string> = [
    `  - opens ${event.kind === "Alert" ? "an alert" : "an incident"} (${event.severityName}); emails ${describeOwners(event.owners)}`,
  ];

  if (event.ownerRules.length > 0) {
    lines.push(
      `    - owner rules that add its owners: ${describeOwnerRules(event.ownerRules)}`,
    );
  }

  if (event.policies.length === 0) {
    lines.push("    - pages nobody: no on-call rule runs a policy for it");
  }

  for (const policy of event.policies) {
    lines.push(`    - pages ${describePolicy(policy)}`);
  }

  /*
   * A status page the person may not read keeps its place without its name,
   * as the card's "A status page you can't see" does - never as an empty "".
   */
  if (event.statusPages.length > 0) {
    lines.push(
      `    - shows on status pages: ${event.statusPages
        .map((page: WhoIsToldStatusPage): string => {
          return page.name
            ? `"${page.name}"`
            : "a status page the person may not read";
        })
        .join(", ")}`,
    );
  }

  return lines;
}

/*
 * The resolver's answer as the model reads it: each criteria and what it
 * does, who it emails and pages and by what, and every break in the
 * resolver's own sentences.
 */
export function describeWhoIsToldForModel(result: WhoIsToldResult): string {
  const lines: Array<string> = [
    `Who is told when monitor "${result.monitorName}" goes down (checked ${result.checkedAt}):`,
  ];

  if (result.criteria.length === 0) {
    lines.push("- No criteria changes its status or opens anything.");
  }

  for (const criteria of result.criteria as Array<WhoIsToldCriteria>) {
    lines.push(
      `- Criteria "${criteria.name}"${
        criteria.statusName ? `: sets status ${criteria.statusName}` : ""
      }${
        criteria.statusOwners
          ? `; emails ${describeOwners(criteria.statusOwners)} of the change`
          : ""
      }`,
    );

    for (const event of criteria.events) {
      lines.push(...describeEvent(event));
    }
  }

  if (result.breaks.length > 0) {
    lines.push("Where the chain breaks:");

    for (const item of result.breaks as Array<WhoIsToldBreak>) {
      lines.push(`- ${item.message}`);
    }
  } else {
    lines.push("Nothing breaks the chain.");
  }

  return lines.join("\n");
}

export const WhoIsToldTool: ObservabilityTool = {
  name: "who_is_told",
  description:
    "Who is told when a monitor goes down, and where that breaks: for each of the monitor's criteria, what it opens, who it emails, which on-call policies it pages, who their first level reaches right now and by what (SMS, call, email, push), and each break in the chain (a policy no rule runs, a person a page can't reach, SMS switched off, ...). The same answer as the monitor's 'When this goes down'. Use it for 'who is told when example.com goes down?', 'will anyone get paged?', and after setting a monitor up. Name the monitor by its name, its address or its id.",
  inputSchema: {
    type: "object",
    properties: {
      monitor: {
        type: "string",
        description:
          "The monitor, by its name ('example.com'), its address ('https://example.com') or its id.",
      },
    },
    required: ["monitor"],
  },
  get requiredPermissions(): Array<Permission> {
    return getMonitorReadPermissions();
  },
  execute: async (
    args: JSONObject,
    ctx: ToolContext,
  ): Promise<ToolExecutionResult> => {
    const monitor: Monitor | null = await findMonitor(args, ctx);

    if (!monitor?.id) {
      throw new BadDataException(
        `No monitor named "${ToolArgs.getString(args, "monitor") || ""}" in this project. Find it with query_monitors and pass its name or id.`,
      );
    }

    // As the person may see it: what they may not read of the chain is taken out.
    const result: WhoIsToldResult = await WhoIsToldService.getForMonitor({
      projectId: ctx.projectId,
      monitorId: monitor.id,
      props: ctx.props,
    });

    // Redacted as every result is: a name that holds an email loses it.
    const serialized: SerializedResult = ToolResultSerializer.serializeText(
      describeWhoIsToldForModel(result),
      result.criteria.length,
    );

    return {
      dataForLlm: serialized.text,
      rowCount: serialized.rowCount,
      citationLabel: `Who is told when "${result.monitorName}" goes down`,
      citationTarget: {
        type: AIChatCitationTargetType.MonitorView,
        params: { monitorId: monitor.id.toString() },
      },
      redactionCount: serialized.redactionCount,
      isTruncated: serialized.isTruncated,
    };
  },
};

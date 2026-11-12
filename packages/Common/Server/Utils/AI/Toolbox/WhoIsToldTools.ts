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

function describeOwners(owners: WhoIsToldOwners): string {
  const named: Array<string> = [
    ...owners.userNames,
    ...owners.teamNames.map((team: string): string => {
      return `team ${team}`;
    }),
  ];

  if (owners.source === WhoIsToldOwnersSource.ProjectOwners) {
    return owners.hasOwnerRules
      ? "the project's owners, unless its owner rules add owners"
      : "the project's owners";
  }

  if (owners.source === WhoIsToldOwnersSource.MonitorOwners) {
    return named.length > 0
      ? `the monitor's owners (${named.join(", ")})`
      : "the monitor's owners (none yet)";
  }

  return named.length > 0 ? named.join(", ") : "nobody named";
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

  return `${person.name}${through}: by ${person.channels
    .map(getOnCallPageChannelName)
    .join(", ")}${person.isFallback ? " (their verified methods, as no rule of theirs covers this severity)" : ""}`;
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
    policy.notPaged.length > 0 ? `. Not paged: ${policy.notPaged.join("; ")}` : ""
  }`;
}

function describeEvent(event: WhoIsToldEvent): Array<string> {
  const lines: Array<string> = [
    `  - opens ${event.kind === "Alert" ? "an alert" : "an incident"} (${event.severityName}); emails ${describeOwners(event.owners)}`,
  ];

  if (event.policies.length === 0) {
    lines.push("    - pages nobody: no on-call rule runs a policy for it");
  }

  for (const policy of event.policies) {
    lines.push(`    - pages ${describePolicy(policy)}`);
  }

  if (event.statusPages.length > 0) {
    lines.push(
      `    - shows on status pages: ${event.statusPages
        .map((page: { name: string }): string => {
          return `"${page.name}"`;
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

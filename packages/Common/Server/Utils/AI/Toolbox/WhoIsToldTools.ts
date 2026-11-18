import Monitor from "../../../../Models/DatabaseModels/Monitor";
import { AIChatCitationTargetType } from "../../../../Types/AI/AIChatTypes";
import SortOrder from "../../../../Types/BaseDatabase/SortOrder";
import BadDataException from "../../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../../Types/JSON";
import {
  WHO_IS_TOLD_PERSON_PROBLEM_CLAUSES,
  WhoIsToldBreak,
  WhoIsToldCriteria,
  WhoIsToldDeclaration,
  WhoIsToldEvent,
  WhoIsToldMonitorGroup,
  WhoIsToldOwnerAddedBy,
  WhoIsToldOwnerNotReached,
  WhoIsToldOwnerProblem,
  WhoIsToldOwners,
  WhoIsToldOwnersSource,
  WhoIsToldPerson,
  WhoIsToldPersonProblem,
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

import { AI_TOOL_CITATIONS } from "../../../../Types/AI/AIReadTableWords";
import { citationSentence } from "./ReadTableWords";
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
  [WhoIsToldOwnersSource.ProjectOwners]: "the Project Owners",
  [WhoIsToldOwnersSource.MonitorOwners]: "the monitor's owners",
};

/*
 * "the owners added by owner rules (Dana Reyes, team Platform)". An owner
 * the page reaches first is not emailed as an owner too (#8860), as the
 * card's "Ana Lopez is paged, so isn't emailed as an owner too." says:
 * "its owners (Ben Ito) - not Ana Lopez, whom the on-call page reaches
 * first, so is not emailed as an owner too", or, when the page reaches
 * every owner, "nobody as an owner: ...".
 */
function describeOwners(owners: WhoIsToldOwners): string {
  const named: Array<string> = [
    ...owners.userNames,
    ...owners.teamNames.map((team: string): string => {
      return `team ${team}`;
    }),
  ];
  const who: string = OWNERS_WORDS[owners.source];
  const paged: Array<string> = (owners.pagedOwners || []).map(
    (owner: { name: string }): string => {
      return owner.name || "someone";
    },
  );
  const notThem: string =
    paged.length > 0
      ? `${paged.join(", ")}, whom the on-call page reaches first, so ${
          paged.length === 1 ? "is" : "are"
        } not emailed as ${
          owners.source === WhoIsToldOwnersSource.ProjectOwners
            ? paged.length === 1
              ? "a Project Owner"
              : "Project Owners"
            : paged.length === 1
              ? "an owner"
              : "owners"
        } too`
      : "";

  if (paged.length > 0 && named.length === 0) {
    return `nobody as an owner: ${notThem}`;
  }

  const emailed: string =
    named.length > 0 ? `${who} (${named.join(", ")})` : who;

  return paged.length > 0 ? `${emailed} - not ${notThem}` : emailed;
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

/*
 * An on-call rule by its name, as the card's "On-call rules" row lists it;
 * one the person may not read (redactWhoIsTold leaves its name empty) keeps
 * its place without it, as a hidden owner rule and status page do (#7441).
 */
function describeOnCallRule(rule: WhoIsToldRule): string {
  return rule.name
    ? `"${rule.name}"`
    : "an on-call rule the person may not read";
}

/*
 * Why a person a policy reaches can't be paged, in the card's words (#7525):
 * its "Can't be paged", then the break sentence it says the reason in
 * ("Ana Lopez has no verified notification method.") - the clauses
 * WhoIsTold keeps for both, never the problem's code, which the model would
 * repeat word for word.
 */
function describePerson(person: WhoIsToldPerson): string {
  const name: string = person.name || "someone";
  const through: string = person.reachedThrough
    ? ` (${person.reachedThrough})`
    : "";

  if (!person.isReachable) {
    return `${name}${through}: can't be paged, because ${name} ${
      WHO_IS_TOLD_PERSON_PROBLEM_CLAUSES[
        person.problem || WhoIsToldPersonProblem.NoVerifiedMethod
      ]
    }`;
  }

  const channels: string = person.channels
    .map(getOnCallPageChannelName)
    .join(", ");
  const fallback: string = person.isFallback
    ? " (what the fallback picks of their verified methods, as no rule of theirs covers this severity)"
    : "";

  return `${name}${through}: by ${channels}${fallback}`;
}

/*
 * What runs a policy (#7525): the criteria naming it, and the on-call rules
 * of what opens that page it (its ruleIds), by name - so "which rule pages
 * the Default policy?" is answered, never guessed.
 */
function describeWhatRunsPolicy(
  policy: WhoIsToldPolicy,
  rules: ReadonlyArray<WhoIsToldRule>,
): string {
  const runs: Array<string> = [];

  if (policy.isNamedByCriteria) {
    runs.push("named by the criteria");
  }

  const ruleNames: Array<string> = policy.ruleIds
    .map((ruleId: string): WhoIsToldRule | undefined => {
      return rules.find((rule: WhoIsToldRule): boolean => {
        return rule.id === ruleId;
      });
    })
    .filter((rule: WhoIsToldRule | undefined): rule is WhoIsToldRule => {
      return Boolean(rule);
    })
    .map(describeOnCallRule);

  if (ruleNames.length > 0) {
    runs.push(`run by ${ruleNames.join(", ")}`);
  }

  return runs.length > 0 ? `, ${runs.join(" and ")}` : "";
}

function describePolicy(
  policy: WhoIsToldPolicy,
  rules: ReadonlyArray<WhoIsToldRule>,
): string {
  const runBy: string = describeWhatRunsPolicy(policy, rules);

  if (policy.isHidden) {
    return `an on-call policy the person may not read (paging is set up, and who is hidden)${runBy}`;
  }

  const people: string =
    policy.people.length > 0
      ? policy.people.map(describePerson).join("; ")
      : "nobody right now";

  return `on-call policy "${policy.name}" (${policy.levelCount} escalation level${
    policy.levelCount === 1 ? "" : "s"
  })${runBy}, whose first level pages: ${people}${
    policy.notPaged.length > 0
      ? `. Not paged: ${policy.notPaged.join("; ")}`
      : ""
  }`;
}

/*
 * Rules by name - privacy, label or alert incident rules - as the card
 * lists them; one the person may not read keeps its place without its name.
 */
function describeRules(rules: Array<WhoIsToldRule>, what: string): string {
  return rules
    .map((rule: WhoIsToldRule): string => {
      return rule.name ? `"${rule.name}"` : `${what} the person may not read`;
    })
    .join(", ");
}

/*
 * An owner the Created email never reaches (#7572), why, and what named
 * them, as the card's "Owners who aren't emailed" says: a person who is
 * not a member is never named, nor another project's team.
 */
const OWNER_PROBLEM_WORDS: Readonly<Record<WhoIsToldOwnerProblem, string>> = {
  [WhoIsToldOwnerProblem.NotInProject]:
    "a person who is not a member of the project",
  [WhoIsToldOwnerProblem.TeamHasNobodyInProject]:
    "has nobody in it who is a member of the project",
  [WhoIsToldOwnerProblem.TeamOfAnotherProject]: "a team of another project",
};

function describeOwnerNotReached(owner: WhoIsToldOwnerNotReached): string {
  const who: string =
    owner.problem === WhoIsToldOwnerProblem.TeamHasNobodyInProject
      ? `team ${owner.name ? `"${owner.name}"` : "(no name)"}, which ${
          OWNER_PROBLEM_WORDS[owner.problem]
        }`
      : OWNER_PROBLEM_WORDS[owner.problem];

  switch (owner.addedBy) {
    case WhoIsToldOwnerAddedBy.Criteria:
      return `${who} (named by the criteria)`;
    case WhoIsToldOwnerAddedBy.NetworkDevice:
      return `${who} (an owner of the network device the monitor watches)`;
    case WhoIsToldOwnerAddedBy.OwnerRule:
      return `${who} (added by ${
        owner.rule?.name
          ? `owner rule "${owner.rule.name}"`
          : "an owner rule the person may not read"
      })`;
  }

  return who;
}

// "a" or "an", by what opens.
function opensWords(event: WhoIsToldEvent): string {
  return event.kind === "Alert" ? "an alert" : "an incident";
}

function describeStatusPage(page: WhoIsToldStatusPage): string {
  const name: string = page.name
    ? `"${page.name}"`
    : "a status page the person may not read";
  const groups: Array<WhoIsToldMonitorGroup> = page.groups || [];

  if (groups.length === 0) {
    return name;
  }

  // The monitor group the page shows it through: the one to edit (#7214).
  return `${name} (through monitor group ${groups
    .map((group: WhoIsToldMonitorGroup): string => {
      return group.name
        ? `"${group.name}"`
        : "a monitor group the person may not read";
    })
    .join(", ")})`;
}

/*
 * What a criteria opens, as the card's chain lists it: its kind, severity
 * and title (the on-call rules are matched on it, #7525) - "opens an
 * incident (Critical) titled "example.com is offline"" - who it emails,
 * the owner rules and on-call rules that match it, the policies they page
 * and the status pages it shows on; under an alert, the incident its
 * incident rule declares, said the same way (#7216).
 */
function describeEvent(
  event: WhoIsToldEvent,
  indent: string = "",
): Array<string> {
  /*
   * A private record the person could not read once it exists (#7213): what
   * opens, and that it is private - nothing of whom it tells, as the card.
   */
  if (event.isHidden) {
    const rules: Array<WhoIsToldRule> = event.privacyRules || [];

    return [
      `${indent}  - opens ${opensWords(event)} (${event.severityName}) that is private and not the person's to see, so who it tells is not shown to them${
        rules.length > 0
          ? `; made private by ${describeRules(rules, "a privacy rule")}`
          : ""
      }`,
    ];
  }

  const title: string = event.title ? ` titled "${event.title}"` : "";
  const lines: Array<string> = [
    `${indent}  - opens ${opensWords(event)} (${event.severityName})${title}; emails ${describeOwners(event.owners)}`,
  ];

  if (event.owners.notReached && event.owners.notReached.length > 0) {
    lines.push(
      `${indent}    - not emailed, as no Created email can reach them: ${event.owners.notReached
        .map(describeOwnerNotReached)
        .join("; ")}`,
    );
  }

  if (event.ownerRules.length > 0) {
    lines.push(
      `${indent}    - owner rules that add its owners: ${describeOwnerRules(event.ownerRules)}`,
    );
  }

  if (event.isPrivate) {
    const rules: Array<WhoIsToldRule> = event.privacyRules || [];

    lines.push(
      `${indent}    - is private (${
        rules.length > 0
          ? `made private by ${describeRules(rules, "a privacy rule")}`
          : "the criteria makes it private"
      }): it shows on no status page and tells no subscriber, and only its owners, Project Owners and Project Admins can see it`,
    );
  }

  // Label rules run before on-call rules: their labels decide which page it (#7212).
  if (event.labelRules && event.labelRules.length > 0) {
    lines.push(
      `${indent}    - label rules whose labels decide which on-call rules page it: ${describeRules(event.labelRules, "a label rule")}`,
    );
  }

  // The card's "On-call rules" row: the rules that match, or "None match".
  lines.push(
    event.rules.length > 0
      ? `${indent}    - on-call rules that match: ${event.rules
          .map(describeOnCallRule)
          .join(", ")}`
      : `${indent}    - no on-call rule matches`,
  );

  /*
   * An alert on-call rule with an Alert Owner condition matches on who owns
   * the alert (#9407): the owners that make it match, as the card says.
   */
  for (const match of event.ownerMatches || []) {
    const rule: WhoIsToldRule = event.rules.find(
      (item: WhoIsToldRule): boolean => {
        return item.id === match.ruleId;
      },
    ) || { id: match.ruleId, name: "" };

    lines.push(
      `${indent}    - on-call rule ${describeOnCallRule(rule)} matches because its Alert Owner condition picks owners of it: ${match.ownerNames.join(", ")}`,
    );
  }

  if (event.policies.length === 0) {
    lines.push(
      `${indent}    - pages nobody: no on-call rule runs a policy for it`,
    );
  }

  for (const policy of event.policies) {
    lines.push(`${indent}    - pages ${describePolicy(policy, event.rules)}`);
  }

  /*
   * A status page the person may not read keeps its place without its name,
   * as the card's "A status page you can't see" does - never as an empty "".
   */
  if (event.statusPages.length > 0) {
    lines.push(
      `${indent}    - shows on status pages: ${event.statusPages
        .map(describeStatusPage)
        .join(", ")}`,
    );
  }

  // The incident an alert incident rule declares from it (#7216), said as any incident.
  if (event.declares) {
    const declaration: WhoIsToldDeclaration = event.declares;
    const rule: string = declaration.rule.name
      ? `alert incident rule "${declaration.rule.name}"`
      : "an alert incident rule the person may not read";
    const when: string =
      declaration.waitInMinutes > 0
        ? `once it has stayed open ${declaration.waitInMinutes} minute${
            declaration.waitInMinutes === 1 ? "" : "s"
          }`
        : "right away";

    lines.push(
      `${indent}    - ${rule} turns it into an incident ${when}, which:`,
    );
    lines.push(...describeEvent(declaration.incident, `${indent}    `));
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
    "Who is told when a monitor goes down, and where that breaks: for each of the monitor's criteria, what it opens and the title it opens it with, who it emails, the on-call rules that match it, which on-call policies it pages and what runs each, who their first level reaches right now and by what (SMS, call, email, push) or why someone can't be paged, and each break in the chain (a policy no rule runs, a person a page can't reach, SMS switched off, ...). The same answer as the monitor's 'When this goes down'. Use it for 'who is told when example.com goes down?', 'will anyone get paged?', and after setting a monitor up. Name the monitor by its name, its address or its id.",
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
      // In the reader's language (issue #8311).
      ...citationSentence(AI_TOOL_CITATIONS.whoIsTold, {
        monitor: result.monitorName,
      }),
      citationTarget: {
        type: AIChatCitationTargetType.MonitorView,
        params: { monitorId: monitor.id.toString() },
      },
      redactionCount: serialized.redactionCount,
      isTruncated: serialized.isTruncated,
    };
  },
};

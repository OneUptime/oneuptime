import LogScrubRule from "../../../Models/DatabaseModels/LogScrubRule";
import TraceScrubRule from "../../../Models/DatabaseModels/TraceScrubRule";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import BadDataException from "../../../Types/Exception/BadDataException";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import LogScrubAction from "../../../Types/Log/LogScrubAction";
import LogScrubPatternType from "../../../Types/Log/LogScrubPatternType";
import ObjectID from "../../../Types/ObjectID";
import {
  ScrubRuleAddressSignal,
  ScrubRuleHidingAddresses,
  ScrubRulesHidingAddressesAnswer,
} from "../../../Types/Telemetry/ScrubRuleAddresses";
import { getScrubRuleServiceId } from "../../../Types/Telemetry/ScrubRuleScope";
import { SecurityEventsTelemetrySource } from "../../../Types/Telemetry/TelemetryFieldReaders";
import TraceScrubAction from "../../../Types/Trace/TraceScrubAction";
import {
  AddressScrubRule,
  findScrubRulesHidingAddresses,
} from "../../../Utils/SecurityEvent/ScrubbedAddress";
import LogScrubRuleService from "../../Services/LogScrubRuleService";
import TraceScrubRuleService from "../../Services/TraceScrubRuleService";
import logger from "../Logger";
import ScrubbedClientAddresses from "./ScrubbedClientAddresses";
import {
  findSecurityEventsSources,
  SecurityEventsSources,
} from "./SecurityEventsFieldReaders";

/*
 * WHICH SCRUB RULES KEEP SECURITY EVENTS FROM NAMING AN ATTACKER'S
 * ADDRESS, AND THE SWITCH THAT LETS IT NAME THEM AGAIN (#10396).
 *
 * An enabled IP Address rule that redacts or masks, over a part of the
 * records Security Events reads an address from (a log's body or
 * attributes, a span's attributes), of logs or traces one of its scans
 * reads (SecurityEventsFieldReaders), leaves every attack there without an
 * address. Each gets a notice where it is and where the findings it covers
 * are, and Hash Instead: the rule's action becomes Hash, so people still
 * read a token and Security Events' address vault (#10395) names the
 * address behind it.
 *
 * The rules are read as the person asking, so they see only rules they
 * may read; whether Security Events reads the records is one fact about
 * the project, read as OneUptime. The switch is made as the person, with
 * the scrub rule's own Edit permission.
 */

/*
 * Whether one of Security Events' scans reads a signal's records for the
 * client's address: "Your logs" reads every log line and follows a line
 * into its request's span; the Traces source reads every span.
 */
function readsAddressesOf(
  sources: ReadonlyArray<SecurityEventsTelemetrySource>,
  signal: ScrubRuleAddressSignal,
): boolean {
  return signal === "log"
    ? sources.includes(SecurityEventsTelemetrySource.Logs)
    : sources.length > 0;
}

function toAnswerRule(
  rule: AddressScrubRule,
  signal: ScrubRuleAddressSignal,
): ScrubRuleHidingAddresses {
  const answer: ScrubRuleHidingAddresses = {
    signal,
    ruleId: rule.id.toLowerCase(),
    ruleName: rule.name,
    scrubAction: rule.scrubAction,
  };

  if (rule.serviceId) {
    answer.serviceId = rule.serviceId;
  }

  return answer;
}

/*
 * The project's enabled IP Address rules that keep Security Events from
 * naming the addresses they hide, logs' first, for the person asking: a
 * kind of rule they may not read is left out.
 */
export async function findScrubRulesHidingAddressesFor(data: {
  projectId: ObjectID;
  props: DatabaseCommonInteractionProps;
}): Promise<ScrubRulesHidingAddressesAnswer> {
  const rules: Array<ScrubRuleHidingAddresses> = [];
  const signalsRead: Array<ScrubRuleAddressSignal> = [];
  let isChecked: boolean = true;

  for (const signal of ["log", "trace"] as Array<ScrubRuleAddressSignal>) {
    const read: SecurityEventsSources = await findSecurityEventsSources({
      projectId: data.projectId,
      signal,
    });

    if (!read.isChecked) {
      isChecked = false;
      continue;
    }

    if (!readsAddressesOf(read.sources, signal)) {
      continue;
    }

    signalsRead.push(signal);

    let saved: Array<AddressScrubRule>;

    try {
      saved = await ScrubbedClientAddresses.getAddressScrubRules({
        projectId: data.projectId,
        signal,
        props: data.props,
      });
    } catch (error) {
      // A kind of rule the person may not read says nothing to them.
      if (!(error instanceof NotAuthorizedException)) {
        logger.warn(
          `ScrubRuleHashInstead: could not read the ${signal} scrub rules of project ${data.projectId.toString()}:`,
        );
        logger.warn(error);
        isChecked = false;
      }

      continue;
    }

    for (const rule of findScrubRulesHidingAddresses(saved, signal)) {
      rules.push(toAnswerRule(rule, signal));
    }
  }

  return { isChecked, signalsRead, rules };
}

// "redacts" or "masks", as a description made by Scrub It says what an IP Address rule does.
const MADE_BY_SCRUB_IT: string = 'Made by Data Security ("Scrub it")';
const ACTION_SENTENCE: RegExp =
  /It (?:redacts|masks) every ip address in ([^.]+?) from now on\./;

// The longest description a rule keeps (character varying(500)).
const MAX_DESCRIPTION_LENGTH: number = 500;

/*
 * A description Scrub It wrote, saying the rule now hashes and why - or
 * the description as it was, when a person wrote it or it says no such
 * thing. Never longer than a rule's description may be.
 */
export function describeHashInstead(
  description: string | null | undefined,
  signal: ScrubRuleAddressSignal,
): string | null {
  const text: string = description || "";

  if (!text.startsWith(MADE_BY_SCRUB_IT) || !ACTION_SENTENCE.test(text)) {
    return null;
  }

  const rewritten: string = text.replace(
    ACTION_SENTENCE,
    (_match: string, fields: string): string => {
      return `It hashes every ip address in ${fields} from now on, rather than redacting it: people see a token instead of the address, and Security Events, which reads these ${signal === "log" ? "logs" : "spans"}, still sees the address behind it, so it can say which one to block.`;
    },
  );

  return rewritten.length > MAX_DESCRIPTION_LENGTH
    ? rewritten.slice(0, MAX_DESCRIPTION_LENGTH - 1) + "…"
    : rewritten;
}

/*
 * Hash Instead: the IP Address rule's action becomes Hash, as the person
 * who pressed it - refused (NotAuthorizedException) where they may not
 * edit scrub rules of its kind, and refused in words for a rule that is
 * not an IP Address rule. A rule that already hashes stays as it is. A
 * description Scrub It wrote is brought in line.
 */
export async function switchScrubRuleToHash(data: {
  projectId: ObjectID;
  signal: ScrubRuleAddressSignal;
  ruleId: ObjectID;
  props: DatabaseCommonInteractionProps;
}): Promise<ScrubRuleHidingAddresses> {
  const select: {
    _id: true;
    name: true;
    description: true;
    patternType: true;
    scrubAction: true;
    serviceId: true;
  } = {
    _id: true,
    name: true,
    description: true,
    patternType: true,
    scrubAction: true,
    serviceId: true,
  };
  const rule: LogScrubRule | TraceScrubRule | null =
    data.signal === "log"
      ? await LogScrubRuleService.findOneBy({
          query: { _id: data.ruleId, projectId: data.projectId },
          select,
          props: data.props,
        })
      : await TraceScrubRuleService.findOneBy({
          query: { _id: data.ruleId, projectId: data.projectId },
          select,
          props: data.props,
        });

  if (!rule) {
    throw new BadDataException("Scrub rule not found.");
  }

  if ((rule.patternType || "").trim() !== LogScrubPatternType.IPAddress) {
    throw new BadDataException(
      "Hash Instead is for IP Address scrub rules: this rule finds something else.",
    );
  }

  const hash: string =
    data.signal === "log" ? LogScrubAction.Hash : TraceScrubAction.Hash;

  if (rule.scrubAction !== hash) {
    const description: string | null = describeHashInstead(
      rule.description,
      data.signal,
    );
    const changes: { scrubAction: string; description?: string } = {
      scrubAction: hash,
      ...(description ? { description } : {}),
    };

    if (data.signal === "log") {
      await LogScrubRuleService.updateOneById({
        id: data.ruleId,
        data: changes as never,
        props: data.props,
      });
    } else {
      await TraceScrubRuleService.updateOneById({
        id: data.ruleId,
        data: changes as never,
        props: data.props,
      });
    }

    // Security Events names the rule that hid an address from what it reads now.
    ScrubbedClientAddresses.clearCache();
  }

  const answer: ScrubRuleHidingAddresses = {
    signal: data.signal,
    ruleId: data.ruleId.toString().toLowerCase(),
    ruleName: rule.name || "",
    scrubAction: hash,
  };
  const serviceId: string = getScrubRuleServiceId(rule);

  if (serviceId) {
    answer.serviceId = serviceId;
  }

  return answer;
}

import LogScrubRule from "../../../Models/DatabaseModels/LogScrubRule";
import TraceScrubRule from "../../../Models/DatabaseModels/TraceScrubRule";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { LIMIT_PER_PROJECT } from "../../../Types/Database/LimitMax";
import LogScrubPatternType from "../../../Types/Log/LogScrubPatternType";
import ObjectID from "../../../Types/ObjectID";
import NormalizedSecurityEvent from "../../../Types/SecurityEvent/NormalizedSecurityEvent";
import {
  AddressScrubRule,
  HiddenClientAddress,
  ScrubbedAddressSignal,
  findScrubRuleThatHid,
  nameClientAddressScrubRule,
  readHiddenClientAddress,
} from "../../../Utils/SecurityEvent/ScrubbedAddress";
import { SECURITY_LOG_RESOURCE_ID_ATTRIBUTE } from "../../../Types/SecurityCase/SecurityConnection";
import { getScrubRuleServiceId } from "../../../Types/Telemetry/ScrubRuleScope";
import InMemoryTTLCache from "../../Infrastructure/InMemoryTTLCache";
import LogScrubRuleService from "../../Services/LogScrubRuleService";
import TraceScrubRuleService from "../../Services/TraceScrubRuleService";
import logger from "../Logger";
import CaptureSpan from "../Telemetry/CaptureSpan";

/*
 * WHICH OF A PROJECT'S SCRUB RULES HID AN EVENT'S CLIENT ADDRESS (#10397).
 *
 * The scans mark an event whose client address a scrub rule hid with what
 * the rule left and where (Utils/SecurityEvent/ScrubbedAddress.ts), from
 * the record alone. Here, before the events of a page are stored, each is
 * told the project's rule that explains it: the first enabled IP Address
 * rule of the record's kind, over that part of the record, whose action
 * leaves what the record holds - its id and its name, so the event's page
 * can say "Hidden by the scrub rule Scrub IP addresses". An event no
 * enabled rule explains (a custom pattern's rule, one turned off since)
 * still says a scrub rule hid its address, without naming one.
 *
 * One read of each kind of rule a page needs, cached for as long as ingest
 * caches the rules it runs (60 seconds), and failure-tolerant: a read that
 * fails is logged and the events are stored as the scan marked them.
 *
 * Where the address vault (#10395) looks a Hash rule's token up, before
 * this: an event whose token it resolves names its address, and is no
 * event for this to read.
 */

// As long as ingest keeps the rules it runs (LogScrubRuleService's cache).
export const ADDRESS_SCRUB_RULES_CACHE_TTL_MS: number = 60 * 1000;

const MAX_CACHED_PROJECTS: number = 10_000;

const cache: InMemoryTTLCache<Array<AddressScrubRule>> = new InMemoryTTLCache<
  Array<AddressScrubRule>
>(MAX_CACHED_PROJECTS);

// A saved rule as the scans read it: its id, or nothing for a row with none.
function toAddressScrubRule(
  rule: LogScrubRule | TraceScrubRule,
): AddressScrubRule | null {
  const id: string | undefined = rule.id?.toString();

  if (!id) {
    return null;
  }

  const addressRule: AddressScrubRule = {
    id,
    name: rule.name || "",
    patternType: rule.patternType || "",
    scrubAction: rule.scrubAction || "",
    fieldsToScrub: rule.fieldsToScrub || "",
  };
  const serviceId: string = getScrubRuleServiceId(rule);

  // A rule for one service explains what it hid in that service's records alone (#10433).
  if (serviceId) {
    addressRule.serviceId = serviceId;
  }

  return addressRule;
}

/*
 * The service the event's record was sent under, as the scans write it
 * (SECURITY_LOG_RESOURCE_ID_ATTRIBUTE): the line's or the span's
 * primaryEntityId. None when the event does not say.
 */
function readRecordServiceId(
  event: NormalizedSecurityEvent,
): string | undefined {
  const value: unknown = event.attributes
    ? event.attributes[SECURITY_LOG_RESOURCE_ID_ATTRIBUTE]
    : undefined;

  return typeof value === "string" && value.trim()
    ? value.trim().toLowerCase()
    : undefined;
}

export default class ScrubbedClientAddresses {
  /*
   * A project's enabled IP Address scrub rules of a kind, in the order
   * ingest runs them, read with `props`: as OneUptime for a scan, as the
   * person for what a page shows them.
   */
  public static async getAddressScrubRules(data: {
    projectId: ObjectID;
    signal: ScrubbedAddressSignal;
    props: DatabaseCommonInteractionProps;
  }): Promise<Array<AddressScrubRule>> {
    const select: {
      _id: true;
      name: true;
      patternType: true;
      scrubAction: true;
      fieldsToScrub: true;
      serviceId: true;
    } = {
      _id: true,
      name: true,
      patternType: true,
      scrubAction: true,
      fieldsToScrub: true,
      serviceId: true,
    };

    const rules: Array<LogScrubRule | TraceScrubRule> =
      data.signal === "log"
        ? await LogScrubRuleService.findBy({
            query: {
              projectId: data.projectId,
              isEnabled: true,
              patternType: LogScrubPatternType.IPAddress,
            },
            select,
            sort: { sortOrder: SortOrder.Ascending },
            skip: 0,
            limit: LIMIT_PER_PROJECT,
            props: data.props,
          })
        : await TraceScrubRuleService.findBy({
            query: {
              projectId: data.projectId,
              isEnabled: true,
              patternType: LogScrubPatternType.IPAddress,
            },
            select,
            sort: { sortOrder: SortOrder.Ascending },
            skip: 0,
            limit: LIMIT_PER_PROJECT,
            props: data.props,
          });

    return rules
      .map(toAddressScrubRule)
      .filter((rule: AddressScrubRule | null): rule is AddressScrubRule => {
        return rule !== null;
      });
  }

  // The rules a scan names a rule from: read as OneUptime, and kept a minute.
  public static async getCachedAddressScrubRules(data: {
    projectId: ObjectID;
    signal: ScrubbedAddressSignal;
  }): Promise<Array<AddressScrubRule>> {
    const key: string = `${data.projectId.toString()}:${data.signal}`;
    const cached: Array<AddressScrubRule> | undefined = cache.get(key);

    if (cached) {
      return cached;
    }

    const rules: Array<AddressScrubRule> = await this.getAddressScrubRules({
      ...data,
      props: { isRoot: true },
    });

    cache.set(key, rules, ADDRESS_SCRUB_RULES_CACHE_TTL_MS);

    return rules;
  }

  // Forget what was read, so a test reads the rules it set up.
  public static clearCache(): void {
    cache.clear();
  }

  /*
   * Each event of a page whose client address a scrub rule hid names the
   * project's rule that explains it, when one does. In place.
   */
  @CaptureSpan()
  public static async nameScrubRules(data: {
    projectId: ObjectID;
    events: Array<NormalizedSecurityEvent>;
  }): Promise<void> {
    const hidden: Array<{
      event: NormalizedSecurityEvent;
      address: HiddenClientAddress;
    }> = [];

    for (const event of data.events) {
      const address: HiddenClientAddress | null =
        readHiddenClientAddress(event);

      if (address && address.place && address.signal) {
        hidden.push({ event, address });
      }
    }

    if (hidden.length === 0) {
      return;
    }

    const rulesBySignal: Map<
      ScrubbedAddressSignal,
      Array<AddressScrubRule>
    > = new Map<ScrubbedAddressSignal, Array<AddressScrubRule>>();

    for (const signal of ["log", "trace"] as Array<ScrubbedAddressSignal>) {
      const isNeeded: boolean = hidden.some(
        (item: { address: HiddenClientAddress }): boolean => {
          return item.address.signal === signal;
        },
      );

      if (!isNeeded) {
        continue;
      }

      try {
        rulesBySignal.set(
          signal,
          await this.getCachedAddressScrubRules({
            projectId: data.projectId,
            signal,
          }),
        );
      } catch (error) {
        logger.warn(
          `ScrubbedClientAddresses: could not read the ${signal} scrub rules of project ${data.projectId.toString()}; its events say a scrub rule hid their address without naming it.`,
        );
        logger.warn(error);
      }
    }

    for (const item of hidden) {
      const rules: Array<AddressScrubRule> | undefined = rulesBySignal.get(
        item.address.signal!,
      );
      const rule: AddressScrubRule | null = rules
        ? findScrubRuleThatHid(rules, {
            kind: item.address.kind,
            place: item.address.place!,
            // The service the record was sent under: a rule for another one did not hide it.
            serviceId: readRecordServiceId(item.event),
          })
        : null;

      if (rule) {
        nameClientAddressScrubRule(item.event.attributes, rule);
      }
    }
  }
}

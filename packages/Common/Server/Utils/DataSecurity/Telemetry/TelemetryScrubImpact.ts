import DataStore from "../../../../Models/DatabaseModels/DataStore";
import DataStoreFinding from "../../../../Models/DatabaseModels/DataStoreFinding";
import MetricPipelineRule from "../../../../Models/DatabaseModels/MetricPipelineRule";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { LIMIT_PER_PROJECT } from "../../../../Types/Database/LimitMax";
import {
  DataSecurityScrubImpact,
  DataSecurityScrubRulePlan,
} from "../../../../Types/DataSecurity/DataSecurityApiTypes";
import { DataStoreKind } from "../../../../Types/DataSecurity/DataStoreKind";
import {
  getScrubTarget,
  ScrubbedField,
  ScrubTarget,
} from "../../../../Types/DataSecurity/TelemetryScrubTarget";
import BadDataException from "../../../../Types/Exception/BadDataException";
import LogScrubAction from "../../../../Types/Log/LogScrubAction";
import ObjectID from "../../../../Types/ObjectID";
import { getScrubRuleServiceId } from "../../../../Types/Telemetry/ScrubRuleScope";
import {
  SecurityEventsFieldReads,
  TelemetryFieldReaders,
  TelemetryFieldReadersByKind,
  TelemetryFieldSignal,
} from "../../../../Types/Telemetry/TelemetryFieldReaders";
import {
  compileScrubRuleReading,
  CompiledScrubRuleReading,
  doesScrubRuleTakeFrom,
  ScrubRuleReading,
} from "../../../../Utils/Telemetry/ScrubRuleFieldReads";
import { TelemetryFieldReference } from "../../../../Utils/Telemetry/TelemetryFieldReferences";
import QueryHelper from "../../../Types/Database/QueryHelper";
import DataStoreFindingService from "../../../Services/DataStoreFindingService";
import DataStoreService from "../../../Services/DataStoreService";
import logger from "../../Logger";
import { findSecurityEventsFieldReads } from "../../SecurityEvent/SecurityEventsFieldReaders";
import { findTelemetryFieldReaders } from "../../Telemetry/TelemetryFieldReaders";
import {
  buildMetricScrubRule,
  CoveringScrubRule,
  findCoveringScrubRule,
  getScrubCoverage,
  planScrubItRule,
  readFindingServiceId,
  readScrubbableTarget,
  ScrubItRule,
} from "./TelemetryScrubCoverage";

/*
 * WHAT A SCRUB RULE WOULD TAKE AWAY, BEFORE IT IS MADE OR TURNED ON (#10433).
 *
 * Scrub It used to make its rule at once, with a dialog that said it
 * "masks this kind of data at this place": the rule redacted it, in every
 * service, and nothing asked what read the data first. A log monitor
 * filtering on user.email went quiet and stayed green; one grouped by
 * client.address resolved every group's alert and opened one "[REDACTED]"
 * group; a recording rule grouped by it wrote one series. Now Scrub It, and
 * the scrub rule form, say before the rule takes effect:
 *
 *  - the rule: what it does with what it finds, in which parts of the
 *    records, and whose (Scrub It's rule is the finding's service's,
 *    TelemetryScrubCoverage.planScrubItRule);
 *  - what reads what it would hide: the monitors, dashboards, saved views,
 *    recording rules and SLOs of the project (Telemetry/
 *    TelemetryFieldReaders, asked doesScrubRuleTakeFrom), named where the
 *    person may read them and counted where they may not, and what
 *    Security Events would lose (SecurityEvent/SecurityEventsFieldReaders).
 *
 * Which attributes hold the data is known, not guessed: the attribute the
 * finding was seen in, and every attribute Data Security found the type
 * under in the records the rule reaches (readKeysHoldingDataType).
 */

// The stores of each signal's records, whose findings say where a data type is.
const STORE_KINDS_OF_SIGNAL: Readonly<
  Record<TelemetryFieldSignal, ReadonlyArray<DataStoreKind>>
> = {
  log: [DataStoreKind.TelemetryLogs, DataStoreKind.TelemetrySessionReplays],
  trace: [
    DataStoreKind.TelemetryTraces,
    DataStoreKind.TelemetryExceptions,
    DataStoreKind.TelemetryAiConversations,
    DataStoreKind.TelemetrySessionReplays,
  ],
};

// The most findings read for where a type is.
const MAX_FINDINGS_READ: number = 1_000;

/*
 * The attributes Data Security found a data type under, in the records a
 * rule of this signal reaches - of one service's stores, for a rule of one
 * service - in lower case. None when they could not be read: what is known
 * otherwise still answers.
 */
export async function readKeysHoldingDataType(data: {
  projectId: ObjectID;
  dataTypeId: string;
  signal: TelemetryFieldSignal;
  serviceId?: unknown;
}): Promise<Set<string>> {
  const keys: Set<string> = new Set<string>();
  const serviceId: string = getScrubRuleServiceId({
    serviceId: data.serviceId,
  });

  try {
    const stores: Array<DataStore> = await DataStoreService.findBy({
      query: {
        projectId: data.projectId,
        kind: QueryHelper.any([...STORE_KINDS_OF_SIGNAL[data.signal]]),
        ...(serviceId ? { serviceId: new ObjectID(serviceId) } : {}),
      },
      select: { _id: true, kind: true },
      skip: 0,
      limit: LIMIT_PER_PROJECT,
      props: { isRoot: true },
    });
    const kindOf: Map<string, string> = new Map<string, string>();

    for (const store of stores) {
      if (store.id && store.kind) {
        kindOf.set(store.id.toString().toLowerCase(), store.kind);
      }
    }

    if (kindOf.size === 0) {
      return keys;
    }

    const findings: Array<DataStoreFinding> =
      await DataStoreFindingService.findBy({
        query: {
          projectId: data.projectId,
          dataStoreId: QueryHelper.any(Array.from(kindOf.keys())),
          dataTypeId: data.dataTypeId,
          isSuppressed: false,
        },
        select: { _id: true, location: true, dataStoreId: true },
        skip: 0,
        limit: MAX_FINDINGS_READ,
        props: { isRoot: true },
      });

    for (const finding of findings) {
      const target: ScrubTarget | null = getScrubTarget(
        kindOf.get(finding.dataStoreId?.toString().toLowerCase() || ""),
        (finding.location || "").trim(),
      );

      if (target?.signal === data.signal && target.key) {
        keys.add(target.key.toLowerCase());
      }
    }
  } catch (error) {
    logger.warn(
      `DataSecurity: could not read where ${data.dataTypeId} was found in project ${data.projectId.toString()}:`,
    );
    logger.warn(error);
  }

  return keys;
}

/*
 * Everything that reads what a scrub rule would hide - a rule Scrub It
 * would make, one written in the form, or one about to be turned on - for
 * the person asking (`props`). `knownKeys`: attributes known to hold its
 * type beyond those Data Security found it under (the finding's own).
 */
export async function findScrubRuleReaders(data: {
  projectId: ObjectID;
  rule: ScrubRuleReading;
  knownKeys?: ReadonlyArray<string> | undefined;
  props: DatabaseCommonInteractionProps;
}): Promise<TelemetryFieldReaders> {
  const keys: Set<string> = new Set<string>(
    (data.knownKeys || []).map((key: string): string => {
      return key.trim().toLowerCase();
    }),
  );
  const compiledType: string | null = compileScrubRuleReading(
    data.rule,
  ).dataTypeId;

  if (compiledType) {
    for (const key of await readKeysHoldingDataType({
      projectId: data.projectId,
      dataTypeId: compiledType,
      signal: data.rule.signal,
      serviceId: data.rule.serviceId,
    })) {
      keys.add(key);
    }
  }

  const compiled: CompiledScrubRuleReading = compileScrubRuleReading(
    data.rule,
    { keys },
  );
  const [kinds, securityEvents]: [
    TelemetryFieldReadersByKind,
    SecurityEventsFieldReads,
  ] = await Promise.all([
    findTelemetryFieldReaders({
      projectId: data.projectId,
      reads: (reference: TelemetryFieldReference): boolean => {
        return doesScrubRuleTakeFrom(compiled, reference);
      },
      props: data.props,
    }),
    findSecurityEventsFieldReads({ projectId: data.projectId, rule: compiled }),
  ]);

  return { kinds, securityEvents };
}

function noRule(reason: string): DataSecurityScrubImpact {
  return { isAvailable: false, unavailableReason: reason };
}

/*
 * What Scrub It would do for a finding, for the dialog to say before the
 * rule is made: why it cannot, the rule that already hides the data, or the
 * rule it would make and what that rule would take away.
 */
export async function getScrubItImpact(data: {
  projectId: ObjectID;
  kind: DataStoreKind;
  dataTypeId: string;
  dataTypeName?: string | null | undefined;
  location: string;
  serviceId?: ObjectID | string | null | undefined;
  storeKey?: string | null | undefined;
  // The reader's: only what they may read is named; the rest is counted.
  props: DatabaseCommonInteractionProps;
}): Promise<DataSecurityScrubImpact> {
  try {
    const {
      location,
      dataTypeId,
      target,
    }: { location: string; dataTypeId: string; target: ScrubTarget } =
      readScrubbableTarget(data);
    const existing: CoveringScrubRule | null = findCoveringScrubRule(
      await getScrubCoverage(data.projectId),
      {
        kind: data.kind,
        dataTypeId,
        location,
        serviceId: readFindingServiceId(data) || data.serviceId,
      },
    );

    if (existing) {
      return {
        isAvailable: true,
        existingRule: {
          id: existing.id,
          name: existing.name,
          signal: existing.signal,
        },
      };
    }

    if (target.signal === "metric") {
      const rule: MetricPipelineRule = buildMetricScrubRule({
        projectId: data.projectId,
        serviceId: data.serviceId,
        kind: data.kind,
        dataTypeId,
        location,
        target,
      });

      return {
        isAvailable: true,
        rule: {
          signal: "metric",
          name: rule.name || "",
          scrubAction: LogScrubAction.Redact,
          patternType: "",
          fieldsToScrub: "",
          dataTypeName: data.dataTypeName || "",
          ...(rule.serviceId ? { serviceId: rule.serviceId.toString() } : {}),
        },
      };
    }

    const planned: ScrubItRule = await planScrubItRule({
      ...data,
      dataTypeId,
      location,
      target: target as ScrubTarget & { signal: "log" | "trace" },
    });
    const plan: DataSecurityScrubRulePlan = {
      signal: planned.signal,
      name: planned.name,
      scrubAction: planned.plan.scrubAction,
      patternType: planned.plan.patternType,
      fieldsToScrub: planned.plan.fieldsToScrub,
      dataTypeName: planned.dataTypeName,
    };

    if (planned.scope.serviceId) {
      plan.serviceId = planned.scope.serviceId.toString();
      plan.serviceName = planned.scope.serviceName;
    }

    const readers: TelemetryFieldReaders = await findScrubRuleReaders({
      projectId: data.projectId,
      rule: {
        signal: planned.signal,
        patternType: planned.plan.patternType,
        customRegex: planned.plan.customRegex,
        scrubAction: planned.plan.scrubAction,
        fieldsToScrub: planned.plan.fieldsToScrub,
        serviceId: planned.scope.serviceId,
        dataTypeId,
      },
      // The attribute the finding was seen in holds the type, whatever else does.
      knownKeys:
        target.key &&
        (target.field === ScrubbedField.Attributes ||
          target.field === ScrubbedField.Events)
          ? [target.key]
          : [],
      props: data.props,
    });

    return { isAvailable: true, rule: plan, readers };
  } catch (error) {
    if (error instanceof BadDataException) {
      return noRule(error.message);
    }

    throw error;
  }
}

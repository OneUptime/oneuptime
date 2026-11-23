import DataSecurityFlow from "../../../../Models/DatabaseModels/DataSecurityFlow";
import DataSecurityIssue from "../../../../Models/DatabaseModels/DataSecurityIssue";
import DataStore from "../../../../Models/DatabaseModels/DataStore";
import Service from "../../../../Models/DatabaseModels/Service";
import Includes from "../../../../Types/BaseDatabase/Includes";
import SortOrder from "../../../../Types/BaseDatabase/SortOrder";
import OneUptimeDate from "../../../../Types/Date";
import DataSecurityIssueStatus from "../../../../Types/DataSecurity/DataSecurityIssueStatus";
import { RECORD_FLOW_KINDS } from "../../../../Types/DataSecurity/RecordOfProcessing";
import BadDataException from "../../../../Types/Exception/BadDataException";
import ObjectID from "../../../../Types/ObjectID";
import DataSecurityFlowService from "../../../Services/DataSecurityFlowService";
import DataSecurityIssueService from "../../../Services/DataSecurityIssueService";
import DataStoreService from "../../../Services/DataStoreService";
import ServiceService from "../../../Services/ServiceService";
import QueryHelper from "../../../Types/Database/QueryHelper";
import StoreTelemetryRetention, {
  TelemetryStoreRetention as StoreRetention,
} from "../../DataSecurity/StoreTelemetryRetention";
import logger from "../../Logger";
import CaptureSpan from "../../Telemetry/CaptureSpan";
import {
  AiAccessRecord,
  AiCopyRecord,
  AiDeclaredCodeRecord,
  AiImpactAssessmentDossier,
  AiIssueRecord,
  AiRecordAiProvider,
  AiRecordCopy,
  AiRecordDossier,
  AiRecordEntry,
  AiRecordHost,
  AiRecordService,
  AiStoreRecord,
  MAX_ASSESSMENT_FIXED_ISSUES,
  MAX_ASSESSMENT_OPEN_ISSUES,
  MAX_RECORD_AI_PROVIDERS,
  MAX_RECORD_HOSTS,
  MAX_RECORD_SERVICES,
} from "./DataSecurityAiInput";
import DataSecurityIssueDossier from "./DataSecurityIssueDossier";

/*
 * WHAT ONEUPTIME KNOWS ABOUT A STORE, READ FOR ITS PAPERWORK (#10375).
 *
 * A store's record of processing - its purpose, retention, legal basis and
 * the people it is about - and its impact assessment are drafted from what
 * Data Security's own records say, read here as OneUptime: the store, the
 * services the service map shows using it and what their teams wrote they
 * are for, the hosts and AI providers those services send to, copies of
 * its data in other stores, how long OneUptime keeps it when it is
 * telemetry (StoreTelemetryRetention), and the code that declares it. An
 * assessment reads, beside them, who can reach the store, its open issues
 * and the ones fixed lately.
 *
 * Each read selects the columns the input builder may send and nothing
 * more (DataSecurityAiInput's allow-list): names, counts, kinds and
 * configuration - never a finding's samples or records, never a
 * connection string, never a person's name or email. A read that fails
 * leaves its facts out rather than failing the draft: the draft says what
 * OneUptime could see.
 */

// What the paperwork reads of the store: the builder's allow-list.
export const PAPERWORK_STORE_SELECT: {
  _id: true;
  name: true;
  description: true;
  kind: true;
  provider: true;
  region: true;
  environment: true;
  sensitivity: true;
  sensitivityOverride: true;
  providerResourceId: true;
  dataTypeIds: true;
  dataCategories: true;
  subjectCountries: true;
  exposure: true;
  isPublicByDesign: true;
  cloudTags: true;
  posture: true;
  estimatedRecords: true;
  objectCount: true;
  serviceId: true;
  storeKey: true;
} = {
  _id: true,
  name: true,
  description: true,
  kind: true,
  provider: true,
  region: true,
  environment: true,
  sensitivity: true,
  sensitivityOverride: true,
  providerResourceId: true,
  dataTypeIds: true,
  dataCategories: true,
  subjectCountries: true,
  exposure: true,
  isPublicByDesign: true,
  cloudTags: true,
  posture: true,
  estimatedRecords: true,
  objectCount: true,
  serviceId: true,
  storeKey: true,
};

// How far back an assessment looks for the fixes on a store's timeline.
export const FIXED_ISSUES_WINDOW_IN_DAYS: number = 90;

// The most flows of one kind one store's read takes.
const MAX_FLOWS: number = 200;

// A read that fails leaves its facts out: logged, never thrown.
async function orNothing<T>(
  what: string,
  read: () => Promise<T>,
  nothing: T,
): Promise<T> {
  try {
    return await read();
  } catch (error) {
    logger.error(
      `DataSecurity AI: could not read ${what} for a store's paperwork: ${error}`,
    );
    return nothing;
  }
}

function idOf(record: { _id?: unknown; id?: unknown } | null): string {
  const id: unknown = record?.id || record?._id;

  return id ? String(id).toLowerCase() : "";
}

export interface StoreFlowsRead {
  services: Array<AiRecordService>;
  externalHosts: Array<AiRecordHost>;
  aiProviders: Array<AiRecordAiProvider>;
}

export default class RecordOfProcessingDossier {
  // The store as the paperwork reads it, or a refusal: one of another project is not found.
  public static async readStore(data: {
    projectId: ObjectID;
    dataStoreId: ObjectID;
  }): Promise<DataStore> {
    const store: DataStore | null = await DataStoreService.findOneBy({
      query: { _id: data.dataStoreId, projectId: data.projectId },
      select: PAPERWORK_STORE_SELECT,
      props: { isRoot: true },
    });

    if (!store?.id) {
      throw new BadDataException("This data store could not be found.");
    }

    return store;
  }

  /*
   * Everything a store's record is drafted from, read as OneUptime with the
   * project scoped.
   */
  @CaptureSpan()
  public static async read(data: {
    projectId: ObjectID;
    store: DataStore;
  }): Promise<AiRecordDossier> {
    const store: DataStore = data.store;
    const [flows, copies, retention, declaredCode]: [
      StoreFlowsRead,
      Array<AiRecordCopy>,
      StoreRetention | null,
      AiDeclaredCodeRecord | null,
    ] = await Promise.all([
      orNothing(
        "where its data flows",
        () => {
          return this.readFlows({ projectId: data.projectId, store });
        },
        { services: [], externalHosts: [], aiProviders: [] },
      ),
      orNothing(
        "copies of its data",
        async () => {
          return (
            await DataSecurityIssueDossier.readCopies(data.projectId, store.id!)
          ).map((copy: AiCopyRecord): AiRecordCopy => {
            return {
              otherStoreId: idOf(copy.otherStore),
              otherStore: copy.otherStore,
              isCopyOfThisStore: copy.isCopyOfThisStore,
            };
          });
        },
        [],
      ),
      orNothing(
        "how long OneUptime keeps it",
        async () => {
          return (
            (
              await StoreTelemetryRetention.readForStores({
                projectId: data.projectId,
                stores: [
                  {
                    id: store.id!.toString(),
                    kind: store.kind,
                    serviceId: store.serviceId,
                    storeKey: store.storeKey,
                  },
                ],
              })
            ).get(store.id!.toString().toLowerCase()) || null
          );
        },
        null,
      ),
      orNothing(
        "the code that declares it",
        () => {
          // The code of any check but a telemetry one: a store's own cloud code.
          return DataSecurityIssueDossier.readDeclaredCode(
            data.projectId,
            new DataSecurityIssue(),
            store,
          );
        },
        null,
      ),
    ]);

    return {
      store: store as AiStoreRecord,
      services: flows.services,
      externalHosts: flows.externalHosts,
      aiProviders: flows.aiProviders,
      copies,
      telemetryRetention: retention,
      declaredCode,
    };
  }

  /*
   * What an impact assessment is drafted from: the record's, and who can
   * reach the store, its open issues, the ones fixed in the last ninety
   * days, and what its record says.
   */
  @CaptureSpan()
  public static async readForAssessment(data: {
    projectId: ObjectID;
    store: DataStore;
    record: ReadonlyArray<AiRecordEntry>;
    now?: Date | undefined;
  }): Promise<AiImpactAssessmentDossier> {
    const now: Date = data.now || OneUptimeDate.getCurrentDate();
    const issueSelect: {
      _id: true;
      title: true;
      checkId: true;
      severity: true;
      resolvedAt: true;
    } = {
      _id: true,
      title: true,
      checkId: true,
      severity: true,
      resolvedAt: true,
    };
    const [record, access, openIssues, fixedIssues]: [
      AiRecordDossier,
      Array<AiAccessRecord>,
      Array<AiIssueRecord>,
      Array<AiIssueRecord>,
    ] = await Promise.all([
      this.read({ projectId: data.projectId, store: data.store }),
      orNothing(
        "who can reach the store",
        () => {
          return DataSecurityIssueDossier.readAccess(
            data.projectId,
            data.store.id!,
          );
        },
        [],
      ),
      orNothing(
        "its open issues",
        async () => {
          return (await DataSecurityIssueService.findBy({
            query: {
              projectId: data.projectId,
              dataStoreId: data.store.id!,
              status: DataSecurityIssueStatus.Open,
            },
            select: issueSelect,
            sort: { riskScore: SortOrder.Descending },
            skip: 0,
            limit: MAX_ASSESSMENT_OPEN_ISSUES,
            props: { isRoot: true },
          })) as Array<AiIssueRecord>;
        },
        [],
      ),
      orNothing(
        "the issues fixed lately",
        async () => {
          return (await DataSecurityIssueService.findBy({
            query: {
              projectId: data.projectId,
              dataStoreId: data.store.id!,
              status: DataSecurityIssueStatus.Resolved,
              resolvedAt: QueryHelper.greaterThanEqualTo(
                OneUptimeDate.addRemoveDurationInDays(
                  now,
                  -FIXED_ISSUES_WINDOW_IN_DAYS,
                ),
              ),
            },
            select: issueSelect,
            sort: { resolvedAt: SortOrder.Descending },
            skip: 0,
            limit: MAX_ASSESSMENT_FIXED_ISSUES,
            props: { isRoot: true },
          })) as Array<AiIssueRecord>;
        },
        [],
      ),
    ]);

    return {
      ...record,
      access,
      openIssues,
      fixedIssues,
      record: data.record,
      now,
    };
  }

  /*
   * The services the service map shows using the store - each with what its
   * team wrote it is for - and the hosts and AI providers they send to; an
   * AI conversations store's own provider too.
   */
  public static async readFlows(data: {
    projectId: ObjectID;
    store: DataStore;
  }): Promise<StoreFlowsRead> {
    const select: {
      _id: true;
      kind: true;
      serviceId: true;
      destination: true;
    } = { _id: true, kind: true, serviceId: true, destination: true };
    const uses: Array<DataSecurityFlow> = await DataSecurityFlowService.findBy({
      query: {
        projectId: data.projectId,
        sourceDataStoreId: data.store.id!,
        kind: new Includes([
          RECORD_FLOW_KINDS.uses,
          RECORD_FLOW_KINDS.aiProvider,
        ]),
      },
      select,
      sort: { callCount: SortOrder.Descending },
      skip: 0,
      limit: MAX_FLOWS,
      props: { isRoot: true },
    });
    const serviceIds: Array<ObjectID> = [];
    const serviceNames: Map<string, string> = new Map();
    const aiProviders: Array<AiRecordAiProvider> = [];

    for (const flow of uses) {
      if (flow.kind === RECORD_FLOW_KINDS.aiProvider && flow.destination) {
        aiProviders.push({ provider: flow.destination });
        continue;
      }

      const serviceId: string = idOf({ id: flow.serviceId });

      if (serviceId && !serviceNames.has(serviceId)) {
        serviceIds.push(flow.serviceId!);
        serviceNames.set(serviceId, flow.destination || "");
      }
    }

    const using: Array<ObjectID> = serviceIds.slice(0, MAX_RECORD_SERVICES);
    const [services, sent]: [Array<Service>, Array<DataSecurityFlow>] =
      using.length > 0
        ? await Promise.all([
            ServiceService.findBy({
              query: { projectId: data.projectId, _id: new Includes(using) },
              select: { _id: true, name: true, description: true },
              skip: 0,
              limit: using.length,
              props: { isRoot: true },
            }),
            DataSecurityFlowService.findBy({
              query: {
                projectId: data.projectId,
                serviceId: new Includes(using),
                kind: new Includes([
                  RECORD_FLOW_KINDS.externalHost,
                  RECORD_FLOW_KINDS.aiProvider,
                ]),
              },
              select,
              sort: { callCount: SortOrder.Descending },
              skip: 0,
              limit: MAX_FLOWS,
              props: { isRoot: true },
            }),
          ])
        : [[], []];
    const serviceById: Map<string, Service> = new Map(
      services.map((service: Service): [string, Service] => {
        return [idOf(service), service];
      }),
    );
    const nameOf: (serviceId: string) => string = (
      serviceId: string,
    ): string => {
      return (
        serviceById.get(serviceId)?.name || serviceNames.get(serviceId) || ""
      );
    };
    const externalHosts: Array<AiRecordHost> = [];

    for (const flow of sent) {
      const via: string = nameOf(idOf({ id: flow.serviceId }));

      if (!flow.destination) {
        continue;
      }

      if (flow.kind === RECORD_FLOW_KINDS.externalHost) {
        if (externalHosts.length < MAX_RECORD_HOSTS) {
          externalHosts.push({ host: flow.destination, via });
        }
      } else if (aiProviders.length < MAX_RECORD_AI_PROVIDERS) {
        aiProviders.push({ provider: flow.destination, via: via || undefined });
      }
    }

    return {
      services: using.map((id: ObjectID): AiRecordService => {
        const serviceId: string = idOf({ id });
        const service: Service | undefined = serviceById.get(serviceId);

        return {
          serviceId,
          name: nameOf(serviceId),
          description: service?.description || undefined,
        };
      }),
      externalHosts,
      aiProviders,
    };
  }
}

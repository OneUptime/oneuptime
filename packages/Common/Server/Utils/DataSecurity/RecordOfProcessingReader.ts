import DataSecurityFlow from "../../../Models/DatabaseModels/DataSecurityFlow";
import DataStore from "../../../Models/DatabaseModels/DataStore";
import Project from "../../../Models/DatabaseModels/Project";
import Service from "../../../Models/DatabaseModels/Service";
import User from "../../../Models/DatabaseModels/User";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import Includes from "../../../Types/BaseDatabase/Includes";
import ComplianceFramework from "../../../Types/DataSecurity/ComplianceFramework";
import DataCategory, {
  isPersonalDataCategory,
} from "../../../Types/DataSecurity/DataCategory";
import {
  DataSecurityDeclaredStore,
  DataSecurityRecordCounts,
  DataSecurityRecordOfProcessingResponse,
  DataSecurityRecordOfProcessingRow,
  ImpactAssessmentStatus,
  RecordRowState,
} from "../../../Types/DataSecurity/DataSecurityApiTypes";
import DataSensitivity from "../../../Types/DataSecurity/DataSensitivity";
import { getBuiltInDataType } from "../../../Types/DataSecurity/DataTypeCatalog";
import DataTypeNamer from "../../../Types/DataSecurity/DataTypeNamer";
import {
  getImpactAssessmentTriggers,
  ImpactAssessmentSection,
  ImpactAssessmentSectionSource,
  ImpactAssessmentTriggerView,
  readStoreImpactAssessment,
  StoreImpactAssessment,
} from "../../../Types/DataSecurity/ImpactAssessment";
import {
  getChangedFactKeys,
  getRecordFieldStatus,
  getRecordRecipients,
  getRecordTransfers,
  isRecordFieldToReview,
  readRecordFieldValue,
  readStoreRecordDrafts,
  RECORD_FIELDS,
  RECORD_FLOW_KINDS,
  RecordField,
  RecordFieldState,
  RecordFieldStatus,
  RecordFieldValue,
  RecordFieldView,
  RecordFlowInput,
  RecordLegalBasis,
  RecordTransfers,
  StoreRecordDrafts,
} from "../../../Types/DataSecurity/RecordOfProcessing";
import NotFoundException from "../../../Types/Exception/NotFoundException";
import ObjectID from "../../../Types/ObjectID";
import DataSecurityFlowService from "../../Services/DataSecurityFlowService";
import DataStoreService from "../../Services/DataStoreService";
import ProjectService from "../../Services/ProjectService";
import ServiceService from "../../Services/ServiceService";
import CallerPermission from "../Permission/CallerPermission";
import PendingInviteeProfiles, {
  WithheldProfile,
} from "../TeamMember/PendingInviteeProfiles";
import DataSecurityIntegrations from "./DataSecurityIntegrations";
import DeclaredDataStores from "./DeclaredDataStores";
import ProjectDataTypeNames from "./ProjectDataTypeNames";
import StoreTelemetryRetention, {
  getTelemetryRetentionText,
  TelemetryStoreRetention as StoreRetention,
} from "./StoreTelemetryRetention";

/*
 * THE GDPR RECORD OF PROCESSING, AS ONE READER READS IT (#10398, #10375).
 *
 * One row per store that holds personal data, of the stores the reader
 * may read - a role held to some labels reads those stores' rows alone -
 * with what the scans know (its kind, place, data, owners, frameworks) and
 * what Article 30 asks beside it:
 *
 *   - Purpose, Retention, Legal basis and the People it is about, each as
 *     the record says it - a person's words, or what plain code fills in -
 *     and where it stands (RecordFieldView): Drafted while OneUptime AI's
 *     draft waits, Change proposed while a change to a confirmed value
 *     waits, with the draft itself; never the draft in the record;
 *   - Recipients and Transfers, worked out now from the store's flows and
 *     regions (getRecordRecipients, getRecordTransfers);
 *   - a telemetry store's retention, read now from the retention set for
 *     its records (StoreTelemetryRetention), and what OneUptime declares of
 *     the stores it keeps for the project's security (DeclaredDataStores);
 *   - whether the store needs an impact assessment, and how far it is.
 *
 * Each row is built by plain code (buildRecordRow) from what is read once
 * for the whole record: the flows, the services and the stores' names, the
 * retention of every telemetry store.
 */

// The most stores one record lists.
const MAX_STORES: number = 10000;
// The most flows one record reads.
const MAX_FLOWS: number = 20000;

// What a row reads of a store.
export const RECORD_ROW_STORE_SELECT: {
  _id: true;
  name: true;
  kind: true;
  provider: true;
  region: true;
  environment: true;
  sensitivity: true;
  sensitivityOverride: true;
  dataCategories: true;
  dataTypeIds: true;
  subjectCountries: true;
  estimatedRecords: true;
  posture: true;
  serviceId: true;
  storeKey: true;
  purpose: true;
  retention: true;
  legalBasis: true;
  dataSubjects: true;
  recordDrafts: true;
  impactAssessment: true;
} = {
  _id: true,
  name: true,
  kind: true,
  provider: true,
  region: true,
  environment: true,
  sensitivity: true,
  sensitivityOverride: true,
  dataCategories: true,
  dataTypeIds: true,
  subjectCountries: true,
  estimatedRecords: true,
  posture: true,
  serviceId: true,
  storeKey: true,
  purpose: true,
  retention: true,
  legalBasis: true,
  dataSubjects: true,
  recordDrafts: true,
  impactAssessment: true,
};

// What OneUptime fills in of the stores it keeps for the project's security (#10398).
export const DECLARED_STORE_LEGAL_BASIS: RecordLegalBasis =
  RecordLegalBasis.LegitimateInterests;

function idOf(value: { toString: () => string } | null | undefined): string {
  return value ? value.toString().toLowerCase() : "";
}

// A store's record column, by its field.
function columnOf(store: DataStore, field: RecordField): unknown {
  switch (field) {
    case RecordField.Purpose:
      return store.purpose;
    case RecordField.Retention:
      return store.retention;
    case RecordField.LegalBasis:
      return store.legalBasis;
    default:
      return store.dataSubjects;
  }
}

// How far a store's impact assessment is, from whether it needs one and what it keeps.
export function getImpactAssessmentStatus(data: {
  triggers: ReadonlyArray<ImpactAssessmentTriggerView>;
  assessment: StoreImpactAssessment | null;
}): ImpactAssessmentStatus {
  if (!data.assessment) {
    return data.triggers.length > 0
      ? ImpactAssessmentStatus.Needed
      : ImpactAssessmentStatus.NotNeeded;
  }

  return Object.values(data.assessment.sections).some(
    (section: ImpactAssessmentSection | undefined): boolean => {
      return section?.source === ImpactAssessmentSectionSource.Edited;
    },
  )
    ? ImpactAssessmentStatus.Edited
    : ImpactAssessmentStatus.Drafted;
}

export interface RecordRowInput {
  store: DataStore;
  owners: Array<string>;
  dataTypeNames: Array<string>;
  declared: DataSecurityDeclaredStore | null;
  flows: ReadonlyArray<RecordFlowInput>;
  // Every store of the project, by id: its name and its region, for copies.
  storeNames: ReadonlyMap<string, string>;
  storeRegions: ReadonlyMap<string, string>;
  // Every service a flow names, by id.
  serviceNames: ReadonlyMap<string, string>;
  telemetryRetention: StoreRetention | null;
  // One store's row: the facts its drafts rest on.
  withFacts?: boolean | undefined;
}

/*
 * One store's row of the record, by plain code from what was read for it.
 * Pure: the record's route reads, this builds.
 */
export function buildRecordRow(
  input: RecordRowInput,
): DataSecurityRecordOfProcessingRow {
  const store: DataStore = input.store;
  const storeId: string = idOf(store.id);
  const declared: DataSecurityDeclaredStore | null = input.declared;
  const drafts: StoreRecordDrafts = readStoreRecordDrafts(store.recordDrafts);
  const retention: StoreRetention | null = input.telemetryRetention;
  const categories: Array<DataCategory> = store.dataCategories || [];
  const frameworks: Set<ComplianceFramework> = new Set();

  for (const dataTypeId of store.dataTypeIds || []) {
    for (const framework of getBuiltInDataType(dataTypeId)?.frameworks || []) {
      frameworks.add(framework);
    }
  }

  // What plain code fills in of each field, where nobody wrote it.
  const filledIn: Partial<Record<RecordField, RecordFieldValue>> = {};

  if (declared) {
    filledIn[RecordField.Purpose] = declared.purpose;
    filledIn[RecordField.Retention] = declared.retentionText;
    filledIn[RecordField.LegalBasis] = DECLARED_STORE_LEGAL_BASIS;
  } else if (retention) {
    filledIn[RecordField.Retention] = getTelemetryRetentionText(retention);
  }

  const fields: Array<RecordFieldView> = RECORD_FIELDS.map(
    (field: RecordField): RecordFieldView => {
      const column: RecordFieldValue = readRecordFieldValue(
        field,
        columnOf(store, field),
      );
      const state: RecordFieldState | undefined = drafts.fields[field];
      const status: RecordFieldStatus = getRecordFieldStatus({
        value: column,
        state,
        isFilledIn: filledIn[field] !== undefined,
      });
      const view: RecordFieldView = {
        field,
        status,
        value:
          status === RecordFieldStatus.FilledIn ? filledIn[field]! : column,
      };

      if (status === RecordFieldStatus.Drafted && state?.draft) {
        view.draft = state.draft;
      }

      if (
        status === RecordFieldStatus.ChangeProposed &&
        state?.proposed &&
        state.confirmed
      ) {
        view.proposed = state.proposed;
        view.changedFactKeys = getChangedFactKeys({
          previous: state.confirmed.facts,
          current: drafts.facts,
          keys: state.confirmed.factKeys,
        });
        view.previousFacts = state.confirmed.facts;
      }

      return view;
    },
  );
  const valueOf: (field: RecordField) => RecordFieldValue = (
    field: RecordField,
  ): RecordFieldValue => {
    return (
      fields.find((view: RecordFieldView): boolean => {
        return view.field === field;
      })?.value || ""
    );
  };

  // The stores holding a copy of this store's data, for its transfers.
  const copies: Array<{ name: string; region?: string | undefined }> = [];

  for (const flow of input.flows) {
    if (
      flow.kind === RECORD_FLOW_KINDS.copy &&
      (flow.sourceDataStoreId || "").toLowerCase() === storeId &&
      flow.destinationDataStoreId
    ) {
      const otherId: string = flow.destinationDataStoreId.toLowerCase();

      copies.push({
        name: input.storeNames.get(otherId) || "",
        region: input.storeRegions.get(otherId),
      });
    }
  }

  const recordStore: {
    id: string;
    name: string;
    region?: string | undefined;
    replicationRegions?: ReadonlyArray<string> | undefined;
    subjectCountries?: ReadonlyArray<string> | undefined;
  } = {
    id: storeId,
    name: store.name || "",
    region: store.region || undefined,
    replicationRegions: store.posture?.replicationRegions || [],
    subjectCountries: store.subjectCountries || [],
  };
  const transfers: RecordTransfers = getRecordTransfers({
    store: recordStore,
    copies,
  });
  const triggers: Array<ImpactAssessmentTriggerView> =
    getImpactAssessmentTriggers({
      dataCategories: categories,
      estimatedRecords: store.estimatedRecords,
      transfers: transfers.transfers,
      isDeclared: Boolean(declared),
    });
  const statuses: Array<RecordFieldStatus> = fields.map(
    (view: RecordFieldView): RecordFieldStatus => {
      return view.status;
    },
  );
  const purpose: RecordFieldValue = valueOf(RecordField.Purpose);
  const retentionValue: RecordFieldValue = valueOf(RecordField.Retention);
  const legalBasis: RecordFieldValue = valueOf(RecordField.LegalBasis);
  const people: RecordFieldValue = valueOf(RecordField.People);

  return {
    dataStoreId: store.id!.toString(),
    name: store.name || "",
    kind: store.kind || "",
    provider: store.provider || "",
    region: store.region || "",
    environment: store.environment || "",
    sensitivity:
      (store.sensitivityOverride as DataSensitivity | undefined) ||
      (store.sensitivity as DataSensitivity | undefined) ||
      DataSensitivity.Public,
    dataCategories: categories,
    dataTypeNames: input.dataTypeNames,
    owners: input.owners,
    purpose: typeof purpose === "string" ? purpose : "",
    retention: typeof retentionValue === "string" ? retentionValue : "",
    frameworks: [...frameworks],
    ...(declared ? { declared } : {}),
    legalBasis: typeof legalBasis === "string" ? legalBasis : "",
    dataSubjects: Array.isArray(people) ? people : [],
    fields,
    recipients: getRecordRecipients({
      store: recordStore,
      flows: input.flows,
      storeNames: input.storeNames,
      serviceNames: input.serviceNames,
    }),
    transfers: transfers.transfers,
    transfersUnknownBecause: transfers.unknownBecause,
    ...(retention
      ? {
          telemetryRetention: {
            signal: retention.signal,
            days: retention.days,
            ...(retention.maxDays ? { maxDays: retention.maxDays } : {}),
          },
        }
      : {}),
    state: declared
      ? RecordRowState.Declared
      : statuses.some(isRecordFieldToReview)
        ? RecordRowState.ToReview
        : statuses.includes(RecordFieldStatus.Empty)
          ? RecordRowState.Incomplete
          : RecordRowState.Complete,
    impactAssessment: {
      status: getImpactAssessmentStatus({
        triggers,
        assessment: readStoreImpactAssessment(store.impactAssessment),
      }),
      triggers,
    },
    ...(input.withFacts ? { facts: drafts.facts } : {}),
  };
}

// The record's rows by where they stand: the stores OneUptime declares count as none.
export function countRecordRows(
  rows: ReadonlyArray<DataSecurityRecordOfProcessingRow>,
): DataSecurityRecordCounts {
  const counts: DataSecurityRecordCounts = {
    toReview: 0,
    complete: 0,
    incomplete: 0,
  };

  for (const row of rows) {
    if (row.state === RecordRowState.ToReview) {
      counts.toReview++;
    } else if (row.state === RecordRowState.Complete) {
      counts.complete++;
    } else if (row.state === RecordRowState.Incomplete) {
      counts.incomplete++;
    }
  }

  return counts;
}

export default class RecordOfProcessingReader {
  /*
   * The record as the reader may read it - every store with personal data
   * they may read, or one of them (dataStoreId), whose row then carries
   * the facts its drafts rest on. A store they may not read is not found.
   */
  public static async read(data: {
    projectId: ObjectID;
    props: DatabaseCommonInteractionProps;
    dataStoreId?: ObjectID | undefined;
  }): Promise<DataSecurityRecordOfProcessingResponse> {
    await DeclaredDataStores.declareBeforeRead(data.projectId);

    // The stores the reader may read: a role held to labels reads its own.
    const readable: Set<string> = new Set(
      (
        await DataStoreService.findBy({
          query: {
            projectId: data.projectId,
            isArchived: false,
            ...(data.dataStoreId ? { _id: data.dataStoreId } : {}),
          },
          select: { _id: true },
          skip: 0,
          limit: MAX_STORES,
          props: data.props,
        })
      ).map((store: DataStore): string => {
        return idOf(store.id);
      }),
    );

    if (data.dataStoreId && !readable.has(idOf(data.dataStoreId))) {
      throw new NotFoundException("This data store could not be found.");
    }

    const stores: Array<DataStore> = await DataStoreService.findBy({
      query: { projectId: data.projectId, isArchived: false },
      select: RECORD_ROW_STORE_SELECT,
      skip: 0,
      limit: MAX_STORES,
      props: { isRoot: true },
    });
    const recorded: Array<DataStore> = stores.filter(
      (store: DataStore): boolean => {
        return (
          Boolean(store.id) &&
          readable.has(idOf(store.id)) &&
          (!data.dataStoreId || idOf(store.id) === idOf(data.dataStoreId)) &&
          (store.dataCategories || []).some(isPersonalDataCategory)
        );
      },
    );

    if (data.dataStoreId && recorded.length === 0) {
      throw new NotFoundException(
        "This data store holds no personal data, so it is not in the record of processing.",
      );
    }

    const [flows, retention, project, dataTypeNamer]: [
      Array<RecordFlowInput>,
      Map<string, StoreRetention>,
      Project | null,
      DataTypeNamer,
    ] = await Promise.all([
      this.readFlows(data.projectId),
      StoreTelemetryRetention.readForStores({
        projectId: data.projectId,
        stores: recorded.map(
          (
            store: DataStore,
          ): {
            id: string;
            kind?: string | undefined;
            serviceId?: ObjectID | undefined;
            storeKey?: string | undefined;
          } => {
            return {
              id: store.id!.toString(),
              kind: store.kind,
              serviceId: store.serviceId,
              storeKey: store.storeKey,
            };
          },
        ),
      }),
      ProjectService.findOneById({
        id: data.projectId,
        select: { _id: true, enableAi: true, enableAutomaticDataSecurityAi: true },
        props: { isRoot: true },
      }),
      /*
       * What an auditor reads each data type as: the project's own by the
       * name it gave it, one it deleted as deleted - never an id (#10363).
       */
      ProjectDataTypeNames.read({ projectId: data.projectId }),
    ]);
    const serviceNames: Map<string, string> = await this.readServiceNames({
      projectId: data.projectId,
      flows,
    });
    const storeNames: Map<string, string> = new Map();
    const storeRegions: Map<string, string> = new Map();

    for (const store of stores) {
      storeNames.set(idOf(store.id), store.name || "");

      if (store.region) {
        storeRegions.set(idOf(store.id), store.region);
      }
    }

    // The stores' owners, each as the project knows them (#10697).
    const owners: Map<string, Array<User>> = new Map();

    for (const store of recorded) {
      owners.set(
        idOf(store.id),
        await DataSecurityIntegrations.getOwnerUsers(store.id!),
      );
    }

    const ownerIds: Array<string> = [
      ...new Set(
        [...owners.values()].flatMap((users: Array<User>): Array<string> => {
          return users
            .map((owner: User): string => {
              return owner.id?.toString() || "";
            })
            .filter(Boolean);
        }),
      ),
    ];
    const withheld: Map<string, WithheldProfile> =
      ownerIds.length > 0
        ? await PendingInviteeProfiles.readWithheldProfilesInProject({
            userIds: ownerIds,
            projectId: data.projectId,
          })
        : new Map<string, WithheldProfile>();
    const rows: Array<DataSecurityRecordOfProcessingRow> = [];

    for (const store of recorded) {
      rows.push(
        buildRecordRow({
          store,
          owners: (owners.get(idOf(store.id)) || [])
            .map((owner: User): string => {
              return PendingInviteeProfiles.getNameInProject({
                userId: owner.id,
                name: owner.name,
                email: owner.email,
                withheld,
              });
            })
            .filter(Boolean),
          dataTypeNames: dataTypeNamer.namesOf(store.dataTypeIds),
          declared: await DeclaredDataStores.describe({
            projectId: data.projectId,
            store,
          }),
          flows,
          storeNames,
          storeRegions,
          serviceNames,
          telemetryRetention: retention.get(idOf(store.id)) || null,
          withFacts: Boolean(data.dataStoreId),
        }),
      );
    }

    const isAiEnabled: boolean = project?.enableAi !== false;
    const canEdit: boolean =
      data.props.isRoot === true ||
      CallerPermission.holdsModelPermission(data.props, {
        model: new DataStore(),
        operation: "update",
      });

    return {
      rows,
      counts: countRecordRows(rows),
      isAiEnabled,
      isAutomaticAiOn:
        isAiEnabled && project?.enableAutomaticDataSecurityAi === true,
      canEdit,
      canDraft: canEdit && isAiEnabled,
    };
  }

  // One store's row, as the reader may read it, with its facts.
  public static async readRow(data: {
    projectId: ObjectID;
    props: DatabaseCommonInteractionProps;
    dataStoreId: ObjectID;
  }): Promise<DataSecurityRecordOfProcessingRow> {
    const record: DataSecurityRecordOfProcessingResponse = await this.read(data);

    return record.rows[0]!;
  }

  // The project's flows a record reads: what its recipients and transfers are worked out from.
  public static async readFlows(
    projectId: ObjectID,
  ): Promise<Array<RecordFlowInput>> {
    const flows: Array<DataSecurityFlow> = await DataSecurityFlowService.findBy(
      {
        query: {
          projectId,
          kind: new Includes([
            RECORD_FLOW_KINDS.uses,
            RECORD_FLOW_KINDS.externalHost,
            RECORD_FLOW_KINDS.aiProvider,
            RECORD_FLOW_KINDS.copy,
          ]),
        },
        select: {
          _id: true,
          kind: true,
          sourceDataStoreId: true,
          destinationDataStoreId: true,
          serviceId: true,
          destination: true,
        },
        skip: 0,
        limit: MAX_FLOWS,
        props: { isRoot: true },
      },
    );

    return flows.map((flow: DataSecurityFlow): RecordFlowInput => {
      return {
        kind: flow.kind || "",
        sourceDataStoreId: flow.sourceDataStoreId?.toString(),
        destinationDataStoreId: flow.destinationDataStoreId?.toString(),
        serviceId: flow.serviceId?.toString(),
        destination: flow.destination || undefined,
      };
    });
  }

  // The names of the services the flows name, by id.
  private static async readServiceNames(data: {
    projectId: ObjectID;
    flows: ReadonlyArray<RecordFlowInput>;
  }): Promise<Map<string, string>> {
    const ids: Array<ObjectID> = [
      ...new Set(
        data.flows
          .map((flow: RecordFlowInput): string => {
            return (flow.serviceId || "").toLowerCase();
          })
          .filter((id: string): boolean => {
            return ObjectID.isValidUUID(id);
          }),
      ),
    ].map((id: string): ObjectID => {
      return new ObjectID(id);
    });
    const names: Map<string, string> = new Map();

    if (ids.length === 0) {
      return names;
    }

    const services: Array<Service> = await ServiceService.findBy({
      query: { projectId: data.projectId, _id: new Includes(ids) },
      select: { _id: true, name: true },
      skip: 0,
      limit: ids.length,
      props: { isRoot: true },
    });

    for (const service of services) {
      names.set(idOf(service.id), service.name || "");
    }

    // A service OneUptime holds no record of goes by the name its Uses flow gave it.
    for (const flow of data.flows) {
      const id: string = (flow.serviceId || "").toLowerCase();

      if (
        id &&
        !names.has(id) &&
        flow.kind === RECORD_FLOW_KINDS.uses &&
        flow.destination
      ) {
        names.set(id, flow.destination);
      }
    }

    return names;
  }
}

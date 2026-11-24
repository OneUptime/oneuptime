import DataSecurityAiProposal from "../../../Models/DatabaseModels/DataSecurityAiProposal";
import {
  DATA_SECURITY_AI_PROPOSAL_KINDS,
  DataSecurityAiAutonomy,
  DataSecurityAiProposalKind,
  DataSecurityAiProposalStatus,
  getDataSecurityAiPlanFingerprint,
} from "../../../Types/DataSecurity/DataSecurityAi";
import OneUptimeDate from "../../../Types/Date";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import {
  DATA_TYPE_DRAFT_VARIANTS,
  DataTypeDraft,
  DataTypeDraftVariant,
  DataTypeGroupField,
  DataTypeProof,
  DataTypeProofDecision,
  DataTypeProposalPlan,
  DataTypeStoreCount,
  DataTypeStoreVariantCount,
  decideDataTypeProof,
  describeShare,
  getOfferedDraft,
  readDataTypeProposalPlan,
  readDataTypeStoreCounts,
  toCustomDataTypeDefinition,
  toStoreVariantCount,
} from "../../../Utils/DataSecurity/DataTypeProposal";
import FeedMarkdown, { mdText } from "../../../Utils/Markdown/FeedMarkdown";
import {
  compileShadowDetectors,
  getShadowStoreKey,
  ShadowDraft,
  ShadowScanDetector,
  toShadowDefinition,
} from "../../../Utils/DataSecurity/ShadowCount";
import { FieldClassification } from "../../../Utils/DataSecurity/FieldClassifier";
import { UnplacedField } from "../../../Utils/DataSecurity/UnplacedFields";
import DataSecurityAiProposalService from "../../Services/DataSecurityAiProposalService";
import logger from "../Logger";
import CaptureSpan from "../Telemetry/CaptureSpan";
import { ContentScanResult, LocationFindings } from "./DataSecurityScanTypes";

/*
 * A DATA TYPE ONEUPTIME AI DRAFTED, PROVEN ON ITS STORES' NEXT SCANS
 * (#10371).
 *
 * A draft is a proposal of its own (AddDataType) from the moment it is
 * drafted, in the Proving state, which no list shows and no one is asked
 * about. While it is:
 *
 *   - every scan of a store of its group runs it in shadow, as drafted and
 *     narrowed (getShadowDetectorsForStore; a telemetry scan by its
 *     stores' services, getTelemetryShadowDetectors; a probe's in its
 *     work): counted, never found;
 *   - what each scan counted is kept on the proposal, by store
 *     (recordStoreScan) - the latest scan of each store, never a value;
 *   - once every store of the group was counted, or its proving time is
 *     over, the proof decides (Utils/DataSecurity/DataTypeProposal): it is
 *     Proposed with its numbers, as drafted or narrowed, and waits in
 *     Data Types to Review - or Expired, with why, and its group is not
 *     drafted again for DROPPED_DATA_TYPE_COOLDOWN_DAYS.
 *
 * Read and written as OneUptime (root), each read scoped to its project.
 * Never throws into a scan: a proof that cannot be read or written leaves
 * the scan as it was.
 */

// The most drafts one project proves at once.
export const MAX_PROVING_PER_PROJECT: number = 20;

// How many times a store's counts are written again after another store's won.
const WRITE_ATTEMPTS: number = 3;

export interface ProvingDataType {
  id: ObjectID;
  version: number;
  plan: DataTypeProposalPlan;
  // What the proposal's result holds besides the stores' counts.
  result: JSONObject;
  stores: Record<string, DataTypeStoreCount>;
}

// What a draft's variant is counted under in a scan's result.
export function getShadowKey(
  proposalId: ObjectID | string,
  variant: DataTypeDraftVariant,
): string {
  return `${proposalId.toString()}:${variant}`;
}

// The drafts a proposal runs in shadow: as drafted, and narrowed.
export function getShadowDrafts(proving: ProvingDataType): Array<ShadowDraft> {
  return DATA_TYPE_DRAFT_VARIANTS.map(
    (variant: DataTypeDraftVariant): ShadowDraft => {
      const draft: DataTypeDraft =
        variant === DataTypeDraftVariant.Narrowed
          ? proving.plan.narrowed
          : proving.plan.draft;
      return {
        key: getShadowKey(proving.id, variant),
        definition: toShadowDefinition(
          toCustomDataTypeDefinition(draft, "shadow"),
        ),
      };
    },
  );
}

function isOfStore(proving: ProvingDataType, dataStoreId: string): boolean {
  const storeId: string = dataStoreId.toLowerCase();

  return proving.plan.fields.some((field: DataTypeGroupField): boolean => {
    return field.dataStoreId.toLowerCase() === storeId;
  });
}

/*
 * How many of a field's values the scan read, for a field of the group the
 * draft found nothing in: from the field's description as an unplaced
 * field, or from its findings - placed since, by something else.
 */
export function readScannedValues(
  result: ContentScanResult,
  location: string,
): number {
  const unplaced: UnplacedField | undefined = (
    result.unplacedFields || []
  ).find((field: UnplacedField): boolean => {
    return field.location === location;
  });

  if (unplaced) {
    return unplaced.valueCount;
  }

  const placed: LocationFindings | undefined = result.locations.find(
    (entry: LocationFindings): boolean => {
      return entry.location === location;
    },
  );

  return (placed?.classifications || []).reduce(
    (most: number, classification: FieldClassification): number => {
      return Math.max(most, classification.valueCount || 0);
    },
    0,
  );
}

// A share as the English words of a proposal say it: 98%, 0.1%.
function shareText(matched: number, values: number): string {
  return describeShare(values > 0 ? matched / values : 0);
}

function plural(count: number, one: string, other: string): string {
  return `${count} ${count === 1 ? one : other}`;
}

/*
 * The proposal's words, in English as every proposal's are kept - the
 * Dashboard draws its own from the plan, in the reader's language.
 */
export function describeDataTypeProposal(plan: DataTypeProposalPlan): {
  title: string;
  changeMarkdown: string;
  reasonMarkdown: string;
  proofMarkdown: string;
  undoMarkdown: string;
} {
  const draft: DataTypeDraft = getOfferedDraft(plan);
  const proof: DataTypeProof | undefined = plan.proof;
  const where: string = `${plural(plan.fieldCount, "field", "fields")} of ${plural(plan.storeCount, "store", "stores")}`;

  const proofMarkdown: string = proof
    ? FeedMarkdown.join(
        [
          mdText`Proven on the scans of ${String(proof.storesCounted)} of its ${String(proof.storesInGroup)} stores: it matches ${shareText(proof.groupMatched, proof.groupValues)} of the values in ${String(proof.fieldsCounted)} of its ${String(proof.fieldsInGroup)} fields, and ${shareText(proof.elsewhereMatched, proof.elsewhereValues)} of values elsewhere in the same stores.`,
          ...(proof.variant === DataTypeDraftVariant.Narrowed
            ? [
                mdText`As first drafted it matched too much elsewhere, so outside these fields it counts a value only beside one of its keywords.`,
              ]
            : []),
        ],
        " ",
      ).toString()
    : mdText`It is counted on the next scan of each of its stores, before anyone is asked.`.toString();

  return {
    title: `Add the data type ${draft.name}, found in ${where}`.slice(0, 500),
    changeMarkdown: FeedMarkdown.join(
      [
        mdText`Adds **${draft.name}** to Your Data Types (${draft.category}, ${draft.sensitivity}), found by the pattern \`${draft.pattern}\`, from your next scans on.`,
        mdText`Add Data Type opens the form filled in, to change anything before you save it.`,
      ],
      " ",
    ).toString(),
    reasonMarkdown: FeedMarkdown.join(
      [
        mdText`OneUptime AI found the same kind of value, under the same kind of name, in ${where} that no detector could place.`,
        ...(plan.reason ? [mdText`${plan.reason}`] : []),
      ],
      " ",
    ).toString(),
    proofMarkdown,
    undoMarkdown:
      mdText`Delete the data type under Data Security > Settings > Data Types: scans stop finding it.`.toString(),
  };
}

// The most projects one look for drafts whose proving time ran out reads.
const MAX_PROVING_PROJECTS: number = 5_000;

export default class DataTypeProving {
  /*
   * The projects with drafts being proven: each is decided once its time is
   * over, whether or not a scan of its stores comes (the Workers' hourly
   * look queues each project's discovery, which decides them first).
   */
  @CaptureSpan()
  public static async listProvingProjectIds(): Promise<Array<ObjectID>> {
    const rows: Array<DataSecurityAiProposal> =
      await DataSecurityAiProposalService.findBy({
        query: {
          kind: DataSecurityAiProposalKind.AddDataType,
          status: DataSecurityAiProposalStatus.Proving,
        },
        select: { _id: true, projectId: true },
        skip: 0,
        limit: MAX_PROVING_PROJECTS,
        props: { isRoot: true },
      });
    const ids: Map<string, ObjectID> = new Map();

    for (const row of rows) {
      if (row.projectId) {
        ids.set(row.projectId.toString(), row.projectId);
      }
    }

    return Array.from(ids.values());
  }

  // The project's drafts being proven, read as OneUptime.
  @CaptureSpan()
  public static async readProving(
    projectId: ObjectID,
  ): Promise<Array<ProvingDataType>> {
    const rows: Array<DataSecurityAiProposal> =
      await DataSecurityAiProposalService.findBy({
        query: {
          projectId,
          kind: DataSecurityAiProposalKind.AddDataType,
          status: DataSecurityAiProposalStatus.Proving,
        },
        select: { _id: true, version: true, plan: true, result: true },
        skip: 0,
        limit: MAX_PROVING_PER_PROJECT,
        props: { isRoot: true },
      });
    const proving: Array<ProvingDataType> = [];

    for (const row of rows) {
      const plan: DataTypeProposalPlan | null = readDataTypeProposalPlan(
        row.plan,
      );

      if (!row.id || !plan) {
        continue;
      }

      const result: JSONObject =
        row.result && typeof row.result === "object" ? row.result : {};

      proving.push({
        id: row.id,
        version: row.version || 0,
        plan,
        result,
        stores: readDataTypeStoreCounts(result["stores"]),
      });
    }

    return proving;
  }

  /*
   * The drafts a store's scan runs in shadow: those being proven on it.
   * None when they cannot be read - the scan runs as it would have.
   */
  @CaptureSpan()
  public static async getShadowDrafts(data: {
    projectId: ObjectID;
    dataStoreId: ObjectID;
  }): Promise<Array<ShadowDraft>> {
    try {
      return (await this.readProving(data.projectId))
        .filter((proving: ProvingDataType): boolean => {
          return isOfStore(proving, data.dataStoreId.toString());
        })
        .flatMap(getShadowDrafts);
    } catch (error) {
      logger.warn(
        `DataSecurity: could not read the data types being proven on store ${data.dataStoreId.toString()}; it is scanned without them:`,
      );
      logger.warn(error);
      return [];
    }
  }

  public static async getShadowDetectorsForStore(data: {
    projectId: ObjectID;
    dataStoreId: ObjectID;
  }): Promise<Array<ShadowScanDetector>> {
    return compileShadowDetectors(await this.getShadowDrafts(data));
  }

  /*
   * A telemetry scan's drafts, by the store each runs on (its kind and
   * service, getShadowStoreKey): a scan reads every service at once.
   */
  @CaptureSpan()
  public static async getTelemetryShadowDetectors(
    projectId: ObjectID,
  ): Promise<Map<string, Array<ShadowScanDetector>>> {
    const byStore: Map<string, Array<ShadowScanDetector>> = new Map();

    try {
      for (const proving of await this.readProving(projectId)) {
        const detectors: Array<ShadowScanDetector> = compileShadowDetectors(
          getShadowDrafts(proving),
        );
        const stores: Set<string> = new Set();

        for (const field of proving.plan.fields) {
          if (field.serviceId) {
            stores.add(getShadowStoreKey(field.storeKind, field.serviceId));
          }
        }

        for (const store of stores) {
          byStore.set(store, [...(byStore.get(store) || []), ...detectors]);
        }
      }
    } catch (error) {
      logger.warn(
        `DataSecurity: could not read the data types being proven on project ${projectId.toString()}'s telemetry; it is scanned without them:`,
      );
      logger.warn(error);
    }

    return byStore;
  }

  /*
   * A store's scan, for the drafts being proven on it: what it counted of
   * each, kept on the draft's proposal as the store's latest count - then
   * each proof is decided, if it can be. Never throws.
   */
  @CaptureSpan()
  public static async recordStoreScan(data: {
    projectId: ObjectID;
    dataStoreId: ObjectID;
    result: ContentScanResult;
    scannedAt: Date;
  }): Promise<number> {
    const counts: ContentScanResult["shadowCounts"] = data.result.shadowCounts;

    if (!counts || Object.keys(counts).length === 0) {
      return 0;
    }

    let recorded: number = 0;

    try {
      const proving: Array<ProvingDataType> = (
        await this.readProving(data.projectId)
      ).filter((entry: ProvingDataType): boolean => {
        return isOfStore(entry, data.dataStoreId.toString());
      });

      for (const entry of proving) {
        const storeId: string = data.dataStoreId.toString();
        const groupLocations: Array<string> = entry.plan.fields
          .filter((field: DataTypeGroupField): boolean => {
            return field.dataStoreId.toLowerCase() === storeId.toLowerCase();
          })
          .map((field: DataTypeGroupField): string => {
            return field.location;
          });
        const variants: Partial<
          Record<DataTypeDraftVariant, DataTypeStoreVariantCount>
        > = {};

        for (const variant of DATA_TYPE_DRAFT_VARIANTS) {
          const count: DataTypeStoreVariantCount | null = toStoreVariantCount({
            counted: counts[getShadowKey(entry.id, variant)],
            groupLocations,
            readFieldValues: (location: string): number => {
              return readScannedValues(data.result, location);
            },
          });

          if (count) {
            variants[variant] = count;
          }
        }

        if (Object.keys(variants).length === 0) {
          continue;
        }

        const written: boolean = await this.writeStoreCount({
          proposalId: entry.id,
          projectId: data.projectId,
          dataStoreId: storeId,
          count: { scannedAt: data.scannedAt.toISOString(), variants },
        });

        if (written) {
          recorded++;
          await this.finishIfDecided({
            projectId: data.projectId,
            proposalId: entry.id,
            now: data.scannedAt,
          });
        }
      }
    } catch (error) {
      logger.error(
        `DataSecurity: could not record what the data types being proven found on store ${data.dataStoreId.toString()}:`,
      );
      logger.error(error);
    }

    return recorded;
  }

  // A store's count onto its proposal, on the version read, read again when another won.
  private static async writeStoreCount(data: {
    proposalId: ObjectID;
    projectId: ObjectID;
    dataStoreId: string;
    count: DataTypeStoreCount;
  }): Promise<boolean> {
    for (let attempt: number = 0; attempt < WRITE_ATTEMPTS; attempt++) {
      const latest: DataSecurityAiProposal | null =
        await DataSecurityAiProposalService.findOneBy({
          query: {
            _id: data.proposalId,
            projectId: data.projectId,
            status: DataSecurityAiProposalStatus.Proving,
          },
          select: { _id: true, version: true, result: true },
          props: { isRoot: true },
        });

      if (!latest?.id) {
        return false;
      }

      const result: JSONObject =
        latest.result && typeof latest.result === "object" ? latest.result : {};
      const stores: JSONObject = {
        ...((result["stores"] as JSONObject | undefined) || {}),
        [data.dataStoreId]: data.count as unknown as JSONObject,
      };
      const changed: number =
        await DataSecurityAiProposalService.attemptProvingResult({
          proposalId: latest.id,
          atVersion: latest.version || 0,
          result: { ...result, stores },
        });

      if (changed > 0) {
        return true;
      }
    }

    return false;
  }

  /*
   * A draft's proof decided, if it can be: every store of its group
   * counted, or its proving time over. Proposed with its numbers, or
   * Expired with why. Returns what it decided.
   */
  @CaptureSpan()
  public static async finishIfDecided(data: {
    projectId: ObjectID;
    proposalId: ObjectID;
    now: Date;
  }): Promise<DataTypeProofDecision["outcome"] | null> {
    const row: DataSecurityAiProposal | null =
      await DataSecurityAiProposalService.findOneBy({
        query: {
          _id: data.proposalId,
          projectId: data.projectId,
          status: DataSecurityAiProposalStatus.Proving,
        },
        select: { _id: true, plan: true, result: true },
        props: { isRoot: true },
      });
    const plan: DataTypeProposalPlan | null = readDataTypeProposalPlan(
      row?.plan,
    );

    if (!row?.id || !plan) {
      return null;
    }

    const result: JSONObject =
      row.result && typeof row.result === "object" ? row.result : {};
    const decision: DataTypeProofDecision = decideDataTypeProof({
      plan,
      stores: readDataTypeStoreCounts(result["stores"]),
      now: data.now,
    });

    if (decision.outcome === "waiting") {
      return decision.outcome;
    }

    if (decision.outcome === "drop") {
      await DataSecurityAiProposalService.attemptTransition({
        proposalId: row.id,
        fromStatuses: [DataSecurityAiProposalStatus.Proving],
        set: {
          status: DataSecurityAiProposalStatus.Expired,
          expiredAt: data.now,
          result: {
            ...result,
            dropReason: decision.reason,
            ...(decision.proof
              ? { proof: decision.proof as unknown as JSONObject }
              : {}),
          },
        },
      });

      logger.info(
        `DataSecurity: the data type OneUptime AI drafted for project ${data.projectId.toString()} (proposal ${row.id.toString()}) was dropped: ${decision.reason}.`,
      );

      return decision.outcome;
    }

    const proven: DataTypeProposalPlan = { ...plan, proof: decision.proof };
    const words: ReturnType<typeof describeDataTypeProposal> =
      describeDataTypeProposal(proven);

    await DataSecurityAiProposalService.attemptTransition({
      proposalId: row.id,
      fromStatuses: [DataSecurityAiProposalStatus.Proving],
      set: {
        status: DataSecurityAiProposalStatus.Proposed,
        plan: proven as unknown as JSONObject,
        planFingerprint: getDataSecurityAiPlanFingerprint({
          kind: DataSecurityAiProposalKind.AddDataType,
          plan: proven as unknown as JSONObject,
        }),
        title: words.title,
        changeMarkdown: words.changeMarkdown,
        reasonMarkdown: words.reasonMarkdown,
        proofMarkdown: words.proofMarkdown,
        undoMarkdown: words.undoMarkdown,
      },
    });

    return decision.outcome;
  }

  /*
   * Every draft of the project whose proof can be decided now: its stores
   * all counted, or its proving time over - so a group whose stores are
   * never scanned is decided all the same. Never throws.
   */
  @CaptureSpan()
  public static async finishProofs(data: {
    projectId: ObjectID;
    now?: Date | undefined;
  }): Promise<number> {
    const now: Date = data.now || OneUptimeDate.getCurrentDate();
    let decided: number = 0;

    try {
      for (const proving of await this.readProving(data.projectId)) {
        const outcome: DataTypeProofDecision["outcome"] | null =
          await this.finishIfDecided({
            projectId: data.projectId,
            proposalId: proving.id,
            now,
          });

        if (outcome && outcome !== "waiting") {
          decided++;
        }
      }
    } catch (error) {
      logger.error(
        `DataSecurity: could not decide the data types being proven for project ${data.projectId.toString()}:`,
      );
      logger.error(error);
    }

    return decided;
  }

  /*
   * A draft, made a proposal being proven (#10371): for the project, never
   * an issue or a store, for a person to approve once proven - it never
   * runs without asking. Returns its id.
   */
  @CaptureSpan()
  public static async startProving(data: {
    projectId: ObjectID;
    plan: DataTypeProposalPlan;
  }): Promise<ObjectID | null> {
    const proposal: DataSecurityAiProposal = new DataSecurityAiProposal();
    const words: ReturnType<typeof describeDataTypeProposal> =
      describeDataTypeProposal(data.plan);
    const definition: (typeof DATA_SECURITY_AI_PROPOSAL_KINDS)[DataSecurityAiProposalKind.AddDataType] =
      DATA_SECURITY_AI_PROPOSAL_KINDS[DataSecurityAiProposalKind.AddDataType];

    proposal.projectId = data.projectId;
    proposal.kind = DataSecurityAiProposalKind.AddDataType;
    proposal.work = definition.work;
    proposal.safety = definition.safety;
    proposal.status = DataSecurityAiProposalStatus.Proving;
    proposal.title = words.title;
    proposal.changeMarkdown = words.changeMarkdown;
    proposal.reasonMarkdown = words.reasonMarkdown;
    proposal.proofMarkdown = words.proofMarkdown;
    proposal.undoMarkdown = words.undoMarkdown;
    proposal.plan = data.plan as unknown as JSONObject;
    proposal.planKey = data.plan.groupKey.slice(0, 100);
    proposal.planFingerprint = getDataSecurityAiPlanFingerprint({
      kind: DataSecurityAiProposalKind.AddDataType,
      plan: data.plan as unknown as JSONObject,
    });
    // A type in more fields waits ahead of one in fewer.
    proposal.riskScore = Math.min(100, data.plan.fieldCount * 5);
    proposal.autonomy = DataSecurityAiAutonomy.Suggest;
    proposal.result = { stores: {} };

    const created: DataSecurityAiProposal =
      await DataSecurityAiProposalService.create({
        data: proposal,
        props: { isRoot: true },
      });

    return created.id || null;
  }
}

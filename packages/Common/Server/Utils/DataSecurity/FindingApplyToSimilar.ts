import DataStore from "../../../Models/DatabaseModels/DataStore";
import DataStoreFinding from "../../../Models/DatabaseModels/DataStoreFinding";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import Includes from "../../../Types/BaseDatabase/Includes";
import {
  DataSecurityApplyToSimilarResult,
  DataSecuritySimilarFinding,
  DataSecuritySimilarFindings,
} from "../../../Types/DataSecurity/DataSecurityApiTypes";
import {
  DataStoreFindingDecision,
  getPersonDecision,
} from "../../../Types/DataSecurity/DataStoreFindingVerdict";
import BadDataException from "../../../Types/Exception/BadDataException";
import NotFoundException from "../../../Types/Exception/NotFoundException";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import {
  areFindingsSimilar,
  getFindingNameKey,
} from "../../../Utils/DataSecurity/FindingJudgement";
import DataStoreFindingService from "../../Services/DataStoreFindingService";
import DataStoreService from "../../Services/DataStoreService";
import QueryHelper from "../../Types/Database/QueryHelper";
import logger from "../Logger";
import CaptureSpan from "../Telemetry/CaptureSpan";

/*
 * ONE DECISION SETTLES EVERY FINDING LIKE IT (#10372).
 *
 * After a person confirms a finding or marks it not sensitive, Apply to
 * similar lists the findings alike it (FindingJudgement.areFindingsSimilar:
 * the same data type, in a field of the same name) on this store and every
 * other one, that nobody decided yet - and makes the same decision on the
 * ones the person keeps ticked, with the reason they gave.
 *
 * Everything is the person's own, never OneUptime's:
 *
 *   - the finding they decided, the similar ones and the stores they are on
 *     are read with their own permissions: a store they may not read is not
 *     listed, and its findings are not changed;
 *   - each decision is written as their own update of the finding, under
 *     its own permission check and hooks (DataStoreFindingService): its
 *     store is evaluated again, the decision is precedent, and a mark of
 *     not sensitive is theirs - never OneUptime AI's;
 *   - what the page sends is only which findings stay ticked: the server
 *     lists the similar ones again and decides only those still similar,
 *     still undecided and still readable. A finding decided in between is
 *     left as it was decided.
 *
 * Only what is alike by name is ever listed: MeaningSearch, which ranks a
 * verdict's precedent, never picks what a decision is applied to.
 */

// The most similar findings listed, and decided at once.
export const MAX_SIMILAR_FINDINGS: number = 200;

// The most undecided findings of the type read to find the similar ones.
export const MAX_FINDINGS_OF_TYPE_READ: number = 5000;

export const SIMILAR_FINDING_NOT_FOUND_MESSAGE: string =
  "This finding could not be found.";

export const DECIDE_FIRST_MESSAGE: string =
  "Confirm this finding or mark it as not sensitive first: Apply to similar makes the same decision on the findings like it.";

const FINDING_SELECT: {
  _id: true;
  dataStoreId: true;
  dataTypeId: true;
  dataTypeName: true;
  location: true;
  locationKind: true;
  isFreeText: true;
  confidence: true;
  aiVerdict: true;
  isSuppressed: true;
  isConfirmed: true;
  isConfirmedByAi: true;
  suppressedReason: true;
} = {
  _id: true,
  dataStoreId: true,
  dataTypeId: true,
  dataTypeName: true,
  location: true,
  locationKind: true,
  isFreeText: true,
  confidence: true,
  aiVerdict: true,
  isSuppressed: true,
  isConfirmed: true,
  isConfirmedByAi: true,
  suppressedReason: true,
};

function idOf(row: { id?: ObjectID | null; _id?: unknown } | null): string {
  return (row?.id?.toString() || String(row?._id || "")).toLowerCase();
}

// The ticked findings a page sends: ids, each once, at most MAX_SIMILAR_FINDINGS.
export function readTickedFindingIds(value: unknown): Array<string> {
  if (!Array.isArray(value)) {
    throw new BadDataException(
      "Say which findings to apply the decision to, as a list of their ids.",
    );
  }

  const ids: Array<string> = [];

  for (const entry of value) {
    const id: string = typeof entry === "string" ? entry.trim().toLowerCase() : "";

    if (ObjectID.isValidUUID(id) && !ids.includes(id)) {
      ids.push(id);
    }
  }

  return ids.slice(0, MAX_SIMILAR_FINDINGS);
}

export default class FindingApplyToSimilar {
  /*
   * The finding a person decided, and the undecided findings like it they
   * may read, on the stores they may read - this store's other places
   * first, then by store and place.
   */
  @CaptureSpan()
  public static async listSimilar(data: {
    props: DatabaseCommonInteractionProps;
    projectId: ObjectID;
    findingId: unknown;
  }): Promise<DataSecuritySimilarFindings> {
    const source: DataStoreFinding = await FindingApplyToSimilar.readSource(
      data,
    );
    const decision: DataStoreFindingDecision | null = getPersonDecision(source);
    const base: DataSecuritySimilarFindings = {
      findingId: idOf(source),
      decision: decision || "",
      reason:
        decision === DataStoreFindingDecision.NotSensitive
          ? source.suppressedReason || ""
          : "",
      hasName: getFindingNameKey(source) !== null,
      findings: [],
    };

    if (!base.hasName) {
      return base;
    }

    const candidates: Array<DataStoreFinding> =
      await DataStoreFindingService.findBy({
        query: {
          projectId: data.projectId,
          dataTypeId: source.dataTypeId || "",
          isSuppressed: false,
          isConfirmed: false,
          _id: QueryHelper.notEquals(idOf(source)),
        },
        select: FINDING_SELECT,
        skip: 0,
        limit: MAX_FINDINGS_OF_TYPE_READ,
        props: data.props,
      });
    const similar: Array<DataStoreFinding> = candidates.filter(
      (candidate: DataStoreFinding): boolean => {
        return (
          idOf(candidate) !== idOf(source) &&
          areFindingsSimilar(source, candidate)
        );
      },
    );

    if (similar.length === 0) {
      return base;
    }

    const stores: Map<string, DataStore> =
      await FindingApplyToSimilar.readStores({
        props: data.props,
        projectId: data.projectId,
        dataStoreIds: similar.map((finding: DataStoreFinding): string => {
          return finding.dataStoreId?.toString().toLowerCase() || "";
        }),
      });
    const sourceStoreId: string =
      source.dataStoreId?.toString().toLowerCase() || "";
    const findings: Array<DataSecuritySimilarFinding> = [];

    for (const finding of similar) {
      const storeId: string = finding.dataStoreId?.toString().toLowerCase() || "";
      const store: DataStore | undefined = stores.get(storeId);

      // A store the person may not read, or one gone from its cloud: not listed.
      if (!store || store.isArchived) {
        continue;
      }

      findings.push({
        findingId: idOf(finding),
        dataStoreId: storeId,
        storeName: store.name || "",
        storeKind: store.kind || "",
        location: finding.location || "",
        locationKind: finding.locationKind || "",
        dataTypeId: finding.dataTypeId || "",
        dataTypeName: finding.dataTypeName || "",
        confidence: finding.confidence || "",
        aiVerdict: finding.aiVerdict || "",
        isSameStore: storeId === sourceStoreId,
      });
    }

    findings.sort(
      (a: DataSecuritySimilarFinding, b: DataSecuritySimilarFinding): number => {
        return (
          Number(b.isSameStore) - Number(a.isSameStore) ||
          a.storeName.localeCompare(b.storeName) ||
          a.location.localeCompare(b.location)
        );
      },
    );

    return { ...base, findings: findings.slice(0, MAX_SIMILAR_FINDINGS) };
  }

  /*
   * The person's decision on the finding they decided, made on each ticked
   * finding still like it, undecided and readable - as their own update.
   */
  @CaptureSpan()
  public static async applyToSimilar(data: {
    props: DatabaseCommonInteractionProps;
    projectId: ObjectID;
    findingId: unknown;
    findingIds: unknown;
  }): Promise<DataSecurityApplyToSimilarResult> {
    const ticked: Array<string> = readTickedFindingIds(data.findingIds);
    const listed: DataSecuritySimilarFindings =
      await FindingApplyToSimilar.listSimilar(data);

    if (
      listed.decision !== DataStoreFindingDecision.NotSensitive &&
      listed.decision !== DataStoreFindingDecision.Confirmed
    ) {
      throw new BadDataException(DECIDE_FIRST_MESSAGE);
    }

    const stillSimilar: Set<string> = new Set(
      listed.findings.map((finding: DataSecuritySimilarFinding): string => {
        return finding.findingId;
      }),
    );
    const update: JSONObject =
      listed.decision === DataStoreFindingDecision.NotSensitive
        ? { isSuppressed: true, suppressedReason: listed.reason }
        : { isConfirmed: true };
    const result: DataSecurityApplyToSimilarResult = {
      decision: listed.decision,
      applied: 0,
      skipped: 0,
    };

    for (const id of ticked) {
      if (!stillSimilar.has(id)) {
        result.skipped++;
        continue;
      }

      try {
        await DataStoreFindingService.updateOneById({
          id: new ObjectID(id),
          data: update as never,
          props: data.props,
        });
        result.applied++;
      } catch (error) {
        // Refused for this one (its permission, a store changed): the rest go on.
        logger.debug(
          `DataSecurity: a decision was not applied to finding ${id}: ${error}`,
        );
        result.skipped++;
      }
    }

    return result;
  }

  private static async readSource(data: {
    props: DatabaseCommonInteractionProps;
    projectId: ObjectID;
    findingId: unknown;
  }): Promise<DataStoreFinding> {
    const id: string =
      typeof data.findingId === "string" ? data.findingId.trim() : "";

    if (!ObjectID.isValidUUID(id)) {
      throw new NotFoundException(SIMILAR_FINDING_NOT_FOUND_MESSAGE);
    }

    const source: DataStoreFinding | null =
      await DataStoreFindingService.findOneBy({
        query: { _id: new ObjectID(id), projectId: data.projectId },
        select: FINDING_SELECT,
        props: data.props,
      });

    if (!source?.id) {
      throw new NotFoundException(SIMILAR_FINDING_NOT_FOUND_MESSAGE);
    }

    return source;
  }

  // The stores of the similar findings the person may read, by id.
  private static async readStores(data: {
    props: DatabaseCommonInteractionProps;
    projectId: ObjectID;
    dataStoreIds: Array<string>;
  }): Promise<Map<string, DataStore>> {
    const ids: Array<string> = [
      ...new Set(
        data.dataStoreIds.filter((id: string): boolean => {
          return ObjectID.isValidUUID(id);
        }),
      ),
    ];
    const stores: Map<string, DataStore> = new Map();

    if (ids.length === 0) {
      return stores;
    }

    const rows: Array<DataStore> = await DataStoreService.findBy({
      query: {
        projectId: data.projectId,
        _id: new Includes(
          ids.map((id: string): ObjectID => {
            return new ObjectID(id);
          }),
        ),
      },
      select: { _id: true, name: true, kind: true, isArchived: true },
      skip: 0,
      limit: ids.length,
      props: data.props,
    });

    for (const row of rows) {
      stores.set(idOf(row), row);
    }

    return stores;
  }
}

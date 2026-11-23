import DataSecuritySetting from "../../../../Models/DatabaseModels/DataSecuritySetting";
import DataStore from "../../../../Models/DatabaseModels/DataStore";
import DataStoreFinding from "../../../../Models/DatabaseModels/DataStoreFinding";
import Project from "../../../../Models/DatabaseModels/Project";
import Includes from "../../../../Types/BaseDatabase/Includes";
import SortOrder from "../../../../Types/BaseDatabase/SortOrder";
import OneUptimeDate from "../../../../Types/Date";
import {
  DataSecurityAiAutonomy,
  DataSecurityAiChangeSafety,
  DataSecurityAiWithoutAskingVerdict,
  DataSecurityAiWorkDecision,
  getDataSecurityAiWithoutAskingVerdict,
} from "../../../../Types/DataSecurity/DataSecurityAi";
import {
  getDataTypesToTurnOff,
  getLocationsToExclude,
  SCAN_TUNING_LIMITS,
  TuningFinding,
} from "../../../../Types/DataSecurity/DataSecurityScanTuning";
import {
  DataSecurityAiDecisionEntry,
  DataSecurityAiDecisionReason,
} from "../../../../Types/DataSecurity/DataSecurityAiDecision";
import { getBuiltInDataType } from "../../../../Types/DataSecurity/DataTypeCatalog";
import ObjectID from "../../../../Types/ObjectID";
import DataSecuritySettingService from "../../../Services/DataSecuritySettingService";
import DataStoreFindingService from "../../../Services/DataStoreFindingService";
import DataStoreService from "../../../Services/DataStoreService";
import ProjectService from "../../../Services/ProjectService";
import logger from "../../Logger";
import CaptureSpan from "../../Telemetry/CaptureSpan";
import {
  AddScanExclusionAction,
  planAddScanExclusion,
  planTurnOffDataType,
  TurnOffDataTypeAction,
} from "./Actions/ScanTuningActions";
import DataSecurityAiProposals from "./DataSecurityAiProposals";

/*
 * WHAT THE TEAM'S DECISIONS SAY OF ITS SCANS, PROPOSED (#10372).
 *
 * A few minutes after a person marks a finding not sensitive (queued by
 * DataStoreFindingService, once for several), the project's marks are read
 * and OneUptime AI proposes, for a person to approve in Data Security > AI:
 *
 *   - turning off a built-in data type every finding of which was marked
 *     not sensitive (TurnOffDataType);
 *   - leaving out of a store's scans a location every finding at which was
 *     (AddScanExclusion), where its scanner can leave that place out.
 *
 * The rules of what is enough are Types/DataSecurity/DataSecurityScanTuning's;
 * this reads the findings they are decided from. A type with more findings
 * than one read holds is left alone: "every finding" is never guessed.
 * Each proposal always asks (ChangesWhatScansLookFor), and the same change
 * is never proposed twice - nor again once a person dismissed or undid it.
 * Plain code: no model is asked. Under the project's two switches, as all
 * of OneUptime AI's work on its own is. Never Sensitive is never proposed.
 * Read as OneUptime (root), the project scoped explicitly. Never throws.
 */

// The most marks of not sensitive one look reads.
export const MAX_DISMISSED_FINDINGS_READ: number = 5000;

// The most findings of one data type, or at one place, read to know every one was marked.
export const MAX_FINDINGS_READ_PER_CANDIDATE: number = 2000;

export interface ScanTuningOutcome {
  skipped: "ai-off" | null;
  typesProposed: number;
  exclusionsProposed: number;
}

const TUNING_SELECT: {
  _id: true;
  dataStoreId: true;
  dataTypeId: true;
  location: true;
  locationKind: true;
  isSuppressed: true;
  isAiSuggested: true;
} = {
  _id: true,
  dataStoreId: true,
  dataTypeId: true,
  location: true,
  locationKind: true,
  isSuppressed: true,
  isAiSuggested: true,
};

function toTuningFinding(row: DataStoreFinding): TuningFinding {
  return {
    id: row.id?.toString() || "",
    dataStoreId: row.dataStoreId?.toString().toLowerCase() || "",
    dataTypeId: row.dataTypeId || "",
    location: row.location || "",
    locationKind: row.locationKind || undefined,
    isSuppressed: row.isSuppressed === true,
    isAiSuggested: row.isAiSuggested === true,
  };
}

export default class DataSecurityScanTuning {
  @CaptureSpan()
  public static async proposeForProject(data: {
    projectId: ObjectID;
    now?: Date | undefined;
  }): Promise<ScanTuningOutcome> {
    const now: Date = data.now || OneUptimeDate.getCurrentDate();
    const outcome: ScanTuningOutcome = {
      skipped: null,
      typesProposed: 0,
      exclusionsProposed: 0,
    };

    try {
      const project: Project | null = await ProjectService.findOneById({
        id: data.projectId,
        select: {
          _id: true,
          enableAi: true,
          enableAutomaticDataSecurityAi: true,
          requireTwoApprovalsForRiskierFixes: true,
        },
        props: { isRoot: true },
      });

      if (
        !project ||
        project.enableAi === false ||
        project.enableAutomaticDataSecurityAi !== true
      ) {
        return { ...outcome, skipped: "ai-off" };
      }

      const dismissed: Array<TuningFinding> = (
        await DataStoreFindingService.findBy({
          query: {
            projectId: data.projectId,
            isSuppressed: true,
            isAiSuggested: false,
          },
          select: TUNING_SELECT,
          sort: { updatedAt: SortOrder.Descending },
          skip: 0,
          limit: MAX_DISMISSED_FINDINGS_READ,
          props: { isRoot: true },
        })
      ).map(toTuningFinding);

      if (dismissed.length === 0) {
        return outcome;
      }

      // Every proposal here asks: what the scans look for is a person's to change.
      const work: DataSecurityAiWorkDecision = {
        autonomy: DataSecurityAiAutonomy.Suggest,
        fromDefaults: true,
      };
      const verdict: DataSecurityAiWithoutAskingVerdict =
        getDataSecurityAiWithoutAskingVerdict({
          work,
          safety: DataSecurityAiChangeSafety.ChangesWhatScansLookFor,
          meetsDefaultConditions: false,
          isNamedByRule: false,
          requireTwoApprovalsForRiskierChanges:
            project.requireTwoApprovalsForRiskierFixes === true,
          changesWithoutAskingThisHour: 0,
        });

      outcome.typesProposed = await DataSecurityScanTuning.proposeTypes({
        projectId: data.projectId,
        dismissed,
        work,
        verdict,
        now,
      });
      outcome.exclusionsProposed =
        await DataSecurityScanTuning.proposeExclusions({
          projectId: data.projectId,
          dismissed,
          work,
          verdict,
          now,
        });

      return outcome;
    } catch (error) {
      logger.error(
        `DataSecurity tuning: could not look at what project ${data.projectId.toString()}'s decisions say of its scans: ${error}`,
      );
      return outcome;
    }
  }

  // The built-in types every finding of which was marked not sensitive.
  private static async proposeTypes(data: {
    projectId: ObjectID;
    dismissed: Array<TuningFinding>;
    work: DataSecurityAiWorkDecision;
    verdict: DataSecurityAiWithoutAskingVerdict;
    now: Date;
  }): Promise<number> {
    // The candidates: built-in types with enough marks, on enough stores.
    const marks: Map<string, { count: number; stores: Set<string> }> =
      new Map();

    for (const finding of data.dismissed) {
      if (!getBuiltInDataType(finding.dataTypeId)) {
        continue;
      }

      const entry: { count: number; stores: Set<string> } = marks.get(
        finding.dataTypeId,
      ) || { count: 0, stores: new Set() };

      entry.count++;
      entry.stores.add(finding.dataStoreId);
      marks.set(finding.dataTypeId, entry);
    }

    const setting: DataSecuritySetting =
      await DataSecuritySettingService.getOrCreateForProject(data.projectId);
    const disabled: Set<string> = new Set(
      Array.isArray(setting.disabledDataTypeIds)
        ? setting.disabledDataTypeIds
        : [],
    );
    const findings: Array<TuningFinding> = [];

    for (const [dataTypeId, entry] of marks) {
      if (
        disabled.has(dataTypeId) ||
        entry.count < SCAN_TUNING_LIMITS.minFindingsToTurnOff ||
        entry.stores.size < SCAN_TUNING_LIMITS.minStoresToTurnOff
      ) {
        continue;
      }

      const rows: Array<DataStoreFinding> = await DataStoreFindingService.findBy(
        {
          query: { projectId: data.projectId, dataTypeId },
          select: TUNING_SELECT,
          skip: 0,
          limit: MAX_FINDINGS_READ_PER_CANDIDATE,
          props: { isRoot: true },
        },
      );

      // More than one read holds: whether every one was marked is not known.
      if (rows.length >= MAX_FINDINGS_READ_PER_CANDIDATE) {
        continue;
      }

      findings.push(...rows.map(toTuningFinding));
    }

    let proposed: number = 0;

    for (const type of getDataTypesToTurnOff({
      findings,
      disabledDataTypeIds: disabled,
    }).slice(0, SCAN_TUNING_LIMITS.maxTurnOffProposalsPerRun)) {
      const entry: DataSecurityAiDecisionEntry =
        await DataSecurityAiProposals.propose({
        projectId: data.projectId,
        issue: null,
        store: null,
        action: TurnOffDataTypeAction,
        change: planTurnOffDataType({
          dataTypeId: type.dataTypeId,
          dataTypeName: getBuiltInDataType(type.dataTypeId)?.name || "",
          findings: type.findings,
          stores: type.stores,
        }),
        work: data.work,
        verdict: data.verdict,
        // A type of more findings waits ahead of one of fewer.
        riskScore: Math.min(100, type.findings),
        now: data.now,
      });

      // Proposed before, dismissed or undone: never again.
      if (entry.reason === DataSecurityAiDecisionReason.Proposed) {
        proposed++;
      }
    }

    return proposed;
  }

  // The places of stores every finding at which was marked not sensitive.
  private static async proposeExclusions(data: {
    projectId: ObjectID;
    dismissed: Array<TuningFinding>;
    work: DataSecurityAiWorkDecision;
    verdict: DataSecurityAiWithoutAskingVerdict;
    now: Date;
  }): Promise<number> {
    const places: Map<
      string,
      { dataStoreId: string; location: string; count: number }
    > = new Map();

    for (const finding of data.dismissed) {
      const key: string = `${finding.dataStoreId}|${finding.location}`;
      const entry: { dataStoreId: string; location: string; count: number } =
        places.get(key) || {
          dataStoreId: finding.dataStoreId,
          location: finding.location,
          count: 0,
        };

      entry.count++;
      places.set(key, entry);
    }

    const candidates: Array<{ dataStoreId: string; location: string }> = [
      ...places.values(),
    ].filter((entry: { count: number; dataStoreId: string }): boolean => {
      return (
        entry.count >= SCAN_TUNING_LIMITS.minFindingsToExclude &&
        ObjectID.isValidUUID(entry.dataStoreId)
      );
    });

    if (candidates.length === 0) {
      return 0;
    }

    const storeIds: Array<string> = [
      ...new Set(
        candidates.map((entry: { dataStoreId: string }): string => {
          return entry.dataStoreId;
        }),
      ),
    ];
    const storeRows: Array<DataStore> = await DataStoreService.findBy({
      query: {
        projectId: data.projectId,
        isArchived: false,
        _id: new Includes(
          storeIds.map((id: string): ObjectID => {
            return new ObjectID(id);
          }),
        ),
      },
      select: { _id: true, name: true, kind: true, scanExclusions: true },
      skip: 0,
      limit: storeIds.length,
      props: { isRoot: true },
    });
    const stores: Map<
      string,
      { kind: string; scanExclusions?: unknown; name: string; row: DataStore }
    > = new Map();

    for (const row of storeRows) {
      const id: string = row.id?.toString().toLowerCase() || "";

      if (id) {
        stores.set(id, {
          kind: row.kind || "",
          scanExclusions: row.scanExclusions,
          name: row.name || "",
          row,
        });
      }
    }

    const findings: Array<TuningFinding> = [];

    for (const candidate of candidates) {
      if (!stores.has(candidate.dataStoreId)) {
        continue;
      }

      findings.push(
        ...(
          await DataStoreFindingService.findBy({
            query: {
              projectId: data.projectId,
              dataStoreId: new ObjectID(candidate.dataStoreId),
              location: candidate.location,
            },
            select: TUNING_SELECT,
            skip: 0,
            limit: MAX_FINDINGS_READ_PER_CANDIDATE,
            props: { isRoot: true },
          })
        ).map(toTuningFinding),
      );
    }

    let proposed: number = 0;

    for (const place of getLocationsToExclude({ findings, stores }).slice(
      0,
      SCAN_TUNING_LIMITS.maxExclusionProposalsPerRun,
    )) {
      const store:
        | { kind: string; scanExclusions?: unknown; name: string; row: DataStore }
        | undefined = stores.get(place.dataStoreId);

      if (!store) {
        continue;
      }

      const entry: DataSecurityAiDecisionEntry =
        await DataSecurityAiProposals.propose({
        projectId: data.projectId,
        issue: null,
        store: store.row,
        action: AddScanExclusionAction,
        change: planAddScanExclusion({
          dataStoreId: place.dataStoreId,
          storeName: store.name,
          location: place.location,
          exclusion: place.exclusion,
          findings: place.findings,
          dataTypeIds: place.dataTypeIds,
        }),
        work: data.work,
        verdict: data.verdict,
        riskScore: Math.min(100, place.findings),
        now: data.now,
      });

      if (entry.reason === DataSecurityAiDecisionReason.Proposed) {
        proposed++;
      }
    }

    return proposed;
  }
}

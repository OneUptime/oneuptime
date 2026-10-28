import DataSecuritySetting from "Common/Models/DatabaseModels/DataSecuritySetting";
import ListResult from "Common/Types/BaseDatabase/ListResult";
import Select from "Common/Types/BaseDatabase/Select";
import ObjectID from "Common/Types/ObjectID";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import PermissionGate, {
  ModelAction,
  PermissionGateResult,
} from "Common/UI/Utils/PermissionGate";
import ProjectUtil from "Common/UI/Utils/Project";
import { MutableRefObject, useEffect, useRef, useState } from "react";

/*
 * THE PROJECT'S DATA SECURITY SETTINGS ROW, FOR THE SETTINGS PAGES.
 *
 * A project has one DataSecuritySetting, made with every default the first
 * time anything asks for it - the server's jobs do so through
 * DataSecuritySettingService.getOrCreateForProject. A page can be opened
 * before any job ran, so it does the same here: it reads the project's row
 * and, when there is none, creates one with nothing but the project (the
 * server fills in every default), then reads again - so two tabs that race
 * to make it both end up with the one the unique index kept.
 *
 * Someone who may read the settings but not create them (a Security Viewer,
 * before anyone else opened the page) gets null: the pages then show the
 * defaults, and every control locked with the reason.
 */

// The columns the pages read: every setting, as the server's allColumns.
export const DATA_SECURITY_SETTING_SELECT: Select<DataSecuritySetting> = {
  _id: true,
  projectId: true,
  isConfigurationScanEnabled: true,
  isContentScanEnabled: true,
  isTelemetryScanEnabled: true,
  keepMaskedSamples: true,
  openCasesForCriticalIssues: true,
  raiseAlertsForCriticalIssues: true,
  alertSeverityId: true,
  notifyOwners: true,
  maxObjectsPerScan: true,
  maxBytesPerObject: true,
  maxBytesPerScan: true,
  maxRowsPerTable: true,
  maxTablesPerScan: true,
  telemetrySampleSize: true,
  contentScanIntervalInHours: true,
  allowedValues: true,
  disabledDataTypeIds: true,
  useAiForAmbiguousFields: true,
};

export async function readDataSecuritySetting(
  projectId: ObjectID,
): Promise<DataSecuritySetting | null> {
  const result: ListResult<DataSecuritySetting> =
    await ModelAPI.getList<DataSecuritySetting>({
      modelType: DataSecuritySetting,
      query: { projectId: projectId },
      limit: 1,
      skip: 0,
      select: DATA_SECURITY_SETTING_SELECT,
      sort: {},
    });

  return result.data[0] || null;
}

/*
 * The project's settings, made with the defaults when there are none and
 * the reader may make them; null when there are none and they may not.
 */
export async function readOrCreateDataSecuritySetting(
  projectId: ObjectID,
): Promise<DataSecuritySetting | null> {
  const existing: DataSecuritySetting | null =
    await readDataSecuritySetting(projectId);

  if (existing) {
    return existing;
  }

  const createGate: PermissionGateResult = PermissionGate.check(
    new DataSecuritySetting(),
    ModelAction.Create,
  );

  /*
   * Refused for a reason the reader can be told: nothing to try. Before the
   * permission snapshot has landed there is no reason yet, and the server
   * decides.
   */
  if (!createGate.isAllowed && createGate.disabledReason) {
    return null;
  }

  const setting: DataSecuritySetting = new DataSecuritySetting();
  setting.projectId = projectId;

  try {
    await ModelAPI.create<DataSecuritySetting>({
      model: setting,
      modelType: DataSecuritySetting,
    });
  } catch {
    // Another tab made it first, or the reader may not: read what is there.
  }

  return await readDataSecuritySetting(projectId);
}

export interface DataSecuritySettingState {
  // The row, or null while it loads and when there is none to show.
  setting: DataSecuritySetting | null;
  isLoading: boolean;
  // Why the row could not be read.
  error: string;
  reload: () => void;
  // The row as a save left it, in place of the one read.
  onSettingChange: (setting: DataSecuritySetting) => void;
}

const useDataSecuritySetting: () => DataSecuritySettingState =
  (): DataSecuritySettingState => {
    const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();
    const projectIdString: string = projectId?.toString() || "";

    const [setting, setSetting] = useState<DataSecuritySetting | null>(null);
    const [isLoading, setIsLoading] = useState<boolean>(true);
    const [error, setError] = useState<string>("");

    // Bumped by every read: an answer for a read moved on from is dropped.
    const readRef: MutableRefObject<number> = useRef<number>(0);

    const load: () => Promise<void> = async (): Promise<void> => {
      const read: number = readRef.current + 1;
      readRef.current = read;

      if (!projectIdString) {
        setSetting(null);
        setIsLoading(false);
        return;
      }

      setIsLoading(true);
      setError("");

      try {
        const answer: DataSecuritySetting | null =
          await readOrCreateDataSecuritySetting(new ObjectID(projectIdString));

        if (read !== readRef.current) {
          return;
        }

        setSetting(answer);
      } catch (err) {
        if (read !== readRef.current) {
          return;
        }

        setSetting(null);
        setError(API.getFriendlyMessage(err));
      }

      setIsLoading(false);
    };

    useEffect(() => {
      void load();

      return () => {
        readRef.current += 1;
      };
    }, [projectIdString]);

    return {
      setting: setting,
      isLoading: isLoading,
      error: error,
      reload: (): void => {
        void load();
      },
      onSettingChange: (changed: DataSecuritySetting): void => {
        setSetting(changed);
      },
    };
  };

export default useDataSecuritySetting;

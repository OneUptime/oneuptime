import RumApplication from "Common/Models/DatabaseModels/RumApplication";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import {
  normalizeSessionReplayFrustrationSettings,
  SessionReplayFrustrationSettings,
} from "Common/Types/Rum/SessionReplayFrustrationSignals";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import PermissionGate, {
  PermissionGateResult,
} from "Common/UI/Utils/PermissionGate";
import {
  MutableRefObject,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

/*
 * One application's frustration settings
 * (RumApplication.sessionReplayFrustrationSignals): read once, then saved
 * whole on every change, one change at a time.
 *
 * Null in the column is every default, so a new application reads as the
 * built-in rules switched on and no signals of its own. A save sends the
 * whole settings - the server checks them strictly and stores them
 * canonical - and the page keeps what it sent once the server took it. A
 * refused save leaves the settings as they were and hands back the
 * server's reason, for the control that asked to show.
 */

export const FRUSTRATION_SETTINGS_COLUMN: string =
  "sessionReplayFrustrationSignals";

export interface FrustrationSettingsState {
  settings: SessionReplayFrustrationSettings | null;
  isLoading: boolean;
  loadError: string;
  // Whether a save is in flight; every control waits for it.
  isSaving: boolean;
  canEdit: boolean;
  // Why the reader cannot edit, when the gate says.
  editDisabledReason: string;
  reload: () => void;
  // Resolves to null when saved, or the reason it was not.
  save: (next: SessionReplayFrustrationSettings) => Promise<string | null>;
}

export function getFrustrationSettingsEditGate(): PermissionGateResult {
  try {
    return PermissionGate.checkColumnUpdate(
      new RumApplication(),
      FRUSTRATION_SETTINGS_COLUMN,
    );
  } catch {
    return { isAllowed: false };
  }
}

export default function useFrustrationSettings(
  rumApplicationId: ObjectID,
): FrustrationSettingsState {
  const [settings, setSettings] =
    useState<SessionReplayFrustrationSettings | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [loadError, setLoadError] = useState<string>("");
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [loadCount, setLoadCount] = useState<number>(0);

  /* A read for another application, or an older read, never lands. */
  const readGenerationRef: MutableRefObject<number> = useRef<number>(0);
  const isSavingRef: MutableRefObject<boolean> = useRef<boolean>(false);

  const gate: PermissionGateResult = getFrustrationSettingsEditGate();

  useEffect(() => {
    const generation: number = readGenerationRef.current + 1;
    readGenerationRef.current = generation;

    setIsLoading(true);
    setLoadError("");

    const read: () => Promise<void> = async (): Promise<void> => {
      try {
        const application: RumApplication | null =
          await ModelAPI.getItem<RumApplication>({
            modelType: RumApplication,
            id: rumApplicationId,
            select: {
              _id: true,
              sessionReplayFrustrationSignals: true,
            },
          });

        if (readGenerationRef.current !== generation) {
          return;
        }

        if (!application) {
          setLoadError("This RUM application was not found.");
          setSettings(null);
          return;
        }

        setSettings(
          normalizeSessionReplayFrustrationSettings(
            application.sessionReplayFrustrationSignals ?? null,
          ),
        );
      } catch (err) {
        if (readGenerationRef.current !== generation) {
          return;
        }

        setLoadError(API.getFriendlyMessage(err));
        setSettings(null);
      } finally {
        if (readGenerationRef.current === generation) {
          setIsLoading(false);
        }
      }
    };

    void read();
  }, [rumApplicationId.toString(), loadCount]);

  const reload: () => void = useCallback((): void => {
    setLoadCount((count: number): number => {
      return count + 1;
    });
  }, []);

  const save: (
    next: SessionReplayFrustrationSettings,
  ) => Promise<string | null> = useCallback(
    async (next: SessionReplayFrustrationSettings): Promise<string | null> => {
      if (isSavingRef.current) {
        return "Another change is still being saved. Try again in a moment.";
      }

      isSavingRef.current = true;
      setIsSaving(true);

      try {
        await ModelAPI.updateById<RumApplication>({
          modelType: RumApplication,
          id: rumApplicationId,
          data: {
            sessionReplayFrustrationSignals: next as unknown as JSONObject,
          },
        });

        /* Trimmed and in order, as the server stores it. */
        setSettings(normalizeSessionReplayFrustrationSettings(next));

        return null;
      } catch (err) {
        return API.getFriendlyMessage(err);
      } finally {
        isSavingRef.current = false;
        setIsSaving(false);
      }
    },
    [rumApplicationId.toString()],
  );

  return {
    settings: settings,
    isLoading: isLoading,
    loadError: loadError,
    isSaving: isSaving,
    canEdit: gate.isAllowed,
    editDisabledReason: gate.disabledReason || "",
    reload: reload,
    save: save,
  };
}

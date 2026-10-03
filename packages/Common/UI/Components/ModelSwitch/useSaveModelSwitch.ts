import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import API from "../../Utils/API/API";
import ModelAPI from "../../Utils/ModelAPI/ModelAPI";
import PermissionGate, {
  PermissionGateResult,
} from "../../Utils/PermissionGate";
import { announceModelSwitchSaved } from "./ModelSwitchEvents";
import { ModelSwitchColumn } from "./ModelSwitchUtil";
import {
  MutableRefObject,
  useCallback,
  useMemo,
  useRef,
  useState,
} from "react";

/*
 * A button that sets a switch's column from somewhere other than the switch:
 * "Turn evaluation on" on the banner that says an SLO is not being
 * evaluated, with the switch itself on the SLO's Settings page. It writes
 * what the switch writes, gated the way the switch is
 * (PermissionGate.checkColumnUpdate), and announces the save through
 * ModelSwitchEvents, so the switch - and anything else on the screen that
 * listens - moves with it.
 *
 * Someone who could not flip the switch gets a locked button that says
 * which permission is missing, not a save the server refuses.
 *
 * What it is doing, and why a press failed, belong to the record it was
 * pressed for: a page stays mounted when the reader follows a link to
 * another record of the same kind, and that one's button must not show the
 * first one's error or spinner.
 */

export interface SaveModelSwitch {
  // Whether the button can be pressed, and if not, why.
  gate: PermissionGateResult;
  isSaving: boolean;
  // Why the last press did not save, or "".
  error: string;
  save: () => void;
}

interface ForRecord {
  modelId: string;
  message: string;
}

const useSaveModelSwitch: <TBaseModel extends BaseModel>(data: {
  modelType: { new (): TBaseModel };
  modelId: ObjectID;
  column: ModelSwitchColumn<TBaseModel>;
  // What the column is set to: the stored value, not what a switch shows.
  value: boolean;
  // Told after it is saved.
  onSaved?: (() => void) | undefined;
  // ModelAPI when left out; the admin dashboard passes AdminModelAPI.
  modelAPI?: typeof ModelAPI | undefined;
}) => SaveModelSwitch = <TBaseModel extends BaseModel>(data: {
  modelType: { new (): TBaseModel };
  modelId: ObjectID;
  column: ModelSwitchColumn<TBaseModel>;
  value: boolean;
  onSaved?: (() => void) | undefined;
  modelAPI?: typeof ModelAPI | undefined;
}): SaveModelSwitch => {
  // The record a save is out for, if any.
  const [savingFor, setSavingFor] = useState<string | null>(null);
  const [failure, setFailure] = useState<ForRecord | null>(null);

  // Set at once: two presses before the button locks must not save twice.
  const isSavingRef: MutableRefObject<boolean> = useRef<boolean>(false);

  // The latest call's options, for a save that outlives a render.
  const latestRef: MutableRefObject<typeof data> = useRef<typeof data>(data);
  latestRef.current = data;

  const modelIdString: string = data.modelId.toString();

  const model: TBaseModel = useMemo((): TBaseModel => {
    return new data.modelType();
  }, [data.modelType]);

  const gate: PermissionGateResult = PermissionGate.checkColumnUpdate(
    model,
    data.column,
  );

  const save: () => void = useCallback((): void => {
    if (isSavingRef.current || !gate.isAllowed) {
      return;
    }

    isSavingRef.current = true;
    setSavingFor(modelIdString);
    setFailure(null);

    const current: typeof data = latestRef.current;
    const modelId: ObjectID = new ObjectID(modelIdString);
    const modelAPI: typeof ModelAPI = current.modelAPI || ModelAPI;

    const run: () => Promise<void> = async (): Promise<void> => {
      try {
        await modelAPI.updateById<TBaseModel>({
          modelType: current.modelType,
          id: modelId,
          data: {
            [current.column]: current.value,
          } as JSONObject,
        });

        announceModelSwitchSaved({
          modelType: current.modelType,
          modelId: modelId,
          column: current.column,
          value: current.value,
        });

        current.onSaved?.();
      } catch (err) {
        setFailure({
          modelId: modelIdString,
          message: API.getFriendlyMessage(err),
        });
      }

      isSavingRef.current = false;
      setSavingFor(null);
    };

    void run();
  }, [modelIdString, gate.isAllowed]);

  return {
    gate,
    isSaving: savingFor === modelIdString,
    error: failure?.modelId === modelIdString ? failure.message : "",
    save,
  };
};

export default useSaveModelSwitch;

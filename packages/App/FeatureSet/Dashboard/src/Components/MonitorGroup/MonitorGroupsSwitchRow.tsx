import ProductSwitchRow, {
  ProductSwitchSaveState,
} from "../ProjectProducts/ProductSwitchRow";
import MonitorGroupsSwitchCopy, {
  MONITOR_GROUPS_SWITCH_COLUMN,
  MONITOR_GROUPS_SWITCH_TEST_ID,
} from "./MonitorGroupsSwitchCopy";
import Project from "Common/Models/DatabaseModels/Project";
import IconProp from "Common/Types/Icon/IconProp";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import { announceModelSwitchSaved } from "Common/UI/Components/ModelSwitch/ModelSwitchEvents";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import PermissionGate, {
  PermissionGateResult,
} from "Common/UI/Utils/PermissionGate";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  FunctionComponent,
  MutableRefObject,
  ReactElement,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";

/*
 * Monitor Groups, on Project Settings > Products (#7324): a row under
 * Monitors, in the products' own look, whose switch adds Monitor Groups to
 * the Monitors menu. It was the one switch of Settings > Advanced > Feature
 * Flags, the other place that changed what a project's menus show.
 *
 * It saves Project.isFeatureFlagMonitorGroupsEnabled the moment it is
 * flipped, as that page did, for the same people: whoever may change the
 * column (PermissionGate.checkColumnUpdate), and the switch is locked, with
 * the permission that is missing, for everyone else. A refused save moves it
 * back with the server's reason.
 *
 * Where it stands is the selected project's column - the one the Monitors
 * menu reads - so the switch and the menu never disagree. A save is
 * announced (ModelSwitchEvents): the dashboard swaps in the project with the
 * new value (SelectedProjectSwitches), and the menus follow without a
 * reload. Turning it off deletes no group.
 */

export interface ComponentProps {
  // The dashboard's selected project, as the menus read it.
  project: Project;
  // The Monitors product's colour, so the row reads as part of it.
  iconColor?: string | undefined;
}

const MonitorGroupsSwitchRow: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const source: string = `monitor-groups-switch-${useId()}`;

  const projectId: string = props.project._id?.toString() || "";
  const stored: boolean = Boolean(
    props.project.isFeatureFlagMonitorGroupsEnabled,
  );

  const [isOn, setIsOn] = useState<boolean>(stored);
  const [saveState, setSaveState] = useState<ProductSwitchSaveState>(
    ProductSwitchSaveState.Idle,
  );
  const [error, setError] = useState<string>("");

  /*
   * Set at once, where the state above lands on the next render: two presses
   * before the switch has drawn itself locked must not save twice.
   */
  const isSavingRef: MutableRefObject<boolean> = useRef<boolean>(false);

  // A save made here or anywhere else on the screen moves the project.
  useEffect(() => {
    if (isSavingRef.current) {
      return;
    }

    setIsOn(stored);
  }, [stored, projectId]);

  const gate: PermissionGateResult = PermissionGate.checkColumnUpdate(
    useMemo((): Project => {
      return new Project();
    }, []),
    MONITOR_GROUPS_SWITCH_COLUMN,
  );

  const change: (value: boolean) => Promise<void> = async (
    value: boolean,
  ): Promise<void> => {
    if (isSavingRef.current || !gate.isAllowed || !projectId) {
      return;
    }

    isSavingRef.current = true;

    const previous: boolean = isOn;

    setIsOn(value);
    setSaveState(ProductSwitchSaveState.Saving);
    setError("");

    try {
      await ModelAPI.updateById<Project>({
        modelType: Project,
        id: new ObjectID(projectId),
        data: { [MONITOR_GROUPS_SWITCH_COLUMN]: value } as JSONObject,
      });

      isSavingRef.current = false;
      setSaveState(ProductSwitchSaveState.Saved);

      announceModelSwitchSaved({
        modelType: Project,
        modelId: new ObjectID(projectId),
        column: MONITOR_GROUPS_SWITCH_COLUMN,
        value: value,
        source: source,
      });
    } catch (err) {
      isSavingRef.current = false;
      setIsOn(previous);
      setSaveState(ProductSwitchSaveState.Idle);
      setError(API.getFriendlyMessage(err));
    }
  };

  const description: string = [
    translator.translateText(
      isOn
        ? MonitorGroupsSwitchCopy.switchOnDescription
        : MonitorGroupsSwitchCopy.switchOffDescription,
    ),
    translator.translateText(MonitorGroupsSwitchCopy.note),
  ].join(" ");

  return (
    <ProductSwitchRow
      title={
        translator.translateText(MonitorGroupsSwitchCopy.switchTitle) ||
        MonitorGroupsSwitchCopy.switchTitle
      }
      description={description}
      icon={IconProp.Squares}
      iconColor={props.iconColor}
      isShown={isOn}
      isAlwaysShown={false}
      /*
       * Locked while the permissions are not known yet, saying nothing; for
       * someone who may not change it, saying which permission is missing,
       * in the reader's words already.
       */
      isLocked={!gate.isAllowed}
      lockedReason={gate.isAllowed ? undefined : gate.disabledReason}
      isLockedReasonTranslated={true}
      saveState={saveState}
      error={error || undefined}
      isInUse={false}
      isNotSetUp={false}
      dataTestId={MONITOR_GROUPS_SWITCH_TEST_ID}
      onChange={(value: boolean) => {
        change(value).catch(() => {
          // Said on the row.
        });
      }}
    />
  );
};

export default MonitorGroupsSwitchRow;

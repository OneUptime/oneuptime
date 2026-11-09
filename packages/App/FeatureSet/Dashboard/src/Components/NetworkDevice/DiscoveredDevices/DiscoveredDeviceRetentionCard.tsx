import DiscoveredDeviceRetentionCopy, {
  DISCOVERED_DEVICE_RETENTION_CARD_TEST_ID,
  DISCOVERED_DEVICE_RETENTION_PLACE,
  DISCOVERED_DEVICE_RETENTION_SETTING_TEST_ID,
  getDiscoveredDeviceRetentionChoices,
  getDiscoveredDeviceRetentionDescription,
  getDiscoveredDeviceRetentionText,
} from "./DiscoveredDeviceRetentionCopy";
import Project from "Common/Models/DatabaseModels/Project";
import {
  DEFAULT_DISCOVERED_DEVICE_RETENTION_IN_DAYS,
  readDiscoveredDeviceRetentionInDays,
} from "Common/Types/NetworkDevice/DiscoveredDeviceRetention";
import ObjectID from "Common/Types/ObjectID";
import Card from "Common/UI/Components/Card/Card";
import { useCardRuledListClassName } from "Common/UI/Components/Card/CardSurface";
import ComponentLoader from "Common/UI/Components/ComponentLoader/ComponentLoader";
import Dropdown, {
  DropdownOption,
  DropdownValue,
} from "Common/UI/Components/Dropdown/Dropdown";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import SaveStatus from "Common/UI/Components/SaveStatus/SaveStatus";
import useSaveOnChange, {
  SaveOnChange,
} from "Common/UI/Components/SaveStatus/useSaveOnChange";
import Tooltip from "Common/UI/Components/Tooltip/Tooltip";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import PermissionGate, {
  PermissionGateResult,
} from "Common/UI/Utils/PermissionGate";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useId,
  useMemo,
  useState,
} from "react";

/*
 * Unseen Devices, under the Discovered Devices page's More settings (issue
 * #6389): "Remove after", one pick that saves the moment it is made (see
 * DiscoveredDeviceRetentionCopy).
 *
 * - "Saving…" and then "Saved" show beside it; a pick the server refuses
 *   goes back to what the project has, with the reason under it.
 * - The sentence under it says what the pick means: with a length, that the
 *   list is checked every hour, that nothing goes while the switch that saw
 *   a device isn't reporting, and that a device seen again comes back; with
 *   Never, that every device stays.
 * - Someone who may not change it (anyone but a Project Owner or Admin) sees
 *   it locked, with the permission that is missing.
 * - It tells the page what the project holds once read and after each save
 *   (onRetentionChange), so the folded header and the list's line say so.
 */

export interface ComponentProps {
  projectId: ObjectID;
  onRetentionChange?: ((retentionInDays: number) => void) | undefined;
}

// The column the card reads and writes.
type RetentionColumn = "discoveredDeviceRetentionInDays";

const RETENTION_COLUMN: RetentionColumn = "discoveredDeviceRetentionInDays";

interface SettingProps {
  projectId: ObjectID;
  initialRetentionInDays: number;
  onSaved?: ((retentionInDays: number) => void) | undefined;
}

const RetentionSetting: FunctionComponent<SettingProps> = (
  props: SettingProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const labelId: string = `discovered-device-retention-label-${useId()}`;

  const setting: SaveOnChange<number> = useSaveOnChange<number>({
    initialValue: props.initialRetentionInDays,
    save: async (retentionInDays: number): Promise<void> => {
      await ModelAPI.updateById<Project>({
        modelType: Project,
        id: props.projectId,
        data: {
          [RETENTION_COLUMN]: retentionInDays,
        },
      });
    },
    onSaved: (retentionInDays: number): void => {
      props.onSaved?.(retentionInDays);
    },
  });

  /*
   * Read on every render: the permissions arrive after the first paint of a
   * fresh sign-in, and a gate kept from then would leave the pick locked for
   * someone who may change it.
   */
  const project: Project = useMemo((): Project => {
    return new Project();
  }, []);

  const updateGate: PermissionGateResult = PermissionGate.checkColumnUpdate(
    project,
    RETENTION_COLUMN,
  );

  const options: Array<DropdownOption> = useMemo((): Array<DropdownOption> => {
    return getDiscoveredDeviceRetentionChoices().map(
      (retentionInDays: number): DropdownOption => {
        return {
          value: retentionInDays,
          label: getDiscoveredDeviceRetentionText(retentionInDays, translator),
        };
      },
    );
  }, [translator]);

  const selectedOption: DropdownOption | undefined = options.find(
    (option: DropdownOption): boolean => {
      return option.value === setting.value;
    },
  );

  const dropdown: ReactElement = (
    <div
      className="w-40"
      data-testid={DISCOVERED_DEVICE_RETENTION_SETTING_TEST_ID}
    >
      <Dropdown
        options={options}
        value={selectedOption}
        ariaLabelledby={labelId}
        isClearable={false}
        disabled={!updateGate.isAllowed}
        className="relative w-full overflow-visible rounded-md"
        onChange={(value: DropdownValue | Array<DropdownValue> | null) => {
          if (typeof value !== "number" || !updateGate.isAllowed) {
            return;
          }

          setting.change(value);
        }}
      />
    </div>
  );

  return (
    <div data-testid={`${DISCOVERED_DEVICE_RETENTION_SETTING_TEST_ID}-row`}>
      <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2">
        <span id={labelId} className="text-sm font-medium text-gray-900">
          {translator.translateText(DiscoveredDeviceRetentionCopy.label)}
        </span>
        {updateGate.isAllowed ? (
          dropdown
        ) : (
          <Tooltip text={updateGate.disabledReason}>{dropdown}</Tooltip>
        )}
        <SaveStatus
          state={setting.saveState}
          dataTestId={`${DISCOVERED_DEVICE_RETENTION_SETTING_TEST_ID}-status`}
        />
      </div>
      <p
        className="mt-1 text-sm text-gray-500"
        data-testid={`${DISCOVERED_DEVICE_RETENTION_SETTING_TEST_ID}-description`}
      >
        {translator.translateText(
          getDiscoveredDeviceRetentionDescription(setting.value),
        )}
      </p>
      {setting.error ? (
        <p
          className="mt-1 text-sm text-red-600"
          role="alert"
          data-testid={`${DISCOVERED_DEVICE_RETENTION_SETTING_TEST_ID}-error`}
        >
          {setting.error}
        </p>
      ) : (
        <></>
      )}
    </div>
  );
};

const DiscoveredDeviceRetentionCard: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const ruledListClassName: string = useCardRuledListClassName();
  const translator: Translator = useTranslator();
  const [retentionInDays, setRetentionInDays] = useState<number>(
    DEFAULT_DISCOVERED_DEVICE_RETENTION_IN_DAYS,
  );
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");

  const fetchProject: () => Promise<void> = async (): Promise<void> => {
    setIsLoading(true);
    setError("");

    try {
      const item: Project | null = await ModelAPI.getItem<Project>({
        modelType: Project,
        id: props.projectId,
        select: {
          [RETENTION_COLUMN]: true,
        },
      });

      if (item) {
        // A project read before the column existed holds the default.
        const days: number =
          readDiscoveredDeviceRetentionInDays(item[RETENTION_COLUMN]) ??
          DEFAULT_DISCOVERED_DEVICE_RETENTION_IN_DAYS;

        setRetentionInDays(days);
        props.onRetentionChange?.(days);
      } else {
        setError(
          translator.translateText("Project not found.") ||
            "Project not found.",
        );
      }
    } catch (err) {
      setError(API.getFriendlyMessage(err));
    }

    setIsLoading(false);
  };

  useEffect(() => {
    void fetchProject();
  }, [props.projectId.toString()]);

  const getBody: () => ReactElement = (): ReactElement => {
    if (isLoading) {
      return <ComponentLoader />;
    }

    if (error) {
      return (
        <ErrorMessage
          message={error}
          onRefreshClick={() => {
            void fetchProject();
          }}
        />
      );
    }

    return (
      /*
       * Full-bleed rows, ruled like the card's own header rule: the body
       * reaches the card's edges and each row brings its own padding back.
       */
      <div className={ruledListClassName}>
        <div className="px-5 py-4 md:px-6">
          <RetentionSetting
            projectId={props.projectId}
            initialRetentionInDays={retentionInDays}
            onSaved={props.onRetentionChange}
          />
        </div>
      </div>
    );
  };

  return (
    <Card
      id={DISCOVERED_DEVICE_RETENTION_PLACE}
      title={DiscoveredDeviceRetentionCopy.cardTitle}
      description={DiscoveredDeviceRetentionCopy.cardDescription}
    >
      <div data-testid={DISCOVERED_DEVICE_RETENTION_CARD_TEST_ID}>
        {getBody()}
      </div>
    </Card>
  );
};

export default DiscoveredDeviceRetentionCard;

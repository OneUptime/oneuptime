import ResolvedRecordRetentionCopy, {
  KEEP_COMPLETED_POSTMORTEMS_COLUMN,
  KEEP_COMPLETED_POSTMORTEMS_TEST_ID,
  RESOLVED_RECORD_RETENTION_CARD_TEST_ID,
  RESOLVED_RECORD_RETENTION_SETTING_TEST_ID,
  ResolvedRecordRetentionKindCopy,
  getKeepCompletedPostmortemsDescription,
  getResolvedRecordRetentionChoices,
  getResolvedRecordRetentionConfirmation,
  getResolvedRecordRetentionDescription,
  getResolvedRecordRetentionText,
} from "./ResolvedRecordRetentionCopy";
import Project from "Common/Models/DatabaseModels/Project";
import ObjectID from "Common/Types/ObjectID";
import {
  DEFAULT_KEEP_INCIDENTS_WITH_COMPLETED_POSTMORTEM,
  DEFAULT_RESOLVED_RECORD_RETENTION_IN_DAYS,
  doesResolvedRecordRetentionDeleteMore,
  isResolvedRecordRetentionOn,
  readResolvedRecordRetentionInDays,
} from "Common/Types/Retention/ResolvedRecordRetention";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import Card from "Common/UI/Components/Card/Card";
import { useCardRuledListClassName } from "Common/UI/Components/Card/CardSurface";
import ComponentLoader from "Common/UI/Components/ComponentLoader/ComponentLoader";
import Dropdown, {
  DropdownOption,
  DropdownValue,
} from "Common/UI/Components/Dropdown/Dropdown";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import ConfirmModal from "Common/UI/Components/Modal/ConfirmModal";
import ModelSwitchRow from "Common/UI/Components/ModelSwitch/ModelSwitchRow";
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
 * Resolved Incidents (Incidents -> Settings -> Data Retention) and Resolved
 * Alerts (Alerts -> Settings -> Data Retention), issue #6903: "Delete after",
 * one pick that saves the moment it is made (see ResolvedRecordRetentionCopy).
 *
 * - "Saving…" and then "Saved" show beside it; a pick the server refuses
 *   goes back to what the project has, with the reason under it.
 * - A pick that deletes more than the project deletes now - turning it on,
 *   or a shorter length - asks first, in a dialog that says what goes and
 *   that it can't be brought back. Cancelled, the pick goes back.
 * - The sentence under it says what the pick means: with a length, that it
 *   is checked every hour from when each was resolved; with Never, that
 *   every resolved one stays.
 * - Incidents only, while a length is picked: "Keep incidents with a
 *   completed postmortem", a switch that saves on flip and asks before it
 *   is turned off.
 * - Someone who may not change it (anyone but a Project Owner or Admin) sees
 *   it locked, with the permission that is missing.
 */

export interface ComponentProps {
  copy: ResolvedRecordRetentionKindCopy;
  projectId: ObjectID;
}

interface SettingProps {
  copy: ResolvedRecordRetentionKindCopy;
  projectId: ObjectID;
  initialRetentionInDays: number;
  onSaved: (retentionInDays: number) => void;
}

const RetentionSetting: FunctionComponent<SettingProps> = (
  props: SettingProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const labelId: string = `resolved-record-retention-label-${useId()}`;

  // A pick that deletes more, waiting for its question to be answered.
  const [pendingRetentionInDays, setPendingRetentionInDays] = useState<
    number | null
  >(null);

  /*
   * The pick keeps a copy of what it shows: a cancelled question draws it
   * again, from what the setting holds.
   */
  const [dropdownRevision, setDropdownRevision] = useState<number>(0);

  const setting: SaveOnChange<number> = useSaveOnChange<number>({
    initialValue: props.initialRetentionInDays,
    save: async (retentionInDays: number): Promise<void> => {
      await ModelAPI.updateById<Project>({
        modelType: Project,
        id: props.projectId,
        data: {
          [props.copy.column]: retentionInDays,
        },
      });
    },
    onSaved: (retentionInDays: number): void => {
      props.onSaved(retentionInDays);
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
    props.copy.column,
  );

  const options: Array<DropdownOption> = useMemo((): Array<DropdownOption> => {
    return getResolvedRecordRetentionChoices().map(
      (retentionInDays: number): DropdownOption => {
        return {
          value: retentionInDays,
          label: getResolvedRecordRetentionText(retentionInDays, translator),
        };
      },
    );
  }, [translator]);

  const selectedOption: DropdownOption | undefined = options.find(
    (option: DropdownOption): boolean => {
      return option.value === setting.value;
    },
  );

  const pick: (retentionInDays: number) => void = (
    retentionInDays: number,
  ): void => {
    if (
      doesResolvedRecordRetentionDeleteMore({
        from: setting.value,
        to: retentionInDays,
      })
    ) {
      setPendingRetentionInDays(retentionInDays);
      return;
    }

    setting.change(retentionInDays);
  };

  const dropdown: ReactElement = (
    <div
      className="w-40"
      data-testid={RESOLVED_RECORD_RETENTION_SETTING_TEST_ID}
    >
      <Dropdown
        key={dropdownRevision}
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

          pick(value);
        }}
      />
    </div>
  );

  return (
    <div data-testid={`${RESOLVED_RECORD_RETENTION_SETTING_TEST_ID}-row`}>
      <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2">
        <span id={labelId} className="text-sm font-medium text-gray-900">
          {translator.translateText(ResolvedRecordRetentionCopy.label)}
        </span>
        {updateGate.isAllowed ? (
          dropdown
        ) : (
          <Tooltip text={updateGate.disabledReason}>{dropdown}</Tooltip>
        )}
        <SaveStatus
          state={setting.saveState}
          dataTestId={`${RESOLVED_RECORD_RETENTION_SETTING_TEST_ID}-status`}
        />
      </div>
      <p
        className="mt-1 text-sm text-gray-500"
        data-testid={`${RESOLVED_RECORD_RETENTION_SETTING_TEST_ID}-description`}
      >
        {translator.translateText(
          getResolvedRecordRetentionDescription(props.copy, setting.value),
        )}
      </p>
      {setting.error ? (
        <p
          className="mt-1 text-sm text-red-600"
          role="alert"
          data-testid={`${RESOLVED_RECORD_RETENTION_SETTING_TEST_ID}-error`}
        >
          {setting.error}
        </p>
      ) : (
        <></>
      )}
      {pendingRetentionInDays !== null ? (
        <ConfirmModal
          title={props.copy.confirmTitle}
          description={getResolvedRecordRetentionConfirmation(
            props.copy,
            pendingRetentionInDays,
            translator,
          )}
          submitButtonText={props.copy.confirmButton}
          submitButtonType={ButtonStyleType.DANGER}
          onSubmit={() => {
            setting.change(pendingRetentionInDays);
            setPendingRetentionInDays(null);
          }}
          onClose={() => {
            setPendingRetentionInDays(null);
            setDropdownRevision((current: number): number => {
              return current + 1;
            });
          }}
        />
      ) : (
        <></>
      )}
    </div>
  );
};

const ResolvedRecordRetentionCard: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const ruledListClassName: string = useCardRuledListClassName();
  const translator: Translator = useTranslator();
  const [retentionInDays, setRetentionInDays] = useState<number>(
    DEFAULT_RESOLVED_RECORD_RETENTION_IN_DAYS,
  );
  const [keepCompletedPostmortems, setKeepCompletedPostmortems] =
    useState<boolean>(DEFAULT_KEEP_INCIDENTS_WITH_COMPLETED_POSTMORTEM);
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
          [props.copy.column]: true,
          ...(props.copy.offersPostmortemKeep
            ? { [KEEP_COMPLETED_POSTMORTEMS_COLUMN]: true }
            : {}),
        },
      });

      if (item) {
        // A project read before the columns existed holds the defaults.
        setRetentionInDays(
          readResolvedRecordRetentionInDays(item[props.copy.column]) ??
            DEFAULT_RESOLVED_RECORD_RETENTION_IN_DAYS,
        );

        const keep: unknown = item[KEEP_COMPLETED_POSTMORTEMS_COLUMN];

        setKeepCompletedPostmortems(
          typeof keep === "boolean"
            ? keep
            : DEFAULT_KEEP_INCIDENTS_WITH_COMPLETED_POSTMORTEM,
        );
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
  }, [props.projectId.toString(), props.copy.column]);

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
            copy={props.copy}
            projectId={props.projectId}
            initialRetentionInDays={retentionInDays}
            onSaved={setRetentionInDays}
          />
        </div>
        {props.copy.offersPostmortemKeep &&
        isResolvedRecordRetentionOn(retentionInDays) ? (
          <div className="px-5 py-4 md:px-6">
            <ModelSwitchRow<Project>
              modelType={Project}
              modelId={props.projectId}
              column={KEEP_COMPLETED_POSTMORTEMS_COLUMN}
              initialValue={keepCompletedPostmortems}
              title={ResolvedRecordRetentionCopy.keepPostmortemsTitle}
              getDescription={getKeepCompletedPostmortemsDescription}
              getConfirmation={(isTurningOn: boolean) => {
                // Turning it off deletes more: asked first.
                return isTurningOn
                  ? undefined
                  : {
                      title:
                        ResolvedRecordRetentionCopy.keepPostmortemsOffConfirmTitle,
                      description:
                        ResolvedRecordRetentionCopy.keepPostmortemsOffConfirmDescription,
                      submitButtonText:
                        ResolvedRecordRetentionCopy.keepPostmortemsOffConfirmButton,
                      submitButtonType: ButtonStyleType.DANGER,
                    };
              }}
              onSaved={setKeepCompletedPostmortems}
              dataTestId={KEEP_COMPLETED_POSTMORTEMS_TEST_ID}
            />
          </div>
        ) : (
          <></>
        )}
      </div>
    );
  };

  return (
    <Card title={props.copy.cardTitle} description={props.copy.cardDescription}>
      <div
        data-testid={`${RESOLVED_RECORD_RETENTION_CARD_TEST_ID}-${props.copy.kind.toLowerCase()}`}
      >
        {getBody()}
      </div>
    </Card>
  );
};

export default ResolvedRecordRetentionCard;

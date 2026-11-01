import PageComponentProps from "../../PageComponentProps";
import { SEVERITY_COLOR } from "../../../Components/DataSecurity/DataSecurityPills";
import DataSecurityCheckSetting from "Common/Models/DatabaseModels/DataSecurityCheckSetting";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import ListResult from "Common/Types/BaseDatabase/ListResult";
import {
  ALL_DATA_SECURITY_CHECK_GROUPS,
  DATA_SECURITY_CHECKS,
  DataSecurityCheckGroup,
  DataSecurityCheckInfo,
} from "Common/Types/DataSecurity/DataSecurityCheckCatalog";
import DataSensitivity, {
  ALL_DATA_SENSITIVITIES,
} from "Common/Types/DataSecurity/DataSensitivity";
import { JSONArray, JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import SecuritySeverity from "Common/Types/SecuritySeverity";
import Card from "Common/UI/Components/Card/Card";
import { useCardRuledListClassName } from "Common/UI/Components/Card/CardSurface";
import ComponentLoader from "Common/UI/Components/ComponentLoader/ComponentLoader";
import Dropdown, {
  DropdownOption,
  DropdownValue,
} from "Common/UI/Components/Dropdown/Dropdown";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import Toggle from "Common/UI/Components/Toggle/Toggle";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import PermissionGate, {
  ModelAction,
  PermissionGateResult,
} from "Common/UI/Utils/PermissionGate";
import ProjectUtil from "Common/UI/Utils/Project";
import { Translator, translationKey } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  Fragment,
  FunctionComponent,
  MutableRefObject,
  ReactElement,
  useEffect,
  useRef,
  useState,
} from "react";

/*
 * Data Security > Settings > Checks: every check Data Security runs on a
 * store (Types/DataSecurity/DataSecurityCheckCatalog), by group, each with
 * what it looks for, the severity a failure gets for each level of the
 * store's sensitivity, a switch and a severity of the project's choosing.
 *
 * A check with no DataSecurityCheckSetting row runs as it ships. Turning one
 * off, or giving it a severity, makes its row (or changes it); putting it
 * back on with the severity by sensitivity removes the row again - or, for
 * someone who may change a row but not delete one, leaves it saying just
 * that. Each change saves at once.
 */

export const DATA_SECURITY_CHECKS_TEST_ID: string = "data-security-checks";

// What the severity picker says while the check keeps the shipped severities.
const BY_SENSITIVITY: string = "BySensitivity";

// Each group's card title, as a key so it is looked up in the reader's language.
const GROUP_TITLES: Readonly<Record<DataSecurityCheckGroup, string>> = {
  [DataSecurityCheckGroup.Exposure]: translationKey("Exposure"),
  [DataSecurityCheckGroup.Encryption]: translationKey("Encryption"),
  [DataSecurityCheckGroup.Recovery]: translationKey("Recovery"),
  [DataSecurityCheckGroup.Visibility]: translationKey("Visibility"),
  [DataSecurityCheckGroup.Access]: translationKey("Access"),
  [DataSecurityCheckGroup.Hygiene]: translationKey("Data hygiene"),
  [DataSecurityCheckGroup.Telemetry]: translationKey("Telemetry"),
  [DataSecurityCheckGroup.Residency]: translationKey("Residency"),
  [DataSecurityCheckGroup.AI]: translationKey("AI"),
};

const GROUP_DESCRIPTIONS: Readonly<Record<DataSecurityCheckGroup, string>> = {
  [DataSecurityCheckGroup.Exposure]: translationKey(
    "Whether anyone outside your accounts can reach a store.",
  ),
  [DataSecurityCheckGroup.Encryption]: translationKey(
    "How a store's data is encrypted, at rest and on its way.",
  ),
  [DataSecurityCheckGroup.Recovery]: translationKey(
    "Whether a store's data can be brought back after a mistake or an attack.",
  ),
  [DataSecurityCheckGroup.Visibility]: translationKey(
    "Whether reads and changes are recorded.",
  ),
  [DataSecurityCheckGroup.Access]: translationKey(
    "How people and services reach a store.",
  ),
  [DataSecurityCheckGroup.Hygiene]: translationKey(
    "Data that should not be where it is, or kept as long as it is.",
  ),
  [DataSecurityCheckGroup.Telemetry]: translationKey(
    "Sensitive data in logs, traces and the rest of your telemetry.",
  ),
  [DataSecurityCheckGroup.Residency]: translationKey(
    "Whether data lives where your residency rules allow.",
  ),
  [DataSecurityCheckGroup.AI]: translationKey(
    "Sensitive data that reaches AI providers, or stores kept for AI.",
  ),
};

const SEVERITIES: Array<SecuritySeverity> = [
  SecuritySeverity.Critical,
  SecuritySeverity.High,
  SecuritySeverity.Medium,
  SecuritySeverity.Low,
];

const SEVERITY_OPTIONS: Array<DropdownOption> = [
  {
    label: "By sensitivity",
    value: BY_SENSITIVITY,
    description: "As shipped: the store's sensitivity sets it.",
  },
  ...SEVERITIES.map((severity: SecuritySeverity): DropdownOption => {
    return { label: severity, value: severity };
  }),
];

// How a check runs: on or off, and the severity every failure gets.
interface CheckChoice {
  isEnabled: boolean;
  severityOverride: SecuritySeverity | null;
}

const readSeverity: (value: unknown) => SecuritySeverity | null = (
  value: unknown,
): SecuritySeverity | null => {
  return (
    SEVERITIES.find((severity: SecuritySeverity): boolean => {
      return severity === value;
    }) || null
  );
};

const getChoice: (row: DataSecurityCheckSetting | undefined) => CheckChoice = (
  row: DataSecurityCheckSetting | undefined,
): CheckChoice => {
  return {
    isEnabled: row ? row.isEnabled !== false : true,
    severityOverride: row ? readSeverity(row.severityOverride) : null,
  };
};

interface CheckRowProps {
  check: DataSecurityCheckInfo;
  choice: CheckChoice;
  isLocked: boolean;
  isSaving: boolean;
  error: string;
  onChange: (choice: CheckChoice) => void;
}

// One check: its switch, its severities by sensitivity and its own severity.
const CheckRow: FunctionComponent<CheckRowProps> = (
  props: CheckRowProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const isDisabled: boolean = props.isLocked || props.isSaving;
  const testId: string = `data-security-check-${props.check.id}`;
  const title: string =
    translator.translateText(props.check.title) || props.check.title;

  return (
    <div className="px-5 py-4 md:px-6" data-testid={testId}>
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0 flex-1">
          <Toggle
            title={props.check.title}
            description={props.check.description}
            value={props.choice.isEnabled}
            disabled={isDisabled}
            onChange={(isOn: boolean): void => {
              props.onChange({ ...props.choice, isEnabled: isOn });
            }}
            dataTestId={`${testId}-switch`}
          />
        </div>
        <div className="w-full flex-shrink-0 pl-14 lg:w-48 lg:pl-0">
          <Dropdown
            options={SEVERITY_OPTIONS}
            value={SEVERITY_OPTIONS.find((option: DropdownOption): boolean => {
              return (
                option.value ===
                (props.choice.severityOverride || BY_SENSITIVITY)
              );
            })}
            isClearable={false}
            disabled={isDisabled}
            ariaLabel={translator.translateTemplate("Severity of {{check}}", {
              check: title,
            })}
            dataTestId={`${testId}-severity`}
            onChange={(
              value: DropdownValue | Array<DropdownValue> | null,
            ): void => {
              props.onChange({
                ...props.choice,
                severityOverride: readSeverity(value),
              });
            }}
          />
        </div>
      </div>

      {/*
       * The severity a failure gets, for each level of the store's
       * sensitivity, on one quiet line under the check: four badges a check
       * made every row three lines taller, and the page of 32 checks over
       * twelve thousand pixels long on a phone.
       */}
      <dl
        className={`mt-2 flex flex-wrap gap-x-4 gap-y-1 pl-14 text-xs ${
          props.choice.isEnabled ? "" : "opacity-50"
        }`}
        data-testid={`${testId}-severities`}
      >
        {ALL_DATA_SENSITIVITIES.map(
          (sensitivity: DataSensitivity): ReactElement => {
            const severity: SecuritySeverity | null =
              props.choice.severityOverride ||
              props.check.severityBySensitivity[sensitivity];

            return (
              <div
                key={sensitivity}
                className="inline-flex min-w-0 items-center gap-1.5"
              >
                <dt className="text-gray-500">
                  {translator.translateText(sensitivity) || sensitivity}
                </dt>
                <dd className="inline-flex items-center gap-1 font-medium text-gray-700">
                  {severity ? (
                    <>
                      <span
                        className="h-1.5 w-1.5 flex-shrink-0 rounded-full"
                        style={{
                          backgroundColor: SEVERITY_COLOR[severity].toString(),
                        }}
                        aria-hidden="true"
                      />
                      <span>
                        {translator.translateText(severity) || severity}
                      </span>
                    </>
                  ) : (
                    <span className="font-normal text-gray-400">
                      {translator.translateText("No issue")}
                    </span>
                  )}
                </dd>
              </div>
            );
          },
        )}
      </dl>

      {props.error ? (
        <p className="mt-2 pl-14 text-sm text-red-600" role="alert">
          {props.error}
        </p>
      ) : (
        <></>
      )}
    </div>
  );
};

interface CheckGroupCardProps {
  group: DataSecurityCheckGroup;
  rows: Record<string, DataSecurityCheckSetting>;
  isLocked: boolean;
  saving: Record<string, boolean>;
  errors: Record<string, string>;
  onChange: (check: DataSecurityCheckInfo, choice: CheckChoice) => void;
}

const CheckGroupCard: FunctionComponent<CheckGroupCardProps> = (
  props: CheckGroupCardProps,
): ReactElement => {
  const ruledListClassName: string = useCardRuledListClassName();
  const checks: Array<DataSecurityCheckInfo> = DATA_SECURITY_CHECKS.filter(
    (check: DataSecurityCheckInfo): boolean => {
      return check.group === props.group;
    },
  );

  return (
    <Card
      title={GROUP_TITLES[props.group]}
      description={GROUP_DESCRIPTIONS[props.group]}
    >
      <div className={ruledListClassName}>
        {checks.map((check: DataSecurityCheckInfo): ReactElement => {
          return (
            <CheckRow
              key={check.id}
              check={check}
              choice={getChoice(props.rows[check.id])}
              isLocked={props.isLocked}
              isSaving={Boolean(props.saving[check.id])}
              error={props.errors[check.id] || ""}
              onChange={(choice: CheckChoice): void => {
                props.onChange(check, choice);
              }}
            />
          );
        })}
      </div>
    </Card>
  );
};

const DataSecurityChecks: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const translator: Translator = useTranslator();
  const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();
  const projectIdString: string = projectId?.toString() || "";

  // The project's check settings, by check.
  const [rows, setRows] = useState<Record<string, DataSecurityCheckSetting>>(
    {},
  );
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");
  const [saving, setSaving] = useState<Record<string, boolean>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});

  // Bumped by every read: an answer for a read moved on from is dropped.
  const readRef: MutableRefObject<number> = useRef<number>(0);

  const load: () => Promise<void> = async (): Promise<void> => {
    const read: number = readRef.current + 1;
    readRef.current = read;

    if (!projectIdString) {
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setError("");

    try {
      const result: ListResult<DataSecurityCheckSetting> =
        await ModelAPI.getList<DataSecurityCheckSetting>({
          modelType: DataSecurityCheckSetting,
          query: { projectId: new ObjectID(projectIdString) },
          // One row per check at most.
          limit: DATA_SECURITY_CHECKS.length + 10,
          skip: 0,
          select: {
            _id: true,
            checkId: true,
            isEnabled: true,
            severityOverride: true,
          },
          sort: {},
        });

      if (read !== readRef.current) {
        return;
      }

      const byCheck: Record<string, DataSecurityCheckSetting> = {};

      for (const row of result.data) {
        if (row.checkId) {
          byCheck[row.checkId] = row;
        }
      }

      setRows(byCheck);
    } catch (err) {
      if (read !== readRef.current) {
        return;
      }

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

  const model: DataSecurityCheckSetting = new DataSecurityCheckSetting();
  const createGate: PermissionGateResult = PermissionGate.check(
    model,
    ModelAction.Create,
  );
  const updateGate: PermissionGateResult = PermissionGate.check(
    model,
    ModelAction.Update,
  );
  const canDelete: boolean = PermissionGate.check(
    model,
    ModelAction.Delete,
  ).isAllowed;
  const isLocked: boolean = !createGate.isAllowed || !updateGate.isAllowed;
  const lockedReason: string | undefined = !createGate.isAllowed
    ? createGate.disabledReason
    : updateGate.disabledReason;

  const setRowSaving: (checkId: string, isSaving: boolean) => void = (
    checkId: string,
    isSaving: boolean,
  ): void => {
    setSaving((current: Record<string, boolean>): Record<string, boolean> => {
      return { ...current, [checkId]: isSaving };
    });
  };

  const setRowError: (checkId: string, message: string) => void = (
    checkId: string,
    message: string,
  ): void => {
    setErrors((current: Record<string, string>): Record<string, string> => {
      return { ...current, [checkId]: message };
    });
  };

  const setRow: (
    checkId: string,
    row: DataSecurityCheckSetting | undefined,
  ) => void = (
    checkId: string,
    row: DataSecurityCheckSetting | undefined,
  ): void => {
    setRows(
      (
        current: Record<string, DataSecurityCheckSetting>,
      ): Record<string, DataSecurityCheckSetting> => {
        const next: Record<string, DataSecurityCheckSetting> = { ...current };

        if (row) {
          next[checkId] = row;
        } else {
          delete next[checkId];
        }

        return next;
      },
    );
  };

  /*
   * A change to one check: a row made, changed or removed, so that a check
   * that runs as it ships has none.
   */
  const changeCheck: (
    check: DataSecurityCheckInfo,
    choice: CheckChoice,
  ) => Promise<void> = async (
    check: DataSecurityCheckInfo,
    choice: CheckChoice,
  ): Promise<void> => {
    if (!projectIdString || saving[check.id]) {
      return;
    }

    const existing: DataSecurityCheckSetting | undefined = rows[check.id];
    const runsAsShipped: boolean =
      choice.isEnabled && choice.severityOverride === null;

    if (!existing && runsAsShipped) {
      return;
    }

    setRowSaving(check.id, true);
    setRowError(check.id, "");

    try {
      if (!existing) {
        const row: DataSecurityCheckSetting = new DataSecurityCheckSetting();
        row.projectId = new ObjectID(projectIdString);
        row.checkId = check.id;
        row.isEnabled = choice.isEnabled;

        if (choice.severityOverride) {
          row.severityOverride = choice.severityOverride;
        }

        const response: HTTPResponse<
          | JSONObject
          | JSONArray
          | DataSecurityCheckSetting
          | Array<DataSecurityCheckSetting>
        > = await ModelAPI.create<DataSecurityCheckSetting>({
          model: row,
          modelType: DataSecurityCheckSetting,
        });

        const created: DataSecurityCheckSetting =
          response.data as DataSecurityCheckSetting;

        const createdId: string | undefined =
          created?._id?.toString() || created?.id?.toString();

        if (createdId) {
          row._id = createdId;
        }

        setRow(check.id, row);
      } else if (runsAsShipped && canDelete && existing.id) {
        await ModelAPI.deleteItem<DataSecurityCheckSetting>({
          modelType: DataSecurityCheckSetting,
          id: existing.id,
        });

        setRow(check.id, undefined);
      } else if (existing.id) {
        await ModelAPI.updateById<DataSecurityCheckSetting>({
          modelType: DataSecurityCheckSetting,
          id: existing.id,
          data: {
            isEnabled: choice.isEnabled,
            severityOverride: choice.severityOverride,
          },
        });

        const changed: DataSecurityCheckSetting =
          new DataSecurityCheckSetting();

        if (existing._id) {
          changed._id = existing._id;
        }

        changed.checkId = check.id;
        changed.isEnabled = choice.isEnabled;

        if (choice.severityOverride) {
          changed.severityOverride = choice.severityOverride;
        }

        setRow(check.id, changed);
      }
    } catch (err) {
      setRowError(check.id, API.getFriendlyMessage(err));
    }

    setRowSaving(check.id, false);
  };

  if (isLoading) {
    return <ComponentLoader />;
  }

  if (error) {
    return (
      <ErrorMessage
        message={error}
        onRefreshClick={(): void => {
          void load();
        }}
      />
    );
  }

  return (
    <Fragment>
      {isLocked && lockedReason ? (
        <p
          className="mb-4 text-sm text-gray-500"
          data-testid={`${DATA_SECURITY_CHECKS_TEST_ID}-locked`}
        >
          {translator.translateText(lockedReason) || lockedReason}
        </p>
      ) : (
        <></>
      )}
      <div className="space-y-6" data-testid={DATA_SECURITY_CHECKS_TEST_ID}>
        {ALL_DATA_SECURITY_CHECK_GROUPS.map(
          (group: DataSecurityCheckGroup): ReactElement => {
            return (
              <CheckGroupCard
                key={group}
                group={group}
                rows={rows}
                isLocked={isLocked}
                saving={saving}
                errors={errors}
                onChange={(
                  check: DataSecurityCheckInfo,
                  choice: CheckChoice,
                ): void => {
                  void changeCheck(check, choice);
                }}
              />
            );
          },
        )}
      </div>
    </Fragment>
  );
};

export default DataSecurityChecks;

import PageComponentProps from "../../PageComponentProps";
import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import useDataSecuritySetting, {
  DataSecuritySettingState,
} from "../../../Components/DataSecurity/UseDataSecuritySetting";
import {
  getWordListElement,
  keepWordAsWritten,
  readWordList,
} from "../../../Components/DataSecurity/WordListField";
import AlertSeverity from "Common/Models/DatabaseModels/AlertSeverity";
import DataSecuritySetting from "Common/Models/DatabaseModels/DataSecuritySetting";
import IncidentSeverity from "Common/Models/DatabaseModels/IncidentSeverity";
import Route from "Common/Types/API/Route";
import ListResult from "Common/Types/BaseDatabase/ListResult";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import AdvancedPageSection from "Common/UI/Components/AdvancedPageSection/AdvancedPageSection";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import Card from "Common/UI/Components/Card/Card";
import { useCardRuledListClassName } from "Common/UI/Components/Card/CardSurface";
import ComponentLoader from "Common/UI/Components/ComponentLoader/ComponentLoader";
import Dropdown, {
  DropdownOption,
  DropdownValue,
} from "Common/UI/Components/Dropdown/Dropdown";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import FieldLabelElement from "Common/UI/Components/Forms/Fields/FieldLabel";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import {
  FoldedSectionItem,
  foldedSectionItem,
} from "Common/UI/Components/FoldedSection/FoldedSectionItem";
import CardModelDetail from "Common/UI/Components/ModelDetail/CardModelDetail";
import ModelSwitchRow from "Common/UI/Components/ModelSwitch/ModelSwitchRow";
import {
  getColumnBooleanDefault,
  ModelSwitchColumn,
} from "Common/UI/Components/ModelSwitch/ModelSwitchUtil";
import SaveStatus, {
  SaveState,
} from "Common/UI/Components/SaveStatus/SaveStatus";
import FieldType from "Common/UI/Components/Types/FieldType";
import API from "Common/UI/Utils/API/API";
import ArchivedValuePicker from "Common/UI/Utils/ArchivedValuePicker";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import Navigation from "Common/UI/Utils/Navigation";
import PermissionGate, {
  ModelAction,
  PermissionGateResult,
} from "Common/UI/Utils/PermissionGate";
import {
  composedValue,
  Translator,
  translateTemplate,
  translationKey,
} from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useEffect,
  useId,
  useState,
} from "react";

/*
 * Data Security > Settings > Scanning: the project's DataSecuritySetting,
 * the one row of switches and limits every scan reads (made with its
 * defaults when there is none yet: UseDataSecuritySetting).
 *
 *   - What Data Security Reads, and When an Issue Opens: one switch each,
 *     saving the moment it is flipped (ModelSwitchRow); under Raise alerts
 *     and Declare incidents, while each is on, the severity of what it
 *     opens.
 *   - Cloud Accounts: what a scan may read in a cloud account is not set
 *     here but on the account's cloud connection - Off, Configuration only,
 *     or Configuration and content samples - with a way to the connections.
 *   - More settings, folded: how much one scan reads (each limit held to
 *     the range the server holds it to: DATA_SECURITY_LIMITS in
 *     DataSecuritySettingService) and the values that are never findings.
 */

export const SCANNING_MORE_SETTINGS_TEST_ID: string =
  "data-security-scanning-more-settings";

export const SCANNING_READS_CARD_TEST_ID: string =
  "data-security-scanning-reads";

export const SCANNING_ISSUES_CARD_TEST_ID: string =
  "data-security-scanning-issues";

export const SCANNING_CLOUD_ACCOUNTS_TEST_ID: string =
  "data-security-scanning-cloud-accounts";

export const SCAN_LIMITS_TITLE: string = translationKey("Scan Limits");

export const NEVER_SENSITIVE_TITLE: string = translationKey("Never Sensitive");

/*
 * A limit's range and default. The ranges are the server's
 * (DATA_SECURITY_LIMITS), the defaults its columns' (DataSecuritySetting):
 * the form refuses what the server would.
 */
export interface ScanLimit {
  min: number;
  max: number;
  defaultValue: number;
  isBytes: boolean;
}

export type ScanLimitColumn =
  | "maxObjectsPerScan"
  | "maxBytesPerObject"
  | "maxBytesPerScan"
  | "maxRowsPerTable"
  | "maxTablesPerScan"
  | "telemetrySampleSize"
  | "contentScanIntervalInHours";

export const SCAN_LIMITS: Readonly<Record<ScanLimitColumn, ScanLimit>> = {
  maxObjectsPerScan: {
    min: 10,
    max: 50000,
    defaultValue: 2000,
    isBytes: false,
  },
  maxBytesPerObject: {
    min: 1024,
    max: 4194304,
    defaultValue: 65536,
    isBytes: true,
  },
  maxBytesPerScan: {
    min: 65536,
    max: 1073741824,
    defaultValue: 52428800,
    isBytes: true,
  },
  maxRowsPerTable: { min: 10, max: 100000, defaultValue: 1000, isBytes: false },
  maxTablesPerScan: { min: 1, max: 5000, defaultValue: 200, isBytes: false },
  telemetrySampleSize: {
    min: 10,
    max: 10000,
    defaultValue: 500,
    isBytes: false,
  },
  contentScanIntervalInHours: {
    min: 1,
    max: 720,
    defaultValue: 24,
    isBytes: false,
  },
};

const SCAN_LIMIT_COLUMNS: Array<ScanLimitColumn> = Object.keys(
  SCAN_LIMITS,
) as Array<ScanLimitColumn>;

const NOT_A_WHOLE_NUMBER: string = translationKey(
  "Enter a whole number from {{min}} to {{max}}.",
);

// What the folded section says of the limits once one is changed.
const SCAN_LIMITS_CHANGED: string = translationKey("Changed");

// The line under each limit's field: what it bounds, and its range.
const LIMIT_DESCRIPTIONS: Readonly<Record<ScanLimitColumn, string>> = {
  maxObjectsPerScan: translationKey(
    "The most objects one scan of a bucket reads, from {{min}} to {{max}}.",
  ),
  maxBytesPerObject: translationKey(
    "The most bytes read from one object, from {{min}} to {{max}}.",
  ),
  maxBytesPerScan: translationKey(
    "The most bytes one scan reads in all, from {{min}} to {{max}}.",
  ),
  maxRowsPerTable: translationKey(
    "The most rows read from one table, from {{min}} to {{max}}.",
  ),
  maxTablesPerScan: translationKey(
    "The most tables one scan of a database reads, from {{min}} to {{max}}.",
  ),
  telemetrySampleSize: translationKey(
    "How many recent records of each service and signal a telemetry scan reads, from {{min}} to {{max}}.",
  ),
  contentScanIntervalInHours: translationKey(
    "How many hours pass before a store's content is sampled again, from {{min}} to {{max}}.",
  ),
};

const BYTES_WITH_SIZE: string = translationKey("{{bytes}} bytes ({{size}})");

const SIZE_UNITS: Array<string> = ["KB", "MB", "GB"];

// A number of bytes as people read it: 64 KB, 50 MB, 1 GB.
export const formatBytes: (bytes: number, translator: Translator) => string = (
  bytes: number,
  translator: Translator,
): string => {
  let value: number = bytes / 1024;
  let unit: number = 0;

  while (value >= 1024 && unit < SIZE_UNITS.length - 1) {
    value = value / 1024;
    unit++;
  }

  return [
    translator.formatNumber(Math.round(value * 10) / 10),
    SIZE_UNITS[unit],
  ].join(" ");
};

// A limit's number as the reader's language writes it, a size in words too.
const formatLimit: (
  column: ScanLimitColumn,
  value: number,
  translator: Translator,
) => string = (
  column: ScanLimitColumn,
  value: number,
  translator: Translator,
): string => {
  if (!SCAN_LIMITS[column].isBytes || value < 1024) {
    return translator.formatNumber(value);
  }

  return translator.translateTemplate(BYTES_WITH_SIZE, {
    bytes: translator.formatNumber(value),
    size: formatBytes(value, translator),
  });
};

// The line under a limit's field, written with the translator it is read in.
const getLimitDescription: (
  column: ScanLimitColumn,
  translator: Translator,
) => string = (column: ScanLimitColumn, translator: Translator): string => {
  return translator.translateTemplate(LIMIT_DESCRIPTIONS[column], {
    min: composedValue((sentence: Translator): string => {
      return formatLimit(column, SCAN_LIMITS[column].min, sentence);
    }),
    max: composedValue((sentence: Translator): string => {
      return formatLimit(column, SCAN_LIMITS[column].max, sentence);
    }),
  });
};

// What the server refuses a limit with, before it is sent.
const getLimitError: (
  column: ScanLimitColumn,
  value: unknown,
) => string | null = (
  column: ScanLimitColumn,
  value: unknown,
): string | null => {
  const limit: ScanLimit = SCAN_LIMITS[column];
  const number: number =
    typeof value === "number" ? value : Number(String(value ?? "").trim());

  if (
    value === undefined ||
    value === null ||
    String(value).trim() === "" ||
    !Number.isInteger(number) ||
    number < limit.min ||
    number > limit.max
  ) {
    return translateTemplate(NOT_A_WHOLE_NUMBER, {
      min: limit.min,
      max: limit.max,
    });
  }

  return null;
};

// Whether any limit is set to something other than its default.
export const hasChangedScanLimits: (
  setting: DataSecuritySetting | null,
) => boolean = (setting: DataSecuritySetting | null): boolean => {
  if (!setting) {
    return false;
  }

  return SCAN_LIMIT_COLUMNS.some((column: ScanLimitColumn): boolean => {
    const value: unknown = setting[column];

    return (
      typeof value === "number" && value !== SCAN_LIMITS[column].defaultValue
    );
  });
};

interface ScanningSwitch {
  column: ModelSwitchColumn<DataSecuritySetting>;
  title: string;
  description: string;
  // What it says while it is off, when that differs.
  descriptionWhenOff?: string | undefined;
  dataTestId: string;
}

const READ_SWITCHES: Array<ScanningSwitch> = [
  {
    column: "isConfigurationScanEnabled",
    title: translationKey("Check configuration"),
    description: translationKey(
      "Read each store's settings and who can reach it, and run the checks.",
    ),
    dataTestId: "data-security-check-configuration",
  },
  {
    column: "isContentScanEnabled",
    title: translationKey("Scan content"),
    description: translationKey(
      "Sample stores' content for sensitive data, where the store's cloud connection allows it.",
    ),
    dataTestId: "data-security-scan-content",
  },
  {
    column: "isTelemetryScanEnabled",
    title: translationKey("Scan telemetry"),
    description: translationKey(
      "Sample the project's logs, traces, exceptions, replays and AI conversations for sensitive data.",
    ),
    dataTestId: "data-security-scan-telemetry",
  },
  {
    column: "keepMaskedSamples",
    title: translationKey("Keep masked samples"),
    description: translationKey(
      "Each finding keeps up to three masked samples, so you can tell real data from test data.",
    ),
    descriptionWhenOff: translationKey(
      "Findings keep counts only, never a sample.",
    ),
    dataTestId: "data-security-keep-masked-samples",
  },
];

const OPEN_CASES_SWITCH: ScanningSwitch = {
  column: "openCasesForCriticalIssues",
  title: translationKey("Open security cases for Critical issues"),
  description: translationKey(
    "Open a security case, grouped by store, when a Critical issue opens.",
  ),
  dataTestId: "data-security-open-cases",
};

const RAISE_ALERTS_SWITCH: ScanningSwitch = {
  column: "raiseAlertsForCriticalIssues",
  title: translationKey("Raise alerts for Critical issues"),
  description: translationKey(
    "Raise an alert, which pages whoever is on call, when a Critical issue opens.",
  ),
  dataTestId: "data-security-raise-alerts",
};

const DECLARE_INCIDENTS_SWITCH: ScanningSwitch = {
  column: "declareIncidentsForCriticalIssues",
  title: translationKey("Declare incidents for Critical issues"),
  description: translationKey(
    "Declare an incident, which runs your incident process - on-call, status pages and a postmortem - when a Critical issue opens.",
  ),
  dataTestId: "data-security-declare-incidents",
};

const NOTIFY_OWNERS_SWITCH: ScanningSwitch = {
  column: "notifyOwners",
  title: translationKey("Notify owners"),
  description: translationKey(
    "Tell a store's owners when an issue opens on it.",
  ),
  dataTestId: "data-security-notify-owners",
};

// The three levels a cloud connection grants, as its form names them.
const CLOUD_LEVELS: Array<{ title: string; description: string }> = [
  {
    title: translationKey("Off"),
    description: translationKey(
      "Nothing in the account is read. Every connection starts here.",
    ),
  },
  {
    title: translationKey("Configuration only"),
    description: translationKey(
      "How each bucket and database is set up: who can reach it, how it is encrypted and backed up. Never its data.",
    ),
  },
  {
    title: translationKey("Configuration and content samples"),
    description: translationKey(
      "That, and small samples of each store's content to find sensitive data in it. What is found is kept masked.",
    ),
  },
];

interface SwitchRowProps {
  definition: ScanningSwitch;
  setting: DataSecuritySetting;
  childrenWhileOn?: ReactElement | undefined;
}

const SwitchRow: FunctionComponent<SwitchRowProps> = (
  props: SwitchRowProps,
): ReactElement => {
  const definition: ScanningSwitch = props.definition;
  const stored: unknown = props.setting[definition.column];
  // A column the row never had set reads as its default.
  const initialValue: boolean =
    typeof stored === "boolean"
      ? stored
      : getColumnBooleanDefault(new DataSecuritySetting(), definition.column);

  return (
    <div className="px-5 py-4 md:px-6">
      <ModelSwitchRow<DataSecuritySetting>
        modelType={DataSecuritySetting}
        modelId={props.setting.id!}
        column={definition.column}
        initialValue={initialValue}
        title={definition.title}
        getDescription={(isOn: boolean): string => {
          return isOn || !definition.descriptionWhenOff
            ? definition.description
            : definition.descriptionWhenOff;
        }}
        childrenWhileOn={props.childrenWhileOn}
        dataTestId={definition.dataTestId}
      />
    </div>
  );
};

/*
 * Under Raise alerts and Declare incidents: the severity of what it opens,
 * the project's most severe while none is picked. Saved the moment it is
 * picked. Archived severities are never offered (ArchivedValuePicker); one
 * the settings already have is still shown, marked Archived, so it can be
 * kept or changed.
 */
type SeverityColumn = "alertSeverityId" | "incidentSeverityId";

interface SeverityPickerDefinition {
  column: SeverityColumn;
  title: string;
  description: string;
  dataTestId: string;
}

const ALERT_SEVERITY_PICKER: SeverityPickerDefinition = {
  column: "alertSeverityId",
  title: "Alert Severity",
  description:
    "The severity of the alerts raised. The project's most severe while none is picked.",
  dataTestId: "data-security-alert-severity",
};

const INCIDENT_SEVERITY_PICKER: SeverityPickerDefinition = {
  column: "incidentSeverityId",
  title: "Incident Severity",
  description:
    "The severity of the incidents declared. The project's most severe while none is picked.",
  dataTestId: "data-security-incident-severity",
};

type SeverityValue = AlertSeverity | IncidentSeverity;

// The project's severities of the kind a picker sets, with the archive switch.
async function readSeverities(
  column: SeverityColumn,
): Promise<Array<SeverityValue>> {
  const select: {
    _id: true;
    name: true;
    color: true;
    order: true;
    isArchived: true;
  } = {
    _id: true,
    name: true,
    color: true,
    order: true,
    isArchived: true,
  };

  if (column === "incidentSeverityId") {
    const incidentSeverities: ListResult<IncidentSeverity> =
      await ModelAPI.getList<IncidentSeverity>({
        modelType: IncidentSeverity,
        query: {},
        limit: 50,
        skip: 0,
        select,
        sort: { order: SortOrder.Ascending },
      });

    return incidentSeverities.data;
  }

  const alertSeverities: ListResult<AlertSeverity> =
    await ModelAPI.getList<AlertSeverity>({
      modelType: AlertSeverity,
      query: {},
      limit: 50,
      skip: 0,
      select,
      sort: { order: SortOrder.Ascending },
    });

  return alertSeverities.data;
}

const SeverityPicker: FunctionComponent<{
  setting: DataSecuritySetting;
  definition: SeverityPickerDefinition;
}> = (props: {
  setting: DataSecuritySetting;
  definition: SeverityPickerDefinition;
}): ReactElement => {
  const translator: Translator = useTranslator();
  const definition: SeverityPickerDefinition = props.definition;
  const labelId: string = `${definition.dataTestId}-label-${useId()}`;
  const descriptionId: string = `${definition.dataTestId}-description-${useId()}`;

  const [options, setOptions] = useState<Array<DropdownOption>>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");
  const [selectedId, setSelectedId] = useState<string>(
    props.setting[definition.column]?.toString() || "",
  );
  const [saveState, setSaveState] = useState<SaveState>(SaveState.Idle);

  useEffect(() => {
    let isCurrent: boolean = true;

    const load: () => Promise<void> = async (): Promise<void> => {
      try {
        // Read with the archive switch, so archived ones can be told apart.
        const severities: Array<SeverityValue> = await readSeverities(
          definition.column,
        );

        if (!isCurrent) {
          return;
        }

        const keptId: string =
          props.setting[definition.column]?.toString() || "";

        setOptions(
          ArchivedValuePicker.getPickerOptions<SeverityValue>({
            values: severities,
            options: severities.map(
              (severity: SeverityValue): DropdownOption => {
                return {
                  value: severity._id?.toString() || "",
                  label: severity.name || "",
                  isUserContent: true,
                  ...(severity.color ? { color: severity.color } : {}),
                };
              },
            ),
            keptIds: keptId ? [keptId] : [],
          }),
        );
      } catch (err) {
        if (isCurrent) {
          setError(API.getFriendlyMessage(err));
        }
      }

      if (isCurrent) {
        setIsLoading(false);
      }
    };

    void load();

    return () => {
      isCurrent = false;
    };
  }, []);

  const gate: PermissionGateResult = PermissionGate.checkColumnUpdate(
    new DataSecuritySetting(),
    definition.column,
  );

  const save: (value: string) => Promise<void> = async (
    value: string,
  ): Promise<void> => {
    const previous: string = selectedId;

    setSelectedId(value);
    setSaveState(SaveState.Saving);
    setError("");

    try {
      await ModelAPI.updateById<DataSecuritySetting>({
        modelType: DataSecuritySetting,
        id: props.setting.id!,
        data: { [definition.column]: value || null },
      });

      setSaveState(SaveState.Saved);
    } catch (err) {
      setSelectedId(previous);
      setError(API.getFriendlyMessage(err));
      setSaveState(SaveState.Idle);
    }
  };

  return (
    <div data-testid={definition.dataTestId}>
      <FieldLabelElement
        title={definition.title}
        id={labelId}
        description={definition.description}
        descriptionId={descriptionId}
        hideOptionalLabel={true}
      />
      <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="w-full sm:max-w-xs">
          <Dropdown
            options={options}
            value={options.find((option: DropdownOption): boolean => {
              return option.value === selectedId;
            })}
            placeholder="The project's most severe"
            isClearable={true}
            isLoading={isLoading}
            disabled={!gate.isAllowed || saveState === SaveState.Saving}
            ariaLabelledby={labelId}
            ariaDescribedby={descriptionId}
            onChange={(
              value: DropdownValue | Array<DropdownValue> | null,
            ): void => {
              void save(
                value === null || Array.isArray(value) ? "" : String(value),
              );
            }}
          />
        </div>
        <SaveStatus state={saveState} />
      </div>
      {error ? (
        <p className="mt-2 text-sm text-red-600" role="alert">
          {error}
        </p>
      ) : (
        <></>
      )}
      {!gate.isAllowed && gate.disabledReason ? (
        <p className="mt-2 text-xs text-gray-500">
          {translator.translateText(gate.disabledReason) || gate.disabledReason}
        </p>
      ) : (
        <></>
      )}
    </div>
  );
};

const CloudAccountsCard: FunctionComponent = (): ReactElement => {
  const translator: Translator = useTranslator();
  const ruledListClassName: string = useCardRuledListClassName();

  return (
    <Card
      title="Cloud Accounts"
      description="What a scan may read in a cloud account is set on that account's cloud connection, under its connection settings."
      buttons={[
        {
          title: "Open Cloud Connections",
          icon: IconProp.Cloud,
          buttonStyle: ButtonStyleType.NORMAL,
          onClick: (): void => {
            Navigation.navigate(
              RouteUtil.populateRouteParams(
                RouteMap[PageMap.CLOUD_CONNECT] as Route,
              ),
            );
          },
        },
      ]}
    >
      <div
        className={ruledListClassName}
        data-testid={SCANNING_CLOUD_ACCOUNTS_TEST_ID}
      >
        {CLOUD_LEVELS.map(
          (level: { title: string; description: string }): ReactElement => {
            return (
              <div key={level.title} className="px-5 py-4 md:px-6">
                <div className="text-sm font-medium text-gray-900">
                  {translator.translateText(level.title) || level.title}
                </div>
                <div className="mt-0.5 text-sm text-gray-500">
                  {translator.translateText(level.description) ||
                    level.description}
                </div>
              </div>
            );
          },
        )}
      </div>
    </Card>
  );
};

const DataSecurityScanning: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const translator: Translator = useTranslator();
  const ruledListClassName: string = useCardRuledListClassName();
  const settingState: DataSecuritySettingState = useDataSecuritySetting();
  const setting: DataSecuritySetting | null = settingState.setting;

  // What the folded cards hold, as each last read it.
  const [limitsRead, setLimitsRead] = useState<DataSecuritySetting | null>(
    null,
  );
  const [neverSensitiveCount, setNeverSensitiveCount] = useState<number>(0);

  useEffect(() => {
    setLimitsRead(setting);
    setNeverSensitiveCount(readWordList(setting?.allowedValues).length);
  }, [setting?.id?.toString()]);

  if (settingState.isLoading) {
    return <ComponentLoader />;
  }

  if (settingState.error) {
    return (
      <ErrorMessage
        message={settingState.error}
        onRefreshClick={settingState.reload}
      />
    );
  }

  if (!setting || !setting.id) {
    const createGate: PermissionGateResult = PermissionGate.check(
      new DataSecuritySetting(),
      ModelAction.Create,
    );

    return (
      <ErrorMessage
        message={
          createGate.disabledReason ||
          translator.translateText(
            "This project's Data Security settings are not made yet. Try again in a moment.",
          ) ||
          ""
        }
        onRefreshClick={settingState.reload}
      />
    );
  }

  const settingId: ObjectID = setting.id;

  const moreSettingsItems: Array<FoldedSectionItem> = [
    foldedSectionItem(SCAN_LIMITS_TITLE, {
      isSet: hasChangedScanLimits(limitsRead),
      value: hasChangedScanLimits(limitsRead) ? SCAN_LIMITS_CHANGED : undefined,
      translateValue: true,
    }),
    foldedSectionItem(NEVER_SENSITIVE_TITLE, {
      isSet: neverSensitiveCount > 0,
      value: neverSensitiveCount > 0 ? String(neverSensitiveCount) : undefined,
    }),
  ];

  return (
    <Fragment>
      <Card
        title="What Data Security Reads"
        description="What scans read in this project's data stores and telemetry, and what they keep."
      >
        <div
          className={ruledListClassName}
          data-testid={SCANNING_READS_CARD_TEST_ID}
        >
          {READ_SWITCHES.map((definition: ScanningSwitch): ReactElement => {
            return (
              <SwitchRow
                key={definition.column}
                definition={definition}
                setting={setting}
              />
            );
          })}
        </div>
      </Card>

      <Card
        title="When an Issue Opens"
        description="Who hears of an issue Data Security opens, and what it starts."
      >
        <div
          className={ruledListClassName}
          data-testid={SCANNING_ISSUES_CARD_TEST_ID}
        >
          <SwitchRow definition={OPEN_CASES_SWITCH} setting={setting} />
          <SwitchRow
            definition={RAISE_ALERTS_SWITCH}
            setting={setting}
            childrenWhileOn={
              <SeverityPicker
                setting={setting}
                definition={ALERT_SEVERITY_PICKER}
              />
            }
          />
          <SwitchRow
            definition={DECLARE_INCIDENTS_SWITCH}
            setting={setting}
            childrenWhileOn={
              <SeverityPicker
                setting={setting}
                definition={INCIDENT_SEVERITY_PICKER}
              />
            }
          />
          <SwitchRow definition={NOTIFY_OWNERS_SWITCH} setting={setting} />
        </div>
      </Card>

      <CloudAccountsCard />

      <AdvancedPageSection
        description="How much one scan reads, and values that are never findings."
        items={moreSettingsItems}
        dataTestId={SCANNING_MORE_SETTINGS_TEST_ID}
      >
        <CardModelDetail<DataSecuritySetting>
          name="Data Security Scan Limits"
          cardProps={{
            title: SCAN_LIMITS_TITLE,
            description:
              "How much one scan reads: enough to find sensitive data, never a whole store.",
          }}
          isEditable={true}
          editButtonText="Edit"
          editModalTitle={SCAN_LIMITS_TITLE}
          formSteps={[
            { title: "Objects", id: "objects" },
            { title: "Tables", id: "tables" },
            { title: "Telemetry and Schedule", id: "schedule" },
          ]}
          formFields={[
            {
              field: { maxObjectsPerScan: true },
              title: "Objects Per Scan",
              description: getLimitDescription("maxObjectsPerScan", translator),
              stepId: "objects",
              fieldType: FormFieldSchemaType.Number,
              required: true,
              validation: {
                minValue: SCAN_LIMITS.maxObjectsPerScan.min,
                maxValue: SCAN_LIMITS.maxObjectsPerScan.max,
              },
              customValidation: (
                values: FormValues<DataSecuritySetting>,
              ): string | null => {
                return getLimitError(
                  "maxObjectsPerScan",
                  (values as Record<string, unknown>)["maxObjectsPerScan"],
                );
              },
            },
            {
              field: { maxBytesPerObject: true },
              title: "Bytes Per Object",
              description: getLimitDescription("maxBytesPerObject", translator),
              stepId: "objects",
              fieldType: FormFieldSchemaType.Number,
              required: true,
              validation: {
                minValue: SCAN_LIMITS.maxBytesPerObject.min,
                maxValue: SCAN_LIMITS.maxBytesPerObject.max,
              },
              customValidation: (
                values: FormValues<DataSecuritySetting>,
              ): string | null => {
                return getLimitError(
                  "maxBytesPerObject",
                  (values as Record<string, unknown>)["maxBytesPerObject"],
                );
              },
            },
            {
              field: { maxBytesPerScan: true },
              title: "Bytes Per Scan",
              description: getLimitDescription("maxBytesPerScan", translator),
              stepId: "objects",
              fieldType: FormFieldSchemaType.Number,
              required: true,
              validation: {
                minValue: SCAN_LIMITS.maxBytesPerScan.min,
                maxValue: SCAN_LIMITS.maxBytesPerScan.max,
              },
              customValidation: (
                values: FormValues<DataSecuritySetting>,
              ): string | null => {
                return getLimitError(
                  "maxBytesPerScan",
                  (values as Record<string, unknown>)["maxBytesPerScan"],
                );
              },
            },
            {
              field: { maxRowsPerTable: true },
              title: "Rows Per Table",
              description: getLimitDescription("maxRowsPerTable", translator),
              stepId: "tables",
              fieldType: FormFieldSchemaType.Number,
              required: true,
              validation: {
                minValue: SCAN_LIMITS.maxRowsPerTable.min,
                maxValue: SCAN_LIMITS.maxRowsPerTable.max,
              },
              customValidation: (
                values: FormValues<DataSecuritySetting>,
              ): string | null => {
                return getLimitError(
                  "maxRowsPerTable",
                  (values as Record<string, unknown>)["maxRowsPerTable"],
                );
              },
            },
            {
              field: { maxTablesPerScan: true },
              title: "Tables Per Scan",
              description: getLimitDescription("maxTablesPerScan", translator),
              stepId: "tables",
              fieldType: FormFieldSchemaType.Number,
              required: true,
              validation: {
                minValue: SCAN_LIMITS.maxTablesPerScan.min,
                maxValue: SCAN_LIMITS.maxTablesPerScan.max,
              },
              customValidation: (
                values: FormValues<DataSecuritySetting>,
              ): string | null => {
                return getLimitError(
                  "maxTablesPerScan",
                  (values as Record<string, unknown>)["maxTablesPerScan"],
                );
              },
            },
            {
              field: { telemetrySampleSize: true },
              title: "Telemetry Sample Size",
              description: getLimitDescription(
                "telemetrySampleSize",
                translator,
              ),
              stepId: "schedule",
              fieldType: FormFieldSchemaType.Number,
              required: true,
              validation: {
                minValue: SCAN_LIMITS.telemetrySampleSize.min,
                maxValue: SCAN_LIMITS.telemetrySampleSize.max,
              },
              customValidation: (
                values: FormValues<DataSecuritySetting>,
              ): string | null => {
                return getLimitError(
                  "telemetrySampleSize",
                  (values as Record<string, unknown>)["telemetrySampleSize"],
                );
              },
            },
            {
              field: { contentScanIntervalInHours: true },
              title: "Scan Every (Hours)",
              description: getLimitDescription(
                "contentScanIntervalInHours",
                translator,
              ),
              stepId: "schedule",
              fieldType: FormFieldSchemaType.Number,
              required: true,
              validation: {
                minValue: SCAN_LIMITS.contentScanIntervalInHours.min,
                maxValue: SCAN_LIMITS.contentScanIntervalInHours.max,
              },
              customValidation: (
                values: FormValues<DataSecuritySetting>,
              ): string | null => {
                return getLimitError(
                  "contentScanIntervalInHours",
                  (values as Record<string, unknown>)[
                    "contentScanIntervalInHours"
                  ],
                );
              },
            },
          ]}
          modelDetailProps={{
            modelType: DataSecuritySetting,
            id: "data-security-scan-limits",
            modelId: settingId,
            onItemLoaded: (item: DataSecuritySetting): void => {
              setLimitsRead(item);
            },
            fields: [
              {
                field: { maxObjectsPerScan: true },
                title: "Objects Per Scan",
                fieldType: FieldType.Element,
                getElement: (item: DataSecuritySetting): ReactElement => {
                  return (
                    <span>
                      {formatLimit(
                        "maxObjectsPerScan",
                        item.maxObjectsPerScan ??
                          SCAN_LIMITS.maxObjectsPerScan.defaultValue,
                        translator,
                      )}
                    </span>
                  );
                },
              },
              {
                field: { maxBytesPerObject: true },
                title: "Bytes Per Object",
                fieldType: FieldType.Element,
                getElement: (item: DataSecuritySetting): ReactElement => {
                  return (
                    <span>
                      {formatLimit(
                        "maxBytesPerObject",
                        item.maxBytesPerObject ??
                          SCAN_LIMITS.maxBytesPerObject.defaultValue,
                        translator,
                      )}
                    </span>
                  );
                },
              },
              {
                field: { maxBytesPerScan: true },
                title: "Bytes Per Scan",
                fieldType: FieldType.Element,
                getElement: (item: DataSecuritySetting): ReactElement => {
                  return (
                    <span>
                      {formatLimit(
                        "maxBytesPerScan",
                        item.maxBytesPerScan ??
                          SCAN_LIMITS.maxBytesPerScan.defaultValue,
                        translator,
                      )}
                    </span>
                  );
                },
              },
              {
                field: { maxRowsPerTable: true },
                title: "Rows Per Table",
                fieldType: FieldType.Element,
                getElement: (item: DataSecuritySetting): ReactElement => {
                  return (
                    <span>
                      {formatLimit(
                        "maxRowsPerTable",
                        item.maxRowsPerTable ??
                          SCAN_LIMITS.maxRowsPerTable.defaultValue,
                        translator,
                      )}
                    </span>
                  );
                },
              },
              {
                field: { maxTablesPerScan: true },
                title: "Tables Per Scan",
                fieldType: FieldType.Element,
                getElement: (item: DataSecuritySetting): ReactElement => {
                  return (
                    <span>
                      {formatLimit(
                        "maxTablesPerScan",
                        item.maxTablesPerScan ??
                          SCAN_LIMITS.maxTablesPerScan.defaultValue,
                        translator,
                      )}
                    </span>
                  );
                },
              },
              {
                field: { telemetrySampleSize: true },
                title: "Telemetry Sample Size",
                fieldType: FieldType.Element,
                getElement: (item: DataSecuritySetting): ReactElement => {
                  return (
                    <span>
                      {formatLimit(
                        "telemetrySampleSize",
                        item.telemetrySampleSize ??
                          SCAN_LIMITS.telemetrySampleSize.defaultValue,
                        translator,
                      )}
                    </span>
                  );
                },
              },
              {
                field: { contentScanIntervalInHours: true },
                title: "Scan Every (Hours)",
                fieldType: FieldType.Element,
                getElement: (item: DataSecuritySetting): ReactElement => {
                  return (
                    <span>
                      {formatLimit(
                        "contentScanIntervalInHours",
                        item.contentScanIntervalInHours ??
                          SCAN_LIMITS.contentScanIntervalInHours.defaultValue,
                        translator,
                      )}
                    </span>
                  );
                },
              },
            ],
          }}
        />
        <CardModelDetail<DataSecuritySetting>
          name="Data Security Never Sensitive Values"
          cardProps={{
            title: NEVER_SENSITIVE_TITLE,
            description:
              "Values that are never findings, such as your own support address or a test card number.",
          }}
          isEditable={true}
          editButtonText="Edit"
          editModalTitle={NEVER_SENSITIVE_TITLE}
          formFields={[
            {
              field: { allowedValues: true },
              title: "Values",
              description:
                "Each is left out of every scan, in any case. Type one and press Enter.",
              fieldType: FormFieldSchemaType.CustomComponent,
              required: false,
              getCustomElement: getWordListElement<DataSecuritySetting>({
                column: "allowedValues",
                placeholder: "support@example.com",
                normalize: keepWordAsWritten,
                dataTestId: "data-security-never-sensitive-values",
              }),
            },
          ]}
          modelDetailProps={{
            modelType: DataSecuritySetting,
            id: "data-security-never-sensitive",
            modelId: settingId,
            onItemLoaded: (item: DataSecuritySetting): void => {
              setNeverSensitiveCount(readWordList(item.allowedValues).length);
            },
            fields: [
              {
                field: { allowedValues: true },
                title: "Values",
                fieldType: FieldType.Element,
                getElement: (item: DataSecuritySetting): ReactElement => {
                  const values: Array<string> = readWordList(
                    item.allowedValues,
                  );

                  if (values.length === 0) {
                    return (
                      <span className="text-gray-500">
                        {translator.translateText(
                          "None. Every value a data type matches can be a finding.",
                        )}
                      </span>
                    );
                  }

                  return (
                    <div className="flex flex-wrap gap-1">
                      {values.map((value: string): ReactElement => {
                        return (
                          <code
                            key={value}
                            className="rounded bg-gray-100 px-1.5 py-0.5 font-mono text-xs text-gray-700 [overflow-wrap:anywhere]"
                          >
                            {value}
                          </code>
                        );
                      })}
                    </div>
                  );
                },
              },
            ],
          }}
        />
      </AdvancedPageSection>
    </Fragment>
  );
};

export default DataSecurityScanning;

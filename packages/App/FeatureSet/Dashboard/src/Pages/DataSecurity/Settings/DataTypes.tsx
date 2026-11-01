import PageComponentProps from "../../PageComponentProps";
import {
  ConfidencePill,
  SensitivityPill,
} from "../../../Components/DataSecurity/DataSecurityPills";
import {
  CustomDataTypeTestMatch,
  CustomDataTypeTestOutcome,
  CustomDataTypeTestResult,
  getCustomDataTypePatternError,
  MAX_CUSTOM_DATA_TYPE_TEST_MATCHES,
  readCustomDataTypeDefinition,
  readCustomDataTypeWords,
  testCustomDataType,
} from "../../../Components/DataSecurity/CustomDataTypeTest";
import useDataSecuritySetting, {
  DataSecuritySettingState,
} from "../../../Components/DataSecurity/UseDataSecuritySetting";
import {
  getWordListElement,
  lowerCaseWord,
} from "../../../Components/DataSecurity/WordListField";
import DataSecurityCustomDataType from "Common/Models/DatabaseModels/DataSecurityCustomDataType";
import DataSecuritySetting from "Common/Models/DatabaseModels/DataSecuritySetting";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import { Green, Red } from "Common/Types/BrandColors";
import DataCategory, {
  ALL_DATA_CATEGORIES,
  DATA_CATEGORY_DESCRIPTION,
} from "Common/Types/DataSecurity/DataCategory";
import DataSensitivity, {
  ALL_DATA_SENSITIVITIES,
  DATA_SENSITIVITY_DESCRIPTION,
} from "Common/Types/DataSecurity/DataSensitivity";
import {
  DATA_TYPE_CATALOG,
  DataTypeInfo,
} from "Common/Types/DataSecurity/DataTypeCatalog";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import { CustomDataTypeValidator } from "Common/Utils/DataSecurity/CustomDataTypeDetector";
import Alert, { AlertType } from "Common/UI/Components/Alerts/Alert";
import Card from "Common/UI/Components/Card/Card";
import { useCardRuledListClassName } from "Common/UI/Components/Card/CardSurface";
import ComponentLoader from "Common/UI/Components/ComponentLoader/ComponentLoader";
import { DropdownOption } from "Common/UI/Components/Dropdown/Dropdown";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import {
  CustomElementProps,
  FormFieldCollapsibleSection,
} from "Common/UI/Components/Forms/Types/Field";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import { getAdvancedFormSection } from "Common/UI/Components/Forms/Utils/AdvancedFormSection";
import Icon from "Common/UI/Components/Icon/Icon";
import Input from "Common/UI/Components/Input/Input";
import { ModalWidth } from "Common/UI/Components/Modal/Modal";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import Pill from "Common/UI/Components/Pill/Pill";
import SaveStatus, {
  SaveState,
} from "Common/UI/Components/SaveStatus/SaveStatus";
import TextArea from "Common/UI/Components/TextArea/TextArea";
import Toggle from "Common/UI/Components/Toggle/Toggle";
import FieldType from "Common/UI/Components/Types/FieldType";
import API from "Common/UI/Utils/API/API";
import { Countries, CountryOption } from "Common/UI/Utils/Countries";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import PermissionGate, {
  ModelAction,
  PermissionGateResult,
} from "Common/UI/Utils/PermissionGate";
import ProjectUtil from "Common/UI/Utils/Project";
import {
  PluralTemplate,
  Translator,
  translationKey,
} from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  Fragment,
  FunctionComponent,
  MutableRefObject,
  ReactElement,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

/*
 * Data Security > Settings > Data Types: what a scan looks for.
 *
 *   - Built-in Data Types: every kind of sensitive data Data Security knows
 *     (Types/DataSecurity/DataTypeCatalog), by category, each with what it
 *     is, how sensitive it is, whose country it belongs to, and a switch.
 *     A type turned off is kept in the project's settings
 *     (DataSecuritySetting.disabledDataTypeIds) and no scan looks for it.
 *     Each switch saves the moment it is flipped. The categories open one
 *     at a time; a search opens every category with a match.
 *   - Your Data Types: the project's own (DataSecurityCustomDataType) - an
 *     employee ID, a policy number - with a form that asks what the type is,
 *     then how it is found, and a Test It panel that runs the scanner on
 *     text pasted into it, in the browser (CustomDataTypeTest).
 */

export const BUILT_IN_DATA_TYPES_TEST_ID: string =
  "data-security-built-in-data-types";

export const CUSTOM_DATA_TYPES_TABLE_ID: string =
  "data-security-custom-data-types-table";

export const CUSTOM_DATA_TYPE_TEST_PANEL_TEST_ID: string =
  "data-security-custom-data-type-test";

// The most keywords or field names one type keeps (the server's limit).
const MAX_WORDS: number = 50;

const CATEGORY_COUNT: string = translationKey("{{on}} of {{total}} on");

const FOUND_COUNT: PluralTemplate = {
  one: translationKey("Found {{count}} value."),
  other: translationKey("Found {{count}} values."),
};

const getCountryName: (code: string | undefined) => string = (
  code: string | undefined,
): string => {
  if (!code) {
    return "";
  }

  return (
    Countries.find((country: CountryOption): boolean => {
      return country.value === code;
    })?.label || code
  );
};

const getCategoryOptions: () => Array<DropdownOption> =
  (): Array<DropdownOption> => {
    return ALL_DATA_CATEGORIES.map((category: DataCategory): DropdownOption => {
      return {
        label: category,
        value: category,
        description: DATA_CATEGORY_DESCRIPTION[category],
      };
    });
  };

const getSensitivityOptions: () => Array<DropdownOption> =
  (): Array<DropdownOption> => {
    return ALL_DATA_SENSITIVITIES.map(
      (sensitivity: DataSensitivity): DropdownOption => {
        return {
          label: sensitivity,
          value: sensitivity,
          description: DATA_SENSITIVITY_DESCRIPTION[sensitivity],
        };
      },
    );
  };

const CHECKSUM_OPTIONS: Array<DropdownOption> = [
  {
    label: "None",
    value: CustomDataTypeValidator.None,
    description: "Values are not checked.",
  },
  {
    label: "Luhn",
    value: CustomDataTypeValidator.Luhn,
    description: "The check digit card numbers and IMEIs carry.",
  },
  {
    label: "Mod97",
    value: CustomDataTypeValidator.Mod97,
    description: "The check digits an IBAN carries.",
  },
  {
    label: "Verhoeff",
    value: CustomDataTypeValidator.Verhoeff,
    description: "The check digit an Aadhaar number carries.",
  },
];

// The same list, in the same order, as an array the switches can be read from.
const sortedIds: (ids: Iterable<string>) => Array<string> = (
  ids: Iterable<string>,
): Array<string> => {
  return Array.from(new Set<string>(ids)).sort();
};

const isSameList: (a: Array<string>, b: Array<string>) => boolean = (
  a: Array<string>,
  b: Array<string>,
): boolean => {
  return (
    a.length === b.length &&
    a.every((id: string, index: number) => {
      return id === b[index];
    })
  );
};

// Whether a built-in type is what a search asks for.
const matchesSearch: (
  info: DataTypeInfo,
  query: string,
  translator: Translator,
) => boolean = (
  info: DataTypeInfo,
  query: string,
  translator: Translator,
): boolean => {
  if (!query) {
    return true;
  }

  const country: string = getCountryName(info.country);

  return [
    info.id,
    info.name,
    translator.translateText(info.name) || "",
    info.description,
    translator.translateText(info.description) || "",
    info.country || "",
    country,
    ...info.nameHints,
  ].some((text: string): boolean => {
    return text.toLowerCase().includes(query);
  });
};

interface DataTypeRowProps {
  info: DataTypeInfo;
  isOn: boolean;
  isLocked: boolean;
  onChange: (isOn: boolean) => void;
}

// One built-in type: its switch, what it is, and how sensitive it is.
const DataTypeRow: FunctionComponent<DataTypeRowProps> = (
  props: DataTypeRowProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const country: string = getCountryName(props.info.country);

  return (
    <div
      className="flex flex-col gap-2 px-5 py-3 sm:flex-row sm:items-start sm:justify-between md:px-6"
      data-testid={`data-type-${props.info.id}`}
    >
      <div className="min-w-0 flex-1">
        <Toggle
          title={props.info.name}
          description={props.info.description}
          value={props.isOn}
          disabled={props.isLocked}
          onChange={props.onChange}
          dataTestId={`data-type-${props.info.id}-switch`}
        />
      </div>
      <div className="flex flex-shrink-0 flex-wrap items-center gap-2 pl-14 sm:pl-0">
        {props.info.foundBy === "name" ? (
          <span className="text-xs text-gray-500">
            {translator.translateText("Found from field names")}
          </span>
        ) : (
          <></>
        )}
        {country ? (
          <span className="text-xs text-gray-500" title={props.info.country}>
            {translator.translateText(country) || country}
          </span>
        ) : (
          <></>
        )}
        <SensitivityPill sensitivity={props.info.sensitivity} />
      </div>
    </div>
  );
};

/*
 * Every built-in data type, by category, each switched on or off in the
 * project's settings.
 */
const BuiltInDataTypesCard: FunctionComponent = (): ReactElement => {
  const translator: Translator = useTranslator();
  const ruledListClassName: string = useCardRuledListClassName();
  const settingState: DataSecuritySettingState = useDataSecuritySetting();
  const setting: DataSecuritySetting | null = settingState.setting;

  const [search, setSearch] = useState<string>("");
  const deferredSearch: string = useDeferredValue(search);
  const query: string = deferredSearch.trim().toLowerCase();

  const [openCategories, setOpenCategories] = useState<Array<DataCategory>>([]);

  // The types turned off, as the switches show them.
  const [disabledIds, setDisabledIds] = useState<Array<string>>([]);
  const [saveState, setSaveState] = useState<SaveState>(SaveState.Idle);
  const [saveError, setSaveError] = useState<string>("");

  // What the server holds, and what the switches ask for.
  const savedRef: MutableRefObject<Array<string>> = useRef<Array<string>>([]);
  const wantedRef: MutableRefObject<Array<string>> = useRef<Array<string>>([]);
  const isSavingRef: MutableRefObject<boolean> = useRef<boolean>(false);

  const settingId: string = setting?.id?.toString() || "";

  useEffect(() => {
    const read: Array<string> = sortedIds(setting?.disabledDataTypeIds || []);

    savedRef.current = read;
    wantedRef.current = read;
    setDisabledIds(read);
  }, [settingId]);

  /*
   * Each flip saves the whole list. Flips made while a save is out wait
   * for it and go in the next one, so the last list asked for is the one
   * saved, in order.
   */
  const save: () => Promise<void> = async (): Promise<void> => {
    if (isSavingRef.current || !settingId) {
      return;
    }

    isSavingRef.current = true;
    setSaveState(SaveState.Saving);
    setSaveError("");

    try {
      while (!isSameList(wantedRef.current, savedRef.current)) {
        const sending: Array<string> = [...wantedRef.current];

        await ModelAPI.updateById<DataSecuritySetting>({
          modelType: DataSecuritySetting,
          id: new ObjectID(settingId),
          data: { disabledDataTypeIds: sending },
        });

        savedRef.current = sending;
      }

      setSaveState(SaveState.Saved);
    } catch (err) {
      // Back to what is saved, with the server's reason.
      wantedRef.current = savedRef.current;
      setDisabledIds(savedRef.current);
      setSaveError(API.getFriendlyMessage(err));
      setSaveState(SaveState.Idle);
    }

    isSavingRef.current = false;
  };

  const setTypeOn: (id: string, isOn: boolean) => void = (
    id: string,
    isOn: boolean,
  ): void => {
    const next: Set<string> = new Set<string>(wantedRef.current);

    if (isOn) {
      next.delete(id);
    } else {
      next.add(id);
    }

    wantedRef.current = sortedIds(next);
    setDisabledIds(wantedRef.current);
    void save();
  };

  // Who may flip the switches: the column's own update permissions.
  const editGate: PermissionGateResult = setting
    ? PermissionGate.checkColumnUpdate(
        new DataSecuritySetting(),
        "disabledDataTypeIds",
      )
    : PermissionGate.check(new DataSecuritySetting(), ModelAction.Create);
  const isLocked: boolean = !setting || !editGate.isAllowed;

  const groups: Array<{
    category: DataCategory;
    types: Array<DataTypeInfo>;
    onCount: number;
    total: number;
  }> = useMemo(() => {
    return ALL_DATA_CATEGORIES.map((category: DataCategory) => {
      const all: Array<DataTypeInfo> = DATA_TYPE_CATALOG.filter(
        (info: DataTypeInfo): boolean => {
          return info.category === category;
        },
      );

      return {
        category: category,
        types: all.filter((info: DataTypeInfo): boolean => {
          return matchesSearch(info, query, translator);
        }),
        onCount: all.filter((info: DataTypeInfo): boolean => {
          return !disabledIds.includes(info.id);
        }).length,
        total: all.length,
      };
    }).filter((group: { types: Array<DataTypeInfo> }): boolean => {
      return group.types.length > 0;
    });
  }, [query, disabledIds, translator.language]);

  const toggleCategory: (category: DataCategory) => void = (
    category: DataCategory,
  ): void => {
    setOpenCategories((current: Array<DataCategory>): Array<DataCategory> => {
      return current.includes(category)
        ? current.filter((open: DataCategory): boolean => {
            return open !== category;
          })
        : [...current, category];
    });
  };

  const getBody: () => ReactElement = (): ReactElement => {
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

    return (
      <Fragment>
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="w-full sm:max-w-sm">
            <Input
              value={search}
              onChange={setSearch}
              placeholder="Search data types"
              ariaLabel={
                translator.translateText("Search data types") ||
                "Search data types"
              }
              dataTestId={`${BUILT_IN_DATA_TYPES_TEST_ID}-search`}
              isSearchOrFilter={true}
            />
          </div>
          <SaveStatus
            state={saveState}
            dataTestId={`${BUILT_IN_DATA_TYPES_TEST_ID}-status`}
          />
        </div>

        {saveError ? (
          <Alert
            type={AlertType.DANGER}
            title={saveError}
            className="mb-4"
            dataTestId={`${BUILT_IN_DATA_TYPES_TEST_ID}-error`}
          />
        ) : (
          <></>
        )}

        {isLocked && editGate.disabledReason ? (
          <p className="mb-4 text-sm text-gray-500">
            {editGate.disabledReason}
          </p>
        ) : (
          <></>
        )}

        {groups.length === 0 ? (
          <p
            className="py-6 text-center text-sm text-gray-500"
            data-testid={`${BUILT_IN_DATA_TYPES_TEST_ID}-no-match`}
          >
            {translator.translateTemplate(
              "No built-in data type matches {{search}}.",
              { search: deferredSearch.trim() },
            )}
          </p>
        ) : (
          <div className={ruledListClassName}>
            {groups.map(
              (group: {
                category: DataCategory;
                types: Array<DataTypeInfo>;
                onCount: number;
                total: number;
              }): ReactElement => {
                const isOpen: boolean =
                  Boolean(query) || openCategories.includes(group.category);
                const listId: string = `data-types-${group.category
                  .toLowerCase()
                  .replace(/[^a-z]+/g, "-")}`;

                return (
                  <div key={group.category}>
                    <button
                      type="button"
                      className="flex w-full items-start justify-between gap-4 px-5 py-4 text-left hover:bg-gray-50 md:px-6"
                      aria-expanded={isOpen}
                      aria-controls={listId}
                      onClick={(): void => {
                        toggleCategory(group.category);
                      }}
                      data-testid={`${listId}-header`}
                    >
                      <div className="min-w-0">
                        <div className="text-sm font-medium text-gray-900">
                          {translator.translateText(group.category) ||
                            group.category}
                        </div>
                        <div className="mt-0.5 text-sm text-gray-500">
                          {translator.translateText(
                            DATA_CATEGORY_DESCRIPTION[group.category],
                          ) || DATA_CATEGORY_DESCRIPTION[group.category]}
                        </div>
                      </div>
                      <div className="flex flex-shrink-0 items-center gap-3">
                        <span className="text-sm text-gray-500">
                          {translator.translateTemplate(CATEGORY_COUNT, {
                            on: group.onCount,
                            total: group.total,
                          })}
                        </span>
                        <Icon
                          icon={
                            isOpen ? IconProp.ChevronUp : IconProp.ChevronDown
                          }
                          className="h-4 w-4 text-gray-400"
                        />
                      </div>
                    </button>
                    {isOpen ? (
                      <div
                        id={listId}
                        className="divide-y divide-gray-100 border-t border-gray-100 bg-gray-50/40"
                      >
                        {group.types.map((info: DataTypeInfo): ReactElement => {
                          return (
                            <DataTypeRow
                              key={info.id}
                              info={info}
                              isOn={!disabledIds.includes(info.id)}
                              isLocked={isLocked}
                              onChange={(isOn: boolean): void => {
                                setTypeOn(info.id, isOn);
                              }}
                            />
                          );
                        })}
                      </div>
                    ) : (
                      <></>
                    )}
                  </div>
                );
              },
            )}
          </div>
        )}
      </Fragment>
    );
  };

  return (
    <Card
      title="Built-in Data Types"
      description="The kinds of sensitive data every scan looks for. Turn off the ones your project never holds, or that only cause noise."
    >
      <div data-testid={BUILT_IN_DATA_TYPES_TEST_ID}>{getBody()}</div>
    </Card>
  );
};

export interface TestPanelProps {
  values: FormValues<DataSecurityCustomDataType>;
  ariaLabelledby?: string | undefined;
  ariaDescribedby?: string | undefined;
}

/*
 * Test It: text pasted here is run through the data type as the form holds
 * it now, in the browser, and what it finds is listed masked.
 */
export const CustomDataTypeTestPanel: FunctionComponent<TestPanelProps> = (
  props: TestPanelProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const [sample, setSample] = useState<string>("");
  const deferredSample: string = useDeferredValue(sample);
  const values: Record<string, unknown> = (props.values || {}) as Record<
    string,
    unknown
  >;

  // The definition as text, so a new copy of the same values tests nothing again.
  const definitionKey: string = JSON.stringify(
    readCustomDataTypeDefinition(values),
  );

  const result: CustomDataTypeTestResult = useMemo(() => {
    return testCustomDataType(values, deferredSample);
  }, [definitionKey, deferredSample, translator.language]);

  const getResult: () => ReactElement = (): ReactElement => {
    if (result.outcome === CustomDataTypeTestOutcome.Unusable) {
      return (
        <p
          className="text-sm text-red-600"
          data-testid={`${CUSTOM_DATA_TYPE_TEST_PANEL_TEST_ID}-problem`}
        >
          {result.problem}
        </p>
      );
    }

    if (result.outcome === CustomDataTypeTestOutcome.FieldNamesOnly) {
      return (
        <p className="text-sm text-gray-500">
          {translator.translateText(
            "This data type has no pattern, so scans find it from field names alone. There is nothing to test in text.",
          )}
        </p>
      );
    }

    if (result.outcome === CustomDataTypeTestOutcome.NoSample) {
      return (
        <p className="text-sm text-gray-500">
          {translator.translateText(
            "Paste some text above to see what the pattern finds in it.",
          )}
        </p>
      );
    }

    return (
      <div className="space-y-2">
        <p
          className="text-sm font-medium text-gray-900"
          data-testid={`${CUSTOM_DATA_TYPE_TEST_PANEL_TEST_ID}-summary`}
        >
          {result.outcome === CustomDataTypeTestOutcome.Found
            ? translator.translatePlural(FOUND_COUNT, result.foundCount)
            : translator.translateText(
                "Nothing in this text is this data type.",
              )}
        </p>

        {result.matches.length > 0 ? (
          <ul
            className="divide-y divide-gray-100 rounded-md border border-gray-200"
            data-testid={`${CUSTOM_DATA_TYPE_TEST_PANEL_TEST_ID}-matches`}
          >
            {result.matches.map(
              (match: CustomDataTypeTestMatch): ReactElement => {
                return (
                  <li
                    key={`${match.start}-${match.end}`}
                    className="flex items-center justify-between gap-3 px-3 py-2"
                  >
                    <code className="min-w-0 font-mono text-sm text-gray-900 [overflow-wrap:anywhere]">
                      {match.masked}
                    </code>
                    <ConfidencePill confidence={match.confidence} />
                  </li>
                );
              },
            )}
          </ul>
        ) : (
          <></>
        )}

        {result.foundCount > result.matches.length ? (
          <p className="text-xs text-gray-500">
            {translator.translateTemplate("The first {{count}} are listed.", {
              count: MAX_CUSTOM_DATA_TYPE_TEST_MATCHES,
            })}
          </p>
        ) : (
          <></>
        )}

        {result.hints.map((hint: string): ReactElement => {
          return (
            <p key={hint} className="text-xs text-gray-500">
              {hint}
            </p>
          );
        })}
      </div>
    );
  };

  return (
    <div
      className="space-y-3"
      data-testid={CUSTOM_DATA_TYPE_TEST_PANEL_TEST_ID}
    >
      <TextArea
        value={sample}
        onChange={setSample}
        placeholder="Paste a log line, a row of a CSV file or any other text."
        ariaLabelledby={props.ariaLabelledby}
        ariaDescribedby={props.ariaDescribedby}
        rows={4}
        disableSpellCheck={true}
        dataTestId={`${CUSTOM_DATA_TYPE_TEST_PANEL_TEST_ID}-input`}
      />
      {getResult()}
      {result.isSampleCut ? (
        <p className="text-xs text-gray-500">
          {translator.translateText(
            "Only the first 64 KB of the text is tested.",
          )}
        </p>
      ) : (
        <></>
      )}
    </div>
  );
};

// What it is: its name and description open, the rest folded.
const dataTypeMoreFields: FormFieldCollapsibleSection<DataSecurityCustomDataType> =
  getAdvancedFormSection<DataSecurityCustomDataType>();

const getWordsError: (
  value: unknown,
  tooMany: string,
  translator: Translator,
) => string | null = (
  value: unknown,
  tooMany: string,
  translator: Translator,
): string | null => {
  return readCustomDataTypeWords(value).length > MAX_WORDS
    ? translator.translateTemplate(tooMany, { count: MAX_WORDS })
    : null;
};

// The project's own data types, with Test It in their form.
const CustomDataTypesTable: FunctionComponent = (): ReactElement => {
  const translator: Translator = useTranslator();
  const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();

  return (
    <ModelTable<DataSecurityCustomDataType>
      modelType={DataSecurityCustomDataType}
      id={CUSTOM_DATA_TYPES_TABLE_ID}
      name="Data Security > Settings > Data Types"
      userPreferencesKey={CUSTOM_DATA_TYPES_TABLE_ID}
      query={projectId ? { projectId: projectId } : {}}
      isDeleteable={true}
      isEditable={true}
      isCreateable={true}
      isViewable={false}
      createEditModalWidth={ModalWidth.Large}
      sortBy="name"
      sortOrder={SortOrder.Ascending}
      cardProps={{
        title: "Your Data Types",
        description:
          "Kinds of sensitive data your project defines itself, such as employee IDs or policy numbers. Scans look for them with the built-in ones.",
      }}
      emptyState={{
        description:
          "Add a pattern, the words that confirm it and the field names that hold it, and test it on sample text before you save.",
        icon: IconProp.Fingerprint,
      }}
      rowSwitch={{ column: "isEnabled" }}
      createInitialValues={{
        category: DataCategory.ContactAndIdentity,
        sensitivity: DataSensitivity.Confidential,
      }}
      selectMoreFields={{
        description: true,
        nameHints: true,
        isEnabled: true,
      }}
      formSteps={[
        { title: "Data Type", id: "data-type" },
        { title: "How It Is Found", id: "how-it-is-found" },
      ]}
      formFields={[
        {
          field: { name: true },
          title: "Name",
          stepId: "data-type",
          fieldType: FormFieldSchemaType.Text,
          required: true,
          placeholder: "Employee ID",
          hideColumnDescription: true,
        },
        {
          field: { category: true },
          title: "Category",
          description:
            "The kind of data it is, as the built-in types are grouped.",
          stepId: "data-type",
          fieldType: FormFieldSchemaType.Dropdown,
          dropdownOptions: getCategoryOptions(),
          required: true,
        },
        {
          field: { sensitivity: true },
          title: "Sensitivity",
          description:
            "How much harm follows if it leaks. A store is as sensitive as the most sensitive data in it.",
          stepId: "data-type",
          fieldType: FormFieldSchemaType.Dropdown,
          dropdownOptions: getSensitivityOptions(),
          required: true,
        },
        {
          field: { description: true },
          title: "Description",
          stepId: "data-type",
          fieldType: FormFieldSchemaType.LongText,
          required: false,
          placeholder:
            "Staff numbers HR gives every employee, such as EMP-123456.",
          hideColumnDescription: true,
          collapsibleSection: dataTypeMoreFields,
        },
        {
          field: { isEnabled: true },
          title: "Enabled",
          description: "Whether scans look for this data type.",
          stepId: "data-type",
          fieldType: FormFieldSchemaType.Toggle,
          required: false,
          collapsibleSection: dataTypeMoreFields,
        },
        {
          field: { pattern: true },
          title: "Pattern",
          description:
            "A regular expression for one value, without slashes or flags. Leave it empty to find the type from field names alone.",
          stepId: "how-it-is-found",
          fieldType: FormFieldSchemaType.Text,
          // Without field names to be found by, a type needs a pattern.
          required: (
            values: FormValues<DataSecurityCustomDataType>,
          ): boolean => {
            return (
              readCustomDataTypeWords(
                (values as Record<string, unknown>)["nameHints"],
              ).length === 0
            );
          },
          placeholder: "EMP-\\d{6}",
          disableSpellCheck: true,
          customValidation: (
            values: FormValues<DataSecurityCustomDataType>,
          ): string | null => {
            return getCustomDataTypePatternError(
              values as Record<string, unknown>,
            );
          },
        },
        {
          field: { nameHints: true },
          title: "Field Names",
          description:
            "Column, field and attribute names that hold it. employee id also matches employeeId and employee_id.",
          stepId: "how-it-is-found",
          fieldType: FormFieldSchemaType.CustomComponent,
          required: false,
          getCustomElement: getWordListElement<DataSecurityCustomDataType>({
            column: "nameHints",
            placeholder: "employee id",
            normalize: lowerCaseWord,
            dataTestId: "custom-data-type-field-names",
          }),
          customValidation: (
            values: FormValues<DataSecurityCustomDataType>,
          ): string | null => {
            return getWordsError(
              (values as Record<string, unknown>)["nameHints"],
              "Field names can hold at most {{count}} entries.",
              translator,
            );
          },
        },
        {
          field: { keywords: true },
          title: "Keywords",
          description: "Words that, near a value, confirm it is this type.",
          stepId: "how-it-is-found",
          fieldType: FormFieldSchemaType.CustomComponent,
          required: false,
          getCustomElement: getWordListElement<DataSecurityCustomDataType>({
            column: "keywords",
            placeholder: "employee",
            normalize: lowerCaseWord,
            dataTestId: "custom-data-type-keywords",
          }),
          customValidation: (
            values: FormValues<DataSecurityCustomDataType>,
          ): string | null => {
            return getWordsError(
              (values as Record<string, unknown>)["keywords"],
              "Keywords can hold at most {{count}} entries.",
              translator,
            );
          },
        },
        {
          // Runs the form's values; saves nothing.
          overrideField: { pattern: true },
          overrideFieldKey: "testDataType",
          formOnly: true,
          title: "Test It",
          description:
            "Paste sample text to see what this data type finds in it. The text stays in your browser.",
          stepId: "how-it-is-found",
          fieldType: FormFieldSchemaType.CustomComponent,
          required: false,
          hideColumnDescription: true,
          getCustomElement: (
            values: FormValues<DataSecurityCustomDataType>,
            elementProps: CustomElementProps,
          ): ReactElement => {
            return (
              <CustomDataTypeTestPanel
                values={values}
                ariaLabelledby={elementProps.ariaLabelledby}
                ariaDescribedby={elementProps.ariaDescribedby}
              />
            );
          },
        },
        {
          field: { ignoreCase: true },
          title: "Ignore Case",
          description: "Match the pattern whatever the case of its letters.",
          stepId: "how-it-is-found",
          fieldType: FormFieldSchemaType.Toggle,
          required: false,
          collapsibleSection: dataTypeMoreFields,
        },
        {
          field: { requiresKeyword: true },
          title: "Requires A Keyword",
          description:
            "Count a value only when a keyword is near it, or the field's name says it is this type.",
          stepId: "how-it-is-found",
          fieldType: FormFieldSchemaType.Toggle,
          required: false,
          // It asks for one of the keywords: with none, it would ask nothing.
          showIf: (values: FormValues<DataSecurityCustomDataType>): boolean => {
            return (
              readCustomDataTypeWords(
                (values as Record<string, unknown>)["keywords"],
              ).length > 0
            );
          },
          collapsibleSection: dataTypeMoreFields,
        },
        {
          field: { validator: true },
          title: "Checksum",
          description:
            "A check a value must pass to count, as card numbers and IBANs carry.",
          stepId: "how-it-is-found",
          fieldType: FormFieldSchemaType.Dropdown,
          dropdownOptions: CHECKSUM_OPTIONS,
          required: false,
          collapsibleSection: dataTypeMoreFields,
        },
      ]}
      showRefreshButton={true}
      filters={[
        { field: { name: true }, title: "Name", type: FieldType.Text },
        {
          field: { category: true },
          title: "Category",
          type: FieldType.Dropdown,
          filterDropdownOptions: getCategoryOptions(),
        },
        {
          field: { sensitivity: true },
          title: "Sensitivity",
          type: FieldType.Dropdown,
          filterDropdownOptions: getSensitivityOptions(),
        },
        {
          field: { isEnabled: true },
          title: "Enabled",
          type: FieldType.Boolean,
        },
      ]}
      columns={[
        {
          field: { name: true },
          title: "Name",
          type: FieldType.Element,
          getElement: (item: DataSecurityCustomDataType): ReactElement => {
            return (
              <div className="min-w-0">
                <div className="text-sm font-medium text-gray-900">
                  {item.name || ""}
                </div>
                {item.description ? (
                  <div className="mt-0.5 text-sm text-gray-500">
                    {item.description}
                  </div>
                ) : (
                  <></>
                )}
              </div>
            );
          },
        },
        {
          field: { category: true },
          title: "Category",
          type: FieldType.Element,
          hideOnMobile: true,
          getElement: (item: DataSecurityCustomDataType): ReactElement => {
            const category: string = item.category || "";

            return (
              <span className="text-sm text-gray-700">
                {translator.translateText(category) || category}
              </span>
            );
          },
        },
        {
          field: { sensitivity: true },
          title: "Sensitivity",
          type: FieldType.Element,
          getElement: (item: DataSecurityCustomDataType): ReactElement => {
            return <SensitivityPill sensitivity={item.sensitivity} />;
          },
        },
        {
          field: { pattern: true },
          title: "Found By",
          type: FieldType.Element,
          hideOnMobile: true,
          getElement: (item: DataSecurityCustomDataType): ReactElement => {
            if (item.pattern) {
              return (
                <code className="font-mono text-xs text-gray-700 [overflow-wrap:anywhere]">
                  {item.pattern}
                </code>
              );
            }

            return (
              <span className="text-sm text-gray-500">
                {translator.translateText("Field names only")}
              </span>
            );
          },
        },
        {
          field: { isEnabled: true },
          title: "Status",
          type: FieldType.Boolean,
          getElement: (item: DataSecurityCustomDataType): ReactElement => {
            return item.isEnabled ? (
              <Pill color={Green} text="Enabled" />
            ) : (
              <Pill color={Red} text="Disabled" />
            );
          },
        },
      ]}
    />
  );
};

const DataSecurityDataTypes: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  return (
    <Fragment>
      <BuiltInDataTypesCard />
      <CustomDataTypesTable />
    </Fragment>
  );
};

export default DataSecurityDataTypes;

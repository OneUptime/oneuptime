import PageComponentProps from "../../PageComponentProps";
import {
  getWordListElement,
  lowerCaseWord,
  readWordList,
} from "../../../Components/DataSecurity/WordListField";
import DataSecurityResidencyRule from "Common/Models/DatabaseModels/DataSecurityResidencyRule";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import { Green, Red } from "Common/Types/BrandColors";
import DataCategory, {
  ALL_DATA_CATEGORIES,
  DATA_CATEGORY_DESCRIPTION,
} from "Common/Types/DataSecurity/DataCategory";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import Card from "Common/UI/Components/Card/Card";
import { DropdownOption } from "Common/UI/Components/Dropdown/Dropdown";
import { FormFieldCollapsibleSection } from "Common/UI/Components/Forms/Types/Field";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import { getAdvancedFormSection } from "Common/UI/Components/Forms/Utils/AdvancedFormSection";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import Pill from "Common/UI/Components/Pill/Pill";
import FieldType from "Common/UI/Components/Types/FieldType";
import { Countries, CountryOption } from "Common/UI/Utils/Countries";
import ProjectUtil from "Common/UI/Utils/Project";
import {
  Translator,
  translateTemplate,
  translationKey,
} from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { Fragment, FunctionComponent, ReactElement } from "react";

/*
 * Data Security > Settings > Residency: where data may live.
 *
 * A residency rule (DataSecurityResidencyRule) names the regions some data
 * may be stored and copied in, written the way each cloud names its regions
 * with * for any characters (eu-*, europe-*, westeurope). By itself it
 * covers every kind of personal data; it can be narrowed to some data
 * categories, or to data about people in some countries - which the data
 * types found in a store tell (a German tax ID is a German's). A store that
 * holds such data in a region, or copies it to one, that no allowed region
 * matches fails the residency check.
 *
 * The form asks for a name and the regions; what the rule covers, its
 * description and its switch wait folded under More fields, since most
 * rules cover all personal data. Two worked examples sit under the table.
 */

export const RESIDENCY_RULES_TABLE_ID: string =
  "data-security-residency-rules-table";

export const RESIDENCY_EXAMPLES_TEST_ID: string =
  "data-security-residency-examples";

// The most regions one rule names (the server's limit).
const MAX_REGIONS: number = 100;

// A region as the server takes it: lower case, letters, digits, - and *.
const REGION_PATTERN: RegExp = /^[a-z0-9*][a-z0-9*-]{0,63}$/;

// Common region patterns, offered to pick: AWS, Google Cloud, Azure.
const REGION_SUGGESTIONS: ReadonlyArray<string> = [
  "eu-*",
  "europe-*",
  "westeurope",
  "northeurope",
  "us-*",
  "us-east-*",
  "eastus",
  "westus",
  "ap-south-*",
  "asia-south*",
  "centralindia",
];

const NOT_A_REGION: string = translationKey(
  "{{region}} is not a region. Write regions as your cloud names them, such as eu-west-1, europe-west4 or westeurope; * matches any characters.",
);

const TOO_MANY_REGIONS: string = translationKey(
  "A rule names at most {{count}} regions.",
);

const NO_REGION: string = translationKey(
  "Name at least one region the data may live in.",
);

/*
 * What is wrong with the regions the form holds, as the server would say
 * it (DataSecurityResidencyRuleService.readRegions), or null.
 */
export const getResidencyRegionsError: (value: unknown) => string | null = (
  value: unknown,
): string | null => {
  const regions: Array<string> = readWordList(value, lowerCaseWord);

  if (regions.length === 0) {
    return translateTemplate(NO_REGION);
  }

  if (regions.length > MAX_REGIONS) {
    return translateTemplate(TOO_MANY_REGIONS, { count: MAX_REGIONS });
  }

  const wrong: string | undefined = regions.find((region: string): boolean => {
    return !REGION_PATTERN.test(region);
  });

  return wrong ? translateTemplate(NOT_A_REGION, { region: wrong }) : null;
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

const getCountryOptions: () => Array<DropdownOption> =
  (): Array<DropdownOption> => {
    return Countries.map((country: CountryOption): DropdownOption => {
      return { label: country.label, value: country.value };
    });
  };

const getCountryName: (code: string) => string = (code: string): string => {
  return (
    Countries.find((country: CountryOption): boolean => {
      return country.value === code;
    })?.label || code
  );
};

// The rule's description, its switch and what it covers, folded.
const residencyMoreFields: FormFieldCollapsibleSection<DataSecurityResidencyRule> =
  getAdvancedFormSection<DataSecurityResidencyRule>();

interface ExampleRule {
  name: string;
  data: string;
  people: string;
  regions: Array<string>;
}

// What each line of an example says it is.
const EXAMPLE_DATA_TITLE: string = translationKey("Data");
const EXAMPLE_PEOPLE_TITLE: string = translationKey("People In");
const EXAMPLE_REGIONS_TITLE: string = translationKey("Allowed Regions");

// Two rules as a project would write them.
const EXAMPLE_RULES: Array<ExampleRule> = [
  {
    name: translationKey("EU personal data stays in the EU"),
    data: translationKey("All personal data"),
    people: translationKey("Anyone"),
    regions: ["eu-*", "europe-*", "westeurope", "northeurope"],
  },
  {
    name: translationKey("Indian health data stays in India"),
    data: translationKey("Health, Government ID"),
    people: translationKey("India (IN)"),
    regions: ["ap-south-*", "asia-south*", "centralindia", "southindia"],
  },
];

// A list of regions, each as the cloud writes it.
const RegionList: FunctionComponent<{ regions: Array<string> }> = (props: {
  regions: Array<string>;
}): ReactElement => {
  return (
    <div className="flex flex-wrap gap-1">
      {props.regions.map((region: string): ReactElement => {
        return (
          <code
            key={region}
            className="rounded bg-gray-100 px-1.5 py-0.5 font-mono text-xs text-gray-700"
          >
            {region}
          </code>
        );
      })}
    </div>
  );
};

const ResidencyExamples: FunctionComponent = (): ReactElement => {
  const translator: Translator = useTranslator();

  const getLine: (title: string, value: ReactElement) => ReactElement = (
    title: string,
    value: ReactElement,
  ): ReactElement => {
    return (
      <div className="grid grid-cols-3 gap-2">
        <dt className="text-xs text-gray-500">
          {translator.translateText(title) || title}
        </dt>
        <dd className="col-span-2 min-w-0 text-sm text-gray-700">{value}</dd>
      </div>
    );
  };

  return (
    <Card
      title="How Residency Rules Work"
      description="A rule names the regions some data may live in. A store that keeps that data, or a copy of it, anywhere else fails the residency check."
    >
      <div
        className="grid grid-cols-1 gap-4 md:grid-cols-2"
        data-testid={RESIDENCY_EXAMPLES_TEST_ID}
      >
        {EXAMPLE_RULES.map((rule: ExampleRule): ReactElement => {
          return (
            <div
              key={rule.name}
              className="rounded-md border border-gray-200 p-4"
            >
              <div className="mb-3 text-sm font-medium text-gray-900">
                {translator.translateText(rule.name) || rule.name}
              </div>
              <dl className="space-y-2">
                {getLine(
                  EXAMPLE_DATA_TITLE,
                  <span>
                    {translator.translateText(rule.data) || rule.data}
                  </span>,
                )}
                {getLine(
                  EXAMPLE_PEOPLE_TITLE,
                  <span>
                    {translator.translateText(rule.people) || rule.people}
                  </span>,
                )}
                {getLine(
                  EXAMPLE_REGIONS_TITLE,
                  <RegionList regions={rule.regions} />,
                )}
              </dl>
            </div>
          );
        })}
      </div>
    </Card>
  );
};

const DataSecurityResidency: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const translator: Translator = useTranslator();
  const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();

  return (
    <Fragment>
      <ModelTable<DataSecurityResidencyRule>
        modelType={DataSecurityResidencyRule}
        id={RESIDENCY_RULES_TABLE_ID}
        name="Data Security > Settings > Residency Rules"
        userPreferencesKey={RESIDENCY_RULES_TABLE_ID}
        query={projectId ? { projectId: projectId } : {}}
        isDeleteable={true}
        isEditable={true}
        isCreateable={true}
        isViewable={false}
        sortBy="name"
        sortOrder={SortOrder.Ascending}
        cardProps={{
          title: "Residency Rules",
          description:
            "Where data may live: the regions a store may keep personal data in, or a category of it, and copy it to.",
        }}
        emptyState={{
          description:
            "Name the regions your data may live in, such as eu-* and europe-* for data that stays in the EU.",
          icon: IconProp.Globe,
        }}
        rowSwitch={{ column: "isEnabled" }}
        selectMoreFields={{
          description: true,
          isEnabled: true,
        }}
        formFields={[
          {
            field: { name: true },
            title: "Name",
            fieldType: FormFieldSchemaType.Text,
            required: true,
            placeholder: "EU personal data stays in the EU",
            hideColumnDescription: true,
          },
          {
            field: { allowedRegions: true },
            title: "Allowed Regions",
            description:
              "The regions the data may live in, as your cloud names them. * matches any characters: eu-*, europe-*, westeurope.",
            fieldType: FormFieldSchemaType.CustomComponent,
            required: true,
            getCustomElement: getWordListElement<DataSecurityResidencyRule>({
              column: "allowedRegions",
              placeholder: "eu-*",
              normalize: lowerCaseWord,
              suggestions: REGION_SUGGESTIONS,
              dataTestId: "residency-rule-allowed-regions",
            }),
            customValidation: (
              values: FormValues<DataSecurityResidencyRule>,
            ): string | null => {
              return getResidencyRegionsError(
                (values as Record<string, unknown>)["allowedRegions"],
              );
            },
          },
          {
            field: { dataCategories: true },
            title: "Data Categories",
            description:
              "The data the rule covers. Leave it empty for every kind of personal data.",
            fieldType: FormFieldSchemaType.MultiSelectDropdown,
            dropdownOptions: getCategoryOptions(),
            required: false,
            placeholder: "All personal data",
            collapsibleSection: residencyMoreFields,
          },
          {
            field: { subjectCountries: true },
            title: "Data About People In",
            description:
              "Only data about people in these countries, as its data types tell. Leave it empty for anyone's.",
            fieldType: FormFieldSchemaType.MultiSelectDropdown,
            dropdownOptions: getCountryOptions(),
            required: false,
            placeholder: "People anywhere",
            collapsibleSection: residencyMoreFields,
          },
          {
            field: { description: true },
            title: "Description",
            fieldType: FormFieldSchemaType.LongText,
            required: false,
            placeholder: "Our EU customers' data is stored in the EU only.",
            hideColumnDescription: true,
            collapsibleSection: residencyMoreFields,
          },
          {
            field: { isEnabled: true },
            title: "Enabled",
            description: "Whether stores are checked against this rule.",
            fieldType: FormFieldSchemaType.Toggle,
            required: false,
            collapsibleSection: residencyMoreFields,
          },
        ]}
        showRefreshButton={true}
        filters={[
          { field: { name: true }, title: "Name", type: FieldType.Text },
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
            getElement: (item: DataSecurityResidencyRule): ReactElement => {
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
            field: { allowedRegions: true },
            title: "Allowed Regions",
            type: FieldType.Element,
            getElement: (item: DataSecurityResidencyRule): ReactElement => {
              return <RegionList regions={item.allowedRegions || []} />;
            },
          },
          {
            field: { dataCategories: true },
            title: "Data",
            type: FieldType.Element,
            hideOnMobile: true,
            getElement: (item: DataSecurityResidencyRule): ReactElement => {
              const categories: Array<string> = item.dataCategories || [];

              return (
                <span className="text-sm text-gray-700">
                  {categories.length === 0
                    ? translator.translateText("All personal data")
                    : categories
                        .map((category: string): string => {
                          return translator.translateText(category) || category;
                        })
                        .join(", ")}
                </span>
              );
            },
          },
          {
            field: { subjectCountries: true },
            title: "People In",
            type: FieldType.Element,
            hideOnMobile: true,
            getElement: (item: DataSecurityResidencyRule): ReactElement => {
              const countries: Array<string> = item.subjectCountries || [];

              return (
                <span className="text-sm text-gray-700">
                  {countries.length === 0
                    ? translator.translateText("Anyone")
                    : countries
                        .map((code: string): string => {
                          const name: string = getCountryName(code);

                          return translator.translateText(name) || name;
                        })
                        .join(", ")}
                </span>
              );
            },
          },
          {
            field: { isEnabled: true },
            title: "Status",
            type: FieldType.Boolean,
            getElement: (item: DataSecurityResidencyRule): ReactElement => {
              return item.isEnabled ? (
                <Pill color={Green} text="Enabled" />
              ) : (
                <Pill color={Red} text="Disabled" />
              );
            },
          },
        ]}
      />
      <ResidencyExamples />
    </Fragment>
  );
};

export default DataSecurityResidency;

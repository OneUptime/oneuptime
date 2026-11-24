import DataCategory from "../../../../../Types/DataSecurity/DataCategory";
import { DataSecurityAiFeature } from "../../../../../Types/DataSecurity/DataSecurityAiFeatures";
import DataSensitivity from "../../../../../Types/DataSecurity/DataSensitivity";
import { DataStoreKind } from "../../../../../Types/DataSecurity/DataStoreKind";
import {
  DATA_TYPE_CATALOG,
  DataTypeInfo,
} from "../../../../../Types/DataSecurity/DataTypeCatalog";
import { compileCustomDataType } from "../../../../../Utils/DataSecurity/CustomDataTypeDetector";
import {
  checkDataTypeDraft,
  DataTypeDraftProblem,
  toCustomDataTypeDefinition,
} from "../../../../../Utils/DataSecurity/DataTypeProposal";
import {
  findSensitiveValues,
  ScanDetector,
  TextMatch,
} from "../../../../../Utils/DataSecurity/TextScanner";
import {
  describeUnplacedField,
  UnplacedField,
  UnplacedValueShape,
  valueShape,
} from "../../../../../Utils/DataSecurity/UnplacedFields";
import {
  buildDescribeDataTypePrompt,
  buildDraftDataTypePrompt,
  DataSecurityAiPrompt,
} from "../../DataSecurity/DataSecurityAiInput";
import {
  DATA_TYPE_DRAFT_MAX_COMPLETION_TOKENS,
} from "../../DataSecurity/DataTypeDiscovery";
import {
  DataTypeDraftAnswer,
  DESCRIBE_DATA_TYPE_SYSTEM_PROMPT,
  DRAFT_DATA_TYPE_SYSTEM_PROMPT,
  readDataTypeDraftAnswer,
} from "../../DataSecurity/DataTypeDraftPrompt";
import { DESCRIBE_DATA_TYPE_MAX_COMPLETION_TOKENS } from "../../DataSecurity/DataTypeFromSentence";
import {
  DataTypeEvalExpectation,
  DescribeDataTypeEvalCase,
  DraftDataTypesEvalCase,
} from "./DataSecurityEvalCase";

/*
 * THE COMPANY'S OWN DATA TYPES, IN THE DATA SECURITY EVAL (#10371): groups
 * of fields scans could not place, and sentences a person writes on the
 * data type form, each with the data type it should become.
 *
 * Every group is made up, in the shapes the product reads: each field
 * described from made-up values by the scanner's own code
 * (describeUnplacedField), so the model is told what the product tells it
 * - names and shapes, never a value. A right answer is the type a person
 * would write: its pattern, held to what a saved type is held to, finds
 * the case's made-up values and none of the ones beside them; its category
 * and sensitivity are ones the case allows. A group that holds nothing of
 * the company's own - order numbers, product codes, a type OneUptime knows
 * - is right only when no type is drafted for it.
 */

// The data types OneUptime knows, as the product names them to the model.
export const EVAL_KNOWN_DATA_TYPES: ReadonlyArray<string> =
  DATA_TYPE_CATALOG.map((info: DataTypeInfo): string => {
    return info.name;
  });

// A field of a group, described from made-up values as a scan describes it.
function described(data: {
  location: string;
  values: Array<string>;
  neighbours?: Array<string> | undefined;
  locationKind?: string | undefined;
}): UnplacedField {
  const field: UnplacedField | null = describeUnplacedField({
    path: data.location,
    values: data.values,
    neighbours: data.neighbours || ["created_at", "customer_name", "status"],
    locationKind: data.locationKind || "Column",
  });

  if (!field) {
    throw new Error(`The eval's field ${data.location} is not one a scan keeps.`);
  }

  return field;
}

// Made-up values of a pattern: each "#" a digit, each "@" a capital letter.
function madeUp(template: string, count: number, seed: number): Array<string> {
  const values: Array<string> = [];

  for (let index: number = 0; index < count; index++) {
    let value: string = "";
    let state: number = seed * 7919 + index * 104729;

    for (const character of template) {
      state = (state * 1103515245 + 12345) % 2147483648;

      if (character === "#") {
        value += String(state % 10);
      } else if (character === "@") {
        value += String.fromCharCode(65 + (state % 26));
      } else {
        value += character;
      }
    }

    values.push(value);
  }

  return values;
}

function column(
  storeKind: string,
  location: string,
  template: string,
  seed: number,
): { storeKind: string; field: UnplacedField } {
  return {
    storeKind,
    field: described({ location, values: madeUp(template, 30, seed) }),
  };
}

const POLICY_NUMBER_EXPECTATION: DataTypeEvalExpectation = {
  becomes: {
    name: "Insurance policy number",
    category: DataCategory.Financial,
    sensitivity: DataSensitivity.Confidential,
    pattern: "\\b[A-Z]{2}-?\\d{7}\\b",
  },
  finds: ["AB-1234567", "XY9876543", "QL-0004211"],
  keeps: ["AB-123456", "ABC-1234567", "AB-12345678", "2026-11-23", "pending"],
  categories: [
    DataCategory.Financial,
    DataCategory.ContactAndIdentity,
    DataCategory.BusinessConfidential,
  ],
  sensitivities: [DataSensitivity.Confidential, DataSensitivity.Restricted],
};

export const DRAFT_DATA_TYPE_EVAL_CASES: ReadonlyArray<DraftDataTypesEvalCase> =
  [
    {
      id: "data-type-policy-numbers-in-six-stores",
      title:
        "Eleven policy number columns in six stores, named policy_no, policyNumber and police_nr",
      feature: DataSecurityAiFeature.DraftDataTypes,
      storeCount: 6,
      fields: [
        column(DataStoreKind.PostgreSql, "public.policies.policy_no", "@@-#######", 1),
        column(DataStoreKind.PostgreSql, "public.claims.policy_no", "@@-#######", 2),
        column(DataStoreKind.MySql, "sales.contracts.policyNumber", "@@-#######", 3),
        column(DataStoreKind.MySql, "sales.renewals.policyNumber", "@@#######", 4),
        column(DataStoreKind.SqlServer, "dbo.vertraege.police_nr", "@@-#######", 5),
        column(DataStoreKind.SqlServer, "dbo.schaeden.police_nr", "@@-#######", 6),
        column(DataStoreKind.AwsDynamoDbTable, "policy_ref", "@@-#######", 7),
      ],
      expect: POLICY_NUMBER_EXPECTATION,
    },
    {
      id: "data-type-policy-numbers-on-spans",
      title:
        "A policy_ref attribute on the spans and logs of three services holds policy numbers",
      feature: DataSecurityAiFeature.DraftDataTypes,
      storeCount: 4,
      fields: [
        {
          storeKind: DataStoreKind.TelemetryTraces,
          field: described({
            location: "attributes.policy_ref",
            values: madeUp("@@-#######", 30, 11),
            neighbours: ["attributes.http.route", "attributes.customer.tier"],
            locationKind: "Attribute",
          }),
        },
        {
          storeKind: DataStoreKind.TelemetryLogs,
          field: described({
            location: "attributes.policy_ref",
            values: madeUp("@@-#######", 30, 12),
            neighbours: ["body", "attributes.claim.state"],
            locationKind: "Attribute",
          }),
        },
        {
          storeKind: DataStoreKind.TelemetryTraces,
          field: described({
            location: "attributes.app.policy.number",
            values: madeUp("@@#######", 30, 13),
            neighbours: ["attributes.http.route"],
            locationKind: "Attribute",
          }),
        },
      ],
      expect: POLICY_NUMBER_EXPECTATION,
    },
    {
      id: "data-type-staff-numbers",
      title:
        "Staff numbers of three letters and six digits under personnel_no and staffNumber",
      feature: DataSecurityAiFeature.DraftDataTypes,
      storeCount: 3,
      fields: [
        column(DataStoreKind.PostgreSql, "hr.people.personnel_no", "@@@-######", 21),
        column(DataStoreKind.PostgreSql, "hr.payroll.personnel_no", "@@@######", 22),
        column(DataStoreKind.MySql, "app.users.staffNumber", "@@@-######", 23),
        column(DataStoreKind.GcpBigQueryDataset, "events.staff_number", "@@@-######", 24),
      ],
      expect: {
        becomes: {
          name: "Employee number",
          category: DataCategory.ContactAndIdentity,
          sensitivity: DataSensitivity.Confidential,
          pattern: "\\b[A-Z]{3}-?\\d{6}\\b",
        },
        finds: ["EMP-482913", "HRX771204", "PER-000042"],
        keeps: ["EMP-48291", "EMPL-482913", "2026-11-23", "active"],
        categories: [
          DataCategory.ContactAndIdentity,
          DataCategory.BusinessConfidential,
          DataCategory.GovernmentId,
        ],
        sensitivities: [
          DataSensitivity.Confidential,
          DataSensitivity.Internal,
          DataSensitivity.Restricted,
        ],
      },
    },
    {
      id: "data-type-patient-references",
      title:
        "Patient references of two letters, six digits and a letter, named patient_ref and pat_ref",
      feature: DataSecurityAiFeature.DraftDataTypes,
      storeCount: 2,
      fields: [
        column(DataStoreKind.PostgreSql, "clinic.visits.patient_ref", "@@######@", 31),
        column(DataStoreKind.PostgreSql, "clinic.labs.pat_ref", "@@######@", 32),
        column(DataStoreKind.AwsS3Bucket, "patientRef", "@@######@", 33),
      ],
      expect: {
        becomes: {
          name: "Patient reference",
          category: DataCategory.Health,
          sensitivity: DataSensitivity.Restricted,
          pattern: "\\b[A-Z]{2}\\d{6}[A-Z]\\b",
        },
        finds: ["PR482913X", "QA000042B"],
        keeps: ["PR48291X", "PR482913", "PRX482913X", "2026-11-23"],
        categories: [DataCategory.Health, DataCategory.ContactAndIdentity],
        sensitivities: [DataSensitivity.Restricted, DataSensitivity.Confidential],
      },
    },
    {
      id: "data-type-customer-numbers-in-german",
      title:
        "Eight-digit customer numbers named kundennummer, kunden_nr and kundennr",
      feature: DataSecurityAiFeature.DraftDataTypes,
      storeCount: 3,
      fields: [
        column(DataStoreKind.PostgreSql, "crm.kunden.kundennummer", "1#######", 41),
        column(DataStoreKind.MySql, "shop.bestellungen.kunden_nr", "1#######", 42),
        column(DataStoreKind.SqlServer, "dbo.rechnungen.kundennr", "1#######", 43),
      ],
      expect: {
        becomes: {
          name: "Customer number",
          category: DataCategory.ContactAndIdentity,
          sensitivity: DataSensitivity.Confidential,
          pattern: "\\b\\d{8}\\b",
        },
        finds: ["14829137", "10000042"],
        keeps: ["1482913", "148291377", "2026-11-23"],
        categories: [
          DataCategory.ContactAndIdentity,
          DataCategory.Financial,
          DataCategory.BusinessConfidential,
        ],
        sensitivities: [
          DataSensitivity.Confidential,
          DataSensitivity.Internal,
          DataSensitivity.Restricted,
        ],
      },
    },
    {
      id: "data-type-not-one-order-numbers",
      title:
        "Order numbers in three stores are nothing anyone protects: no data type",
      feature: DataSecurityAiFeature.DraftDataTypes,
      storeCount: 3,
      fields: [
        column(DataStoreKind.PostgreSql, "shop.orders.order_number", "ORD-########", 51),
        column(DataStoreKind.MySql, "fulfilment.shipments.orderNo", "ORD-########", 52),
        column(DataStoreKind.PostgreSql, "billing.invoices.order_ref", "ORD-########", 53),
      ],
      expect: { becomes: null, finds: [], keeps: [] },
    },
    {
      id: "data-type-not-one-product-codes",
      title: "Product codes and SKUs are nothing anyone protects: no data type",
      feature: DataSecurityAiFeature.DraftDataTypes,
      storeCount: 2,
      fields: [
        column(DataStoreKind.PostgreSql, "catalog.products.product_code", "@@@-####", 61),
        column(DataStoreKind.PostgreSql, "catalog.stock.productCode", "@@@-####", 62),
        column(DataStoreKind.MySql, "shop.order_lines.product_code", "@@@-####", 63),
      ],
      expect: { becomes: null, finds: [], keeps: [] },
    },
  ];

export const DESCRIBE_DATA_TYPE_EVAL_CASES: ReadonlyArray<DescribeDataTypeEvalCase> =
  [
    {
      id: "describe-employee-ids",
      title:
        "Employee IDs like EMP-123456, sometimes without the dash, and three examples",
      feature: DataSecurityAiFeature.DescribeDataType,
      sentence:
        "Our employee IDs look like EMP-123456, sometimes without the dash.",
      examples: ["EMP-482913", "EMP771204", "EMP-000042"],
      expect: {
        becomes: {
          name: "Employee ID",
          category: DataCategory.ContactAndIdentity,
          sensitivity: DataSensitivity.Confidential,
          pattern: "\\bEMP-?\\d{6}\\b",
        },
        finds: ["EMP-482913", "EMP771204", "EMP-000042"],
        keeps: ["EMP-48291", "EMX-482913", "2026-11-23"],
        categories: [
          DataCategory.ContactAndIdentity,
          DataCategory.BusinessConfidential,
        ],
        sensitivities: [
          DataSensitivity.Confidential,
          DataSensitivity.Internal,
          DataSensitivity.Restricted,
        ],
      },
    },
    {
      id: "describe-policy-numbers",
      title: "Policy numbers: two capital letters, a dash and seven digits",
      feature: DataSecurityAiFeature.DescribeDataType,
      sentence:
        "Insurance policy numbers: two capital letters, a dash, then seven digits.",
      examples: ["PL-4829137", "HX-7712041"],
      expect: {
        becomes: {
          name: "Insurance policy number",
          category: DataCategory.Financial,
          sensitivity: DataSensitivity.Confidential,
          pattern: "\\b[A-Z]{2}-\\d{7}\\b",
        },
        finds: ["PL-4829137", "HX-7712041", "QL-0000042"],
        keeps: ["PL-482913", "PLX-4829137", "pl-4829137x"],
        categories: POLICY_NUMBER_EXPECTATION.categories,
        sensitivities: POLICY_NUMBER_EXPECTATION.sensitivities,
      },
    },
    {
      id: "describe-member-numbers-with-luhn",
      title: "Ten-digit member numbers that pass the Luhn check",
      feature: DataSecurityAiFeature.DescribeDataType,
      sentence:
        "Member numbers are ten digits and their last digit is a Luhn check digit.",
      examples: ["4829137712", "1002003000"],
      expect: {
        becomes: {
          name: "Member number",
          category: DataCategory.ContactAndIdentity,
          sensitivity: DataSensitivity.Confidential,
          pattern: "\\b\\d{10}\\b",
          validator: "Luhn",
        },
        finds: ["4829137712", "1002003000", "7712041180"],
        // The same digits with a wrong check digit, and too few digits.
        keeps: ["4829137713", "7712041181", "482913771"],
        categories: [
          DataCategory.ContactAndIdentity,
          DataCategory.Financial,
          DataCategory.Health,
        ],
        sensitivities: [
          DataSensitivity.Confidential,
          DataSensitivity.Restricted,
          DataSensitivity.Internal,
        ],
      },
    },
    {
      id: "describe-patient-references",
      title: "Patient references: PAT- and eight digits",
      feature: DataSecurityAiFeature.DescribeDataType,
      sentence: "Patient references start with PAT- followed by 8 digits.",
      examples: ["PAT-48291377"],
      expect: {
        becomes: {
          name: "Patient reference",
          category: DataCategory.Health,
          sensitivity: DataSensitivity.Restricted,
          pattern: "\\bPAT-\\d{8}\\b",
        },
        finds: ["PAT-48291377", "PAT-00000042"],
        keeps: ["PAT-4829137", "PAX-48291377", "2026-11-23"],
        categories: [DataCategory.Health, DataCategory.ContactAndIdentity],
        sensitivities: [DataSensitivity.Restricted, DataSensitivity.Confidential],
      },
    },
    {
      id: "describe-not-a-data-type",
      title: "A sentence that names no kind of data drafts none",
      feature: DataSecurityAiFeature.DescribeDataType,
      sentence: "Make the dashboard blue and send me a weekly report.",
      examples: [],
      expect: { becomes: null, finds: [], keeps: [] },
    },
  ];

// What a case sends the model, built as the feature builds it.
export function dataTypeDraftEvalPrompt(
  testCase: DraftDataTypesEvalCase | DescribeDataTypeEvalCase,
): { prompt: DataSecurityAiPrompt; maxTokens: number } {
  if (testCase.feature === DataSecurityAiFeature.DraftDataTypes) {
    return {
      prompt: buildDraftDataTypePrompt({
        instructions: DRAFT_DATA_TYPE_SYSTEM_PROMPT,
        fields: testCase.fields,
        storeCount: testCase.storeCount,
        knownDataTypes: EVAL_KNOWN_DATA_TYPES,
      }),
      maxTokens: DATA_TYPE_DRAFT_MAX_COMPLETION_TOKENS,
    };
  }

  return {
    prompt: buildDescribeDataTypePrompt({
      instructions: DESCRIBE_DATA_TYPE_SYSTEM_PROMPT,
      sentence: testCase.sentence,
      // As the form sends them: shapes, never the examples.
      exampleShapes: testCase.examples.map(valueShape),
      knownDataTypes: EVAL_KNOWN_DATA_TYPES,
    }),
    maxTokens: DESCRIBE_DATA_TYPE_MAX_COMPLETION_TOKENS,
  };
}

// The shapes a group's fields' values have, all of them.
export function groupShapes(
  testCase: DraftDataTypesEvalCase,
): Array<UnplacedValueShape> {
  return testCase.fields.flatMap(
    (entry: { field: UnplacedField }): Array<UnplacedValueShape> => {
      return entry.field.shapes;
    },
  );
}

function findsWhole(detector: ScanDetector, value: string): boolean {
  return findSensitiveValues(value, { detectors: [detector] }).some(
    (match: TextMatch): boolean => {
      return match.start === 0 && match.end === value.length;
    },
  );
}

function findsAny(detector: ScanDetector, value: string): boolean {
  return findSensitiveValues(value, { detectors: [detector] }).length > 0;
}

const PROBLEM_NOTES: Readonly<Record<DataTypeDraftProblem, string>> = {
  [DataTypeDraftProblem.PatternUnusable]:
    "its pattern cannot run, or matches empty text",
  [DataTypeDraftProblem.FindsPlainWords]: "its pattern finds plain words",
  [DataTypeDraftProblem.MissesItsShapes]:
    "its pattern finds none of the group's shapes",
};

/*
 * A draft against what the case expects, read as the product reads it:
 * none where the case holds none; else a draft a saved type could be,
 * whose pattern finds the made-up values and leaves the others alone.
 */
export function scoreDataTypeDraft(
  testCase: DraftDataTypesEvalCase | DescribeDataTypeEvalCase,
  answer: string,
): { passed: boolean; notes: Array<string> } {
  const read: DataTypeDraftAnswer | null = readDataTypeDraftAnswer(answer);

  if (!read) {
    return { passed: false, notes: ["not the JSON asked for"] };
  }

  if (testCase.expect.becomes === null) {
    return read.kind === "none"
      ? { passed: true, notes: [] }
      : { passed: false, notes: ["drafted a data type where there is none"] };
  }

  if (read.kind !== "draft") {
    return {
      passed: false,
      notes: [
        read.kind === "none"
          ? "drafted no data type"
          : "drafted a type no saved type could be",
      ],
    };
  }

  const notes: Array<string> = [];
  const problem: DataTypeDraftProblem | null = checkDataTypeDraft(
    read.draft,
    testCase.feature === DataSecurityAiFeature.DraftDataTypes
      ? groupShapes(testCase)
      : undefined,
  );

  if (problem) {
    return { passed: false, notes: [PROBLEM_NOTES[problem]] };
  }

  const categories: Array<DataCategory> = testCase.expect.categories || [
    testCase.expect.becomes.category,
  ];
  const sensitivities: Array<DataSensitivity> = testCase.expect
    .sensitivities || [testCase.expect.becomes.sensitivity];

  if (!categories.includes(read.draft.category)) {
    notes.push(`category ${read.draft.category}`);
  }

  if (!sensitivities.includes(read.draft.sensitivity)) {
    notes.push(`sensitivity ${read.draft.sensitivity}`);
  }

  const detector: ScanDetector | null = compileCustomDataType(
    toCustomDataTypeDefinition(read.draft, "custom:eval"),
  );

  if (!detector) {
    return { passed: false, notes: [PROBLEM_NOTES.PatternUnusable] };
  }

  for (const value of testCase.expect.finds) {
    if (!findsWhole(detector, value)) {
      notes.push(`/${read.draft.pattern}/ misses ${value}`);
    }
  }

  for (const value of testCase.expect.keeps) {
    if (findsAny(detector, value)) {
      notes.push(`/${read.draft.pattern}/ also finds ${value}`);
    }
  }

  return { passed: notes.length === 0, notes };
}

// The answer the case expects, as a right model writes it.
export function expectedDataTypeAnswer(
  testCase: DraftDataTypesEvalCase | DescribeDataTypeEvalCase,
): string {
  const becomes: DataTypeEvalExpectation["becomes"] = testCase.expect.becomes;

  return JSON.stringify(
    becomes
      ? {
          dataType: {
            name: becomes.name,
            description: `The company's ${becomes.name.toLowerCase()}.`,
            category: becomes.category,
            sensitivity: becomes.sensitivity,
            pattern: becomes.pattern,
            ignoreCase: false,
            keywords: [],
            nameHints: [],
            validator: becomes.validator || "None",
          },
          reason: "The names and the shapes say so.",
        }
      : { dataType: null, reason: "It is no data type of the company's own." },
  );
}

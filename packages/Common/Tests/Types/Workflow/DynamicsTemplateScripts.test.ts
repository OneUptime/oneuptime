/*
 * Runs every script the Dynamics 365 templates ship through the same
 * isolated-vm sandbox the workflow runner uses, against rows and events
 * shaped like the ones Dataverse and OneUptime really send.
 *
 * The scripts are where the Dynamics 365 templates make their decisions —
 * whether to open a case, whether a resolved incident closes its case or a
 * mapped state moves it, whether a note is only the echo of one OneUptime
 * wrote, which incident a case belongs to. A wrong branch in one of them
 * does not fail loudly: the workflow still runs, logs a polite skip, and the
 * two systems quietly drift apart or start talking to themselves. So each
 * branch is pinned here by what the script returns, and every skip by its
 * exact words, because those words are all the run log shows.
 *
 * The incident and alert templates are built by the same script builders, so
 * every shared behaviour runs once per kind of record (KINDS below), with the
 * words and ids written out rather than read back from the templates. The
 * cross-kind tests pin that a case linked to one kind is never taken for the
 * other.
 *
 * Arguments are built the way the runtime delivers them:
 *
 *   - A step output quoted into JSON arguments ("incident": "{{…model}}")
 *     arrives as JSON TEXT. quoted() reproduces that.
 *   - A whole-argument reference to the webhook body (read-event-1) arrives
 *     as the parsed object itself.
 *   - A reference that did not resolve stays as its literal braces, and a
 *     null step output arrives as the text "null". Both have to read as
 *     "nothing here", never as a crash.
 */

import { describe, expect, jest, test } from "@jest/globals";
import { JSONObject, JSONValue } from "../../../Types/JSON";
import {
  DYNAMICS_SYNCED_FROM_ONEUPTIME_MARKER,
  ONEUPTIME_SYNCED_FROM_DYNAMICS_MARKER,
} from "../../../Types/Workflow/Templates";
import {
  ACKNOWLEDGED_STATE,
  ALERT_ACKNOWLEDGED_STATE,
  ALERT_CREATED_STATE,
  ALERT_ID,
  ALERT_NUMBER,
  ALERT_RESOLVED_STATE,
  ALERT_RESOLVED_STATE_ID,
  ALERT_SEVERITIES,
  ALERT_STATES,
  CREATED_STATE,
  CRITICAL_SEVERITY_ID,
  HIGH_ALERT_SEVERITY_ID,
  INCIDENT_ID,
  INCIDENT_NUMBER,
  INCIDENT_SEVERITIES,
  INCIDENT_STATES,
  LOW_ALERT_SEVERITY_ID,
  MAJOR_SEVERITY_ID,
  MINOR_SEVERITY_ID,
  OTHER_ALERT_ID,
  OTHER_INCIDENT_ID,
  PROJECT_ID,
  RESOLVED_STATE,
  RESOLVED_STATE_ID,
  alertModel,
  alertNoteModel,
  incidentModel,
  noteModel,
  quoted,
} from "./JiraTemplateFixtures";
import {
  ACCOUNT_ID,
  CASE_ID,
  CASE_NUMBER,
  CONTACT_ID,
  DYNAMICS_URL,
  EMPTY_CASE_SEARCH,
  EMPTY_ID,
  LINK_COLUMN,
  NOTE_ID,
  OTHER_CASE_ID,
  OTHER_CASE_NUMBER,
  caseRow,
  caseSearchResponse,
  caseSearchRow,
  flowBody,
  formattedKey,
  noteRow,
  runDynamicsScript,
  webhookContext,
} from "./DynamicsTemplateFixtures";

// The sandbox boots a fresh isolate per run, which is far slower than plain JS.
jest.setTimeout(60000);

/* ------------------------------- Helpers ------------------------------- */

type EditCodeFunction = (code: string) => string;

type RunStepFunction = (
  args: JSONValue,
  editCode?: EditCodeFunction | undefined,
) => Promise<JSONObject>;

type StepFunction = (
  templateId: string,
  componentId: string,
) => RunStepFunction;

/** Binds one template's script step, so each test only says what it feeds it. */
const step: StepFunction = (
  templateId: string,
  componentId: string,
): RunStepFunction => {
  return async (
    args: JSONValue,
    editCode?: EditCodeFunction | undefined,
  ): Promise<JSONObject> => {
    return await runDynamicsScript({
      templateId: templateId,
      componentId: componentId,
      args: args,
      editCode: editCode,
    });
  };
};

type ReplaceInCodeFunction = (
  search: string,
  replacement: string,
) => EditCodeFunction;

/*
 * The scripts are customised by editing one documented line. Replacing that
 * exact line also pins that it is still there to edit: runDynamicsScript
 * throws when an edit changes nothing.
 */
const replaceInCode: ReplaceInCodeFunction = (
  search: string,
  replacement: string,
): EditCodeFunction => {
  return (code: string): string => {
    return code.replace(search, () => {
      return replacement;
    });
  };
};

type ExpectSkippedFunction = (result: JSONObject, reason: string) => void;

/* A skip is exactly { proceed: false, reason }. */
const expectSkipped: ExpectSkippedFunction = (
  result: JSONObject,
  reason: string,
): void => {
  expect(result).toEqual({ proceed: false, reason: reason });
};

type TextOfFunction = (result: JSONObject, key: string) => string;

/** A returned string, failing with the whole result when it is not one. */
const textOf: TextOfFunction = (result: JSONObject, key: string): string => {
  const value: JSONValue | undefined = result[key];

  if (typeof value !== "string") {
    throw new Error(
      `Expected "${key}" to be text, but the script returned ${JSON.stringify(result)}.`,
    );
  }

  return value;
};

/** Every string a result holds, however deeply nested. */
type CollectStringsFunction = (value: JSONValue | undefined) => Array<string>;

const collectStrings: CollectStringsFunction = (
  value: JSONValue | undefined,
): Array<string> => {
  if (typeof value === "string") {
    return [value];
  }

  if (Array.isArray(value)) {
    return (value as Array<JSONValue>).flatMap((entry: JSONValue) => {
      return collectStrings(entry);
    });
  }

  if (value && typeof value === "object") {
    return Object.values(value as JSONObject).flatMap((entry: JSONValue) => {
      return collectStrings(entry);
    });
  }

  return [];
};

type ExpectDefusedFunction = (result: JSONObject) => void;

/* No string a script returns may still hold a reference a later step would substitute. */
const expectDefused: ExpectDefusedFunction = (result: JSONObject): void => {
  for (const text of collectStrings(result)) {
    expect(text).not.toContain("{{");
    expect(text).not.toContain("}}");
  }
};

const MALICIOUS: string =
  "{{local.variables.dynamicsAccessToken}} and {{local.components.webhook-1.returnValues.request-headers}}";

/* ---------------------------- The two kinds ---------------------------- */

interface KindTemplateIds {
  createCase: string;
  updateCase: string;
  privateNote: string;
  /** Only incidents have public notes. */
  publicNote: string | undefined;
  createRecord: string;
  statusToState: string;
  caseNoteToNote: string;
}

interface RecordModelProps {
  _id?: string | undefined;
  title?: string | undefined;
  description?: string | null | undefined;
  customFields?: JSONObject | null | undefined;
  state?: JSONObject | undefined;
  severity?: string | undefined;
  rootCause?: string | null | undefined;
  remediationNotes?: string | null | undefined;
  isPrivate?: boolean | undefined;
}

type RecordModelFunction = (props?: RecordModelProps) => JSONObject;

interface RecordNoteProps {
  note?: string | undefined;
  authorName?: string | null | undefined;
  recordId?: string | undefined;
  isPrivate?: boolean | undefined;
}

type RecordNoteFunction = (props?: RecordNoteProps) => JSONObject;

interface PriorityMapping {
  prioritycode: number | null;
  severityId: string;
  severityName: string;
}

/*
 * Everything the tests need to know about one kind of record, written out
 * rather than derived from the templates, so a builder that put the wrong
 * word into one kind's script fails here instead of the table reading the
 * template back to itself.
 */
interface RecordKind {
  noun: string;
  Noun: string;
  plural: string;
  created: string;
  Created: string;
  number: string;
  id: string;
  otherId: string;
  link: string;
  linkPrefix: string;
  /** A link the other kind's templates write. */
  otherKindLink: string;
  idKey: string;
  severityIdKey: string;
  dashboardPath: string;
  prepareRecordStep: string;
  syncPrivateName: string;
  createdState: JSONObject;
  acknowledgedState: JSONObject;
  resolvedState: JSONObject;
  resolvedStateId: string;
  states: Array<JSONObject>;
  severities: Array<JSONObject>;
  severityName: string;
  /** The case priority each default severity opens a case with. */
  severityPriorities: Array<{ severity: string; prioritycode: number }>;
  /** Where each case priority lands among the default severities. */
  priorities: Array<PriorityMapping>;
  model: RecordModelFunction;
  note: RecordNoteFunction;
  title: string;
  description: string;
  noteText: string;
  templates: KindTemplateIds;
}

const incidentRecord: RecordModelFunction = (
  props?: RecordModelProps,
): JSONObject => {
  const model: JSONObject = incidentModel(props);

  if (props?.isPrivate !== undefined) {
    model["isPrivate"] = props.isPrivate;
  }

  return model;
};

const incidentNote: RecordNoteFunction = (
  props?: RecordNoteProps,
): JSONObject => {
  const model: JSONObject = noteModel({
    note: props?.note,
    authorName: props?.authorName,
    incidentId: props?.recordId,
  });

  if (props?.isPrivate !== undefined) {
    model["incident"] = {
      ...(model["incident"] as JSONObject),
      isPrivate: props.isPrivate,
    };
  }

  return model;
};

const alertNote: RecordNoteFunction = (props?: RecordNoteProps): JSONObject => {
  return alertNoteModel({
    note: props?.note,
    authorName: props?.authorName,
    alertId: props?.recordId,
    isPrivate: props?.isPrivate,
  });
};

const INCIDENT: RecordKind = {
  noun: "incident",
  Noun: "Incident",
  plural: "incidents",
  created: "declared",
  Created: "Declared",
  number: INCIDENT_NUMBER,
  id: INCIDENT_ID,
  otherId: OTHER_INCIDENT_ID,
  link: `oneuptime-incident-${INCIDENT_ID}`,
  linkPrefix: "oneuptime-incident-",
  otherKindLink: `oneuptime-alert-${ALERT_ID}`,
  idKey: "incidentId",
  severityIdKey: "incidentSeverityId",
  dashboardPath: "incidents",
  prepareRecordStep: "prepare-incident-1",
  syncPrivateName: "SYNC_PRIVATE_INCIDENTS",
  createdState: CREATED_STATE,
  acknowledgedState: ACKNOWLEDGED_STATE,
  resolvedState: RESOLVED_STATE,
  resolvedStateId: RESOLVED_STATE_ID,
  states: INCIDENT_STATES,
  severities: INCIDENT_SEVERITIES,
  severityName: "Critical Incident",
  severityPriorities: [
    { severity: "Critical Incident", prioritycode: 1 },
    { severity: "Major Incident", prioritycode: 2 },
    { severity: "Minor Incident", prioritycode: 3 },
  ],
  priorities: [
    {
      prioritycode: 1,
      severityId: CRITICAL_SEVERITY_ID,
      severityName: "Critical Incident",
    },
    {
      prioritycode: 2,
      severityId: MAJOR_SEVERITY_ID,
      severityName: "Major Incident",
    },
    {
      prioritycode: 3,
      severityId: MINOR_SEVERITY_ID,
      severityName: "Minor Incident",
    },
    // No priority, or one of your own: the middle of the range.
    {
      prioritycode: null,
      severityId: MAJOR_SEVERITY_ID,
      severityName: "Major Incident",
    },
    {
      prioritycode: 100000001,
      severityId: MAJOR_SEVERITY_ID,
      severityName: "Major Incident",
    },
  ],
  model: incidentRecord,
  note: incidentNote,
  title: "Checkout latency high",
  description:
    'p99 latency on /checkout is above 2s.\nStarted after the "v4.2" deploy.',
  noteText:
    "Failed over to the **secondary** database. Error rate is dropping.",
  templates: {
    createCase: "dynamics-create-case-for-incident",
    updateCase: "dynamics-update-case-on-incident-state",
    privateNote: "dynamics-note-from-incident-private-note",
    publicNote: "dynamics-note-from-incident-public-note",
    createRecord: "dynamics-declare-incident-from-case",
    statusToState: "dynamics-case-status-to-incident-state",
    caseNoteToNote: "dynamics-case-note-to-incident-private-note",
  },
};

const ALERT: RecordKind = {
  noun: "alert",
  Noun: "Alert",
  plural: "alerts",
  created: "created",
  Created: "Created",
  number: ALERT_NUMBER,
  id: ALERT_ID,
  otherId: OTHER_ALERT_ID,
  link: `oneuptime-alert-${ALERT_ID}`,
  linkPrefix: "oneuptime-alert-",
  otherKindLink: `oneuptime-incident-${INCIDENT_ID}`,
  idKey: "alertId",
  severityIdKey: "alertSeverityId",
  dashboardPath: "alerts",
  prepareRecordStep: "prepare-alert-1",
  syncPrivateName: "SYNC_PRIVATE_ALERTS",
  createdState: ALERT_CREATED_STATE,
  acknowledgedState: ALERT_ACKNOWLEDGED_STATE,
  resolvedState: ALERT_RESOLVED_STATE,
  resolvedStateId: ALERT_RESOLVED_STATE_ID,
  states: ALERT_STATES,
  severities: ALERT_SEVERITIES,
  severityName: "High",
  severityPriorities: [
    { severity: "High", prioritycode: 1 },
    { severity: "Low", prioritycode: 3 },
  ],
  priorities: [
    {
      prioritycode: 1,
      severityId: HIGH_ALERT_SEVERITY_ID,
      severityName: "High",
    },
    // Two severities: the middle rounds to the less severe one.
    { prioritycode: 2, severityId: LOW_ALERT_SEVERITY_ID, severityName: "Low" },
    { prioritycode: 3, severityId: LOW_ALERT_SEVERITY_ID, severityName: "Low" },
    {
      prioritycode: null,
      severityId: LOW_ALERT_SEVERITY_ID,
      severityName: "Low",
    },
  ],
  model: alertModel,
  note: alertNote,
  title: "Disk usage above 90% on db-1",
  description: 'The "db-1" volume is at 93%.\nIt grew 4% in the last hour.',
  noteText: "Cleared old WAL segments. Usage is back to 71%.",
  templates: {
    createCase: "dynamics-create-case-for-alert",
    updateCase: "dynamics-update-case-on-alert-state",
    privateNote: "dynamics-note-from-alert-private-note",
    publicNote: undefined,
    createRecord: "dynamics-create-alert-from-case",
    statusToState: "dynamics-case-status-to-alert-state",
    caseNoteToNote: "dynamics-case-note-to-alert-private-note",
  },
};

const KINDS: Array<[string, RecordKind]> = [
  ["incident", INCIDENT],
  ["alert", ALERT],
];

const syncPrivate: (kind: RecordKind) => EditCodeFunction = (
  kind: RecordKind,
): EditCodeFunction => {
  return replaceInCode(
    `const ${kind.syncPrivateName} = false;`,
    `const ${kind.syncPrivateName} = true;`,
  );
};

/* ------------------------ OneUptime -> Dynamics 365 ------------------------ */

describe.each(KINDS)(
  "%s: prepare-case-1",
  (_name: string, kind: RecordKind) => {
    const run: RunStepFunction = step(
      kind.templates.createCase,
      "prepare-case-1",
    );

    type ArgsFunction = (props?: {
      record?: JSONObject | string | undefined;
      customer?: string | undefined;
      linkColumn?: string | undefined;
      oneuptimeUrl?: string | undefined;
      severities?: JSONValue | undefined;
    }) => JSONObject;

    const args: ArgsFunction = (props?: {
      record?: JSONObject | string | undefined;
      customer?: string | undefined;
      linkColumn?: string | undefined;
      oneuptimeUrl?: string | undefined;
      severities?: JSONValue | undefined;
    }): JSONObject => {
      const record: JSONObject | string = props?.record || kind.model();

      return {
        oneuptimeUrl:
          props?.oneuptimeUrl === undefined
            ? "https://oneuptime.com"
            : props.oneuptimeUrl,
        linkColumn:
          props?.linkColumn === undefined ? LINK_COLUMN : props.linkColumn,
        customer: props?.customer === undefined ? ACCOUNT_ID : props.customer,
        severities:
          props?.severities === undefined
            ? quoted(kind.severities)
            : (props.severities as JSONValue),
        [kind.noun]: typeof record === "string" ? record : quoted(record),
      };
    };

    type CaseOfFunction = (result: JSONObject) => JSONObject;

    const caseOf: CaseOfFunction = (result: JSONObject): JSONObject => {
      expect(result["proceed"]).toBe(true);
      return result["caseColumns"] as JSONObject;
    };

    test(`opens a case with the ${kind.noun}'s title, its description, and the link`, async () => {
      const result: JSONObject = await run(args());

      expect(result).toEqual({
        proceed: true,
        caseColumns: {
          title: `[OneUptime] ${kind.number}: ${kind.title}`,
          description: [
            `${kind.number} was ${kind.created} in OneUptime.`,
            `Open it in OneUptime: https://oneuptime.com/dashboard/${PROJECT_ID}/${kind.dashboardPath}/${kind.id}`,
            `Severity: ${kind.severityName}`,
            "State: Identified",
            "",
            kind.description,
          ].join("\n"),
          prioritycode: 1,
          caseorigincode: 3,
          casetypecode: 2,
          "customerid_account@odata.bind": `/accounts(${ACCOUNT_ID})`,
          [LINK_COLUMN]: kind.link,
        },
        link: kind.link,
      });
    });

    test.each(kind.severityPriorities)(
      "a $severity record opens a case of priority $prioritycode",
      async ({
        severity,
        prioritycode,
      }: {
        severity: string;
        prioritycode: number;
      }) => {
        const result: JSONObject = await run(
          args({ record: kind.model({ severity: severity }) }),
        );

        expect(caseOf(result)["prioritycode"]).toBe(prioritycode);
      },
    );

    test("severities are spread by their order, whatever they are called", async () => {
      const severities: Array<JSONObject> = [
        { _id: "s4", name: "Sev 4", order: 4 },
        { _id: "s1", name: "Sev 1", order: 1 },
        { _id: "s3", name: "Sev 3", order: 3 },
        { _id: "s2", name: "Sev 2", order: 2 },
      ];

      const priorities: Array<JSONValue> = [];

      for (const name of ["Sev 1", "Sev 2", "Sev 3", "Sev 4"]) {
        const result: JSONObject = await run(
          args({
            record: kind.model({ severity: name }),
            severities: quoted(severities),
          }),
        );
        priorities.push(caseOf(result)["prioritycode"] as JSONValue);
      }

      expect(priorities).toEqual([1, 2, 2, 3]);
    });

    test("a severity the project's list does not have opens a Normal case", async () => {
      const result: JSONObject = await run(
        args({ record: kind.model({ severity: "Retired severity" }) }),
      );

      expect(caseOf(result)["prioritycode"]).toBe(2);
    });

    test("so does a project with one severity, or a list that did not arrive", async () => {
      for (const severities of [
        quoted([{ _id: "only", name: kind.severityName, order: 1 }]),
        "null",
        "{{local.components.find-severities-1.returnValues.models}}",
      ]) {
        const result: JSONObject = await run(args({ severities: severities }));

        expect(caseOf(result)["prioritycode"]).toBe(2);
      }
    });

    test("SEVERITY_TO_PRIORITY chooses a priority by name, over the order", async () => {
      const result: JSONObject = await run(
        args(),
        replaceInCode(
          "const SEVERITY_TO_PRIORITY = {};",
          `const SEVERITY_TO_PRIORITY = { '${kind.severityName.toLowerCase()}': 3 };`,
        ),
      );

      expect(caseOf(result)["prioritycode"]).toBe(3);
    });

    test("CASE_ORIGIN and CASE_TYPE are the numbers the case is filed with", async () => {
      const result: JSONObject = await run(args(), (code: string): string => {
        return code
          .replace("const CASE_ORIGIN = 3;", "const CASE_ORIGIN = 700610000;")
          .replace("const CASE_TYPE = 2;", "const CASE_TYPE = 3;");
      });

      expect(caseOf(result)["caseorigincode"]).toBe(700610000);
      expect(caseOf(result)["casetypecode"]).toBe(3);
    });

    test.each([
      [ACCOUNT_ID, "customerid_account@odata.bind", `/accounts(${ACCOUNT_ID})`],
      [
        ACCOUNT_ID.toUpperCase(),
        "customerid_account@odata.bind",
        `/accounts(${ACCOUNT_ID})`,
      ],
      [
        `{${ACCOUNT_ID}}`,
        "customerid_account@odata.bind",
        `/accounts(${ACCOUNT_ID})`,
      ],
      [
        `accounts(${ACCOUNT_ID})`,
        "customerid_account@odata.bind",
        `/accounts(${ACCOUNT_ID})`,
      ],
      [
        `contacts(${CONTACT_ID})`,
        "customerid_contact@odata.bind",
        `/contacts(${CONTACT_ID})`,
      ],
      [
        ` /Contacts(${CONTACT_ID.toUpperCase()}) `,
        "customerid_contact@odata.bind",
        `/contacts(${CONTACT_ID})`,
      ],
    ])(
      "the customer %j is bound as %s",
      async (customer: string, binding: string, path: string) => {
        const columns: JSONObject = caseOf(
          await run(args({ customer: customer })),
        );

        expect(columns[binding]).toBe(path);
        expect(
          Object.keys(columns).filter((key: string) => {
            return key.startsWith("customerid_");
          }),
        ).toEqual([binding]);
      },
    );

    test.each([
      "",
      "Contoso Pharmaceuticals",
      "leads(4f7e6c3a-1b2d-4e5f-8a9b-0c1d2e3f4a5b)",
      EMPTY_ID,
      "{{local.variables.dynamicsCustomer}}",
    ])("a customer of %j opens no case", async (customer: string) => {
      expectSkipped(
        await run(args({ customer: customer })),
        "The Customer for New Cases setting is not an account id or contacts(<id>), so no case was opened.",
      );
    });

    test.each([
      "",
      "OneUptime Link",
      "New_OneUptimeLink",
      "oneuptimelink",
      "new_link; drop",
    ])("a link column of %j opens no case", async (linkColumn: string) => {
      expectSkipped(
        await run(args({ linkColumn: linkColumn })),
        `The Case Link Column setting, ${linkColumn.trim() || "which is empty"}, is not the logical name of a column, such as new_oneuptimelink, so no case was opened.`,
      );
    });

    test("the link goes under whatever the link column is called", async () => {
      const columns: JSONObject = caseOf(
        await run(args({ linkColumn: "cr4f2_oneuptimeid" })),
      );

      expect(columns["cr4f2_oneuptimeid"]).toBe(kind.link);
      expect(columns[LINK_COLUMN]).toBeUndefined();
    });

    test(`a private ${kind.noun} stays in OneUptime`, async () => {
      expectSkipped(
        await run(args({ record: kind.model({ isPrivate: true }) })),
        `${kind.number} is a private ${kind.noun}, so no Dynamics 365 case was opened.`,
      );
    });

    test(`${kind.syncPrivateName} lets a private ${kind.noun} through`, async () => {
      const result: JSONObject = await run(
        args({ record: kind.model({ isPrivate: true }) }),
        syncPrivate(kind),
      );

      expect(result["proceed"]).toBe(true);
    });

    test(`a ${kind.noun} that came from a case opens no second one`, async () => {
      expectSkipped(
        await run(
          args({
            record: kind.model({
              customFields: {
                dynamicsCaseId: CASE_ID,
                dynamicsCaseNumber: CASE_NUMBER,
              },
            }),
          }),
        ),
        `${kind.number} was ${kind.created} from Dynamics 365 case ${CASE_NUMBER}, so no new case was opened.`,
      );
    });

    test("a case id with no number is named by its id", async () => {
      expectSkipped(
        await run(
          args({
            record: kind.model({ customFields: { dynamicsCaseId: CASE_ID } }),
          }),
        ),
        `${kind.number} was ${kind.created} from Dynamics 365 case ${CASE_ID}, so no new case was opened.`,
      );
    });

    test(`no ${kind.noun} id, no case: the link would point at nothing`, async () => {
      for (const record of [
        quoted({ ...kind.model(), _id: "" }),
        quoted({ ...kind.model(), _id: "not-an-id" }),
        "null",
        `{{local.components.${kind.noun}-on-create-1.returnValues.model}}`,
      ]) {
        expectSkipped(
          await run(args({ record: record })),
          `The trigger did not hand over an ${kind.noun} id.`,
        );
      }
    });

    test("a bare #12 says what it numbers", async () => {
      const record: JSONObject = {
        ...kind.model(),
        [kind.noun === "incident"
          ? "incidentNumberWithPrefix"
          : "alertNumberWithPrefix"]: "#12",
      };
      const columns: JSONObject = caseOf(await run(args({ record: record })));

      expect(columns["title"]).toBe(
        `[OneUptime] ${kind.Noun} #12: ${kind.title}`,
      );
      expect(String(columns["description"])).toMatch(
        new RegExp(`^${kind.Noun} #12 was ${kind.created} in OneUptime\\.`),
      );
    });

    test("an untitled record still gets a title", async () => {
      const columns: JSONObject = caseOf(
        await run(args({ record: kind.model({ title: "" }) })),
      );

      expect(columns["title"]).toBe(
        `[OneUptime] ${kind.number}: Untitled ${kind.noun}`,
      );
    });

    test("the root cause and remediation a monitor wrote follow the description", async () => {
      const columns: JSONObject = caseOf(
        await run(
          args({
            record: kind.model({
              rootCause: "Connection pool exhausted.",
              remediationNotes: "Restart the api pods.",
            }),
          }),
        ),
      );

      expect(
        String(columns["description"]).endsWith(
          `${kind.description}\n\nRoot cause:\nConnection pool exhausted.\n\nRemediation:\nRestart the api pods.`,
        ),
      ).toBe(true);
    });

    test("the title stops at the Case table's 200 characters", async () => {
      const columns: JSONObject = caseOf(
        await run(args({ record: kind.model({ title: "x".repeat(400) }) })),
      );
      const title: string = String(columns["title"]);

      expect(title).toHaveLength(200);
      expect(title.endsWith("…")).toBe(true);
    });

    test("the description stops at 2000 characters, and the link back survives the cut", async () => {
      const columns: JSONObject = caseOf(
        await run(
          args({ record: kind.model({ description: "y".repeat(5000) }) }),
        ),
      );
      const description: string = String(columns["description"]);

      expect(description).toHaveLength(2000);
      expect(description.endsWith("…")).toBe(true);
      expect(description).toContain(
        `Open it in OneUptime: https://oneuptime.com/dashboard/${PROJECT_ID}/${kind.dashboardPath}/${kind.id}`,
      );
    });

    test("MAX_TITLE_LENGTH and MAX_DESCRIPTION_LENGTH can be raised", async () => {
      const columns: JSONObject = caseOf(
        await run(
          args({
            record: kind.model({
              title: "x".repeat(300),
              description: "y".repeat(3000),
            }),
          }),
          (code: string): string => {
            return code
              .replace(
                "const MAX_TITLE_LENGTH = 200;",
                "const MAX_TITLE_LENGTH = 1000;",
              )
              .replace(
                "const MAX_DESCRIPTION_LENGTH = 2000;",
                "const MAX_DESCRIPTION_LENGTH = 100000;",
              );
          },
        ),
      );

      expect(String(columns["title"]).endsWith("…")).toBe(false);
      expect(String(columns["description"])).toContain("y".repeat(3000));
    });

    test.each([
      ["oneuptime.com", "https://oneuptime.com"],
      ["https://status.example.com///", "https://status.example.com"],
      ["http://oneuptime.internal:8080/", "http://oneuptime.internal:8080"],
    ])(
      "a OneUptime URL of %j links back through %s",
      async (oneuptimeUrl: string, base: string) => {
        const columns: JSONObject = caseOf(
          await run(args({ oneuptimeUrl: oneuptimeUrl })),
        );

        expect(String(columns["description"])).toContain(
          `Open it in OneUptime: ${base}/dashboard/${PROJECT_ID}/${kind.dashboardPath}/${kind.id}\n`,
        );
      },
    );

    test("text from the record can never become a reference in a later step", async () => {
      const result: JSONObject = await run(
        args({
          record: kind.model({ title: MALICIOUS, description: MALICIOUS }),
        }),
      );

      expectDefused(result);
      expect(String(caseOf(result)["title"])).toContain(
        "{ {local.variables.dynamicsAccessToken} }",
      );
    });

    test("control characters Dataverse would refuse are dropped, line breaks kept", async () => {
      const columns: JSONObject = caseOf(
        await run(
          args({
            record: kind.model({
              title: "Bad\u0000title\u0007",
              description: "line one\u0001\nline two\ttabbed",
            }),
          }),
        ),
      );

      expect(columns["title"]).toBe(`[OneUptime] ${kind.number}: Badtitle`);
      expect(String(columns["description"])).toContain(
        "line one\nline two\ttabbed",
      );
    });
  },
);

describe.each(KINDS)("%s: plan-case-1", (_name: string, kind: RecordKind) => {
  const run: RunStepFunction = step(kind.templates.updateCase, "plan-case-1");

  type ArgsFunction = (props?: {
    state?: JSONObject | undefined;
    search?: JSONValue | undefined;
    isPrivate?: boolean | undefined;
  }) => JSONObject;

  const args: ArgsFunction = (props?: {
    state?: JSONObject | undefined;
    search?: JSONValue | undefined;
    isPrivate?: boolean | undefined;
  }): JSONObject => {
    return {
      [kind.noun]: quoted(
        kind.model({
          state: props?.state || kind.resolvedState,
          isPrivate: props?.isPrivate,
        }),
      ),
      search:
        props?.search === undefined
          ? quoted(caseSearchResponse([caseSearchRow()]))
          : props.search,
    };
  };

  type SkippedFunction = (result: JSONObject, reason: string) => void;

  // Every skip here also says action: 'skip', which the If / Else steps read.
  const expectNothing: SkippedFunction = (
    result: JSONObject,
    reason: string,
  ): void => {
    expect(result).toEqual({ proceed: false, reason: reason, action: "skip" });
  };

  test(`a resolved ${kind.noun} closes its case as Problem Solved`, async () => {
    expect(await run(args())).toEqual({
      proceed: true,
      action: "close",
      caseId: CASE_ID,
      caseNumber: CASE_NUMBER,
      closeBody: {
        IncidentResolution: {
          subject: `${DYNAMICS_SYNCED_FROM_ONEUPTIME_MARKER}: ${kind.number} was resolved`,
          description: `${kind.number} is Resolved in OneUptime.`,
          "incidentid@odata.bind": `/incidents(${CASE_ID})`,
        },
        Status: 5,
      },
      reason: `${kind.number} is Resolved in OneUptime.`,
    });
  });

  test("RESOLVED_CASE_STATUS closes it with another resolved status", async () => {
    const result: JSONObject = await run(
      args(),
      replaceInCode(
        "const RESOLVED_CASE_STATUS = 5;",
        "const RESOLVED_CASE_STATUS = 1000;",
      ),
    );

    expect((result["closeBody"] as JSONObject)["Status"]).toBe(1000);
  });

  test("a resolved state named in STATE_TO_CASE_STATUS closes the case with that status", async () => {
    const result: JSONObject = await run(
      args(),
      replaceInCode(
        "const STATE_TO_CASE_STATUS = {};",
        "const STATE_TO_CASE_STATUS = { Resolved: 1000 };",
      ),
    );

    expect(result["action"]).toBe("close");
    expect((result["closeBody"] as JSONObject)["Status"]).toBe(1000);
  });

  test("any resolved state closes the case, whatever it is called", async () => {
    const result: JSONObject = await run(
      args({
        state: { ...kind.resolvedState, name: "All clear" },
      }),
    );

    expect(result["action"]).toBe("close");
    expect(result["reason"]).toBe(`${kind.number} is All clear in OneUptime.`);
  });

  test(`an acknowledged ${kind.noun} leaves the case alone unless its state is mapped`, async () => {
    expectNothing(
      await run(args({ state: kind.acknowledgedState })),
      `${kind.number} moved to Acknowledged, which has no case status mapped to it.`,
    );
  });

  test("a state mapped in STATE_TO_CASE_STATUS moves the case to that status", async () => {
    expect(
      await run(
        args({ state: kind.acknowledgedState }),
        replaceInCode(
          "const STATE_TO_CASE_STATUS = {};",
          "const STATE_TO_CASE_STATUS = { Acknowledged: 4 };",
        ),
      ),
    ).toEqual({
      proceed: true,
      action: "status",
      caseId: CASE_ID,
      caseNumber: CASE_NUMBER,
      statusBody: { statecode: 0, statuscode: 4 },
      status: 4,
      reason: `${kind.number} is Acknowledged in OneUptime.`,
    });
  });

  test("a case already in the mapped status is left as it is", async () => {
    expectNothing(
      await run(
        args({
          state: kind.acknowledgedState,
          search: quoted(
            caseSearchResponse([caseSearchRow({ statuscode: 4 })]),
          ),
        }),
        replaceInCode(
          "const STATE_TO_CASE_STATUS = {};",
          "const STATE_TO_CASE_STATUS = { Acknowledged: 4 };",
        ),
      ),
      `Dynamics 365 case ${CASE_NUMBER} is already Researching.`,
    );
  });

  test.each([
    [5, "Resolved"],
    [1000, "Resolved"],
    [6, "Cancelled"],
    [2000, "Cancelled"],
  ])(
    "a case whose status is %s is already %s, and is never reopened",
    async (statuscode: number, stateName: string) => {
      expectNothing(
        await run(
          args({
            search: quoted(
              caseSearchResponse([caseSearchRow({ statuscode: statuscode })]),
            ),
          }),
        ),
        `Dynamics 365 case ${CASE_NUMBER} is already ${stateName}, so it was left as it is.`,
      );
    },
  );

  test("no linked case, or credentials that cannot see it", async () => {
    for (const search of [
      quoted(EMPTY_CASE_SEARCH),
      "null",
      "{{local.components.find-case-1.returnValues.response-body}}",
      quoted({ value: [{ incidentid: "not-a-guid", ticketnumber: "CAS-1" }] }),
    ]) {
      expectNothing(
        await run(args({ search: search })),
        `No Dynamics 365 case holds the link ${kind.link}, or the Dynamics 365 credentials cannot see it.`,
      );
    }
  });

  test("two cases holding the link stop it, naming both", async () => {
    expectNothing(
      await run(
        args({
          search: quoted(
            caseSearchResponse([
              caseSearchRow(),
              caseSearchRow({
                incidentid: OTHER_CASE_ID,
                ticketnumber: OTHER_CASE_NUMBER,
              }),
            ]),
          ),
        }),
      ),
      `More than one Dynamics 365 case holds the link ${kind.link} (${CASE_NUMBER}, ${OTHER_CASE_NUMBER}). Clear it on every case except the one opened for the ${kind.noun}.`,
    );
  });

  test(`a private ${kind.noun}'s case is left alone, before anything is looked at`, async () => {
    expectNothing(
      await run(args({ isPrivate: true, search: "null" })),
      `${kind.number} is a private ${kind.noun}, so its Dynamics 365 case was not changed.`,
    );
  });

  test(`${kind.syncPrivateName} syncs a private ${kind.noun} anyway`, async () => {
    const result: JSONObject = await run(
      args({ isPrivate: true }),
      syncPrivate(kind),
    );

    expect(result["action"]).toBe("close");
  });

  test("the resolution's subject stops at 200 characters", async () => {
    const result: JSONObject = await run({
      ...args(),
      [kind.noun]: quoted({
        ...kind.model({ state: kind.resolvedState }),
        [kind.noun === "incident"
          ? "incidentNumberWithPrefix"
          : "alertNumberWithPrefix"]: "N".repeat(300),
      }),
    });
    const subject: string = String(
      ((result["closeBody"] as JSONObject)["IncidentResolution"] as JSONObject)[
        "subject"
      ],
    );

    expect(subject).toHaveLength(200);
    expect(subject.startsWith(DYNAMICS_SYNCED_FROM_ONEUPTIME_MARKER)).toBe(
      true,
    );
  });

  test("the case number Dataverse sent is defused before it is quoted anywhere", async () => {
    const result: JSONObject = await run(
      args({
        search: quoted(
          caseSearchResponse([caseSearchRow({ ticketnumber: MALICIOUS })]),
        ),
      }),
    );

    expectDefused(result);
  });
});

/* Every note OneUptime sends to a case: private notes for both kinds, public ones for incidents. */
const NOTE_TEMPLATES: Array<[string, RecordKind, string, string]> = [
  [INCIDENT.templates.privateNote, INCIDENT, "private note", "private"],
  [INCIDENT.templates.publicNote as string, INCIDENT, "public note", "public"],
  [ALERT.templates.privateNote, ALERT, "private note", "private"],
];

describe.each(NOTE_TEMPLATES)(
  "%s: build-note-1",
  (templateId: string, kind: RecordKind, noteKind: string) => {
    const run: RunStepFunction = step(templateId, "build-note-1");

    type ArgsFunction = (props?: {
      note?: JSONObject | string | undefined;
      search?: JSONValue | undefined;
    }) => JSONObject;

    const args: ArgsFunction = (props?: {
      note?: JSONObject | string | undefined;
      search?: JSONValue | undefined;
    }): JSONObject => {
      const note: JSONObject | string = props?.note || kind.note();

      return {
        note: typeof note === "string" ? note : quoted(note),
        search:
          props?.search === undefined
            ? quoted(caseSearchResponse([caseSearchRow()]))
            : props.search,
      };
    };

    test("writes the note under a title that names it, the record and its author", async () => {
      expect(await run(args())).toEqual({
        proceed: true,
        caseId: CASE_ID,
        caseNumber: CASE_NUMBER,
        subject: `${DYNAMICS_SYNCED_FROM_ONEUPTIME_MARKER}: ${noteKind} on ${kind.number} by Jane Doe`,
        text: kind.noteText,
      });
    });

    test("a note with no author is still titled", async () => {
      const result: JSONObject = await run(
        args({ note: kind.note({ authorName: null }) }),
      );

      expect(result["subject"]).toBe(
        `${DYNAMICS_SYNCED_FROM_ONEUPTIME_MARKER}: ${noteKind} on ${kind.number}`,
      );
    });

    test("a note that came from Dynamics 365 is not sent back", async () => {
      expectSkipped(
        await run(
          args({
            note: kind.note({
              note: `${ONEUPTIME_SYNCED_FROM_DYNAMICS_MARKER}: Sam Okafor added a note to case [${CASE_NUMBER}](x).\n\nHello`,
            }),
          }),
        ),
        "This note came from Dynamics 365, so it was not posted back.",
      );
    });

    test("an empty note is not posted", async () => {
      for (const text of ["", "   \n\t "]) {
        expectSkipped(
          await run(args({ note: kind.note({ note: text }) })),
          "The note is empty, so there is nothing to post.",
        );
      }
    });

    test(`a note on a private ${kind.noun} stays in OneUptime`, async () => {
      expectSkipped(
        await run(args({ note: kind.note({ isPrivate: true }) })),
        `The note is on ${kind.number}, a private ${kind.noun}, so it was not posted to Dynamics 365.`,
      );
    });

    test(`${kind.syncPrivateName} posts it anyway`, async () => {
      const result: JSONObject = await run(
        args({ note: kind.note({ isPrivate: true }) }),
        syncPrivate(kind),
      );

      expect(result["proceed"]).toBe(true);
    });

    test("no linked case, no note", async () => {
      expectSkipped(
        await run(args({ search: quoted(EMPTY_CASE_SEARCH) })),
        `No Dynamics 365 case holds the link ${kind.link}, or the Dynamics 365 credentials cannot see it.`,
      );
    });

    test("two linked cases, no note: guessing would post to the wrong one", async () => {
      const result: JSONObject = await run(
        args({
          search: quoted(
            caseSearchResponse([
              caseSearchRow(),
              caseSearchRow({
                incidentid: OTHER_CASE_ID,
                ticketnumber: OTHER_CASE_NUMBER,
              }),
            ]),
          ),
        }),
      );

      expect(result["proceed"]).toBe(false);
      expect(result["reason"]).toContain(
        `${CASE_NUMBER}, ${OTHER_CASE_NUMBER}`,
      );
    });

    test("the title stops at a note's 500 characters, and the text at its 100,000", async () => {
      const result: JSONObject = await run(
        args({
          note: kind.note({
            note: "z".repeat(150000),
            authorName: "A".repeat(600),
          }),
        }),
      );

      expect(textOf(result, "subject")).toHaveLength(500);
      expect(textOf(result, "text")).toHaveLength(100000);
      expect(textOf(result, "text").endsWith("…")).toBe(true);
    });

    test("text OneUptime users wrote can never become a reference later", async () => {
      const result: JSONObject = await run(
        args({ note: kind.note({ note: MALICIOUS, authorName: MALICIOUS }) }),
      );

      expectDefused(result);
    });
  },
);

/* ------------------------ Dynamics 365 -> OneUptime ------------------------ */

describe.each(KINDS)(
  "%s: read-event-1, for new cases",
  (_name: string, kind: RecordKind) => {
    const run: RunStepFunction = step(
      kind.templates.createRecord,
      "read-event-1",
    );

    test("a Dataverse webhook for a new case names it", async () => {
      expect(await run(webhookContext({ messageName: "Create" }))).toEqual({
        proceed: true,
        caseId: CASE_ID,
        message: "Create",
      });
    });

    test("the id is read however Dataverse writes it", async () => {
      for (const id of [CASE_ID.toUpperCase(), `{${CASE_ID}}`]) {
        expect(
          (await run(webhookContext({ messageName: "Create", rowId: id })))[
            "caseId"
          ],
        ).toBe(CASE_ID);
      }
    });

    test("a body Dataverse cut down past 256 KB still names the case", async () => {
      expect(
        (await run(webhookContext({ messageName: "Create", stripped: true })))[
          "caseId"
        ],
      ).toBe(CASE_ID);
    });

    test("an edit is ignored: an old case must not become a record the first time it is edited", async () => {
      expectSkipped(
        await run(webhookContext({ messageName: "Update" })),
        "Ignored the Update event: this workflow only handles Create.",
      );
    });

    test("a Power Automate flow's body names the case by incidentid", async () => {
      expect(await run(flowBody())).toEqual({
        proceed: true,
        caseId: CASE_ID,
        message: "a change",
      });
      expect(await run({ incidentid: CASE_ID })).toEqual({
        proceed: true,
        caseId: CASE_ID,
        message: "a change",
      });
    });

    test("a flow that passes the trigger's SdkMessage on is held to the same events", async () => {
      expect((await run(flowBody({ sdkMessage: "Create" })))["proceed"]).toBe(
        true,
      );
      expectSkipped(
        await run(flowBody({ sdkMessage: "Update" })),
        "Ignored the Update event: this workflow only handles Create.",
      );
    });

    test("a webhook registered on another table is not taken for a case", async () => {
      expectSkipped(
        await run(webhookContext({ messageName: "Create", table: "account" })),
        "The request is about the account table, not cases, so it was ignored.",
      );
    });

    test("a request that names no case is ignored", async () => {
      // The JavaScript step hands a script {} for an empty body, and refuses one that is not JSON.
      for (const body of [
        {},
        { incidentid: "not-an-id" },
        { incidentid: EMPTY_ID },
        { PrimaryEntityName: "incident" },
        [CASE_ID],
      ]) {
        expectSkipped(
          await run(body as JSONValue),
          "The request did not name a Dynamics 365 case, so it was ignored.",
        );
      }
    });

    test("the event's name is defused, since anyone with the URL can choose it", async () => {
      const result: JSONObject = await run({
        incidentid: CASE_ID,
        SdkMessage: MALICIOUS,
      });

      expect(result["proceed"]).toBe(false);
      expectDefused(result);
    });
  },
);

describe.each(KINDS)(
  `%s: the create-from-case template's prepare step`,
  (_name: string, kind: RecordKind) => {
    const run: RunStepFunction = step(
      kind.templates.createRecord,
      kind.prepareRecordStep,
    );

    type ArgsFunction = (props?: {
      row?: JSONObject | string | undefined;
      severities?: JSONValue | undefined;
      linkColumn?: string | undefined;
    }) => JSONObject;

    const args: ArgsFunction = (props?: {
      row?: JSONObject | string | undefined;
      severities?: JSONValue | undefined;
      linkColumn?: string | undefined;
    }): JSONObject => {
      const row: JSONObject | string = props?.row || caseRow();

      return {
        severities:
          props?.severities === undefined
            ? quoted(kind.severities)
            : props.severities,
        dynamicsUrl: DYNAMICS_URL,
        linkColumn:
          props?.linkColumn === undefined ? LINK_COLUMN : props.linkColumn,
        case: typeof row === "string" ? row : quoted(row),
      };
    };

    const caseUrl: string = `${DYNAMICS_URL}/main.aspx?pagetype=entityrecord&etn=incident&id=${CASE_ID}`;

    test(`turns a new case into an ${kind.noun}`, async () => {
      expect(await run(args())).toEqual({
        proceed: true,
        caseId: CASE_ID,
        caseNumber: CASE_NUMBER,
        severityName: kind.priorities[0]?.severityName,
        [kind.severityIdKey]: kind.priorities[0]?.severityId,
        title: "Customers in the EU cannot complete checkout",
        description: [
          `${kind.Created} from Dynamics 365 case [${CASE_NUMBER}](${caseUrl}).`,
          "Priority: High",
          "Customer: Contoso Pharmaceuticals",
          "",
          "Three customers called since 09:40 UTC.\nThey see an error after entering card details.",
        ].join("\n"),
      });
    });

    test.each(kind.priorities)(
      "a case of priority $prioritycode becomes a $severityName record",
      async ({ prioritycode, severityId, severityName }: PriorityMapping) => {
        const result: JSONObject = await run(
          args({ row: caseRow({ prioritycode: prioritycode }) }),
        );

        expect(result[kind.severityIdKey]).toBe(severityId);
        expect(result["severityName"]).toBe(severityName);
      },
    );

    test("PRIORITY_RANK can send a Normal case to the most severe severity", async () => {
      const result: JSONObject = await run(
        args({ row: caseRow({ prioritycode: 2 }) }),
        replaceInCode(
          "const PRIORITY_RANK = { 1: 0, 2: 1, 3: 2 };",
          "const PRIORITY_RANK = { 1: 0, 2: 0, 3: 2 };",
        ),
      );

      expect(result[kind.severityIdKey]).toBe(kind.priorities[0]?.severityId);
    });

    test("ONLY_PRIORITIES leaves the other cases out", async () => {
      const highOnly: EditCodeFunction = replaceInCode(
        "const ONLY_PRIORITIES = [];",
        "const ONLY_PRIORITIES = [1];",
      );

      expect(
        (await run(args({ row: caseRow({ prioritycode: 1 }) }), highOnly))[
          "proceed"
        ],
      ).toBe(true);
      expectSkipped(
        await run(args({ row: caseRow({ prioritycode: 3 }) }), highOnly),
        `Dynamics 365 case ${CASE_NUMBER} has Low priority, which ONLY_PRIORITIES leaves out, so no ${kind.noun} was ${kind.created}.`,
      );
      expectSkipped(
        await run(args({ row: caseRow({ prioritycode: null }) }), highOnly),
        `Dynamics 365 case ${CASE_NUMBER} has no priority, which ONLY_PRIORITIES leaves out, so no ${kind.noun} was ${kind.created}.`,
      );
    });

    test("a case already linked to OneUptime becomes nothing: it is one OneUptime opened, or linked by hand", async () => {
      for (const link of [kind.link, kind.otherKindLink, "linked by hand"]) {
        expectSkipped(
          await run(args({ row: caseRow({ link: link }) })),
          `Dynamics 365 case ${CASE_NUMBER} is already linked to OneUptime (${link}), so no ${kind.noun} was ${kind.created}.`,
        );
      }
    });

    test("a link column holding only spaces is not a link", async () => {
      expect(
        (await run(args({ row: caseRow({ link: "   " }) })))["proceed"],
      ).toBe(true);
    });

    test.each([
      [5, "Resolved"],
      [6, "Cancelled"],
    ])(
      "a case that is already %s becomes nothing",
      async (statuscode: number, state: string) => {
        expectSkipped(
          await run(args({ row: caseRow({ statuscode: statuscode }) })),
          `Dynamics 365 case ${CASE_NUMBER} is ${state}, so no ${kind.noun} was ${kind.created}.`,
        );
      },
    );

    test("a case Dynamics 365 did not return becomes nothing", async () => {
      for (const row of [
        "null",
        quoted({
          error: {
            code: "0x80040217",
            message: "incident With Id = x Does Not Exist",
          },
        }),
        "{{local.components.get-case-1.returnValues.response-body}}",
      ]) {
        expectSkipped(
          await run(args({ row: row })),
          `Dynamics 365 did not return the case, so no ${kind.noun} was ${kind.created}.`,
        );
      }
    });

    test(`a project with no ${kind.noun} severities gets nothing`, async () => {
      expectSkipped(
        await run(args({ severities: quoted([]) })),
        `This project has no ${kind.noun} severities to choose from.`,
      );
    });

    test("a link column that is not a logical name stops it", async () => {
      expectSkipped(
        await run(args({ linkColumn: "OneUptime Link" })),
        `The Case Link Column setting, OneUptime Link, is not the logical name of a column, such as new_oneuptimelink, so no ${kind.noun} was ${kind.created}.`,
      );
    });

    test("an untitled case is named by its number", async () => {
      expect((await run(args({ row: caseRow({ title: "" }) })))["title"]).toBe(
        `Dynamics 365 case ${CASE_NUMBER}`,
      );
    });

    test("a case read without display text still works, with less said", async () => {
      const result: JSONObject = await run(
        args({ row: caseRow({ withoutFormattedValues: true }) }),
      );

      expect(result["proceed"]).toBe(true);
      expect(textOf(result, "description").split("\n")[1]).toBe("");
    });

    test("text Dynamics 365 users wrote can never become a reference later", async () => {
      const result: JSONObject = await run(
        args({
          row: caseRow({
            title: MALICIOUS,
            description: MALICIOUS,
            customerName: MALICIOUS,
            ticketnumber: "CAS-{{x}}",
          }),
        }),
      );

      expectDefused(result);
    });

    test("the title and description stop at OneUptime's limits", async () => {
      const result: JSONObject = await run(
        args({
          row: caseRow({
            title: "t".repeat(800),
            description: "d".repeat(30000),
          }),
        }),
      );

      expect(textOf(result, "title")).toHaveLength(500);
      expect(textOf(result, "description")).toHaveLength(20000);
    });
  },
);

describe.each(KINDS)(
  "%s: read-event-1, for case status changes",
  (_name: string, kind: RecordKind) => {
    const run: RunStepFunction = step(
      kind.templates.statusToState,
      "read-event-1",
    );

    test("resolving a case raises Close, which names the case in its resolution", async () => {
      expect(await run(webhookContext({ messageName: "Close" }))).toEqual({
        proceed: true,
        caseId: CASE_ID,
        message: "Close",
      });
    });

    test.each(["Update", "SetState", "SetStateDynamicEntity"])(
      "a status change raised as %s names the case",
      async (messageName: string) => {
        expect(
          (await run(webhookContext({ messageName: messageName })))["caseId"],
        ).toBe(CASE_ID);
      },
    );

    test("a new case, or a deleted one, is not a status change", async () => {
      for (const messageName of ["Create", "Delete"]) {
        expectSkipped(
          await run(webhookContext({ messageName: messageName })),
          `Ignored the ${messageName} event: this workflow only handles Update, Close, SetState, SetStateDynamicEntity.`,
        );
      }
    });

    test("a Power Automate flow's body names the case", async () => {
      expect((await run(flowBody({ sdkMessage: "Update" })))["caseId"]).toBe(
        CASE_ID,
      );
      expect((await run(flowBody()))["caseId"]).toBe(CASE_ID);
    });
  },
);

describe.each(KINDS)("%s: find-link-1", (_name: string, kind: RecordKind) => {
  const run: RunStepFunction = step(
    kind.templates.statusToState,
    "find-link-1",
  );

  type ArgsFunction = (
    row: JSONObject | string,
    linkColumn?: string,
  ) => JSONObject;

  const args: ArgsFunction = (
    row: JSONObject | string,
    linkColumn?: string,
  ): JSONObject => {
    return {
      linkColumn: linkColumn === undefined ? LINK_COLUMN : linkColumn,
      case: typeof row === "string" ? row : quoted(row),
    };
  };

  test(`reads the ${kind.noun} off the case's link column, with the case's status`, async () => {
    expect(
      await run(args(caseRow({ link: kind.link, statuscode: 5 }))),
    ).toEqual({
      proceed: true,
      [kind.idKey]: kind.id,
      caseId: CASE_ID,
      caseNumber: CASE_NUMBER,
      caseState: 1,
      caseStateName: "Resolved",
      caseStatus: 5,
      caseStatusName: "Problem Solved",
      caseStatusText: "Problem Solved",
      changedBy: "Priya Patel",
    });
  });

  test("a link written in capitals is still read", async () => {
    expect(
      (
        await run(
          args(
            caseRow({
              link: `  ${kind.link.toUpperCase().replace("ONEUPTIME", "OneUptime")} `,
            }),
          ),
        )
      )[kind.idKey],
    ).toBe(kind.id);
  });

  test("without display text, the status is still described", async () => {
    const result: JSONObject = await run(
      args(
        caseRow({
          link: kind.link,
          statuscode: 5,
          withoutFormattedValues: true,
        }),
      ),
    );

    expect(result["caseStatusName"]).toBe("");
    expect(result["caseStatusText"]).toBe("in status 5");
  });

  test.each([
    ["no link", null],
    ["the other kind's link", "other"],
    ["a link with no id", "prefix-only"],
    ["a link with a bad id", "bad-id"],
  ])(
    `a case with %s is not linked to an ${kind.noun}`,
    async (_label: string, link: string | null) => {
      const value: string | null =
        link === "other"
          ? kind.otherKindLink
          : link === "prefix-only"
            ? kind.linkPrefix
            : link === "bad-id"
              ? `${kind.linkPrefix}12345`
              : link;

      expectSkipped(
        await run(args(caseRow({ link: value }))),
        `Dynamics 365 case ${CASE_NUMBER} is not linked to an ${kind.noun}: its ${LINK_COLUMN} column does not hold ${kind.linkPrefix}<id>.`,
      );
    },
  );

  test("a case Dynamics 365 did not return is nothing to go on", async () => {
    for (const row of [
      "null",
      "{{local.components.get-case-1.returnValues.response-body}}",
    ]) {
      expectSkipped(
        await run(args(row)),
        "Dynamics 365 did not return the case.",
      );
    }
  });

  test("a link column that is not a logical name stops it", async () => {
    expectSkipped(
      await run(args(caseRow({ link: kind.link }), "")),
      "The Case Link Column setting, which is empty, is not the logical name of a column, such as new_oneuptimelink.",
    );
  });

  test("the status and the name of whoever changed it are defused", async () => {
    expectDefused(
      await run(
        args(
          caseRow({
            link: kind.link,
            modifiedBy: MALICIOUS,
            ticketnumber: MALICIOUS,
          }),
        ),
      ),
    );
  });
});

describe.each(KINDS)(
  "%s: decide-state-1",
  (_name: string, kind: RecordKind) => {
    const run: RunStepFunction = step(
      kind.templates.statusToState,
      "decide-state-1",
    );

    type LinkFunction = (props?: {
      caseState?: number | undefined;
      caseStatusName?: string | undefined;
    }) => JSONObject;

    const linkOf: LinkFunction = (props?: {
      caseState?: number | undefined;
      caseStatusName?: string | undefined;
    }): JSONObject => {
      return {
        proceed: true,
        [kind.idKey]: kind.id,
        caseId: CASE_ID,
        caseNumber: CASE_NUMBER,
        caseState: props?.caseState === undefined ? 1 : props.caseState,
        caseStateName: "Resolved",
        caseStatus: 5,
        caseStatusName: props?.caseStatusName || "Problem Solved",
        caseStatusText: props?.caseStatusName || "Problem Solved",
        changedBy: "Priya Patel",
      };
    };

    type ArgsFunction = (props?: {
      record?: JSONObject | string | undefined;
      link?: JSONObject | undefined;
    }) => JSONObject;

    const args: ArgsFunction = (props?: {
      record?: JSONObject | string | undefined;
      link?: JSONObject | undefined;
    }): JSONObject => {
      const record: JSONObject | string =
        props?.record || kind.model({ state: kind.createdState });

      return {
        [kind.noun]: typeof record === "string" ? record : quoted(record),
        states: quoted(kind.states),
        link: quoted(props?.link || linkOf()),
      };
    };

    test(`a resolved case resolves the ${kind.noun}, and says why`, async () => {
      expect(await run(args())).toEqual({
        proceed: true,
        [kind.idKey]: kind.id,
        stateId: kind.resolvedStateId,
        stateName: "Resolved",
        rootCause: `${ONEUPTIME_SYNCED_FROM_DYNAMICS_MARKER}: case ${CASE_NUMBER} is Problem Solved, changed by Priya Patel.`,
      });
    });

    test("an active case maps to nothing: the record never moves backwards", async () => {
      expectSkipped(
        await run(
          args({
            link: linkOf({ caseState: 0, caseStatusName: "In Progress" }),
          }),
        ),
        `Dynamics 365 case ${CASE_NUMBER} is In Progress, which does not map to a OneUptime state.`,
      );
    });

    test("a cancelled case maps to nothing, unless CASE_STATE_TO_STATE_FLAG says so", async () => {
      const cancelled: JSONObject = linkOf({
        caseState: 2,
        caseStatusName: "Cancelled",
      });

      expectSkipped(
        await run(args({ link: cancelled })),
        `Dynamics 365 case ${CASE_NUMBER} is Cancelled, which does not map to a OneUptime state.`,
      );

      const result: JSONObject = await run(
        args({ link: cancelled }),
        replaceInCode(
          "const CASE_STATE_TO_STATE_FLAG = { 1: 'isResolvedState' };",
          "const CASE_STATE_TO_STATE_FLAG = { 1: 'isResolvedState', 2: 'isResolvedState' };",
        ),
      );

      expect(result["stateId"]).toBe(kind.resolvedStateId);
    });

    test("CASE_STATUS_TO_STATE maps a status by name, over its state", async () => {
      const result: JSONObject = await run(
        args({ link: linkOf({ caseState: 0, caseStatusName: "Researching" }) }),
        replaceInCode(
          "const CASE_STATUS_TO_STATE = {};",
          "const CASE_STATUS_TO_STATE = { Researching: 'acknowledged' };",
        ),
      );

      expect(result["stateName"]).toBe("Acknowledged");
    });

    test(`an ${kind.noun} already resolved changes nothing: that is what settles the echo`, async () => {
      expectSkipped(
        await run(args({ record: kind.model({ state: kind.resolvedState }) })),
        `${kind.number} is already Resolved, so Dynamics 365 case ${CASE_NUMBER} being Problem Solved changes nothing.`,
      );
    });

    test(`an ${kind.noun} this project does not have is left alone`, async () => {
      for (const record of [
        "null",
        `{{local.components.find-${kind.noun}-1.returnValues.model}}`,
      ]) {
        expectSkipped(
          await run(args({ record: record })),
          `No ${kind.noun} with id ${kind.id} exists in this project.`,
        );
      }
    });

    test("the root cause stops at 1000 characters", async () => {
      const result: JSONObject = await run(
        args({ link: { ...linkOf(), changedBy: "P".repeat(2000) } }),
      );

      expect(textOf(result, "rootCause")).toHaveLength(1000);
    });
  },
);

describe.each(KINDS)(
  "%s: read-event-1, for case notes",
  (_name: string, kind: RecordKind) => {
    const run: RunStepFunction = step(
      kind.templates.caseNoteToNote,
      "read-event-1",
    );

    test("a Dataverse webhook for a new note names it", async () => {
      expect(
        await run(
          webhookContext({
            messageName: "Create",
            table: "annotation",
            rowId: NOTE_ID,
          }),
        ),
      ).toEqual({ proceed: true, noteId: NOTE_ID });
    });

    test("a Power Automate flow names the note by annotationid", async () => {
      expect(
        await run(flowBody({ idColumn: "annotationid", sdkMessage: "Create" })),
      ).toEqual({ proceed: true, noteId: NOTE_ID });
    });

    test("an edited note is ignored, unless MESSAGES takes Update", async () => {
      const edited: JSONObject = webhookContext({
        messageName: "Update",
        table: "annotation",
        rowId: NOTE_ID,
      });

      expectSkipped(
        await run(edited),
        "Ignored the Update event: this workflow only handles Create.",
      );
      expect(
        (
          await run(
            edited,
            replaceInCode(
              "const MESSAGES = ['Create'];",
              "const MESSAGES = ['Create', 'Update'];",
            ),
          )
        )["noteId"],
      ).toBe(NOTE_ID);
    });

    test("an event about a case is not a note", async () => {
      expectSkipped(
        await run(webhookContext({ messageName: "Create", table: "incident" })),
        "The request is about the incident table, not notes, so it was ignored.",
      );
      expectSkipped(
        await run({ incidentid: CASE_ID }),
        "The request did not name a Dynamics 365 note, so it was ignored.",
      );
    });
  },
);

describe.each(KINDS)("%s: read-note-1", (_name: string, kind: RecordKind) => {
  const run: RunStepFunction = step(
    kind.templates.caseNoteToNote,
    "read-note-1",
  );

  type ArgsFunction = (
    note: JSONObject | string,
    linkColumn?: string,
  ) => JSONObject;

  const args: ArgsFunction = (
    note: JSONObject | string,
    linkColumn?: string,
  ): JSONObject => {
    return {
      dynamicsUrl: DYNAMICS_URL,
      linkColumn: linkColumn === undefined ? LINK_COLUMN : linkColumn,
      note: typeof note === "string" ? note : quoted(note),
    };
  };

  const caseUrl: string = `${DYNAMICS_URL}/main.aspx?pagetype=entityrecord&etn=incident&id=${CASE_ID}`;

  test(`turns an agent's rich-text note into the text of a private note on the ${kind.noun}`, async () => {
    expect(await run(args(noteRow({ link: kind.link })))).toEqual({
      proceed: true,
      [kind.idKey]: kind.id,
      caseNumber: CASE_NUMBER,
      note: [
        `${ONEUPTIME_SYNCED_FROM_DYNAMICS_MARKER}: Sam Okafor added a note to case [${CASE_NUMBER}](${caseUrl}).`,
        "",
        "Called the customer",
        "",
        "They still see the error at checkout & on the retry page.\nAsked them to try again at 10:30.",
      ].join("\n"),
    });
  });

  test("HTML entities and breaks become text, and nothing is decoded twice", async () => {
    const result: JSONObject = await run(
      args(
        noteRow({
          link: kind.link,
          subject: null,
          notetext:
            "<p>a &lt;b&gt; c&nbsp;d &quot;e&quot; &#39;f&#39; &amp;lt;g&amp;gt;<br>next<br/>line</p><div>block</div>",
        }),
      ),
    );

    expect(textOf(result, "note").split("\n\n")[1]).toBe(
      "a <b> c d \"e\" 'f' &lt;g&gt;\nnext\nline\nblock",
    );
  });

  test("a plain-text note is left as it is", async () => {
    const result: JSONObject = await run(
      args(
        noteRow({
          link: kind.link,
          subject: "",
          notetext: "Plain <3 text, a < b",
        }),
      ),
    );

    expect(textOf(result, "note").endsWith("\n\nPlain <3 text, a < b")).toBe(
      true,
    );
  });

  test("a note OneUptime wrote is not copied back, whether the marker is in its title or its text", async () => {
    for (const note of [
      noteRow({
        link: kind.link,
        subject: `${DYNAMICS_SYNCED_FROM_ONEUPTIME_MARKER}: private note on ${kind.number} by Jane Doe`,
      }),
      noteRow({
        link: kind.link,
        subject: "Forwarded",
        notetext: `<p>${DYNAMICS_SYNCED_FROM_ONEUPTIME_MARKER}: quoted</p>`,
      }),
    ]) {
      expectSkipped(
        await run(args(note)),
        "This note was written by OneUptime, so it was not copied back.",
      );
    }
  });

  test("a note on another kind of row is not a case note", async () => {
    expectSkipped(
      await run(args(noteRow({ objecttypecode: "account" }))),
      "The note belongs to the account table, not to a case, so it was not copied.",
    );
    expectSkipped(
      await run(
        args({ ...noteRow(), objecttypecode: null, objectid_incident: null }),
      ),
      "The note belongs to another table, not to a case, so it was not copied.",
    );
  });

  test(`a note on a case that is not linked to an ${kind.noun} is left alone`, async () => {
    for (const link of [null, kind.otherKindLink]) {
      expectSkipped(
        await run(args(noteRow({ link: link }))),
        `Dynamics 365 case ${CASE_NUMBER} is not linked to an ${kind.noun}: its ${LINK_COLUMN} column does not hold ${kind.linkPrefix}<id>.`,
      );
    }
  });

  test("an attachment with no text has nothing to copy", async () => {
    expectSkipped(
      await run(
        args(
          noteRow({
            link: kind.link,
            subject: null,
            notetext: null,
            isdocument: true,
            filename: "har-capture.zip",
          }),
        ),
      ),
      `The note on Dynamics 365 case ${CASE_NUMBER} is the attachment har-capture.zip, with no text to copy.`,
    );
  });

  test("an attachment with text is copied, and the attachment named", async () => {
    const result: JSONObject = await run(
      args(
        noteRow({
          link: kind.link,
          isdocument: true,
          filename: "har-capture.zip",
        }),
      ),
    );

    expect(
      textOf(result, "note").endsWith(
        "\n\nAttachment, left in Dynamics 365: har-capture.zip",
      ),
    ).toBe(true);
  });

  test("an empty note is not copied", async () => {
    expectSkipped(
      await run(
        args(noteRow({ link: kind.link, subject: " ", notetext: "<p></p>" })),
      ),
      `The note on Dynamics 365 case ${CASE_NUMBER} is empty.`,
    );
  });

  test("a note Dynamics 365 did not return is nothing", async () => {
    for (const note of [
      "null",
      "{{local.components.get-note-1.returnValues.response-body}}",
    ]) {
      expectSkipped(
        await run(args(note)),
        "Dynamics 365 did not return the note.",
      );
    }
  });

  test("a note with no author is written as Someone's", async () => {
    const note: JSONObject = noteRow({ link: kind.link });
    delete note[formattedKey("_createdby_value")];

    expect(
      textOf(await run(args(note)), "note").startsWith(
        `${ONEUPTIME_SYNCED_FROM_DYNAMICS_MARKER}: Someone added a note`,
      ),
    ).toBe(true);
  });

  test("the note stops at MAX_NOTE_LENGTH", async () => {
    const result: JSONObject = await run(
      args(noteRow({ link: kind.link, notetext: "w".repeat(50000) })),
    );

    expect(textOf(result, "note")).toHaveLength(30000);
  });

  test("text Dynamics 365 users wrote can never become a reference later", async () => {
    expectDefused(
      await run(
        args(
          noteRow({
            link: kind.link,
            subject: MALICIOUS,
            notetext: `<p>${MALICIOUS}</p>`,
            author: MALICIOUS,
          }),
        ),
      ),
    );
  });
});

/* --------------------------- The kinds side by side --------------------------- */

describe("a case linked to one kind is never taken for the other", () => {
  test("the incident templates read no alert off a case, and the alert ones no incident", async () => {
    for (const [own, other] of [
      [INCIDENT, ALERT],
      [ALERT, INCIDENT],
    ] as Array<[RecordKind, RecordKind]>) {
      const findLink: RunStepFunction = step(
        own.templates.statusToState,
        "find-link-1",
      );
      const readNote: RunStepFunction = step(
        own.templates.caseNoteToNote,
        "read-note-1",
      );

      expect(
        (
          await findLink({
            linkColumn: LINK_COLUMN,
            case: quoted(caseRow({ link: other.link })),
          })
        )["proceed"],
      ).toBe(false);
      expect(
        (
          await readNote({
            dynamicsUrl: DYNAMICS_URL,
            linkColumn: LINK_COLUMN,
            note: quoted(noteRow({ link: other.link })),
          })
        )["proceed"],
      ).toBe(false);
    }
  });

  test("neither kind creates a record for a case the other kind is linked to", async () => {
    for (const [own, other] of [
      [INCIDENT, ALERT],
      [ALERT, INCIDENT],
    ] as Array<[RecordKind, RecordKind]>) {
      const prepare: RunStepFunction = step(
        own.templates.createRecord,
        own.prepareRecordStep,
      );

      expect(
        (
          await prepare({
            severities: quoted(own.severities),
            dynamicsUrl: DYNAMICS_URL,
            linkColumn: LINK_COLUMN,
            case: quoted(caseRow({ link: other.link })),
          })
        )["proceed"],
      ).toBe(false);
    }
  });
});

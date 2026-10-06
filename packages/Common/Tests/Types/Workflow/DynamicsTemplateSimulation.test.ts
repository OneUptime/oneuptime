/*
 * End-to-end simulations of the Dynamics 365 templates.
 *
 * Each scenario builds a template the way the create wizard does, gives it
 * exactly the variables the wizard writes for it (the static ones, and the
 * OAuth 2.0 variable as the access token OneUptime fetched), and runs it
 * through WorkflowTemplateSimulator: real substitution, real sandboxed
 * scripts, real If / Else, Log and API components. Dataverse is a fake with
 * state of its own (FakeDataverse below), so a case one template opens is
 * the case the next template finds, and a chain of templates can be run to
 * show that it settles rather than echoing.
 *
 * The fake holds the templates to what the real Web API would: a bearer
 * token on every call, a customer on every new case, no column it does not
 * have, the Case table's lengths, CloseIncident only for an active case and
 * a resolved status, and a PATCH without If-Match behaving as the upsert it
 * is. Every test asserts what left the workflow: the requests sent, the
 * database calls made, and the lines logged.
 *
 * Every template comes in an incident and an alert version, so the
 * scenarios run for both kinds; a last group runs the two kinds against each
 * other.
 */

import {
  afterAll,
  beforeAll,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import Dictionary from "../../../Types/Dictionary";
import { JSONObject, JSONValue } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import WorkflowVariable from "../../../Models/DatabaseModels/WorkflowVariable";
import {
  DYNAMICS_SYNCED_FROM_ONEUPTIME_MARKER,
  ONEUPTIME_SYNCED_FROM_DYNAMICS_MARKER,
  WorkflowTemplate,
  getWorkflowTemplate,
} from "../../../Types/Workflow/Templates";
import { WorkflowVariableType } from "../../../Types/Workflow/WorkflowVariableOAuth";
import { buildWorkflowVariables } from "../../../../App/FeatureSet/Dashboard/src/Utils/Workflow/WorkflowTemplateCreateUtil";
import {
  ACKNOWLEDGED_STATE,
  ALERT_ACKNOWLEDGED_STATE,
  ALERT_CREATED_STATE,
  ALERT_ID,
  ALERT_NUMBER,
  ALERT_RESOLVED_STATE,
  ALERT_SEVERITIES,
  ALERT_STATES,
  CREATED_STATE,
  CRITICAL_SEVERITY_ID,
  HIGH_ALERT_SEVERITY_ID,
  INCIDENT_ID,
  INCIDENT_NUMBER,
  INCIDENT_SEVERITIES,
  INCIDENT_STATES,
  PROJECT_ID,
  RESOLVED_STATE,
  alertModel,
  alertNoteModel,
  incidentModel,
  noteModel,
} from "./JiraTemplateFixtures";
import {
  ACCOUNT_ID,
  CASE_ID,
  CASE_NUMBER,
  DYNAMICS_API,
  DYNAMICS_URL,
  LINK_COLUMN,
  NOTE_ID,
  flowBody,
  formattedKey,
  webhookContext,
} from "./DynamicsTemplateFixtures";
import {
  DATABASE_FAILURE,
  DatabaseAnswer,
  DatabaseCall,
  DatabaseReply,
  FakeDatabase,
  SimulatedReply,
  SimulatedRequest,
  SimulationTrace,
  createdWithId,
  found,
  many,
  runTemplate,
  stubDnsLookups,
} from "./WorkflowTemplateSimulator";

// Every script and condition runs in a real isolate, and each one takes a moment to start.
jest.setTimeout(120000);

/* ------------------------------ Configuration ------------------------------ */

/*
 * The token OneUptime fetched for the OAuth 2.0 variable. Finding it
 * anywhere but an Authorization header means it travelled somewhere it
 * should not.
 */
const ACCESS_TOKEN: string =
  "eyJ0eXAiOiJKV1QiLCJhbGciOiJSUzI1NiJ9.simulated-dataverse-access-token.c2lnbmF0dXJl";

/* What someone setting the templates up types into the wizard. */
const TENANT_ID: string = "72f988bf-86f1-41af-91ab-2d7cd011db47";
const CLIENT_ID: string = "9f2c1d44-7a3b-4c5d-8e6f-0a1b2c3d4e5f";
const CLIENT_SECRET: string = "Abc8Q~simulated-client-secret-value.0123456";
const ONEUPTIME_URL: string = "https://oneuptime.com";

const TYPED_VALUES: Dictionary<string> = {
  dynamicsUrl: DYNAMICS_URL,
  dynamicsTenantId: TENANT_ID,
  dynamicsClientId: CLIENT_ID,
  dynamicsClientSecret: CLIENT_SECRET,
  dynamicsLinkColumn: LINK_COLUMN,
  dynamicsCustomer: ACCOUNT_ID,
  oneuptimeUrl: ONEUPTIME_URL,
};

/** The ids Dataverse gives the cases and notes the templates create. */
const NEW_CASE_ID: string = "d4e5f6a7-8b9c-4d0e-9f1a-3b4c5d6e7f80";
const NEW_CASE_NUMBER: string = "CAS-01003-N7P8Q9";
const NEW_ANNOTATION_ID: string = "e5f6a7b8-9c0d-4e1f-8a2b-4c5d6e7f8091";

/** The ids the database gives a record, a note or a timeline row the templates write. */
const NEW_RECORD_ID: string = "f6a7b8c9-0d1e-4f2a-9b3c-5d6e7f809102";
const NEW_NOTE_ROW_ID: string = "abababab-0000-4000-8000-0000000000aa";
const NEW_TIMELINE_ID: string = "cdcdcdcd-0000-4000-8000-0000000000cc";

type VariablesForFunction = (templateId: string) => Dictionary<string>;

/*
 * The variables a run of this template has: exactly the rows the create
 * wizard writes, as buildWorkflowVariables builds them — a static row's
 * content, and for the OAuth 2.0 row the access token OneUptime fetched with
 * its settings. A setting typed only for the OAuth 2.0 variable has no row,
 * so a reference to it would stay unresolved here, as it would at run time.
 */
const variablesFor: VariablesForFunction = (
  templateId: string,
): Dictionary<string> => {
  const template: WorkflowTemplate | null = getWorkflowTemplate(templateId);

  if (!template) {
    throw new Error(`There is no template ${templateId}.`);
  }

  const values: Dictionary<string> = {};

  for (const row of buildWorkflowVariables({
    template: template,
    values: TYPED_VALUES,
    workflowId: ObjectID.generate(),
    projectId: new ObjectID(PROJECT_ID),
  })) {
    values[row.name as string] =
      row.variableType === WorkflowVariableType.OAuth2
        ? ACCESS_TOKEN
        : (row.content as string);
  }

  return values;
};

/* ------------------------------ Fake Dataverse ------------------------------ */

interface StoredCase {
  incidentid: string;
  ticketnumber: string;
  title: string;
  description: string | null;
  prioritycode: number | null;
  statecode: number;
  statuscode: number;
  customer: string;
  customerName: string;
  modifiedByName: string;
  link: string | null;
  caseorigincode?: number | undefined;
  casetypecode?: number | undefined;
}

interface StoredNote {
  annotationid: string;
  subject: string | null;
  notetext: string | null;
  isdocument: boolean;
  filename: string | null;
  /** The case the note is on, or null for a note on another table's row. */
  caseId: string | null;
  objecttypecode: string;
  authorName: string;
}

interface StoredResolution {
  caseId: string;
  subject: string;
  description: string;
  status: number;
}

const STATE_NAMES: Record<number, string> = {
  0: "Active",
  1: "Resolved",
  2: "Cancelled",
};

const STATUS_NAMES: Record<number, string> = {
  1: "In Progress",
  2: "On Hold",
  3: "Waiting for Details",
  4: "Researching",
  5: "Problem Solved",
  1000: "Information Provided",
  6: "Cancelled",
  2000: "Merged",
};

const STATUS_STATE: Record<number, number> = {
  1: 0,
  2: 0,
  3: 0,
  4: 0,
  5: 1,
  1000: 1,
  6: 2,
  2000: 2,
};

const PRIORITY_NAMES: Record<number, string> = {
  1: "High",
  2: "Normal",
  3: "Low",
};

const GUID: RegExp =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

type ErrorReplyFunction = (
  status: number,
  code: string,
  message: string,
) => SimulatedReply;

const errorReply: ErrorReplyFunction = (
  status: number,
  code: string,
  message: string,
): SimulatedReply => {
  return { status: status, body: { error: { code: code, message: message } } };
};

const NO_CONTENT: SimulatedReply = { status: 204, body: "" };

/*
 * The Dataverse Web API, as far as the templates use it. Its rules are the
 * real API's, so a template that broke one gets the answer it would get from
 * Dynamics 365.
 */
class FakeDataverse {
  public cases: Map<string, StoredCase> = new Map();
  public notes: Map<string, StoredNote> = new Map();
  public resolutions: Array<StoredResolution> = [];
  /** Replies forced for a route, keyed "<METHOD> <path>", whatever the request says. */
  public failures: Dictionary<SimulatedReply> = {};

  private newCaseIds: Array<[string, string]> = [
    [NEW_CASE_ID, NEW_CASE_NUMBER],
  ];
  private newNoteIds: Array<string> = [NEW_ANNOTATION_ID];

  public constructor(props?: {
    cases?: Array<Partial<StoredCase>> | undefined;
    notes?: Array<Partial<StoredNote>> | undefined;
  }) {
    for (const row of props?.cases || []) {
      this.addCase(row);
    }

    for (const note of props?.notes || []) {
      this.addNote(note);
    }
  }

  public addCase(row: Partial<StoredCase>): StoredCase {
    const statuscode: number =
      row.statuscode === undefined ? 1 : row.statuscode;
    const stored: StoredCase = {
      incidentid: row.incidentid || CASE_ID,
      ticketnumber: row.ticketnumber || CASE_NUMBER,
      title: row.title || "Customers in the EU cannot complete checkout",
      description:
        row.description === undefined
          ? "Three customers called since 09:40 UTC."
          : row.description,
      prioritycode: row.prioritycode === undefined ? 1 : row.prioritycode,
      statecode: STATUS_STATE[statuscode] as number,
      statuscode: statuscode,
      customer: row.customer || `/accounts(${ACCOUNT_ID})`,
      customerName: row.customerName || "Contoso Pharmaceuticals",
      modifiedByName: row.modifiedByName || "Priya Patel",
      link: row.link === undefined ? null : row.link,
    };

    this.cases.set(stored.incidentid, stored);

    return stored;
  }

  public addNote(note: Partial<StoredNote>): StoredNote {
    const stored: StoredNote = {
      annotationid: note.annotationid || NOTE_ID,
      subject:
        note.subject === undefined ? "Called the customer" : note.subject,
      notetext:
        note.notetext === undefined
          ? "<p>They still see the error at checkout.</p>"
          : note.notetext,
      isdocument: Boolean(note.isdocument),
      filename: note.filename === undefined ? null : note.filename,
      caseId: note.caseId === undefined ? CASE_ID : note.caseId,
      objecttypecode: note.objecttypecode || "incident",
      authorName: note.authorName || "Sam Okafor",
    };

    this.notes.set(stored.annotationid, stored);

    return stored;
  }

  public caseOf(caseId: string): StoredCase {
    const row: StoredCase | undefined = this.cases.get(caseId);

    if (!row) {
      throw new Error(`Dataverse has no case ${caseId}.`);
    }

    return row;
  }

  public handle: (request: SimulatedRequest) => SimulatedReply = (
    request: SimulatedRequest,
  ): SimulatedReply => {
    if (!request.url.startsWith(`${DYNAMICS_API}/`)) {
      return errorReply(404, "0x80060888", `Not a Web API URL: ${request.url}`);
    }

    // Dataverse answers a request with no token, or the wrong one, with an empty 401.
    if (request.headers["Authorization"] !== `Bearer ${ACCESS_TOKEN}`) {
      return { status: 401, body: "" };
    }

    if (
      request.headers["OData-Version"] !== "4.0" ||
      request.headers["OData-MaxVersion"] !== "4.0"
    ) {
      return errorReply(400, "0x80060888", "OData headers are missing.");
    }

    const rest: string = request.url.slice(DYNAMICS_API.length + 1);
    const separator: number = rest.indexOf("?");
    const path: string = separator === -1 ? rest : rest.slice(0, separator);
    const query: Dictionary<string> = {};

    if (separator !== -1) {
      for (const pair of rest.slice(separator + 1).split("&")) {
        const equals: number = pair.indexOf("=");
        query[pair.slice(0, equals)] = decodeURIComponent(
          pair.slice(equals + 1),
        );
      }
    }

    const forced: SimulatedReply | undefined =
      this.failures[`${request.method} ${path}`];

    if (forced) {
      return forced;
    }

    const formatted: boolean = String(request.headers["Prefer"] || "").includes(
      "odata.include-annotations",
    );

    const single: RegExpMatchArray | null = path.match(
      /^(incidents|annotations)\(([^)]*)\)$/,
    );

    if (request.method === "GET" && path === "incidents") {
      return this.queryCases(query, formatted);
    }

    if (request.method === "GET" && single?.[1] === "incidents") {
      const row: StoredCase | undefined = this.cases.get(single[2] as string);

      if (!row) {
        return errorReply(
          404,
          "0x80040217",
          `incident With Id = ${single[2]} Does Not Exist`,
        );
      }

      return {
        status: 200,
        body: {
          "@odata.context": `${DYNAMICS_API}/$metadata#incidents/$entity`,
          "@odata.etag": 'W/"4410925"',
          ...this.projectCase(row, this.selectOf(query), formatted),
        },
      };
    }

    if (request.method === "GET" && single?.[1] === "annotations") {
      return this.getNote(single[2] as string, query, formatted);
    }

    if (request.method === "POST" && path === "incidents") {
      return this.createCase(request, query);
    }

    if (request.method === "PATCH" && single?.[1] === "incidents") {
      return this.updateCase(request, single[2] as string);
    }

    if (request.method === "POST" && path === "CloseIncident") {
      return this.closeCase(request);
    }

    if (request.method === "POST" && path === "annotations") {
      return this.createNote(request);
    }

    return errorReply(
      404,
      "0x80060888",
      `Resource not found for the segment '${path}'.`,
    );
  };

  private selectOf(query: Dictionary<string>): Array<string> {
    return (query["$select"] || "").split(",").filter(Boolean);
  }

  private projectCase(
    row: StoredCase,
    select: Array<string>,
    formatted: boolean,
  ): JSONObject {
    const columns: JSONObject = {
      incidentid: row.incidentid,
      ticketnumber: row.ticketnumber,
      title: row.title,
      description: row.description,
      prioritycode: row.prioritycode,
      statecode: row.statecode,
      statuscode: row.statuscode,
      _customerid_value: ACCOUNT_ID,
      _modifiedby_value: "e64e2827-e822-e711-a815-000d3a17ea56",
      [LINK_COLUMN]: row.link,
    };
    const projected: JSONObject = {};

    for (const column of select) {
      if (!(column in columns)) {
        throw new Error(
          `A template selected ${column}, which the Case table does not have.`,
        );
      }

      projected[column] = columns[column] as JSONValue;
    }

    if (formatted) {
      const labels: Dictionary<string | undefined> = {
        prioritycode:
          row.prioritycode === null
            ? undefined
            : PRIORITY_NAMES[row.prioritycode],
        statecode: STATE_NAMES[row.statecode],
        statuscode: STATUS_NAMES[row.statuscode],
        _customerid_value: row.customerName,
        _modifiedby_value: row.modifiedByName,
      };

      for (const column of select) {
        const label: string | undefined = labels[column];

        if (label !== undefined) {
          projected[formattedKey(column)] = label;
        }
      }
    }

    return projected;
  }

  private queryCases(
    query: Dictionary<string>,
    formatted: boolean,
  ): SimulatedReply {
    const filter: RegExpMatchArray | null = (query["$filter"] || "").match(
      /^([a-z0-9_]+) eq '([^']*)'$/,
    );

    if (!filter) {
      return errorReply(
        400,
        "0x80060888",
        `The query specified in the URI is not valid: ${query["$filter"]}`,
      );
    }

    if (filter[1] !== LINK_COLUMN) {
      return errorReply(
        400,
        "0x80060888",
        `Could not find a property named '${filter[1]}' on type 'Microsoft.Dynamics.CRM.incident'.`,
      );
    }

    const rows: Array<StoredCase> = Array.from(this.cases.values()).filter(
      (row: StoredCase) => {
        return row.link === filter[2];
      },
    );
    const top: number = Number(query["$top"] || rows.length);

    return {
      status: 200,
      body: {
        "@odata.context": `${DYNAMICS_API}/$metadata#incidents(${query["$select"]})`,
        value: rows.slice(0, top).map((row: StoredCase): JSONObject => {
          return {
            "@odata.etag": 'W/"4410925"',
            ...this.projectCase(row, this.selectOf(query), formatted),
          };
        }),
      },
    };
  }

  private getNote(
    noteId: string,
    query: Dictionary<string>,
    formatted: boolean,
  ): SimulatedReply {
    const note: StoredNote | undefined = this.notes.get(noteId);

    if (!note) {
      return errorReply(
        404,
        "0x80040217",
        `annotation With Id = ${noteId} Does Not Exist`,
      );
    }

    const expand: RegExpMatchArray | null = (query["$expand"] || "").match(
      /^objectid_incident\(\$select=([^)]*)\)$/,
    );

    if (!expand) {
      return errorReply(
        400,
        "0x80060888",
        `Unexpected $expand ${query["$expand"]}.`,
      );
    }

    const caseRow: StoredCase | undefined =
      note.objecttypecode === "incident" && note.caseId
        ? this.cases.get(note.caseId)
        : undefined;

    const body: JSONObject = {
      "@odata.context": `${DYNAMICS_API}/$metadata#annotations/$entity`,
      "@odata.etag": 'W/"4411002"',
      annotationid: note.annotationid,
      subject: note.subject,
      notetext: note.notetext,
      isdocument: note.isdocument,
      filename: note.filename,
      objecttypecode: note.objecttypecode,
      _createdby_value: "f1e2d3c4-b5a6-4978-8a9b-0c1d2e3f4a5b",
      objectid_incident: caseRow
        ? this.projectCase(caseRow, (expand[1] as string).split(","), false)
        : null,
    };

    if (formatted) {
      body[formattedKey("_createdby_value")] = note.authorName;
    }

    return { status: 200, body: body };
  }

  private writableColumn(column: string): boolean {
    return [
      "title",
      "description",
      "prioritycode",
      "caseorigincode",
      "casetypecode",
      "statecode",
      "statuscode",
      LINK_COLUMN,
    ].includes(column);
  }

  private createCase(
    request: SimulatedRequest,
    query: Dictionary<string>,
  ): SimulatedReply {
    const body: JSONObject = (request.body as JSONObject) || {};
    const customers: Array<string> = Object.keys(body).filter((key: string) => {
      return key.startsWith("customerid");
    });

    if (customers.length !== 1) {
      return errorReply(
        400,
        "0x80040203",
        "Exception Message: An unexpected error occurred: customerid is required.",
      );
    }

    const binding: string = customers[0] as string;
    const bound: string = String(body[binding]);
    const bindingMatch: RegExpMatchArray | null = bound.match(
      /^\/(accounts|contacts)\(([^)]*)\)$/,
    );

    if (
      !bindingMatch ||
      !GUID.test(bindingMatch[2] as string) ||
      binding !==
        `customerid_${bindingMatch[1] === "contacts" ? "contact" : "account"}@odata.bind`
    ) {
      return errorReply(
        400,
        "0x80060888",
        `An undeclared property '${binding}' which only has property annotations in the payload but no property value was found in the payload.`,
      );
    }

    for (const column of Object.keys(body)) {
      if (column !== binding && !this.writableColumn(column)) {
        return errorReply(
          400,
          "0x80060888",
          `The property '${column}' does not exist on type 'Microsoft.Dynamics.CRM.incident'.`,
        );
      }
    }

    if (String(body["title"] || "").length > 200) {
      return errorReply(
        400,
        "0x80044331",
        "A validation error occurred. The length of the 'title' attribute of the 'incident' entity exceeded the maximum allowed length of '200'.",
      );
    }

    if (String(body["description"] || "").length > 2000) {
      return errorReply(
        400,
        "0x80044331",
        "A validation error occurred. The length of the 'description' attribute of the 'incident' entity exceeded the maximum allowed length of '2000'.",
      );
    }

    const next: [string, string] | undefined = this.newCaseIds.shift();

    if (!next) {
      throw new Error("The simulation ran out of new case ids.");
    }

    const stored: StoredCase = this.addCase({
      incidentid: next[0],
      ticketnumber: next[1],
      title: String(body["title"] || ""),
      description: (body["description"] as string) || null,
      prioritycode: (body["prioritycode"] as number) ?? null,
      customer: bound,
      link: (body[LINK_COLUMN] as string) || null,
    });
    stored.caseorigincode = body["caseorigincode"] as number;
    stored.casetypecode = body["casetypecode"] as number;

    if (
      String(request.headers["Prefer"] || "").includes("return=representation")
    ) {
      return {
        status: 201,
        body: {
          "@odata.context": `${DYNAMICS_API}/$metadata#incidents(${query["$select"]})/$entity`,
          "@odata.etag": 'W/"4410925"',
          ...this.projectCase(stored, this.selectOf(query), false),
        },
      };
    }

    return {
      ...NO_CONTENT,
      headers: {
        "odata-entityid": `${DYNAMICS_API}/incidents(${stored.incidentid})`,
      },
    };
  }

  private updateCase(
    request: SimulatedRequest,
    caseId: string,
  ): SimulatedReply {
    const body: JSONObject = (request.body as JSONObject) || {};
    let row: StoredCase | undefined = this.cases.get(caseId);

    if (!row) {
      if (request.headers["If-Match"] === "*") {
        return errorReply(
          404,
          "0x80040217",
          `incident With Id = ${caseId} Does Not Exist`,
        );
      }

      // Without If-Match, a PATCH to a missing row creates it: the upsert the templates must never do.
      row = this.addCase({ incidentid: caseId, ticketnumber: "CAS-UPSERTED" });
    }

    for (const column of Object.keys(body)) {
      if (!this.writableColumn(column)) {
        return errorReply(
          400,
          "0x80060888",
          `The property '${column}' does not exist on type 'Microsoft.Dynamics.CRM.incident'.`,
        );
      }
    }

    if (body["statuscode"] !== undefined) {
      const statuscode: number = Number(body["statuscode"]);

      if (STATUS_STATE[statuscode] !== Number(body["statecode"])) {
        return errorReply(
          400,
          "0x8004431a",
          `${statuscode} is not a valid status code for state code ${body["statecode"]}.`,
        );
      }

      row.statuscode = statuscode;
      row.statecode = STATUS_STATE[statuscode] as number;
    }

    if (body[LINK_COLUMN] !== undefined) {
      row.link = body[LINK_COLUMN] as string;
    }

    return NO_CONTENT;
  }

  private closeCase(request: SimulatedRequest): SimulatedReply {
    const body: JSONObject = (request.body as JSONObject) || {};
    const resolution: JSONObject =
      (body["IncidentResolution"] as JSONObject) || {};
    const bound: RegExpMatchArray | null = String(
      resolution["incidentid@odata.bind"] || "",
    ).match(/^\/incidents\(([^)]*)\)$/);
    const row: StoredCase | undefined = bound
      ? this.cases.get(bound[1] as string)
      : undefined;
    const status: number = Number(body["Status"]);

    if (!row) {
      return errorReply(
        400,
        "0x80040217",
        "The case named in IncidentResolution does not exist.",
      );
    }

    if (row.statecode !== 0) {
      return errorReply(
        400,
        "0x80040203",
        "This case has already been resolved. Close and reopen the case record to see the updates.",
      );
    }

    if (STATUS_STATE[status] !== 1) {
      return errorReply(
        400,
        "0x8004431a",
        `${status} is not a valid status code for state code IncidentState.Resolved.`,
      );
    }

    row.statecode = 1;
    row.statuscode = status;
    this.resolutions.push({
      caseId: row.incidentid,
      subject: String(resolution["subject"] || ""),
      description: String(resolution["description"] || ""),
      status: status,
    });

    return NO_CONTENT;
  }

  private createNote(request: SimulatedRequest): SimulatedReply {
    const body: JSONObject = (request.body as JSONObject) || {};
    const bound: RegExpMatchArray | null = String(
      body["objectid_incident@odata.bind"] || "",
    ).match(/^\/incidents\(([^)]*)\)$/);

    if (!bound || !this.cases.has(bound[1] as string)) {
      return errorReply(
        400,
        "0x80040217",
        "The case the note is bound to does not exist.",
      );
    }

    if (String(body["subject"] || "").length > 500) {
      return errorReply(
        400,
        "0x80044331",
        "The length of the 'subject' attribute of the 'annotation' entity exceeded the maximum allowed length of '500'.",
      );
    }

    const id: string | undefined = this.newNoteIds.shift();

    if (!id) {
      throw new Error("The simulation ran out of new note ids.");
    }

    this.addNote({
      annotationid: id,
      subject: (body["subject"] as string) || null,
      notetext: (body["notetext"] as string) || null,
      caseId: bound[1] as string,
      authorName: "OneUptime Integration",
    });

    return {
      ...NO_CONTENT,
      headers: { "odata-entityid": `${DYNAMICS_API}/annotations(${id})` },
    };
  }
}

/* ------------------------------ The two kinds ------------------------------ */

interface RecordModelProps {
  _id?: string | undefined;
  title?: string | undefined;
  description?: string | null | undefined;
  customFields?: JSONObject | null | undefined;
  state?: JSONObject | undefined;
  severity?: string | undefined;
  isPrivate?: boolean | undefined;
}

interface SimulatedKind {
  noun: string;
  Noun: string;
  created: string;
  Created: string;
  number: string;
  id: string;
  link: string;
  otherKindLink: string;
  numberField: string;
  idColumn: string;
  timelineStateColumn: string;
  severityIdColumn: string;
  dashboardPath: string;
  templates: {
    createCase: string;
    updateCase: string;
    privateNote: string;
    publicNote: string | undefined;
    createRecord: string;
    statusToState: string;
    caseNoteToNote: string;
  };
  steps: { prepareRecord: string; createRecord: string; find: string };
  components: {
    findOne: string;
    createOne: string;
    severityFindMany: string;
    stateFindMany: string;
    timelineCreateOne: string;
    noteCreateOne: string;
  };
  createdState: JSONObject;
  acknowledgedState: JSONObject;
  resolvedState: JSONObject;
  states: Array<JSONObject>;
  severities: Array<JSONObject>;
  mostSevereId: string;
  mostSevereName: string;
  quietCreateFields: JSONObject;
  title: string;
  noteText: string;
  model: (props?: RecordModelProps) => JSONObject;
  note: (props?: {
    note?: string | undefined;
    isPrivate?: boolean | undefined;
  }) => JSONObject;
}

const INCIDENT: SimulatedKind = {
  noun: "incident",
  Noun: "Incident",
  created: "declared",
  Created: "Declared",
  number: INCIDENT_NUMBER,
  id: INCIDENT_ID,
  link: `oneuptime-incident-${INCIDENT_ID}`,
  otherKindLink: `oneuptime-alert-${ALERT_ID}`,
  numberField: "incidentNumberWithPrefix",
  idColumn: "incidentId",
  timelineStateColumn: "incidentStateId",
  severityIdColumn: "incidentSeverityId",
  dashboardPath: "incidents",
  templates: {
    createCase: "dynamics-create-case-for-incident",
    updateCase: "dynamics-update-case-on-incident-state",
    privateNote: "dynamics-note-from-incident-private-note",
    publicNote: "dynamics-note-from-incident-public-note",
    createRecord: "dynamics-declare-incident-from-case",
    statusToState: "dynamics-case-status-to-incident-state",
    caseNoteToNote: "dynamics-case-note-to-incident-private-note",
  },
  steps: {
    prepareRecord: "prepare-incident-1",
    createRecord: "create-incident-1",
    find: "find-incident-1",
  },
  components: {
    findOne: "incident-find-one",
    createOne: "incident-create-one",
    severityFindMany: "incident-severity-find-many",
    stateFindMany: "incident-state-find-many",
    timelineCreateOne: "incident-state-timeline-create-one",
    noteCreateOne: "incident-internal-note-create-one",
  },
  createdState: CREATED_STATE,
  acknowledgedState: ACKNOWLEDGED_STATE,
  resolvedState: RESOLVED_STATE,
  states: INCIDENT_STATES,
  severities: INCIDENT_SEVERITIES,
  mostSevereId: CRITICAL_SEVERITY_ID,
  mostSevereName: "Critical Incident",
  quietCreateFields: {
    isVisibleOnStatusPage: false,
    shouldStatusPageSubscribersBeNotifiedOnIncidentCreated: false,
  },
  title: "Checkout latency high",
  noteText:
    "Failed over to the **secondary** database. Error rate is dropping.",
  model: (props?: RecordModelProps): JSONObject => {
    const model: JSONObject = incidentModel(props);

    if (props?.isPrivate !== undefined) {
      model["isPrivate"] = props.isPrivate;
    }

    return model;
  },
  note: (props?: {
    note?: string | undefined;
    isPrivate?: boolean | undefined;
  }): JSONObject => {
    const model: JSONObject = noteModel({ note: props?.note });

    if (props?.isPrivate !== undefined) {
      model["incident"] = {
        ...(model["incident"] as JSONObject),
        isPrivate: props.isPrivate,
      };
    }

    return model;
  },
};

const ALERT: SimulatedKind = {
  noun: "alert",
  Noun: "Alert",
  created: "created",
  Created: "Created",
  number: ALERT_NUMBER,
  id: ALERT_ID,
  link: `oneuptime-alert-${ALERT_ID}`,
  otherKindLink: `oneuptime-incident-${INCIDENT_ID}`,
  numberField: "alertNumberWithPrefix",
  idColumn: "alertId",
  timelineStateColumn: "alertStateId",
  severityIdColumn: "alertSeverityId",
  dashboardPath: "alerts",
  templates: {
    createCase: "dynamics-create-case-for-alert",
    updateCase: "dynamics-update-case-on-alert-state",
    privateNote: "dynamics-note-from-alert-private-note",
    publicNote: undefined,
    createRecord: "dynamics-create-alert-from-case",
    statusToState: "dynamics-case-status-to-alert-state",
    caseNoteToNote: "dynamics-case-note-to-alert-private-note",
  },
  steps: {
    prepareRecord: "prepare-alert-1",
    createRecord: "create-alert-1",
    find: "find-alert-1",
  },
  components: {
    findOne: "alert-find-one",
    createOne: "alert-create-one",
    severityFindMany: "alert-severity-find-many",
    stateFindMany: "alert-state-find-many",
    timelineCreateOne: "alert-state-timeline-create-one",
    noteCreateOne: "alert-internal-note-create-one",
  },
  createdState: ALERT_CREATED_STATE,
  acknowledgedState: ALERT_ACKNOWLEDGED_STATE,
  resolvedState: ALERT_RESOLVED_STATE,
  states: ALERT_STATES,
  severities: ALERT_SEVERITIES,
  mostSevereId: HIGH_ALERT_SEVERITY_ID,
  mostSevereName: "High",
  quietCreateFields: {},
  title: "Disk usage above 90% on db-1",
  noteText: "Cleared old WAL segments. Usage is back to 71%.",
  model: alertModel,
  note: (props?: {
    note?: string | undefined;
    isPrivate?: boolean | undefined;
  }): JSONObject => {
    return alertNoteModel({ note: props?.note, isPrivate: props?.isPrivate });
  },
};

const KINDS: Array<[string, SimulatedKind]> = [
  ["incident", INCIDENT],
  ["alert", ALERT],
];

/* ------------------------------ Running them ------------------------------ */

type RunFunction = (props: {
  templateId: string;
  trigger: JSONObject;
  dataverse?: FakeDataverse | undefined;
  database?: FakeDatabase | undefined;
  editCode?: Dictionary<(code: string) => string> | undefined;
}) => Promise<SimulationTrace>;

const run: RunFunction = async (props: {
  templateId: string;
  trigger: JSONObject;
  dataverse?: FakeDataverse | undefined;
  database?: FakeDatabase | undefined;
  editCode?: Dictionary<(code: string) => string> | undefined;
}): Promise<SimulationTrace> => {
  const dataverse: FakeDataverse = props.dataverse || new FakeDataverse();

  return await runTemplate({
    templateId: props.templateId,
    trigger: props.trigger,
    variables: variablesFor(props.templateId),
    http: dataverse.handle,
    database: props.database,
    editCode: props.editCode,
  });
};

type WebhookFunction = (body: JSONValue) => JSONObject;

/** What the Webhook trigger hands over for one delivery. */
const delivery: WebhookFunction = (body: JSONValue): JSONObject => {
  return {
    "request-body": body,
    "request-headers": {
      "content-type": "application/json",
      "x-oneuptime-secret": "a1b2c3d4-webhook-delivery-sentinel",
    },
    "request-params": {},
  };
};

type LastLogFunction = (trace: SimulationTrace) => string;

const lastLog: LastLogFunction = (trace: SimulationTrace): string => {
  return trace.logs[trace.logs.length - 1] || "";
};

type RequestLineFunction = (request: SimulatedRequest) => string;

const line: RequestLineFunction = (request: SimulatedRequest): string => {
  return `${request.method} ${request.url.replace(DYNAMICS_API, "")}`;
};

const searchUrl: (link: string) => string = (link: string): string => {
  return `GET /incidents?$select=incidentid,ticketnumber,title,statecode,statuscode&$filter=${LINK_COLUMN}%20eq%20'${link}'&$top=2`;
};

beforeAll(() => {
  stubDnsLookups("20.42.73.25");
});

afterAll(() => {
  jest.restoreAllMocks();
});

test("the variables a run has are the rows the wizard writes, and no others", () => {
  const variables: Dictionary<string> = variablesFor(
    INCIDENT.templates.createCase,
  );

  expect(Object.keys(variables).sort()).toEqual(
    [
      "dynamicsAccessToken",
      "dynamicsCustomer",
      "dynamicsLinkColumn",
      "dynamicsUrl",
      "oneuptimeUrl",
    ].sort(),
  );
  expect(variables["dynamicsAccessToken"]).toBe(ACCESS_TOKEN);
  expect(Object.values(variables)).not.toContain(CLIENT_SECRET);

  const rows: Array<WorkflowVariable> = buildWorkflowVariables({
    template: getWorkflowTemplate(
      INCIDENT.templates.createCase,
    ) as WorkflowTemplate,
    values: TYPED_VALUES,
    workflowId: ObjectID.generate(),
    projectId: new ObjectID(PROJECT_ID),
  });
  const oauth: WorkflowVariable | undefined = rows.find(
    (row: WorkflowVariable) => {
      return row.name === "dynamicsAccessToken";
    },
  );

  expect(oauth?.oauthTokenUrl).toBe(
    `https://login.microsoftonline.com/${TENANT_ID}/oauth2/v2.0/token`,
  );
  expect(oauth?.oauthScope).toBe(`${DYNAMICS_URL}/.default`);
});

/* ------------------------ OneUptime -> Dynamics 365 ------------------------ */

describe.each(KINDS)(
  "%s: Create a Dynamics 365 case",
  (_name: string, kind: SimulatedKind) => {
    const database: FakeDatabase = {
      [kind.components.severityFindMany]: many(kind.severities),
    };

    test(`opens a case for a new ${kind.noun}, linked, with the customer and a priority`, async () => {
      const dataverse: FakeDataverse = new FakeDataverse();
      const trace: SimulationTrace = await run({
        templateId: kind.templates.createCase,
        trigger: { model: kind.model() },
        dataverse: dataverse,
        database: database,
      });

      expect(trace.requests.map(line)).toEqual([
        "POST /incidents?$select=incidentid,ticketnumber,title",
      ]);
      expect(trace.requests[0]?.headers).toEqual(
        expect.objectContaining({
          Authorization: `Bearer ${ACCESS_TOKEN}`,
          Prefer: "return=representation",
        }),
      );

      const opened: StoredCase = dataverse.caseOf(NEW_CASE_ID);

      expect(opened).toEqual(
        expect.objectContaining({
          title: `[OneUptime] ${kind.number}: ${kind.title}`,
          prioritycode: 1,
          customer: `/accounts(${ACCOUNT_ID})`,
          link: kind.link,
          statecode: 0,
          caseorigincode: 3,
          casetypecode: 2,
        }),
      );
      expect(opened.description).toContain(
        `Open it in OneUptime: ${ONEUPTIME_URL}/dashboard/${PROJECT_ID}/${kind.dashboardPath}/${kind.id}`,
      );
      expect(lastLog(trace)).toBe(
        `✅ Opened Dynamics 365 case ${NEW_CASE_NUMBER} for ${kind.number}, linked as ${kind.link}.`,
      );
    });

    test(`a private ${kind.noun} sends nothing`, async () => {
      const trace: SimulationTrace = await run({
        templateId: kind.templates.createCase,
        trigger: { model: kind.model({ isPrivate: true }) },
        database: database,
      });

      expect(trace.requests).toEqual([]);
      expect(lastLog(trace)).toBe(
        `ℹ️ ${kind.number} is a private ${kind.noun}, so no Dynamics 365 case was opened.`,
      );
    });

    test(`a ${kind.noun} that came from a case opens no second one`, async () => {
      const trace: SimulationTrace = await run({
        templateId: kind.templates.createCase,
        trigger: {
          model: kind.model({
            customFields: {
              dynamicsCaseId: CASE_ID,
              dynamicsCaseNumber: CASE_NUMBER,
            },
          }),
        },
        database: database,
      });

      expect(trace.requests).toEqual([]);
      expect(lastLog(trace)).toContain(`from Dynamics 365 case ${CASE_NUMBER}`);
    });

    test("Dataverse's refusal is logged in its own words", async () => {
      const dataverse: FakeDataverse = new FakeDataverse();
      dataverse.failures["POST incidents"] = {
        status: 403,
        body: {
          error: {
            code: "0x80072560",
            message: "The user is not a member of the organization.",
          },
        },
      };

      const trace: SimulationTrace = await run({
        templateId: kind.templates.createCase,
        trigger: { model: kind.model() },
        dataverse: dataverse,
        database: database,
      });

      expect(trace.ports["create-case-1"]).toBe("error");
      expect(lastLog(trace)).toMatch(
        /^❌ Dynamics 365 did not open the case: /,
      );
      expect(lastLog(trace)).toContain(
        "The user is not a member of the organization.",
      );
    });

    test("a project whose severities cannot be read opens no case", async () => {
      const trace: SimulationTrace = await run({
        templateId: kind.templates.createCase,
        trigger: { model: kind.model() },
        database: { [kind.components.severityFindMany]: DATABASE_FAILURE },
      });

      expect(trace.requests).toEqual([]);
      expect(lastLog(trace)).toBe(
        `❌ Could not read this project's ${kind.noun} severities, so no Dynamics 365 case was opened. The database error is in the run log above.`,
      );
    });

    test("a title longer than the Case table allows is cut, not refused", async () => {
      const dataverse: FakeDataverse = new FakeDataverse();
      const trace: SimulationTrace = await run({
        templateId: kind.templates.createCase,
        trigger: {
          model: kind.model({
            title: "x".repeat(500),
            description: "y".repeat(5000),
          }),
        },
        dataverse: dataverse,
        database: database,
      });

      expect(trace.ports["create-case-1"]).toBe("success");
      expect(dataverse.caseOf(NEW_CASE_ID).title).toHaveLength(200);
    });
  },
);

describe.each(KINDS)(
  "%s: Resolve the Dynamics 365 case",
  (_name: string, kind: SimulatedKind) => {
    const linkedCase: () => FakeDataverse = (): FakeDataverse => {
      return new FakeDataverse({ cases: [{ link: kind.link }] });
    };

    test(`resolving the ${kind.noun} closes its case with CloseIncident, as Problem Solved`, async () => {
      const dataverse: FakeDataverse = linkedCase();
      const trace: SimulationTrace = await run({
        templateId: kind.templates.updateCase,
        trigger: { model: kind.model({ state: kind.resolvedState }) },
        dataverse: dataverse,
      });

      expect(trace.requests.map(line)).toEqual([
        searchUrl(kind.link),
        "POST /CloseIncident",
      ]);
      expect(trace.requests[1]?.body).toEqual({
        IncidentResolution: {
          subject: `${DYNAMICS_SYNCED_FROM_ONEUPTIME_MARKER}: ${kind.number} was resolved`,
          description: `${kind.number} is Resolved in OneUptime.`,
          "incidentid@odata.bind": `/incidents(${CASE_ID})`,
        },
        Status: 5,
      });
      expect(dataverse.caseOf(CASE_ID)).toEqual(
        expect.objectContaining({ statecode: 1, statuscode: 5 }),
      );
      expect(lastLog(trace)).toBe(
        `✅ Resolved Dynamics 365 case ${CASE_NUMBER}. ${kind.number} is Resolved in OneUptime.`,
      );
    });

    test("acknowledging looks the case up but changes nothing, unless a status is mapped", async () => {
      const dataverse: FakeDataverse = linkedCase();
      const trace: SimulationTrace = await run({
        templateId: kind.templates.updateCase,
        trigger: { model: kind.model({ state: kind.acknowledgedState }) },
        dataverse: dataverse,
      });

      expect(trace.requests.map(line)).toEqual([searchUrl(kind.link)]);
      expect(lastLog(trace)).toBe(
        `ℹ️ ${kind.number} moved to Acknowledged, which has no case status mapped to it.`,
      );
    });

    test("a mapped state moves the case with an If-Match PATCH", async () => {
      const dataverse: FakeDataverse = linkedCase();
      const trace: SimulationTrace = await run({
        templateId: kind.templates.updateCase,
        trigger: { model: kind.model({ state: kind.acknowledgedState }) },
        dataverse: dataverse,
        editCode: {
          "plan-case-1": (code: string): string => {
            return code.replace(
              "const STATE_TO_CASE_STATUS = {};",
              "const STATE_TO_CASE_STATUS = { Acknowledged: 4 };",
            );
          },
        },
      });

      expect(trace.requests.map(line)).toEqual([
        searchUrl(kind.link),
        `PATCH /incidents(${CASE_ID})`,
      ]);
      expect(trace.requests[1]?.headers["If-Match"]).toBe("*");
      expect(trace.requests[1]?.body).toEqual({ statecode: 0, statuscode: 4 });
      expect(dataverse.caseOf(CASE_ID).statuscode).toBe(4);
      expect(lastLog(trace)).toBe(
        `✅ Moved Dynamics 365 case ${CASE_NUMBER} to status 4. ${kind.number} is Acknowledged in OneUptime.`,
      );
    });

    test("a case already resolved in Dynamics 365 is left alone", async () => {
      const dataverse: FakeDataverse = new FakeDataverse({
        cases: [{ link: kind.link, statuscode: 1000 }],
      });
      const trace: SimulationTrace = await run({
        templateId: kind.templates.updateCase,
        trigger: { model: kind.model({ state: kind.resolvedState }) },
        dataverse: dataverse,
      });

      expect(trace.requests.map(line)).toEqual([searchUrl(kind.link)]);
      expect(lastLog(trace)).toBe(
        `ℹ️ Dynamics 365 case ${CASE_NUMBER} is already Resolved, so it was left as it is.`,
      );
      expect(dataverse.resolutions).toEqual([]);
    });

    test(`a ${kind.noun} with no case is left alone`, async () => {
      const trace: SimulationTrace = await run({
        templateId: kind.templates.updateCase,
        trigger: { model: kind.model({ state: kind.resolvedState }) },
      });

      expect(trace.requests.map(line)).toEqual([searchUrl(kind.link)]);
      expect(lastLog(trace)).toBe(
        `ℹ️ No Dynamics 365 case holds the link ${kind.link}, or the Dynamics 365 credentials cannot see it.`,
      );
    });

    test("a link column Dataverse does not have is reported, with its answer", async () => {
      const dataverse: FakeDataverse = linkedCase();
      dataverse.failures["GET incidents"] = {
        status: 400,
        body: {
          error: {
            code: "0x80060888",
            message:
              "Could not find a property named 'new_oneuptimelink' on type 'Microsoft.Dynamics.CRM.incident'.",
          },
        },
      };

      const trace: SimulationTrace = await run({
        templateId: kind.templates.updateCase,
        trigger: { model: kind.model({ state: kind.resolvedState }) },
        dataverse: dataverse,
      });

      expect(trace.ports["find-case-1"]).toBe("error");
      expect(lastLog(trace)).toContain(
        `❌ Could not look up the ${kind.noun}'s Dynamics 365 case`,
      );
      expect(lastLog(trace)).toContain("Could not find a property named");
    });

    test("Dataverse's refusal to close the case is logged", async () => {
      const dataverse: FakeDataverse = linkedCase();
      dataverse.failures["POST CloseIncident"] = {
        status: 404,
        body: {
          error: {
            code: "0x80060888",
            message: "Resource not found for the segment 'CloseIncident'.",
          },
        },
      };

      const trace: SimulationTrace = await run({
        templateId: kind.templates.updateCase,
        trigger: { model: kind.model({ state: kind.resolvedState }) },
        dataverse: dataverse,
      });

      expect(lastLog(trace)).toMatch(
        /^❌ Dynamics 365 did not resolve the case: /,
      );
      expect(lastLog(trace)).toContain(
        "Resource not found for the segment 'CloseIncident'.",
      );
    });
  },
);

const NOTE_TEMPLATES: Array<[string, SimulatedKind, string, string]> = [
  [
    INCIDENT.templates.privateNote,
    INCIDENT,
    "private note",
    `${INCIDENT.noun}-internal-note-on-create`,
  ],
  [
    INCIDENT.templates.publicNote as string,
    INCIDENT,
    "public note",
    `${INCIDENT.noun}-public-note-on-create`,
  ],
  [
    ALERT.templates.privateNote,
    ALERT,
    "private note",
    `${ALERT.noun}-internal-note-on-create`,
  ],
];

describe.each(NOTE_TEMPLATES)(
  "%s",
  (templateId: string, kind: SimulatedKind, noteKind: string) => {
    test("adds the note to the linked case", async () => {
      const dataverse: FakeDataverse = new FakeDataverse({
        cases: [{ link: kind.link }],
      });
      const trace: SimulationTrace = await run({
        templateId: templateId,
        trigger: { model: kind.note() },
        dataverse: dataverse,
      });

      expect(trace.requests.map(line)).toEqual([
        searchUrl(kind.link),
        "POST /annotations",
      ]);
      expect(trace.requests[1]?.body).toEqual({
        subject: `${DYNAMICS_SYNCED_FROM_ONEUPTIME_MARKER}: ${noteKind} on ${kind.number} by Jane Doe`,
        notetext: kind.noteText,
        "objectid_incident@odata.bind": `/incidents(${CASE_ID})`,
      });
      expect(dataverse.notes.get(NEW_ANNOTATION_ID)?.caseId).toBe(CASE_ID);
      expect(lastLog(trace)).toBe(
        `✅ Added the note to Dynamics 365 case ${CASE_NUMBER}.`,
      );
    });

    test("a note with quotes, backslashes and line breaks arrives as it was written", async () => {
      const text: string = 'He said "it\'s down"\nC:\\logs\\api.log\ttab';
      const dataverse: FakeDataverse = new FakeDataverse({
        cases: [{ link: kind.link }],
      });
      const trace: SimulationTrace = await run({
        templateId: templateId,
        trigger: { model: kind.note({ note: text }) },
        dataverse: dataverse,
      });

      expect((trace.requests[1]?.body as JSONObject)["notetext"]).toBe(text);
    });

    test("a note that came from Dynamics 365 is not sent back", async () => {
      const dataverse: FakeDataverse = new FakeDataverse({
        cases: [{ link: kind.link }],
      });
      const trace: SimulationTrace = await run({
        templateId: templateId,
        trigger: {
          model: kind.note({
            note: `${ONEUPTIME_SYNCED_FROM_DYNAMICS_MARKER}: Sam Okafor added a note to case x.`,
          }),
        },
        dataverse: dataverse,
      });

      expect(trace.requests.map(line)).toEqual([searchUrl(kind.link)]);
      expect(lastLog(trace)).toBe(
        "ℹ️ This note came from Dynamics 365, so it was not posted back.",
      );
    });
  },
);

/* ------------------------ Dynamics 365 -> OneUptime ------------------------ */

describe.each(KINDS)(
  "%s: Create from a Dynamics 365 case",
  (_name: string, kind: SimulatedKind) => {
    const database: FakeDatabase = {
      [kind.components.severityFindMany]: many(kind.severities),
      [kind.components.createOne]: createdWithId(NEW_RECORD_ID),
    };

    test.each([
      ["a Dataverse webhook", webhookContext({ messageName: "Create" })],
      ["a Power Automate flow", flowBody({ sdkMessage: "Create" })],
      ["a flow with a body of its own", { incidentid: CASE_ID }],
    ])(
      `%s for a new case ${kind.created}s an ${kind.noun} and links the case to it`,
      async (_label: string, body: JSONObject) => {
        const dataverse: FakeDataverse = new FakeDataverse({ cases: [{}] });
        const trace: SimulationTrace = await run({
          templateId: kind.templates.createRecord,
          trigger: delivery(body),
          dataverse: dataverse,
          database: database,
        });

        expect(trace.requests.map(line)).toEqual([
          `GET /incidents(${CASE_ID})?$select=incidentid,ticketnumber,title,description,prioritycode,statecode,_customerid_value,${LINK_COLUMN}`,
          `PATCH /incidents(${CASE_ID})`,
        ]);
        expect(trace.requests[1]?.headers["If-Match"]).toBe("*");
        expect(trace.requests[1]?.body).toEqual({
          [LINK_COLUMN]: `${kind.link.replace(kind.id, NEW_RECORD_ID)}`,
        });

        const create: DatabaseCall | undefined = trace.databaseCalls.find(
          (call: DatabaseCall) => {
            return call.metadataId === kind.components.createOne;
          },
        );

        expect(create?.args["json"]).toEqual({
          [kind.severityIdColumn]: kind.mostSevereId,
          customFields: {
            dynamicsCaseId: CASE_ID,
            dynamicsCaseNumber: CASE_NUMBER,
          },
          ...kind.quietCreateFields,
          title: "Customers in the EU cannot complete checkout",
          description: [
            `${kind.Created} from Dynamics 365 case [${CASE_NUMBER}](${DYNAMICS_URL}/main.aspx?pagetype=entityrecord&etn=incident&id=${CASE_ID}).`,
            "Priority: High",
            "Customer: Contoso Pharmaceuticals",
            "",
            "Three customers called since 09:40 UTC.",
          ].join("\n"),
        });
        expect(dataverse.caseOf(CASE_ID).link).toBe(
          `${kind.link.replace(kind.id, NEW_RECORD_ID)}`,
        );
        expect(lastLog(trace)).toBe(
          `✅ ${kind.Created} an ${kind.noun} with severity ${kind.mostSevereName} for Dynamics 365 case ${CASE_NUMBER}, and linked the case to it.`,
        );
      },
    );

    test("an edit to a case is ignored before anything is read", async () => {
      const trace: SimulationTrace = await run({
        templateId: kind.templates.createRecord,
        trigger: delivery(webhookContext({ messageName: "Update" })),
        database: database,
      });

      expect(trace.requests).toEqual([]);
      expect(trace.databaseCalls).toEqual([]);
      expect(lastLog(trace)).toBe(
        "ℹ️ Ignored the Update event: this workflow only handles Create.",
      );
    });

    test("a case that is already linked is read, and left alone", async () => {
      const dataverse: FakeDataverse = new FakeDataverse({
        cases: [{ link: kind.otherKindLink }],
      });
      const trace: SimulationTrace = await run({
        templateId: kind.templates.createRecord,
        trigger: delivery(webhookContext({ messageName: "Create" })),
        dataverse: dataverse,
        database: database,
      });

      expect(trace.requests.map(line)).toHaveLength(1);
      expect(
        trace.databaseCalls.map((call: DatabaseCall): string => {
          return call.metadataId;
        }),
      ).toEqual([kind.components.severityFindMany]);
      expect(lastLog(trace)).toBe(
        `ℹ️ Dynamics 365 case ${CASE_NUMBER} is already linked to OneUptime (${kind.otherKindLink}), so no ${kind.noun} was ${kind.created}.`,
      );
    });

    test("a case Dynamics 365 does not have is reported, with its answer", async () => {
      const trace: SimulationTrace = await run({
        templateId: kind.templates.createRecord,
        trigger: delivery(webhookContext({ messageName: "Create" })),
        database: database,
      });

      expect(trace.ports["get-case-1"]).toBe("error");
      expect(lastLog(trace)).toContain(
        `❌ Could not read Dynamics 365 case ${CASE_ID}, so no ${kind.noun} was ${kind.created}`,
      );
      expect(lastLog(trace)).toContain("Does Not Exist");
      expect(trace.databaseCalls).toEqual([]);
    });

    test("a record whose case then refuses the link says so, and stays", async () => {
      const dataverse: FakeDataverse = new FakeDataverse({ cases: [{}] });
      dataverse.failures[`PATCH incidents(${CASE_ID})`] = {
        status: 403,
        body: {
          error: {
            code: "0x80040220",
            message: "Principal user is missing prvWriteIncident privilege.",
          },
        },
      };

      const trace: SimulationTrace = await run({
        templateId: kind.templates.createRecord,
        trigger: delivery(webhookContext({ messageName: "Create" })),
        dataverse: dataverse,
        database: database,
      });

      expect(lastLog(trace)).toMatch(
        new RegExp(
          `^⚠️ The ${kind.noun} was ${kind.created}, but Dynamics 365 did not accept the link`,
        ),
      );
      expect(lastLog(trace)).toContain("prvWriteIncident");
    });
  },
);

describe.each(KINDS)(
  "%s: Resolve when the Dynamics 365 case is resolved",
  (_name: string, kind: SimulatedKind) => {
    const database: FakeDatabase = {
      [kind.components.findOne]: found(
        kind.model({ state: kind.createdState }),
      ),
      [kind.components.stateFindMany]: many(kind.states),
      [kind.components.timelineCreateOne]: createdWithId(NEW_TIMELINE_ID),
    };

    test.each([
      ["resolving it (Close)", webhookContext({ messageName: "Close" })],
      ["an Update of its status", webhookContext({ messageName: "Update" })],
      ["a Power Automate flow", flowBody({ sdkMessage: "Update" })],
    ])(
      `%s resolves the linked ${kind.noun}`,
      async (_label: string, body: JSONObject) => {
        const dataverse: FakeDataverse = new FakeDataverse({
          cases: [{ link: kind.link, statuscode: 5 }],
        });
        const trace: SimulationTrace = await run({
          templateId: kind.templates.statusToState,
          trigger: delivery(body),
          dataverse: dataverse,
          database: database,
        });

        expect(trace.requests.map(line)).toEqual([
          `GET /incidents(${CASE_ID})?$select=incidentid,ticketnumber,statecode,statuscode,_modifiedby_value,${LINK_COLUMN}`,
        ]);

        const timeline: DatabaseCall | undefined = trace.databaseCalls.find(
          (call: DatabaseCall) => {
            return call.metadataId === kind.components.timelineCreateOne;
          },
        );

        expect(timeline?.args["json"]).toEqual({
          [kind.idColumn]: kind.id,
          [kind.timelineStateColumn]: kind.resolvedState["_id"],
          rootCause: `${ONEUPTIME_SYNCED_FROM_DYNAMICS_MARKER}: case ${CASE_NUMBER} is Problem Solved, changed by Priya Patel.`,
        });
        expect(lastLog(trace)).toBe(
          `✅ Moved ${kind.number} to Resolved because Dynamics 365 case ${CASE_NUMBER} is Problem Solved.`,
        );
      },
    );

    test("a case that is still active changes nothing", async () => {
      const dataverse: FakeDataverse = new FakeDataverse({
        cases: [{ link: kind.link, statuscode: 2 }],
      });
      const trace: SimulationTrace = await run({
        templateId: kind.templates.statusToState,
        trigger: delivery(webhookContext({ messageName: "Update" })),
        dataverse: dataverse,
        database: database,
      });

      expect(
        trace.databaseCalls.map((call: DatabaseCall): string => {
          return call.metadataId;
        }),
      ).toEqual([kind.components.findOne, kind.components.stateFindMany]);
      expect(lastLog(trace)).toBe(
        `ℹ️ Dynamics 365 case ${CASE_NUMBER} is On Hold, which does not map to a OneUptime state.`,
      );
    });

    test("a case that is not linked is left alone, and nothing is looked up", async () => {
      const dataverse: FakeDataverse = new FakeDataverse({
        cases: [{ link: kind.otherKindLink, statuscode: 5 }],
      });
      const trace: SimulationTrace = await run({
        templateId: kind.templates.statusToState,
        trigger: delivery(webhookContext({ messageName: "Close" })),
        dataverse: dataverse,
        database: database,
      });

      expect(trace.databaseCalls).toEqual([]);
      expect(lastLog(trace)).toBe(
        `ℹ️ Dynamics 365 case ${CASE_NUMBER} is not linked to an ${kind.noun}: its ${LINK_COLUMN} column does not hold ${kind.link.replace(kind.id, "")}<id>.`,
      );
    });

    test(`an ${kind.noun} already resolved is not moved again`, async () => {
      const dataverse: FakeDataverse = new FakeDataverse({
        cases: [{ link: kind.link, statuscode: 5 }],
      });
      const trace: SimulationTrace = await run({
        templateId: kind.templates.statusToState,
        trigger: delivery(webhookContext({ messageName: "Close" })),
        dataverse: dataverse,
        database: {
          ...database,
          [kind.components.findOne]: found(
            kind.model({ state: kind.resolvedState }),
          ),
        },
      });

      expect(
        trace.databaseCalls.some((call: DatabaseCall): boolean => {
          return call.metadataId === kind.components.timelineCreateOne;
        }),
      ).toBe(false);
      expect(lastLog(trace)).toBe(
        `ℹ️ ${kind.number} is already Resolved, so Dynamics 365 case ${CASE_NUMBER} being Problem Solved changes nothing.`,
      );
    });
  },
);

describe.each(KINDS)(
  "%s: Add Dynamics 365 case notes",
  (_name: string, kind: SimulatedKind) => {
    const database: FakeDatabase = {
      [kind.components.findOne]: found(kind.model()),
      [kind.components.noteCreateOne]: createdWithId(NEW_NOTE_ROW_ID),
    };

    const noteWebhook: JSONObject = webhookContext({
      messageName: "Create",
      table: "annotation",
      rowId: NOTE_ID,
    });

    test(`copies an agent's note on the linked case onto the ${kind.noun}`, async () => {
      const dataverse: FakeDataverse = new FakeDataverse({
        cases: [{ link: kind.link }],
        notes: [{}],
      });
      const trace: SimulationTrace = await run({
        templateId: kind.templates.caseNoteToNote,
        trigger: delivery(noteWebhook),
        dataverse: dataverse,
        database: database,
      });

      expect(trace.requests.map(line)).toEqual([
        `GET /annotations(${NOTE_ID})?$select=annotationid,subject,notetext,isdocument,filename,objecttypecode,_createdby_value&$expand=objectid_incident($select=incidentid,ticketnumber,${LINK_COLUMN})`,
      ]);

      const created: DatabaseCall | undefined = trace.databaseCalls.find(
        (call: DatabaseCall) => {
          return call.metadataId === kind.components.noteCreateOne;
        },
      );

      expect(created?.args["json"]).toEqual({
        [kind.idColumn]: kind.id,
        note: [
          `${ONEUPTIME_SYNCED_FROM_DYNAMICS_MARKER}: Sam Okafor added a note to case [${CASE_NUMBER}](${DYNAMICS_URL}/main.aspx?pagetype=entityrecord&etn=incident&id=${CASE_ID}).`,
          "",
          "Called the customer",
          "",
          "They still see the error at checkout.",
        ].join("\n"),
      });
      expect(lastLog(trace)).toBe(
        `✅ Added the note on Dynamics 365 case ${CASE_NUMBER} to ${kind.number} as a private note.`,
      );
    });

    test("a note on an account's row is left alone", async () => {
      const dataverse: FakeDataverse = new FakeDataverse({
        cases: [{ link: kind.link }],
        notes: [{ objecttypecode: "account", caseId: null }],
      });
      const trace: SimulationTrace = await run({
        templateId: kind.templates.caseNoteToNote,
        trigger: delivery(noteWebhook),
        dataverse: dataverse,
        database: database,
      });

      expect(trace.databaseCalls).toEqual([]);
      expect(lastLog(trace)).toBe(
        "ℹ️ The note belongs to the account table, not to a case, so it was not copied.",
      );
    });

    test(`a case that names an ${kind.noun} this project does not have is reported`, async () => {
      const dataverse: FakeDataverse = new FakeDataverse({
        cases: [{ link: kind.link }],
        notes: [{}],
      });
      const trace: SimulationTrace = await run({
        templateId: kind.templates.caseNoteToNote,
        trigger: delivery(noteWebhook),
        dataverse: dataverse,
        database: { ...database, [kind.components.findOne]: found(null) },
      });

      expect(
        trace.databaseCalls.some((call: DatabaseCall): boolean => {
          return call.metadataId === kind.components.noteCreateOne;
        }),
      ).toBe(false);
      expect(lastLog(trace)).toBe(
        `ℹ️ Dynamics 365 case ${CASE_NUMBER} names ${kind.noun} ${kind.id}, which is not in this project.`,
      );
    });
  },
);

/* ------------------------------ Echoes settle ------------------------------ */

describe.each(KINDS)(
  "%s: the two directions settle",
  (_name: string, kind: SimulatedKind) => {
    test("the case OneUptime opens comes back as a Create, and is left alone", async () => {
      const dataverse: FakeDataverse = new FakeDataverse();

      await run({
        templateId: kind.templates.createCase,
        trigger: { model: kind.model() },
        dataverse: dataverse,
        database: { [kind.components.severityFindMany]: many(kind.severities) },
      });

      const echo: SimulationTrace = await run({
        templateId: kind.templates.createRecord,
        trigger: delivery(
          webhookContext({ messageName: "Create", rowId: NEW_CASE_ID }),
        ),
        dataverse: dataverse,
        database: {
          [kind.components.severityFindMany]: many(kind.severities),
          [kind.components.createOne]: createdWithId(NEW_RECORD_ID),
        },
      });

      expect(
        echo.databaseCalls.some((call: DatabaseCall): boolean => {
          return call.metadataId === kind.components.createOne;
        }),
      ).toBe(false);
      expect(lastLog(echo)).toBe(
        `ℹ️ Dynamics 365 case ${NEW_CASE_NUMBER} is already linked to OneUptime (${kind.link}), so no ${kind.noun} was ${kind.created}.`,
      );
    });

    test(`the ${kind.noun} a case becomes opens no case of its own`, async () => {
      const dataverse: FakeDataverse = new FakeDataverse({ cases: [{}] });
      const created: SimulationTrace = await run({
        templateId: kind.templates.createRecord,
        trigger: delivery(webhookContext({ messageName: "Create" })),
        dataverse: dataverse,
        database: {
          [kind.components.severityFindMany]: many(kind.severities),
          [kind.components.createOne]: createdWithId(NEW_RECORD_ID),
        },
      });
      const json: JSONObject = created.databaseCalls.find(
        (call: DatabaseCall) => {
          return call.metadataId === kind.components.createOne;
        },
      )?.args["json"] as JSONObject;

      const echo: SimulationTrace = await run({
        templateId: kind.templates.createCase,
        trigger: {
          model: kind.model({
            _id: NEW_RECORD_ID,
            customFields: json["customFields"] as JSONObject,
          }),
        },
        dataverse: dataverse,
        database: { [kind.components.severityFindMany]: many(kind.severities) },
      });

      expect(echo.requests).toEqual([]);
      expect(lastLog(echo)).toBe(
        `ℹ️ ${kind.number} was ${kind.created} from Dynamics 365 case ${CASE_NUMBER}, so no new case was opened.`,
      );
    });

    test("a note OneUptime writes on the case comes back, and is not copied back", async () => {
      const dataverse: FakeDataverse = new FakeDataverse({
        cases: [{ link: kind.link }],
      });

      await run({
        templateId: kind.templates.privateNote,
        trigger: { model: kind.note() },
        dataverse: dataverse,
      });

      const echo: SimulationTrace = await run({
        templateId: kind.templates.caseNoteToNote,
        trigger: delivery(
          webhookContext({
            messageName: "Create",
            table: "annotation",
            rowId: NEW_ANNOTATION_ID,
          }),
        ),
        dataverse: dataverse,
        database: {
          [kind.components.findOne]: found(kind.model()),
          [kind.components.noteCreateOne]: createdWithId(NEW_NOTE_ROW_ID),
        },
      });

      expect(echo.databaseCalls).toEqual([]);
      expect(lastLog(echo)).toBe(
        "ℹ️ This note was written by OneUptime, so it was not copied back.",
      );
    });

    test("a note an agent writes comes back as a OneUptime note, and is not posted back", async () => {
      const dataverse: FakeDataverse = new FakeDataverse({
        cases: [{ link: kind.link }],
        notes: [{}],
      });
      const copied: SimulationTrace = await run({
        templateId: kind.templates.caseNoteToNote,
        trigger: delivery(
          webhookContext({
            messageName: "Create",
            table: "annotation",
            rowId: NOTE_ID,
          }),
        ),
        dataverse: dataverse,
        database: {
          [kind.components.findOne]: found(kind.model()),
          [kind.components.noteCreateOne]: createdWithId(NEW_NOTE_ROW_ID),
        },
      });
      const written: string = (
        copied.databaseCalls.find((call: DatabaseCall) => {
          return call.metadataId === kind.components.noteCreateOne;
        })?.args["json"] as JSONObject
      )["note"] as string;

      const echo: SimulationTrace = await run({
        templateId: kind.templates.privateNote,
        trigger: { model: kind.note({ note: written }) },
        dataverse: dataverse,
      });

      expect(echo.requests.map(line)).toEqual([searchUrl(kind.link)]);
      expect(lastLog(echo)).toBe(
        "ℹ️ This note came from Dynamics 365, so it was not posted back.",
      );
    });

    test(`resolving the ${kind.noun} closes the case, and the case's Close then changes nothing`, async () => {
      const dataverse: FakeDataverse = new FakeDataverse({
        cases: [{ link: kind.link }],
      });

      await run({
        templateId: kind.templates.updateCase,
        trigger: { model: kind.model({ state: kind.resolvedState }) },
        dataverse: dataverse,
      });

      expect(dataverse.caseOf(CASE_ID).statecode).toBe(1);

      const echo: SimulationTrace = await run({
        templateId: kind.templates.statusToState,
        trigger: delivery(webhookContext({ messageName: "Close" })),
        dataverse: dataverse,
        database: {
          [kind.components.findOne]: found(
            kind.model({ state: kind.resolvedState }),
          ),
          [kind.components.stateFindMany]: many(kind.states),
          [kind.components.timelineCreateOne]: createdWithId(NEW_TIMELINE_ID),
        },
      });

      expect(
        echo.databaseCalls.some((call: DatabaseCall): boolean => {
          return call.metadataId === kind.components.timelineCreateOne;
        }),
      ).toBe(false);
      expect(lastLog(echo)).toMatch(/^ℹ️ .* is already Resolved/);
    });

    test(`resolving the case resolves the ${kind.noun}, and the ${kind.noun}'s update then changes nothing`, async () => {
      const dataverse: FakeDataverse = new FakeDataverse({
        cases: [{ link: kind.link, statuscode: 5 }],
      });

      const resolved: SimulationTrace = await run({
        templateId: kind.templates.statusToState,
        trigger: delivery(webhookContext({ messageName: "Close" })),
        dataverse: dataverse,
        database: {
          [kind.components.findOne]: found(
            kind.model({ state: kind.createdState }),
          ),
          [kind.components.stateFindMany]: many(kind.states),
          [kind.components.timelineCreateOne]: createdWithId(NEW_TIMELINE_ID),
        },
      });

      expect(lastLog(resolved)).toMatch(/^✅ Moved /);

      const echo: SimulationTrace = await run({
        templateId: kind.templates.updateCase,
        trigger: { model: kind.model({ state: kind.resolvedState }) },
        dataverse: dataverse,
      });

      expect(echo.requests.map(line)).toEqual([searchUrl(kind.link)]);
      expect(dataverse.resolutions).toEqual([]);
      expect(lastLog(echo)).toBe(
        `ℹ️ Dynamics 365 case ${CASE_NUMBER} is already Resolved, so it was left as it is.`,
      );
    });
  },
);

/* ------------------------------ What never leaks ------------------------------ */

describe("secrets stay where they belong", () => {
  type EverythingSaidFunction = (trace: SimulationTrace) => string;

  /*
   * Every word the run wrote anywhere but a request's headers: its logs, what
   * it sent, what it wrote to the database, and what every step returned —
   * except the trigger, whose output is the delivery itself, headers and all.
   */
  const everythingSaid: EverythingSaidFunction = (
    trace: SimulationTrace,
  ): string => {
    const components: Dictionary<{ returnValues: JSONObject }> = {
      ...trace.storage.local.components,
    };
    delete components["webhook-1"];

    return JSON.stringify({
      logs: trace.logs,
      runLog: trace.runLog,
      urls: trace.requests.map((request: SimulatedRequest) => {
        return request.url;
      }),
      bodies: trace.requests.map((request: SimulatedRequest) => {
        return request.body;
      }),
      databaseCalls: trace.databaseCalls,
      components: components,
    });
  };

  test.each(KINDS)(
    "%s: the access token only ever travels in an Authorization header",
    async (_name: string, kind: SimulatedKind) => {
      const dataverse: FakeDataverse = new FakeDataverse({
        cases: [{ link: kind.link }],
        notes: [{}],
      });
      const traces: Array<SimulationTrace> = [
        await run({
          templateId: kind.templates.createCase,
          trigger: { model: kind.model() },
          dataverse: dataverse,
          database: {
            [kind.components.severityFindMany]: many(kind.severities),
          },
        }),
        await run({
          templateId: kind.templates.updateCase,
          trigger: { model: kind.model({ state: kind.resolvedState }) },
          dataverse: dataverse,
        }),
        await run({
          templateId: kind.templates.privateNote,
          trigger: { model: kind.note() },
          dataverse: new FakeDataverse({ cases: [{ link: kind.link }] }),
        }),
        await run({
          templateId: kind.templates.caseNoteToNote,
          trigger: delivery(
            webhookContext({
              messageName: "Create",
              table: "annotation",
              rowId: NOTE_ID,
            }),
          ),
          dataverse: dataverse,
          database: {
            [kind.components.findOne]: found(kind.model()),
            [kind.components.noteCreateOne]: createdWithId(NEW_NOTE_ROW_ID),
          },
        }),
      ];

      for (const trace of traces) {
        expect(trace.requests.length).toBeGreaterThan(0);
        expect(everythingSaid(trace)).not.toContain(ACCESS_TOKEN);

        for (const request of trace.requests) {
          expect(request.headers["Authorization"]).toBe(
            `Bearer ${ACCESS_TOKEN}`,
          );
        }
      }
    },
  );

  test.each(KINDS)(
    "%s: a case that names the token in its title gets nothing but its own words back",
    async (_name: string, kind: SimulatedKind) => {
      const dataverse: FakeDataverse = new FakeDataverse({
        cases: [
          {
            title: "{{local.variables.dynamicsAccessToken}}",
            description:
              "{{local.variables.dynamicsAccessToken}} {{local.components.webhook-1.returnValues.request-headers}}",
            customerName: "{{local.variables.dynamicsAccessToken}}",
          },
        ],
      });
      const trace: SimulationTrace = await run({
        templateId: kind.templates.createRecord,
        trigger: delivery(webhookContext({ messageName: "Create" })),
        dataverse: dataverse,
        database: {
          [kind.components.severityFindMany]: many(kind.severities),
          [kind.components.createOne]: createdWithId(NEW_RECORD_ID),
        },
      });

      expect(everythingSaid(trace)).not.toContain(ACCESS_TOKEN);
      expect(everythingSaid(trace)).not.toContain(
        "a1b2c3d4-webhook-delivery-sentinel",
      );
      expect(lastLog(trace)).toMatch(/^✅ /);
    },
  );

  test("the client secret, tenant and client ID are never in a run at all", async () => {
    for (const [, kind] of KINDS) {
      for (const templateId of Object.values(kind.templates)) {
        if (!templateId) {
          continue;
        }

        const values: Array<string> = Object.values(variablesFor(templateId));

        expect(values).not.toContain(CLIENT_SECRET);
        expect(values).not.toContain(TENANT_ID);
        expect(values).not.toContain(CLIENT_ID);
      }
    }
  });
});

/* ------------------------------ The kinds side by side ------------------------------ */

describe("a case linked to one kind is never taken for the other", () => {
  test("an incident's case resolving moves no alert, and an alert's no incident", async () => {
    for (const [own, other] of [
      [INCIDENT, ALERT],
      [ALERT, INCIDENT],
    ] as Array<[SimulatedKind, SimulatedKind]>) {
      const dataverse: FakeDataverse = new FakeDataverse({
        cases: [{ link: other.link, statuscode: 5 }],
      });
      const trace: SimulationTrace = await run({
        templateId: own.templates.statusToState,
        trigger: delivery(webhookContext({ messageName: "Close" })),
        dataverse: dataverse,
        database: {},
      });

      expect(trace.databaseCalls).toEqual([]);
      expect(lastLog(trace)).toContain(`is not linked to an ${own.noun}`);
    }
  });

  test("neither kind's create template takes a case the other already holds", async () => {
    for (const [own, other] of [
      [INCIDENT, ALERT],
      [ALERT, INCIDENT],
    ] as Array<[SimulatedKind, SimulatedKind]>) {
      const dataverse: FakeDataverse = new FakeDataverse({
        cases: [{ link: other.link }],
      });
      const answers: Dictionary<DatabaseAnswer> = {
        [own.components.severityFindMany]: many(own.severities),
        [own.components.createOne]: (call: DatabaseCall): DatabaseReply => {
          throw new Error(
            `Nothing should be created: ${JSON.stringify(call.args)}`,
          );
        },
      };
      const trace: SimulationTrace = await run({
        templateId: own.templates.createRecord,
        trigger: delivery(webhookContext({ messageName: "Create" })),
        dataverse: dataverse,
        database: answers,
      });

      expect(lastLog(trace)).toContain("is already linked to OneUptime");
      expect(dataverse.caseOf(CASE_ID).link).toBe(other.link);
    }
  });
});

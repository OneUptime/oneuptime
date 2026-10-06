/*
 * Shared fixtures for the Dynamics 365 template tests.
 *
 * The Dataverse shapes follow Microsoft's Web API reference and the sample
 * webhook request in "Use webhooks to create external handlers for server
 * events", trimmed to the columns the templates touch. The details that
 * matter more than they look are kept:
 *
 *   - A choice or a lookup comes back as its value, and — because every read
 *     the templates make asks for it with Prefer
 *     odata.include-annotations — its display text beside it, under
 *     "<column>@OData.Community.Display.V1.FormattedValue".
 *   - A lookup's value is its own property, "_<column>_value".
 *   - A query answers { value: [...] }; one row answers the row itself, with
 *     @odata.context and @odata.etag beside its columns.
 *   - A Dataverse webhook does not post the row. It posts the plug-in
 *     execution context: MessageName, PrimaryEntityName, PrimaryEntityId,
 *     and InputParameters as a list of { key, value } pairs, the changed
 *     columns inside Target's own Attributes list. The Close message that
 *     resolving a case raises carries no Target at all; the case is named
 *     inside its IncidentResolution parameter, and PrimaryEntityId is the
 *     empty id.
 *   - A Power Automate flow posts whatever its HTTP action's body says. The
 *     Dataverse trigger's own output, which a flow can pass on whole, has the
 *     row's columns and SdkMessage.
 *
 * The OneUptime records come from JiraTemplateFixtures: they are the shapes
 * BaseModel.toJSON produces for a database trigger, whichever system the
 * template talks to.
 *
 * Not a test file itself (jest only collects *.test.ts), so the scripts,
 * contract and simulation suites can share it.
 */

import VMRunner from "../../../Server/Utils/VM/VMRunner";
import ReturnResult from "../../../Types/IsolatedVM/ReturnResult";
import { JSONObject, JSONValue } from "../../../Types/JSON";
import { scriptOf } from "./JiraTemplateFixtures";

export const DYNAMICS_URL: string = "https://acme.crm.dynamics.com";
export const DYNAMICS_API: string = `${DYNAMICS_URL}/api/data/v9.2`;
export const LINK_COLUMN: string = "new_oneuptimelink";

export const CASE_ID: string = "a1b2c3d4-5e6f-4a7b-8c9d-0e1f2a3b4c5d";
export const OTHER_CASE_ID: string = "b2c3d4e5-6f7a-4b8c-9d0e-1f2a3b4c5d6e";
export const CASE_NUMBER: string = "CAS-01001-X1Y2Z3";
export const OTHER_CASE_NUMBER: string = "CAS-01002-K4L5M6";
export const NOTE_ID: string = "c3d4e5f6-7a8b-4c9d-8e0f-2a3b4c5d6e7f";
export const ACCOUNT_ID: string = "4f7e6c3a-1b2d-4e5f-8a9b-0c1d2e3f4a5b";
export const CONTACT_ID: string = "6a5b4c3d-2e1f-4a0b-9c8d-7e6f5a4b3c2d";
export const EMPTY_ID: string = "00000000-0000-0000-0000-000000000000";

const FORMATTED: string = "@OData.Community.Display.V1.FormattedValue";

export type FormattedKeyFunction = (column: string) => string;

/** The key a column's display text comes back under. */
export const formattedKey: FormattedKeyFunction = (column: string): string => {
  return `${column}${FORMATTED}`;
};

/* ------------------------- The Case table's choices ------------------------- */

export enum CaseState {
  Active = 0,
  Resolved = 1,
  Cancelled = 2,
}

export const CASE_STATE_NAMES: Record<number, string> = {
  [CaseState.Active]: "Active",
  [CaseState.Resolved]: "Resolved",
  [CaseState.Cancelled]: "Cancelled",
};

/** The statuses Dynamics 365 ships with, and the state each belongs to. */
export const CASE_STATUSES: Record<number, { name: string; state: CaseState }> =
  {
    1: { name: "In Progress", state: CaseState.Active },
    2: { name: "On Hold", state: CaseState.Active },
    3: { name: "Waiting for Details", state: CaseState.Active },
    4: { name: "Researching", state: CaseState.Active },
    5: { name: "Problem Solved", state: CaseState.Resolved },
    1000: { name: "Information Provided", state: CaseState.Resolved },
    6: { name: "Cancelled", state: CaseState.Cancelled },
    2000: { name: "Merged", state: CaseState.Cancelled },
  };

export const PRIORITY_NAMES: Record<number, string> = {
  1: "High",
  2: "Normal",
  3: "Low",
};

/* --------------------------------- Rows --------------------------------- */

export interface CaseRowProps {
  incidentid?: string | undefined;
  ticketnumber?: string | null | undefined;
  title?: string | null | undefined;
  description?: string | null | undefined;
  prioritycode?: number | null | undefined;
  statuscode?: number | undefined;
  /** What the link column holds. null is a column nobody filled in. */
  link?: string | null | undefined;
  linkColumn?: string | undefined;
  customerName?: string | undefined;
  modifiedBy?: string | undefined;
  /** Leave the display text off every choice and lookup, as a read without the Prefer header gets. */
  withoutFormattedValues?: boolean | undefined;
}

export type CaseRowFunction = (props?: CaseRowProps) => JSONObject;

/**
 * A case as GET /incidents(<id>) answers it, with the display text of every
 * choice and lookup beside its value.
 */
export const caseRow: CaseRowFunction = (props?: CaseRowProps): JSONObject => {
  const id: string = props?.incidentid || CASE_ID;
  const statuscode: number =
    props?.statuscode === undefined ? 1 : props.statuscode;
  const status: { name: string; state: CaseState } = CASE_STATUSES[
    statuscode
  ] || { name: `Status ${statuscode}`, state: CaseState.Active };
  const prioritycode: number | null =
    props?.prioritycode === undefined ? 1 : props.prioritycode;

  const row: JSONObject = {
    "@odata.context": `${DYNAMICS_API}/$metadata#incidents(incidentid,ticketnumber,title,description,prioritycode,statecode,statuscode,_customerid_value,_modifiedby_value,${props?.linkColumn || LINK_COLUMN})/$entity`,
    "@odata.etag": 'W/"4410925"',
    incidentid: id,
    ticketnumber:
      props?.ticketnumber === undefined ? CASE_NUMBER : props.ticketnumber,
    title:
      props?.title === undefined
        ? "Customers in the EU cannot complete checkout"
        : props.title,
    description:
      props?.description === undefined
        ? "Three customers called since 09:40 UTC.\nThey see an error after entering card details."
        : props.description,
    prioritycode: prioritycode,
    statecode: status.state,
    statuscode: statuscode,
    _customerid_value: ACCOUNT_ID,
    _modifiedby_value: "e64e2827-e822-e711-a815-000d3a17ea56",
    [props?.linkColumn || LINK_COLUMN]:
      props?.link === undefined ? null : props.link,
  };

  if (!props?.withoutFormattedValues) {
    if (prioritycode !== null) {
      row[formattedKey("prioritycode")] =
        PRIORITY_NAMES[prioritycode] || String(prioritycode);
    }

    row[formattedKey("statecode")] = CASE_STATE_NAMES[status.state] as string;
    row[formattedKey("statuscode")] = status.name;
    row[formattedKey("_customerid_value")] =
      props?.customerName || "Contoso Pharmaceuticals";
    row[formattedKey("_modifiedby_value")] = props?.modifiedBy || "Priya Patel";
  }

  return row;
};

export interface CaseSearchRowProps {
  incidentid?: string | undefined;
  ticketnumber?: string | undefined;
  statuscode?: number | undefined;
}

export type CaseSearchRowFunction = (props?: CaseSearchRowProps) => JSONObject;

/** One row of the link search: incidentid, ticketnumber, title, statecode and statuscode. */
export const caseSearchRow: CaseSearchRowFunction = (
  props?: CaseSearchRowProps,
): JSONObject => {
  const statuscode: number =
    props?.statuscode === undefined ? 1 : props.statuscode;
  const status: { name: string; state: CaseState } = CASE_STATUSES[
    statuscode
  ] as { name: string; state: CaseState };

  return {
    "@odata.etag": 'W/"4410925"',
    incidentid: props?.incidentid || CASE_ID,
    ticketnumber: props?.ticketnumber || CASE_NUMBER,
    title: "[OneUptime] INC-42: Checkout latency high",
    statecode: status.state,
    [formattedKey("statecode")]: CASE_STATE_NAMES[status.state] as string,
    statuscode: statuscode,
    [formattedKey("statuscode")]: status.name,
  };
};

export type CaseSearchResponseFunction = (
  rows: Array<JSONObject>,
) => JSONObject;

/** What a query answers: its rows under value. */
export const caseSearchResponse: CaseSearchResponseFunction = (
  rows: Array<JSONObject>,
): JSONObject => {
  return {
    "@odata.context": `${DYNAMICS_API}/$metadata#incidents(incidentid,ticketnumber,title,statecode,statuscode)`,
    value: rows,
  };
};

export const EMPTY_CASE_SEARCH: JSONObject = caseSearchResponse([]);

export interface NoteRowProps {
  annotationid?: string | undefined;
  subject?: string | null | undefined;
  notetext?: string | null | undefined;
  isdocument?: boolean | undefined;
  filename?: string | null | undefined;
  /** The table the note belongs to. Anything but "incident" expands to no case. */
  objecttypecode?: string | undefined;
  /** The case the note is on, as $expand=objectid_incident answers it. */
  caseId?: string | undefined;
  caseNumber?: string | undefined;
  /** What the case's link column holds. */
  link?: string | null | undefined;
  author?: string | undefined;
}

export type NoteRowFunction = (props?: NoteRowProps) => JSONObject;

/**
 * A note as GET /annotations(<id>)?$expand=objectid_incident(...) answers it.
 * Notes written in Dynamics 365's timeline are rich text, kept as HTML.
 */
export const noteRow: NoteRowFunction = (props?: NoteRowProps): JSONObject => {
  const table: string = props?.objecttypecode || "incident";

  return {
    "@odata.context": `${DYNAMICS_API}/$metadata#annotations(annotationid,subject,notetext,isdocument,filename,objecttypecode,_createdby_value,objectid_incident(incidentid,ticketnumber,${LINK_COLUMN}))/$entity`,
    "@odata.etag": 'W/"4411002"',
    annotationid: props?.annotationid || NOTE_ID,
    subject:
      props?.subject === undefined ? "Called the customer" : props.subject,
    notetext:
      props?.notetext === undefined
        ? '<div class="ck-content" data-wrapper="true" dir="ltr" style="--list-bullet-0:disc;"><p>They still see the error at checkout &amp; on the <b>retry</b> page.</p><p>Asked them to try again at 10:30.</p></div>'
        : props.notetext,
    isdocument: props?.isdocument === undefined ? false : props.isdocument,
    filename: props?.filename === undefined ? null : props.filename,
    objecttypecode: table,
    _createdby_value: "f1e2d3c4-b5a6-4978-8a9b-0c1d2e3f4a5b",
    [formattedKey("_createdby_value")]: props?.author || "Sam Okafor",
    objectid_incident:
      table === "incident"
        ? {
            "@odata.etag": 'W/"4410925"',
            incidentid: props?.caseId || CASE_ID,
            ticketnumber: props?.caseNumber || CASE_NUMBER,
            [LINK_COLUMN]: props?.link === undefined ? null : props.link,
          }
        : null,
  };
};

/* -------------------------------- Webhooks -------------------------------- */

export interface WebhookContextProps {
  messageName?: string | undefined;
  /** The table the step is registered on. */
  table?: string | undefined;
  /** The row's id. Leave it out for the empty id the Close message sends. */
  rowId?: string | undefined;
  /** The changed columns, as Target's Attributes. */
  attributes?: Array<{ key: string; value: JSONValue }> | undefined;
  /** Leave InputParameters out, as Dataverse does for a body over 256 KB. */
  stripped?: boolean | undefined;
}

export type WebhookContextFunction = (
  props?: WebhookContextProps,
) => JSONObject;

/**
 * The plug-in execution context a Dataverse webhook posts, as the Plug-in
 * Registration Tool's HttpHeader-authenticated webhook sends it.
 */
export const webhookContext: WebhookContextFunction = (
  props?: WebhookContextProps,
): JSONObject => {
  const table: string = props?.table || "incident";
  const message: string = props?.messageName || "Create";
  const rowId: string = props?.rowId === undefined ? CASE_ID : props.rowId;

  const context: JSONObject = {
    BusinessUnitId: "e2b9dd21-ef22-e711-a816-000d3a17ea56",
    CorrelationId: "b374239d-4233-41a9-8b17-a3f6e92b4ac8",
    Depth: 1,
    InitiatingUserAzureActiveDirectoryObjectId:
      "00000000-0000-0000-0000-000000000000",
    InitiatingUserId: "e64e2827-e822-e711-a815-000d3a17ea56",
    IsExecutingOffline: false,
    IsInTransaction: false,
    IsOfflinePlayback: false,
    IsolationMode: 1,
    MessageName: message,
    Mode: 1,
    OperationCreatedOn: "/Date(1758622860000+0000)/",
    OperationId: "4af0b2e4-a742-e711-a81a-000d3a17ea56",
    OrganizationId: "b2b9dd21-ef22-e711-a816-000d3a17ea56",
    OrganizationName: "acme",
    OutputParameters: message === "Create" ? [{ key: "id", value: rowId }] : [],
    OwningExtension: {
      Id: "f4e36aa8-a442-e711-a81a-000d3a17ea56",
      KeyAttributes: [],
      LogicalName: "sdkmessageprocessingstep",
      Name: `OneUptime: ${message} of ${table}`,
      RowVersion: null,
    },
    ParentContext: null,
    PostEntityImages: [],
    PreEntityImages: [],
    PrimaryEntityId: message === "Close" ? EMPTY_ID : rowId,
    PrimaryEntityName: table,
    RequestId: null,
    SecondaryEntityName: "none",
    SharedVariables: [],
    Stage: 40,
    UserAzureActiveDirectoryObjectId: "00000000-0000-0000-0000-000000000000",
    UserId: "e64e2827-e822-e711-a815-000d3a17ea56",
  };

  if (props?.stripped) {
    return context;
  }

  if (message === "Close") {
    context["InputParameters"] = [
      {
        key: "IncidentResolution",
        value: {
          __type: "Entity:http://schemas.microsoft.com/xrm/2011/Contracts",
          Attributes: [
            {
              key: "incidentid",
              value: {
                __type:
                  "EntityReference:http://schemas.microsoft.com/xrm/2011/Contracts",
                Id: rowId,
                KeyAttributes: [],
                LogicalName: "incident",
                Name: null,
                RowVersion: null,
              },
            },
            { key: "subject", value: "Problem solved on the phone" },
          ],
          EntityState: null,
          FormattedValues: [],
          Id: EMPTY_ID,
          KeyAttributes: [],
          LogicalName: "incidentresolution",
          RelatedEntities: [],
          RowVersion: null,
        },
      },
      {
        key: "Status",
        value: {
          __type:
            "OptionSetValue:http://schemas.microsoft.com/xrm/2011/Contracts",
          Value: 5,
        },
      },
    ];

    return context;
  }

  context["InputParameters"] = [
    {
      key: "Target",
      value: {
        __type: "Entity:http://schemas.microsoft.com/xrm/2011/Contracts",
        Attributes: props?.attributes || [
          {
            key: "title",
            value: "Customers in the EU cannot complete checkout",
          },
        ],
        EntityState: null,
        FormattedValues: [],
        Id: rowId,
        KeyAttributes: [],
        LogicalName: table,
        RelatedEntities: [],
        RowVersion: null,
      },
    },
  ];

  return context;
};

export interface FlowBodyProps {
  /** The row's id column: incidentid for a case, annotationid for a note. */
  idColumn?: string | undefined;
  rowId?: string | undefined;
  /** What the Dataverse trigger's output says happened. Leave it out for a body of your own. */
  sdkMessage?: string | undefined;
}

export type FlowBodyFunction = (props?: FlowBodyProps) => JSONObject;

/**
 * What a Power Automate flow's HTTP action posts when its body is the
 * Dataverse trigger's own output: the row's columns, and SdkMessage.
 */
export const flowBody: FlowBodyFunction = (
  props?: FlowBodyProps,
): JSONObject => {
  const idColumn: string = props?.idColumn || "incidentid";
  const body: JSONObject = {
    "@odata.type":
      idColumn === "annotationid"
        ? "#Microsoft.Dynamics.CRM.annotation"
        : "#Microsoft.Dynamics.CRM.incident",
    [idColumn]:
      props?.rowId || (idColumn === "annotationid" ? NOTE_ID : CASE_ID),
    _ownerid_value: "e64e2827-e822-e711-a815-000d3a17ea56",
    modifiedon: "2026-09-23T09:41:02Z",
  };

  if (props?.sdkMessage) {
    body["SdkMessage"] = props.sdkMessage;
  }

  return body;
};

/* ------------------------------- Scripts ------------------------------- */

export type RunDynamicsScriptFunction = (data: {
  templateId: string;
  componentId: string;
  args: JSONValue;
  /** Lets a test exercise the customization hooks the scripts document. */
  editCode?: ((code: string) => string) | undefined;
}) => Promise<JSONObject>;

/*
 * Runs a template's script in the same isolated-vm sandbox the workflow
 * runner uses, so a global the sandbox does not have fails here exactly as
 * it would in production. A script that throws fails the test rather than
 * quietly returning nothing.
 */
export const runDynamicsScript: RunDynamicsScriptFunction = async (data: {
  templateId: string;
  componentId: string;
  args: JSONValue;
  editCode?: ((code: string) => string) | undefined;
}): Promise<JSONObject> => {
  let code: string = scriptOf(data.templateId, data.componentId);

  if (data.editCode) {
    const edited: string = data.editCode(code);

    if (edited === code) {
      throw new Error("editCode did not change the script.");
    }

    code = edited;
  }

  const result: ReturnResult = await VMRunner.runCodeInSandbox({
    code: code,
    options: { args: data.args as JSONObject, timeout: 5000 },
  });

  if (result.scriptError) {
    throw result.scriptError;
  }

  return result.returnValue as JSONObject;
};

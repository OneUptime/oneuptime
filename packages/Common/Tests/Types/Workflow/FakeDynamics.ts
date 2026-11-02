/*
 * A Dynamics 365 that answers the Dataverse Web API calls the Dynamics 365
 * templates make, and keeps what they change: cases with their states,
 * statuses and link columns, and notes on them. The equivalence suite gives a
 * template and the one it replaced a Dynamics 365 of their own each, in the
 * same state, and expects them to leave it the same.
 *
 *   GET   /incidents(<id>)                  a case, with its display text
 *   GET   /incidents?$filter=<col> eq '...'  the cases a link column holds
 *   POST  /incidents                        a new case
 *   PATCH /incidents(<id>)                  columns written
 *   POST  /CloseIncident                    a case resolved, with a status
 *   POST  /annotations                      a note on a case
 *   GET   /annotations(<id>)                a note, with its case expanded
 *
 * Anything else is a 404, and a request without the bearer token is a 401.
 * Not a test file itself (jest only collects *.test.ts).
 */

import { JSONObject, JSONValue } from "../../../Types/JSON";
import {
  CASE_STATE_NAMES,
  CASE_STATUSES,
  CaseState,
  DYNAMICS_API,
  LINK_COLUMN,
  PRIORITY_NAMES,
  formattedKey,
} from "./DynamicsTemplateFixtures";
import { SimulatedReply, SimulatedRequest } from "./WorkflowTemplateSimulator";

export const FAKE_DYNAMICS_TOKEN: string =
  "eyJ0eXAiOiJKV1QiLCJhbGciOiJSUzI1NiJ9.dynamics";

export interface FakeCase {
  incidentid: string;
  ticketnumber: string;
  title: string;
  description: string;
  prioritycode: number;
  statuscode: number;
  link: string | null;
}

export interface FakeNote {
  annotationid: string;
  caseId: string | null;
  subject: string;
  notetext: string;
}

export interface FakeDynamicsCall {
  method: string;
  path: string;
  body?: JSONValue | undefined;
}

const PREFIX: string = "/api/data/v9.2";

// A row's id inside the path: incidents(<id>), annotations(<id>).
const ROW_IN_PATH: RegExp = /^\/(incidents|annotations)\(([0-9a-f-]{36})\)$/;

// A link search's filter: <column> eq '<value>'.
const LINK_FILTER: RegExp = /^([a-z0-9_]+) eq '([^']*)'$/;

// A bound case: /incidents(<id>).
const BOUND_CASE: RegExp = /^\/incidents\(([0-9a-f-]{36})\)$/;

export default class FakeDynamics {
  public cases: Map<string, FakeCase> = new Map();
  public notes: Map<string, FakeNote> = new Map();
  public calls: Array<FakeDynamicsCall> = [];
  public token: string = FAKE_DYNAMICS_TOKEN;
  // Answer every write with this status, as Dataverse answers a refusal.
  public refuseWritesWith: number | null = null;
  private nextNumber: number = 2000;

  public addCase(row: Partial<FakeCase> & { incidentid: string }): FakeCase {
    const added: FakeCase = {
      incidentid: row.incidentid,
      ticketnumber: row.ticketnumber || "CAS-01001-X1Y2Z3",
      title: row.title || "Customers in the EU cannot complete checkout",
      description: row.description || "Three customers called since 09:40 UTC.",
      prioritycode: row.prioritycode === undefined ? 1 : row.prioritycode,
      statuscode: row.statuscode === undefined ? 1 : row.statuscode,
      link: row.link === undefined ? null : row.link,
    };

    this.cases.set(added.incidentid, added);

    return added;
  }

  public addNote(note: Partial<FakeNote> & { annotationid: string }): FakeNote {
    const added: FakeNote = {
      annotationid: note.annotationid,
      caseId: note.caseId === undefined ? null : note.caseId,
      subject:
        note.subject === undefined ? "Called the customer" : note.subject,
      notetext:
        note.notetext === undefined
          ? "<p>They still see the error at checkout.</p>"
          : note.notetext,
    };

    this.notes.set(added.annotationid, added);

    return added;
  }

  private stateOf(row: FakeCase): CaseState {
    return (CASE_STATUSES[row.statuscode] || { state: CaseState.Active }).state;
  }

  private caseJson(row: FakeCase): JSONObject {
    const state: CaseState = this.stateOf(row);

    return {
      "@odata.etag": 'W/"4410925"',
      incidentid: row.incidentid,
      ticketnumber: row.ticketnumber,
      title: row.title,
      description: row.description,
      prioritycode: row.prioritycode,
      [formattedKey("prioritycode")]:
        PRIORITY_NAMES[row.prioritycode] || String(row.prioritycode),
      statecode: state,
      [formattedKey("statecode")]: CASE_STATE_NAMES[state] as string,
      statuscode: row.statuscode,
      [formattedKey("statuscode")]:
        CASE_STATUSES[row.statuscode]?.name || `Status ${row.statuscode}`,
      _customerid_value: "4f7e6c3a-1b2d-4e5f-8a9b-0c1d2e3f4a5b",
      [formattedKey("_customerid_value")]: "Contoso Pharmaceuticals",
      _modifiedby_value: "e64e2827-e822-e711-a815-000d3a17ea56",
      [formattedKey("_modifiedby_value")]: "Priya Patel",
      [LINK_COLUMN]: row.link,
    };
  }

  public answer(request: SimulatedRequest): SimulatedReply {
    const url: URL = new URL(request.url);
    const method: string = request.method.toUpperCase();
    const path: string = url.pathname.startsWith(PREFIX)
      ? url.pathname.slice(PREFIX.length)
      : url.pathname;
    const authorization: string =
      Object.entries(request.headers).find(([name]: [string, string]) => {
        return name.toLowerCase() === "authorization";
      })?.[1] || "";

    this.calls.push({
      method: method,
      path: path + decodeURIComponent(url.search),
      ...(request.body !== undefined ? { body: request.body } : {}),
    });

    if (authorization !== `Bearer ${this.token}`) {
      return {
        status: 401,
        body: {
          error: {
            code: "0x80072560",
            message: "The user is not authenticated.",
          },
        },
      };
    }

    if (method !== "GET" && this.refuseWritesWith !== null) {
      return {
        status: this.refuseWritesWith,
        body: {
          error: {
            code: "0x80040203",
            message: "Dynamics 365 refused the request.",
          },
        },
      };
    }

    const body: JSONObject = (request.body as JSONObject) || {};
    const row: RegExpExecArray | null = ROW_IN_PATH.exec(path);

    if (method === "GET" && path === "/incidents") {
      const filter: RegExpExecArray | null = LINK_FILTER.exec(
        url.searchParams.get("$filter") || "",
      );
      const rows: Array<JSONObject> = filter
        ? Array.from(this.cases.values())
            .filter((candidate: FakeCase): boolean => {
              return filter[1] === LINK_COLUMN && candidate.link === filter[2];
            })
            .slice(0, Number(url.searchParams.get("$top") || 50))
            .map((candidate: FakeCase): JSONObject => {
              return this.caseJson(candidate);
            })
        : [];

      return {
        status: 200,
        body: {
          "@odata.context": `${DYNAMICS_API}/$metadata#incidents`,
          value: rows,
        },
      };
    }

    if (method === "POST" && path === "/incidents") {
      this.nextNumber++;
      const created: FakeCase = this.addCase({
        incidentid: `d0000000-0000-4000-8000-00000000${this.nextNumber}`,
        ticketnumber: `CAS-0${this.nextNumber}-ONEUP`,
        title: String(body["title"] || ""),
        description: String(body["description"] || ""),
        prioritycode: Number(body["prioritycode"] || 2),
        link: (body[LINK_COLUMN] as string) || null,
      });

      return { status: 201, body: this.caseJson(created) };
    }

    if (method === "POST" && path === "/CloseIncident") {
      const resolution: JSONObject =
        (body["IncidentResolution"] as JSONObject) || {};
      const bound: RegExpExecArray | null = BOUND_CASE.exec(
        String(resolution["incidentid@odata.bind"] || ""),
      );
      const closed: FakeCase | undefined = bound
        ? this.cases.get(bound[1] as string)
        : undefined;

      if (!closed) {
        return {
          status: 404,
          body: {
            error: { code: "0x80040217", message: "incident Does Not Exist" },
          },
        };
      }

      closed.statuscode = Number(body["Status"]);

      return { status: 204, body: "" };
    }

    if (method === "POST" && path === "/annotations") {
      const bound: RegExpExecArray | null = BOUND_CASE.exec(
        String(body["objectid_incident@odata.bind"] || ""),
      );

      this.nextNumber++;
      this.addNote({
        annotationid: `e0000000-0000-4000-8000-00000000${this.nextNumber}`,
        caseId: bound ? (bound[1] as string) : null,
        subject: String(body["subject"] || ""),
        notetext: String(body["notetext"] || ""),
      });

      return { status: 204, body: "" };
    }

    if (row && row[1] === "incidents") {
      const found: FakeCase | undefined = this.cases.get(row[2] as string);

      if (!found) {
        return {
          status: 404,
          body: {
            error: { code: "0x80040217", message: "incident Does Not Exist" },
          },
        };
      }

      if (method === "GET") {
        return { status: 200, body: this.caseJson(found) };
      }

      if (method === "PATCH") {
        for (const [column, value] of Object.entries(body)) {
          if (column === LINK_COLUMN) {
            found.link = value as string;
          } else if (column === "statuscode") {
            found.statuscode = Number(value);
          }
        }

        return { status: 204, body: "" };
      }
    }

    if (row && row[1] === "annotations" && method === "GET") {
      const note: FakeNote | undefined = this.notes.get(row[2] as string);

      if (!note) {
        return {
          status: 404,
          body: {
            error: { code: "0x80040217", message: "annotation Does Not Exist" },
          },
        };
      }

      const onCase: FakeCase | undefined = note.caseId
        ? this.cases.get(note.caseId)
        : undefined;

      return {
        status: 200,
        body: {
          annotationid: note.annotationid,
          subject: note.subject,
          notetext: note.notetext,
          isdocument: false,
          filename: null,
          objecttypecode: onCase ? "incident" : "account",
          _createdby_value: "f1e2d3c4-b5a6-4978-8a9b-0c1d2e3f4a5b",
          [formattedKey("_createdby_value")]: "Sam Okafor",
          objectid_incident: onCase
            ? {
                incidentid: onCase.incidentid,
                ticketnumber: onCase.ticketnumber,
                [LINK_COLUMN]: onCase.link,
              }
            : null,
        },
      };
    }

    return {
      status: 404,
      body: { error: { code: "0x8006088a", message: "Resource not found." } },
    };
  }

  // What Dynamics 365 holds once a run is over, and every call that changed it.
  public state(): JSONValue {
    return {
      cases: Array.from(this.cases.values())
        .sort((a: FakeCase, b: FakeCase): number => {
          return a.ticketnumber.localeCompare(b.ticketnumber);
        })
        .map((row: FakeCase): JSONObject => {
          return {
            ticketnumber: row.ticketnumber,
            title: row.title,
            description: row.description,
            prioritycode: row.prioritycode,
            statuscode: row.statuscode,
            link: row.link,
          };
        }),
      notes: Array.from(this.notes.values()).map(
        (note: FakeNote): JSONObject => {
          return {
            case: note.caseId
              ? this.cases.get(note.caseId)?.ticketnumber || null
              : null,
            subject: note.subject,
            notetext: note.notetext,
          };
        },
      ),
      writes: this.calls
        .filter((call: FakeDynamicsCall): boolean => {
          return call.method !== "GET";
        })
        .map((call: FakeDynamicsCall): JSONObject => {
          return {
            method: call.method,
            path: call.path,
            body: call.body || null,
          };
        }),
    };
  }
}

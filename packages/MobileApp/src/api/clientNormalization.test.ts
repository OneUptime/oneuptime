import AsyncStorage from "@react-native-async-storage/async-storage";
import { clearTokens } from "../storage/keychain";
import { setServerUrl } from "../storage/serverUrl";
import { clearAllSsoTokens } from "../storage/ssoTokens";
import {
  makeIncident,
  makeListResponse,
  makeNamedEntityWithColor,
} from "../__tests__/testSupport";
import apiClient from "./client";
import type { IncidentItem, ListResponse } from "./types";
import type {
  AxiosResponse,
  InternalAxiosRequestConfig,
  AxiosRequestConfig,
} from "axios";
import { describe, expect, test, beforeEach } from "@jest/globals";

/*
 * The deserializing half of the API client's response interceptor.
 *
 * OneUptime's API does not send plain JSON. Anything the server models as a
 * value object goes out on the wire wrapped: an id leaves as
 * { _type: "ObjectID", value: "..." }, a timestamp as
 * { _type: "DateTime", value: "..." }, a note body as
 * { _type: "Markdown", value: "..." }. The interceptor in src/api/client.ts
 * unwraps exactly those three, everywhere they occur, before any screen or
 * react-query cache ever sees the body.
 *
 * Getting this wrong fails loudly in one direction and silently in the other.
 * A field left wrapped is an object where the app models a string, so React
 * Native throws "Objects are not valid as a React child" on the render, or -
 * worse - the value is quietly truthy, and an unresolved incident shows as
 * resolved because `if (incident.resolvedAt)` is now testing a wrapper rather
 * than a date. A field unwrapped that should not have been changes shape
 * without a single compile error, because everything downstream is typed from
 * Common's models and the wire form was never in those types to begin with.
 *
 * The three names are re-stated in this file rather than imported, because
 * they are a wire contract with a server that ships separately from the app.
 *
 * These tests drive the REAL interceptor the same way clientSsoHeaders.test.ts
 * and clientSsoDenial.test.ts drive the request and 406 halves: axios is given
 * a custom `config.adapter`, which stands in for the network and decides what
 * the "server" answered. Nothing is re-implemented, normalizeResponseData is
 * never reached around (it is not exported), and no socket is opened.
 *
 * Nothing here is platform-specific - the interceptor is plain JavaScript with
 * no Platform.OS branch - so every test is expected to hold identically under
 * both the ios and android Jest projects.
 */

const OBJECT_ID_TYPE: string = "ObjectID";
const DATE_TIME_TYPE: string = "DateTime";
const MARKDOWN_TYPE: string = "Markdown";

const INCIDENT_ID: string = "11111111-1111-1111-1111-111111111111";
const MONITOR_ID: string = "22222222-2222-2222-2222-222222222222";
const STATE_ID: string = "33333333-3333-3333-3333-333333333333";
const DECLARED_AT: string = "2026-08-30T09:00:00.000Z";

interface SerializedEnvelope {
  _type: unknown;
  value?: unknown;
}

function objectId(value: unknown): SerializedEnvelope {
  return { _type: OBJECT_ID_TYPE, value };
}

function dateTime(value: unknown): SerializedEnvelope {
  return { _type: DATE_TIME_TYPE, value };
}

function markdown(value: unknown): SerializedEnvelope {
  return { _type: MARKDOWN_TYPE, value };
}

/*
 * Axios runs `transformResponse` on whatever the adapter resolved with, BEFORE
 * the response interceptor sees it, and the default transformer will happily
 * JSON.parse a string body. Replacing it with an identity transformer means
 * the fixture below reaches the interceptor exactly as written, so a failing
 * assertion is always about client.ts and never about axios having reinterpreted
 * the test's own input. It is also the more faithful model: a real body has
 * already been parsed by the time the interceptor runs, which is precisely what
 * handing the adapter a live object represents.
 */
function passThroughTransform(data: unknown): unknown {
  return data;
}

function adapterReturning(
  body: unknown,
): (config: InternalAxiosRequestConfig) => Promise<AxiosResponse> {
  return (config: InternalAxiosRequestConfig): Promise<AxiosResponse> => {
    return Promise.resolve({
      data: body,
      status: 200,
      statusText: "OK",
      headers: {},
      config,
    } as AxiosResponse);
  };
}

/**
 * Issues one request whose "server" answers with `body`, and returns the body
 * as the caller of apiClient would receive it - i.e. after normalization.
 */
async function receive<T>(body: unknown): Promise<T> {
  const config: AxiosRequestConfig = {
    adapter: adapterReturning(body),
    transformResponse: passThroughTransform,
  };

  const response: AxiosResponse = await apiClient.get("/api/incident", config);

  return response.data as T;
}

/*
 * The AsyncStorage fake in src/__tests__/setup.ts is a module-level Map that
 * survives between tests, and the token stores hold in-memory caches that
 * survive with it. Resetting all of it keeps the REQUEST interceptor quiet:
 * a stray token from another suite's leftovers would attach headers these
 * tests never asked about, and getServerUrl() needs somewhere to point.
 */
beforeEach(async () => {
  await AsyncStorage.clear();
  await clearAllSsoTokens();
  await clearTokens();
  await setServerUrl("https://test.oneuptime.local");
});

describe("the three envelopes the client unwraps", () => {
  test("an ObjectID envelope becomes the bare id string", async () => {
    /*
     * `_id` is the single most load-bearing field in the app: it is the
     * react-query cache key, the list key, and the path segment of every
     * follow-up detail request. Left wrapped, the list renders and then the
     * detail screen fetches /api/incident/[object Object].
     */
    const data: Record<string, unknown> = await receive<
      Record<string, unknown>
    >({
      _id: objectId(INCIDENT_ID),
    });

    expect(data["_id"]).toBe(INCIDENT_ID);
  });

  test("a DateTime envelope becomes the ISO string the server sent, not a Date", async () => {
    /*
     * types.ts models every timestamp as `string`, and the formatters build
     * their own `new Date(value)` from it. Handing them a Date instance would
     * happen to work in a few places and produce "Invalid Date" in the ones
     * that call String() first, so the string form is the contract, not an
     * implementation detail.
     */
    const data: Record<string, unknown> = await receive<
      Record<string, unknown>
    >({
      declaredAt: dateTime(DECLARED_AT),
    });

    expect(data["declaredAt"]).toBe(DECLARED_AT);
    expect(typeof data["declaredAt"]).toBe("string");
  });

  test("a Markdown envelope becomes its raw source, newlines and all", async () => {
    /*
     * The unwrapped string is fed straight to MarkdownContent, so the markup
     * has to survive byte for byte - a trimmed or re-encoded body would turn a
     * responder's runbook into one long paragraph.
     */
    const source: string =
      "## Root cause\n\n- the primary volume filled up\n- `df -h` reported 100%\n";

    const data: Record<string, unknown> = await receive<
      Record<string, unknown>
    >({
      note: markdown(source),
    });

    expect(data["note"]).toBe(source);
  });

  test("an envelope wrapping an empty string unwraps to the empty string", async () => {
    /*
     * The unwrap is gated on the `value` KEY existing, not on the value being
     * truthy. That distinction is the whole test: an incident saved with an
     * empty description has to arrive as "" so that the screens'
     * `description || "No description provided"` fallbacks fire. A wrapper
     * object is truthy, and would render as literal "[object Object]" where
     * the placeholder belongs.
     */
    const data: Record<string, unknown> = await receive<
      Record<string, unknown>
    >({
      description: markdown(""),
    });

    expect(data["description"]).toBe("");
  });

  test("an envelope wrapping null unwraps to null, not to the wrapper", async () => {
    /*
     * The same reasoning as the empty string, and the more dangerous half of
     * it: `if (incident.resolvedAt)` on a surviving wrapper is always true, so
     * an open incident would be presented as resolved. Unwrapping to null
     * keeps the emptiness visible to the caller.
     */
    const data: Record<string, unknown> = await receive<
      Record<string, unknown>
    >({
      resolvedAt: dateTime(null),
    });

    expect(data["resolvedAt"]).toBeNull();
  });
});

describe("envelopes buried in the body", () => {
  test("unwraps envelopes nested inside plain objects", async () => {
    const data: Record<string, unknown> = await receive<
      Record<string, unknown>
    >({
      currentIncidentState: {
        _id: objectId(STATE_ID),
        name: "Investigating",
      },
    });

    expect(data["currentIncidentState"]).toEqual({
      _id: STATE_ID,
      name: "Investigating",
    });
  });

  test("unwraps every element of an array of envelopes", async () => {
    /*
     * A `select` of a to-many relation comes back as a bare array of ids. If
     * only the first element were unwrapped - the classic off-by-one in a
     * hand-rolled walker - the mistake would be invisible on any single-item
     * fixture, so this asserts on two.
     */
    const data: Record<string, unknown> = await receive<
      Record<string, unknown>
    >({
      monitorIds: [objectId(MONITOR_ID), objectId(INCIDENT_ID)],
    });

    expect(data["monitorIds"]).toEqual([MONITOR_ID, INCIDENT_ID]);
  });

  test("walks past the entries of a mixed array without disturbing them", async () => {
    /*
     * Arrays are recursed element by element, so every element type has to
     * come out the far side: nulls must stay null rather than being dropped or
     * throwing, and values that were never wrapped must be left exactly as
     * they arrived. Positions matter as much as contents - a walker that
     * filtered rather than mapped would still satisfy a contains-style check.
     */
    const data: Record<string, unknown> = await receive<
      Record<string, unknown>
    >({
      mixed: [objectId(MONITOR_ID), null, "already-plain", 7, true],
    });

    expect(data["mixed"]).toEqual([MONITOR_ID, null, "already-plain", 7, true]);
  });

  test("unwraps envelopes inside objects inside arrays inside objects", async () => {
    /*
     * The shape a real incident row actually has: the list rows sit under
     * `data`, each row carries a `monitors` array, and each monitor carries a
     * wrapped `_id`. Four levels down is where a recursion that only handled
     * the top two would stop, and nothing above it would look wrong.
     */
    const data: Record<string, unknown> = await receive<
      Record<string, unknown>
    >({
      data: [
        {
          _id: objectId(INCIDENT_ID),
          monitors: [{ _id: objectId(MONITOR_ID), name: "api.example.com" }],
        },
      ],
    });

    expect(data["data"]).toEqual([
      {
        _id: INCIDENT_ID,
        monitors: [{ _id: MONITOR_ID, name: "api.example.com" }],
      },
    ]);
  });

  test("leaves the sibling fields of an unwrapped envelope untouched", async () => {
    /*
     * Rebuilding an object key by key is how the walker works, so every key
     * that is not an envelope has to survive the rebuild - including the ones
     * whose values are falsy, which is where a copy loop written around
     * truthiness would quietly drop fields.
     */
    const data: Record<string, unknown> = await receive<
      Record<string, unknown>
    >({
      _id: objectId(INCIDENT_ID),
      incidentNumber: 0,
      title: "",
      isVisibleOnStatusPage: false,
      rootCause: null,
    });

    expect(data).toEqual({
      _id: INCIDENT_ID,
      incidentNumber: 0,
      title: "",
      isVisibleOnStatusPage: false,
      rootCause: null,
    });
  });
});

describe("shapes the client must leave alone", () => {
  test("an object carrying a known _type but no value is left as it arrived", async () => {
    /*
     * The unwrap requires an own `value` key. Without that guard a truncated
     * wrapper would unwrap to `undefined`, erasing the evidence that anything
     * arrived at all; leaving it intact means the malformed field is still
     * there to be seen in a bug report.
     */
    const data: Record<string, unknown> = await receive<
      Record<string, unknown>
    >({
      _id: { _type: OBJECT_ID_TYPE },
    });

    expect(data["_id"]).toEqual({ _type: OBJECT_ID_TYPE });
  });

  test("an unrecognised _type keeps its wrapper", async () => {
    /*
     * ObjectID, DateTime and Markdown are a closed list, and the rest of
     * OneUptime's serialized types deliberately arrive still wrapped, because
     * the readers downstream are written for the wire form: rgbToHex in
     * src/utils/color.ts takes `.value` off a Color envelope, and toPlainText
     * in src/utils/text.ts does the same for Name and Email. Broadening the
     * unwrap to "anything with a _type and a value" would also flatten the
     * types whose value is itself structured, changing the shape those readers
     * are handed with nothing in the type system to catch it.
     */
    const color: Record<string, unknown> = { _type: "Color", value: "#ff0000" };

    const data: Record<string, unknown> = await receive<
      Record<string, unknown>
    >({
      color,
    });

    expect(data["color"]).toEqual({ _type: "Color", value: "#ff0000" });
  });

  test("a _type that is not a string is data, not a wrapper", async () => {
    /*
     * `_type` is only a wrapper marker when it is a string naming one of the
     * three. A row that happens to carry its own numeric `_type` column is
     * ordinary data and has to come through with both of its fields.
     */
    const data: Record<string, unknown> = await receive<
      Record<string, unknown>
    >({
      step: { _type: 3, value: "ping" },
    });

    expect(data["step"]).toEqual({ _type: 3, value: "ping" });
  });

  test("an object that merely has a value key is not unwrapped", async () => {
    /*
     * The other half of the guard. Plenty of legitimate objects have a `value`
     * field - a custom field, a chart point - and unwrapping on `value` alone
     * would silently discard every other key on them.
     */
    const data: Record<string, unknown> = await receive<
      Record<string, unknown>
    >({
      customField: { value: "high", label: "Priority" },
    });

    expect(data["customField"]).toEqual({ value: "high", label: "Priority" });
  });
});

/*
 * `__proto__` is the one key name that a rebuild-key-by-key walker cannot copy
 * with a plain assignment. Object.prototype defines it as an ACCESSOR, so
 * `rebuilt["__proto__"] = value` never creates a property: it calls the setter,
 * which re-parents the object when the value is an object and silently does
 * nothing at all when it is not.
 *
 * OneUptime's API does not go out of its way to send such a field, but nothing
 * stops one arriving: custom fields, telemetry attributes, log attributes and
 * incident/alert custom columns are all user-named maps that end up in a
 * response body verbatim. Either outcome is bad and both are silent - the field
 * vanishes from the row with no error anywhere, and in the object case its keys
 * come back as INHERITED properties of the row, so `row.isAdmin` starts
 * answering with something the server never put on that row.
 */
describe("a field the server named __proto__", () => {
  /*
   * Built through JSON.parse, which is the only way to get this key. An object
   * literal written `{ __proto__: x }` sets the object's prototype and creates
   * no key at all, so a fixture written that way would test nothing. JSON.parse
   * defines it as an ordinary own data property - which is exactly the object
   * axios' response transform hands the interceptor for this body.
   */
  function bodyWithProtoField(valueJson: string): Record<string, unknown> {
    return JSON.parse(
      `{"name":"api.example.com","__proto__":${valueJson}}`,
    ) as Record<string, unknown>;
  }

  function protoFieldOf(data: Record<string, unknown>): PropertyDescriptor {
    return Object.getOwnPropertyDescriptor(
      data,
      "__proto__",
    ) as PropertyDescriptor;
  }

  test("survives the rebuild as a field rather than becoming the row's prototype", async () => {
    const data: Record<string, unknown> = await receive<
      Record<string, unknown>
    >(bodyWithProtoField('{"isAdmin":true}'));

    /*
     * Read through the descriptor, not through `data["__proto__"]`: that index
     * reads the accessor when there is no own property, and would answer with
     * the polluted prototype in the broken case - i.e. it would pass either
     * way.
     */
    expect(protoFieldOf(data)).toBeDefined();
    expect(protoFieldOf(data).value).toEqual({ isAdmin: true });

    /*
     * The other half, and the reason this is not merely a lost field: with a
     * plain assignment the row is re-parented onto whatever arrived, so every
     * key inside it reads back off the row as though the server had sent it
     * there.
     */
    expect(Object.getPrototypeOf(data)).toBe(Object.prototype);
    expect((data as { isAdmin?: unknown }).isAdmin).toBeUndefined();

    // The ordinary sibling has to come through the same rebuild untouched.
    expect(data["name"]).toBe("api.example.com");
  });

  test("is kept even when its value is a primitive the setter would drop", async () => {
    /*
     * The quieter half. `Object.prototype.__proto__`'s setter ignores anything
     * that is not an object or null, so this assignment throws nothing, changes
     * nothing and loses the field completely - no prototype to notice
     * afterwards, no error, just a column that is not in the row any more.
     */
    const data: Record<string, unknown> = await receive<
      Record<string, unknown>
    >(bodyWithProtoField('"a-plain-string"'));

    expect(protoFieldOf(data)).toBeDefined();
    expect(protoFieldOf(data).value).toBe("a-plain-string");
    expect(Object.getPrototypeOf(data)).toBe(Object.prototype);
  });

  test("is deserialized like any other field before it is written", async () => {
    /*
     * The key name changes how the value is STORED, never whether it is walked:
     * a wrapped id under this name is still an id, and the caller is entitled
     * to the same bare string it would get under any other column.
     */
    const data: Record<string, unknown> = await receive<
      Record<string, unknown>
    >(
      bodyWithProtoField(
        `{"_type":"${OBJECT_ID_TYPE}","value":"${INCIDENT_ID}"}`,
      ),
    );

    expect(protoFieldOf(data)).toBeDefined();
    expect(protoFieldOf(data).value).toBe(INCIDENT_ID);
  });

  test("is carried through a nested row too, not just the top level", async () => {
    /*
     * The realistic shape: the field is on a row inside a page, not on the body
     * itself. Every level is rebuilt by the same loop, so a fix applied only
     * where the test happened to look would leave the rows - the part anything
     * actually renders - still losing the field.
     */
    const received: ListResponse<Record<string, unknown>> = await receive<
      ListResponse<Record<string, unknown>>
    >({
      data: [bodyWithProtoField('{"isAdmin":true}')],
      count: 1,
      skip: 0,
      limit: 20,
    });

    const row: Record<string, unknown> = received.data[0]!;

    expect(protoFieldOf(row)).toBeDefined();
    expect(protoFieldOf(row).value).toEqual({ isAdmin: true });
    expect(Object.getPrototypeOf(row)).toBe(Object.prototype);
    expect((row as { isAdmin?: unknown }).isAdmin).toBeUndefined();
  });
});

describe("bodies that are not an object graph", () => {
  test("a null body stays null", async () => {
    const data: unknown = await receive<unknown>(null);

    expect(data).toBeNull();
  });

  test("an undefined body stays undefined", async () => {
    /*
     * A 204-shaped response - the acknowledge and resolve calls do not read a
     * body - must not be turned into an empty object by the walker, or the
     * callers' `if (data)` checks would start passing on nothing.
     */
    const data: unknown = await receive<unknown>(undefined);

    expect(data).toBeUndefined();
  });

  test("an empty array is still an array", async () => {
    /*
     * Every list screen calls .map and .length on what it is given. An empty
     * page rebuilt as `{}` would not throw here - it would throw in the
     * renderer, on the screen a responder opened at 3am.
     */
    const data: unknown = await receive<unknown>([]);

    expect(Array.isArray(data)).toBe(true);
    expect(data).toEqual([]);
  });

  test("a primitive body is handed back exactly as it arrived", async () => {
    /*
     * Falsy primitives are listed explicitly: they are the ones a walker that
     * short-circuits on `!data` would convert to null or undefined on the way
     * through.
     */
    expect(await receive<unknown>("acknowledged")).toBe("acknowledged");
    expect(await receive<unknown>(42)).toBe(42);
    expect(await receive<unknown>(0)).toBe(0);
    expect(await receive<unknown>(true)).toBe(true);
    expect(await receive<unknown>(false)).toBe(false);
    expect(await receive<unknown>("")).toBe("");
  });
});

describe("a whole get-list response", () => {
  test("deserializes a serialized row into exactly the shape the app models", async () => {
    /*
     * The end-to-end case, and the reason the rest of this file matters: the
     * expected value here is the SHARED incident fixture every other suite
     * asserts against, and the request body is that same fixture with its ids,
     * timestamps and markdown put back into their wire wrappers. So the
     * assertion is literally "what the server sends deserializes into what the
     * rest of the app believes it will get", rather than "the walker walked".
     */
    const expectedRow: IncidentItem = makeIncident({
      createdAt: DECLARED_AT,
      declaredAt: DECLARED_AT,
    });

    const wireRow: Record<string, unknown> = {
      ...expectedRow,
      _id: objectId(String(expectedRow._id)),
      createdAt: dateTime(expectedRow.createdAt),
      declaredAt: dateTime(expectedRow.declaredAt),
      description: markdown(String(expectedRow.description)),
      currentIncidentState: {
        ...expectedRow.currentIncidentState,
        _id: objectId(String(expectedRow.currentIncidentState._id)),
      },
      monitors: expectedRow.monitors.map(
        (
          monitor: IncidentItem["monitors"][number],
        ): Record<string, unknown> => {
          return { ...monitor, _id: objectId(String(monitor._id)) };
        },
      ),
    };

    /*
     * count deliberately differs from the number of rows: it is the total
     * matching the query, not the size of this page, and it is a plain number
     * on the wire that has to come through unchanged for the paging to work.
     */
    const expected: ListResponse<IncidentItem> = makeListResponse(
      [expectedRow],
      {
        count: 137,
        skip: 0,
        limit: 20,
      },
    );

    const received: ListResponse<IncidentItem> = await receive<
      ListResponse<IncidentItem>
    >({
      data: [wireRow],
      count: 137,
      skip: 0,
      limit: 20,
    });

    expect(received).toEqual(expected);
  });

  test("an empty page keeps its envelope so the caller can still page", async () => {
    /*
     * The "no incidents" case is not an error and not an absent body: the
     * screens read count/skip/limit off it to decide whether to ask for more,
     * and read `data` to decide between the list and the empty state.
     */
    const received: ListResponse<IncidentItem> = await receive<
      ListResponse<IncidentItem>
    >({
      data: [],
      count: 0,
      skip: 0,
      limit: 20,
    });

    expect(received).toEqual(makeListResponse<IncidentItem>([], { limit: 20 }));
    expect(Array.isArray(received.data)).toBe(true);
    expect(received.data).toHaveLength(0);
    expect(received.count).toBe(0);
  });

  test("normalizes every row of a page, not just the first", async () => {
    /*
     * A page is the common case and a one-row fixture cannot tell a walker
     * that recurses from one that unwraps the head and copies the tail. The
     * second row's state id is wrapped too, so the miss would have to be
     * total to pass.
     */
    const received: ListResponse<Record<string, unknown>> = await receive<
      ListResponse<Record<string, unknown>>
    >({
      data: [
        { _id: objectId(INCIDENT_ID), createdAt: dateTime(DECLARED_AT) },
        {
          _id: objectId(MONITOR_ID),
          currentIncidentState: {
            ...makeNamedEntityWithColor({ name: "Investigating" }),
            _id: objectId(STATE_ID),
          },
        },
      ],
      count: 2,
      skip: 0,
      limit: 20,
    });

    expect(received.data[0]!["_id"]).toBe(INCIDENT_ID);
    expect(received.data[0]!["createdAt"]).toBe(DECLARED_AT);
    expect(received.data[1]!["_id"]).toBe(MONITOR_ID);
    expect(
      (received.data[1]!["currentIncidentState"] as Record<string, unknown>)[
        "_id"
      ],
    ).toBe(STATE_ID);
  });
});

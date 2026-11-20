import { API_REFERENCE, CMDB_SYNC } from "./InventoryAndApiDocsPages";
import {
  bold,
  boldIn,
  codeIn,
  englishPage,
  englishSection,
  lineStartingWith,
  listOf,
  readRepoFile,
  rowStartingWith,
  tableWithHeader,
} from "./InventoryAndApiDocsSupport";
import { scanMarkdown } from "./DocsContentSupport";
import ApiKey from "Common/Models/DatabaseModels/ApiKey";
import InventoryItem from "Common/Models/DatabaseModels/InventoryItem";
import InventoryItemCustomField from "Common/Models/DatabaseModels/InventoryItemCustomField";
import InventoryItemRelationship from "Common/Models/DatabaseModels/InventoryItemRelationship";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import NetworkDevice from "Common/Models/DatabaseModels/NetworkDevice";
import TeamMember from "Common/Models/DatabaseModels/TeamMember";
import User from "Common/Models/DatabaseModels/User";
import UserOnCallLogTimeline from "Common/Models/DatabaseModels/UserOnCallLogTimeline";
import UserSMS from "Common/Models/DatabaseModels/UserSMS";
import BaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import PendingInviteeProfiles from "Common/Server/Utils/TeamMember/PendingInviteeProfiles";
import BaseAPI from "Common/Server/API/BaseAPI";
import { ExpressRequest } from "Common/Server/Utils/Express";
import getRequestBodyLimit, {
  ORDINARY_REQUEST_BODY_LIMIT,
} from "Common/Server/Utils/RequestBodyLimit";
import ColumnRefusalMessage from "Common/Server/Types/Database/Permissions/ColumnRefusalMessage";
import ServerOwned from "Common/Types/Database/ServerOwned";
import ListChangesUtil, {
  ADD_TO_LIST_KEY,
  ListChanges,
  REMOVE_FROM_LIST_KEY,
} from "Common/Types/Database/ListChanges";
import FieldsLeftOut, {
  FIELDS_LEFT_OUT_HEADER,
} from "Common/Types/API/FieldsLeftOut";
import { ModelSchema } from "Common/Utils/Schema/ModelSchema";
import { TRY_COLLECTOR_CONFIG_AGAIN_ROUTE } from "Common/Types/HostCollector/HostCollectorRoutes";
import UUIDColumnFilter, {
  EXAMPLE_UUID,
} from "Common/Server/Types/Database/UUIDColumnFilter";
import Alert from "Common/Models/DatabaseModels/Alert";
import Incident from "Common/Models/DatabaseModels/Incident";
import IncidentSeverity from "Common/Models/DatabaseModels/IncidentSeverity";
import Label from "Common/Models/DatabaseModels/Label";
import OnCallDutyPolicy from "Common/Models/DatabaseModels/OnCallDutyPolicy";
import OwnedByFilter, {
  OwnerTablesOfKind,
} from "Common/Server/Types/Database/OwnedByFilter";
import OwnedBy, {
  MAX_OWNED_BY_IDS,
  OWNED_BY_QUERY_KEY,
  OwnedByMatch,
} from "Common/Types/BaseDatabase/OwnedBy";
import GreaterThan from "Common/Types/BaseDatabase/GreaterThan";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import Search from "Common/Types/BaseDatabase/Search";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import { PlanType } from "Common/Types/Billing/SubscriptionPlan";
import LIMIT_MAX, {
  DEFAULT_LIMIT,
  LIMIT_PER_PROJECT,
} from "Common/Types/Database/LimitMax";
import BadDataException from "Common/Types/Exception/BadDataException";
import BadRequestException from "Common/Types/Exception/BadRequestException";
import NameTakenException, {
  NAME_TAKEN_BY_ARCHIVED_REFUSAL_CODE,
  NAME_TAKEN_REFUSAL_CODE,
  NAME_TAKEN_REFUSAL_CODES,
  REFUSAL_CODE_FIELD,
} from "Common/Types/Exception/NameTakenException";
import ValueTakenException, {
  TAKEN_FIELD_DETAIL,
  VALUE_TAKEN_BY_ARCHIVED_REFUSAL_CODE,
  VALUE_TAKEN_REFUSAL_CODE,
  VALUE_TAKEN_REFUSAL_CODES,
} from "Common/Types/Exception/ValueTakenException";
import StatusPageDomain from "Common/Models/DatabaseModels/StatusPageDomain";
import {
  SharedNameKind,
  getSharedNamesRoute,
} from "Common/Types/Database/SharedNames";
import {
  ON_CALL_POLICY_NAME_TAKEN_REFUSAL,
  getNameTakenRefusalText,
} from "Common/Types/Database/UniqueName";
import ExceptionCode from "Common/Types/Exception/ExceptionCode";
import { JSONObject, ObjectType } from "Common/Types/JSON";
import JSONFunctions from "Common/Types/JSONFunctions";
import ListData from "Common/Types/ListData";
import ObjectID from "Common/Types/ObjectID";
import Permission, { PermissionHelper } from "Common/Types/Permission";
import PositiveNumber from "Common/Types/PositiveNumber";
import SerializableObjectDictionary from "Common/Types/SerializableObjectDictionary";
import EntitySource from "Common/Types/Telemetry/EntitySource";
import EntityType from "Common/Types/Telemetry/EntityType";
import { MANUAL_ENTITY_TYPES } from "Common/Types/Telemetry/EntityTypeGroups";
import {
  getApiBaseUrl,
  getCurlCommand,
} from "Common/Utils/DeveloperDocs/ApiExamples";
import {
  ONEUPTIME_API_KEY_ENVIRONMENT_VARIABLE,
  getApiKeyExportCommand,
} from "Common/Utils/DeveloperDocs/ExampleValues";
import { describe, expect, it } from "@jest/globals";

/*
 * What the OneUptime API Reference and the requests of Exporting to a CMDB
 * say about the API, held to the code that answers them (docs overhaul task
 * 26b).
 *
 * The API reference teaches a developer the requests every resource has,
 * what a request body holds, how a list is filtered, sorted and paged, what
 * each status code means and how an API key reaches a project. None of that
 * is compiled with the page, so each test reads the source of truth - the
 * routes BaseAPI registers and the body fields it reads, the query types the
 * API deserializes, the limits, the exception codes, the API key middleware,
 * the Dashboard's API key pages read as text, the models' paths, plans and
 * permissions - and checks the pages still say what it does. Where the code
 * is a pure function, it runs on the page's own example: the worked query
 * deserializes to the comparisons the page says it makes.
 *
 * The rules about the records a request names, plans, switches, states and
 * reads by ID have their own suites (ParentScopeOnWritesDocs,
 * ReadByIdAndWildcardScopeDocs, OwnerAndCredentialSettingsDocs,
 * ReferenceAndLabelWritesDocs, SwitchWritesDocs, PlanCutoffCredentialsDocs
 * and the rest); InventoryDocsFacts holds the Inventory pages to the
 * product, and InventoryAndApiDocsTranslations holds the translations.
 */

const DASHBOARD_APP: string = "App/FeatureSet/Dashboard/src";
const BASE_API: string = "Common/Server/API/BaseAPI.ts";
const RESPONSE: string = "Common/Server/Utils/Response.ts";
const DATABASE_SERVICE: string = "Common/Server/Services/DatabaseService.ts";
const PROJECT_AUTHORIZATION: string =
  "Common/Server/Middleware/ProjectAuthorization.ts";
const TABLE_PERMISSION: string =
  "Common/Server/Types/Database/Permissions/TablePermission.ts";
const QUERY_PERMISSION: string =
  "Common/Server/Types/Database/Permissions/QueryPermission.ts";
const INVENTORY_ITEM_SERVICE: string =
  "Common/Server/Services/InventoryItemService.ts";
const SETTINGS_MENU: string = `${DASHBOARD_APP}/Pages/Settings/SideMenu.tsx`;
const API_KEYS_PAGE: string = `${DASHBOARD_APP}/Pages/Settings/APIKeys.tsx`;
const API_KEY_PAGE: string = `${DASHBOARD_APP}/Pages/Settings/APIKeyView.tsx`;
const API_KEY_FORM: string = `${DASHBOARD_APP}/Components/ApiKey/ApiKeyCreateForm.ts`;
const API_KEY_SHOWN_ONCE: string = `${DASHBOARD_APP}/Components/ApiKey/ApiKeyShownOnceCopy.ts`;
const API_KEY_PERMISSIONS: string = `${DASHBOARD_APP}/Components/ApiKey/ApiKeyPermissionTable.tsx`;
const ROLE_ACCESS: string = `${DASHBOARD_APP}/Components/Permission/RoleAccess.ts`;

// "POST /api/<resource>/get-list": a request of the requests table.
const REQUEST_CELL: RegExp = /^(GET|POST|PUT|DELETE) \/api\/<resource>(\S*)$/;
// A route BaseAPI registers: router.post(`${...getCrudApiPath()...}/get-list`.
const ROUTE_REGISTRATION: RegExp =
  /router\.(get|post|put|delete)\(\s*`\$\{new this\.entityType\(\)\.getCrudApiPath\(\)\?\.toString\(\)\}([^`]*)`/g;
// The single-quoted JSON body of a curl command: -d '{ ... }'.
const CURL_BODY: RegExp = /-d '(\{[\s\S]*?\})'/;
// "If not: 400", in a diagram's label: the status a check answers.
const DIAGRAM_STATUS: RegExp = /If not:(?: |<br\/>)(\d{3}(?: or \d{3})?)/g;
// A line that names a refusal's code: - `"refusalCode": "name_taken"`: ...
const REFUSAL_CODE_LINE: RegExp = /^- `([^`]+)`: /;
// A card's title in the Access picker: `title: "Viewer",`.
const OPTION_TITLE: RegExp = /title: "([^"]+)",/g;

// Every code block of a page in a language, as written.
function codeBlocks(markdown: string, language: string): Array<string> {
  return scanMarkdown(markdown)
    .fences.filter((fence: { lang: string }): boolean => {
      return fence.lang === language;
    })
    .map((fence: { code: string }): string => {
      return fence.code;
    });
}

// The source of one method of BaseAPI, from its signature to the next one's.
function baseApiMethod(name: string): string {
  const source: string = readRepoFile(BASE_API);
  const start: number = source.indexOf(`public async ${name}(`);

  if (start < 0) {
    throw new Error(`BaseAPI has no method ${name}`);
  }

  const next: number = source.indexOf("@CaptureSpan()", start);

  return source.slice(start, next > start ? next : source.length);
}

// "METHOD /suffix" of every route BaseAPI registers for a resource.
function registeredRoutes(): Array<string> {
  return Array.from(readRepoFile(BASE_API).matchAll(ROUTE_REGISTRATION)).map(
    (match: RegExpMatchArray): string => {
      return `${(match[1] as string).toUpperCase()} ${match[2] as string}`;
    },
  );
}

describe("OneUptime API Reference: a request and its answer", () => {
  const page: string = englishPage(API_REFERENCE);

  it("lists the six requests every resource has, as BaseAPI routes them, with what each body holds", () => {
    const rows: Array<Array<string>> = tableWithHeader(
      englishSection(API_REFERENCE, "## Requests and answers"),
      "Request",
    );
    const routes: Array<string> = registeredRoutes();
    const requests: Array<string> = rows.map((row: Array<string>): string => {
      const cell: string = codeIn(row[1] as string)[0] as string;
      const match: RegExpMatchArray | null = cell.match(REQUEST_CELL);

      expect({ cell, request: Boolean(match) }).toEqual({
        cell,
        request: true,
      });

      return `${match![1]} ${(match![2] as string).replace("<id>", ":id")}`;
    });

    expect(
      rows.map((row: Array<string>): string => {
        return row[0] as string;
      }),
    ).toEqual([
      "List",
      "Count",
      "Read one",
      "Create",
      "Change one",
      "Delete one",
    ]);

    for (const request of requests) {
      expect(routes).toContain(request);
    }

    // The POST-only twins of a change and a delete.
    expect(routes).toContain("POST /:id/update-item");
    expect(routes).toContain("POST /:id/delete-item");
    expect(page).toContain(
      "`POST /api/<resource>/<id>/update-item` and `POST /api/<resource>/<id>/delete-item` change and delete one record too, for clients that send only `POST`.",
    );

    // What each handler reads from the body.
    expect(baseApiMethod("getList")).toContain('req.body["query"]');
    expect(baseApiMethod("getList")).toContain('req.body["select"]');
    expect(baseApiMethod("getList")).toContain('req.body["sort"]');
    expect(baseApiMethod("count")).toContain('req.body["query"]');
    expect(baseApiMethod("getItem")).toContain('req.body["select"]');
    expect(baseApiMethod("createItem")).toContain('body["data"]');
    expect(baseApiMethod("updateItem")).toContain('body["data"]');
    expect(
      rows.map((row: Array<string>): Array<string> => {
        return codeIn(row[2] as string);
      }),
    ).toEqual([
      ["query", "select", "sort"],
      ["query"],
      ["select"],
      ['{ "data": { ... } }'],
      ['{ "data": { ... } }'],
      [],
    ]);
  });

  it("serves every resource under /api and its own path", () => {
    expect(getApiBaseUrl("https://oneuptime.com")).toBe(
      "https://oneuptime.com/api",
    );
    expect(new Monitor().crudApiPath?.toString()).toBe("/monitor");
    expect(page).toContain(
      "Every resource has the same requests, under `https://oneuptime.com/api` and the resource's path, such as `/monitor` or `/incident`:",
    );
  });

  it("filters with the comparisons the API deserializes, under the names the page gives them", () => {
    const rows: Array<Array<string>> = tableWithHeader(
      englishSection(API_REFERENCE, "### Filter, sort and page"),
      "`_type`",
    );
    const types: Array<string> = rows.flatMap(
      (row: Array<string>): Array<string> => {
        return codeIn(row[0] as string);
      },
    );

    expect(types).toEqual([
      "Search",
      "NotEqual",
      "GreaterThan",
      "LessThan",
      "InBetween",
      "Includes",
      "IsNull",
      "NotNull",
    ]);

    for (const type of types) {
      expect(Object.values(ObjectType)).toContain(type);
      expect({
        type,
        deserialized: Boolean(SerializableObjectDictionary[type]),
      }).toEqual({ type, deserialized: true });
    }

    // InBetween reads the two values the page names.
    const range: InBetween<number> = JSONFunctions.deserializeValue({
      _type: ObjectType.InBetween,
      startValue: 1,
      endValue: 9,
    }) as InBetween<number>;

    expect([range.startValue, range.endValue]).toEqual([1, 9]);
  });

  it("filters through a relation, held to the read of the field it compares", () => {
    const sentence: string = lineStartingWith(
      englishSection(API_REFERENCE, "### Filter, sort and page"),
      "A field of a record the resource names is filtered under its relation:",
    );
    const [example, status] = codeIn(sentence) as [string, string];

    // The page's example is a relation filter the API deserializes.
    const filter: JSONObject = JSONFunctions.deserialize(
      JSON.parse(`{${example}}`) as JSONObject,
    );
    const userFilter: JSONObject = filter["user"] as JSONObject;

    expect(userFilter["name"]).toBeInstanceOf(Search);
    expect((userFilter["name"] as Search<string>).value).toBe("ada");
    expect(sentence).toContain(
      'finds the team members whose user\'s name contains "ada".',
    );

    // A team member's user, and a field every reader of the relation may see.
    expect(new TeamMember().getTableColumnMetadata("user").modelType).toBe(
      User,
    );
    expect(
      new User().getTableColumnMetadata("name").canReadOnRelationQuery,
    ).toBe(true);

    /*
     * The read check walks a filter into the relation it names and refuses
     * a field the caller may not read, in words that name it.
     */
    const queryPermission: string = readRepoFile(QUERY_PERMISSION);

    expect(queryPermission).toContain(
      "QueryPermission.checkRelationFilterPermission({",
    );
    expect(queryPermission).toContain(
      "ColumnRefusalMessage.getRelationQueryRefusal({",
    );
    expect(queryPermission).toContain("throw new NotAuthorizedException(");
    expect(
      ColumnRefusalMessage.getRelationQueryRefusal({
        column: "password",
        relatedModelName: "SMTP Config",
        relationColumn: "smtpConfig",
        permissions: [Permission.ProjectOwner],
      }),
    ).toContain("password");
    expect(status).toBe(String(ExceptionCode.NotAuthorizedException));
    expect(sentence).toContain(
      "a filter on a field you may not read is refused with a `422` that names it.",
    );
  });

  it("through a relation, a field only its own person may read is refused to everyone (#9895, #10176)", () => {
    const sentence: string = lineStartingWith(
      englishSection(API_REFERENCE, "### Filter, sort and page"),
      "A field of a record the resource names is filtered under its relation:",
    );

    expect(sentence).toContain(
      "Through a relation, a field only its own person may read, such as a user's time zone or their notification methods and on-call logs, is refused to everyone, in a filter and a sort alike, because the relation can name anyone's record.",
    );

    // A user's time zone, an SMS method's verification, an on-call log's status: only their person reads them.
    for (const [model, column] of [
      [new User(), "timezone"],
      [new UserSMS(), "isVerified"],
      [new UserOnCallLogTimeline(), "status"],
    ] as Array<[BaseModel, string]>) {
      expect(model.getColumnAccessControlFor(column)?.read).toEqual([
        Permission.CurrentUser,
      ]);
      expect(
        PendingInviteeProfiles.getPermissionsNotCountedThroughRelation(model),
      ).toEqual([Permission.CurrentUser]);
    }

    // The rule a filter and a sort through a relation are both held to.
    expect(readRepoFile(QUERY_PERMISSION)).toContain(
      "PendingInviteeProfiles.getPermissionsNotCountedThroughRelation(",
    );
    expect(
      readRepoFile("Common/Server/Types/Database/Permissions/SortValidator.ts"),
    ).toContain("QueryPermission.canFilterOrOrderByRelatedColumn({");
  });

  it("filters by who owns a record under owners, as the API reads OwnedBy", () => {
    const sentence: string = lineStartingWith(
      englishSection(API_REFERENCE, "### Filter, sort and page"),
      "A resource with owners - a monitor, an incident, an on-call policy and every other one with user and team owners - is also filtered by who owns it",
    );
    const [key, example, matchKey, ...rest] = codeIn(sentence) as Array<string>;

    // Under "owners", the one key every query puts it under.
    expect(key).toBe(OWNED_BY_QUERY_KEY);
    expect(matchKey).toBe("match");

    // The page's example is a filter the API deserializes, once its ids are real.
    const userId: string = ObjectID.generate().toString();
    const teamId: string = ObjectID.generate().toString();
    const exampleQuery: JSONObject = JSON.parse(
      `{${(example as string)
        .replace('"userIds": ["..."]', `"userIds": ["${userId}"]`)
        .replace('"teamIds": ["..."]', `"teamIds": ["${teamId}"]`)}}`,
    ) as JSONObject;
    const filter: JSONObject = JSONFunctions.deserialize(exampleQuery);
    const ownedBy: OwnedBy = filter[OWNED_BY_QUERY_KEY] as OwnedBy;

    expect(ownedBy).toBeInstanceOf(OwnedBy);
    expect(ownedBy.userIds).toEqual([userId]);
    expect(ownedBy.teamIds).toEqual([teamId]);
    // AnyOf unless a match is set.
    expect(ownedBy.match).toBe(OwnedByMatch.AnyOf);
    expect(sentence).toContain(
      "finds the records owned by one or more of those people and teams. `match` is `AnyOf` unless you set it:",
    );

    // Every match there is, in the page's order, and the two that name no one.
    expect(rest.slice(0, 4)).toEqual([
      OwnedByMatch.AnyOf,
      OwnedByMatch.NoneOf,
      OwnedByMatch.AnyOwner,
      OwnedByMatch.NoOwner,
    ]);
    expect(Object.values(OwnedByMatch).sort()).toEqual(
      [...rest.slice(0, 4)].sort(),
    );
    expect(() => {
      return new OwnedBy({ match: OwnedByMatch.NoOwner, userIds: [userId] });
    }).toThrow(BadDataException);
    expect(
      new OwnedBy({ match: OwnedByMatch.AnyOwner }).toJSON()["match"],
    ).toBe(OwnedByMatch.AnyOwner);

    // At most 1,000 people and teams together.
    expect(MAX_OWNED_BY_IDS).toBe(1000);
    expect(sentence).toContain(
      `One filter names at most ${(1000).toLocaleString("en-US")} people and teams together`,
    );
    expect(() => {
      return new OwnedBy({
        userIds: Array.from({ length: 600 }, (): string => {
          return ObjectID.generate().toString();
        }),
        teamIds: Array.from({ length: 401 }, (): string => {
          return ObjectID.generate().toString();
        }),
      });
    }).toThrow(BadDataException);

    /*
     * The kinds the page names have owner tables of their own - a person's
     * and a team's, so a team's members are not owners of what it owns - and
     * a kind without owners refuses the filter with a 400.
     */
    for (const kind of [Monitor, Incident, OnCallDutyPolicy]) {
      const tables: OwnerTablesOfKind | null =
        OwnedByFilter.getOwnerTables(kind);

      expect([kind.name, tables?.userTable.ownerColumnName]).toEqual([
        kind.name,
        "userId",
      ]);
      expect([kind.name, tables?.teamTable.ownerColumnName]).toEqual([
        kind.name,
        "teamId",
      ]);
    }

    expect(OwnedByFilter.getOwnerTables(Label)).toBeNull();
    expect(OwnedByFilter.getNoOwnersException(Label)).toBeInstanceOf(
      BadDataException,
    );
    expect(rest[4]).toBe(String(ExceptionCode.BadDataException));
    expect(sentence).toContain(
      "a resource without owners refuses it with a `400`",
    );

    // Reading the owner tables is held to their read permission: a 422.
    const queryPermission: string = readRepoFile(QUERY_PERMISSION);

    expect(queryPermission).toContain(
      "QueryPermission.checkOwnedByPermission({",
    );
    expect(rest[5]).toBe(String(ExceptionCode.NotAuthorizedException));
    expect(sentence).toContain(
      "filtering by owners without permission to read them is refused with a `422`.",
    );
  });

  it("runs the worked example: a search and a date comparison, newest first", () => {
    const section: string = englishSection(
      API_REFERENCE,
      "### Filter, sort and page",
    );
    const example: string = codeBlocks(section, "bash")[0] as string;
    const body: JSONObject = JSON.parse(
      (example.match(CURL_BODY) as RegExpMatchArray)[1] as string,
    ) as JSONObject;
    const query: JSONObject = JSONFunctions.deserialize(
      body["query"] as JSONObject,
    );

    expect(query["name"]).toBeInstanceOf(Search);
    expect((query["name"] as Search<string>).value).toBe("checkout");
    expect(query["createdAt"]).toBeInstanceOf(GreaterThan);
    expect(Object.values(SortOrder)).toContain(
      (body["sort"] as JSONObject)["createdAt"],
    );
    expect(Number(body["limit"])).toBeLessThanOrEqual(LIMIT_PER_PROJECT);
    expect(section).toContain(
      'For example, the monitors whose name contains "checkout", created since the start of 2026, newest first:',
    );
    expect(example).toContain(
      `-H "ApiKey: $${ONEUPTIME_API_KEY_ENVIRONMENT_VARIABLE}"`,
    );
  });

  it("pages with the API's own limits, its default sort and the fields every answer carries", () => {
    const section: string = englishSection(
      API_REFERENCE,
      "### Filter, sort and page",
    );
    const database: string = readRepoFile(DATABASE_SERVICE);
    const getList: string = baseApiMethod("getList");

    expect(DEFAULT_LIMIT).toBe(10);
    expect(LIMIT_PER_PROJECT).toBe(10000);
    expect(LIMIT_MAX).toBe(10000);
    // More than the limit is refused; the limit itself is allowed.
    expect(getList).toContain("if (limit.toNumber() > LIMIT_PER_PROJECT)");
    expect(getList).toContain('req.query["skip"]');
    expect(getList).toContain('req.body["limit"]');
    expect(database).toContain('(onBeforeFind.select as any)["_id"] = true;');
    expect(database).toContain("createdAt: SortOrder.Descending,");
    expect(Object.values(SortOrder)).toEqual(["ASC", "DESC"]);
    expect(section).toContain(
      "`select` names the fields to return, and `_id` always comes back. `sort` orders them, `ASC` or `DESC`; without one, the newest come first. A list returns 10 records unless you set `limit`, up to 10,000",
    );
  });

  /*
   * #8114: a list's count can stop at a cap (BaseAPI.getList's countUpTo),
   * which the dashboard's lists have asked for since they say "10,000+". The
   * page says how to ask for it, how far the count then goes, and what the
   * answer says - held to the code that reads it and the answer it writes.
   */
  it("caps a list's count when asked, and says when more match, as BaseAPI.getCountUpTo and getList do", () => {
    const section: string = englishSection(
      API_REFERENCE,
      "### Filter, sort and page",
    );
    const getList: string = baseApiMethod("getList");
    const listRequest: (data: {
      query?: JSONObject;
      body?: JSONObject;
    }) => ExpressRequest = (data: {
      query?: JSONObject;
      body?: JSONObject;
    }): ExpressRequest => {
      return {
        query: data.query || {},
        body: data.body || {},
      } as unknown as ExpressRequest;
    };

    expect(section).toContain(
      'On a long list, counting every match takes time: add `countUpTo`, such as `10000`, and the count stops there, or at the end of the page if that is further. When more records match, `count` is where it stopped and the answer also carries `"isCountCapped": true`: with `"countUpTo": 1`, that says whether more records follow the page.',
    );

    // Asked for in the body or the query string, as skip and limit are.
    expect(
      BaseAPI.getCountUpTo(listRequest({ body: { countUpTo: 10000 } })),
    ).toBe(10000);
    expect(
      BaseAPI.getCountUpTo(listRequest({ query: { countUpTo: "1" } })),
    ).toBe(1);
    // Not asked for: every match is counted, as before.
    expect(BaseAPI.getCountUpTo(listRequest({}))).toBeUndefined();
    expect(() => {
      BaseAPI.getCountUpTo(listRequest({ body: { countUpTo: 0 } }));
    }).toThrow(BadRequestException);

    // The count stops at countUpTo, or at the end of the page if that is further.
    expect(getList).toContain(
      "const countUpTo: number | undefined = BaseAPI.getCountUpTo(req);",
    );
    expect(getList).toContain(
      "Math.max(countUpTo, skip.toNumber() + limit.toNumber())",
    );
    expect(getList).toContain("upTo: countCap");

    // More matched: the count is where it stopped, and the answer says so.
    expect(getList).toContain(
      "if (countCap !== undefined && count.toNumber() > countCap) {",
    );
    expect(getList).toContain("new PositiveNumber(countCap)");
    expect(getList).toContain("{ isCountCapped: true }");

    const capped: JSONObject = new ListData({
      data: [],
      count: new PositiveNumber(10000),
      skip: new PositiveNumber(0),
      limit: new PositiveNumber(DEFAULT_LIMIT),
      isCountCapped: true,
    }).toJSON();
    const exact: JSONObject = new ListData({
      data: [],
      count: new PositiveNumber(240),
      skip: new PositiveNumber(0),
      limit: new PositiveNumber(DEFAULT_LIMIT),
    }).toJSON();

    expect(capped["isCountCapped"]).toBe(true);
    expect(capped["count"]).toBe(10000);
    expect(exact["isCountCapped"]).toBeUndefined();
  });

  it("answers a list as data and count, as CSV on request, with dates and IDs wrapped", () => {
    const listed: JSONObject = new ListData({
      data: [],
      count: new PositiveNumber(0),
      skip: new PositiveNumber(0),
      limit: new PositiveNumber(DEFAULT_LIMIT),
    }).toJSON();
    const wrappedDate: JSONObject = JSONFunctions.serializeValue(
      new Date(),
    ) as JSONObject;
    const wrappedId: JSONObject = JSONFunctions.serializeValue(
      ObjectID.generate(),
    ) as JSONObject;
    const wrapped: string =
      'Dates and IDs other than `_id` come back wrapped, as `{ "_type": "DateTime", "value": "..." }` and `{ "_type": "ObjectID", "value": "..." }`: read them from `value`.';

    expect(Object.keys(listed)).toEqual(
      expect.arrayContaining(["data", "count"]),
    );
    expect(wrappedDate["_type"]).toBe(ObjectType.DateTime);
    expect(wrappedId["_type"]).toBe(ObjectType.ObjectID);
    expect(readRepoFile(RESPONSE)).toContain(
      'oneUptimeRequest.query["output-type"] === "csv"',
    );
    expect(page).toContain(
      "Add `?output-type=csv` to a list request for CSV instead of JSON.",
    );
    expect(page).toContain(wrapped);
    expect(englishPage(CMDB_SYNC)).toContain(wrapped);
  });

  /*
   * The production 500 this page now answers for: a list filtered by an
   * object in place of an ID went to Postgres as the uuid "[object Object]".
   * Every ID a filter or a write gives is held to the rule here
   * (UUIDColumnFilter), and the page quotes the refusal word for word.
   */
  it("takes an ID as text or wrapped, and refuses anything else with a 400 that names the field, in the server's own words", () => {
    const section: string = englishSection(
      API_REFERENCE,
      "### Filter, sort and page",
    );
    const sentence: string = lineStartingWith(
      section,
      "Every ID a request filters by or writes",
    );
    const id: string = ObjectID.generate().toString();

    type RefusalOfFunction = (run: () => unknown) => BadDataException;

    const refusalOf: RefusalOfFunction = (
      run: () => unknown,
    ): BadDataException => {
      try {
        run();
      } catch (error) {
        return error as BadDataException;
      }

      throw new Error("Nothing was refused.");
    };

    const filter: (value: unknown) => unknown = (value: unknown): unknown => {
      return UUIDColumnFilter.normalizeFilter({
        columnName: "currentIncidentStateId",
        column: new Incident().getTableColumnMetadata("currentIncidentStateId"),
        value: value,
      });
    };

    // Text and the wrapped form are both an ID; the wrapped one reads as its text.
    expect(filter(id)).toBe(id);
    expect(filter({ _type: ObjectType.ObjectID, value: id })).toBe(id);

    // The refusal the page quotes, word for word, and its status.
    const refused: BadDataException = refusalOf(() => {
      return filter("resolved");
    });

    expect(refused).toBeInstanceOf(BadDataException);
    expect(refused.code).toBe(ExceptionCode.BadDataException);
    expect(String(ExceptionCode.BadDataException)).toBe("400");
    expect(codeBlocks(section, "text")).toEqual([refused.message]);
    expect(refused.message).toContain(EXAMPLE_UUID);

    // An object in place of an ID - the production request - is refused too.
    expect(
      refusalOf(() => {
        return filter({ _id: id });
      }).message,
    ).toContain('Invalid ID for "currentIncidentStateId" in the query:');

    // A write says "data", and holds a relation's records to the same rule.
    expect(
      refusalOf(() => {
        return UUIDColumnFilter.normalizeWrittenValue({
          columnName: "monitorId",
          column: new Alert().getTableColumnMetadata("monitorId"),
          value: "checkout-api",
        });
      }).message,
    ).toContain('Invalid ID for "monitorId" in the data:');
    expect(
      refusalOf(() => {
        return UUIDColumnFilter.normalizeWrittenValue({
          columnName: "labels",
          column: new Monitor().getTableColumnMetadata("labels"),
          value: [{ _id: "production" }],
        });
      }).message,
    ).toContain('Invalid ID for "labels" in the data:');
    expect(
      UUIDColumnFilter.normalizeWrittenValue({
        columnName: "labels",
        column: new Monitor().getTableColumnMetadata("labels"),
        value: [{ _id: id }],
      }),
    ).toEqual([{ _id: id }]);

    expect(sentence).toContain(
      'Every ID a request filters by or writes - `_id`, a field such as `monitorId`, and each record a relation lists, such as `"labels": [{ "_id": "..." }]` - is a UUID, sent as text or wrapped the way it comes back.',
    );
    expect(sentence).toContain(
      "is refused with a `400` that names the field and says whether it was in the `query` or the `data`, and nothing is read or written:",
    );
  });

  it("gives each status code the exception the server answers it with", () => {
    const rows: Array<Array<string>> = tableWithHeader(
      englishSection(API_REFERENCE, "### Status codes"),
      "Code",
    );

    expect(
      rows.map((row: Array<string>): string => {
        return codeIn(row[0] as string)[0] as string;
      }),
    ).toEqual(["200", "400", "402", "404", "413", "422", "500"]);
    expect(ExceptionCode.BadDataException).toBe(400);
    expect(ExceptionCode.PaymentRequiredException).toBe(402);
    expect(ExceptionCode.NotFoundException).toBe(404);
    expect(ExceptionCode.NotAuthorizedException).toBe(422);
    expect(ExceptionCode.ServerException).toBe(500);

    // An unusable key is bad data (400), a key below its plan a 402.
    const authorization: string = readRepoFile(PROJECT_AUTHORIZATION);

    expect(authorization).toContain(
      'throw new BadDataException("Invalid API Key");',
    );
    expect(authorization).toContain("throw planRefusal;");
    expect(rowStartingWith(rows, "`400`")[1]).toContain(
      "the API key is invalid",
    );

    // A read by ID of a record the caller may not read is a 404.
    expect(baseApiMethod("getItem")).toContain("throw new NotFoundException(");

    // A key with no permission for a kind of record is refused with 422.
    const tablePermission: string = readRepoFile(TABLE_PERMISSION);

    expect(tablePermission).toContain("throw new NotAuthorizedException(");
    expect(tablePermission).toContain(
      "`You do not have permissions to ${type} ${",
    );
    expect(rowStartingWith(rows, "`422`")[1]).toContain(
      "the API key has no permission for this kind of record",
    );
  });

  /*
   * #10183: StartServer holds a body to its route's limit before anything
   * else is read: 1 MB and 100,000 JSON values on most routes, 50 MB on the
   * ones that take a file, a dashboard or a status page.
   */
  it("says the body limits the server holds a request to, and the settings that raise them", () => {
    const row: string = rowStartingWith(
      tableWithHeader(
        englishSection(API_REFERENCE, "### Status codes"),
        "Code",
      ),
      "`413`",
    )[1] as string;

    expect(ORDINARY_REQUEST_BODY_LIMIT).toEqual({
      bytes: 1024 * 1024,
      values: 100000,
      objectsArraysAndStrings: 100000,
    });
    expect(row).toContain("1 MB holding at most 100,000 JSON values");

    for (const route of [
      "/api/file",
      "/api/dashboard/id",
      "/api/status-page/id",
    ]) {
      expect({
        route,
        bytes: getRequestBodyLimit(route).bytes,
      }).toEqual({ route, bytes: 50 * 1024 * 1024 });
    }
    expect(row).toContain(
      "50 MB in one that sends a file, a dashboard or a status page",
    );

    // The settings that raise the ordinary limit, as EnvironmentConfig reads them.
    const environment: string = readRepoFile(
      "Common/Server/EnvironmentConfig.ts",
    );

    for (const setting of [
      "REQUEST_BODY_MAX_BYTES",
      "REQUEST_BODY_MAX_JSON_VALUES",
    ]) {
      expect(environment).toContain(`"${setting}"`);
      expect(row).toContain(`\`${setting}\``);
    }
  });

  it("draws the checks in the order the server makes them, each with its status", () => {
    const diagram: string = codeBlocks(
      englishSection(API_REFERENCE, "## How a request is answered"),
      "mermaid",
    )[0] as string;
    const statuses: Array<string> = Array.from(
      diagram.matchAll(DIAGRAM_STATUS),
    ).map((match: RegExpMatchArray): string => {
      return match[1] as string;
    });
    const authorization: string = readRepoFile(PROJECT_AUTHORIZATION);

    expect(statuses).toEqual(["400", "402", "404 or 422", "400"]);
    // The key is looked up before the plan is asked about.
    expect(
      authorization.indexOf("ApiKeyService.findApiKey(apiKey)"),
    ).toBeLessThan(
      authorization.indexOf("PlanCutoffCredentialAccess.getRefusal("),
    );
  });

  /*
   * #9855, #9856, #10065: a name another record has is refused with a code
   * beside its sentence, which a client reads in its place, for every kind
   * that has a name of its own. The code says what has the name - a record
   * in service, which may give it up, or an archived one, which will not -
   * and the records that share a name are answered for the four kinds the
   * dashboard marks.
   */
  it("names the codes a taken name is refused with, what each means, and every kind the shared names are answered for", () => {
    const section: string = englishSection(
      API_REFERENCE,
      "#### Names another record has",
    );

    expect(new NameTakenException("x").code).toBe(400);
    expect(new NameTakenException("x").details).toEqual({
      [REFUSAL_CODE_FIELD]: NAME_TAKEN_REFUSAL_CODE,
    });
    expect(new NameTakenException("x", { isArchived: true }).details).toEqual({
      [REFUSAL_CODE_FIELD]: NAME_TAKEN_BY_ARCHIVED_REFUSAL_CODE,
    });
    expect(section).toContain(
      `\`"${REFUSAL_CODE_FIELD}": "${NAME_TAKEN_REFUSAL_CODE}"\``,
    );
    expect(section).toContain(
      `carries a \`${REFUSAL_CODE_FIELD}\` that says what has the name`,
    );

    // Every code the server sends, a line each, in Common's order.
    const codeLines: Array<string> = section
      .split("\n")
      .filter((line: string): boolean => {
        return line.startsWith("- ");
      });

    expect(
      codeLines.map((line: string): string | null => {
        return REFUSAL_CODE_LINE.exec(line)?.[1] || null;
      }),
    ).toEqual(
      NAME_TAKEN_REFUSAL_CODES.map((code: string): string => {
        return `"${REFUSAL_CODE_FIELD}": "${code}"`;
      }),
    );
    expect(NAME_TAKEN_REFUSAL_CODES).toEqual([
      NAME_TAKEN_REFUSAL_CODE,
      NAME_TAKEN_BY_ARCHIVED_REFUSAL_CODE,
    ]);

    // A record in service may give the name up: the provider asks again.
    expect(codeLines[0]).toContain("a record in service has it");
    expect(codeLines[0]).toContain(
      "the Terraform provider asks again for up to 30 seconds",
    );
    // An archived one will not: nothing asks again.
    expect(codeLines[1]).toContain("only an archived record has it");
    expect(codeLines[1]).toContain(
      "sending the request again does not help, and the Terraform provider does not",
    );

    /*
     * The refusals it quotes, word for word: a named kind's, and the one
     * every other kind with a name of its own answers a create with
     * (DatabaseService.refuseTakenName).
     */
    expect(
      codeBlocks(section, "text").map((block: string): string => {
        return block.trim();
      }),
    ).toEqual([
      getNameTakenRefusalText(ON_CALL_POLICY_NAME_TAKEN_REFUSAL, "Primary"),
      `${new IncidentSeverity().singularName} with the same name already exists.`,
    ]);
    expect(readRepoFile(DATABASE_SERVICE)).toContain(
      "`${this.model.singularName} with the same name already exists.`",
    );

    // The route, and each kind it answers for, by the name the route takes.
    expect(section).toContain(
      `\`GET /api${getSharedNamesRoute(SharedNameKind.Team)}\``,
    );

    for (const kind of Object.values(SharedNameKind)) {
      const named: boolean =
        section.includes(`\`GET /api${getSharedNamesRoute(kind)}\``) ||
        section.includes(`\`${kind}\``);

      expect({ kind, named }).toEqual({ kind, named: true });
    }
  });

  /*
   * #10318: the other kinds with a name of their own refuse a rename onto a
   * taken name as they refuse a create, through the update's own check, and
   * records that shared a name before keep it but are never renamed onto
   * another's.
   */
  it("says the other kinds refuse a rename onto a taken name as they refuse a create", () => {
    const section: string = englishSection(
      API_REFERENCE,
      "#### Names another record has",
    );

    expect(section).toContain(
      "refuse a taken name in the same way, on a create and on a rename alike",
    );
    expect(section).toContain(
      "can still be changed, and renamed apart, but never onto another record's name",
    );
    expect(readRepoFile(DATABASE_SERVICE)).toContain(
      "await this.checkUniqueColumnByOnUpdate(beforeUpdateBy);",
    );
  });

  /*
   * #10319: a value that is not a name, but that a record holds alone - a
   * domain, an identifier, a sign-on URL - is refused with codes of its own
   * beside its sentence, and the field whose value is taken, which a client
   * reads in place of the sentence.
   */
  it("names the codes a taken value is refused with, what each means, and the field beside them", () => {
    const section: string = englishSection(
      API_REFERENCE,
      "#### Values another record has",
    );

    expect(new ValueTakenException("x", { field: "fullDomain" }).code).toBe(
      400,
    );
    expect(
      new ValueTakenException("x", { field: "fullDomain" }).details,
    ).toEqual({
      [REFUSAL_CODE_FIELD]: VALUE_TAKEN_REFUSAL_CODE,
      [TAKEN_FIELD_DETAIL]: "fullDomain",
    });
    expect(new ValueTakenException("x", { isArchived: true }).details).toEqual({
      [REFUSAL_CODE_FIELD]: VALUE_TAKEN_BY_ARCHIVED_REFUSAL_CODE,
    });
    expect(section).toContain(
      `carries a \`${REFUSAL_CODE_FIELD}\` that says what has the value, and a \`${TAKEN_FIELD_DETAIL}\` that names the field whose value is taken, such as \`"${TAKEN_FIELD_DETAIL}": "fullDomain"\``,
    );
    expect(section).toContain(
      `A value of several fields together comes without a \`${TAKEN_FIELD_DETAIL}\`.`,
    );

    // Every code the server sends, a line each, in Common's order.
    const codeLines: Array<string> = section
      .split("\n")
      .filter((line: string): boolean => {
        return line.startsWith("- ");
      });

    expect(
      codeLines.map((line: string): string | null => {
        return REFUSAL_CODE_LINE.exec(line)?.[1] || null;
      }),
    ).toEqual(
      VALUE_TAKEN_REFUSAL_CODES.map((code: string): string => {
        return `"${REFUSAL_CODE_FIELD}": "${code}"`;
      }),
    );
    expect(codeLines[0]).toContain("a record in service has it");
    expect(codeLines[0]).toContain(
      "the Terraform provider asks again for up to 30 seconds",
    );
    expect(codeLines[1]).toContain("only an archived record has it");
    expect(codeLines[1]).toContain(
      "sending the request again does not help, and the Terraform provider does not",
    );

    // The refusal it quotes, word for word (DatabaseService.refuseTakenValue).
    expect(
      codeBlocks(section, "text").map((block: string): string => {
        return block.trim();
      }),
    ).toEqual([
      `${new StatusPageDomain().singularName} with the same fullDomain already exists.`,
    ]);
    expect(readRepoFile(DATABASE_SERVICE)).toContain(
      "`${this.model.singularName} with the same ${data.column} already exists.`",
    );
  });
});

/*
 * Fields only OneUptime writes (#10053): the refusal the page quotes is the
 * one the server answers an update with, word for word, and the request
 * the page names for Try again is the route HostAPI serves.
 */
describe("OneUptime API Reference: fields only OneUptime writes", () => {
  const section: string = englishSection(
    API_REFERENCE,
    "### Fields only OneUptime writes",
  );

  it("quotes the refusal an update that names one is answered with", () => {
    const quoted: string = (codeBlocks(section, "text")[0] || "").trim();

    expect(quoted).toBe(
      ColumnRefusalMessage.getWriteRefusal({
        requestType: "update",
        column: "telemetryMonitorLastMonitorAt",
        modelName: new Monitor().singularName,
        permissions: [],
      }),
    );
    expect(
      new Monitor().getTableColumnMetadata("telemetryMonitorLastMonitorAt")
        ?.serverOwned,
    ).toBe(ServerOwned.Always);
  });

  it("says a create goes through without them and an update is refused, as DatabaseService does", () => {
    const writes: string = readRepoFile(
      "Common/Server/Utils/Database/ColumnsOnlyOneUptimeWrites.ts",
    );

    expect(section).toContain(
      "A create that sends one, as a copy of a record you read does, goes through without it",
    );
    expect(section).toContain("An update that sends one is refused");
    expect(writes).toContain("public static takeOut(");
    expect(writes).toContain("public static refuseOnUpdate(");
  });

  it("names the request that tries a host's failed collector config again", () => {
    expect(section).toContain(
      `\`POST /api/host/:id/${TRY_COLLECTOR_CONFIG_AGAIN_ROUTE}\``,
    );
    expect(readRepoFile("Common/Server/API/HostAPI.ts")).toContain(
      "/:id/${TRY_COLLECTOR_CONFIG_AGAIN_ROUTE}",
    );
  });
});

/*
 * A create's fields left out (#10136) and an update's single entries of a
 * list (#10135): the header, the keys and the refusal the page names are
 * the server's, word for word, and its example is a body the server takes.
 */
describe("OneUptime API Reference: the fields a create left out, and a list's single entries", () => {
  const fieldsSection: string = englishSection(
    API_REFERENCE,
    "### Fields only OneUptime writes",
  );
  const listsSection: string = englishSection(
    API_REFERENCE,
    "### Adding entries to a list and taking them off",
  );

  it("names the header a create's answer lists the fields it left out in, and the clients that read it", () => {
    expect(fieldsSection).toContain(`\`${FIELDS_LEFT_OUT_HEADER}\` header`);
    expect(fieldsSection).toContain("the fields separated by commas");
    expect(FieldsLeftOut.toHeaderValue(["depth", "lastRollupAt"])).toBe(
      "depth, lastRollupAt",
    );
    expect(FieldsLeftOut.fromHeaderValue("depth, lastRollupAt")).toEqual([
      "depth",
      "lastRollupAt",
    ]);

    // Only an answer that left something out carries it.
    expect(fieldsSection).toContain(
      "an answer with nothing left out has no such header",
    );
    expect(readRepoFile(BASE_API)).toContain(
      "if (createBy.fieldsLeftOut && createBy.fieldsLeftOut.length > 0) {",
    );

    // The CLI's note, the MCP server's field and the provider's warning.
    expect(fieldsSection).toContain(
      "The CLI prints the fields in a note, the MCP server's answer lists them in `fieldsLeftOut`, and the Terraform provider shows them in a warning.",
    );
    expect(readRepoFile("CLI/Commands/ResourceCommands.ts")).toContain(
      "FieldsLeftOut.getNote(",
    );
    expect(
      readRepoFile("App/FeatureSet/MCP/Handlers/ToolHandler.ts"),
    ).toContain("fieldsLeftOut");
    expect(
      readRepoFile("../Scripts/TerraformProvider/StaticFiles/entries.go"),
    ).toContain("diags.AddWarning(");
  });

  it("names the keys a change adds and takes off entries with, and its example is a body the server takes", () => {
    const label: string = "6f1b5f4e-0a43-4f0e-9a6b-5f3b2f0c8d11";
    const otherLabel: string = "9c2e7a10-3b5d-4c8e-8f61-2d4a6b7c9e02";

    expect(listsSection).toContain(`\`${ADD_TO_LIST_KEY}\``);
    expect(listsSection).toContain(`\`${REMOVE_FROM_LIST_KEY}\``);
    expect(listsSection).toContain("Sent to `PUT /api/monitor/<id>`");

    const example: string = (codeBlocks(listsSection, "json")[0] || "")
      .split("<label-id>")
      .join(label)
      .split("<other-label-id>")
      .join(otherLabel);
    const body: Record<string, unknown> = JSON.parse(example);

    // The lists the full API reference names under addToList: a monitor's labels among them.
    const listColumns: Array<string> =
      ModelSchema.getListsChangedEntryByEntry(Monitor);
    expect(listColumns).toContain("labels");

    const changes: ListChanges | null = ListChangesUtil.fromRequestBody({
      body: body as never,
      listColumns: listColumns,
      modelName: new Monitor().singularName || "Monitor",
    });

    expect(changes).toEqual({
      labels: { add: [label], remove: [otherLabel] },
    });
    expect(body["data"]).toEqual({ name: "Checkout API" });
  });

  it("quotes the refusal of a list sent both whole, in data, and entry by entry", () => {
    expect((codeBlocks(listsSection, "text")[0] || "").trim()).toBe(
      ListChangesUtil.getSentWholeAndByEntryMessage("labels"),
    );
    expect(readRepoFile("Common/Server/Services/DatabaseService.ts")).toContain(
      "ListChangesUtil.getSentWholeAndByEntryMessage(column)",
    );
  });

  it("links the Terraform guide's section on the lists OneUptime adds to", () => {
    expect(listsSection).toContain(
      "(/docs/terraform/complete-guide#labels-and-other-lists-oneuptime-adds-to)",
    );
    expect(englishPage("terraform/complete-guide").split("\n")).toContain(
      "## Labels and other lists OneUptime adds to",
    );
  });
});

describe("OneUptime API Reference: an API key", () => {
  const page: string = englishPage(API_REFERENCE);

  function firstRequest(): string {
    return englishSection(API_REFERENCE, "## Make your first request");
  }

  it("creates the key under Project Settings, Advanced, API Keys, with the table's create button", () => {
    const menu: string = readRepoFile(SETTINGS_MENU);
    const advanced: string = menu.slice(
      menu.indexOf('title: "Advanced"'),
      menu.indexOf('title: "Security"'),
    );

    expect(advanced).toContain('title: "API Keys"');
    expect(`Create ${new ApiKey().singularName}`).toBe("Create API Key");
    expect(firstRequest()).toContain(
      "Open **Project Settings → Advanced → API Keys** and click **Create API Key**.",
    );
    expect(englishPage(CMDB_SYNC)).toContain(
      "Open **Project Settings → Advanced → API Keys** and click **Create API Key**.",
    );
  });

  it("asks for a name and an access the Access picker offers, and dates the key a year ahead under Advanced", () => {
    const access: string = readRepoFile(ROLE_ACCESS);
    const options: string = access.slice(
      access.indexOf("const ROLE_OPTIONS"),
      access.indexOf("export const TEAM_ACCESS_LATER_OPTION"),
    );
    const titles: Array<string> = Array.from(
      options.matchAll(OPTION_TITLE),
    ).map((match: RegExpMatchArray): string => {
      return match[1] as string;
    });
    const form: string = readRepoFile(API_KEY_FORM);
    const line: string = lineStartingWith(
      firstRequest(),
      "Open **Project Settings",
    );

    expect(titles).toEqual([
      "Project Admin",
      "Project Member",
      "Viewer",
      "Choose permissions later",
    ]);
    expect(access).toContain('title: "Access",');
    expect(form).toContain('title: "Name",');
    expect(form).toContain("OneUptimeDate.addRemoveYears(");
    expect(form).toContain('"The key expires a year from today."');
    expect(boldIn(line)).toEqual([
      "Project Settings → Advanced → API Keys",
      "Create API Key",
      "Name",
      "Access",
      ...titles,
      "Advanced",
    ]);
    expect(line).toContain(
      "The key expires a year from today unless you pick another date under **Advanced**.",
    );
  });

  /*
   * A key is stored as its hash (#8902): the create shows it once, in a
   * dialog that Done closes, and no page shows it again. The key's page
   * says how it ends (#8903) and when it expires, which is how the
   * troubleshooting finds it.
   */
  it("shows the new key once, in the Copy Your API Key dialog, and finds it by how it ends", () => {
    const keys: string = readRepoFile(API_KEYS_PAGE);
    const view: string = readRepoFile(API_KEY_PAGE);
    const shownOnce: string = readRepoFile(API_KEY_SHOWN_ONCE);

    expect(keys).toContain("<ShownOnceSecretModal");
    expect(keys).toContain("title={ApiKeyShownOnceCopy.shownOnceTitle}");
    expect(keys).toContain("doneButtonText={ApiKeyShownOnceCopy.done}");
    expect(shownOnce).toContain(
      'shownOnceTitle: translationKey("Copy Your API Key")',
    );
    expect(shownOnce).toContain('done: translationKey("Done")');
    expect(view).toContain('title: "API Key Details"');
    expect(view).toContain('title: "API Key",');
    expect(view).toContain("<ApiKeyHint hint={item.apiKeyHint} />");
    expect(view).toContain('title: "Expires",');
    expect(firstRequest()).toContain(
      "OneUptime shows the key once, in the **Copy Your API Key** dialog: copy it before you press **Done**, as no page shows it again.",
    );
    expect(page).toContain(
      "Find the key under **Project Settings → Advanced → API Keys** by how it ends, and check its **Expires** date. A key you no longer have cannot be shown again: reset it on its page for a new one.",
    );
  });

  it("adds a role or a single permission from the key's Permissions card", () => {
    const permissions: string = readRepoFile(API_KEY_PERMISSIONS);

    expect(permissions).toContain('title: "Add Role",');
    expect(permissions).toContain('title: "Add Permission",');
    expect(page).toContain("then click **Add Role** or **Add Permission**.");
    expect(englishPage(CMDB_SYNC)).toContain(
      "On the key's page, click **Add Permission** and pick it.",
    );
  });

  it("exports the key and sends it in the ApiKey header, as the Developer pages do", () => {
    const authorization: string = readRepoFile(PROJECT_AUTHORIZATION);
    const command: string = getCurlCommand({
      method: "POST",
      url: "https://oneuptime.com/api/monitor/get-list",
      body: { select: { name: true } },
    });
    // The part of the Developer pages' command that sends the key.
    const header: string | undefined = command
      .split(" \\\n  ")
      .find((part: string): boolean => {
        return part.includes("ApiKey");
      });

    // Node lower-cases header names: ApiKey reaches the server as apikey.
    expect(authorization).toContain('req.headers?.["apikey"]');
    expect(header).toBe(
      `-H "ApiKey: $${ONEUPTIME_API_KEY_ENVIRONMENT_VARIABLE}"`,
    );

    for (const markdown of [page, englishPage(CMDB_SYNC)]) {
      const scripts: Array<string> = codeBlocks(markdown, "bash");

      expect(scripts).toContain(getApiKeyExportCommand());

      for (const script of scripts) {
        if (script.startsWith("curl ")) {
          expect(script).toContain(`  ${header} \\`);
        }
      }
    }
  });

  it("reads the key's own project, so a request names none", () => {
    const authorization: string = readRepoFile(PROJECT_AUTHORIZATION);

    expect(authorization).toContain("tenantId = apiKeyRow.projectId;");
    expect(firstRequest()).toContain(
      "The key reads its own project, so the request names no project:",
    );
    expect(englishPage(CMDB_SYNC)).toContain(
      "The key is sent in the `ApiKey` header of each request, and it reads its own project's inventory, so a request names no project.",
    );
  });

  it("sells API keys on Growth", () => {
    expect(new ApiKey().createBillingPlan).toBe(PlanType.Growth);
    expect(englishPage(CMDB_SYNC)).toContain(
      "On OneUptime Cloud, API keys need the **Growth** plan or above.",
    );
  });

  it("quotes the server's own messages in its troubleshooting", () => {
    const troubleshooting: string = englishSection(
      API_REFERENCE,
      "## Troubleshooting",
    );
    const message: string = codeBlocks(troubleshooting, "text")[0] as string;

    expect(baseApiMethod("updateItem")).toContain(`'${message.trim()}'`);
    expect(readRepoFile(PROJECT_AUTHORIZATION)).toContain('"Invalid API Key"');
    expect(troubleshooting).toContain(
      ":::details Every request answers 400 Invalid API Key",
    );
    expect(troubleshooting).toContain(
      ":::details Every request answers 422 You do not have permissions",
    );
    expect(readRepoFile(TABLE_PERMISSION)).toContain(
      "You need one of these permissions: ${permissions.join",
    );
  });
});

describe("Exporting to a CMDB: the requests", () => {
  const page: string = englishPage(CMDB_SYNC);

  it("pulls the three resources from their own API paths", () => {
    const rows: Array<Array<string>> = tableWithHeader(
      englishSection(CMDB_SYNC, "## What you can pull"),
      "Resource",
    );

    expect(
      rows.map((row: Array<string>): string => {
        return codeIn(row[1] as string)[0] as string;
      }),
    ).toEqual(
      [InventoryItem, InventoryItemCustomField, InventoryItemRelationship].map(
        (model: {
          new (): { crudApiPath: { toString(): string } | null };
        }): string => {
          return `/api${new model().crudApiPath?.toString()}`;
        },
      ),
    );
  });

  it("names columns an inventory item has, with values the product uses", () => {
    const rows: Array<Array<string>> = tableWithHeader(
      englishSection(CMDB_SYNC, "## What you can pull"),
      "Column",
    );
    const columns: Array<string> = new InventoryItem().getTableColumns()
      .columns;

    for (const row of rows) {
      for (const column of codeIn(row[0] as string)) {
        expect({
          column,
          known: column === "_id" || columns.includes(column),
        }).toEqual({ column, known: true });
      }
    }

    for (const type of codeIn(
      rowStartingWith(rows, "`entityType`")[1] as string,
    )) {
      expect(Object.values(EntityType)).toContain(type);
    }

    expect(codeIn(rowStartingWith(rows, "`source`")[1] as string)).toEqual(
      Object.values(EntitySource),
    );
  });

  it("reads with Read Inventory Item, writes custom fields with Edit and adds items with Create", () => {
    const item: InventoryItem = new InventoryItem();

    expect(item.readRecordPermissions).toContain(
      Permission.ReadTelemetryService,
    );
    expect(item.updateRecordPermissions).toContain(
      Permission.EditTelemetryService,
    );
    expect(item.getColumnAccessControlFor("customFields")?.update).toContain(
      Permission.EditTelemetryService,
    );
    expect(item.createRecordPermissions).toContain(
      Permission.CreateTelemetryService,
    );

    for (const permission of [
      Permission.ReadTelemetryService,
      Permission.EditTelemetryService,
      Permission.CreateTelemetryService,
    ]) {
      expect(page).toContain(bold(PermissionHelper.getTitle(permission)));
    }

    expect(page).toContain(
      "A read-only export needs one permission, **Read Inventory Item**",
    );
    expect(page).toContain("The key needs **Edit Inventory Item** for that.");
    expect(page).toContain("The key needs **Create Inventory Item** for that.");
  });

  it("adds only the types a person may add, and works out their identity key", () => {
    const service: string = readRepoFile(INVENTORY_ITEM_SERVICE);
    const writeBack: string = englishSection(CMDB_SYNC, "## Write back");

    expect(writeBack).toContain(
      `an \`entityType\` of ${listOf(
        [...MANUAL_ENTITY_TYPES].map((type: string): string => {
          return `\`${type}\``;
        }),
        "or",
      )}, and a \`displayName\`.`,
    );
    expect(service).toContain("delete data.entityKey;");
    expect(service).toContain("data.entityKey = computeEntityKey({");
  });

  it("pages through the list within the API's limit, and follows a device to its own record", () => {
    expect(page).toContain("`limit` goes up to 10,000.");
    expect(LIMIT_PER_PROJECT).toBe(10000);
    expect(new NetworkDevice().crudApiPath?.toString()).toBe("/network-device");
    expect(registeredRoutes()).toEqual(
      expect.arrayContaining(["POST /:id/get-item", "POST /get-list"]),
    );
    expect(page).toContain(
      "follow `resourceId` to `/api/network-device/:id/get-item`, or pull `/api/network-device/get-list` directly.",
    );
  });
});

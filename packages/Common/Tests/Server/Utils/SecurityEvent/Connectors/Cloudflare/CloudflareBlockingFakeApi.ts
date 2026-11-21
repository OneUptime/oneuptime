import { JSONArray, JSONObject, JSONValue } from "../../../../../../Types/JSON";
import {
  DataSourceHttpRequest,
  DataSourceHttpResponse,
} from "../../../../../../Server/Utils/DataSource/HttpFetch";
import {
  CLOUDFLARE_ACCESS_RULES_PER_ACCOUNT,
  CLOUDFLARE_PLAN_LIMITS,
  CloudflarePlan,
  readCloudflarePlan,
} from "../../../../../../Types/SecurityBlocklist/CloudflareBlocking";
import CloudflareFakeApi, {
  ACCOUNT_ID,
  FakeRequest,
  FakeZone,
  json,
  restError,
} from "./CloudflareFakeApi";

/*
 * Cloudflare's API as blocking meets it (#10343), answering as Cloudflare
 * documents it: the v4 envelope, an asynchronous bulk operation for every
 * list item write, one pending bulk operation per account, the plans'
 * limits on lists, list items and custom rules, a 403 "Authentication
 * error" (10000) for what the token may not do, and a 400 for a request
 * that asks for nothing it can do. Built on the read fake
 * (CloudflareFakeApi), so the zones and the token are its.
 *
 *   GET, POST, DELETE /accounts/{id}/rules/lists[/{list}]
 *   GET, POST, DELETE /accounts/{id}/rules/lists/{list}/items
 *   GET /accounts/{id}/rules/lists/bulk_operations/{operation}
 *   GET /zones/{id}/rulesets/phases/http_request_firewall_custom/entrypoint
 *   POST /zones/{id}/rulesets
 *   POST, PATCH, DELETE /zones/{id}/rulesets/{ruleset}/rules[/{rule}]
 *   GET, POST, DELETE /accounts/{id}/firewall/access_rules/rules[/{rule}]
 *
 * PUT on a list's items or on an entry point - which replace everything -
 * is answered with a 405 and recorded, for a test to see it is never sent.
 */

export interface FakeListItem {
  id: string;
  ip: string;
  comment: string;
}

export interface FakeList {
  id: string;
  name: string;
  description: string;
  kind: string;
  items: Array<FakeListItem>;
}

export interface FakeRule {
  id: string;
  ref: string;
  action: string;
  expression: string;
  description: string;
  enabled: boolean;
}

export interface FakeRuleset {
  id: string;
  rules: Array<FakeRule>;
}

export interface FakeAccessRule {
  id: string;
  mode: string;
  notes: string;
  target: string;
  value: string;
}

interface FakeOperation {
  id: string;
  // Polls answered "pending" before it is done.
  pollsLeft: number;
  // What it does, once done: a failure says why.
  run: () => string | null;
  status: "pending" | "completed" | "failed";
  error: string;
}

export type FakePermission = "lists" | "waf" | "accessRules";

// A list's name, as Cloudflare takes it: lowercase letters, digits and underscores.
const LIST_NAME: RegExp = /^[a-z0-9_]{1,50}$/;

const AUTHENTICATION_ERROR: [number, number, string] = [
  403,
  10000,
  "Authentication error",
];

function hex32(seed: string, index: number): string {
  let text: string = `${seed}${index.toString(16)}`;

  while (text.length < 32) {
    text = `0${text}`;
  }

  return text.slice(-32);
}

export default class CloudflareBlockingFakeApi extends CloudflareFakeApi {
  // What the token may write; reads of each need the same.
  public permissions: Set<FakePermission> = new Set<FakePermission>([
    "lists",
    "waf",
    "accessRules",
  ]);
  public lists: Array<FakeList> = [];
  public rulesets: Map<string, FakeRuleset> = new Map();
  public accessRules: Array<FakeAccessRule> = [];
  // How many polls a bulk operation answers "pending" before it is done.
  public operationPolls: number = 1;
  // A bulk operation of someone else's, pending in the account.
  public foreignOperationPolls: number = 0;
  public operations: Map<string, FakeOperation> = new Map();
  // Requests that replace everything (PUT), which must never come.
  public replacements: Array<FakeRequest> = [];

  private nextId: number = 1;

  public constructor(zones: Array<FakeZone> = []) {
    super(zones);
  }

  public id(seed: string): string {
    return hex32(seed, this.nextId++);
  }

  // The account's highest plan, as its zones say it.
  public accountPlan(): CloudflarePlan {
    const order: Array<CloudflarePlan> = [
      CloudflarePlan.Free,
      CloudflarePlan.Pro,
      CloudflarePlan.Business,
      CloudflarePlan.Enterprise,
    ];
    let highest: CloudflarePlan = CloudflarePlan.Free;

    for (const zone of this.zones) {
      const plan: CloudflarePlan = readCloudflarePlan(zone.plan?.legacy_id);

      if (order.indexOf(plan) > order.indexOf(highest)) {
        highest = plan;
      }
    }

    return highest;
  }

  public listNamed(name: string): FakeList | undefined {
    return this.lists.find((list: FakeList): boolean => {
      return list.name === name;
    });
  }

  public ruleWithRef(zoneId: string, ref: string): FakeRule | undefined {
    return this.rulesets.get(zoneId)?.rules.find((rule: FakeRule): boolean => {
      return rule.ref === ref;
    });
  }

  // A list the customer made, with items of their own.
  public addCustomerList(name: string, ips: Array<string> = []): FakeList {
    const list: FakeList = {
      id: this.id("c0"),
      name,
      description: "",
      kind: "ip",
      items: ips.map((ip: string): FakeListItem => {
        return { id: this.id("c1"), ip, comment: "Our office" };
      }),
    };
    this.lists.push(list);
    return list;
  }

  // A rule the customer made in a zone.
  public addCustomerRule(zoneId: string, rule: Partial<FakeRule>): FakeRule {
    const ruleset: FakeRuleset = this.rulesets.get(zoneId) || {
      id: this.id("e0"),
      rules: [],
    };
    const made: FakeRule = {
      id: this.id("e1"),
      ref: rule.ref || this.id("e2"),
      action: rule.action || "block",
      expression: rule.expression || "(ip.src eq 192.0.2.1)",
      description: rule.description || "Customer rule",
      enabled: rule.enabled !== false,
    };
    ruleset.rules.push(made);
    this.rulesets.set(zoneId, ruleset);
    return made;
  }

  protected override answerMore(
    recorded: FakeRequest,
    request: DataSourceHttpRequest,
  ): DataSourceHttpResponse | null {
    const path: string = recorded.path.replace(/^\/client\/v4/, "");
    const body: JSONValue = request.body
      ? (JSON.parse(String(request.body)) as JSONValue)
      : null;
    let match: RegExpMatchArray | null;

    if (recorded.method === "PUT") {
      this.replacements.push(recorded);
      return restError(405, 10405, "Method not allowed in this fake");
    }

    // ----- Lists -----
    match = path.match(/^\/accounts\/([^/]+)\/rules\/lists$/);

    if (match) {
      if (!this.permissions.has("lists")) {
        return restError(...AUTHENTICATION_ERROR);
      }

      if (recorded.method === "GET") {
        return this.ok(this.lists.map(this.listJson));
      }

      if (recorded.method === "POST") {
        return this.createList(body as JSONObject);
      }
    }

    match = path.match(
      /^\/accounts\/([^/]+)\/rules\/lists\/bulk_operations\/([^/]+)$/,
    );

    if (match && recorded.method === "GET") {
      return this.pollOperation(match[2]!);
    }

    match = path.match(/^\/accounts\/([^/]+)\/rules\/lists\/([^/]+)\/items$/);

    if (match) {
      if (!this.permissions.has("lists")) {
        return restError(...AUTHENTICATION_ERROR);
      }

      const list: FakeList | undefined = this.lists.find(
        (candidate: FakeList): boolean => {
          return candidate.id === match![2];
        },
      );

      if (!list) {
        return restError(404, 10001, "list not found");
      }

      if (recorded.method === "GET") {
        return this.listItems(list, recorded.query);
      }

      if (recorded.method === "POST") {
        return this.addItems(list, body as JSONArray);
      }

      if (recorded.method === "DELETE") {
        return this.deleteItems(list, body as JSONObject);
      }
    }

    match = path.match(/^\/accounts\/([^/]+)\/rules\/lists\/([^/]+)$/);

    if (match && recorded.method === "DELETE") {
      if (!this.permissions.has("lists")) {
        return restError(...AUTHENTICATION_ERROR);
      }

      const index: number = this.lists.findIndex((list: FakeList): boolean => {
        return list.id === match![2];
      });

      if (index < 0) {
        return restError(404, 10001, "list not found");
      }

      const referenced: boolean = Array.from(this.rulesets.values()).some(
        (ruleset: FakeRuleset): boolean => {
          return ruleset.rules.some((rule: FakeRule): boolean => {
            return rule.expression.includes(`$${this.lists[index]!.name}`);
          });
        },
      );

      if (referenced) {
        return restError(
          400,
          10021,
          "This list is referenced by a filter and cannot be deleted",
        );
      }

      this.lists.splice(index, 1);
      return this.ok({ id: match[2]! });
    }

    // ----- Custom rules -----
    match = path.match(
      /^\/zones\/([^/]+)\/rulesets\/phases\/http_request_firewall_custom\/entrypoint$/,
    );

    if (match && recorded.method === "GET") {
      if (!this.permissions.has("waf")) {
        return restError(...AUTHENTICATION_ERROR);
      }

      const ruleset: FakeRuleset | undefined = this.rulesets.get(match[1]!);

      return ruleset
        ? this.ok(this.rulesetJson(ruleset))
        : restError(
            404,
            10003,
            "could not find entrypoint ruleset in the phase",
          );
    }

    match = path.match(/^\/zones\/([^/]+)\/rulesets$/);

    if (match && recorded.method === "POST") {
      if (!this.permissions.has("waf")) {
        return restError(...AUTHENTICATION_ERROR);
      }

      return this.createRuleset(match[1]!, body as JSONObject);
    }

    match = path.match(/^\/zones\/([^/]+)\/rulesets\/([^/]+)\/rules$/);

    if (match && recorded.method === "POST") {
      if (!this.permissions.has("waf")) {
        return restError(...AUTHENTICATION_ERROR);
      }

      return this.addRule(match[1]!, match[2]!, body as JSONObject);
    }

    match = path.match(/^\/zones\/([^/]+)\/rulesets\/([^/]+)\/rules\/([^/]+)$/);

    if (match) {
      if (!this.permissions.has("waf")) {
        return restError(...AUTHENTICATION_ERROR);
      }

      return this.changeRule(
        recorded.method,
        match[1]!,
        match[2]!,
        match[3]!,
        body as JSONObject,
      );
    }

    // ----- IP Access Rules -----
    match = path.match(/^\/accounts\/([^/]+)\/firewall\/access_rules\/rules$/);

    if (match) {
      if (!this.permissions.has("accessRules")) {
        return restError(...AUTHENTICATION_ERROR);
      }

      if (recorded.method === "GET") {
        return this.listAccessRules(recorded.query);
      }

      if (recorded.method === "POST") {
        return this.createAccessRule(body as JSONObject);
      }
    }

    match = path.match(
      /^\/accounts\/([^/]+)\/firewall\/access_rules\/rules\/([^/]+)$/,
    );

    if (match && recorded.method === "DELETE") {
      if (!this.permissions.has("accessRules")) {
        return restError(...AUTHENTICATION_ERROR);
      }

      const index: number = this.accessRules.findIndex(
        (rule: FakeAccessRule): boolean => {
          return rule.id === match![2];
        },
      );

      if (index < 0) {
        return restError(404, 10009, "access rule not found");
      }

      this.accessRules.splice(index, 1);
      return this.ok({ id: match[2]! });
    }

    return null;
  }

  private ok(
    result: JSONValue,
    extra: JSONObject = {},
  ): DataSourceHttpResponse {
    return json(200, {
      success: true,
      errors: [],
      messages: [],
      result,
      ...extra,
    });
  }

  private listJson(list: FakeList): JSONObject {
    return {
      id: list.id,
      name: list.name,
      description: list.description,
      kind: list.kind,
      num_items: list.items.length,
      num_referencing_filters: 0,
      created_on: "2026-11-20T10:00:00Z",
      modified_on: "2026-11-20T10:00:00Z",
    };
  }

  private createList(body: JSONObject): DataSourceHttpResponse {
    const name: string = String(body["name"] || "");

    if (!LIST_NAME.test(name) || body["kind"] !== "ip") {
      return restError(400, 10001, "list name is invalid");
    }

    if (this.listNamed(name)) {
      return restError(400, 10014, "a list with this name already exists");
    }

    if (this.lists.length >= CLOUDFLARE_PLAN_LIMITS[this.accountPlan()].lists) {
      return restError(
        400,
        10021,
        "exceeded maximum number of lists for this account",
      );
    }

    const list: FakeList = {
      id: this.id("a0"),
      name,
      description: String(body["description"] || ""),
      kind: "ip",
      items: [],
    };
    this.lists.push(list);

    return this.ok(this.listJson(list));
  }

  private listItems(
    list: FakeList,
    query: Record<string, string>,
  ): DataSourceHttpResponse {
    const perPage: number = Math.min(500, Number(query["per_page"] || 25));
    const start: number = query["cursor"] ? Number(query["cursor"]) : 0;
    const page: Array<FakeListItem> = list.items.slice(start, start + perPage);
    const after: number = start + page.length;

    return this.ok(
      page.map((item: FakeListItem): JSONObject => {
        return {
          id: item.id,
          ip: item.ip,
          ...(item.comment ? { comment: item.comment } : {}),
          created_on: "2026-11-20T10:00:00Z",
          modified_on: "2026-11-20T10:00:00Z",
        };
      }),
      after < list.items.length
        ? { result_info: { cursors: { after: String(after) } } }
        : { result_info: { cursors: {} } },
    );
  }

  private busy(): DataSourceHttpResponse | null {
    if (this.foreignOperationPolls > 0) {
      this.foreignOperationPolls--;
      return restError(
        409,
        10050,
        "There is a pending bulk operation for this account. Try again later.",
      );
    }

    const pending: boolean = Array.from(this.operations.values()).some(
      (operation: FakeOperation): boolean => {
        return operation.status === "pending";
      },
    );

    return pending
      ? restError(
          409,
          10050,
          "There is a pending bulk operation for this account. Try again later.",
        )
      : null;
  }

  private startOperation(run: () => string | null): DataSourceHttpResponse {
    const operation: FakeOperation = {
      id: this.id("b0"),
      pollsLeft: this.operationPolls,
      run,
      status: "pending",
      error: "",
    };
    this.operations.set(operation.id, operation);

    if (operation.pollsLeft <= 0) {
      this.finish(operation);
    }

    return this.ok({ operation_id: operation.id });
  }

  private finish(operation: FakeOperation): void {
    const error: string | null = operation.run();
    operation.status = error ? "failed" : "completed";
    operation.error = error || "";
  }

  private pollOperation(id: string): DataSourceHttpResponse {
    const operation: FakeOperation | undefined = this.operations.get(id);

    if (!operation) {
      return restError(404, 10001, "bulk operation not found");
    }

    if (operation.status === "pending") {
      if (operation.pollsLeft > 0) {
        operation.pollsLeft--;
        return this.ok({ id, status: "pending" });
      }

      this.finish(operation);
    }

    return this.ok({
      id,
      status: operation.status,
      completed: "2026-11-20T10:42:05Z",
      ...(operation.status === "failed" ? { error: operation.error } : {}),
    });
  }

  private totalItems(): number {
    return this.lists.reduce((total: number, list: FakeList): number => {
      return total + list.items.length;
    }, 0);
  }

  private addItems(list: FakeList, body: JSONArray): DataSourceHttpResponse {
    const busy: DataSourceHttpResponse | null = this.busy();

    if (busy) {
      return busy;
    }

    const items: Array<JSONObject> = (body || []) as Array<JSONObject>;

    return this.startOperation((): string | null => {
      if (
        this.totalItems() + items.length >
        CLOUDFLARE_PLAN_LIMITS[this.accountPlan()].listItems
      ) {
        return "exceeded maximum number of list items for this account";
      }

      for (const item of items) {
        const existing: FakeListItem | undefined = list.items.find(
          (candidate: FakeListItem): boolean => {
            return candidate.ip === String(item["ip"]);
          },
        );

        if (existing) {
          existing.comment = String(item["comment"] || "");
          continue;
        }

        list.items.push({
          id: this.id("i0"),
          ip: String(item["ip"]),
          comment: String(item["comment"] || ""),
        });
      }

      return null;
    });
  }

  private deleteItems(
    list: FakeList,
    body: JSONObject,
  ): DataSourceHttpResponse {
    const busy: DataSourceHttpResponse | null = this.busy();

    if (busy) {
      return busy;
    }

    const ids: Array<string> = (
      (body?.["items"] || []) as Array<JSONObject>
    ).map((item: JSONObject): string => {
      return String(item["id"]);
    });

    return this.startOperation((): string | null => {
      list.items = list.items.filter((item: FakeListItem): boolean => {
        return !ids.includes(item.id);
      });
      return null;
    });
  }

  private rulesetJson(ruleset: FakeRuleset): JSONObject {
    return {
      id: ruleset.id,
      name: "default",
      kind: "zone",
      phase: "http_request_firewall_custom",
      version: "3",
      rules: ruleset.rules.map((rule: FakeRule): JSONObject => {
        return {
          id: rule.id,
          version: "1",
          action: rule.action,
          expression: rule.expression,
          description: rule.description,
          last_updated: "2026-11-20T10:00:00Z",
          ref: rule.ref,
          enabled: rule.enabled,
        };
      }),
      last_updated: "2026-11-20T10:00:00Z",
    };
  }

  private zonePlan(zoneId: string): CloudflarePlan {
    return readCloudflarePlan(
      this.zones.find((zone: FakeZone): boolean => {
        return zone.id === zoneId;
      })?.plan?.legacy_id,
    );
  }

  private readRule(body: JSONObject): FakeRule | DataSourceHttpResponse {
    const expression: string = String(body["expression"] || "").trim();
    const action: string = String(body["action"] || "").trim();

    if (!expression || !action) {
      return restError(
        400,
        20021,
        "'expression' must not be empty, and 'action' must be set",
      );
    }

    return {
      id: this.id("r0"),
      ref: String(body["ref"] || "") || this.id("r1"),
      action,
      expression,
      description: String(body["description"] || ""),
      enabled: body["enabled"] !== false,
    };
  }

  private roomFor(
    zoneId: string,
    ruleset: FakeRuleset,
    adding: number,
  ): boolean {
    return (
      ruleset.rules.length + adding <=
      CLOUDFLARE_PLAN_LIMITS[this.zonePlan(zoneId)].customRulesPerZone
    );
  }

  private createRuleset(
    zoneId: string,
    body: JSONObject,
  ): DataSourceHttpResponse {
    if (
      body["phase"] !== "http_request_firewall_custom" ||
      body["kind"] !== "zone"
    ) {
      return restError(400, 20001, "invalid phase or kind");
    }

    const rules: Array<FakeRule> = [];

    for (const value of (body["rules"] || []) as Array<JSONObject>) {
      const rule: FakeRule | DataSourceHttpResponse = this.readRule(value);

      if ("statusCode" in rule) {
        return rule;
      }

      rules.push(rule);
    }

    if (this.rulesets.has(zoneId)) {
      return restError(
        400,
        20217,
        "a ruleset of kind zone already exists for this phase",
      );
    }

    const ruleset: FakeRuleset = { id: this.id("s0"), rules: [] };

    if (!this.roomFor(zoneId, ruleset, rules.length)) {
      return restError(
        400,
        20200,
        "exceeded maximum number of rules in phase http_request_firewall_custom",
      );
    }

    ruleset.rules = rules;
    this.rulesets.set(zoneId, ruleset);

    return this.ok(this.rulesetJson(ruleset));
  }

  private addRule(
    zoneId: string,
    rulesetId: string,
    body: JSONObject,
  ): DataSourceHttpResponse {
    const ruleset: FakeRuleset | undefined = this.rulesets.get(zoneId);

    if (!ruleset || ruleset.id !== rulesetId) {
      return restError(404, 10003, "could not find ruleset");
    }

    const rule: FakeRule | DataSourceHttpResponse = this.readRule(body);

    if ("statusCode" in rule) {
      return rule;
    }

    if (!this.roomFor(zoneId, ruleset, 1)) {
      return restError(
        400,
        20200,
        "exceeded maximum number of rules in phase http_request_firewall_custom",
      );
    }

    const position: JSONObject = (body["position"] as JSONObject) || {};
    const index: number =
      typeof position["index"] === "number"
        ? position["index"] - 1
        : ruleset.rules.length;

    ruleset.rules.splice(Math.max(0, index), 0, rule);

    return this.ok(this.rulesetJson(ruleset));
  }

  private changeRule(
    method: string,
    zoneId: string,
    rulesetId: string,
    ruleId: string,
    body: JSONObject,
  ): DataSourceHttpResponse {
    const ruleset: FakeRuleset | undefined = this.rulesets.get(zoneId);
    const index: number =
      ruleset?.rules.findIndex((rule: FakeRule): boolean => {
        return rule.id === ruleId;
      }) ?? -1;

    if (!ruleset || ruleset.id !== rulesetId || index < 0) {
      return restError(404, 10003, "could not find rule");
    }

    if (method === "DELETE") {
      ruleset.rules.splice(index, 1);
      return this.ok(this.rulesetJson(ruleset));
    }

    if (method === "PATCH") {
      const rule: FakeRule | DataSourceHttpResponse = this.readRule(body);

      if ("statusCode" in rule) {
        return rule;
      }

      ruleset.rules[index] = { ...rule, id: ruleId };
      return this.ok(this.rulesetJson(ruleset));
    }

    return null as unknown as DataSourceHttpResponse;
  }

  private accessRuleJson(rule: FakeAccessRule): JSONObject {
    return {
      id: rule.id,
      mode: rule.mode,
      notes: rule.notes,
      allowed_modes: [
        "whitelist",
        "block",
        "challenge",
        "js_challenge",
        "managed_challenge",
      ],
      configuration: { target: rule.target, value: rule.value },
      scope: { id: ACCOUNT_ID, type: "organization" },
      created_on: "2026-11-20T10:00:00Z",
      modified_on: "2026-11-20T10:00:00Z",
    };
  }

  private listAccessRules(
    query: Record<string, string>,
  ): DataSourceHttpResponse {
    const notes: string = (query["notes"] || "").toLowerCase();
    const mode: string = query["mode"] || "";
    const matching: Array<FakeAccessRule> = this.accessRules.filter(
      (rule: FakeAccessRule): boolean => {
        return (
          (!notes || rule.notes.toLowerCase().includes(notes)) &&
          (!mode || rule.mode === mode)
        );
      },
    );
    const perPage: number = Number(query["per_page"] || 20);
    const page: number = Number(query["page"] || 1);
    const slice: Array<FakeAccessRule> = matching.slice(
      (page - 1) * perPage,
      page * perPage,
    );

    return this.ok(slice.map(this.accessRuleJson), {
      result_info: {
        page,
        per_page: perPage,
        count: slice.length,
        total_count: matching.length,
        total_pages: Math.max(1, Math.ceil(matching.length / perPage)),
      },
    });
  }

  private createAccessRule(body: JSONObject): DataSourceHttpResponse {
    const configuration: JSONObject =
      (body["configuration"] as JSONObject) || {};
    const target: string = String(configuration["target"] || "");
    const value: string = String(configuration["value"] || "");

    if (!value || !["ip", "ip6", "ip_range"].includes(target)) {
      return restError(400, 10014, "configuration.value is invalid");
    }

    if (this.accessRules.length >= CLOUDFLARE_ACCESS_RULES_PER_ACCOUNT) {
      return restError(400, 10009, "exceeded maximum number of access rules");
    }

    const rule: FakeAccessRule = {
      id: this.id("f0"),
      mode: String(body["mode"] || ""),
      notes: String(body["notes"] || ""),
      target,
      value,
    };
    this.accessRules.push(rule);

    return this.ok(this.accessRuleJson(rule));
  }
}

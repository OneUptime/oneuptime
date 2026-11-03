import { describe, expect, test } from "@jest/globals";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import LogSavedView from "../../../Models/DatabaseModels/LogSavedView";
import IsNull from "../../../Types/BaseDatabase/IsNull";
import ColumnLength from "../../../Types/Database/ColumnLength";
import { JSONObject, ObjectType } from "../../../Types/JSON";
import JSONFunctions from "../../../Types/JSONFunctions";
import ObjectID from "../../../Types/ObjectID";
import {
  EXPLORER_SAVED_VIEW_SCOPE,
  SAVED_VIEW_SCOPE_MAX_LENGTH,
  SavedViewScopeKind,
  buildSavedViewScope,
  getSavedViewScopeColumnValue,
  getSavedViewScopeQueryValue,
} from "../../../Utils/Telemetry/SavedViewScope";
import { generatedTexts } from "../../Helpers/GeneratedTexts";
import { SeededRandom, seededRandom } from "../../Helpers/SeededRandom";

/*
 * The page a saved log view belongs to (issue #5549). A view is listed only
 * on the page it was saved on, so the name of a page has to be one name for
 * one page: the same page always names itself the same way, two pages never
 * share a name, the Logs page is the views with no scope (every view saved
 * before views had a page), and a scope reaches the API as the condition
 * the server reads.
 */

const CLUSTER_ID: ObjectID = new ObjectID(
  "7b3a4c2e-9f1d-4e8a-b5c6-1d2e3f4a5b6c",
);
const OTHER_CLUSTER_ID: ObjectID = new ObjectID(
  "8c4b5d3f-0a2e-4f9b-a6d7-2e3f4a5b6c7d",
);

describe("buildSavedViewScope", () => {
  test("names a resource's page by its kind and the resource", () => {
    expect(
      buildSavedViewScope(SavedViewScopeKind.KubernetesCluster, CLUSTER_ID),
    ).toBe("kubernetes-cluster:7b3a4c2e-9f1d-4e8a-b5c6-1d2e3f4a5b6c");
    expect(buildSavedViewScope(SavedViewScopeKind.Host, "web-01")).toBe(
      "host:web-01",
    );
  });

  test("an ObjectID and its string name the same page", () => {
    expect(
      buildSavedViewScope(SavedViewScopeKind.KubernetesCluster, CLUSTER_ID),
    ).toBe(
      buildSavedViewScope(
        SavedViewScopeKind.KubernetesCluster,
        CLUSTER_ID.toString(),
      ),
    );
  });

  test("the same page names itself the same way every time", () => {
    const scopes: Array<string> = [1, 2, 3].map((): string => {
      return buildSavedViewScope(
        SavedViewScopeKind.KubernetesPod,
        "prod-eu",
        "payments",
        "checkout-7d9f",
      );
    });

    expect(new Set(scopes).size).toBe(1);
  });

  test("two clusters' Logs tabs are two pages", () => {
    expect(
      buildSavedViewScope(SavedViewScopeKind.KubernetesCluster, CLUSTER_ID),
    ).not.toBe(
      buildSavedViewScope(
        SavedViewScopeKind.KubernetesCluster,
        OTHER_CLUSTER_ID,
      ),
    );
  });

  test("the same id on two kinds of page is two pages", () => {
    const scopes: Array<string> = Object.values(SavedViewScopeKind).map(
      (kind: SavedViewScopeKind): string => {
        return buildSavedViewScope(kind, CLUSTER_ID);
      },
    );

    expect(new Set(scopes).size).toBe(Object.values(SavedViewScopeKind).length);
  });

  test("a part holding the separator cannot make two pages one", () => {
    // "a:b" + "c" and "a" + "b:c" would both read a:b:c if parts were not encoded.
    const first: string = buildSavedViewScope(
      SavedViewScopeKind.DockerContainer,
      "a:b",
      "c",
    );
    const second: string = buildSavedViewScope(
      SavedViewScopeKind.DockerContainer,
      "a",
      "b:c",
    );

    expect(first).not.toBe(second);
    expect(first).toBe("docker-container:a%3Ab:c");
    expect(second).toBe("docker-container:a:b%3Ac");
  });

  test("encodes what a part may hold - spaces, slashes, percent signs, other scripts", () => {
    expect(
      buildSavedViewScope(
        SavedViewScopeKind.VMwareHost,
        "vc 01/eu",
        "esx%01",
        "ホスト",
      ),
    ).toBe(`vmware-host:vc%2001%2Feu:esx%2501:${encodeURIComponent("ホスト")}`);
  });

  test("an empty part keeps its place", () => {
    expect(
      buildSavedViewScope(
        SavedViewScopeKind.KubernetesWorkload,
        "prod",
        "Node",
        "",
        "node-1",
      ),
    ).toBe("kubernetes-workload:prod:Node::node-1");
    expect(
      buildSavedViewScope(
        SavedViewScopeKind.KubernetesWorkload,
        "prod",
        "Node",
        "node-1",
        "",
      ),
    ).not.toBe(
      buildSavedViewScope(
        SavedViewScopeKind.KubernetesWorkload,
        "prod",
        "Node",
        "",
        "node-1",
      ),
    );
  });

  test("is never the Logs page's scope, nor blank", () => {
    for (const kind of Object.values(SavedViewScopeKind)) {
      const scope: string = buildSavedViewScope(kind, "");

      expect(scope).not.toBe(EXPLORER_SAVED_VIEW_SCOPE);
      expect(getSavedViewScopeColumnValue(scope)).toBe(scope);
    }
  });

  test("keeps within the column, however long the resource's name", () => {
    const longName: string = "pod-".repeat(400);
    const scope: string = buildSavedViewScope(
      SavedViewScopeKind.KubernetesPod,
      "prod",
      "payments",
      longName,
    );

    expect(scope.length).toBe(SAVED_VIEW_SCOPE_MAX_LENGTH);
    expect(scope.startsWith("kubernetes-pod:prod:payments:pod-pod-")).toBe(
      true,
    );
    // The same long name is still the same page.
    expect(
      buildSavedViewScope(
        SavedViewScopeKind.KubernetesPod,
        "prod",
        "payments",
        longName,
      ),
    ).toBe(scope);
  });

  test("a scope as long as the column is kept whole", () => {
    const prefix: string = `${SavedViewScopeKind.Host}:`;
    const name: string = "h".repeat(
      SAVED_VIEW_SCOPE_MAX_LENGTH - prefix.length,
    );
    const scope: string = buildSavedViewScope(SavedViewScopeKind.Host, name);

    expect(scope).toBe(`${prefix}${name}`);
    expect(scope.length).toBe(SAVED_VIEW_SCOPE_MAX_LENGTH);
  });

  test("the column is as long as LogSavedView's scope column", () => {
    expect(SAVED_VIEW_SCOPE_MAX_LENGTH).toBe(ColumnLength.LongText);
  });

  /*
   * Generated pages: every list of parts drawn from an alphabet heavy in the
   * characters a part could confuse with its neighbours names a page of its
   * own, and names it the same way again.
   */
  test("different parts are different pages, the same parts the same page (generated)", () => {
    const alphabet: ReadonlyArray<string> = [
      "a",
      "b",
      ":",
      "%",
      "3A",
      "/",
      " ",
      "-",
      "é",
      "",
    ];
    const texts: Array<string> = generatedTexts(3000, 5549, alphabet, 8);
    const random: SeededRandom = seededRandom(5549);
    const kinds: Array<SavedViewScopeKind> = Object.values(SavedViewScopeKind);

    const pageByScope: Map<string, string> = new Map();

    for (let index: number = 0; index < texts.length; index++) {
      const kind: SavedViewScopeKind = kinds[random(kinds.length)]!;
      const parts: Array<string> = [
        texts[index]!,
        texts[random(texts.length)]!,
      ].slice(0, 1 + random(2));
      const page: string = JSON.stringify([kind, ...parts]);
      const scope: string = buildSavedViewScope(kind, ...parts);

      expect(buildSavedViewScope(kind, ...parts)).toBe(scope);

      const earlier: string | undefined = pageByScope.get(scope);

      if (earlier !== undefined) {
        expect({ scope, page: earlier }).toEqual({ scope, page });
      }

      pageByScope.set(scope, page);
    }

    // Far more than a handful of distinct pages were drawn.
    expect(pageByScope.size).toBeGreaterThan(1000);
  });
});

describe("SavedViewScopeKind", () => {
  test("each kind is its own lower-case word, with nothing a separator would break", () => {
    const kinds: Array<string> = Object.values(SavedViewScopeKind);

    expect(new Set(kinds).size).toBe(kinds.length);

    for (const kind of kinds) {
      expect(kind).toMatch(/^[a-z][a-z0-9]*(-[a-z0-9]+)*$/);
      expect(kind).not.toBe(EXPLORER_SAVED_VIEW_SCOPE);
    }
  });
});

describe("getSavedViewScopeColumnValue", () => {
  test("the Logs page's views are stored with no scope, as every older view is", () => {
    expect(getSavedViewScopeColumnValue(EXPLORER_SAVED_VIEW_SCOPE)).toBeNull();
  });

  test.each([
    ["an empty string", ""],
    ["spaces", "   "],
    ["a tab and a newline", "\t\n"],
    ["the explorer's name with spaces around it", "  explorer "],
    ["no value", undefined],
    ["null", null],
    ["a number", 7],
    ["an object", { scope: "host:web-01" }],
    ["an array", ["host:web-01"]],
  ])("%s is no scope at all", (_label: string, value: unknown) => {
    expect(getSavedViewScopeColumnValue(value)).toBeNull();
  });

  test("a resource page's scope is stored as it is, without the spaces around it", () => {
    const scope: string = buildSavedViewScope(
      SavedViewScopeKind.KubernetesCluster,
      CLUSTER_ID,
    );

    expect(getSavedViewScopeColumnValue(scope)).toBe(scope);
    expect(getSavedViewScopeColumnValue(`  ${scope}\n`)).toBe(scope);
  });

  test("a scope the API was sent by hand is kept, case and all", () => {
    expect(getSavedViewScopeColumnValue("Team Payments")).toBe("Team Payments");
    // Only the explorer's own name, exactly, is the Logs page.
    expect(getSavedViewScopeColumnValue("Explorer")).toBe("Explorer");
  });
});

describe("getSavedViewScopeQueryValue", () => {
  test("the Logs page lists the views with no scope", () => {
    expect(
      getSavedViewScopeQueryValue(EXPLORER_SAVED_VIEW_SCOPE),
    ).toBeInstanceOf(IsNull);
    expect(getSavedViewScopeQueryValue("  ")).toBeInstanceOf(IsNull);
  });

  test("a resource's page lists the views saved on it", () => {
    const scope: string = buildSavedViewScope(
      SavedViewScopeKind.Host,
      CLUSTER_ID,
    );

    expect(getSavedViewScopeQueryValue(scope)).toBe(scope);
  });

  test("reaches the API as the condition it reads: IS NULL, or the page's name", () => {
    const explorerQuery: JSONObject = JSONFunctions.serialize({
      scope: getSavedViewScopeQueryValue(EXPLORER_SAVED_VIEW_SCOPE),
    } as unknown as JSONObject);

    expect(explorerQuery["scope"]).toEqual({
      _type: ObjectType.IsNull,
      value: null,
    });
    expect(
      (JSONFunctions.deserialize(explorerQuery) as JSONObject)["scope"],
    ).toBeInstanceOf(IsNull);

    const scope: string = buildSavedViewScope(
      SavedViewScopeKind.Service,
      CLUSTER_ID,
    );

    expect(
      JSONFunctions.serialize({
        scope: getSavedViewScopeQueryValue(scope),
      } as unknown as JSONObject)["scope"],
    ).toBe(scope);
  });
});

describe("a view's create, as the Dashboard sends it", () => {
  function sent(scope: string): JSONObject {
    const view: LogSavedView = new LogSavedView();
    view.name = "Errors in payments";

    const columnValue: string | null = getSavedViewScopeColumnValue(scope);

    if (columnValue) {
      view.scope = columnValue;
    }

    return BaseModel.toJSONObject(view, LogSavedView);
  }

  test("a view saved on the Logs page carries no scope", () => {
    expect(sent(EXPLORER_SAVED_VIEW_SCOPE)["scope"]).toBeUndefined();
  });

  test("a view saved on a cluster's Logs tab carries the cluster's scope", () => {
    const scope: string = buildSavedViewScope(
      SavedViewScopeKind.KubernetesCluster,
      CLUSTER_ID,
    );

    expect(sent(scope)["scope"]).toBe(scope);
  });
});

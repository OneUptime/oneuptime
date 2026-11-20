import {
  RelationSelectScan,
  RelationSelectSite,
  SelectShape,
  scanRelationSelects,
} from "./RelationSelectScan";
import { afterAll, beforeAll, describe, expect, test } from "@jest/globals";
import fs from "fs";
import os from "os";
import path from "path";

/*
 * A select that reaches through a relation is checked against the RELATED
 * model, not the one being queried, and the check is all-or-nothing:
 *
 *   QueryPermission.checkRelationQueryPermission walks every inner key of
 *   `select: { someRelation: { ... } }` and THROWS on the first one whose
 *   column lacks canReadOnRelationQuery, or that is a relation itself. It
 *   does not drop the key and carry on.
 *
 * So a single unflagged column fails the whole request, for every caller, at
 * any permission level. That is how the escalation rule page broke: it added
 * `currentUserIdOnRoster` next to `name` in the schedule join, the model had no
 * flag on that column, and the page stopped loading entirely with
 *
 *   Column currentUserIdOnRoster on On-Call Policy Schedule does not
 *   support read on relation query.
 *
 * And how every data security issue's page broke, from 14.0.99 (#10238): its
 * layout read the issue with its store's data types through the relation,
 * and a customer who clicked a data security alert saw only
 *
 *   Column dataTypeIds on Data Store does not support read on relation
 *   query.
 *
 * That select was a constant named whole (`select:
 * DATA_SECURITY_ISSUE_VIEW_SELECT`), which this guard did not follow until
 * 17.0.0. It read only `select` beside a `modelType` in one object, too, so a
 * table's columns, a detail's fields, `selectMoreFields`, a component's props
 * and a select cast `as unknown as` went unread: when it learned them, seven
 * more reads that every reader's page sent and the server refused whole were
 * on main - Settings > SSO's providers and their notice, a table's Lineage,
 * a managed device's card and a monitor group's why.
 *
 * Nothing catches this at compile time. `Select<TBaseModel>` is typed from the
 * model's fields, so every column is spellable in a relation select and only
 * the runtime knows which ones are actually reachable - which means the first
 * report comes from a user with a blank page.
 *
 * RelationSelectScan.ts reads every select a read is handed with its model, in
 * every shape the Dashboard hands one, and resolves each relation's columns
 * against the model metadata the server will use. Below, the whole tree has
 * none the server refuses; each shape the scan reads is pinned to a select
 * the product sends, so a refactor that moves a shape out of its reach fails
 * here rather than quietly checking nothing; and every kind of mistake the
 * server refuses, planted in a folder of its own, is caught.
 */

describe("relation selects only name columns the permission layer allows", () => {
  let result: RelationSelectScan;

  beforeAll(async () => {
    result = await scanRelationSelects();
  }, 600000);

  function sitesWhere(
    matches: (site: RelationSelectSite) => boolean,
  ): Array<RelationSelectSite> {
    return result.sites.filter(matches);
  }

  test("every relation-selected column is readable through the relation", () => {
    expect(result.violations).toEqual([]);
  });

  test("the scan actually found relation selects to check, in every shape", () => {
    /*
     * Guards the assertion above against passing because the parse found
     * nothing. The repo had over two thousand checkable relation columns
     * when the scan learned columns, fields and props (#10238): 899 in
     * selects, 726 in columns, 340 in fields and 276 in selectMoreFields. The
     * floors are well under that, and still catch a scan that has silently
     * stopped matching a shape.
     */
    expect(result.sites.length).toBeGreaterThan(1500);
    expect(result.checkedCount).toBeGreaterThan(1500);

    for (const [shape, floor] of [
      [SelectShape.Select, 500],
      [SelectShape.Columns, 400],
      [SelectShape.Fields, 150],
      [SelectShape.SelectMoreFields, 150],
    ] as Array<[SelectShape, number]>) {
      expect({
        shape: shape,
        isAboveFloor:
          sitesWhere((site: RelationSelectSite): boolean => {
            return site.shape === shape;
          }).length > floor,
      }).toEqual({ shape: shape, isAboveFloor: true });
    }
  });

  test("the escalation rule schedule join is one of the sites covered", () => {
    /*
     * The select that caused the original report. Naming it here means that
     * deleting the component, or restructuring its query into a shape the
     * parse cannot see, shows up as a failure rather than as silent loss of
     * coverage over the exact regression this file exists for.
     */
    expect(
      sitesWhere((site: RelationSelectSite): boolean => {
        return (
          site.modelName === "OnCallDutyPolicyEscalationRuleSchedule" &&
          site.relation === "onCallDutyPolicySchedule" &&
          site.column === "currentUserIdOnRoster"
        );
      }).length,
    ).toBeGreaterThan(0);
  });

  test("a relation select spread in from a shared constant is covered: the SLO notice banner's monitors", () => {
    /*
     * The banner reads its monitors' first-check and pause state through the
     * SLO, spreading SLO_MONITOR_FIRST_CHECK_SELECT (which spreads
     * MONITOR_PAUSE_FLAGS_SELECT) into the relation. Three of those columns
     * were not readable through a relation, so the banner's read failed for
     * everyone and an archived SLO's Settings page lost its banner - found by
     * 16.0.0's release run, as this scan read only keys written out.
     */
    const bannerColumns: Array<string> = sitesWhere(
      (site: RelationSelectSite): boolean => {
        return (
          site.file.endsWith("Components/Slo/SloNoticeBanner.tsx") &&
          site.modelName === "ServiceLevelObjective" &&
          site.relation === "monitors"
        );
      },
    ).map((site: RelationSelectSite): string => {
      return site.column;
    });

    expect(bannerColumns).toEqual(
      expect.arrayContaining([
        "firstMeasuredAt",
        "disableActiveMonitoringBecauseOfManualIncident",
        "disableActiveMonitoringBecauseOfScheduledMaintenanceEvent",
      ]),
    );
  });

  test("a select named whole, from another file, is covered where it is read: a data security issue's page (#10238)", () => {
    const storeSites: Array<RelationSelectSite> = sitesWhere(
      (site: RelationSelectSite): boolean => {
        return (
          site.file.endsWith("Pages/DataSecurity/IssueView/Layout.tsx") &&
          site.modelName === "DataSecurityIssue" &&
          site.relation === "dataStore"
        );
      },
    );

    expect(
      storeSites.map((site: RelationSelectSite): string => {
        return site.column;
      }),
    ).toEqual(expect.arrayContaining(["name", "kind", "sensitivity"]));

    // Read at the layout's line, written in the select's own file.
    for (const site of storeSites) {
      expect(site.writtenAt).toMatch(
        /Pages\/DataSecurity\/IssueView\/IssueViewContext\.ts:\d+$/,
      );
    }
  });

  test("the store's facts a relation reads only for the store's readers are sent for each reader: the issue page, an identity's reach (#10281)", () => {
    const perReader: Array<string> = sitesWhere(
      (site: RelationSelectSite): boolean => {
        return (
          site.relation === "dataStore" &&
          site.column === "sensitivity" &&
          (site.file.endsWith("Pages/DataSecurity/IssueView/Layout.tsx") ||
            site.file.endsWith(
              "Components/DataSecurity/IdentityReachList.tsx",
            ) ||
            site.file.endsWith("Utils/AI/Toolbox/DataSecurityTools.ts"))
        );
      },
    ).map((site: RelationSelectSite): string => {
      return `${site.file.split("/").pop()} ${site.modelName} ${site.isReadPerReader}`;
    });

    expect(perReader.sort()).toEqual([
      "DataSecurityTools.ts DataSecurityIssue true",
      "IdentityReachList.tsx DataStoreAccess true",
      "Layout.tsx DataSecurityIssue true",
    ]);
  });

  test("a table's columns are covered, a column declared apart included: the issues list's store and a table's Lineage", () => {
    expect(
      sitesWhere((site: RelationSelectSite): boolean => {
        return (
          site.file.endsWith("Pages/DataSecurity/Issues.tsx") &&
          site.shape === SelectShape.Columns &&
          site.modelName === "DataSecurityIssue" &&
          site.relation === "dataStore" &&
          site.column === "name"
        );
      }).length,
    ).toBeGreaterThan(0);

    // `columns={[..., seenInColumn, ...]}`, the column a component's own constant.
    expect(
      sitesWhere((site: RelationSelectSite): boolean => {
        return (
          site.file.endsWith("Pages/DataObservability/TableView/Lineage.tsx") &&
          site.shape === SelectShape.Columns &&
          site.modelName === "DataAssetLineage" &&
          site.relation === "dataPipeline" &&
          site.column === "lastRunState"
        );
      }).length,
    ).toBeGreaterThan(0);
  });

  test("a detail's fields are covered: a monitor's linked resources", () => {
    expect(
      sitesWhere((site: RelationSelectSite): boolean => {
        return (
          site.file.endsWith(
            "Components/Monitor/Overview/MonitorLinkedResourcesCard.tsx",
          ) &&
          site.shape === SelectShape.Fields &&
          site.modelName === "Monitor" &&
          site.relation === "hosts" &&
          site.column === "name"
        );
      }).length,
    ).toBeGreaterThan(0);
  });

  test("selectMoreFields is covered: the alerts table's affected resources", () => {
    expect(
      sitesWhere((site: RelationSelectSite): boolean => {
        return (
          site.file.endsWith("Components/Alert/AlertsTable.tsx") &&
          site.shape === SelectShape.SelectMoreFields &&
          site.modelName === "Alert" &&
          site.relation === "networkDevices" &&
          site.column === "name"
        );
      }).length,
    ).toBeGreaterThan(0);
  });

  test("a select cast `as unknown as`, from a shared constant, is covered: Settings > SSO's notice", () => {
    expect(
      sitesWhere((site: RelationSelectSite): boolean => {
        return (
          site.file.endsWith(
            "Components/Sso/SsoProvidersNotOfferedNotice.tsx",
          ) &&
          // A model is named by its file: ProjectSSO is ProjectSso.ts.
          site.modelName === "ProjectSso" &&
          site.relation === "domains" &&
          site.column === "isVerified"
        );
      }).length,
    ).toBeGreaterThan(0);
  });
});

/*
 * Every kind of mistake the server refuses, planted in a folder of its own and
 * scanned as the tree is: the guard fails on each, where it is read, and
 * passes the select that names only what a relation reads.
 */
describe("the guard fails on a planted read the server refuses", () => {
  let folder: string;
  let planted: RelationSelectScan;

  const PLANTED: Record<string, string> = {
    // #10238's own shape: a select named whole, from another file.
    "PlantedIssueSelect.ts": [
      'import DataSecurityIssue from "Common/Models/DatabaseModels/DataSecurityIssue";',
      'import Select from "Common/Types/BaseDatabase/Select";',
      "",
      "export const PLANTED_ISSUE_SELECT: Select<DataSecurityIssue> = {",
      "  _id: true,",
      "  dataStore: { name: true, dataTypeIds: true },",
      "};",
    ].join("\n"),
    "PlantedIssueLayout.ts": [
      'import DataSecurityIssue from "Common/Models/DatabaseModels/DataSecurityIssue";',
      'import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";',
      'import { PLANTED_ISSUE_SELECT } from "./PlantedIssueSelect";',
      "",
      "export async function readIssue(id: never): Promise<unknown> {",
      "  return await ModelAPI.getItem<DataSecurityIssue>({",
      "    modelType: DataSecurityIssue,",
      "    id: id,",
      "    select: PLANTED_ISSUE_SELECT,",
      "  });",
      "}",
    ].join("\n"),
    // A table's column, as props.
    "PlantedTable.tsx": [
      'import DataSecurityIssue from "Common/Models/DatabaseModels/DataSecurityIssue";',
      "",
      "export const Planted = () => {",
      "  return (",
      "    <ModelTable<DataSecurityIssue>",
      "      modelType={DataSecurityIssue}",
      '      columns={[{ field: { dataStore: { dataTypeIds: true } }, title: "Store" }]}',
      "    />",
      "  );",
      "};",
    ].join("\n"),
    // A detail's field, in an object of props.
    "PlantedDetail.tsx": [
      'import DataSecurityIssue from "Common/Models/DatabaseModels/DataSecurityIssue";',
      "",
      "export const Planted = () => {",
      "  return (",
      "    <CardModelDetail",
      "      modelDetailProps={{",
      "        modelType: DataSecurityIssue,",
      '        fields: [{ field: { dataStore: { dataCategories: true } }, title: "Store" }],',
      "      }}",
      "    />",
      "  );",
      "};",
    ].join("\n"),
    // selectMoreFields, as props.
    "PlantedMoreFields.tsx": [
      'import DataSecurityIssue from "Common/Models/DatabaseModels/DataSecurityIssue";',
      "",
      "export const Planted = () => {",
      "  return (",
      "    <ModelTable",
      "      modelType={DataSecurityIssue}",
      "      selectMoreFields={{ dataStore: { subjectCountries: true } }}",
      "      columns={[]}",
      "    />",
      "  );",
      "};",
    ].join("\n"),
    // A relation's relation: the server refuses any deep relation.
    "PlantedDeep.ts": [
      'import MonitorGroupResource from "Common/Models/DatabaseModels/MonitorGroupResource";',
      'import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";',
      "",
      "export async function readGroup(): Promise<unknown> {",
      "  return await ModelAPI.getList<MonitorGroupResource>({",
      "    modelType: MonitorGroupResource,",
      "    select: { monitor: { name: true, currentMonitorStatus: { name: true } } },",
      "  } as never);",
      "}",
    ].join("\n"),
    /*
     * The model under another name, the select a function's own constant
     * handed as a shorthand prop, and cast.
     */
    "PlantedAlias.ts": [
      'import IssueModel from "Common/Models/DatabaseModels/DataSecurityIssue";',
      'import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";',
      "",
      "export async function readIssues(): Promise<unknown> {",
      "  const select = { dataStore: { posture: true } } as unknown as never;",
      "  return await ModelAPI.getList({ modelType: IssueModel, select } as never);",
      "}",
    ].join("\n"),
    // A relation's columns spread in from a constant.
    "PlantedSpread.ts": [
      'import DataSecurityIssue from "Common/Models/DatabaseModels/DataSecurityIssue";',
      'import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";',
      "",
      "const STORE_FACTS = { cloudTags: true };",
      "",
      "export async function readIssue(id: never): Promise<unknown> {",
      "  return await ModelAPI.getItem<DataSecurityIssue>({",
      "    modelType: DataSecurityIssue,",
      "    id: id,",
      "    select: { dataStore: { name: true, ...STORE_FACTS } },",
      "  } as never);",
      "}",
    ].join("\n"),
    /*
     * #10281's shape: a column a relation reads only for those who may read
     * it on the store, in a table every reader of data assets reads.
     */
    "PlantedOwnRead.tsx": [
      'import DataAsset from "Common/Models/DatabaseModels/DataAsset";',
      "",
      "export const Planted = () => {",
      "  return (",
      "    <ModelTable<DataAsset>",
      "      modelType={DataAsset}",
      '      columns={[{ field: { dataStore: { sensitivity: true } }, title: "Store" }]}',
      "    />",
      "  );",
      "};",
    ].join("\n"),
    /*
     * What a relation reads: nothing to fail. The store's labels, and its
     * sensitivity in a select sent for each reader without what they may
     * not read - in the dashboard, and on the server.
     */
    "PlantedClean.tsx": [
      'import DataSecurityIssue from "Common/Models/DatabaseModels/DataSecurityIssue";',
      'import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";',
      'import PermissionGate from "Common/UI/Utils/PermissionGate";',
      "",
      "export const STORE_SELECT = { _id: true, name: true, kind: true };",
      "",
      "export const ISSUE_SELECT = { title: true, dataStore: { sensitivity: true } };",
      "",
      "export const Planted = () => {",
      "  void ModelAPI.getItem<DataSecurityIssue>({",
      "    modelType: DataSecurityIssue,",
      "    select: { title: true, dataStore: STORE_SELECT },",
      "  } as never);",
      "",
      "  void ModelAPI.getItem<DataSecurityIssue>({",
      "    modelType: DataSecurityIssue,",
      "    select: PermissionGate.getSelectReadableThroughRelations(DataSecurityIssue, ISSUE_SELECT),",
      "  } as never);",
      "",
      "  return (",
      "    <ModelTable",
      "      modelType={DataSecurityIssue}",
      '      columns={[{ field: { dataStore: { environment: true } }, title: "Store" }]}',
      "    />",
      "  );",
      "};",
    ].join("\n"),
    "PlantedCleanServer.ts": [
      'import DataSecurityIssue from "Common/Models/DatabaseModels/DataSecurityIssue";',
      'import QueryPermission from "Common/Server/Types/Database/Permissions/QueryPermission";',
      "",
      "export function selectFor(props: never): unknown {",
      "  return QueryPermission.getSelectReadableThroughRelations({",
      "    modelType: DataSecurityIssue,",
      "    select: { _id: true, dataStore: { name: true, riskScore: true } },",
      "    props: props,",
      "  });",
      "}",
    ].join("\n"),
  };

  beforeAll(async () => {
    folder = fs.mkdtempSync(path.join(os.tmpdir(), "relation-select-guard-"));

    for (const [name, source] of Object.entries(PLANTED)) {
      fs.writeFileSync(path.join(folder, name), source);
    }

    planted = await scanRelationSelects([folder]);
  }, 600000);

  afterAll(() => {
    fs.rmSync(folder, { recursive: true, force: true });
  });

  function violationsOf(fileName: string): Array<string> {
    return planted.violations.filter((violation: string): boolean => {
      return violation.split(" - ")[0]!.split(":")[0]!.endsWith(fileName);
    });
  }

  test.each([
    [
      "PlantedIssueLayout.ts",
      "a select named whole, from another file (#10238)",
      'Column dataTypeIds on Data Store does not support read on relation query."',
    ],
    [
      "PlantedTable.tsx",
      "a table's column",
      'Column dataTypeIds on Data Store does not support read on relation query."',
    ],
    [
      "PlantedDetail.tsx",
      "a detail's field",
      'Column dataCategories on Data Store does not support read on relation query."',
    ],
    [
      "PlantedMoreFields.tsx",
      "selectMoreFields",
      'Column subjectCountries on Data Store does not support read on relation query."',
    ],
    [
      "PlantedDeep.ts",
      "a relation's relation",
      'You cannot query deep relations. Querying deep relations is not supported."',
    ],
    [
      "PlantedAlias.ts",
      "a model under another name, its select a shorthand, cast",
      'Column posture on Data Store does not support read on relation query."',
    ],
    [
      "PlantedSpread.ts",
      "a relation's columns spread in",
      'Column cloudTags on Data Store does not support read on relation query."',
    ],
    [
      "PlantedOwnRead.tsx",
      "a column a relation reads only for its own readers, sent to every reader of the relation (#10281)",
      '"You do not have permissions to read sensitivity of Data Store through dataStore on Data Asset."',
    ],
  ])("%s: %s", (fileName: string, _shape: string, refusal: string) => {
    const violations: Array<string> = violationsOf(fileName);

    expect(violations).toHaveLength(1);
    expect(violations[0]).toContain(refusal);
  });

  test("a select named whole is reported where it is read, and where its column is written", () => {
    const violation: string = violationsOf("PlantedIssueLayout.ts")[0]!;

    expect(violation).toMatch(
      /PlantedIssueLayout\.ts:9 \(written at .*PlantedIssueSelect\.ts:6\) - DataSecurityIssue\.dataStore selects Data Store\.dataTypeIds/,
    );
  });

  test("the planted reads are every violation there is, and the clean ones have none", () => {
    expect(violationsOf("PlantedClean.tsx")).toEqual([]);
    expect(violationsOf("PlantedCleanServer.ts")).toEqual([]);
    expect(planted.violations).toHaveLength(8);

    // The clean files were read, and every column of them checked.
    expect(
      planted.sites
        .filter((site: RelationSelectSite): boolean => {
          return (
            site.file.endsWith("PlantedClean.tsx") ||
            site.file.endsWith("PlantedCleanServer.ts")
          );
        })
        .map((site: RelationSelectSite): string => {
          return `${site.shape} ${site.relation}.${site.column}${
            site.isReadPerReader ? " (for each reader)" : ""
          }`;
        })
        .sort(),
    ).toEqual([
      "columns dataStore.environment",
      "select dataStore._id",
      "select dataStore.kind",
      "select dataStore.name",
      "select dataStore.name (for each reader)",
      "select dataStore.riskScore (for each reader)",
      "select dataStore.sensitivity (for each reader)",
    ]);
  });

  test("a column held to its own read passes once the planted table sends it for each reader", async () => {
    const fixedFolder: string = fs.mkdtempSync(
      path.join(os.tmpdir(), "relation-select-guard-fixed-"),
    );

    try {
      fs.writeFileSync(
        path.join(fixedFolder, "PlantedOwnRead.ts"),
        [
          'import DataAsset from "Common/Models/DatabaseModels/DataAsset";',
          'import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";',
          'import PermissionGate from "Common/UI/Utils/PermissionGate";',
          "",
          "export async function readAssets(): Promise<unknown> {",
          "  return await ModelAPI.getList<DataAsset>({",
          "    modelType: DataAsset,",
          "    select: PermissionGate.getSelectReadableThroughRelations(DataAsset, {",
          "      dataStore: { name: true, sensitivity: true },",
          "    }),",
          "  } as never);",
          "}",
        ].join("\n"),
      );

      const fixed: RelationSelectScan = await scanRelationSelects([
        fixedFolder,
      ]);

      expect(fixed.violations).toEqual([]);
      expect(
        fixed.sites.map((site: RelationSelectSite): string => {
          return `${site.relation}.${site.column} ${site.isReadPerReader}`;
        }),
      ).toEqual(["dataStore.name true", "dataStore.sensitivity true"]);
    } finally {
      fs.rmSync(fixedFolder, { recursive: true, force: true });
    }
  }, 600000);
});

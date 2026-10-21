import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import ts from "typescript";

/*
 * "We dont need to show these column in vmware: Can you please remove them
 * from the default view" - the maintainer, of the Collected By and Agent
 * Version columns on VMware > All vCenters.
 *
 * All vCenters opens on Name, Status, Last Seen, Labels and Owners, the
 * columns every infrastructure list opens on. Collected By and Agent Version
 * start hidden (isHiddenByDefault), and Customize Columns turns them back on;
 * neither is hideOnMobile, so that works on a phone too. What they said stays
 * on the vCenter's own pages: the Overview's vCenter Details shows the Agent
 * Version with its upgrade sign, and the Data Collection cards say how the
 * vCenter is collected.
 *
 * VMware's other lists, and the other agent-collected inventories, show
 * neither by default. These read the page sources (the App suite has no
 * React), through the TypeScript AST, so a reflow cannot fool them. The
 * pages are rendered, picker and all, in Common's
 * VMwareVCentersListColumns and VMwareVCentersListColumnPicker suites.
 */

const DASHBOARD_SRC: string = path.join(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Dashboard",
  "src",
);

const PAGES_DIR: string = path.join(DASHBOARD_SRC, "Pages");

// The two columns the list's default view leaves out.
const AGENT_COLUMN_TITLES: ReadonlyArray<string> = [
  "Collected By",
  "Agent Version",
];

// The fields those two read.
const AGENT_COLUMN_FIELDS: ReadonlyArray<string> = [
  "collectionMethod",
  "agentVersion",
];

interface DeclaredColumn {
  title: string;
  // Keys of `field`, or the column's `key` (a LocalTable / ResourceTable column).
  fields: Array<string>;
  // `isHiddenByDefault: true`, written as a literal.
  isHiddenByDefault: boolean;
  hideOnMobile: boolean;
  line: number;
}

function readPage(relativePath: string): string {
  return fs.readFileSync(path.join(PAGES_DIR, relativePath), "utf8");
}

function parsePage(relativePath: string): ts.SourceFile {
  return ts.createSourceFile(
    relativePath,
    readPage(relativePath),
    ts.ScriptTarget.Latest,
    true,
    relativePath.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
}

function visit(node: ts.Node, callback: (node: ts.Node) => void): void {
  callback(node);
  node.forEachChild((child: ts.Node): void => {
    visit(child, callback);
  });
}

function propertyName(property: ts.ObjectLiteralElementLike): string {
  return (property.name?.getText() || "").replace(/^["']|["']$/g, "");
}

function propertyNamed(
  object: ts.ObjectLiteralExpression,
  name: string,
): ts.PropertyAssignment | undefined {
  return object.properties.find(
    (
      property: ts.ObjectLiteralElementLike,
    ): property is ts.PropertyAssignment => {
      return (
        ts.isPropertyAssignment(property) && propertyName(property) === name
      );
    },
  );
}

function isTrueLiteral(property: ts.PropertyAssignment | undefined): boolean {
  return Boolean(
    property && property.initializer.kind === ts.SyntaxKind.TrueKeyword,
  );
}

/*
 * The array a table's columns are written in: `columns={[...]}` on a JSX
 * element, or `columns: [...]` in an object.
 */
function isColumnsArray(node: ts.Node): node is ts.ArrayLiteralExpression {
  if (!ts.isArrayLiteralExpression(node)) {
    return false;
  }
  const parent: ts.Node = node.parent;
  if (ts.isJsxExpression(parent) && ts.isJsxAttribute(parent.parent)) {
    return parent.parent.name.getText() === "columns";
  }
  if (ts.isPropertyAssignment(parent)) {
    return propertyName(parent) === "columns";
  }
  return false;
}

function readColumn(
  sourceFile: ts.SourceFile,
  object: ts.ObjectLiteralExpression,
): DeclaredColumn | null {
  const title: ts.PropertyAssignment | undefined = propertyNamed(
    object,
    "title",
  );
  if (!title || !ts.isStringLiteralLike(title.initializer)) {
    return null;
  }

  const fields: Array<string> = [];
  const field: ts.PropertyAssignment | undefined = propertyNamed(
    object,
    "field",
  );
  if (field && ts.isObjectLiteralExpression(field.initializer)) {
    for (const inner of field.initializer.properties) {
      fields.push(propertyName(inner));
    }
  }
  const key: ts.PropertyAssignment | undefined = propertyNamed(object, "key");
  if (key && ts.isStringLiteralLike(key.initializer)) {
    fields.push(key.initializer.text);
  }

  return {
    title: title.initializer.text,
    fields,
    isHiddenByDefault: isTrueLiteral(
      propertyNamed(object, "isHiddenByDefault"),
    ),
    hideOnMobile: isTrueLiteral(propertyNamed(object, "hideOnMobile")),
    line: sourceFile.getLineAndCharacterOfPosition(object.getStart()).line + 1,
  };
}

// Every table column a page declares, in the order it declares them.
function tableColumns(relativePath: string): Array<DeclaredColumn> {
  const sourceFile: ts.SourceFile = parsePage(relativePath);
  const columns: Array<DeclaredColumn> = [];

  visit(sourceFile, (node: ts.Node): void => {
    if (!isColumnsArray(node)) {
      return;
    }
    for (const element of node.elements) {
      if (!ts.isObjectLiteralExpression(element)) {
        continue;
      }
      const column: DeclaredColumn | null = readColumn(sourceFile, element);
      if (column) {
        columns.push(column);
      }
    }
  });

  return columns;
}

function titles(columns: Array<DeclaredColumn>): Array<string> {
  return columns.map((column: DeclaredColumn): string => {
    return column.title;
  });
}

// A column that says how a resource is collected, or its agent's version.
function isAgentColumn(column: DeclaredColumn): boolean {
  return (
    AGENT_COLUMN_TITLES.includes(column.title) ||
    column.fields.some((field: string): boolean => {
      return AGENT_COLUMN_FIELDS.includes(field);
    })
  );
}

function describeColumn(file: string, column: DeclaredColumn): string {
  return `${file}:${column.line} ${column.title}`;
}

const VCENTERS: string = "VMware/VCenters.tsx";

describe("All vCenters opens without Collected By and Agent Version", () => {
  const columns: Array<DeclaredColumn> = tableColumns(VCENTERS);

  test("declares its columns in this order", () => {
    expect(titles(columns)).toEqual([
      "Name",
      "Status",
      "Collected By",
      "Agent Version",
      "Last Seen",
      "Labels",
      "Owners",
    ]);
  });

  test("Collected By and Agent Version start hidden, and no other column does", () => {
    expect(
      titles(
        columns.filter((column: DeclaredColumn): boolean => {
          return column.isHiddenByDefault;
        }),
      ),
    ).toEqual([...AGENT_COLUMN_TITLES]);
  });

  test("they read how the vCenter is collected and its agent's version", () => {
    const collectedBy: DeclaredColumn | undefined = columns.find(
      (column: DeclaredColumn): boolean => {
        return column.title === "Collected By";
      },
    );
    const agentVersion: DeclaredColumn | undefined = columns.find(
      (column: DeclaredColumn): boolean => {
        return column.title === "Agent Version";
      },
    );

    expect(collectedBy?.fields).toEqual(["collectionMethod"]);
    expect(agentVersion?.fields).toEqual(["agentVersion"]);
  });

  /*
   * hideOnMobile drops a column at render while the picker knows nothing of
   * it: on a phone, switching one on would add no column.
   */
  test("neither is hideOnMobile, so Customize Columns can switch them on on a phone", () => {
    const unreachable: Array<string> = columns
      .filter((column: DeclaredColumn): boolean => {
        return column.isHiddenByDefault && column.hideOnMobile;
      })
      .map((column: DeclaredColumn): string => {
        return describeColumn(VCENTERS, column);
      });

    expect(unreachable).toEqual([]);
  });

  /*
   * Without a userPreferencesKey the table draws no picker, and a column
   * that starts hidden could never be switched on.
   */
  test("the list keeps a column layout, so its picker is there", () => {
    const source: string = readPage(VCENTERS);

    expect(source).toContain('userPreferencesKey="vmware-vcenters-table"');
    expect(source).not.toContain("disableColumnCustomization");
  });

  test("Collected By's probe name is still asked for, so the column draws at once when switched on", () => {
    const squashed: string = readPage(VCENTERS).replace(/\s+/g, "");

    expect(squashed).toContain(
      "selectMoreFields={{collectionMethod:true,collectionProbe:{name:true,},}}",
    );
  });
});

/*
 * The lists a vCenter's side menu opens (its hosts, virtual machines,
 * datastores, clusters and resource pools) and the archived vCenters: none
 * of them shows either column.
 */
const OTHER_VMWARE_LISTS: ReadonlyArray<string> = [
  "VMware/Archived.tsx",
  "VMware/View/Hosts.tsx",
  "VMware/View/VirtualMachines.tsx",
  "VMware/View/Datastores.tsx",
  "VMware/View/Clusters.tsx",
  "VMware/View/ResourcePools.tsx",
];

describe("VMware's other lists show neither column", () => {
  test.each(OTHER_VMWARE_LISTS)("%s", (file: string) => {
    const columns: Array<DeclaredColumn> = tableColumns(file);

    // A list with columns to read, or this would pass for the wrong reason.
    expect(columns.length).toBeGreaterThan(0);
    expect(
      columns.filter(isAgentColumn).map((column: DeclaredColumn): string => {
        return describeColumn(file, column);
      }),
    ).toEqual([]);
  });
});

/*
 * Out of the list, not out of the product: a vCenter's own pages say how it
 * is collected and which agent version sends it.
 */
describe("the vCenter's own pages keep what the list leaves out", () => {
  const OVERVIEW: string = "VMware/View/Index.tsx";

  // Every object a page writes with this title: a column, or a details field.
  function objectsTitled(file: string, title: string): Array<DeclaredColumn> {
    const sourceFile: ts.SourceFile = parsePage(file);
    const found: Array<DeclaredColumn> = [];

    visit(sourceFile, (node: ts.Node): void => {
      if (!ts.isObjectLiteralExpression(node)) {
        return;
      }
      const object: DeclaredColumn | null = readColumn(sourceFile, node);
      if (object && object.title === title) {
        found.push(object);
      }
    });

    return found;
  }

  test("the Overview shows the Agent Version among the vCenter's details", () => {
    expect(readPage(OVERVIEW)).toContain('name="vCenter Details"');
    expect(
      objectsTitled(OVERVIEW, "Agent Version").map(
        (field: DeclaredColumn): Array<string> => {
          return field.fields;
        },
      ),
    ).toEqual([["agentVersion"]]);
    // With its upgrade sign: AgentVersionDisplayGuard holds the page to it.
    expect(readPage(OVERVIEW)).toContain("kind={AgentKind.VMwareAgent}");
  });

  test("the Overview of a vCenter a probe collects shows how its collection is going", () => {
    const source: string = readPage(OVERVIEW);

    expect(source).toContain("isProbeCollected(vcenter)");
    expect(source).toContain("<VMwareCollectionStatusCard");
  });

  test("its Settings page shows the Data Collection card, for a probe and for the agent", () => {
    expect(readPage("VMware/View/Settings.tsx")).toContain(
      "<VMwareDataCollectionCard",
    );
  });
});

/*
 * The other inventories that an agent fills: none of their lists shows how a
 * resource is collected or its agent's version by default either - that is
 * on each resource's Overview. (A "Version" column on Proxmox, Ceph, storage
 * arrays or Docker Swarm is the version of the system being monitored, not
 * of the agent, and stays.)
 */
const INVENTORY_LISTS: ReadonlyArray<string> = [
  "Host/Hosts.tsx",
  "Host/Archived.tsx",
  "Kubernetes/Clusters.tsx",
  "Kubernetes/Archived.tsx",
  "Docker/Hosts.tsx",
  "Docker/Archived.tsx",
  "Podman/Hosts.tsx",
  "Podman/Archived.tsx",
  "DockerSwarm/Clusters.tsx",
  "DockerSwarm/Archived.tsx",
  "Proxmox/Clusters.tsx",
  "Proxmox/Archived.tsx",
  "Ceph/Clusters.tsx",
  "Ceph/Archived.tsx",
  "StorageArray/StorageArrays.tsx",
  "StorageArray/Archived.tsx",
  "IoT/Fleets.tsx",
  "IoT/Archived.tsx",
  "Database/Databases.tsx",
  "Database/Archived.tsx",
  "MessageQueue/MessageQueues.tsx",
  "MessageQueue/Archived.tsx",
  "Serverless/ServerlessFunctions.tsx",
  "Serverless/Archived.tsx",
];

describe("the other agent-collected inventories' lists open without them too", () => {
  test.each(INVENTORY_LISTS)("%s", (file: string) => {
    const columns: Array<DeclaredColumn> = tableColumns(file);

    expect(columns.length).toBeGreaterThan(0);
    expect(
      columns
        .filter((column: DeclaredColumn): boolean => {
          return isAgentColumn(column) && !column.isHiddenByDefault;
        })
        .map((column: DeclaredColumn): string => {
          return describeColumn(file, column);
        }),
    ).toEqual([]);
  });

  test("every product's list is in the scan", () => {
    const listed: Set<string> = new Set(
      INVENTORY_LISTS.map((file: string): string => {
        return file.split("/")[0] as string;
      }),
    );

    for (const product of [
      "Host",
      "Kubernetes",
      "Docker",
      "Podman",
      "DockerSwarm",
      "Proxmox",
      "Ceph",
      "StorageArray",
      "IoT",
      "Database",
      "MessageQueue",
      "Serverless",
    ]) {
      expect(listed.has(product)).toBe(true);
      expect(fs.existsSync(path.join(PAGES_DIR, product))).toBe(true);
    }
  });
});

describe("the column reader reads what a list declares", () => {
  /*
   * The scans above prove an absence, so prove the reader finds a column it
   * should: a hidden one, a hideOnMobile one, a field and a ResourceTable key.
   */
  test("it finds the vCenters list's hidden columns and their flags", () => {
    const columns: Array<DeclaredColumn> = tableColumns(VCENTERS);
    const labels: DeclaredColumn | undefined = columns.find(
      (column: DeclaredColumn): boolean => {
        return column.title === "Labels";
      },
    );

    expect(columns.filter(isAgentColumn)).toHaveLength(2);
    expect(labels?.hideOnMobile).toBe(true);
    expect(labels?.isHiddenByDefault).toBe(false);
  });

  test("it reads a ResourceTable column's key", () => {
    expect(tableColumns("VMware/View/Hosts.tsx")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          title: "CPU Capacity",
          fields: ["cpuCapacityMhz"],
        }),
      ]),
    );
  });
});

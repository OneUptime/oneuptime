import SqlServerPlatformUtil, {
  AZURE_SQL_DATABASE_MONITORING_GRANT,
  AZURE_SQL_DATABASE_SERVER_STATE_READER_GRANT,
  SQL_SERVER_MONITORING_GRANT,
  SqlServerEngineEdition,
} from "Common/Types/Monitor/DatabaseMonitor/SqlServerPlatform";
import slugify from "Common/Server/Types/MarkdownSlugify";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * https://github.com/OneUptime/oneuptime/issues/3913
 *
 * The Database Health docs against the grants the probe actually shows.
 *
 * The reporter asked for "the exact permission set required", and the page
 * had it wrong in two places: it said SQL Server's Storage group needs only
 * VIEW DATABASE STATE (its log and tempdb views need VIEW SERVER STATE), and
 * that on Azure SQL Database "the server-scoped groups then report as
 * unavailable, and the database-scoped Storage group still collects" (on
 * Azure the same views are opened by VIEW DATABASE STATE, or by the
 * ##MS_ServerStateReader## role on Basic, S0, S1 and elastic pools).
 *
 * The grant statements are read from the same constants the probe attaches
 * to a failed group and the monitor form prints, so the page cannot drift
 * from what the product tells the operator to run.
 */

const REPO_ROOT: string = path.resolve(__dirname, "../../../..");
const PAGE: string = "monitor/database-health-monitor.md";
const EN_PAGE: string = path.join(
  REPO_ROOT,
  "App/FeatureSet/Docs/Content/en",
  PAGE,
);
const FA_PAGE: string = path.join(
  REPO_ROOT,
  "App/FeatureSet/Docs/Content/fa",
  PAGE,
);
const DASHBOARD_SRC: string = path.join(
  REPO_ROOT,
  "App/FeatureSet/Dashboard/src",
);

// The login name every example on the page uses.
const EXAMPLE_PRINCIPAL: string = "oneuptime_health";

const readPage: (file: string) => string = (file: string): string => {
  return fs.readFileSync(file, "utf8");
};

// The product's placeholder grant, as the page writes it for its example login.
const asDocumented: (grant: string) => string = (grant: string): string => {
  return grant
    .replace("[<monitoring_login>]", EXAMPLE_PRINCIPAL)
    .replace("[<monitoring_user>]", EXAMPLE_PRINCIPAL);
};

const FENCE: RegExp = /^\s*```/;
const SOURCE_FILE: RegExp = /\.tsx?$/;

const codeBlocks: (markdown: string) => Array<string> = (
  markdown: string,
): Array<string> => {
  const blocks: Array<string> = [];
  let current: Array<string> | null = null;

  for (const line of markdown.split("\n")) {
    if (FENCE.test(line)) {
      if (current) {
        blocks.push(current.join("\n"));
        current = null;
      } else {
        current = [];
      }
      continue;
    }

    if (current) {
      current.push(line);
    }
  }

  return blocks;
};

const headingSlugs: (markdown: string) => Set<string> = (
  markdown: string,
): Set<string> => {
  const slugs: Set<string> = new Set<string>();
  let inFence: boolean = false;

  for (const line of markdown.split("\n")) {
    if (FENCE.test(line)) {
      inFence = !inFence;
      continue;
    }

    const match: RegExpMatchArray | null = inFence
      ? null
      : line.match(/^#{1,6}\s+(.*)$/);

    if (match && match[1]) {
      slugs.add(slugify(match[1].trim()));
    }
  }

  return slugs;
};

const tableRow: (markdown: string, firstCell: string) => string = (
  markdown: string,
  firstCell: string,
): string => {
  const row: string | undefined = markdown.split("\n").find((line: string) => {
    return line.startsWith(`| ${firstCell} |`);
  });

  expect({ firstCell, found: row !== undefined }).toEqual({
    firstCell,
    found: true,
  });

  return row || "";
};

const filesUnder: (dir: string) => Array<string> = (
  dir: string,
): Array<string> => {
  const found: Array<string> = [];

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full: string = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      found.push(...filesUnder(full));
    } else if (SOURCE_FILE.test(entry.name)) {
      found.push(full);
    }
  }

  return found;
};

describe("Database Health docs: SQL Server grants (issue #3913)", () => {
  const page: string = readPage(EN_PAGE);

  test("documents the SQL Server grant the probe shows", () => {
    expect(page).toContain(asDocumented(SQL_SERVER_MONITORING_GRANT));
  });

  test("documents both Azure SQL Database grants the probe shows", () => {
    expect(page).toContain(asDocumented(AZURE_SQL_DATABASE_MONITORING_GRANT));
    expect(page).toContain(
      asDocumented(AZURE_SQL_DATABASE_SERVER_STATE_READER_GRANT),
    );
  });

  test("runs the SQL Server grant in master, the only place a server-scope grant works", () => {
    /*
     * Verified on 2017 and 2022: from any other database the GRANT fails
     * with Msg 4621. The block must switch to master before granting.
     */
    const useMaster: number = page.indexOf("USE master;");
    const grant: number = page.indexOf(
      asDocumented(SQL_SERVER_MONITORING_GRANT),
    );

    expect(useMaster).toBeGreaterThan(-1);
    expect(grant).toBeGreaterThan(useMaster);
    expect(page).toContain("Msg 4621");
  });

  test("says a contained user cannot use the server-role fallback", () => {
    expect(page).toContain("server roles take logins only");
    expect(page).toContain("DROP USER oneuptime_health;");
  });

  test("says which Azure tiers need the server role instead of the database grant", () => {
    expect(page).toMatch(/Basic, S0 and S1/);
    expect(page).toMatch(/elastic pool/);
    expect(page).toContain("`master`");
  });

  test("no longer claims the Storage group needs only VIEW DATABASE STATE on SQL Server", () => {
    const storage: string = tableRow(page, "Storage");

    expect(storage).toContain("none for database size");
    expect(storage).toContain(
      "`VIEW SERVER STATE` for log space and tempdb free space",
    );
    expect(storage).not.toMatch(/SQL Server: `VIEW DATABASE STATE` \|$/);
  });

  test("no longer claims Azure SQL Database collects the Storage group on VIEW DATABASE STATE alone", () => {
    expect(page).not.toContain(
      "the database-scoped Storage group still collects",
    );
  });

  test("says Replication is not collected on Azure SQL Database", () => {
    expect(tableRow(page, "Replication")).toContain(
      "not collected on Azure SQL Database",
    );
    expect(page).toContain("sys.dm_hadr_database_replica_states");
  });

  test("names the error the reporter saw, so searching for it finds the fix", () => {
    expect(page).toContain(
      "The user does not have permission to perform this action",
    );
    expect(page).toContain("VIEW SERVER STATE permission was denied");
  });

  test("warns that read access to tables is not enough", () => {
    expect(page).toContain("Read access to your tables is not enough");
    expect(page).toContain("db_datareader");
  });

  test("shows the Engine the summary reads for Azure SQL Database", () => {
    expect(page).toContain(
      `${SqlServerPlatformUtil.getPlatformName(
        SqlServerEngineEdition.AzureSqlDatabase,
      )} 12.0.2000.8`,
    );
    expect(page).toContain("SERVERPROPERTY('EngineEdition')");
  });
});

describe("Database Health docs: anchors", () => {
  const page: string = readPage(EN_PAGE);
  const slugs: Set<string> = headingSlugs(page);

  test("every in-page link on the English page resolves to a heading", () => {
    const anchors: Array<string> = Array.from(
      page.matchAll(/\]\(#([^)]+)\)/g),
    ).map((match: RegExpMatchArray) => {
      return match[1] || "";
    });

    expect(anchors).toContain("azure-sql-database");

    for (const anchor of anchors) {
      expect({ anchor, resolves: slugs.has(anchor) }).toEqual({
        anchor,
        resolves: true,
      });
    }
  });

  test("the Farsi page a language-negotiated link may land on exists", () => {
    /*
     * The Dashboard links are language-less: /docs sends the reader to
     * their own language. Anchors are English heading ids, so on the Farsi
     * page the fragment matches nothing and the page opens at the top -
     * degraded, not broken, because the page itself is there.
     */
    expect(fs.existsSync(FA_PAGE)).toBe(true);
  });

  test("every Dashboard link into this page lands on a heading that exists", () => {
    /*
     * Discovered, not enumerated: whichever Dashboard source links into the
     * page, the anchor it uses must survive a heading being reworded.
     */
    const links: Array<{ file: string; anchor: string }> = [];

    for (const file of filesUnder(DASHBOARD_SRC)) {
      const source: string = fs.readFileSync(file, "utf8");

      for (const match of source.matchAll(
        /\/monitor\/database-health-monitor#([a-z0-9-]+)/g,
      )) {
        links.push({
          file: path.relative(REPO_ROOT, file),
          anchor: match[1] || "",
        });
      }
    }

    expect(links.length).toBeGreaterThan(0);

    for (const link of links) {
      expect({ ...link, resolves: slugs.has(link.anchor) }).toEqual({
        ...link,
        resolves: true,
      });
    }
  });
});

describe("Database Health docs: the Farsi translation", () => {
  test("carries exactly the English SQL, in the same order", () => {
    /*
     * The statements are what an operator copies. A translation that kept
     * the old Azure paragraph, or an old code block, would hand Farsi
     * readers the grant that fails on Azure SQL Database.
     */
    expect(codeBlocks(readPage(FA_PAGE))).toEqual(
      codeBlocks(readPage(EN_PAGE)),
    );
  });

  test("documents the same SQL Server and Azure grants", () => {
    const page: string = readPage(FA_PAGE);

    expect(page).toContain(asDocumented(SQL_SERVER_MONITORING_GRANT));
    expect(page).toContain(asDocumented(AZURE_SQL_DATABASE_MONITORING_GRANT));
    expect(page).toContain(
      asDocumented(AZURE_SQL_DATABASE_SERVER_STATE_READER_GRANT),
    );
    expect(page).toContain(
      "The user does not have permission to perform this action",
    );
  });

  test("every in-page link on the Farsi page resolves to a heading", () => {
    const page: string = readPage(FA_PAGE);
    const slugs: Set<string> = headingSlugs(page);

    for (const match of page.matchAll(/\]\(#([^)]+)\)/g)) {
      const anchor: string = match[1] || "";

      expect({ anchor, resolves: slugs.has(anchor) }).toEqual({
        anchor,
        resolves: true,
      });
    }
  });
});

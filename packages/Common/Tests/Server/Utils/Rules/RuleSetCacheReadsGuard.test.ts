import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * GUARD: the rules an incident's or an alert's create runs are read through
 * RuleSetCache (#6085), and every write that can change them reaches it.
 *
 *   - Each engine the create runs reads its project's enabled rules with
 *     RuleSetCache.findEnabledRules, naming its own rule service - never
 *     with a read of its own, which would read Postgres for every record
 *     again, nor through a service the cache does not watch.
 *   - DatabaseService tells RuleSetCache of every write, after it is done:
 *     a create, an update and both deletes, each once its own hooks have
 *     run (in a finally, so a write that fails part way counts too), and
 *     every write that skips the hooks.
 *
 * RuleSetCachePostgres.test.ts holds the same on a real Postgres: the reads
 * taken off the engines themselves, and what they hand out after every kind
 * of write.
 */

const SERVICES: string = path.resolve(__dirname, "../../../../Server/Services");

/*
 * A hook-free write telling the cache. Hoisted: `/x/.test(y)` inline is a
 * fight between wrap-regex and prettier.
 */
const TELLS_THE_CACHE: RegExp = /this\.afterWriteWithoutHooks\(/;

function read(fileName: string): string {
  return fs.readFileSync(path.join(SERVICES, fileName), "utf8");
}

// Each engine a create runs, and the rule service it reads through.
const ENGINE_READS: ReadonlyArray<{ engine: string; ruleService: string }> = [
  {
    engine: "IncidentPrivacyRuleEngineService.ts",
    ruleService: "IncidentPrivacyRuleService",
  },
  {
    engine: "IncidentOwnerRuleEngineService.ts",
    ruleService: "IncidentOwnerRuleService",
  },
  {
    engine: "IncidentLabelRuleEngineService.ts",
    ruleService: "IncidentLabelRuleService",
  },
  {
    engine: "IncidentOnCallRuleEngineService.ts",
    ruleService: "IncidentOnCallRuleService",
  },
  {
    engine: "IncidentGroupingEngineService.ts",
    ruleService: "IncidentGroupingRuleService",
  },
  {
    engine: "AlertPrivacyRuleEngineService.ts",
    ruleService: "AlertPrivacyRuleService",
  },
  {
    engine: "AlertOwnerRuleEngineService.ts",
    ruleService: "AlertOwnerRuleService",
  },
  {
    engine: "AlertLabelRuleEngineService.ts",
    ruleService: "AlertLabelRuleService",
  },
  {
    engine: "AlertOnCallRuleEngineService.ts",
    ruleService: "AlertOnCallRuleService",
  },
  {
    engine: "AlertGroupingEngineService.ts",
    ruleService: "AlertGroupingRuleService",
  },
  {
    engine: "AlertIncidentRuleEngineService.ts",
    ruleService: "AlertIncidentRuleService",
  },
  {
    engine: "RunbookRuleEngineService.ts",
    ruleService: "RunbookRuleService",
  },
  {
    engine: "AutoRemediationRuleEngineService.ts",
    ruleService: "AutoRemediationRuleService",
  },
];

// The body of one method of a class, from its signature to the next member.
function methodBody(source: string, signature: RegExp): string {
  const start: number = source.search(signature);

  expect(start).toBeGreaterThanOrEqual(0);

  const next: number = source
    .slice(start + 1)
    .search(/\n {2}(public|private|protected) (async |static )*[a-zA-Z]+[<(]/);

  return next === -1
    ? source.slice(start)
    : source.slice(start, start + 1 + next);
}

describe("GUARD: the rules a create runs are read through RuleSetCache", () => {
  test.each(ENGINE_READS)(
    "$engine reads its rules through RuleSetCache, with $ruleService",
    ({ engine, ruleService }: { engine: string; ruleService: string }) => {
      const source: string = read(engine);

      expect(source).toMatch(
        /import RuleSetCache from "\.\.\/Utils\/Rules\/RuleSetCache";/,
      );

      // The read, through the cache, naming the engine's own rule service.
      expect(source).toMatch(
        new RegExp(
          `RuleSetCache\\.findEnabledRules<[A-Za-z]+>\\(\\{\\s*service: ${ruleService},`,
        ),
      );

      // And no read of the enabled rules of its own beside it.
      expect(source).not.toMatch(
        new RegExp(
          `${ruleService}\\.findBy\\(\\{\\s*query: \\{\\s*projectId: [^}]*isEnabled: true`,
        ),
      );
    },
  );

  test("DatabaseService tells RuleSetCache of every write, once its hooks have run", () => {
    const source: string = read("DatabaseService.ts");

    // A create: last, in the finally, once its row was written.
    const create: string = methodBody(source, /\n {2}private async _create\(/);
    expect(create).toMatch(
      /finally \{[\s\S]*if \(isRowWritten\) \{\s*await RuleSetCache\.afterCreate\(\{/,
    );
    expect(create.indexOf("isRowWritten = true;")).toBeGreaterThan(
      create.indexOf("getRepository().save(createBy.data)"),
    );
    expect(create.lastIndexOf("RuleSetCache.afterCreate(")).toBeGreaterThan(
      create.lastIndexOf("this.onCreateSuccess("),
    );

    // An update: in the finally, after its onUpdateSuccess.
    const update: string = methodBody(
      source,
      /\n {2}private async _updateBy\(/,
    );
    expect(update).toMatch(
      /\} finally \{[\s\S]*await RuleSetCache\.afterUpdate\(\{\s*tableName: this\.model\.tableName,\s*rows: rowsOfWrite,\s*written: writtenData,/,
    );
    expect(update.lastIndexOf("RuleSetCache.afterUpdate(")).toBeGreaterThan(
      update.lastIndexOf("this.onUpdateSuccess("),
    );

    // Both deletes: in the finally, after their hooks.
    for (const [signature, hook] of [
      [/\n {2}private async _deleteBy\(/, "this.onDeleteSuccess("],
      [/\n {2}public async hardDeleteBy\(/, "this.onHardDeleteSuccess("],
    ] as Array<[RegExp, string]>) {
      const remove: string = methodBody(source, signature);

      expect(remove).toMatch(/rowsOfDelete = items;/);
      expect(remove).toMatch(
        /\} finally \{[\s\S]*await RuleSetCache\.afterDelete\(\{\s*tableName: this\.model\.tableName,\s*rows: rowsOfDelete,/,
      );
      expect(remove.lastIndexOf("RuleSetCache.afterDelete(")).toBeGreaterThan(
        remove.lastIndexOf(hook),
      );
    }

    // Every write that skips the hooks, after its statement.
    for (const writer of [
      "updateColumnsByIdWithoutHooks",
      "compareAndSetColumnsByIdWithoutHooks",
      "updateColumnsByIdIfUnlockedWithoutHooks",
      "atomicAddToColumnsByIdWithoutHooks",
      "atomicAddToColumnsByIdAndGetValuesWithoutHooks",
      "atomicIncrementColumnValueByOneAndGetValue",
      "atomicIncrementColumnValueByOne",
      "atomicDecrementColumnValueBy",
    ]) {
      const body: string = methodBody(
        source,
        new RegExp(`\\n {2}(public|protected) async ${writer}\\(`),
      );

      expect({
        writer,
        tellsTheCache: TELLS_THE_CACHE.test(body),
      }).toEqual({
        writer,
        tellsTheCache: true,
      });
    }
  });
});

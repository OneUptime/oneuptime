/*
 * The db command policy: tiers the typed catalog of diagnostic operations
 * (never free SQL) the Database AI agent runs against a database server.
 *
 * A command is `db <operation> [argument] [--flag value]...`, read by the
 * catalog's grammar (DatabaseDiagnosticCatalog.parseDatabaseCommand) — the
 * same parse the agent's executor uses to decide what to run, so the policy
 * and the executor can never read one argv two ways. Whatever the grammar
 * does not read as exactly one catalog operation is Denied, with a reason
 * that names what IS available.
 *
 * Tiers come from the catalog:
 *   - Read: every diagnostic (ping, version, sessions, long-queries,
 *     blocking, locks, replication, connections, database-sizes,
 *     table-sizes, top-statements, settings, slowlog, info, innodb-status,
 *     memory, keyspace);
 *   - SafeWrite: `db cancel-query ID` — cancels the statement ONE named
 *     session is running; the session stays connected and its client can
 *     retry, so nothing is lost that a retry does not restore;
 *   - RiskyWrite: `db terminate-session ID` — disconnects ONE named session
 *     and rolls back its open transaction;
 *   - Denied: everything else — SQL, database commands, scripts, setting
 *     changes, FLUSHALL, SHUTDOWN, DDL, unknown operations and flags,
 *     connection flags, malformed values.
 * A write's target is `session:ID`, the form the agent's protectedTargets
 * and ONEUPTIME_AI_WRITE_TARGETS globs are matched against.
 *
 * The result's args are the catalog's canonical argv (operation, argument,
 * flags in catalog order as `--flag value`), which evaluates to itself: the
 * job the agent receives, the command a human approves and the query the
 * executor runs are one thing.
 *
 * Part of the import-closed resource policy directory that the resource AI
 * agent carries a byte-identical copy of: relative imports of that set only.
 */

import { ResourceCommandTier } from "../../../Types/ResourceAiAgent/ResourceAiAccess";
import {
  ResourceCommandPolicyResult,
  ResourceToolPolicy,
  deniedResult,
  renderResourceDisplayCommand,
} from "./ResourceCommandPolicyCore";
import {
  DATABASE_PROGRAM,
  DatabaseCommandParse,
  DatabaseOperationSpec,
  ParsedDatabaseCommand,
  getDatabaseReadCommandGuide,
  getDatabaseWriteCommandGuide,
  parseDatabaseCommand,
} from "./DatabaseDiagnosticCatalog";

export {
  getDatabaseReadCommandGuide,
  getDatabaseWriteCommandGuide,
} from "./DatabaseDiagnosticCatalog";

// The target a session write names, as write-scope globs see it.
export function databaseSessionTarget(id: string | number): string {
  return `session:${id}`;
}

/*
 * A Denied result that cannot throw: deniedResult reads the argv, and an
 * argv that throws when read (it made the parse throw) is described without
 * it.
 */
function refused(argv: unknown, reason: string): ResourceCommandPolicyResult {
  try {
    return deniedResult(argv as Array<string>, reason);
  } catch {
    return {
      tier: ResourceCommandTier.Denied,
      reason,
      program: DATABASE_PROGRAM,
      args: [],
      verb: "",
      displayCommand: DATABASE_PROGRAM,
      targets: [],
    };
  }
}

function describeTier(
  operation: DatabaseOperationSpec,
  command: ParsedDatabaseCommand,
): string {
  const id: string = command.argument === null ? "" : String(command.argument);

  switch (operation.tier) {
    case ResourceCommandTier.Read:
      return `db ${operation.name} is a read-only diagnostic: it ${operation.summary}`;

    case ResourceCommandTier.SafeWrite:
      return `db ${operation.name} changes one session only (${databaseSessionTarget(
        id,
      )}): it ${operation.summary}`;

    default:
      return `db ${operation.name} changes one session only (${databaseSessionTarget(
        id,
      )}), and the change cannot be undone: it ${operation.summary}`;
  }
}

function evaluateDatabaseArgv(
  argv: Array<string>,
): ResourceCommandPolicyResult {
  const parse: DatabaseCommandParse = parseDatabaseCommand(argv);

  if (!parse.ok) {
    return refused(argv, parse.errorMessage);
  }

  const command: ParsedDatabaseCommand = parse.command;
  const operation: DatabaseOperationSpec = command.operation;
  const tier: ResourceCommandTier = operation.tier;

  if (
    tier !== ResourceCommandTier.Read &&
    tier !== ResourceCommandTier.SafeWrite &&
    tier !== ResourceCommandTier.RiskyWrite
  ) {
    return refused(argv, `db ${operation.name} is not allowed`);
  }

  const isWrite: boolean = tier !== ResourceCommandTier.Read;

  // A write always names its one session; fail closed if it somehow did not.
  if (isWrite && command.argument === null) {
    return refused(
      argv,
      `db ${operation.name} must name the one session it changes`,
    );
  }

  return {
    tier,
    reason: describeTier(operation, command),
    program: DATABASE_PROGRAM,
    args: command.canonicalArgs.slice(),
    verb: operation.name,
    displayCommand: renderResourceDisplayCommand([
      DATABASE_PROGRAM,
      ...command.canonicalArgs,
    ]),
    targets: isWrite ? [databaseSessionTarget(String(command.argument))] : [],
  };
}

const DatabaseCommandPolicy: ResourceToolPolicy = {
  name: "db",
  programs: [DATABASE_PROGRAM],
  readCommandGuide: getDatabaseReadCommandGuide(),
  writeCommandGuide: getDatabaseWriteCommandGuide(),
  evaluateArgv(argv: Array<string>): ResourceCommandPolicyResult {
    try {
      return evaluateDatabaseArgv(argv);
    } catch {
      return refused(argv, "the db command policy could not read this command");
    }
  },
};

export default DatabaseCommandPolicy;

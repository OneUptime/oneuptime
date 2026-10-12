import { StatementContext, WriteStep } from "./StatementOutcome";

/*
 * WHERE A CREATE, UPDATE OR DELETE IS, FOR ITS ERROR HOOK.
 *
 * DatabaseService runs each repository write - the INSERT of a create
 * (save(), in a transaction of its own), each row's UPDATE (update(), or
 * save() for a list of related records), the DELETE - through write(). A
 * failure while one runs is the write's own; any other - a check, a hook, a
 * helper before or after it - is around the write, and applied nothing of
 * it (StatementOutcome). The error hooks are handed which it was
 * (getFailedStatement), so a service holding a lock for the write
 * (ProjectSsoProviderChanges, AiCommandCredentialReach) keeps it only while
 * the write itself may still land.
 *
 * One per create, update or delete: their statements run one after another.
 */
export default class WriteProgress {
  // The repository write running now, if one is.
  private writing: { inOwnTransaction: boolean } | null = null;

  /*
   * Runs one repository write: a failure while it runs is the write's own.
   * `inOwnTransaction` - it is a save(), committed in a transaction of its
   * own.
   */
  public async write<T>(
    inOwnTransaction: boolean,
    run: () => Promise<T>,
  ): Promise<T> {
    this.writing = { inOwnTransaction };

    const result: T = await run();

    this.writing = null;

    return result;
  }

  // Which step a failure now is: the write's own statement, or one around it.
  public getFailedStatement(): StatementContext {
    if (this.writing) {
      return {
        failedStep: WriteStep.Write,
        inOwnTransaction: this.writing.inOwnTransaction,
      };
    }

    return { failedStep: WriteStep.AroundWrite };
  }
}

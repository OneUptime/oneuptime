import Model from "../../Models/DatabaseModels/CloudTagCoverageDay";
import ProjectReferencesService from "./ProjectReferencesService";

// The day's counts, each required: 0 is a count like any other.
const COUNT_COLUMNS: ReadonlyArray<string> = ["resourceCount", "coveredCount"];

/*
 * How many of an account's resources carried its required tags, a row a
 * day (CloudTagCoverageDay, #11012). Written only by the watcher
 * (CloudTagWatcher), as OneUptime; people read the trend.
 */
export class Service extends ProjectReferencesService<Model> {
  public constructor() {
    super(Model);
  }

  /*
   * A day on which none of the account's resources carried every required
   * tag counts 0 covered - the day a project first requires a tag, most
   * often - and an account whose connection listed no resources counts 0 of
   * them. The required-column check reads a 0 as missing, so the watcher's
   * count of such a day was refused ("coveredCount is required") and the
   * trend skipped it.
   */
  protected override isRequiredColumnValueGiven(
    column: string,
    value: unknown,
  ): boolean {
    if (
      COUNT_COLUMNS.includes(column) &&
      typeof value === "number" &&
      Number.isInteger(value) &&
      value >= 0
    ) {
      return true;
    }

    return super.isRequiredColumnValueGiven(column, value);
  }
}

export default new Service();

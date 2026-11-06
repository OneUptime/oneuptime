import DatabaseService from "./DatabaseService";
import Model from "../../Models/DatabaseModels/CloudCostRecommendation";

/*
 * The ways to spend less in the connected cloud accounts
 * (CloudCostRecommendation): written by the cloud connections' savings lane
 * only (CloudSavingsWriter), as root. Read through the API and the Cloud
 * pages; nobody creates, edits or deletes one.
 */
export class Service extends DatabaseService<Model> {
  public constructor() {
    super(Model);
  }

  /*
   * 0 is a saving: what a right-sizing saves is 0 while its resource's cost
   * is not known (CloudRightSizing), which the Cloud pages show as "Not
   * known yet", and a cloud's own saving can round to 0. The required-column
   * check read 0 as missing, so such a recommendation was refused as
   * "monthlySavings is required" on its first write, and the savings lane
   * logged it and dropped it. Any number is a value of it; anything else is
   * still read as the check reads it.
   */
  protected override isRequiredColumnValueGiven(
    column: string,
    value: unknown,
  ): boolean {
    if (
      column === "monthlySavings" &&
      typeof value === "number" &&
      Number.isFinite(value)
    ) {
      return true;
    }

    return super.isRequiredColumnValueGiven(column, value);
  }
}

export default new Service();

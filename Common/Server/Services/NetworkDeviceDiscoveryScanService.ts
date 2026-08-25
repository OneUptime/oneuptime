import DatabaseService from "./DatabaseService";
import Model from "../../Models/DatabaseModels/NetworkDeviceDiscoveryScan";
import { OnCreate, OnUpdate } from "../Types/Database/Hooks";
import CreateBy from "../Types/Database/CreateBy";
import UpdateBy from "../Types/Database/UpdateBy";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import BadDataException from "../../Types/Exception/BadDataException";
import ScanTargetUtil from "../../Utils/NetworkDiscovery/ScanTargetUtil";
import ScanNameUtil from "../../Utils/NetworkDiscovery/ScanNameUtil";

export class Service extends DatabaseService<Model> {
  public constructor() {
    super(Model);
  }

  /*
   * Validate the scan target at write time, with the same parser the probe
   * expands it with (Common/Utils/NetworkDiscovery/ScanTargetUtil).
   *
   * Without this, a typo'd target is accepted, sits Pending until a probe
   * claims it, and only surfaces minutes later as a Failed scan with the
   * parser's complaint buried in statusMessage. Octet-range notation makes
   * that far likelier than CIDR did — a reversed range ("10.22-16.0.1-20") or
   * an out-of-range octet is easy to type and impossible to spot by eye — so
   * the feedback belongs on the form, not on a scan result.
   *
   * The size ceiling is checked here too: an oversized target is rejected the
   * moment it is entered rather than after a probe has been handed a sweep it
   * refuses to run.
   */
  @CaptureSpan()
  protected override async onBeforeCreate(
    createBy: CreateBy<Model>,
  ): Promise<OnCreate<Model>> {
    this.validateScanTarget(createBy.data.cidr);

    /*
     * The name is normalized as well as validated — collapsed onto one line,
     * trimmed, and a blank one dropped entirely — so the column holds either a
     * name or nothing. An empty string stored here would read as a name to
     * every `scan.name ?` in the product and render as a blank line above the
     * scan target. See ScanNameUtil.
     */
    this.validateScanName(createBy.data.name);

    /*
     * Written through a cast because `exactOptionalPropertyTypes` forbids
     * assigning `undefined` to an optional property — and dropping a blank
     * name is exactly that assignment. Undefined rather than null: a model
     * instance starts with every column undefined, so this leaves the row in
     * the state a scan created without a name would already have been in.
     */
    (createBy.data as unknown as Record<string, unknown>)["name"] =
      ScanNameUtil.normalize(createBy.data.name) ?? undefined;

    return { createBy, carryForward: null };
  }

  /*
   * The target column is not user-updatable (its ColumnAccessControl grants no
   * update permission), but root writers — the probe-ingest endpoints, workers,
   * migrations — bypass that. Validating any update that carries the column
   * keeps the invariant true for every writer instead of just the form.
   */
  @CaptureSpan()
  protected override async onBeforeUpdate(
    updateBy: UpdateBy<Model>,
  ): Promise<OnUpdate<Model>> {
    const dataKeys: Array<string> = Object.keys(updateBy.data || {});

    if (dataKeys.includes("cidr")) {
      this.validateScanTarget(
        (updateBy.data as Record<string, unknown>)["cidr"],
      );
    }

    /*
     * The name IS user-updatable — renaming a scan is the whole point of
     * letting it be named — so this path is the one the form actually takes,
     * not just a guard against root writers.
     *
     * Cleared with null rather than left as "": the form sends back an empty
     * box as an empty string, and the operator who emptied it meant "this scan
     * has no name", which is what NULL says. `undefined` would not do — the
     * key is present in the update, and an undefined value is a column TypeORM
     * would try to write.
     */
    if (dataKeys.includes("name")) {
      const data: Record<string, unknown> = updateBy.data as Record<
        string,
        unknown
      >;

      this.validateScanName(data["name"]);
      data["name"] = ScanNameUtil.normalize(data["name"]);
    }

    return { updateBy, carryForward: null };
  }

  /*
   * The value is passed through UNTOUCHED. It arrives straight from the
   * request JSON — BaseAPI assigns ShortText columns verbatim, and this hook
   * runs before the model's type and length checks — so it may be a number,
   * an object or an array, not just a string. ScanTargetUtil already type-
   * guards and trims internally; normalizing here (the obvious
   * `(target || "").trim()`) would instead throw a TypeError on any truthy
   * non-string and turn an intended 400 into a 500.
   */
  private validateScanTarget(target: unknown): void {
    const validationError: string | null = ScanTargetUtil.getValidationError(
      target as string,
    );

    if (validationError) {
      throw new BadDataException(validationError);
    }
  }

  /*
   * Same contract as validateScanTarget above: the value is passed through
   * untouched, because it arrives straight from the request JSON and may be a
   * number, an object or an array rather than a string. ScanNameUtil type-
   * guards internally and reports a non-string as such.
   *
   * An ABSENT or blank name is not an error — the column is optional, and a
   * scan with no name reads as it always did, by its target.
   */
  private validateScanName(name: unknown): void {
    const validationError: string | null =
      ScanNameUtil.getValidationError(name);

    if (validationError) {
      throw new BadDataException(validationError);
    }
  }
}

export default new Service();

import ProjectReferencesService from "./ProjectReferencesService";
import Model from "../../Models/DatabaseModels/LogScrubRule";
import CreateBy from "../Types/Database/CreateBy";
import Select from "../Types/Database/Select";
import UpdateBy from "../Types/Database/UpdateBy";
import { OnCreate } from "../Types/Database/Hooks";
import {
  LOG_SCRUB_FIELDS,
  LOG_SCRUB_PATTERN_TYPES,
} from "../../Types/Telemetry/ScrubRule";
import {
  normalizeScrubRuleKeys,
  ScrubRuleValidationOptions,
  validateScrubRuleCreate,
  validateScrubRuleUpdate,
} from "../Utils/ScrubRuleValidation";

const VALIDATION_OPTIONS: ScrubRuleValidationOptions = {
  recordNoun: "logs",
  patternTypes: LOG_SCRUB_PATTERN_TYPES,
  fieldsToScrub: LOG_SCRUB_FIELDS,
};

/*
 * A rule names the service whose logs it scrubs (#10433), and a caller writes
 * it: so the service must be the project's own (ProjectReferencesService),
 * or a rule could name another project's service and read its name back
 * through the relation.
 */
export class Service extends ProjectReferencesService<Model> {
  public constructor() {
    super(Model);
  }

  /*
   * The service a rule names is the project's own, checked first (the base
   * hook). Then a rule is refused unless ingest can scrub with it - a Custom
   * Regex rule with no pattern, or one that does not compile, scrubbed
   * nothing while it looked active. See Utils/ScrubRuleValidation.ts. An
   * update's service is checked by the base onBeforeUpdate.
   */
  protected override async onBeforeCreate(
    createBy: CreateBy<Model>,
  ): Promise<OnCreate<Model>> {
    await super.onBeforeCreate(createBy);

    // The attributes it names, as a list (#10366).
    normalizeScrubRuleKeys(createBy.data);
    validateScrubRuleCreate(createBy.data, VALIDATION_OPTIONS);

    return { createBy, carryForward: null };
  }

  /*
   * An update is judged on the rows it matches, once the caller has passed
   * the permission checks and the query is narrowed to the rows they may
   * write - so the stored rows read to merge it over are never another
   * project's.
   */
  protected override async onBeforeUpdateUniqueCheck(
    updateBy: UpdateBy<Model>,
  ): Promise<void> {
    /*
     * The attributes an update names, as a list (#10366): here, not in
     * onBeforeUpdate, which runs before the permission checks and is the
     * base's alone (it checks the service a rule names is the project's).
     */
    normalizeScrubRuleKeys(updateBy.data as { attributeKeys?: unknown });

    await validateScrubRuleUpdate<Model>({
      updateBy: updateBy,
      findRowsAndHoldUpdateToThem: async (
        select: Select<Model>,
      ): Promise<Array<Model>> => {
        return await this.findRowsAndHoldUpdateToThem(updateBy, select);
      },
      options: VALIDATION_OPTIONS,
    });
  }
}

export default new Service();

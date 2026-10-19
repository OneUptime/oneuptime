import ProjectReferencesService from "./ProjectReferencesService";
import Model from "../../Models/DatabaseModels/MetricPipelineRule";
import CreateBy from "../Types/Database/CreateBy";
import UpdateBy from "../Types/Database/UpdateBy";
import { validateMetricPipelineRuleFilters } from "../Utils/MetricPipelineRuleValidation";

export class Service extends ProjectReferencesService<Model> {
  public constructor() {
    super(Model);
  }

  /*
   * A regex filter ingest cannot run - not a regular expression, a
   * back-reference, too large - is refused when it is saved, with what to
   * change, rather than saved into a rule that never applies. It looks
   * nothing up, so it answers before the project's references are checked.
   * See Utils/MetricPipelineRuleValidation.ts.
   */
  protected override async checkCreateBeforeReferences(
    createBy: CreateBy<Model>,
  ): Promise<void> {
    validateMetricPipelineRuleFilters(createBy.data.filters);
  }

  // An update that sends no filters is not judged on the ones saved before.
  protected override async checkUpdateBeforeReferences(
    updateBy: UpdateBy<Model>,
  ): Promise<void> {
    validateMetricPipelineRuleFilters(
      (updateBy.data as { filters?: unknown }).filters,
    );
  }
}

export default new Service();

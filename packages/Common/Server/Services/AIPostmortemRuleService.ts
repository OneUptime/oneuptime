import ProjectReferencesService from "./ProjectReferencesService";
import Model from "../../Models/DatabaseModels/AIPostmortemRule";
import CreateBy from "../Types/Database/CreateBy";
import UpdateBy from "../Types/Database/UpdateBy";
import BadDataException from "../../Types/Exception/BadDataException";
import { getPostmortemRuleTemplatesProblem } from "../../Types/AI/PostmortemRuleTemplates";

/*
 * Postmortem rules: which resolved incidents OneUptime AI drafts a
 * postmortem for, and the templates each draft may follow
 * (Utils/AI/SRE/PostmortemRules reads them).
 *
 * Every monitor, severity, label and template a rule names must be the
 * project's own (ProjectReferencesService), and a rule names at most
 * MAX_POSTMORTEM_RULE_TEMPLATES templates - a draft whose rule names
 * several lists them all for OneUptime AI to pick from. That count needs no
 * lookup, so it is answered first, before any reference is read.
 */
export class Service extends ProjectReferencesService<Model> {
  public constructor() {
    super(Model);
  }

  protected override async checkCreateBeforeReferences(
    createBy: CreateBy<Model>,
  ): Promise<void> {
    this.assertTemplatesFit(createBy.data.postmortemTemplates);
  }

  protected override async checkUpdateBeforeReferences(
    updateBy: UpdateBy<Model>,
  ): Promise<void> {
    const data: Record<string, unknown> = (updateBy.data || {}) as Record<
      string,
      unknown
    >;

    // An edit that leaves the templates alone is not judged on them.
    if (data["postmortemTemplates"] === undefined) {
      return;
    }

    this.assertTemplatesFit(data["postmortemTemplates"]);
  }

  private assertTemplatesFit(templates: unknown): void {
    const problem: string | null = getPostmortemRuleTemplatesProblem(templates);

    if (problem) {
      throw new BadDataException(problem);
    }
  }
}

export default new Service();

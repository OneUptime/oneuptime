import CreateBy from "../Types/Database/CreateBy";
import { OnCreate } from "../Types/Database/Hooks";
import ProjectReferencesService from "./ProjectReferencesService";
import BadDataException from "../../Types/Exception/BadDataException";
import ObjectID from "../../Types/ObjectID";
import QueryHelper from "../Types/Database/QueryHelper";
import Model from "../../Models/DatabaseModels/StatusPageIncidentCategory";
import StatusPage from "../../Models/DatabaseModels/StatusPage";
import Label from "../../Models/DatabaseModels/Label";
import StatusPageService from "./StatusPageService";
import LabelService from "./LabelService";

export class Service extends ProjectReferencesService<Model> {
  public constructor() {
    super(Model);
  }

  public async getCategoriesForIncidentLabels(data: {
    statusPageId: ObjectID;
    labelIds: Array<ObjectID>;
  }): Promise<Array<Model>> {
    if (data.labelIds.length === 0) {
      return [];
    }

    return await this.findBy({
      query: {
        statusPageId: data.statusPageId,
        labelId: QueryHelper.any(data.labelIds),
      },
      select: { _id: true, labelId: true },
      skip: 0,
      limit: data.labelIds.length,
      props: { isRoot: true },
    });
  }

  protected override async onBeforeCreate(
    createBy: CreateBy<Model>,
  ): Promise<OnCreate<Model>> {
    await super.onBeforeCreate(createBy);

    if (!createBy.data.statusPageId || !createBy.data.labelId) {
      throw new BadDataException(
        "Status page ID and incident label ID are required.",
      );
    }

    const [statusPage, label]: [StatusPage | null, Label | null] =
      await Promise.all([
        StatusPageService.findOneBy({
          query: {
            _id: createBy.data.statusPageId.toString(),
            projectId: createBy.data.projectId,
          },
          select: { _id: true, projectId: true },
          props: { isRoot: true },
        }),
        LabelService.findOneBy({
          query: {
            _id: createBy.data.labelId.toString(),
            projectId: createBy.data.projectId,
          },
          select: { _id: true, projectId: true },
          props: { isRoot: true },
        }),
      ]);

    if (!statusPage || !label) {
      throw new BadDataException(
        "The incident category must use a label from its status page project.",
      );
    }

    return { createBy, carryForward: null };
  }
}

export default new Service();

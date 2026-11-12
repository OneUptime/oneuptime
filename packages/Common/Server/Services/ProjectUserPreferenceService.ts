import DatabaseService from "./DatabaseService";
import Model from "../../Models/DatabaseModels/ProjectUserPreference";
import ObjectID from "../../Types/ObjectID";
import ProductKey from "../../Types/Product/ProductKey";
import { parsePinnedProducts } from "../../Types/Product/ProductPins";

/*
 * What one person chose for themselves in one project (issue #6814,
 * Models/DatabaseModels/ProjectUserPreference): the products they pinned.
 *
 * Read and written only for the person asking (ProjectProductsService), as
 * root: the API never serves this table, so nobody reads another person's
 * pins.
 */
export class Service extends DatabaseService<Model> {
  public constructor() {
    super(Model);
  }

  // The person's pins in the project, in the order they were pinned.
  public async getPinnedProducts(data: {
    projectId: ObjectID;
    userId: ObjectID;
  }): Promise<Array<ProductKey>> {
    const row: Model | null = await this.findOneBy({
      query: {
        projectId: data.projectId,
        userId: data.userId,
      },
      select: {
        pinnedProducts: true,
      },
      props: {
        isRoot: true,
      },
    });

    return parsePinnedProducts(row?.pinnedProducts);
  }

  /*
   * Keeps the person's pins: one row per project and person, written in one
   * statement, so two tabs pinning at once leave one row with the last
   * write. The caller has parsed the list (parsePinnedProducts).
   */
  public async setPinnedProducts(data: {
    projectId: ObjectID;
    userId: ObjectID;
    pinned: ReadonlyArray<ProductKey>;
  }): Promise<void> {
    await this.getRepository().manager.query(
      `INSERT INTO "ProjectUserPreference" ("projectId", "userId", "pinnedProducts", "version") VALUES ($1, $2, $3, 1) ON CONFLICT ("projectId", "userId") DO UPDATE SET "pinnedProducts" = EXCLUDED."pinnedProducts", "updatedAt" = now(), "version" = "ProjectUserPreference"."version" + 1`,
      [
        data.projectId.toString(),
        data.userId.toString(),
        JSON.stringify([...data.pinned]),
      ],
    );
  }
}

export default new Service();

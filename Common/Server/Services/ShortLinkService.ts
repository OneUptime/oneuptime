import DatabaseConfig from "../DatabaseConfig";
import CreateBy from "../Types/Database/CreateBy";
import { OnCreate } from "../Types/Database/Hooks";
import DatabaseService from "./DatabaseService";
import { LinkShortenerRoute } from "Common/ServiceRoute";
import Hostname from "../../Types/API/Hostname";
import Protocol from "../../Types/API/Protocol";
import Route from "../../Types/API/Route";
import URL from "../../Types/API/URL";
import Text from "../../Types/Text";
import Model from "Common/Models/DatabaseModels/ShortLink";

export class Service extends DatabaseService<Model> {
  public constructor() {
    super(Model);
    this.hardDeleteItemsOlderThanInDays("createdAt", 3); //expire links in 3 days.
  }

  protected override async onBeforeCreate(
    createBy: CreateBy<Model>,
  ): Promise<OnCreate<Model>> {
    createBy.data.shortId = Text.generateRandomText(8);

    return { createBy: createBy, carryForward: [] };
  }

  public async saveShortLinkFor(url: URL): Promise<Model> {
    const model: Model = new Model();
    model.link = url;
    return await this.create({ data: model, props: { isRoot: true } });
  }

  public async getShortenedUrl(model: Model): Promise<URL> {
    const host: Hostname = await DatabaseConfig.getHost();
    const httpProtocol: Protocol = await DatabaseConfig.getHttpProtocol();
    return new URL(
      httpProtocol,
      host,
      new Route(LinkShortenerRoute.toString()).addRoute(
        "/" + model.shortId?.toString(),
      ),
    );
  }

  public async getShortLinkFor(shortLinkId: string): Promise<Model | null> {
    return await this.findOneBy({
      query: {
        shortId: shortLinkId,
      },
      select: {
        _id: true,
        link: true,
      },
      props: {
        isRoot: true,
      },
    });
  }
}

export default new Service();

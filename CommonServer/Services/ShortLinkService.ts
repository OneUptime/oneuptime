import DatabaseConfig from "../DatabaseConfig";
import PostgresDatabase from "../Infrastructure/PostgresDatabase";
import CreateBy from "../Types/Database/CreateBy";
import { OnCreate } from "../Types/Database/Hooks";
import DatabaseService from "./DatabaseService";
import { LinkShortenerRoute } from "Common/ServiceRoute";
import Hostname from "Common/Types/API/Hostname";
import Protocol from "Common/Types/API/Protocol";
import Route from "Common/Types/API/Route";
import URL from "Common/Types/API/URL";
import Text from "Common/Types/Text";
import Model from "Common/AppModels/Models/ShortLink";

export class Service extends DatabaseService<Model> {
  public constructor(postgresDatabase?: PostgresDatabase) {
    super(Model, postgresDatabase);
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

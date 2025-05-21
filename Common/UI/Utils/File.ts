import Route from "../../Types/API/Route";
import ObjectID from "../../Types/ObjectID";
import { FileRoute } from "../../ServiceRoute";

export default class FileUtil {
  public static getFileRoute(fileId: ObjectID): Route {
    return Route.fromString(FileRoute.toString())
      .addRoute("/image")
      .addRoute(`/${fileId.toString()}`);
  }
}

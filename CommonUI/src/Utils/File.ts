import Route from "Common/Types/API/Route";
import ObjectID from "Common/Types/ObjectID";
import { FileRoute } from "Common/ServiceRoute";

export default class FileUtil {
  public static getFileRoute(fileId: ObjectID): Route {
   
    return Route.fromString(FileRoute.toString())
      .addRoute("/image")
      .addRoute(`/${fileId.toString()}`);
  }
}

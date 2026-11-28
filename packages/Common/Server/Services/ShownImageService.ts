import DatabaseService from "./DatabaseService";
import Model from "../../Models/DatabaseModels/ShownImage";

/*
 * Which records show each inline image (ShownImage, #11478). Only the
 * server reads and writes it, as OneUptime, in a statement of its own
 * (Utils/File/ShownImages): after each write of a record that can show an
 * image, and when the image route asks who may see one.
 */
export class Service extends DatabaseService<Model> {
  public constructor() {
    super(Model);
  }
}

export default new Service();

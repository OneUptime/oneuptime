import CreateBy from "../Types/Database/CreateBy";
import DeleteBy from "../Types/Database/DeleteBy";
import FindBy from "../Types/Database/FindBy";
import { OnCreate, OnDelete, OnFind, OnUpdate } from "../Types/Database/Hooks";
import UpdateBy from "../Types/Database/UpdateBy";
import DatabaseService from "./DatabaseService";
import NotAuthorizedException from "../../Types/Exception/NotAuthorizedException";
import File from "../../Models/DatabaseModels/File";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import crypto from "crypto";

const generateImageAccessToken: () => string = (): string => {
  return crypto.randomBytes(32).toString("hex");
};

export class Service extends DatabaseService<File> {
  public constructor() {
    super(File);
  }

  @CaptureSpan()
  protected override async onBeforeCreate(
    createBy: CreateBy<File>,
  ): Promise<OnCreate<File>> {
    /*
     * Always generate an unguessable access token server-side. The token
     * is the only safe way to address an inline-uploaded image in
     * markdown without exposing the enumerable ObjectID.
     */
    if (!createBy.data.imageAccessToken) {
      createBy.data.imageAccessToken = generateImageAccessToken();
    }

    return { createBy, carryForward: null };
  }

  @CaptureSpan()
  protected override async onBeforeUpdate(
    updateBy: UpdateBy<File>,
  ): Promise<OnUpdate<File>> {
    if (!updateBy.props.isRoot) {
      throw new NotAuthorizedException("Not authorized to update a file.");
    }

    return { updateBy, carryForward: null };
  }

  @CaptureSpan()
  protected override async onBeforeDelete(
    deleteBy: DeleteBy<File>,
  ): Promise<OnDelete<File>> {
    if (!deleteBy.props.isRoot) {
      throw new NotAuthorizedException("Not authorized to delete a file.");
    }

    return { deleteBy, carryForward: null };
  }

  @CaptureSpan()
  protected override async onBeforeFind(
    findBy: FindBy<File>,
  ): Promise<OnFind<File>> {
    if (!findBy.props.isRoot) {
      findBy.query = {
        ...findBy.query,
        isPublic: true,
      };
    }

    return { findBy, carryForward: null };
  }
}
export default new Service();

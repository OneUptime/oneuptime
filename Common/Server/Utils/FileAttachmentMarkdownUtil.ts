import File from "../../Models/DatabaseModels/File";
import { AppApiRoute } from "../../ServiceRoute";
import Route from "../../Types/API/Route";
import ObjectID from "../../Types/ObjectID";
import FileService from "../Services/FileService";
import QueryHelper from "../Types/Database/QueryHelper";
import { LIMIT_PER_PROJECT } from "../../Types/Database/LimitMax";

export interface FileAttachmentMarkdownInput {
  modelId: ObjectID;
  attachmentIds: Array<ObjectID>;
  attachmentApiPath: string;
}

export default class FileAttachmentMarkdownUtil {
  public static async buildAttachmentMarkdown(
    input: FileAttachmentMarkdownInput,
  ): Promise<string> {
    if (!input.modelId || !input.attachmentIds || input.attachmentIds.length === 0) {
      return "";
    }

    const uniqueIds: Array<string> = Array.from(
      new Set(
        input.attachmentIds
          .map((id: ObjectID) => id.toString())
          .filter((value: string) => Boolean(value)),
      ),
    );

    if (uniqueIds.length === 0) {
      return "";
    }

    const files: Array<File> = await FileService.findBy({
      query: {
        _id: QueryHelper.any(uniqueIds),
      },
      limit: LIMIT_PER_PROJECT,
      skip: 0,
      select: {
        _id: true,
        name: true,
      },
      props: {
        isRoot: true,
      },
    });

    if (!files.length) {
      return "";
    }

    const fileById: Map<string, File> = new Map(
      files
        .filter((file: File) => Boolean(file._id))
        .map((file: File) => [file._id!.toString(), file]),
    );

    const attachmentLines: Array<string> = [];

    for (const id of input.attachmentIds) {
      const key: string = id.toString();
      const file: File | undefined = fileById.get(key);

      if (!file) {
        continue;
      }

      const fileName: string = file.name || "Attachment";

      const route: Route = Route.fromString(AppApiRoute.toString())
        .addRoute(input.attachmentApiPath)
        .addRoute(`/${input.modelId.toString()}`)
        .addRoute(`/${key}`);

      attachmentLines.push(`- [${fileName}](${route.toString()})`);
    }

    if (!attachmentLines.length) {
      return "";
    }

    return `\n\n**Attachments:**\n${attachmentLines.join("\n")}\n`;
  }
}

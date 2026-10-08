import File from "../../Models/DatabaseModels/File";
import { AppApiRoute } from "../../ServiceRoute";
import Route from "../../Types/API/Route";
import ObjectID from "../../Types/ObjectID";
import FileService from "../Services/FileService";
import QueryHelper from "../Types/Database/QueryHelper";
import { LIMIT_PER_PROJECT } from "../../Types/Database/LimitMax";
import FeedMarkdown, {
  mdText,
  MarkdownText,
} from "../../Utils/Markdown/FeedMarkdown";

export interface FileAttachmentMarkdownInput {
  modelId: ObjectID;
  attachmentIds: Array<ObjectID>;
  attachmentApiPath: string;
}

export default class FileAttachmentMarkdownUtil {
  public static async buildAttachmentMarkdown(
    input: FileAttachmentMarkdownInput,
  ): Promise<MarkdownText> {
    if (
      !input.modelId ||
      !input.attachmentIds ||
      input.attachmentIds.length === 0
    ) {
      return FeedMarkdown.empty();
    }

    const uniqueIds: Array<string> = Array.from(
      new Set(
        input.attachmentIds
          .map((id: ObjectID) => {
            return id.toString();
          })
          .filter((value: string) => {
            return Boolean(value);
          }),
      ),
    );

    if (uniqueIds.length === 0) {
      return FeedMarkdown.empty();
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
      return FeedMarkdown.empty();
    }

    const fileById: Map<string, File> = new Map(
      files
        .filter((file: File) => {
          return Boolean(file._id);
        })
        .map((file: File) => {
          return [file._id!.toString(), file];
        }),
    );

    const attachmentLinks: Array<MarkdownText> = [];

    for (const id of input.attachmentIds) {
      const key: string = id.toString();
      const file: File | undefined = fileById.get(key);

      if (!file) {
        continue;
      }

      /*
       * The file's name is whatever the uploader called it, placed inside
       * the link's own text of a feed item that is posted to Slack and Teams
       * too, as text (FeedMarkdown.link): a "]" cannot end the text early
       * and point the link somewhere else, "![...](...)" is no image and
       * "<!channel>" mentions nobody.
       */
      const fileName: string = file.name || "Attachment";

      const route: Route = Route.fromString(AppApiRoute.toString())
        .addRoute(input.attachmentApiPath)
        .addRoute(`/${input.modelId.toString()}`)
        .addRoute(`/${key}`);

      attachmentLinks.push(FeedMarkdown.link(fileName, route.toString()));
    }

    if (!attachmentLinks.length) {
      return FeedMarkdown.empty();
    }

    return mdText`\n\n**Attachments:**\n${FeedMarkdown.bulletList(attachmentLinks)}\n`;
  }
}

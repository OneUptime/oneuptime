import {
  WorkspaceMessageBlock,
  WorkspacePayloadInlineImage,
  WorkspacePayloadMarkdown,
} from "../../../Types/Workspace/WorkspaceMessagePayload";
import ChatInlineImages, {
  ChatMarkdownPiece,
  ChatMarkdownPieceKind,
  ChatMarkdownSplit,
} from "../../../Utils/Markdown/ChatInlineImages";

/*
 * SCREENSHOTS IN SLACK AND MICROSOFT TEAMS MESSAGES.
 *
 * A message's markdown blocks can carry images that carry themselves - a
 * synthetic monitor's screenshot in the description an "Incident Created"
 * message quotes - which neither chat can show as Markdown. Before a
 * message is sent, each such markdown block is split into its text and its
 * images, in the order they read (Utils/Markdown/ChatInlineImages): the
 * text stays a markdown block, and each image becomes a
 * WorkspacePayloadInlineImage block for the chat to show its own way -
 * Slack as a file it uploads, Teams inside the card. A chat that cannot
 * show one shows its fallbackMarkdown instead.
 */
export default class WorkspaceInlineImages {
  /*
   * The markdown block each piece of a split one came from. One block's
   * text is held to what one block may take (Slack's sections), however
   * many pieces its images cut it into.
   */
  private static readonly splitFrom: WeakMap<
    WorkspaceMessageBlock,
    WorkspaceMessageBlock
  > = new WeakMap<WorkspaceMessageBlock, WorkspaceMessageBlock>();

  /**
   * The message blocks, with every markdown block that holds inline images
   * split into its text and those images. Blocks with none are returned as
   * they were.
   *
   * With `repeatLinkDefinitions`, each markdown piece of a split block gets
   * the block's link reference definitions in front of it - for Slack, which
   * converts each piece on its own and would leave a [text][label] link
   * unresolved in a piece its definition is not in.
   */
  public static splitMessageBlocks(
    messageBlocks: Array<WorkspaceMessageBlock>,
    options?: { repeatLinkDefinitions?: boolean | undefined } | undefined,
  ): Array<WorkspaceMessageBlock> {
    const result: Array<WorkspaceMessageBlock> = [];

    for (const block of messageBlocks) {
      if (
        block._type !== "WorkspacePayloadMarkdown" ||
        !ChatInlineImages.mayHaveInlineImages(
          (block as WorkspacePayloadMarkdown).text,
        )
      ) {
        result.push(block);
        continue;
      }

      const split: ChatMarkdownSplit = ChatInlineImages.split(
        (block as WorkspacePayloadMarkdown).text,
      );

      const hasImage: boolean = split.pieces.some(
        (piece: ChatMarkdownPiece): boolean => {
          return piece.kind === ChatMarkdownPieceKind.Image;
        },
      );

      if (!hasImage) {
        result.push(block);
        continue;
      }

      const definitions: string =
        options?.repeatLinkDefinitions && split.linkDefinitionsMarkdown
          ? `${split.linkDefinitionsMarkdown}\n\n`
          : "";

      for (const piece of split.pieces) {
        if (piece.kind === ChatMarkdownPieceKind.Markdown) {
          const markdownBlock: WorkspacePayloadMarkdown = {
            _type: "WorkspacePayloadMarkdown",
            text: definitions + piece.markdown,
          };

          WorkspaceInlineImages.splitFrom.set(markdownBlock, block);
          result.push(markdownBlock);
          continue;
        }

        const imageBlock: WorkspacePayloadInlineImage = {
          _type: "WorkspacePayloadInlineImage",
          image: piece.image,
          altText: piece.altText,
          fallbackMarkdown: piece.fallbackMarkdown,
        };

        result.push(imageBlock);
      }
    }

    return result;
  }

  /*
   * The markdown block a piece was split out of, or undefined for a block
   * that is not such a piece.
   */
  public static getSplitFrom(
    block: WorkspaceMessageBlock,
  ): WorkspaceMessageBlock | undefined {
    return WorkspaceInlineImages.splitFrom.get(block);
  }

  // The inline images among the blocks, in order.
  public static getInlineImages(
    messageBlocks: Array<WorkspaceMessageBlock>,
  ): Array<WorkspacePayloadInlineImage> {
    return messageBlocks.filter((block: WorkspaceMessageBlock): boolean => {
      return block._type === "WorkspacePayloadInlineImage";
    }) as Array<WorkspacePayloadInlineImage>;
  }
}

import FileService from "../Services/FileService";
import ObjectID from "../../Types/ObjectID";
import logger from "./Logger";

/*
 * Inline images uploaded through the markdown editor are addressed by
 * a high-entropy `imageAccessToken` rather than their ObjectID. The
 * editor inserts URLs of the form
 *
 *   {FILE_URL}/file/image/access-token/{token}
 *
 * Whenever a markdown field is published or unpublished we need to
 * flip the `isPublic` flag on the underlying File rows so the token
 * route serves anonymous traffic only when the parent allows it.
 */
const ACCESS_TOKEN_REGEX: RegExp =
  /\/file\/image\/access-token\/([a-fA-F0-9]+)/g;

export const extractImageAccessTokens: (
  markdown: string | null | undefined,
) => Array<string> = (markdown: string | null | undefined): Array<string> => {
  if (!markdown) {
    return [];
  }
  const tokens: Set<string> = new Set<string>();
  const matches: IterableIterator<RegExpMatchArray> =
    markdown.matchAll(ACCESS_TOKEN_REGEX);
  for (const match of matches) {
    if (match[1]) {
      tokens.add(match[1]);
    }
  }
  return Array.from(tokens);
};

export const setIsPublicForMarkdownImages: (
  markdown: string | null | undefined,
  isPublic: boolean,
) => Promise<void> = async (
  markdown: string | null | undefined,
  isPublic: boolean,
): Promise<void> => {
  const tokens: Array<string> = extractImageAccessTokens(markdown);
  if (tokens.length === 0) {
    return;
  }

  for (const token of tokens) {
    try {
      const file: { _id?: string } | null = await FileService.findOneBy({
        query: {
          imageAccessToken: token,
        },
        select: {
          _id: true,
        },
        props: {
          isRoot: true,
          ignoreHooks: true,
        },
      });

      if (!file || !file._id) {
        continue;
      }

      await FileService.updateOneById({
        id: new ObjectID(file._id.toString()),
        data: {
          isPublic,
        },
        props: {
          isRoot: true,
          ignoreHooks: true,
        },
      });
    } catch (err) {
      logger.error(
        `Failed to update isPublic for file token ${token}: ${String(err)}`,
      );
    }
  }
};

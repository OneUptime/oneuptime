import FileService from "../Services/FileService";
import File from "../../Models/DatabaseModels/File";
import ObjectID from "../../Types/ObjectID";
import FileOwnership from "./File/FileOwnership";
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
 *
 * Only the images of the record's own project are flipped: a token is
 * copied along with the markdown it sits in, and a record of one project
 * must never make another project's image readable by everyone - nor
 * private again under the status page that shows it. An image with no
 * project is nobody's to flip. Images uploaded before files recorded their
 * project got the project of the markdown that shows them
 * (BackfillFileOwners1797900000000), unless markdown of two projects does.
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

// Whether a record of this project may make the image public, or private.
export const mayChangeImageVisibility: (
  file: { projectId?: ObjectID | null | undefined },
  projectId: ObjectID | null | undefined,
) => boolean = (
  file: { projectId?: ObjectID | null | undefined },
  projectId: ObjectID | null | undefined,
): boolean => {
  return FileOwnership.isFileOfProject(file, projectId);
};

export const setIsPublicForMarkdownImages: (
  markdown: string | null | undefined,
  isPublic: boolean,
  // The project of the record the markdown belongs to.
  projectId: ObjectID | null | undefined,
) => Promise<void> = async (
  markdown: string | null | undefined,
  isPublic: boolean,
  projectId: ObjectID | null | undefined,
): Promise<void> => {
  const tokens: Array<string> = extractImageAccessTokens(markdown);
  if (tokens.length === 0) {
    return;
  }

  for (const token of tokens) {
    try {
      const file: File | null = await FileService.findOneBy({
        query: {
          imageAccessToken: token,
        },
        select: {
          _id: true,
          projectId: true,
        },
        props: {
          isRoot: true,
          ignoreHooks: true,
        },
      });

      if (!file || !file._id || !mayChangeImageVisibility(file, projectId)) {
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

/*
 * Best-effort variant used by the publish paths (public notes,
 * announcements). Failing to flip an inline image must never fail the
 * write the user actually asked for, so errors are logged and swallowed.
 */
export const syncIsPublicForMarkdownImages: (
  markdown: string | null | undefined,
  isPublic: boolean,
  context: string,
  // The project of the record the markdown belongs to.
  projectId: ObjectID | null | undefined,
) => Promise<void> = async (
  markdown: string | null | undefined,
  isPublic: boolean,
  context: string,
  projectId: ObjectID | null | undefined,
): Promise<void> => {
  try {
    await setIsPublicForMarkdownImages(markdown, isPublic, projectId);
  } catch (err) {
    logger.error(
      `Failed to sync inline image visibility for ${context}: ${String(err)}`,
    );
  }
};

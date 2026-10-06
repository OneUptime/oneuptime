import FileService from "../Services/FileService";
import File from "../../Models/DatabaseModels/File";
import ObjectID from "../../Types/ObjectID";
import FileOwnership from "./File/FileOwnership";
import PublishedImages, { extractImageAccessTokens } from "./File/PublishedImages";
import logger from "./Logger";

/*
 * Inline images uploaded through the markdown editor are addressed by
 * a high-entropy `imageAccessToken` rather than their ObjectID. The
 * editor inserts URLs of the form
 *
 *   {FILE_URL}/file/image/access-token/{token}
 *
 * Whenever a record that shows its markdown to everyone starts or stops
 * showing an image, the `isPublic` flag of the underlying File row follows,
 * so the token route serves anonymous traffic only while a record shows the
 * image to everyone (PublishedImages, which DatabaseService runs on every
 * write of such a record).
 *
 * Only the images of the record's own project are flipped: a token is
 * copied along with the markdown it sits in, and a record of one project
 * must never make another project's image readable by everyone - nor
 * private again under the status page that shows it. An image with no
 * project is nobody's to flip. Images uploaded before files recorded their
 * project got the project of the markdown that shows them
 * (BackfillFileOwners1797900000000), unless markdown of two projects does.
 *
 * An image is made private only when no record of its project shows it to
 * everyone any more (PublishedImages.isStillShown): the same image can be
 * in a template and every incident made from it.
 */
export { extractImageAccessTokens };

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

/*
 * One image, by its token: public, or private unless a record of its
 * project still shows it to everyone. Only an image of the record's own
 * project, and only when it is not already so.
 */
export const setImageVisibility: (
  token: string,
  isPublic: boolean,
  // The project of the record that shows, or stopped showing, the image.
  projectId: ObjectID | null | undefined,
) => Promise<void> = async (
  token: string,
  isPublic: boolean,
  projectId: ObjectID | null | undefined,
): Promise<void> => {
  const file: File | null = await FileService.findOneBy({
    query: {
      imageAccessToken: token,
    },
    select: {
      _id: true,
      projectId: true,
      isPublic: true,
    },
    props: {
      isRoot: true,
      ignoreHooks: true,
    },
  });

  if (!file || !file._id || !mayChangeImageVisibility(file, projectId)) {
    return;
  }

  // Strictly true, as FileViewerAccess reads it: anything else is private.
  if (((file.isPublic as unknown) === true) === isPublic) {
    return;
  }

  if (
    !isPublic &&
    (await PublishedImages.isStillShown({ projectId, token: token }))
  ) {
    return;
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
      await setImageVisibility(token, isPublic, projectId);
    } catch (err) {
      logger.error(
        `Failed to update isPublic for file token ${token}: ${String(err)}`,
      );
    }
  }
};

/*
 * Best-effort variant used where markdown is sent to everyone as it goes
 * out (an incident's custom fields in subscriber notifications). Failing
 * to flip an inline image must never fail what the user actually asked
 * for, so errors are logged and swallowed.
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

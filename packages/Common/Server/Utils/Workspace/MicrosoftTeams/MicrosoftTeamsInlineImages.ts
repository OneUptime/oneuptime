import { JSONObject } from "../../../../Types/JSON";
import { WorkspacePayloadInlineImage } from "../../../../Types/Workspace/WorkspaceMessagePayload";
import { InlineImageDataUri } from "../../../../Utils/Markdown/InlineImageDataUri";
import MicrosoftTeamsMessageSize from "./MicrosoftTeamsMessageSize";

/*
 * SCREENSHOTS IN A MICROSOFT TEAMS MESSAGE.
 *
 * A Teams bot can show an image in an adaptive card from a data: URL. That
 * is the one way to show an image that is not on the public web - a
 * screenshot in an incident is not, and should not be made to be - and the
 * way Microsoft tells bots to send images in the clouds that cannot load
 * one from a link (GCC High, DoD). Teams takes pictures of up to 1 MB in
 * PNG, JPEG or GIF, and leaves base64 images out of a message's 100 KB
 * ("Limits and specifications for Microsoft Teams").
 *
 * So each inline image in a message's Markdown is an Image element of the
 * card, where the description had it, that opens full size when clicked. An
 * image Teams does not take - a WebP, one over MAX_IMAGE_BYTES - or one past
 * what a card carries (MAX_IMAGES_PER_CARD, MAX_IMAGE_BYTES_PER_CARD) is its
 * alt text. A card Teams refuses anyway, as too large (413) or as a bad
 * request (400), is sent again with every image as its alt text, so the
 * message itself still goes out.
 */

// The image types Teams shows in a message.
const TEAMS_IMAGE_TYPES: ReadonlyArray<string> = [
  "image/png",
  "image/jpeg",
  "image/gif",
];

export default class MicrosoftTeamsInlineImages {
  // The largest picture Teams takes, and what one card carries in all.
  public static readonly MAX_IMAGE_BYTES: number = 1024 * 1024;
  public static readonly MAX_IMAGES_PER_CARD: number = 10;
  public static readonly MAX_IMAGE_BYTES_PER_CARD: number = 2 * 1024 * 1024;

  // Whether Teams shows this image in a card.
  public static isShownByTeams(image: InlineImageDataUri): boolean {
    return (
      TEAMS_IMAGE_TYPES.includes(image.mimeType) &&
      image.byteLength <= MicrosoftTeamsInlineImages.MAX_IMAGE_BYTES
    );
  }

  // The card's Image element for an inline image.
  public static getImageElement(
    block: WorkspacePayloadInlineImage,
  ): JSONObject {
    return {
      type: "Image",
      url: block.image.dataUri,
      altText: block.altText || "Image",
      msTeams: {
        allowExpand: true,
      },
    };
  }

  // Whether a card holds an image element.
  public static hasImage(card: JSONObject): boolean {
    return ((card["body"] as Array<JSONObject> | undefined) || []).some(
      (element: JSONObject): boolean => {
        return element["type"] === "Image";
      },
    );
  }

  /*
   * Whether Teams' refusal of a card can have been because of the images in
   * it: too large, or a bad request.
   */
  public static mayBeRefusedForImages(error: unknown): boolean {
    return (
      MicrosoftTeamsMessageSize.isMessageTooLargeError(error) ||
      MicrosoftTeamsMessageSize.getErrorStatusCode(error) === 400
    );
  }
}

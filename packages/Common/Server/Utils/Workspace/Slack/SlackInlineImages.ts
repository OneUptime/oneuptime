import axios, { AxiosResponse } from "axios";
import crypto from "crypto";
import HTTPErrorResponse from "../../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../../Types/API/HTTPResponse";
import URL from "../../../../Types/API/URL";
import { JSONObject } from "../../../../Types/JSON";
import { WorkspacePayloadInlineImage } from "../../../../Types/Workspace/WorkspaceMessagePayload";
import API from "../../../../Utils/API";
import { InlineImageDataUri } from "../../../../Utils/Markdown/InlineImageDataUri";
import logger from "../../Logger";
import SSRFProtection from "../../SSRFProtection";

/*
 * SCREENSHOTS IN A SLACK MESSAGE.
 *
 * Slack cannot show an image from a data: URL, and an image block can only
 * point at an image Slack fetches from the web - which a screenshot in an
 * incident is not, and should not be made into - or at an image file
 * uploaded to Slack (a slack_file). So each screenshot is uploaded by the
 * bot and shown by the file's id where the description had it:
 * files.getUploadURLExternal, the bytes, then files.completeUploadExternal
 * with no channel, which leaves the file private - it is seen where a
 * message shows it, and is not shared or listed in any channel.
 *
 * Uploading needs the files:write scope, which the OneUptime Slack app asks
 * for. A workspace that connected the app before it did has to connect it
 * again (Project Settings > Slack Integration); until then, and whenever an
 * upload fails, Slack answers missing_scope or the like, the warning says
 * so, and each image is shown as its alt text instead - as is an image of a
 * kind an image block does not show from a file (WebP), and one past what a
 * message uploads (MAX_IMAGES_PER_MESSAGE, MAX_IMAGE_BYTES_PER_MESSAGE).
 *
 * A message posted to several channels uploads each image once: what was
 * uploaded with a token is remembered for an hour, by the image's bytes.
 */

// The image types Slack shows from a file in an image block.
const SLACK_FILE_IMAGE_TYPES: ReadonlyArray<string> = [
  "image/png",
  "image/jpeg",
  "image/gif",
];

// Slack errors that will fail every upload with this token the same way.
const UPLOAD_STOPPING_ERRORS: ReadonlyArray<string> = [
  "missing_scope",
  "not_allowed_token_type",
  "not_authed",
  "invalid_auth",
  "account_inactive",
  "token_revoked",
  "token_expired",
  "no_permission",
  "ekm_access_denied",
  "team_access_not_granted",
  "access_denied",
  "restricted_action",
];

const UPLOAD_TIMEOUT_IN_MS: number = 60 * 1000;
const UPLOAD_RESPONSE_MAX_BYTES: number = 64 * 1024;
const REMEMBERED_UPLOAD_TTL_IN_MS: number = 60 * 60 * 1000;
const MAX_REMEMBERED_UPLOADS: number = 1000;

// Slack's limits: alt_txt on an upload, and alt_text and title on a block.
const UPLOAD_ALT_TEXT_MAX_LENGTH: number = 1000;
const BLOCK_TEXT_MAX_LENGTH: number = 2000;

interface RememberedUpload {
  fileId: string;
  expiresAt: number;
}

export interface SlackImageUploadResult {
  // The uploaded file's id, or null when it was not uploaded.
  fileId: string | null;
  // Slack's error code, or a short reason, when it was not.
  error: string | null;
}

export default class SlackInlineImages {
  // The most images one message uploads, and their bytes in all.
  public static readonly MAX_IMAGES_PER_MESSAGE: number = 10;
  public static readonly MAX_IMAGE_BYTES_PER_MESSAGE: number = 10 * 1024 * 1024;

  private static readonly remembered: Map<string, RememberedUpload> = new Map<
    string,
    RememberedUpload
  >();

  // Whether Slack shows an image of this type from an uploaded file.
  public static isShownBySlack(image: InlineImageDataUri): boolean {
    return SLACK_FILE_IMAGE_TYPES.includes(image.mimeType);
  }

  /**
   * Uploads the images a message shows, each once, and returns the uploaded
   * file ids by the image's base64. An image that is not uploaded - one
   * Slack does not show from a file, one past the message's share, or one
   * whose upload failed - is not in it: the message shows its alt text.
   */
  public static async uploadImages(data: {
    authToken: string;
    images: Array<WorkspacePayloadInlineImage>;
  }): Promise<Map<string, string>> {
    const fileIds: Map<string, string> = new Map<string, string>();
    let imageCount: number = 0;
    let byteCount: number = 0;

    for (const block of data.images) {
      const image: InlineImageDataUri = block.image;

      if (
        fileIds.has(image.base64) ||
        !SlackInlineImages.isShownBySlack(image) ||
        imageCount >= SlackInlineImages.MAX_IMAGES_PER_MESSAGE ||
        byteCount + image.byteLength >
          SlackInlineImages.MAX_IMAGE_BYTES_PER_MESSAGE
      ) {
        continue;
      }

      imageCount++;
      byteCount += image.byteLength;

      const key: string = SlackInlineImages.getRememberKey(
        data.authToken,
        image,
      );
      const remembered: string | null = SlackInlineImages.recall(key);

      if (remembered) {
        fileIds.set(image.base64, remembered);
        continue;
      }

      const result: SlackImageUploadResult =
        await SlackInlineImages.uploadImage({
          authToken: data.authToken,
          image: image,
          altText: block.altText,
        });

      if (result.fileId) {
        fileIds.set(image.base64, result.fileId);
        SlackInlineImages.remember(key, result.fileId);
        continue;
      }

      if (result.error === "missing_scope") {
        logger.warn(
          "An image in a Slack message is shown as its alt text: the OneUptime Slack app cannot upload files (missing the files:write scope). Connect Slack again in Project Settings > Slack Integration to show images in Slack messages.",
        );
      } else {
        logger.warn(
          `An image in a Slack message is shown as its alt text: uploading it to Slack failed (${result.error}).`,
        );
      }

      if (UPLOAD_STOPPING_ERRORS.includes(result.error || "")) {
        break;
      }
    }

    return fileIds;
  }

  // An image block that shows an uploaded file.
  public static getImageBlock(data: {
    fileId: string;
    altText: string;
  }): JSONObject {
    const altText: string = data.altText.slice(0, BLOCK_TEXT_MAX_LENGTH);

    const block: JSONObject = {
      type: "image",
      slack_file: {
        id: data.fileId,
      },
      alt_text: altText || "Image",
    };

    if (altText) {
      block["title"] = {
        type: "plain_text",
        text: altText,
      };
    }

    return block;
  }

  /*
   * One image, uploaded and left private. Never throws: a failure is the
   * error Slack gave, or a short reason.
   */
  public static async uploadImage(data: {
    authToken: string;
    image: InlineImageDataUri;
    altText: string;
  }): Promise<SlackImageUploadResult> {
    try {
      const ticketRequest: JSONObject = {
        filename: `image.${data.image.fileExtension}`,
        length: data.image.byteLength.toString(),
      };

      if (data.altText) {
        ticketRequest["alt_txt"] = data.altText.slice(
          0,
          UPLOAD_ALT_TEXT_MAX_LENGTH,
        );
      }

      const ticket: JSONObject | string = SlackInlineImages.getOkBody(
        await API.post<JSONObject>({
          url: URL.fromString(
            "https://slack.com/api/files.getUploadURLExternal",
          ),
          data: ticketRequest,
          headers: {
            Authorization: `Bearer ${data.authToken}`,
            ["Content-Type"]: "application/x-www-form-urlencoded",
          },
          options: {
            retries: 2,
            exponentialBackoff: true,
            retryOnlyOnRetryableErrors: true,
          },
        }),
      );

      if (typeof ticket === "string") {
        return { fileId: null, error: ticket };
      }

      const uploadUrl: unknown = ticket["upload_url"];
      const fileId: unknown = ticket["file_id"];

      if (typeof uploadUrl !== "string" || typeof fileId !== "string") {
        return { fileId: null, error: "no upload URL in Slack's answer" };
      }

      /*
       * The bytes go only where Slack keeps files: an upload URL that is
       * not Slack's is not sent anything.
       */
      if (!SSRFProtection.isUrlOnAllowedDomain(uploadUrl, ["slack.com"])) {
        return { fileId: null, error: "the upload URL is not Slack's" };
      }

      const upload: AxiosResponse = await axios.post(
        uploadUrl,
        Buffer.from(data.image.base64, "base64"),
        {
          headers: {
            "Content-Type": "application/octet-stream",
          },
          maxRedirects: 0,
          timeout: UPLOAD_TIMEOUT_IN_MS,
          maxBodyLength: data.image.byteLength + 1024,
          maxContentLength: UPLOAD_RESPONSE_MAX_BYTES,
          responseType: "text",
          validateStatus: (): boolean => {
            return true;
          },
        },
      );

      if (upload.status < 200 || upload.status >= 300) {
        return {
          fileId: null,
          error: `the upload answered HTTP ${upload.status}`,
        };
      }

      const completed: JSONObject | string = SlackInlineImages.getOkBody(
        await API.post<JSONObject>({
          url: URL.fromString(
            "https://slack.com/api/files.completeUploadExternal",
          ),
          data: {
            // No channel: the file stays private, seen where it is shown.
            files: JSON.stringify([
              {
                id: fileId,
                title: data.altText || "Image",
              },
            ]),
          },
          headers: {
            Authorization: `Bearer ${data.authToken}`,
            ["Content-Type"]: "application/x-www-form-urlencoded",
          },
        }),
      );

      if (typeof completed === "string") {
        return { fileId: null, error: completed };
      }

      return { fileId: fileId, error: null };
    } catch (error) {
      return {
        fileId: null,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  // Forgets every upload remembered - for tests.
  public static forgetUploads(): void {
    SlackInlineImages.remembered.clear();
  }

  // The body of an ok answer from Slack, or its error code.
  private static getOkBody(
    response: HTTPResponse<JSONObject> | HTTPErrorResponse,
  ): JSONObject | string {
    if (response instanceof HTTPErrorResponse) {
      return `HTTP ${response.statusCode}`;
    }

    const body: JSONObject | undefined = response.jsonData as
      | JSONObject
      | undefined;

    if (!body || body["ok"] !== true) {
      return (body?.["error"] as string | undefined) || "unknown_error";
    }

    return body;
  }

  /*
   * What an upload is remembered by: the token it was made with and the
   * image's bytes, hashed - neither is kept.
   */
  private static getRememberKey(
    authToken: string,
    image: InlineImageDataUri,
  ): string {
    return crypto
      .createHash("sha256")
      .update(authToken)
      .update("\n")
      .update(image.base64)
      .digest("hex");
  }

  private static recall(key: string): string | null {
    const remembered: RememberedUpload | undefined =
      SlackInlineImages.remembered.get(key);

    if (!remembered) {
      return null;
    }

    if (remembered.expiresAt < Date.now()) {
      SlackInlineImages.remembered.delete(key);
      return null;
    }

    return remembered.fileId;
  }

  private static remember(key: string, fileId: string): void {
    SlackInlineImages.remembered.set(key, {
      fileId: fileId,
      expiresAt: Date.now() + REMEMBERED_UPLOAD_TTL_IN_MS,
    });

    // The oldest goes first: a Map keeps the order things were set in.
    while (SlackInlineImages.remembered.size > MAX_REMEMBERED_UPLOADS) {
      const oldest: string | undefined = SlackInlineImages.remembered
        .keys()
        .next().value;

      if (oldest === undefined) {
        break;
      }

      SlackInlineImages.remembered.delete(oldest);
    }
  }
}

import { beforeEach, describe, expect, test } from "@jest/globals";
import { ExpressRequest, ExpressResponse } from "../../../Server/Utils/Express";
import FileModel from "../../../Models/DatabaseModels/DatabaseBaseModel/FileModel";
import MimeType from "../../../Types/File/MimeType";
import ResponseUtil from "../../../Server/Utils/Response";

/*
 * sendFileResponse hands stored bytes back to a browser, and the type it
 * declares them as used to come straight from the upload request. Because
 * /api, /file and /dashboard are one origin, "image/svg+xml" plus a <script>
 * element was enough to run script against dashboard cookies (GHSA-rrqw-5vj9-m9xg).
 *
 * The rule these tests pin down: a browser may render raster images inline and
 * nothing else, it may never sniff, and it may never treat one of these
 * responses as a scriptable document of ours.
 */

interface CapturedResponse {
  headers: Record<string, string>;
  statusCode: number | null;
  body: unknown;
}

describe("Response.sendFileResponse", () => {
  let captured: CapturedResponse;
  let response: ExpressResponse;

  beforeEach(() => {
    captured = { headers: {}, statusCode: null, body: undefined };

    response = {
      set: (key: string, value: string): void => {
        captured.headers[key] = value;
      },
      status: (code: number): void => {
        captured.statusCode = code;
      },
      send: (body: unknown): void => {
        captured.body = body;
      },
    } as unknown as ExpressResponse;
  });

  type SendFileFunction = (file: Partial<FileModel>) => Promise<void>;

  const sendFile: SendFileFunction = async (
    file: Partial<FileModel>,
  ): Promise<void> => {
    await ResponseUtil.sendFileResponse(
      {} as ExpressRequest,
      response,
      file as FileModel,
    );
  };

  test("renders a png inline and still forbids sniffing", async () => {
    await sendFile({
      fileType: MimeType.png,
      file: Buffer.from("png-bytes"),
      name: "logo.png",
    });

    expect(captured.headers["Content-Type"]).toBe("image/png");
    expect(captured.headers["Content-Disposition"]).toContain("inline");
    expect(captured.headers["X-Content-Type-Options"]).toBe("nosniff");
    expect(captured.statusCode).toBe(200);
  });

  test("still serves image types written before the picker normalised them", async () => {
    /*
     * Until Nov 2025 the file picker stored the browser's MIME string as-is,
     * so upgrading installs hold rows like this. Collapsing them to
     * octet-stream would blank every one of those avatars, because nosniff
     * means an <img> cannot recover from a wrong type.
     */
    for (const legacyType of [
      "image/vnd.microsoft.icon",
      "image/jpg",
      "image/x-ms-bmp",
    ]) {
      await sendFile({
        fileType: legacyType as MimeType,
        file: Buffer.from("bytes"),
        name: "avatar",
      });

      expect(captured.headers["Content-Type"]).toBe(legacyType);
      expect(captured.headers["Content-Disposition"]).toContain("inline");
    }
  });

  test("serves svg as a download rather than a document", async () => {
    /*
     * The type is preserved on purpose - <img> and <link rel="icon"> ignore
     * Content-Disposition, so status page logos and favicons keep rendering.
     * What changes is a top-level navigation to the URL, which is the only way
     * script inside an SVG ever runs.
     */
    await sendFile({
      fileType: MimeType.svg,
      file: Buffer.from("<svg><script>alert(1)</script></svg>"),
      name: "logo.svg",
    });

    expect(captured.headers["Content-Type"]).toBe("image/svg+xml");
    expect(captured.headers["Content-Disposition"]).toContain("attachment");
    expect(captured.headers["Content-Disposition"]).toContain(
      'filename="logo.svg"',
    );
  });

  test("refuses to echo back a type it does not recognise", async () => {
    // text/html is not in MimeType at all, so it can only be a hand-crafted row.
    await sendFile({
      fileType: "text/html" as MimeType,
      file: Buffer.from("<script>alert(1)</script>"),
      name: "poc",
    });

    expect(captured.headers["Content-Type"]).toBe("application/octet-stream");
    expect(captured.headers["Content-Disposition"]).toContain("attachment");
  });

  test("degrades junk and empty types to opaque bytes", async () => {
    await sendFile({
      fileType: "not-a-mime-type" as MimeType,
      file: Buffer.from("bytes"),
    });

    expect(captured.headers["Content-Type"]).toBe("application/octet-stream");

    await sendFile({ file: Buffer.from("bytes") });

    expect(captured.headers["Content-Type"]).toBe("application/octet-stream");
  });

  test("neutralises a document-shaped response on every path", async () => {
    for (const fileType of [MimeType.png, MimeType.svg, MimeType.pdf]) {
      await sendFile({ fileType, file: Buffer.from("bytes"), name: "f" });

      expect(captured.headers["X-Content-Type-Options"]).toBe("nosniff");
      expect(captured.headers["X-Frame-Options"]).toBe("DENY");
      expect(captured.headers["Content-Security-Policy"]).toContain("sandbox");
      expect(captured.headers["Content-Security-Policy"]).toContain(
        "script-src 'none'",
      );
    }
  });

  test("a crafted filename cannot break out of the header", async () => {
    await sendFile({
      fileType: MimeType.pdf,
      file: Buffer.from("bytes"),
      name: 'evil".pdf\r\nSet-Cookie: a=b',
    });

    const disposition: string | undefined =
      captured.headers["Content-Disposition"];

    expect(disposition).toBeDefined();
    expect(disposition).not.toContain("\r");
    expect(disposition).not.toContain("\n");
    // The only quotes left are the two the header itself uses.
    expect(disposition?.match(/"/g)).toHaveLength(2);
    expect(disposition).toContain('filename="evil_.pdf__Set-Cookie__a_b"');
  });

  test("keeps a non-ASCII filename instead of reducing it to underscores", async () => {
    await sendFile({
      fileType: MimeType.pdf,
      file: Buffer.from("bytes"),
      name: "月次レポート.pdf",
    });

    const disposition: string | undefined =
      captured.headers["Content-Disposition"];

    // ASCII fallback for old clients, real name for everyone else.
    expect(disposition).toContain('filename="______.pdf"');
    expect(disposition).toContain(
      `filename*=UTF-8''${encodeURIComponent("月次レポート.pdf")}`,
    );
  });

  test("falls back to a generic filename when the row has no name", async () => {
    await sendFile({ fileType: MimeType.pdf, file: Buffer.from("bytes") });

    expect(captured.headers["Content-Disposition"]).toContain(
      'filename="download"',
    );
  });
});

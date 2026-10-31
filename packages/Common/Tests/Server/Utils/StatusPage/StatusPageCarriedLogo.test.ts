import File from "../../../../Models/DatabaseModels/File";
import StatusPage from "../../../../Models/DatabaseModels/StatusPage";
import DatabaseConfig from "../../../../Server/DatabaseConfig";
import StatusPageService from "../../../../Server/Services/StatusPageService";
import {
  CarriedLogo,
  MAX_CARRIED_LOGO_BYTES,
  toCarriedLogo,
} from "../../../../Server/Utils/Mail/EmailCarriedLogos";
import { EMAIL_LOGO_PATH } from "../../../../Server/Utils/Mail/EmailLogo";
import logger from "../../../../Server/Utils/Logger";
import StatusPageCarriedLogo, {
  CARRIED_LOGO_CACHE_TTL_IN_MS,
  CARRIED_LOGO_RETRY_AFTER_FAILURE_IN_MS,
  MAX_CACHED_CARRIED_LOGOS,
} from "../../../../Server/Utils/StatusPage/StatusPageCarriedLogo";
import Hostname from "../../../../Types/API/Hostname";
import Protocol from "../../../../Types/API/Protocol";
import ObjectID from "../../../../Types/ObjectID";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import fs from "fs";

jest.mock("../../../../Server/Utils/Logger");

/*
 * A STATUS PAGE'S LOGO, AS THE EMAILS THAT SHOW IT CARRY IT
 * (Server/Utils/StatusPage/StatusPageCarriedLogo).
 *
 * Every email a status page sends shows its logo by its address on the
 * page's logo route. Just before one goes out, the notification service
 * asks here for the logo that address shows: read as the route serves it -
 * a page that is not archived, a file of the page's own project - and only
 * a PNG, JPEG or GIF small enough for every email. A notification goes to
 * every subscriber at once, so the logo is read once for all of them.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "10000000-0000-4000-8000-000000000001",
);
const OTHER_PROJECT_ID: ObjectID = new ObjectID(
  "10000000-0000-4000-8000-000000000002",
);
const STATUS_PAGE_ID: ObjectID = new ObjectID(
  "20000000-0000-4000-8000-000000000002",
);

const HOST: string = "oneuptime.acme.com";
const LOGO_URL: string = `https://${HOST}/status-page-api/logo/${STATUS_PAGE_ID.toString()}`;

const PNG: Buffer = fs.readFileSync(EMAIL_LOGO_PATH);
const PNG_LOGO: CarriedLogo = toCarriedLogo(PNG, "logo") as CarriedLogo;

const pageWithLogo: (data: {
  bytes: Buffer | undefined;
  fileProjectId?: ObjectID | null | undefined;
}) => StatusPage = (data: {
  bytes: Buffer | undefined;
  fileProjectId?: ObjectID | null | undefined;
}): StatusPage => {
  const page: StatusPage = new StatusPage();
  page._id = STATUS_PAGE_ID.toString();
  page.projectId = PROJECT_ID;

  const file: File = new File();
  file._id = ObjectID.generate().toString();

  if (data.fileProjectId !== null) {
    file.projectId = data.fileProjectId || PROJECT_ID;
  }

  if (data.bytes) {
    file.file = data.bytes;
  }

  page.logoFile = file;

  return page;
};

let findOneBy: ReturnType<typeof jest.spyOn>;
let nowInMs: number = 1_800_000_000_000;

beforeEach(() => {
  StatusPageCarriedLogo.clearCache();
  nowInMs = 1_800_000_000_000;
  jest.spyOn(Date, "now").mockImplementation((): number => {
    return nowInMs;
  });
  jest
    .spyOn(DatabaseConfig, "getHost")
    .mockResolvedValue(new Hostname(HOST) as never);
  jest
    .spyOn(DatabaseConfig, "getHttpProtocol")
    .mockResolvedValue(Protocol.HTTPS as never);
  findOneBy = jest
    .spyOn(StatusPageService, "findOneBy")
    .mockResolvedValue(pageWithLogo({ bytes: PNG }) as never);
});

afterEach(() => {
  StatusPageCarriedLogo.clearCache();
  jest.restoreAllMocks();
});

describe("StatusPageCarriedLogo.read", () => {
  test("reads the page's logo the way its logo route serves it", async () => {
    expect(await StatusPageCarriedLogo.read(STATUS_PAGE_ID)).toEqual(PNG_LOGO);

    expect(findOneBy).toHaveBeenCalledTimes(1);
    expect(findOneBy).toHaveBeenCalledWith({
      query: { _id: STATUS_PAGE_ID, isArchived: false },
      select: {
        projectId: true,
        logoFile: { _id: true, projectId: true, file: true },
      },
      props: { isRoot: true },
    });
  });

  test("a logo the route would not serve is not carried either", async () => {
    for (const page of [
      // An archived page, or none at all: the read finds nothing.
      null,
      pageWithLogo({ bytes: PNG, fileProjectId: OTHER_PROJECT_ID }),
      pageWithLogo({ bytes: PNG, fileProjectId: null }),
    ]) {
      StatusPageCarriedLogo.clearCache();
      findOneBy.mockResolvedValue(page as never);

      expect(await StatusPageCarriedLogo.read(STATUS_PAGE_ID)).toBeNull();
    }
  });

  test("a page without a logo carries none", async () => {
    const page: StatusPage = new StatusPage();
    page._id = STATUS_PAGE_ID.toString();
    page.projectId = PROJECT_ID;
    findOneBy.mockResolvedValue(page as never);

    expect(await StatusPageCarriedLogo.read(STATUS_PAGE_ID)).toBeNull();
  });

  test("an SVG, a WebP or a logo over the limit stays its address", async () => {
    const svg: Buffer = Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg"></svg>',
    );
    const webp: Buffer = Buffer.concat([
      Buffer.from("RIFF", "latin1"),
      Buffer.from([0x10, 0, 0, 0]),
      Buffer.from("WEBP", "latin1"),
      Buffer.alloc(100, 1),
    ]);
    const large: Buffer = Buffer.concat([
      PNG.subarray(0, 8),
      Buffer.alloc(MAX_CARRIED_LOGO_BYTES, 1),
    ]);

    for (const bytes of [svg, webp, large]) {
      StatusPageCarriedLogo.clearCache();
      findOneBy.mockResolvedValue(pageWithLogo({ bytes: bytes }) as never);

      expect(await StatusPageCarriedLogo.read(STATUS_PAGE_ID)).toBeNull();
    }
  });

  test("one read for every email of a notification, even those that ask while it is being read", async () => {
    const logos: Array<CarriedLogo | null> = await Promise.all(
      Array.from({ length: 500 }, (): Promise<CarriedLogo | null> => {
        return StatusPageCarriedLogo.read(STATUS_PAGE_ID);
      }),
    );

    expect(findOneBy).toHaveBeenCalledTimes(1);
    expect(new Set(logos)).toEqual(new Set([PNG_LOGO]));

    // The same page, its id written in capitals.
    await StatusPageCarriedLogo.read(
      new ObjectID(STATUS_PAGE_ID.toString().toUpperCase()),
    );

    expect(findOneBy).toHaveBeenCalledTimes(1);
  });

  test("a new logo is carried within a minute of its upload", async () => {
    await StatusPageCarriedLogo.read(STATUS_PAGE_ID);

    nowInMs += CARRIED_LOGO_CACHE_TTL_IN_MS - 1;
    await StatusPageCarriedLogo.read(STATUS_PAGE_ID);
    expect(findOneBy).toHaveBeenCalledTimes(1);

    const newLogo: Buffer = Buffer.concat([PNG, Buffer.from([0])]);
    findOneBy.mockResolvedValue(pageWithLogo({ bytes: newLogo }) as never);

    nowInMs += 1;
    expect(await StatusPageCarriedLogo.read(STATUS_PAGE_ID)).toEqual(
      toCarriedLogo(newLogo, "logo"),
    );
    expect(findOneBy).toHaveBeenCalledTimes(2);
  });

  test("a read that fails: no logo, said once, and read again after a few seconds", async () => {
    findOneBy.mockRejectedValueOnce(new Error("connection terminated") as never);

    expect(await StatusPageCarriedLogo.read(STATUS_PAGE_ID)).toBeNull();
    expect(logger.error).toHaveBeenCalledWith(
      `The logo of status page ${STATUS_PAGE_ID.toString()} could not be read to go inside its emails, so they show it from its address.`,
    );

    // The emails sent meanwhile do not each ask the database again.
    nowInMs += CARRIED_LOGO_RETRY_AFTER_FAILURE_IN_MS - 1;
    expect(await StatusPageCarriedLogo.read(STATUS_PAGE_ID)).toBeNull();
    expect(findOneBy).toHaveBeenCalledTimes(1);

    nowInMs += 1;
    expect(await StatusPageCarriedLogo.read(STATUS_PAGE_ID)).toEqual(PNG_LOGO);
    expect(findOneBy).toHaveBeenCalledTimes(2);
  });

  test(`keeps the logos of at most ${MAX_CACHED_CARRIED_LOGOS} pages, the oldest going first`, async () => {
    const pages: Array<ObjectID> = Array.from(
      { length: MAX_CACHED_CARRIED_LOGOS + 1 },
      (): ObjectID => {
        return ObjectID.generate();
      },
    );

    for (const page of pages) {
      await StatusPageCarriedLogo.read(page);
    }

    expect(findOneBy).toHaveBeenCalledTimes(pages.length);

    // The newest are still kept...
    await StatusPageCarriedLogo.read(pages[pages.length - 1]!);
    await StatusPageCarriedLogo.read(pages[1]!);
    expect(findOneBy).toHaveBeenCalledTimes(pages.length);

    // ...and the oldest was let go.
    await StatusPageCarriedLogo.read(pages[0]!);
    expect(findOneBy).toHaveBeenCalledTimes(pages.length + 1);
  });
});

describe("StatusPageCarriedLogo.readAddress", () => {
  test("a page's logo address on this installation: that page's logo", async () => {
    expect(await StatusPageCarriedLogo.readAddress(LOGO_URL)).toEqual(PNG_LOGO);
    expect(findOneBy).toHaveBeenCalledTimes(1);
  });

  test("any other address is never read from the database", async () => {
    for (const address of [
      LOGO_URL.replace(HOST, "status.acme.com"),
      LOGO_URL.replace("https://", "http://"),
      LOGO_URL.replace("/logo/", "/cover-image/"),
      "https://images.acme.test/chart.png",
      `https://${HOST}/api/branding/logo?v=7`,
    ]) {
      expect(await StatusPageCarriedLogo.readAddress(address)).toBeNull();
    }

    expect(findOneBy).not.toHaveBeenCalled();
  });

  test("an installation without HOST builds its addresses on localhost, and they are carried too", async () => {
    jest
      .spyOn(DatabaseConfig, "getHost")
      .mockResolvedValue(new Hostname("localhost") as never);
    jest
      .spyOn(DatabaseConfig, "getHttpProtocol")
      .mockResolvedValue(Protocol.HTTP as never);

    expect(
      await StatusPageCarriedLogo.readAddress(
        `http://localhost/status-page-api/logo/${STATUS_PAGE_ID.toString()}`,
      ),
    ).toEqual(PNG_LOGO);
  });
});

import EmailCarriedLogos, {
  CARRIED_LOGO_TYPES,
  CarriedLogo,
  CarriedLogoReader,
  EmailWithCarriedLogos,
  MAX_ADDRESSES_READ_PER_EMAIL,
  MAX_CARRIED_LOGOS_PER_EMAIL,
  MAX_CARRIED_LOGO_BYTES,
  MAX_LOGO_ADDRESS_LENGTH,
  toCarriedLogo,
} from "../../../../Server/Utils/Mail/EmailCarriedLogos";
import { EMAIL_LOGO_PATH } from "../../../../Server/Utils/Mail/EmailLogo";
import logger from "../../../../Server/Utils/Logger";
import { parseInlineImageDataUri } from "../../../../Utils/Markdown/InlineImageDataUri";
import { FastestRun, fastestRunAsync } from "../../../Helpers/FastestRun";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import fs from "fs";

/*
 * A LOGO AN OPERATOR UPLOADED TRAVELS INSIDE THE EMAIL THAT SHOWS IT
 * (Server/Utils/Mail/EmailCarriedLogos).
 *
 * The installation's own logo and a status page's logo were shown in every
 * email by their address on the installation: Outlook blocked them until
 * the reader allowed remote images, Gmail fetched them from the internet,
 * which cannot reach a private network, and every open told the
 * installation who read what. Just before an email goes out, an image at
 * such an address now shows the logo itself - a data: URL, which
 * EmailSize.attachWithinLimit sends as an attachment the HTML points at by
 * Content-ID - when it is a PNG, JPEG or GIF small enough for every email.
 * Everything else keeps its address, as before.
 */

const LOGO_ADDRESS: string =
  "https://oneuptime.acme.test/status-page-api/logo/2b0f6f3f-6c11-4bd1-8bb0-0d3b1c0e58f1";
const OTHER_LOGO_ADDRESS: string =
  "https://oneuptime.acme.test/status-page-api/logo/7b2e9f10-aaaa-4bbb-8ccc-dddddddddddd";
const PRODUCT_LOGO_ADDRESS: string =
  "https://oneuptime.acme.test/api/branding/logo?v=1730000000000";

const PNG_SIGNATURE: Buffer = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);

// A file of `size` bytes that starts the way `signature` does.
const fileStartingWith: (signature: Buffer, size: number) => Buffer = (
  signature: Buffer,
  size: number,
): Buffer => {
  const bytes: Buffer = Buffer.alloc(size, 0x5a);
  signature.copy(bytes, 0);
  return bytes;
};

const PNG: Buffer = fs.readFileSync(EMAIL_LOGO_PATH);
const JPEG: Buffer = fileStartingWith(Buffer.from([0xff, 0xd8, 0xff, 0xe0]), 900);
const GIF: Buffer = fileStartingWith(Buffer.from("GIF89a", "latin1"), 600);
const WEBP: Buffer = fileStartingWith(
  Buffer.concat([
    Buffer.from("RIFF", "latin1"),
    Buffer.from([0x10, 0x00, 0x00, 0x00]),
    Buffer.from("WEBP", "latin1"),
  ]),
  600,
);
const SVG: Buffer = Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"></svg>',
  "utf8",
);

const logoOf: (bytes: Buffer, name?: string) => CarriedLogo = (
  bytes: Buffer,
  name: string = "logo",
): CarriedLogo => {
  const logo: CarriedLogo | null = toCarriedLogo(bytes, name);

  expect(logo).not.toBeNull();

  return logo as CarriedLogo;
};

const PNG_LOGO: CarriedLogo = logoOf(PNG);

// A reader that knows `logos` by address, and records what it was asked.
const readerOf: (logos: Record<string, CarriedLogo | null>) => {
  read: CarriedLogoReader;
  asked: Array<string>;
} = (
  logos: Record<string, CarriedLogo | null>,
): { read: CarriedLogoReader; asked: Array<string> } => {
  const asked: Array<string> = [];

  return {
    asked: asked,
    read: async (address: string): Promise<CarriedLogo | null> => {
      asked.push(address);
      return logos[address] ?? null;
    },
  };
};

const header: (address: string) => string = (address: string): string => {
  return `<img src="${address}" height="40" alt="Acme Status" style="display: block; height: auto; max-height: 48px; max-width: 200px; border: 0;">`;
};

afterEach(() => {
  jest.restoreAllMocks();
});

describe("toCarriedLogo", () => {
  test("carries a PNG, a JPEG and a GIF, each named for the type its bytes are", () => {
    expect(logoOf(PNG).fileName).toBe("logo.png");
    expect(logoOf(PNG).dataUri).toBe(
      `data:image/png;base64,${PNG.toString("base64")}`,
    );
    expect(logoOf(JPEG).fileName).toBe("logo.jpg");
    expect(logoOf(JPEG).dataUri.startsWith("data:image/jpeg;base64,")).toBe(
      true,
    );
    expect(logoOf(GIF, "status-logo").fileName).toBe("status-logo.gif");
    expect(logoOf(GIF).dataUri.startsWith("data:image/gif;base64,")).toBe(true);
  });

  test("only the types every mail client draws", () => {
    expect([...CARRIED_LOGO_TYPES].sort()).toEqual([
      "image/gif",
      "image/jpeg",
      "image/png",
    ]);
  });

  test("never a WebP, which Outlook does not draw, an SVG, or bytes that are no image", () => {
    expect(toCarriedLogo(WEBP, "logo")).toBeNull();
    expect(toCarriedLogo(SVG, "logo")).toBeNull();
    expect(toCarriedLogo(Buffer.from("not an image at all"), "logo")).toBeNull();
    // A PNG's name, and HTML inside.
    expect(
      toCarriedLogo(Buffer.from("<html><body>logo.png</body></html>"), "logo"),
    ).toBeNull();
  });

  test("nothing to carry for no bytes", () => {
    expect(toCarriedLogo(null, "logo")).toBeNull();
    expect(toCarriedLogo(undefined, "logo")).toBeNull();
    expect(toCarriedLogo(Buffer.alloc(0), "logo")).toBeNull();
    expect(
      toCarriedLogo("iVBORw0KGgo=" as unknown as Buffer, "logo"),
    ).toBeNull();
  });

  test("a logo of the largest size goes, and one byte more does not", () => {
    expect(MAX_CARRIED_LOGO_BYTES).toBe(512 * 1024);

    const largest: CarriedLogo | null = toCarriedLogo(
      fileStartingWith(PNG_SIGNATURE, MAX_CARRIED_LOGO_BYTES),
      "logo",
    );

    expect(largest).not.toBeNull();
    expect(parseInlineImageDataUri(largest!.dataUri)?.byteLength).toBe(
      MAX_CARRIED_LOGO_BYTES,
    );
    expect(
      toCarriedLogo(
        fileStartingWith(PNG_SIGNATURE, MAX_CARRIED_LOGO_BYTES + 1),
        "logo",
      ),
    ).toBeNull();
  });

  test("writes a data: URL an attribute holds as it is", () => {
    for (const bytes of [PNG, JPEG, GIF]) {
      expect(logoOf(bytes).dataUri).toMatch(/^[A-Za-z0-9+/=:;,]+$/);
    }
  });
});

describe("EmailCarriedLogos.carry", () => {
  test("an image at a logo's address shows the logo itself, and the logo is handed back to attach", async () => {
    const { read } = readerOf({ [LOGO_ADDRESS]: PNG_LOGO });
    const html: string = `<p>Before</p>${header(LOGO_ADDRESS)}<p>After</p>`;

    const carried: EmailWithCarriedLogos = await EmailCarriedLogos.carry(
      html,
      read,
    );

    expect(carried.html).toBe(
      `<p>Before</p>${header(PNG_LOGO.dataUri)}<p>After</p>`,
    );
    expect(carried.logos).toEqual([PNG_LOGO]);
  });

  test("every other image keeps its address, and only web addresses are asked about", async () => {
    const { read, asked } = readerOf({});
    const screenshot: string = `data:image/png;base64,${PNG.toString("base64")}`;
    const html: string = [
      header(LOGO_ADDRESS),
      `<img src="${screenshot}" alt="Login page">`,
      '<img src="cid:abc@oneuptime" alt="Inline">',
      '<img src="/relative/logo.png" alt="Relative">',
      '<img src="mailto:ops@acme.test" alt="Mail">',
      '<img src="https://images.acme.test/chart.png" alt="Chart">',
      "<img alt='No source'>",
    ].join("");

    const carried: EmailWithCarriedLogos = await EmailCarriedLogos.carry(
      html,
      read,
    );

    expect(asked).toEqual([
      LOGO_ADDRESS,
      "https://images.acme.test/chart.png",
    ]);
    expect(carried.html).toBe(html);
    expect(carried.logos).toEqual([]);
  });

  test("the reader is handed the address as a mail client reads it, its character references decoded", async () => {
    const { read, asked } = readerOf({ [PRODUCT_LOGO_ADDRESS]: PNG_LOGO });
    // How Handlebars escapes the "=" of {{@root.brandLogoUrl}}.
    const escaped: string = PRODUCT_LOGO_ADDRESS.replace("=", "&#x3D;");

    const carried: EmailWithCarriedLogos = await EmailCarriedLogos.carry(
      `<img src="${escaped}" height="32" alt="Acme Ops">`,
      read,
    );

    expect(asked).toEqual([PRODUCT_LOGO_ADDRESS]);
    expect(carried.html).toBe(
      `<img src="${PNG_LOGO.dataUri}" height="32" alt="Acme Ops">`,
    );
  });

  test("space around an address is read as a mail client reads it", async () => {
    const { read } = readerOf({ [LOGO_ADDRESS]: PNG_LOGO });

    const carried: EmailWithCarriedLogos = await EmailCarriedLogos.carry(
      `<img src="  ${LOGO_ADDRESS}\n" alt="Acme">`,
      read,
    );

    expect(carried.html).toBe(`<img src="${PNG_LOGO.dataUri}" alt="Acme">`);
  });

  test("an address shown twice is read once, and both images show the one logo", async () => {
    const { read, asked } = readerOf({ [LOGO_ADDRESS]: PNG_LOGO });

    const carried: EmailWithCarriedLogos = await EmailCarriedLogos.carry(
      `${header(LOGO_ADDRESS)}<p>Middle</p>${header(LOGO_ADDRESS)}`,
      read,
    );

    expect(asked).toEqual([LOGO_ADDRESS]);
    expect(carried.html).toBe(
      `${header(PNG_LOGO.dataUri)}<p>Middle</p>${header(PNG_LOGO.dataUri)}`,
    );
    expect(carried.logos).toEqual([PNG_LOGO]);
  });

  test("two addresses of one logo - two pages with the same file - carry it once", async () => {
    const { read } = readerOf({
      [LOGO_ADDRESS]: PNG_LOGO,
      [OTHER_LOGO_ADDRESS]: PNG_LOGO,
    });

    const carried: EmailWithCarriedLogos = await EmailCarriedLogos.carry(
      `${header(LOGO_ADDRESS)}${header(OTHER_LOGO_ADDRESS)}`,
      read,
    );

    expect(carried.html).toBe(
      `${header(PNG_LOGO.dataUri)}${header(PNG_LOGO.dataUri)}`,
    );
    expect(carried.logos).toEqual([PNG_LOGO]);
  });

  test(`carries at most ${MAX_CARRIED_LOGOS_PER_EMAIL} logos; the rest keep their addresses`, async () => {
    const addresses: Array<string> = Array.from(
      { length: MAX_CARRIED_LOGOS_PER_EMAIL + 2 },
      (_: unknown, index: number): string => {
        return `https://oneuptime.acme.test/logo/${index}`;
      },
    );
    const logos: Record<string, CarriedLogo> = {};

    addresses.forEach((address: string, index: number): void => {
      logos[address] = logoOf(
        fileStartingWith(PNG_SIGNATURE, 100 + index),
        "logo",
      );
    });

    const { read, asked } = readerOf(logos);

    const carried: EmailWithCarriedLogos = await EmailCarriedLogos.carry(
      addresses.map(header).join(""),
      read,
    );

    expect(carried.logos).toHaveLength(MAX_CARRIED_LOGOS_PER_EMAIL);
    expect(asked).toEqual(addresses.slice(0, MAX_CARRIED_LOGOS_PER_EMAIL));
    expect(carried.html).toBe(
      [
        ...addresses
          .slice(0, MAX_CARRIED_LOGOS_PER_EMAIL)
          .map((address: string): string => {
            return header(logos[address]!.dataUri);
          }),
        ...addresses.slice(MAX_CARRIED_LOGOS_PER_EMAIL).map(header),
      ].join(""),
    );
  });

  test(`asks about at most ${MAX_ADDRESSES_READ_PER_EMAIL} addresses of an email`, async () => {
    const { read, asked } = readerOf({});
    const html: string = Array.from(
      { length: MAX_ADDRESSES_READ_PER_EMAIL + 100 },
      (_: unknown, index: number): string => {
        return `<img src="https://images.acme.test/${index}.png" alt="">`;
      },
    ).join("");

    const carried: EmailWithCarriedLogos = await EmailCarriedLogos.carry(
      html,
      read,
    );

    expect(asked).toHaveLength(MAX_ADDRESSES_READ_PER_EMAIL);
    expect(carried.html).toBe(html);
  });

  test("a reader that fails leaves that address, says so, and the email's other logos still go", async () => {
    const errorSpy: ReturnType<typeof jest.spyOn> = jest
      .spyOn(logger, "error")
      .mockImplementation((): void => {
        return undefined;
      });

    const read: CarriedLogoReader = async (
      address: string,
    ): Promise<CarriedLogo | null> => {
      if (address === LOGO_ADDRESS) {
        throw new Error("connection terminated");
      }

      return PNG_LOGO;
    };

    const carried: EmailWithCarriedLogos = await EmailCarriedLogos.carry(
      `${header(LOGO_ADDRESS)}${header(OTHER_LOGO_ADDRESS)}`,
      read,
    );

    expect(carried.html).toBe(
      `${header(LOGO_ADDRESS)}${header(PNG_LOGO.dataUri)}`,
    );
    expect(carried.logos).toEqual([PNG_LOGO]);
    expect(errorSpy).toHaveBeenCalledWith(
      "A logo an email shows could not be read to go inside the email, so it is shown from its address instead.",
    );
  });

  test("a reader that throws at once is caught too", async () => {
    jest.spyOn(logger, "error").mockImplementation((): void => {
      return undefined;
    });

    const read: CarriedLogoReader = (): CarriedLogo | null => {
      throw new Error("bad read");
    };

    const html: string = header(LOGO_ADDRESS);

    expect(await EmailCarriedLogos.carry(html, read)).toEqual({
      html: html,
      logos: [],
    });
  });

  test("only a logo as toCarriedLogo writes one ever goes into the HTML", async () => {
    const tooLarge: string = `data:image/png;base64,${fileStartingWith(
      PNG_SIGNATURE,
      MAX_CARRIED_LOGO_BYTES + 3,
    ).toString("base64")}`;
    const webp: string = `data:image/webp;base64,${WEBP.toString("base64")}`;

    for (const dataUri of [
      "javascript:alert(1)",
      `data:image/svg+xml;base64,${SVG.toString("base64")}`,
      webp,
      tooLarge,
      // A PNG, then a quote that would end the attribute.
      `${PNG_LOGO.dataUri}" onerror="alert(1)`,
      // A PNG claimed as a GIF: written out again as the PNG it is, so not this.
      `data:image/gif;base64,${PNG.toString("base64")}`,
      "",
    ]) {
      const { read } = readerOf({
        [LOGO_ADDRESS]: { dataUri: dataUri, fileName: "logo.png" },
      });
      const html: string = header(LOGO_ADDRESS);

      expect(await EmailCarriedLogos.carry(html, read)).toEqual({
        html: html,
        logos: [],
      });
    }
  });

  test("a reader's attachment name that is not a plain file name is replaced by logo and the type", async () => {
    for (const fileName of [
      "../../etc/passwd",
      'logo".png',
      "",
      "a".repeat(80),
      " logo.png",
    ]) {
      const { read } = readerOf({
        [LOGO_ADDRESS]: { dataUri: PNG_LOGO.dataUri, fileName: fileName },
      });

      const carried: EmailWithCarriedLogos = await EmailCarriedLogos.carry(
        header(LOGO_ADDRESS),
        read,
      );

      expect(carried.logos).toEqual([
        { dataUri: PNG_LOGO.dataUri, fileName: "logo.png" },
      ]);
    }
  });

  test("an email without images comes back exactly as it was, and nothing is read", async () => {
    const { read, asked } = readerOf({ [LOGO_ADDRESS]: PNG_LOGO });
    const html: string = `<p>${LOGO_ADDRESS}</p><a href="${LOGO_ADDRESS}">logo</a>`;

    const carried: EmailWithCarriedLogos = await EmailCarriedLogos.carry(
      html,
      read,
    );

    expect(carried.html).toBe(html);
    expect(carried.logos).toEqual([]);
    expect(asked).toEqual([]);
    expect(await EmailCarriedLogos.carry("", read)).toEqual({
      html: "",
      logos: [],
    });
  });

  test("single-quoted and unquoted addresses are read and carried too", async () => {
    const { read } = readerOf({ [LOGO_ADDRESS]: PNG_LOGO });

    expect(
      (await EmailCarriedLogos.carry(`<img src='${LOGO_ADDRESS}' alt='A'>`, read))
        .html,
    ).toBe(`<img src='${PNG_LOGO.dataUri}' alt='A'>`);
    expect(
      (await EmailCarriedLogos.carry(`<img src=${LOGO_ADDRESS} alt=A>`, read))
        .html,
    ).toBe(`<img src=${PNG_LOGO.dataUri} alt=A>`);
    expect(
      (await EmailCarriedLogos.carry(`<IMG SRC="${LOGO_ADDRESS}">`, read)).html,
    ).toBe(`<IMG SRC="${PNG_LOGO.dataUri}">`);
  });

  test("an address longer than any logo's is never handed to a reader", async () => {
    const { read, asked } = readerOf({});
    const long: string = `https://oneuptime.acme.test/${"a".repeat(MAX_LOGO_ADDRESS_LENGTH)}`;
    const screenshot: string = `data:image/png;base64,${fileStartingWith(
      PNG_SIGNATURE,
      3 * 1024 * 1024,
    ).toString("base64")}`;

    await EmailCarriedLogos.carry(
      `<img src="${long}"><img src="${screenshot}">`,
      read,
    );

    expect(asked).toEqual([]);
  });

  test("takes time in line with the email: thousands of images beside a 12 MB screenshot", async () => {
    const screenshot: string = `data:image/png;base64,${fileStartingWith(
      PNG_SIGNATURE,
      12 * 1024 * 1024,
    ).toString("base64")}`;
    const images: string = Array.from(
      { length: 20000 },
      (_: unknown, index: number): string => {
        return `<img src="https://images.acme.test/${index}.png" alt="Chart ${index}">`;
      },
    ).join("");

    const html: string = `${header(LOGO_ADDRESS)}<img src="${screenshot}" alt="Login">${images}`;

    const timed: FastestRun<EmailWithCarriedLogos> = await fastestRunAsync(
      {
        run: (): Promise<EmailWithCarriedLogos> => {
          return EmailCarriedLogos.carry(
            html,
            readerOf({ [LOGO_ADDRESS]: PNG_LOGO }).read,
          );
        },
        limitInMs: 2000,
      },
    );

    expect(timed.inMs).toBeLessThan(2000);
    expect(timed.result.logos).toEqual([PNG_LOGO]);
    expect(timed.result.html.startsWith(header(PNG_LOGO.dataUri))).toBe(true);
    expect(timed.result.html).toContain(`<img src="${screenshot}" alt="Login">`);
  });
});

import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import Handlebars from "handlebars";
import fs from "fs";
import Path from "path";
import nodemailer, { Transporter } from "nodemailer";
import File from "Common/Models/DatabaseModels/File";
import StatusPage from "Common/Models/DatabaseModels/StatusPage";
import DatabaseConfig from "Common/Server/DatabaseConfig";
import StatusPageService from "Common/Server/Services/StatusPageService";
import {
  CarriedLogo,
  MAX_CARRIED_LOGO_BYTES,
} from "Common/Server/Utils/Mail/EmailCarriedLogos";
import StatusPageCarriedLogo from "Common/Server/Utils/StatusPage/StatusPageCarriedLogo";
import StatusPageEmailLogo from "Common/Server/Utils/StatusPage/StatusPageEmailLogo";
import Hostname from "Common/Types/API/Hostname";
import Protocol from "Common/Types/API/Protocol";
import Email from "Common/Types/Email";
import EmailMessage from "Common/Types/Email/EmailMessage";
import EmailServer from "Common/Types/Email/EmailServer";
import EmailTemplateType from "Common/Types/Email/EmailTemplateType";
import ObjectID from "Common/Types/ObjectID";
import Port from "Common/Types/Port";
import {
  INDIGO,
  ImageFacts,
  ORANGE,
  imageFacts,
  noiseLogo,
  pngChunkTypes,
  svgLogo,
  twoColourLogo,
} from "Common/Tests/Helpers/EmailLogoFixtures";
import {
  MarkupReference,
  readMarkupReferences,
} from "Common/Tests/Helpers/MarkupReferences";
import { getEmailServerType } from "../../FeatureSet/Notification/Config";
import MailService, {
  RenderedEmail,
} from "../../FeatureSet/Notification/Services/MailService";
import { BRAND_VARIABLE_NAMES } from "../../FeatureSet/Notification/Utils/EmailBranding";
import "../../FeatureSet/Notification/Utils/Handlebars";
import {
  VariableSet,
  variableSetsFor,
} from "./Fixtures/EmailTemplateVariables";

/*
 * A STATUS PAGE'S SVG, WEBP OR LARGE LOGO GOES INSIDE THE EMAILS IT SENDS.
 *
 * Since #5459 a status page's logo went inside its emails only when it was
 * a PNG, JPEG or GIF of at most 512 KB; any other stayed an address, which
 * Gmail and Outlook do not draw for an SVG, Outlook does not for a WebP,
 * and no mail client draws when it cannot reach the installation. Now the
 * page's logo, read the way its logo route serves it, is made into a PNG
 * sized for the email's header (EmailLogoImage), and goes out as an inline
 * attachment the HTML points at by Content-ID.
 *
 * This sends through the real MailService, with the reader the
 * notification service registers when it starts
 * (StatusPageCarriedLogo.readAddress, NotificationCarriesStatusPageLogos)
 * and the real image library, over SMTP: only the database read, the
 * mail server and the network are stood in for.
 */

jest.mock("../../FeatureSet/Notification/Config", () => {
  return {
    getEmailServerType: jest.fn(),
    getGlobalSMTPConfig: jest.fn(),
    getSendgridConfig: jest.fn(),
  };
});

jest.mock("Common/Server/Services/StatusPageService", () => {
  return { __esModule: true, default: { findOneBy: jest.fn() } };
});

jest.mock("Common/Server/DatabaseConfig", () => {
  return {
    __esModule: true,
    default: { getHost: jest.fn(), getHttpProtocol: jest.fn() },
  };
});

jest.mock("Common/Server/Services/EmailLogService", () => {
  return { __esModule: true, default: { create: jest.fn() } };
});

jest.mock("Common/Server/Services/UserOnCallLogTimelineService", () => {
  return { __esModule: true, default: { updateOneById: jest.fn() } };
});

jest.mock("Common/Server/Utils/Logger", () => {
  return {
    __esModule: true,
    EXTERNAL_FAULT: {},
    default: {
      debug: jest.fn(),
      info: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
    },
  };
});

jest.mock("Common/Server/Utils/DataSource/EgressGuard", () => {
  return { __esModule: true, default: { assertHostnameAllowed: jest.fn() } };
});

jest.mock("Common/Server/Utils/Telemetry/AppMetrics", () => {
  return {
    __esModule: true,
    default: {
      getNotificationCounter: () => {
        return { add: jest.fn() };
      },
      getNotificationDuration: () => {
        return { record: jest.fn() };
      },
    },
  };
});

jest.mock("nodemailer", () => {
  return { __esModule: true, default: { createTransport: jest.fn() } };
});

const INSTALL_HOST: string = "oneuptime.example.test";
const PROJECT_ID: ObjectID = new ObjectID(
  "10000000-0000-4000-8000-000000000001",
);
const STATUS_PAGE_ID: ObjectID = new ObjectID(
  "20000000-0000-4000-8000-000000000002",
);

const TEMPLATES_DIR: string = Path.resolve(
  __dirname,
  "../../FeatureSet/Notification/Templates",
);

const SMTP_SERVER: EmailServer = {
  host: new Hostname("smtp.example.test"),
  port: new Port(587),
  secure: true,
  username: "notifications@example.test",
  password: "password",
  fromName: "Acme Status",
  fromEmail: new Email("status@acme.example.test"),
};

interface CapturedSmtpMail {
  html: string;
  attachments?: Array<{
    filename: string;
    content: string;
    encoding: string;
    contentType: string;
    contentDisposition: string;
    cid: string;
  }>;
}

type SendMail = (mail: CapturedSmtpMail) => Promise<{ messageId: string }>;

const sendMail: ReturnType<typeof jest.fn<SendMail>> = jest.fn<SendMail>();

// The page's logo address, exactly as every sender writes it.
const logoAddressOfPage: () => string = (): string => {
  const page: StatusPage = new StatusPage();
  page._id = STATUS_PAGE_ID.toString();
  page.projectId = PROJECT_ID;
  page.isArchived = false;
  const logo: File = new File();
  logo._id = ObjectID.generate().toString();
  logo.projectId = PROJECT_ID;
  page.logoFile = logo;

  return StatusPageEmailLogo.getLogoUrl({
    statusPage: page,
    host: new Hostname(INSTALL_HOST),
    httpProtocol: Protocol.HTTPS,
  });
};

let logoUrl: string;

// The page as the reader finds it, its logo `bytes`.
const pageWithLogo: (bytes: Buffer) => StatusPage = (
  bytes: Buffer,
): StatusPage => {
  const page: StatusPage = new StatusPage();
  page._id = STATUS_PAGE_ID.toString();
  page.projectId = PROJECT_ID;

  const file: File = new File();
  file._id = ObjectID.generate().toString();
  file.projectId = PROJECT_ID;
  file.file = bytes;
  page.logoFile = file;

  return page;
};

const subscriberEmail: () => EmailMessage = (): EmailMessage => {
  const name: string = "SubscriberIncidentCreated.hbs";
  const everything: VariableSet = variableSetsFor(
    fs.readFileSync(Path.join(TEMPLATES_DIR, name), "utf8"),
    { leaveOut: BRAND_VARIABLE_NAMES },
  )[0]!;

  return {
    toEmail: new Email("alice@example.test"),
    subject: "A notification",
    isSubjectLiteral: true,
    templateType: name as EmailTemplateType,
    vars: {
      ...everything.variables,
      logoUrl: logoUrl,
      statusPageName: "Acme Status",
    } as EmailMessage["vars"],
  };
};

const CID_SOURCE: string = 'src="cid:';

const contentIdsIn: (html: string) => Array<string> = (
  html: string,
): Array<string> => {
  return html
    .split(CID_SOURCE)
    .slice(1)
    .map((rest: string): string => {
      return rest.slice(0, rest.indexOf('"'));
    });
};

// What an email loads, as written.
const loadedValues: (html: string) => Array<string> = (
  html: string,
): Array<string> => {
  return readMarkupReferences(html)
    .filter((reference: MarkupReference): boolean => {
      return reference.loads;
    })
    .map((reference: MarkupReference): string => {
      return reference.value;
    });
};

// The email the page sends for an incident, as the mail server is handed it.
const sendWithLogo: (bytes: Buffer) => Promise<CapturedSmtpMail> = async (
  bytes: Buffer,
): Promise<CapturedSmtpMail> => {
  StatusPageCarriedLogo.clearCache();
  jest
    .mocked(StatusPageService.findOneBy)
    .mockResolvedValue(pageWithLogo(bytes) as never);
  sendMail.mockClear();

  await MailService.send(subscriberEmail(), { emailServer: SMTP_SERVER });

  expect(sendMail).toHaveBeenCalledTimes(1);

  return sendMail.mock.calls[0]![0];
};

beforeAll(async () => {
  logoUrl = logoAddressOfPage();

  const partialNames: Array<string> = fs
    .readdirSync(Path.join(TEMPLATES_DIR, "Partials"))
    .filter((name: string): boolean => {
      return name.endsWith(".hbs");
    })
    .map((name: string): string => {
      return name.slice(0, -4);
    });
  const deadline: number = Date.now() + 15000;

  // The production initializer registers the partials asynchronously.
  while (
    partialNames.some((name: string): boolean => {
      return typeof Handlebars.partials[name] !== "function";
    })
  ) {
    if (Date.now() >= deadline) {
      throw new Error("Production email partial registration did not finish");
    }

    await new Promise<void>((resolve: () => void): void => {
      setTimeout(resolve, 10);
    });
  }
});

beforeEach(() => {
  jest.mocked(getEmailServerType).mockResolvedValue("Custom SMTP" as never);
  jest
    .mocked(DatabaseConfig.getHost)
    .mockResolvedValue(new Hostname(INSTALL_HOST) as never);
  jest
    .mocked(DatabaseConfig.getHttpProtocol)
    .mockResolvedValue(Protocol.HTTPS as never);
  sendMail.mockResolvedValue({ messageId: "mocked-delivery" });
  jest.mocked(nodemailer.createTransport).mockReturnValue({
    sendMail,
    close: jest.fn(),
  } as unknown as Transporter);

  // As the notification service registers it when it starts.
  MailService.carryStatusPageLogosWith(
    (address: string): Promise<CarriedLogo | null> => {
      return StatusPageCarriedLogo.readAddress(address);
    },
  );
});

afterEach(async () => {
  MailService.carryStatusPageLogosWith(null);
  StatusPageCarriedLogo.clearCache();
  await MailService.cleanup();
});

describe("a status page's logo that no mail client draws as it is goes inside its emails, made for the header", () => {
  test("rendered for a preview, the email shows the logo from its address, as a browser draws it", async () => {
    expect(logoUrl).toBe(
      `https://${INSTALL_HOST}/status-page-api/logo/${STATUS_PAGE_ID.toString()}`,
    );

    const rendered: RenderedEmail = await MailService.render(
      subscriberEmail(),
    );

    expect(loadedValues(rendered.body)).toEqual([logoUrl]);
  });

  test.each([
    ["an SVG", "svg", 432],
    ["a WebP", "webp", 432],
    ["a PNG over 512 KB", "large-png", 576],
  ])(
    "%s: a PNG three times the header's box goes out as an inline attachment, and nothing is loaded when the email is opened",
    async (_label: string, kind: string, width: number) => {
      const bytes: Buffer =
        kind === "svg"
          ? svgLogo(
              '<rect width="60" height="40" fill="#4f46e5"/><rect x="60" width="60" height="40" fill="#f97316"/>',
            )
          : kind === "webp"
            ? await twoColourLogo({
                width: 3000,
                height: 1000,
                format: "webp",
                left: INDIGO,
                right: ORANGE,
              })
            : await noiseLogo({
                width: 1200,
                height: 300,
                format: "png",
                seed: 5459,
              });

      if (kind === "large-png") {
        expect(bytes.length).toBeGreaterThan(MAX_CARRIED_LOGO_BYTES);
      }

      const payload: CapturedSmtpMail = await sendWithLogo(bytes);
      const contentIds: Array<string> = contentIdsIn(payload.html);

      expect(contentIds).toHaveLength(1);
      expect(payload.html).toContain(
        `<img src="cid:${contentIds[0]}" height="40" alt="Acme Status"`,
      );
      expect(payload.html).not.toContain(logoUrl);
      expect(loadedValues(payload.html)).toEqual([`cid:${contentIds[0]}`]);

      expect(payload.attachments).toHaveLength(1);

      const attachment: NonNullable<CapturedSmtpMail["attachments"]>[number] =
        payload.attachments![0]!;

      expect({
        filename: attachment.filename,
        encoding: attachment.encoding,
        contentType: attachment.contentType,
        contentDisposition: attachment.contentDisposition,
        cid: attachment.cid,
      }).toEqual({
        filename: "logo.png",
        encoding: "base64",
        contentType: "image/png",
        contentDisposition: "inline",
        cid: contentIds[0],
      });

      const image: Buffer = Buffer.from(attachment.content, "base64");
      const facts: ImageFacts = await imageFacts(image);

      expect([facts.format, facts.width, facts.height]).toEqual([
        "png",
        width,
        144,
      ]);
      expect(image.length).toBeLessThanOrEqual(MAX_CARRIED_LOGO_BYTES);
      expect(pngChunkTypes(image)).not.toContain("pHYs");
    },
  );

  test("an SVG that draws words keeps its address, as before: never drawn without its font", async () => {
    const payload: CapturedSmtpMail = await sendWithLogo(
      svgLogo('<text x="5" y="30" font-family="Inter">Acme</text>'),
    );

    expect(loadedValues(payload.html)).toEqual([logoUrl]);
    expect(payload.attachments).toBeUndefined();
  });

  test("a logo a mail client draws as it is, and that fits the header, still goes byte for byte", async () => {
    const small: Buffer = await twoColourLogo({
      width: 300,
      height: 80,
      format: "png",
      left: INDIGO,
      right: ORANGE,
    });

    const payload: CapturedSmtpMail = await sendWithLogo(small);

    expect(payload.attachments).toHaveLength(1);
    expect(payload.attachments![0]!.content).toBe(small.toString("base64"));
  });

  test("the logo is read and made once for every subscriber of a notification", async () => {
    StatusPageCarriedLogo.clearCache();
    jest
      .mocked(StatusPageService.findOneBy)
      .mockResolvedValue(
        pageWithLogo(
          svgLogo('<rect width="120" height="40" fill="#4f46e5"/>'),
        ) as never,
      );
    jest.mocked(StatusPageService.findOneBy).mockClear();
    sendMail.mockClear();

    await Promise.all(
      Array.from({ length: 20 }, (): Promise<void> => {
        return MailService.send(subscriberEmail(), {
          emailServer: SMTP_SERVER,
        });
      }),
    );

    expect(StatusPageService.findOneBy).toHaveBeenCalledTimes(1);
    expect(sendMail).toHaveBeenCalledTimes(20);

    const contents: Set<string> = new Set(
      sendMail.mock.calls.map(
        (call: [CapturedSmtpMail]): string => {
          return call[0].attachments![0]!.content;
        },
      ),
    );

    expect(contents.size).toBe(1);
  });
});

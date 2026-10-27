import DocsNav, { NavGroup, NavLink } from "../../../FeatureSet/Docs/Utils/Nav";
import { SUPPORTED_DOCS_LANGUAGE_CODES } from "../../../FeatureSet/Docs/Utils/I18n";
import {
  CALL_AND_SMS_GATEWAY_NAME,
  CALL_AND_SMS_GATEWAY_USER_AGENT,
} from "../../../FeatureSet/Notification/Services/CallAndSmsGatewayService";
import {
  SIGNED_WEBHOOK_MAX_ATTEMPTS,
  SIGNED_WEBHOOK_REQUEST_TIMEOUT_MS,
  SIGNED_WEBHOOK_RETRY_DELAYS_MS,
  isRetryableStatus,
  signWebhookBody,
} from "../../../FeatureSet/Notification/Utils/SignedWebhookPost";
import { readPage } from "./DocsContentSupport";
import { CUSTOM_CHANNEL_ACTION_TOKEN_EXPIRES_IN_SECONDS } from "Common/Server/Utils/OnCall/CustomChannelActionToken";
import {
  CALL_AND_SMS_GATEWAY_PAYLOAD_VERSION,
  CallAndSmsGatewayEvent,
  MAX_CALL_AND_SMS_GATEWAY_MESSAGE_LENGTH,
  buildCallAndSmsGatewayMessagePayload,
  buildCallAndSmsGatewayTestPayload,
} from "Common/Types/CallAndSMS/CallAndSmsGatewayPayload";
import {
  CALL_AND_SMS_GATEWAY_URL_TITLE,
  CallAndSmsProvider,
} from "Common/Types/CallAndSMS/CallAndSmsProvider";
import {
  CUSTOM_CHANNEL_ACTIONS,
  CUSTOM_CHANNEL_EVENT_HEADER,
  CUSTOM_CHANNEL_SIGNATURE_HEADER,
} from "Common/Types/CustomNotificationChannel/CustomNotificationChannelPayload";
import { JSONObject } from "Common/Types/JSON";
import { MORE_FIELDS_SECTION_TITLE } from "Common/UI/Components/Forms/Utils/AdvancedFormSection";
import { MAX_SMS_LENGTH } from "Common/Utils/MessageFit";
import { describe, expect, it } from "@jest/globals";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import vm from "vm";

/*
 * THE SMS AND CALL GATEWAY PAGE (self-hosted/sms-and-call-gateway), HELD
 * TO THE CODE.
 *
 * The page is a contract with a service the installation writes itself -
 * its headers, its retries and time limits, every field of the request, the
 * links that act on a page, what the logs say - and with the Admin
 * Dashboard's card it walks an admin through. Markdown is not compiled, so
 * nothing else notices when the code moves on: these read the page and
 * compare each fact with the constant, builder or card it describes. The
 * Admin Dashboard's card is read as text (an App test does not import the
 * Admin Dashboard's React components).
 */

const PAGE: string = "self-hosted/sms-and-call-gateway";
const PAGE_URL: string = "/docs/self-hosted/sms-and-call-gateway";
const NAV_TITLE: string = "SMS and Call Gateway";

const PACKAGES_DIR: string = path.resolve(__dirname, "../../../..");

function readPackageFile(relative: string): string {
  return fs.readFileSync(path.join(PACKAGES_DIR, relative), "utf8");
}

const page: string = readPage("en", PAGE);

const card: string = readPackageFile(
  "App/FeatureSet/AdminDashboard/src/Pages/Settings/CallSMS/CallAndSmsGatewayCard.tsx",
);

const ADMIN_ENGLISH: Record<string, Record<string, string>> = JSON.parse(
  readPackageFile("App/FeatureSet/AdminDashboard/src/Locales/en.json"),
) as Record<string, Record<string, string>>;

// The text of the section under a "## " heading, up to the next one.
function section(heading: string): string {
  const start: number = page.indexOf(`\n## ${heading}\n`);

  expect({ heading, found: start >= 0 }).toEqual({ heading, found: true });

  const rest: string = page.slice(start + heading.length + 5);
  const end: number = rest.indexOf("\n## ");

  return end === -1 ? rest : rest.slice(0, end);
}

// The code of every fenced block whose language is `lang`, in order.
function codeBlocks(markdown: string, lang: string): Array<string> {
  const blocks: Array<string> = [];
  let isInBlock: boolean = false;
  let isKept: boolean = false;
  let current: Array<string> = [];

  for (const line of markdown.split("\n")) {
    if (line.startsWith("```")) {
      if (!isInBlock) {
        isInBlock = true;
        isKept = line.slice(3).split(" ")[0] === lang;
        current = [];
      } else {
        if (isKept) {
          blocks.push(current.join("\n"));
        }

        isInBlock = false;
      }

      continue;
    }

    if (isInBlock) {
      current.push(line);
    }
  }

  return blocks;
}

// The rows of the markdown table that starts at the line with `header`.
function tableRows(markdown: string, header: string): Array<Array<string>> {
  const lines: Array<string> = markdown.split("\n");
  const start: number = lines.findIndex((line: string): boolean => {
    return line.startsWith(header);
  });

  expect({ header, found: start >= 0 }).toEqual({ header, found: true });

  const rows: Array<Array<string>> = [];

  // The header, then the "| --- |" line, then the rows.
  for (let index: number = start + 2; index < lines.length; index++) {
    const line: string = lines[index] as string;

    if (!line.startsWith("|")) {
      break;
    }

    rows.push(
      line
        .slice(1, -1)
        .split("|")
        .map((cell: string): string => {
          return cell.trim();
        }),
    );
  }

  return rows;
}

function allLinks(group: NavGroup): Array<NavLink> {
  return group.links;
}

describe("the page in the docs", () => {
  it("is in the Self Hosted group, right after Twilio Integration", () => {
    const group: NavGroup | undefined = DocsNav.find(
      (candidate: NavGroup): boolean => {
        return candidate.title === "Self Hosted";
      },
    );

    expect(group).toBeDefined();

    const urls: Array<string> = allLinks(group!).map(
      (link: NavLink): string => {
        return link.url;
      },
    );
    const at: number = urls.indexOf(PAGE_URL);

    expect(at).toBeGreaterThan(0);
    expect(urls[at - 1]).toBe("/docs/self-hosted/twilio-integration");
    expect(group!.links[at]!.title).toBe(NAV_TITLE);
  });

  it("is listed once in the whole nav", () => {
    const urls: Array<string> = DocsNav.flatMap((group: NavGroup) => {
      return allLinks(group).map((link: NavLink): string => {
        return link.url;
      });
    });

    expect(
      urls.filter((url: string): boolean => {
        return url === PAGE_URL;
      }),
    ).toHaveLength(1);
  });

  it("has its nav link's title as its own", () => {
    expect(page.split("\n")[0]).toBe(`# ${NAV_TITLE}`);
  });

  it("names its nav link in every docs language", () => {
    expect(SUPPORTED_DOCS_LANGUAGE_CODES).toHaveLength(17);

    for (const language of SUPPORTED_DOCS_LANGUAGE_CODES) {
      const locale: Record<string, Record<string, string>> = JSON.parse(
        readPackageFile(`App/FeatureSet/Docs/Locales/${language}.json`),
      ) as Record<string, Record<string, string>>;
      const title: unknown = locale["navLinks"]?.[NAV_TITLE];

      expect({
        language,
        named: typeof title === "string" && title.length > 0,
      }).toEqual({ language, named: true });

      // Beside the other self-hosted notification pages, in the same table.
      expect({
        language,
        besideCustomChannels:
          typeof locale["navLinks"]?.["Custom Notification Channels"] ===
          "string",
      }).toEqual({ language, besideCustomChannels: true });
    }
  });

  it("is linked from the Twilio guide, for an installation that may not send through Twilio", () => {
    const twilio: string = readPage("en", "self-hosted/twilio-integration");

    expect(twilio).toContain(
      `- [${NAV_TITLE}](${PAGE_URL}): Send SMS and calls through your own provider instead of Twilio.`,
    );
  });

  it("links back to the Twilio guide, custom channels and private network access", () => {
    for (const target of [
      "/docs/self-hosted/twilio-integration",
      "/docs/self-hosted/custom-notification-channels",
      "/docs/self-hosted/private-network-access",
    ]) {
      expect(page).toContain(`](${target}`);
    }
  });
});

describe("Set It Up, as the Admin Dashboard's card draws it", () => {
  const setUp: string = section("Set It Up");

  it("goes to Settings > Call and SMS, as the Admin Dashboard's menu names it", () => {
    expect(ADMIN_ENGLISH["sideMenu"]?.["settings"]).toBe("Settings");
    expect(ADMIN_ENGLISH["sideMenu"]?.["settingsCallSms"]).toBe("Call and SMS");
    expect(setUp).toContain("go to **Settings > Call and SMS**");
  });

  it("names the card, its Edit Provider button and its Send Test button", () => {
    expect(card).toContain('name="SMS and Call Provider"');
    expect(card).toContain('title: "SMS and Call Provider",');
    expect(card).toContain('editButtonText="Edit Provider"');
    expect(card).toContain('title: "Send Test",');

    expect(setUp).toContain(
      "click **Edit Provider** on the **SMS and Call Provider** card",
    );
    expect(setUp).toContain("Click **Send Test**.");
  });

  it("names the answer, the URL field and the folded secret as the form does", () => {
    expect(card).toContain('title: "Your own gateway",');
    expect(card).toContain("value: CallAndSmsProvider.Gateway,");
    expect(card).toContain('title: "Twilio",');
    expect(card).toContain("value: CallAndSmsProvider.Twilio,");
    expect(card).toContain("title: CALL_AND_SMS_GATEWAY_URL_TITLE,");
    expect(card).toContain('title: "Signing Secret",');
    expect(card).toContain("collapsibleSection: advancedSection,");
    expect(CALL_AND_SMS_GATEWAY_URL_TITLE).toBe("Gateway URL");
    expect(MORE_FIELDS_SECTION_TITLE).toBe("More fields");
    expect([...Object.values(CallAndSmsProvider)].sort()).toEqual(
      ["Gateway", "Twilio"].sort(),
    );

    expect(setUp).toContain(
      `Choose **Your own gateway**, and enter the **${CALL_AND_SMS_GATEWAY_URL_TITLE}**. It can be on your private network.`,
    );
    expect(setUp).toContain(
      `clear **Signing Secret** under **${MORE_FIELDS_SECTION_TITLE}** and save: OneUptime makes a new one.`,
    );
    expect(setUp).toContain("choose **Twilio** and save.");
  });

  it("says the gateway can be on the private network, as the server checks its URL", () => {
    const service: string = readPackageFile(
      "Common/Server/Services/GlobalConfigService.ts",
    );
    const sender: string = readPackageFile(
      "App/FeatureSet/Notification/Services/CallAndSmsGatewayService.ts",
    );

    for (const source of [service, sender]) {
      expect(source).toContain("allowPrivateNetworkTargets: true,");
    }

    expect(card).toContain("It can be on your private network.");
  });

  it("says the secret is made on save, as the card does", () => {
    expect(card).toContain("Made for you when you save.");
    expect(setUp).toContain("Save. OneUptime makes a signing secret for you.");
  });

  it("says a test should answer 2xx and send nothing, as the test request itself does", () => {
    expect(setUp).toContain(
      "Your gateway should answer with a 2xx status and send nothing.",
    );
    expect(
      buildCallAndSmsGatewayTestPayload({ id: "x", sentAt: new Date() })[
        "message"
      ],
    ).toContain("Answer 2xx and send nothing.");
  });
});

describe("What Your Gateway Receives", () => {
  const receives: string = section("What Your Gateway Receives");

  it("lists the four headers each request carries, as SignedWebhookPost sets them", () => {
    expect(tableRows(receives, "| Header | Value |")).toEqual([
      ["`Content-Type`", "`application/json`"],
      [
        `\`${CUSTOM_CHANNEL_EVENT_HEADER}\``,
        `${Object.values(CallAndSmsGatewayEvent)
          .map((event: string): string => {
            return `\`${event}\``;
          })
          .join(", ")
          .replace(/, ([^,]*)$/, " or $1")}`,
      ],
      [
        `\`${CUSTOM_CHANNEL_SIGNATURE_HEADER}\``,
        "`sha256=` followed by the hex HMAC-SHA256 of the body, keyed with the signing secret",
      ],
      ["`User-Agent`", `\`${CALL_AND_SMS_GATEWAY_USER_AGENT}\``],
    ]);
    expect(CALL_AND_SMS_GATEWAY_USER_AGENT).toBe(
      "OneUptime-CallAndSmsGateway/1.0",
    );
  });

  it("shows a request with exactly the fields the builder sends, in its order", () => {
    const example: JSONObject = JSON.parse(
      codeBlocks(receives, "json")[0] as string,
    ) as JSONObject;

    const built: JSONObject = buildCallAndSmsGatewayMessagePayload({
      event: CallAndSmsGatewayEvent.Sms,
      id: "id",
      sentAt: new Date(),
      to: "+15551234567",
      message: "message",
      isSensitive: false,
      project: { id: "project", name: "Production" },
      actions: {
        acknowledge: "a",
        escalate: "e",
        resolve: "r",
      },
    });

    expect(Object.keys(example)).toEqual(Object.keys(built));
    expect(example["version"]).toBe(CALL_AND_SMS_GATEWAY_PAYLOAD_VERSION);
    expect(example["event"]).toBe(CallAndSmsGatewayEvent.Sms);
    expect(Object.keys(example["project"] as JSONObject)).toEqual(
      Object.keys(built["project"] as JSONObject),
    );
    expect(Object.keys(example["actions"] as JSONObject)).toEqual([
      ...CUSTOM_CHANNEL_ACTIONS,
    ]);
    expect(Number.isNaN(Date.parse(example["sentAt"] as string))).toBe(false);
  });

  it("shows the action links where the server makes them", () => {
    const example: JSONObject = JSON.parse(
      codeBlocks(receives, "json")[0] as string,
    ) as JSONObject;
    const tokenSource: string = readPackageFile(
      "Common/Server/Utils/OnCall/CustomChannelActionToken.ts",
    );

    expect(tokenSource).toContain(
      "<api>/custom-notification-channel/page/<notification id>/<action>?token=...",
    );

    for (const action of CUSTOM_CHANNEL_ACTIONS) {
      expect(String((example["actions"] as JSONObject)[action])).toMatch(
        new RegExp(
          `/api/custom-notification-channel/page/[^/]+/${action}\\?token=`,
        ),
      );
    }
  });

  it("describes every field the request carries, in its order, and no other", () => {
    const rows: Array<Array<string>> = tableRows(
      receives,
      "| Field | What it is |",
    );
    const keys: Array<string> = Object.keys(
      buildCallAndSmsGatewayTestPayload({ id: "x", sentAt: new Date() }),
    );

    expect(
      rows.map((cells: Array<string>): string => {
        return cells[0] as string;
      }),
    ).toEqual(
      keys.map((key: string): string => {
        return `\`${key}\``;
      }),
    );
  });

  it("gives the limits a message is held to, as the senders hold it", () => {
    const rows: Array<Array<string>> = tableRows(
      receives,
      "| Field | What it is |",
    );
    const message: string = (rows.find((cells: Array<string>): boolean => {
      return cells[0] === "`message`";
    }) || [])[1] as string;

    expect(MAX_SMS_LENGTH).toBe(1600);
    expect(MAX_CALL_AND_SMS_GATEWAY_MESSAGE_LENGTH).toBe(16384);
    expect(message).toContain(
      `An SMS is at most ${MAX_SMS_LENGTH.toLocaleString("en-US")} characters, and a call's text at most ${MAX_CALL_AND_SMS_GATEWAY_MESSAGE_LENGTH.toLocaleString("en-US")}.`,
    );
    expect(message).toContain(
      "A longer text is cut and ends with a note that the rest is in OneUptime.",
    );
  });

  it("says what a test leaves out, as the test request does", () => {
    const test: JSONObject = buildCallAndSmsGatewayTestPayload({
      id: "x",
      sentAt: new Date(),
    });
    const rows: Array<Array<string>> = tableRows(
      receives,
      "| Field | What it is |",
    );
    const to: string = (rows.find((cells: Array<string>): boolean => {
      return cells[0] === "`to`";
    }) || [])[1] as string;

    expect(test["to"]).toBeNull();
    expect(to).toContain("`null` in a test.");

    const testRequests: string = section("Test Requests");

    expect(test["event"]).toBe("test");
    expect(test["project"]).toBeNull();
    expect(test["actions"]).toBeNull();
    expect(testRequests).toContain(
      "**Send test** sends a request with `event` set to `test`, and `to`, `project` and `actions` set to `null`.",
    );
  });

  it("says a call is described without Twilio's keypad, as the call's message leaves it out", () => {
    const callService: string = readPackageFile(
      "App/FeatureSet/Notification/Services/CallService.ts",
    );

    expect(callService).toContain(
      "export function getCallGatewayMessage(callRequest: CallRequest): string {",
    );
    expect(receives).toContain(
      'A call is described rather than scripted: `message` is what it says, without Twilio\'s "press 1 to acknowledge".',
    );
  });
});

describe("Check the Signature", () => {
  it("gives a verifier that accepts what OneUptime signs, and refuses anything else", () => {
    const code: string = codeBlocks(page, "javascript")[0] as string;

    expect(code).toContain(
      "function isFromOneUptime(rawBody, signatureHeader, secret)",
    );

    const sandbox: Record<string, unknown> = {
      require: (name: string): unknown => {
        expect(name).toBe("crypto");
        return crypto;
      },
      Buffer: Buffer,
      String: String,
    };

    vm.runInNewContext(
      `${code}\nthis.isFromOneUptime = isFromOneUptime;`,
      sandbox,
    );

    const isFromOneUptime: (
      rawBody: string,
      signatureHeader: string,
      secret: string,
    ) => boolean = sandbox["isFromOneUptime"] as (
      rawBody: string,
      signatureHeader: string,
      secret: string,
    ) => boolean;

    const body: string = JSON.stringify(
      buildCallAndSmsGatewayTestPayload({ id: "x", sentAt: new Date() }),
    );
    const secret: string = "a".repeat(64);
    const signature: string = signWebhookBody({ secret, body });

    expect(isFromOneUptime(body, signature, secret)).toBe(true);
    expect(isFromOneUptime(`${body} `, signature, secret)).toBe(false);
    expect(isFromOneUptime(body, signature, "another secret")).toBe(false);
    expect(isFromOneUptime(body, "", secret)).toBe(false);
  });

  it("says the check is the custom channel's, as both are signed by one function", () => {
    expect(section("What Your Gateway Receives")).toContain(
      "The check is the same as for a [custom channel](/docs/self-hosted/custom-notification-channels#check-the-signature), so one verifier serves both",
    );
  });
});

describe("Act on a Page", () => {
  it("says each link's token is valid for a week, as the token is signed", () => {
    const days: number = CUSTOM_CHANNEL_ACTION_TOKEN_EXPIRES_IN_SECONDS / 86400;

    expect(days).toBe(7);
    expect(section("Act on a Page")).toContain(
      `each carries a token for that one page that is valid for ${days} days`,
    );
  });

  it("says the gateway posts to the link", () => {
    expect(section("Act on a Page")).toContain(
      "your gateway sends a `POST` request to the matching link in `actions`",
    );
  });
});

describe("Delivery and Retries", () => {
  const delivery: string = section("Delivery and Retries");

  it("gives the time a request has, as one attempt waits", () => {
    const seconds: number = SIGNED_WEBHOOK_REQUEST_TIMEOUT_MS / 1000;

    expect(seconds).toBe(10);
    expect(delivery).toContain(
      `A request counts as delivered when your gateway answers with a 2xx status within ${seconds} seconds.`,
    );
  });

  it("names the answers that are tried again, as isRetryableStatus does", () => {
    for (const status of [408, 429, 500, 503, 599]) {
      expect({ status, retried: isRetryableStatus(status) }).toEqual({
        status,
        retried: true,
      });
    }

    for (const status of [400, 401, 403, 404, 410, 422, 499]) {
      expect({ status, retried: isRetryableStatus(status) }).toEqual({
        status,
        retried: false,
      });
    }

    expect(delivery).toContain(
      "A request it did not answer, or answered with 408, 429 or a 5xx status, is sent again",
    );
    expect(delivery).toContain("Any other 4xx status is not sent again.");
  });

  it("gives the waits and the attempts, as SignedWebhookPost makes them", () => {
    const [first, second] = SIGNED_WEBHOOK_RETRY_DELAYS_MS.map(
      (ms: number): number => {
        return ms / 1000;
      },
    );

    expect(first).toBe(1);
    expect(second).toBe(4);
    expect(SIGNED_WEBHOOK_MAX_ATTEMPTS).toBe(3);
    expect(SIGNED_WEBHOOK_RETRY_DELAYS_MS).toHaveLength(
      SIGNED_WEBHOOK_MAX_ATTEMPTS - 1,
    );
    expect(delivery).toContain(
      `is sent again after ${first} second and after ${second} seconds more: three attempts in all.`,
    );
  });

  it("quotes what the logs say, in the sender's words, and says they never name the URL", () => {
    expect(CALL_AND_SMS_GATEWAY_NAME).toBe("the SMS and call gateway");
    expect(delivery).toContain(
      `says \`Sent to ${CALL_AND_SMS_GATEWAY_NAME} (HTTP 200).\` or why it was not delivered, never the URL.`,
    );

    const sender: string = readPackageFile(
      "App/FeatureSet/Notification/Services/CallAndSmsGatewayService.ts",
    );

    expect(sender).toContain(
      "message: `Sent to ${CALL_AND_SMS_GATEWAY_NAME} (HTTP ${outcome.statusCode}).`,",
    );
  });

  it("says an SMS shows as sent once the gateway accepts it, and its number is left blank", () => {
    const smsService: string = readPackageFile(
      "App/FeatureSet/Notification/Services/SmsService.ts",
    );

    expect(smsService).toContain(
      "smsLog.status = SmsStatus.Sent;\n        smsLog.statusMessage = result.message;",
    );
    expect(smsService).toContain(
      "if (fromNumber) {\n        smsLog.fromNumber = fromNumber;\n      }",
    );
    expect(delivery).toContain(
      "an SMS shows as sent once your gateway accepts it, and the number it went out from is left blank.",
    );
  });
});

describe("How It Works", () => {
  it("says projects with a Twilio config of their own still send through it, as the senders do", () => {
    for (const file of [
      "App/FeatureSet/Notification/Services/SmsService.ts",
      "App/FeatureSet/Notification/Services/CallService.ts",
    ]) {
      expect(readPackageFile(file)).toContain(
        "const gateway: CallAndSmsGateway | null = customTwilioConfig\n        ? null\n        : await getCallAndSmsGateway();",
      );
    }

    expect(section("How It Works")).toContain(
      "Projects that add a Twilio config of their own, under **Project Settings > Call & SMS**, still send through that config.",
    );
    expect(card).toContain(
      "Projects with a Twilio config of their own still send through it.",
    );
  });
});

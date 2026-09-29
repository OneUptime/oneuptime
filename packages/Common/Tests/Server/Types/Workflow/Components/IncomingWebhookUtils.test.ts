import { describe, expect, test } from "@jest/globals";
import URL from "../../../../../Types/API/URL";
import Exception from "../../../../../Types/Exception/Exception";
import BadDataException from "../../../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../../../Types/JSON";
import ObjectID from "../../../../../Types/ObjectID";
import { RunOptions } from "../../../../../Server/Types/Workflow/ComponentCode";
import IncomingWebhookUtils, {
  DISCORD_WEBHOOK_DOMAINS,
} from "../../../../../Server/Types/Workflow/Components/IncomingWebhookUtils";
import { MICROSOFT_TEAMS_WEBHOOK_DOMAINS } from "../../../../../Server/Utils/Workspace/MicrosoftTeams/MicrosoftTeams";

/*
 * The chat components take a free-text "webhook-url" off the workflow graph -
 * authored by any project member, and templatable from trigger data - and the
 * API server POSTs to it. That is the SSRF primitive GHSA-v5xh-rw9h-77fv
 * reported, so the URL is pinned to the vendor's own hosts.
 *
 * A pin only holds if it is applied to the RAW string. URL.fromString defaults
 * an unrecognised scheme to https, so "gopher://10.0.0.1/" converted first
 * would arrive at the check looking perfectly clean. Every refusal below is
 * therefore about a string that some other parse order would have accepted:
 * a suffix that merely CONTAINS the vendor name, credentials that move the
 * real host past an @, a scheme that is not https, and the usual
 * link-local/metadata targets an attacker actually wants.
 */

type BuildOptionsFunction = () => RunOptions;

const buildOptions: BuildOptionsFunction = (): RunOptions => {
  return {
    log: (): void => {},
    workflowLogId: ObjectID.generate(),
    workflowId: ObjectID.generate(),
    projectId: ObjectID.generate(),
    onError: (exception: Exception): Exception => {
      return exception;
    },
    executeWorkflow: async (): Promise<void> => {},
  };
};

type PinFunction = (data: {
  url?: unknown;
  allowedDomains?: Array<string>;
  vendorName?: string;
}) => URL;

const pin: PinFunction = (data: {
  url?: unknown;
  allowedDomains?: Array<string>;
  vendorName?: string;
}): URL => {
  const args: JSONObject = {} as JSONObject;

  if (data.url !== undefined) {
    (args as Record<string, unknown>)["webhook-url"] = data.url;
  }

  return IncomingWebhookUtils.getPinnedWebhookUrl({
    args: args,
    options: buildOptions(),
    allowedDomains: data.allowedDomains || DISCORD_WEBHOOK_DOMAINS,
    vendorName: data.vendorName || "Discord",
  });
};

describe("a URL on the vendor's own hosts is accepted", () => {
  test("accepts the canonical Discord webhook URL", () => {
    expect(
      pin({
        url: "https://discord.com/api/webhooks/123/abc",
      }).toString(),
    ).toBe("https://discord.com/api/webhooks/123/abc");
  });

  test("accepts the legacy discordapp.com host", () => {
    expect(
      pin({ url: "https://discordapp.com/api/webhooks/1/x" }).toString(),
    ).toContain("discordapp.com");
  });

  test("accepts a subdomain of an allowed domain", () => {
    expect(
      pin({ url: "https://ptb.discord.com/api/webhooks/1/x" }).toString(),
    ).toContain("ptb.discord.com");
  });

  test("accepts a URL handed in as a URL object rather than a string", () => {
    expect(
      pin({
        url: URL.fromString("https://discord.com/api/webhooks/1/x"),
      }).toString(),
    ).toContain("discord.com");
  });

  test("accepts an allowed host written in mixed case", () => {
    expect(() => {
      return pin({ url: "https://DISCORD.com/api/webhooks/1/x" });
    }).not.toThrow();
  });

  test("returns a parsed URL, not the raw string", () => {
    expect(pin({ url: "https://discord.com/api/webhooks/1/x" })).toBeInstanceOf(
      URL,
    );
  });

  test("accepts every Microsoft Teams host the workspace integration allows", () => {
    for (const domain of MICROSOFT_TEAMS_WEBHOOK_DOMAINS) {
      expect(
        pin({
          url: `https://${domain}/webhookb2/abc`,
          allowedDomains: MICROSOFT_TEAMS_WEBHOOK_DOMAINS,
          vendorName: "Microsoft Teams",
        }).toString(),
      ).toContain(domain);
    }
  });
});

describe("a missing webhook URL is refused before anything is parsed", () => {
  test("refuses an args bag with no webhook-url at all", () => {
    expect(() => {
      return pin({});
    }).toThrow("Discord Webhook URL not found");
  });

  test("refuses an empty webhook-url", () => {
    expect(() => {
      return pin({ url: "" });
    }).toThrow("Discord Webhook URL not found");
  });

  test("refuses a null webhook-url", () => {
    expect(() => {
      return pin({ url: null });
    }).toThrow("Discord Webhook URL not found");
  });

  test("names the vendor it was asked about in the message", () => {
    expect(() => {
      return pin({
        vendorName: "Microsoft Teams",
        allowedDomains: MICROSOFT_TEAMS_WEBHOOK_DOMAINS,
      });
    }).toThrow("Microsoft Teams Webhook URL not found");
  });
});

describe("a host that is not the vendor's is refused", () => {
  test("refuses an unrelated public host", () => {
    expect(() => {
      return pin({ url: "https://evil.example.com/api/webhooks/1/x" });
    }).toThrow(BadDataException);
  });

  test("refuses a suffix that merely CONTAINS the vendor name", () => {
    expect(() => {
      return pin({ url: "https://notdiscord.com/api/webhooks/1/x" });
    }).toThrow(BadDataException);
  });

  test("refuses the vendor name used as a prefix of an attacker's domain", () => {
    expect(() => {
      return pin({ url: "https://discord.com.evil.example/x" });
    }).toThrow(BadDataException);
  });

  test("refuses the vendor host hidden in the userinfo of another host", () => {
    expect(() => {
      return pin({ url: "https://discord.com@evil.example.com/x" });
    }).toThrow(BadDataException);
  });

  test("refuses a Teams host when the component asked about Discord", () => {
    expect(() => {
      return pin({ url: "https://office.com/webhookb2/abc" });
    }).toThrow(BadDataException);
  });

  test("says which domains would have been acceptable", () => {
    expect(() => {
      return pin({ url: "https://evil.example.com/x" });
    }).toThrow("discord.com or discordapp.com");
  });
});

describe("a scheme that is not https is refused, whatever it would parse to", () => {
  test("refuses plain http even on an allowed host", () => {
    expect(() => {
      return pin({ url: "http://discord.com/api/webhooks/1/x" });
    }).toThrow(BadDataException);
  });

  test("refuses a scheme URL.fromString would have quietly rewritten to https", () => {
    expect(() => {
      return pin({ url: "gopher://discord.com/api/webhooks/1/x" });
    }).toThrow(BadDataException);
  });

  test("refuses file:", () => {
    expect(() => {
      return pin({ url: "file:///etc/passwd" });
    }).toThrow(BadDataException);
  });

  test("refuses a data: URL", () => {
    expect(() => {
      return pin({ url: "data:text/plain,discord.com" });
    }).toThrow(BadDataException);
  });

  test("refuses a string that is not a URL at all", () => {
    expect(() => {
      return pin({ url: "discord.com/api/webhooks/1/x" });
    }).toThrow(BadDataException);
  });
});

describe("the internal targets an SSRF is actually aimed at", () => {
  const internalTargets: Array<string> = [
    "https://169.254.169.254/latest/meta-data/",
    "https://metadata.google.internal/computeMetadata/v1/",
    "https://127.0.0.1/api/webhooks/1/x",
    "https://localhost/api/webhooks/1/x",
    "https://10.0.0.1/api/webhooks/1/x",
    "https://192.168.1.1/api/webhooks/1/x",
    "https://[::1]/api/webhooks/1/x",
    "https://0x7f000001/api/webhooks/1/x",
    "https://2130706433/api/webhooks/1/x",
  ];

  test.each(internalTargets)("refuses %s", (target: string) => {
    expect(() => {
      return pin({ url: target });
    }).toThrow(BadDataException);
  });

  test("refuses them for Microsoft Teams too", () => {
    for (const target of internalTargets) {
      expect(() => {
        return pin({
          url: target,
          allowedDomains: MICROSOFT_TEAMS_WEBHOOK_DOMAINS,
          vendorName: "Microsoft Teams",
        });
      }).toThrow(BadDataException);
    }
  });
});

describe("an empty allowlist pins to nothing at all", () => {
  test("refuses even the vendor's own host", () => {
    expect(() => {
      return pin({
        url: "https://discord.com/api/webhooks/1/x",
        allowedDomains: [],
      });
    }).toThrow(BadDataException);
  });
});

describe("the exported allowlists are the ones the components use", () => {
  test("Discord pins to discord.com and discordapp.com only", () => {
    expect(DISCORD_WEBHOOK_DOMAINS).toEqual(["discord.com", "discordapp.com"]);
  });

  test("no allowlist entry is a bare public suffix", () => {
    for (const domain of [
      ...DISCORD_WEBHOOK_DOMAINS,
      ...MICROSOFT_TEAMS_WEBHOOK_DOMAINS,
    ]) {
      expect(domain.split(".").length).toBeGreaterThanOrEqual(2);
      expect(domain).not.toContain("/");
      expect(domain).toBe(domain.toLowerCase());
    }
  });
});

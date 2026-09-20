import { describe, expect, it } from "@jest/globals";
import {
  AvailablePhoneNumber,
  DialOptions,
  DialStatusData,
  ICallProvider,
  IncomingCallData,
  OwnedPhoneNumber,
  PurchasedPhoneNumber,
  SearchNumberOptions,
  WebhookRequest,
} from "../../../Types/Call/CallProvider";
import { JSONObject } from "../../../Types/JSON";

/*
 * CallProvider.ts is a pure type module: the ICallProvider contract every
 * telephony backend (Twilio today) must satisfy, plus the DTOs exchanged with
 * it. There is no runtime code, so this suite does two things:
 *
 *  1. Compile-time contract checks. ts-jest type-checks this file, so the
 *     `@ts-expect-error` lines fail the suite if the types ever loosen (e.g.
 *     dialStatus accepting any string) and the fake below fails to compile if
 *     the interface changes shape.
 *  2. Behavioural checks of a small in-memory provider written purely against
 *     the interface, exercising how callers are expected to use it.
 */

type DialStatus = DialStatusData["dialStatus"];

const ALL_DIAL_STATUSES: Array<DialStatus> = [
  "completed",
  "busy",
  "no-answer",
  "failed",
  "canceled",
];

const escapeXml: (value: string) => string = (value: string): string => {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
};

class InMemoryCallProvider implements ICallProvider {
  public readonly inventory: Array<AvailablePhoneNumber> = [
    {
      phoneNumber: "+14155550123",
      friendlyName: "(415) 555-0123",
      locality: "San Francisco",
      region: "CA",
      country: "US",
    },
    {
      phoneNumber: "+14155550999",
      friendlyName: "(415) 555-0999",
      country: "US",
    },
    {
      phoneNumber: "+442071234567",
      friendlyName: "020 7123 4567",
      locality: "London",
      country: "GB",
    },
  ];

  public readonly owned: Map<string, OwnedPhoneNumber> = new Map();
  private nextId: number = 1;

  public constructor(private readonly signingSecret: string) {}

  public async searchAvailableNumbers(
    options: SearchNumberOptions,
  ): Promise<AvailablePhoneNumber[]> {
    const matches: Array<AvailablePhoneNumber> = this.inventory.filter(
      (candidate: AvailablePhoneNumber) => {
        if (candidate.country !== options.countryCode) {
          return false;
        }
        if (
          options.areaCode &&
          !candidate.phoneNumber.startsWith(`+1${options.areaCode}`)
        ) {
          return false;
        }
        if (
          options.contains &&
          !candidate.phoneNumber.includes(options.contains)
        ) {
          return false;
        }
        return true;
      },
    );

    return matches.slice(0, options.limit ?? matches.length);
  }

  public async listOwnedNumbers(): Promise<OwnedPhoneNumber[]> {
    return Array.from(this.owned.values());
  }

  public async purchaseNumber(
    phoneNumber: string,
    webhookUrl: string,
  ): Promise<PurchasedPhoneNumber> {
    const available: AvailablePhoneNumber | undefined = this.inventory.find(
      (candidate: AvailablePhoneNumber) => {
        return candidate.phoneNumber === phoneNumber;
      },
    );

    if (!available) {
      throw new Error(`Number ${phoneNumber} is not available`);
    }

    const phoneNumberId: string = `PN${this.nextId++}`;
    this.owned.set(phoneNumberId, {
      phoneNumberId,
      phoneNumber,
      friendlyName: available.friendlyName,
      voiceUrl: webhookUrl,
    });

    return { phoneNumberId, phoneNumber };
  }

  public async assignExistingNumber(
    phoneNumberId: string,
    webhookUrl: string,
  ): Promise<PurchasedPhoneNumber> {
    await this.updateWebhookUrl(phoneNumberId, webhookUrl);
    const owned: OwnedPhoneNumber = this.owned.get(
      phoneNumberId,
    ) as OwnedPhoneNumber;
    return { phoneNumberId, phoneNumber: owned.phoneNumber };
  }

  public async releaseNumber(phoneNumberId: string): Promise<void> {
    if (!this.owned.delete(phoneNumberId)) {
      throw new Error(`Unknown number ${phoneNumberId}`);
    }
  }

  public async updateWebhookUrl(
    phoneNumberId: string,
    webhookUrl: string,
  ): Promise<void> {
    const owned: OwnedPhoneNumber | undefined = this.owned.get(phoneNumberId);
    if (!owned) {
      throw new Error(`Unknown number ${phoneNumberId}`);
    }
    owned.voiceUrl = webhookUrl;
  }

  public generateGreetingResponse(message: string): string {
    return `<Response><Say>${escapeXml(message)}</Say></Response>`;
  }

  public generateDialResponse(options: DialOptions): string {
    return (
      `<Response><Dial callerId="${escapeXml(options.fromPhoneNumber)}" ` +
      `timeout="${options.timeoutSeconds}" ` +
      `action="${escapeXml(options.statusCallbackUrl)}">` +
      `${escapeXml(options.toPhoneNumber)}</Dial></Response>`
    );
  }

  public generateHangupResponse(message?: string): string {
    return message
      ? `<Response><Say>${escapeXml(message)}</Say><Hangup/></Response>`
      : "<Response><Hangup/></Response>";
  }

  public generateEscalationResponse(
    message: string,
    nextDialOptions: DialOptions,
  ): string {
    const dial: string = this.generateDialResponse(nextDialOptions)
      .replace("<Response>", "")
      .replace("</Response>", "");
    return `<Response><Say>${escapeXml(message)}</Say>${dial}</Response>`;
  }

  public parseIncomingCallWebhook(request: WebhookRequest): IncomingCallData {
    return {
      callId: String(request.body["CallSid"] || ""),
      callerPhoneNumber: String(request.body["From"] || ""),
      calledPhoneNumber: String(request.body["To"] || ""),
    };
  }

  public parseDialStatusWebhook(request: WebhookRequest): DialStatusData {
    const status: string = String(request.body["DialCallStatus"] || "failed");
    const dialStatus: DialStatus = (
      ALL_DIAL_STATUSES as Array<string>
    ).includes(status)
      ? (status as DialStatus)
      : "failed";

    const rawDuration: unknown = request.body["DialCallDuration"];
    const result: DialStatusData = {
      callId: String(request.body["CallSid"] || ""),
      dialStatus,
    };

    if (rawDuration !== undefined && !isNaN(Number(rawDuration))) {
      result.dialDurationSeconds = Number(rawDuration);
    }

    return result;
  }

  public validateWebhookSignature(
    request: WebhookRequest,
    signature: string,
  ): boolean {
    const host: string = request.get("host") || "";
    const expected: string = `${this.signingSecret}:${request.protocol}://${host}${request.originalUrl}`;
    return signature === expected;
  }
}

const makeRequest: (
  body: JSONObject,
  headers?: { [key: string]: string | string[] | undefined },
) => WebhookRequest = (
  body: JSONObject,
  headers: { [key: string]: string | string[] | undefined } = {
    host: "oneuptime.example.com",
  },
): WebhookRequest => {
  return {
    body,
    headers,
    originalUrl: "/notification/incoming-call/voice?policy=1",
    url: "/voice?policy=1",
    protocol: "https",
    get: (name: string): string | undefined => {
      const value: string | string[] | undefined = headers[name.toLowerCase()];
      return Array.isArray(value) ? value[0] : value;
    },
  };
};

const DIAL_OPTIONS: DialOptions = {
  toPhoneNumber: "+15550001111",
  fromPhoneNumber: "+14155550123",
  timeoutSeconds: 30,
  statusCallbackUrl: "https://oneuptime.example.com/dial-status?step=1&x=2",
};

describe("CallProvider types (compile-time contract)", () => {
  it("restricts dialStatus to the five provider-agnostic outcomes", () => {
    const statuses: Array<DialStatus> = [...ALL_DIAL_STATUSES];
    expect(statuses).toHaveLength(5);

    const invalid: DialStatusData = {
      callId: "CA1",
      // @ts-expect-error - "ringing" is not a terminal dial status
      dialStatus: "ringing",
    };
    expect(invalid.callId).toBe("CA1");
  });

  it("requires the mandatory fields and allows the optional ones to be omitted", () => {
    const minimalNumber: AvailablePhoneNumber = {
      phoneNumber: "+1",
      friendlyName: "one",
      country: "US",
    };
    const minimalSearch: SearchNumberOptions = { countryCode: "US" };
    const minimalOwned: OwnedPhoneNumber = {
      phoneNumberId: "PN1",
      phoneNumber: "+1",
      friendlyName: "one",
    };

    expect(minimalNumber.locality).toBeUndefined();
    expect(minimalSearch.limit).toBeUndefined();
    expect(minimalOwned.voiceUrl).toBeUndefined();

    // @ts-expect-error - country is required on AvailablePhoneNumber
    const missingCountry: AvailablePhoneNumber = {
      phoneNumber: "+1",
      friendlyName: "one",
    };
    expect(missingCountry.phoneNumber).toBe("+1");

    // @ts-expect-error - timeoutSeconds is required on DialOptions
    const missingTimeout: DialOptions = {
      toPhoneNumber: "+1",
      fromPhoneNumber: "+2",
      statusCallbackUrl: "https://x",
    };
    expect(missingTimeout.toPhoneNumber).toBe("+1");
  });

  it("accepts an object implementing every ICallProvider method", () => {
    const provider: ICallProvider = new InMemoryCallProvider("secret");
    const methods: Array<keyof ICallProvider> = [
      "searchAvailableNumbers",
      "listOwnedNumbers",
      "purchaseNumber",
      "assignExistingNumber",
      "releaseNumber",
      "updateWebhookUrl",
      "generateGreetingResponse",
      "generateDialResponse",
      "generateHangupResponse",
      "generateEscalationResponse",
      "parseIncomingCallWebhook",
      "parseDialStatusWebhook",
      "validateWebhookSignature",
    ];

    for (const method of methods) {
      expect(typeof provider[method]).toBe("function");
    }
  });
});

describe("ICallProvider usage through the interface", () => {
  describe("phone number management", () => {
    it("searches by country, area code, substring and limit", async () => {
      const provider: ICallProvider = new InMemoryCallProvider("s");

      expect(
        await provider.searchAvailableNumbers({ countryCode: "US" }),
      ).toHaveLength(2);
      expect(
        await provider.searchAvailableNumbers({ countryCode: "GB" }),
      ).toHaveLength(1);
      expect(
        await provider.searchAvailableNumbers({ countryCode: "FR" }),
      ).toEqual([]);

      const areaMatches: Array<AvailablePhoneNumber> =
        await provider.searchAvailableNumbers({
          countryCode: "US",
          areaCode: "415",
          contains: "0999",
        });
      expect(
        areaMatches.map((n: AvailablePhoneNumber) => {
          return n.phoneNumber;
        }),
      ).toEqual(["+14155550999"]);

      expect(
        await provider.searchAvailableNumbers({ countryCode: "US", limit: 1 }),
      ).toHaveLength(1);
    });

    it("purchases, lists, re-points and releases numbers", async () => {
      const provider: ICallProvider = new InMemoryCallProvider("s");

      const purchased: PurchasedPhoneNumber = await provider.purchaseNumber(
        "+14155550123",
        "https://hooks/v1",
      );
      expect(purchased).toEqual({
        phoneNumberId: "PN1",
        phoneNumber: "+14155550123",
      });

      expect(await provider.listOwnedNumbers()).toEqual([
        {
          phoneNumberId: "PN1",
          phoneNumber: "+14155550123",
          friendlyName: "(415) 555-0123",
          voiceUrl: "https://hooks/v1",
        },
      ]);

      const reassigned: PurchasedPhoneNumber =
        await provider.assignExistingNumber("PN1", "https://hooks/v2");
      expect(reassigned).toEqual(purchased);
      expect((await provider.listOwnedNumbers())[0]!.voiceUrl).toBe(
        "https://hooks/v2",
      );

      await provider.releaseNumber("PN1");
      expect(await provider.listOwnedNumbers()).toEqual([]);
    });

    it("surfaces provider errors as promise rejections", async () => {
      const provider: ICallProvider = new InMemoryCallProvider("s");

      await expect(
        provider.purchaseNumber("+19999999999", "https://hooks"),
      ).rejects.toThrow("not available");
      await expect(provider.releaseNumber("PN404")).rejects.toThrow(
        "Unknown number",
      );
      await expect(
        provider.updateWebhookUrl("PN404", "https://hooks"),
      ).rejects.toThrow("Unknown number");
    });
  });

  describe("voice responses", () => {
    it("escapes caller-supplied text in generated markup", () => {
      const provider: ICallProvider = new InMemoryCallProvider("s");

      expect(provider.generateGreetingResponse('Hi <team> & "ops"')).toBe(
        "<Response><Say>Hi &lt;team&gt; &amp; &quot;ops&quot;</Say></Response>",
      );
    });

    it("includes dial options, escaping the callback URL", () => {
      const provider: ICallProvider = new InMemoryCallProvider("s");
      const xml: string = provider.generateDialResponse(DIAL_OPTIONS);

      expect(xml).toContain('callerId="+14155550123"');
      expect(xml).toContain('timeout="30"');
      expect(xml).toContain("step=1&amp;x=2");
      expect(xml).toContain(">+15550001111</Dial>");
    });

    it("hangs up with or without a message", () => {
      const provider: ICallProvider = new InMemoryCallProvider("s");

      expect(provider.generateHangupResponse()).toBe(
        "<Response><Hangup/></Response>",
      );
      expect(provider.generateHangupResponse("Bye")).toBe(
        "<Response><Say>Bye</Say><Hangup/></Response>",
      );
    });

    it("escalation speaks the message and then dials the next responder", () => {
      const provider: ICallProvider = new InMemoryCallProvider("s");
      const xml: string = provider.generateEscalationResponse(
        "Trying next",
        DIAL_OPTIONS,
      );

      expect(xml.startsWith("<Response><Say>Trying next</Say><Dial")).toBe(
        true,
      );
      expect(xml.match(/<Response>/g)).toHaveLength(1);
    });
  });

  describe("webhook parsing", () => {
    it("parses an incoming call", () => {
      const provider: ICallProvider = new InMemoryCallProvider("s");

      expect(
        provider.parseIncomingCallWebhook(
          makeRequest({ CallSid: "CA1", From: "+1555", To: "+1415" }),
        ),
      ).toEqual({
        callId: "CA1",
        callerPhoneNumber: "+1555",
        calledPhoneNumber: "+1415",
      });
    });

    it.each(ALL_DIAL_STATUSES)(
      "passes through the '%s' dial status",
      (status: DialStatus) => {
        const provider: ICallProvider = new InMemoryCallProvider("s");

        expect(
          provider.parseDialStatusWebhook(
            makeRequest({ CallSid: "CA1", DialCallStatus: status }),
          ).dialStatus,
        ).toBe(status);
      },
    );

    it("maps unknown statuses to failed and parses the duration", () => {
      const provider: ICallProvider = new InMemoryCallProvider("s");

      expect(
        provider.parseDialStatusWebhook(
          makeRequest({
            CallSid: "CA2",
            DialCallStatus: "ringing",
            DialCallDuration: "17",
          }),
        ),
      ).toEqual({
        callId: "CA2",
        dialStatus: "failed",
        dialDurationSeconds: 17,
      });

      expect(
        provider.parseDialStatusWebhook(makeRequest({ CallSid: "CA3" })),
      ).toEqual({ callId: "CA3", dialStatus: "failed" });
    });
  });

  describe("webhook signature validation", () => {
    it("validates against the full public URL of the request", () => {
      const provider: ICallProvider = new InMemoryCallProvider("secret");
      const request: WebhookRequest = makeRequest({});

      expect(
        provider.validateWebhookSignature(
          request,
          "secret:https://oneuptime.example.com/notification/incoming-call/voice?policy=1",
        ),
      ).toBe(true);
      expect(provider.validateWebhookSignature(request, "forged")).toBe(false);
    });

    it("reads headers through request.get, supporting multi-valued headers", () => {
      const provider: ICallProvider = new InMemoryCallProvider("secret");
      const request: WebhookRequest = makeRequest(
        {},
        { host: ["a.example.com", "b.example.com"] },
      );

      expect(request.get("Host")).toBe("a.example.com");
      expect(
        provider.validateWebhookSignature(
          request,
          "secret:https://a.example.com/notification/incoming-call/voice?policy=1",
        ),
      ).toBe(true);
    });
  });
});

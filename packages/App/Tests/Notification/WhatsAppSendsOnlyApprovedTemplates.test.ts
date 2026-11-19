import NotificationSettingEventType from "Common/Types/NotificationSetting/NotificationSettingEventType";
import {
  WHATSAPP_TEMPLATE_BY_EVENT_TYPE,
  hasWhatsAppTemplate,
} from "Common/Types/WhatsApp/WhatsAppEventTemplates";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * NO SENDER HANDS WHATSAPP A MESSAGE IT CANNOT DELIVER, AND EVERY EVENT
 * NOTIFICATION SETTINGS OFFERS WHATSAPP FOR HAS ONE (#9715).
 *
 * WhatsApp delivers only messages made from a template Meta approved. The
 * SLO, exception and missed call notifications built a WhatsApp message of
 * a plain body instead: the notification service refused each one, wrote a
 * failed WhatsApp log and reached nobody. Read here as text, over the code
 * that sends notifications (Common/Server, the Workers and the Notification
 * service):
 *
 *   - every WhatsApp message a sender writes out by hand names a template;
 *   - every one built from an event goes through that event's approved
 *     template (createWhatsAppMessageFromTemplate with its eventType, which
 *     refuses an event with none), never one picked by hand;
 *   - every event WhatsApp can send - the ones Notification Settings offers
 *     its switch for - is built into a WhatsApp message somewhere;
 *   - the four senders that handed over a plain body hand over none.
 */

const PACKAGES: string = path.resolve(__dirname, "../../..");

const SENDING_CODE: ReadonlyArray<string> = [
  path.join(PACKAGES, "Common/Server"),
  path.join(PACKAGES, "App/FeatureSet/Workers"),
  path.join(PACKAGES, "App/FeatureSet/Notification"),
];

// The builder itself, which the others call.
const BUILDER: string = "Common/Server/Utils/WhatsAppTemplateUtil.ts";

// The senders that handed over a plain body (#9715), by file.
const FORMER_PLAIN_BODY_SENDERS: ReadonlyArray<string> = [
  "App/FeatureSet/Workers/Jobs/Slo/EvaluateSlos.ts",
  "App/FeatureSet/Workers/Jobs/SloOwners/SendOwnerAddedNotification.ts",
  "Common/Server/Utils/Telemetry/ExceptionAssignmentNotifications.ts",
  "Common/Server/Utils/IncomingCall/MissedCallNotification.ts",
  "Common/Server/Services/IncomingCallMissedCallNotificationService.ts",
];

interface SourceFile {
  // Relative to packages/: "Common/Server/Services/MonitorService.ts".
  file: string;
  source: string;
}

function readSources(): Array<SourceFile> {
  const sources: Array<SourceFile> = [];

  const walk: (directory: string) => void = (directory: string): void => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (entry.name === "node_modules" || entry.name.startsWith(".")) {
        continue;
      }

      const full: string = path.join(directory, entry.name);

      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".d.ts")) {
        sources.push({
          file: path.relative(PACKAGES, full).split(path.sep).join("/"),
          source: fs.readFileSync(full, "utf8"),
        });
      }
    }
  };

  for (const root of SENDING_CODE) {
    walk(root);
  }

  return sources;
}

// The text of the object literal whose "{" is at `start`, braces matched.
function objectLiteralAt(source: string, start: number): string {
  let depth: number = 0;

  for (let index: number = start; index < source.length; index++) {
    const character: string = source[index]!;

    if (character === "{") {
      depth++;
    } else if (character === "}") {
      depth--;

      if (depth === 0) {
        return source.slice(start, index + 1);
      }
    }
  }

  throw new Error("An object literal that never closes.");
}

/*
 * Every WhatsApp message a file writes out as a literal: a whatsAppMessage
 * property given an object, or a variable of a WhatsApp message type.
 */
function whatsAppMessageLiterals(source: string): Array<string> {
  const literals: Array<string> = [];
  const starts: RegExp =
    /(?:whatsAppMessage\s*:\s*|:\s*WhatsAppMessage(?:Payload)?(?:\s*\|\s*undefined)?\s*=\s*)\{/g;

  let match: RegExpExecArray | null = starts.exec(source);

  while (match) {
    literals.push(
      objectLiteralAt(source, match.index + match[0].length - 1),
    );
    match = starts.exec(source);
  }

  return literals;
}

// Every call of the builder, with its argument object.
function builderCalls(source: string): Array<string> {
  const calls: Array<string> = [];
  const starts: RegExp = /createWhatsAppMessageFromTemplate\(\s*\{/g;

  let match: RegExpExecArray | null = starts.exec(source);

  while (match) {
    calls.push(objectLiteralAt(source, match.index + match[0].length - 1));
    match = starts.exec(source);
  }

  return calls;
}

describe("the code that sends notifications", () => {
  const sources: Array<SourceFile> = readSources();

  test("is read: the senders are found", () => {
    const files: Array<string> = sources.map((each: SourceFile): string => {
      return each.file;
    });

    expect(files).toContain(BUILDER);
    expect(files).toContain(
      "App/FeatureSet/Workers/Jobs/IncidentOwners/SendCreatedResourceNotification.ts",
    );
    expect(files).toContain(
      "Common/Server/Services/UserNotificationSettingService.ts",
    );
    expect(
      sources.filter((each: SourceFile): boolean => {
        return builderCalls(each.source).length > 0;
      }).length,
    ).toBeGreaterThan(30);
  });

  test("writes no WhatsApp message by hand without a template", () => {
    const withoutTemplate: Array<string> = [];

    for (const each of sources) {
      for (const literal of whatsAppMessageLiterals(each.source)) {
        if (!literal.includes("templateKey")) {
          withoutTemplate.push(`${each.file}: ${literal.slice(0, 80)}`);
        }
      }
    }

    expect(withoutTemplate).toEqual([]);
  });

  test("finds the hand-written ones it checks: a verification code, a test message, a message sent on request", () => {
    const checked: Array<string> = sources
      .filter((each: SourceFile): boolean => {
        return whatsAppMessageLiterals(each.source).length > 0;
      })
      .map((each: SourceFile): string => {
        return each.file;
      });

    expect(checked).toEqual(
      expect.arrayContaining([
        "Common/Server/Services/UserWhatsAppService.ts",
        "App/FeatureSet/Notification/API/WhatsApp.ts",
      ]),
    );
  });

  test("builds every event's WhatsApp message from that event's approved template, never one picked by hand", () => {
    const pickedByHand: Array<string> = [];

    for (const each of sources) {
      if (each.file === BUILDER) {
        continue;
      }

      for (const call of builderCalls(each.source)) {
        if (!/\beventType\b/.test(call) || /\btemplateKey\s*:/.test(call)) {
          pickedByHand.push(`${each.file}: ${call.replace(/\s+/g, " ")}`);
        }
      }
    }

    expect(pickedByHand).toEqual([]);
  });

  test.each(
    (
      Object.keys(WHATSAPP_TEMPLATE_BY_EVENT_TYPE) as Array<
        keyof typeof NotificationSettingEventType | string
      >
    ).map((value: string): [string, NotificationSettingEventType] => {
      const name: string = Object.keys(NotificationSettingEventType).find(
        (key: string): boolean => {
          return (
            (NotificationSettingEventType as unknown as Record<string, string>)[
              key
            ] === value
          );
        },
      )!;

      return [name, value as NotificationSettingEventType];
    }),
  )(
    "builds a WhatsApp message for %s, which Notification Settings offers WhatsApp for",
    (name: string, eventType: NotificationSettingEventType) => {
      expect(hasWhatsAppTemplate(eventType)).toBe(true);

      const builtIn: Array<string> = sources
        .filter((each: SourceFile): boolean => {
          return (
            each.file !== BUILDER &&
            builderCalls(each.source).length > 0 &&
            new RegExp(`NotificationSettingEventType\\.${name}\\b`).test(
              each.source,
            )
          );
        })
        .map((each: SourceFile): string => {
          return each.file;
        });

      expect({ event: name, builtIn: builtIn.length > 0 }).toEqual({
        event: name,
        builtIn: true,
      });
    },
  );

  test.each(FORMER_PLAIN_BODY_SENDERS)(
    "%s hands WhatsApp no message: its events have no approved template",
    (file: string) => {
      const sender: SourceFile | undefined = sources.find(
        (each: SourceFile): boolean => {
          return each.file === file;
        },
      );

      expect(sender).toBeDefined();
      expect(sender!.source).not.toMatch(/whatsAppMessage\s*[:=]/);
      expect(sender!.source).not.toContain("WhatsAppMessagePayload");
    },
  );

  test("sendUserNotification skips a WhatsApp message with no template, as it skips a missing one", () => {
    const service: string = sources.find((each: SourceFile): boolean => {
      return (
        each.file === "Common/Server/Services/UserNotificationSettingService.ts"
      );
    })!.source;

    expect(service).toContain("if (!data.whatsAppMessage?.templateKey) {");
  });
});

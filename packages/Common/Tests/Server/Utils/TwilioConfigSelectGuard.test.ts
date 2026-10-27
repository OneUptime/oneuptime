import GlobalConfig from "../../../Models/DatabaseModels/GlobalConfig";
import ProjectCallSMSConfig from "../../../Models/DatabaseModels/ProjectCallSMSConfig";
import { getTableColumns } from "../../../Types/Database/TableColumn";
import {
  GLOBAL_CALL_AND_SMS_GATEWAY_SELECT,
  GLOBAL_TWILIO_CONFIG_SELECT,
  GLOBAL_TWILIO_CONFIG_USE_SELECT,
  PROJECT_TWILIO_CONFIG_SELECT,
  PROJECT_TWILIO_CONFIG_USE_SELECT,
} from "../../../Server/Utils/TwilioConfigSelect";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * EVERY READ OF A TWILIO CONFIG TO SEND THROUGH IT READS EVERY NUMBER IT
 * SENDS FROM.
 *
 * Once a config lists SMS numbers, every SMS goes out from one of them
 * instead of its primary and secondary numbers - for numbers that can only
 * make calls, such as a Singapore national number. A reader that listed the
 * config's columns by hand, as every reader did, and left the SMS column out
 * would hand the sender a config without them: every SMS would go out from
 * the number set aside for calls, and Twilio would refuse each one. So the
 * server reads a config only through TwilioConfigSelect's two column lists,
 * and this holds every server file to it:
 *
 *   - no file but TwilioConfigSelect selects a Twilio number column by hand;
 *   - each list names every Twilio column its model has, so a number column
 *     added later is read wherever a config is - and what the config is
 *     used for (calls and SMS, SMS only or calls only), without which a
 *     config used for SMS only would be read as one for calls and SMS,
 *     which it cannot be: it has no number to make calls from;
 *   - the lists a write's check reads (what a config is used for and the
 *     numbers that takes, TwilioConfigWrite) hold no credential.
 */

// packages/Common/Tests/Server/Utils -> packages/
const PACKAGES_DIR: string = path.resolve(__dirname, "..", "..", "..", "..");

const SCAN_ROOTS: Array<string> = [
  "Common/Server",
  "App/FeatureSet/Notification",
  "App/FeatureSet/Workers",
  "App/FeatureSet/BaseAPI",
];

const SELECT_FILE: string = "Common/Server/Utils/TwilioConfigSelect.ts";

// The columns a config's numbers are kept in.
const NUMBER_COLUMNS: Array<string> = [
  "twilioPrimaryPhoneNumber",
  "twilioSecondaryPhoneNumbers",
  "twilioSmsPhoneNumbers",
];

function listTypeScriptFiles(directory: string): Array<string> {
  const found: Array<string> = [];

  if (!fs.existsSync(directory)) {
    return found;
  }

  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === "build") {
      continue;
    }

    const fullPath: string = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      found.push(...listTypeScriptFiles(fullPath));
    } else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".d.ts")) {
      found.push(fullPath);
    }
  }

  return found;
}

interface ServerFile {
  file: string;
  source: string;
}

const SERVER_FILES: Array<ServerFile> = SCAN_ROOTS.flatMap(
  (root: string): Array<ServerFile> => {
    return listTypeScriptFiles(path.join(PACKAGES_DIR, root)).map(
      (filePath: string): ServerFile => {
        return {
          file: path.relative(PACKAGES_DIR, filePath).split(path.sep).join("/"),
          source: fs.readFileSync(filePath, "utf8"),
        };
      },
    );
  },
);

// The places a file selects one of the number columns by hand.
function handSelects(serverFile: ServerFile): Array<string> {
  const found: Array<string> = [];

  for (const column of NUMBER_COLUMNS) {
    const selected: string = `${column}: true`;
    let index: number = serverFile.source.indexOf(selected);

    while (index !== -1) {
      const line: number = serverFile.source.slice(0, index).split("\n").length;
      found.push(`${serverFile.file}:${line} ${column}`);
      index = serverFile.source.indexOf(selected, index + selected.length);
    }
  }

  return found;
}

function twilioColumnsOf(
  model: ProjectCallSMSConfig | GlobalConfig,
): Array<string> {
  return Object.keys(getTableColumns(model))
    .filter((column: string): boolean => {
      return column.startsWith("twilio");
    })
    .sort();
}

/*
 * What a config is used for: a project's config's own column, and the
 * server's account's Twilio column of it.
 */
const PROJECT_USE_COLUMN: string = "usedFor";
const GLOBAL_USE_COLUMN: string = "twilioUsedFor";

// Every list TwilioConfigSelect exports, and how many number columns each names.
const ALL_LISTS: Array<Record<string, unknown>> = [
  PROJECT_TWILIO_CONFIG_SELECT,
  GLOBAL_TWILIO_CONFIG_SELECT,
  PROJECT_TWILIO_CONFIG_USE_SELECT,
  GLOBAL_TWILIO_CONFIG_USE_SELECT,
  GLOBAL_CALL_AND_SMS_GATEWAY_SELECT,
] as Array<Record<string, unknown>>;

// The columns of what carries the server's SMS and calls, and its gateway.
const GATEWAY_COLUMN_PREFIX: string = "callAndSms";

function numberColumnsNamedBy(list: Record<string, unknown>): number {
  return NUMBER_COLUMNS.filter((column: string): boolean => {
    return list[column] === true;
  }).length;
}

describe("the server's reads of a Twilio config", () => {
  test("are really read", () => {
    expect(SERVER_FILES.length).toBeGreaterThan(500);
    expect(
      SERVER_FILES.some((serverFile: ServerFile): boolean => {
        return serverFile.file === SELECT_FILE;
      }),
    ).toBe(true);
    // The selects themselves are found where they are.
    expect(
      handSelects(
        SERVER_FILES.find((serverFile: ServerFile): boolean => {
          return serverFile.file === SELECT_FILE;
        })!,
      ).length,
    ).toBe(
      ALL_LISTS.reduce((count: number, list: Record<string, unknown>) => {
        return count + numberColumnsNamedBy(list);
      }, 0),
    );
    expect(numberColumnsNamedBy(PROJECT_TWILIO_CONFIG_SELECT)).toBe(
      NUMBER_COLUMNS.length,
    );
  });

  test("select a config's numbers only through TwilioConfigSelect", () => {
    expect(
      SERVER_FILES.filter((serverFile: ServerFile): boolean => {
        return serverFile.file !== SELECT_FILE;
      }).flatMap(handSelects),
    ).toEqual([]);
  });

  test("the readers that send - the project default, status pages, test sends, incoming calls and the server's own - use the lists", () => {
    const uses: Record<string, string> = {
      "Common/Server/Services/ProjectCallSMSConfigService.ts":
        "PROJECT_TWILIO_CONFIG_SELECT",
      "Common/Server/Services/StatusPageSubscriberService.ts":
        "PROJECT_TWILIO_CONFIG_SELECT",
      "App/FeatureSet/Notification/API/SMS.ts": "PROJECT_TWILIO_CONFIG_SELECT",
      "App/FeatureSet/Notification/API/Call.ts": "PROJECT_TWILIO_CONFIG_SELECT",
      "App/FeatureSet/Notification/Utils/TwilioConfigHelper.ts":
        "PROJECT_TWILIO_CONFIG_SELECT",
      "App/FeatureSet/Notification/Config.ts": "GLOBAL_TWILIO_CONFIG_SELECT",
      "Common/Server/Utils/TwilioAccountAvailability.ts":
        "GLOBAL_TWILIO_CONFIG_SELECT",
    };

    for (const [file, list] of Object.entries(uses)) {
      const serverFile: ServerFile | undefined = SERVER_FILES.find(
        (candidate: ServerFile): boolean => {
          return candidate.file === file;
        },
      );

      expect({ file, uses: serverFile?.source.includes(list) }).toEqual({
        file,
        uses: true,
      });
    }

    // Both of the status page reads: the senders' one and the sign-up one.
    expect(
      SERVER_FILES.find((serverFile: ServerFile): boolean => {
        return (
          serverFile.file ===
          "Common/Server/Services/StatusPageSubscriberService.ts"
        );
      })!.source.split("callSmsConfig: PROJECT_TWILIO_CONFIG_SELECT").length -
        1,
    ).toBe(2);
  });
});

describe("TwilioConfigSelect's lists", () => {
  test("a project's names every Twilio column of ProjectCallSMSConfig", () => {
    const listed: Array<string> = Object.keys(PROJECT_TWILIO_CONFIG_SELECT)
      .filter((column: string): boolean => {
        return column.startsWith("twilio");
      })
      .sort();

    expect(listed).toEqual(twilioColumnsOf(new ProjectCallSMSConfig()));
    expect(listed).toEqual(expect.arrayContaining(NUMBER_COLUMNS));
    expect(PROJECT_TWILIO_CONFIG_SELECT._id).toBe(true);
  });

  test("the server's names every Twilio column of GlobalConfig", () => {
    const listed: Array<string> = Object.keys(GLOBAL_TWILIO_CONFIG_SELECT)
      .filter((column: string): boolean => {
        return column.startsWith("twilio");
      })
      .sort();

    expect(listed).toEqual(twilioColumnsOf(new GlobalConfig()));
    expect(listed).toEqual(expect.arrayContaining(NUMBER_COLUMNS));
  });

  /*
   * The same columns, but for what a config is used for: a project's
   * config keeps it as usedFor - its own, beside its name - and the server's
   * account, whose GlobalConfig holds every other setting of the server, as
   * twilioUsedFor.
   */
  test("the two models keep the same Twilio columns, and each says what it is used for", () => {
    expect(
      twilioColumnsOf(new GlobalConfig()).filter((column: string): boolean => {
        return column !== GLOBAL_USE_COLUMN;
      }),
    ).toEqual(twilioColumnsOf(new ProjectCallSMSConfig()));

    const projectUse: unknown = getTableColumns(new ProjectCallSMSConfig())[
      PROJECT_USE_COLUMN
    ];
    const globalUse: unknown = getTableColumns(new GlobalConfig())[
      GLOBAL_USE_COLUMN
    ];

    expect(projectUse).toBeDefined();
    expect(globalUse).toBeDefined();
    // Both start where every config was: calls and SMS.
    expect((projectUse as { defaultValue: unknown }).defaultValue).toEqual(
      (globalUse as { defaultValue: unknown }).defaultValue,
    );
  });

  test("each list a sender reads names what the config is used for", () => {
    expect(PROJECT_TWILIO_CONFIG_SELECT[PROJECT_USE_COLUMN as "usedFor"]).toBe(
      true,
    );
    expect(
      GLOBAL_TWILIO_CONFIG_SELECT[GLOBAL_USE_COLUMN as "twilioUsedFor"],
    ).toBe(true);
  });

  /*
   * A write is checked against what the config is used for and the
   * numbers that takes - and nothing else is read for it: never the token.
   */
  test("the lists a write's check reads name the use and its numbers, and no credential", () => {
    expect(Object.keys(PROJECT_TWILIO_CONFIG_USE_SELECT).sort()).toEqual(
      [
        "_id",
        PROJECT_USE_COLUMN,
        "twilioPrimaryPhoneNumber",
        "twilioSmsPhoneNumbers",
      ].sort(),
    );
    expect(Object.keys(GLOBAL_TWILIO_CONFIG_USE_SELECT).sort()).toEqual(
      [
        GLOBAL_USE_COLUMN,
        "twilioAccountSID",
        "twilioPrimaryPhoneNumber",
        "twilioSmsPhoneNumbers",
      ].sort(),
    );

    for (const list of [
      PROJECT_TWILIO_CONFIG_USE_SELECT,
      GLOBAL_TWILIO_CONFIG_USE_SELECT,
    ] as Array<Record<string, unknown>>) {
      expect(list["twilioAuthToken"]).toBeUndefined();
    }
  });

  /*
   * The server's own SMS and call gateway (Types/CallAndSMS/
   * CallAndSmsProvider) stands in for its Twilio account, so whatever reads
   * the account to send through it, or to ask whether it could, reads the
   * gateway's columns beside it - every one of them, from the one list.
   */
  test("the gateway's list names every gateway column of GlobalConfig, and no Twilio column", () => {
    const columns: Array<string> = Object.keys(
      getTableColumns(new GlobalConfig()),
    )
      .filter((column: string): boolean => {
        return column.startsWith(GATEWAY_COLUMN_PREFIX);
      })
      .sort();

    expect(columns).toEqual([
      "callAndSmsGatewaySecret",
      "callAndSmsGatewayUrl",
      "callAndSmsProvider",
    ]);
    expect(Object.keys(GLOBAL_CALL_AND_SMS_GATEWAY_SELECT).sort()).toEqual(
      columns,
    );
    expect(numberColumnsNamedBy(GLOBAL_CALL_AND_SMS_GATEWAY_SELECT)).toBe(0);
    expect(
      Object.keys(GLOBAL_CALL_AND_SMS_GATEWAY_SELECT).filter(
        (column: string): boolean => {
          return column.startsWith("twilio");
        },
      ),
    ).toEqual([]);
  });

  test("the readers of the server's account read its gateway through that list", () => {
    const sourceOf: (file: string) => string = (file: string): string => {
      return SERVER_FILES.find((serverFile: ServerFile): boolean => {
        return serverFile.file === file;
      })!.source;
    };

    // The gateway the senders send through, read in one place.
    expect(
      sourceOf("Common/Server/Utils/CallAndSmsGatewayConfig.ts"),
    ).toContain("select: GLOBAL_CALL_AND_SMS_GATEWAY_SELECT,");
    expect(sourceOf("App/FeatureSet/Notification/Config.ts")).toContain(
      "return await CallAndSmsGatewayConfig.getGateway();",
    );

    // Whether a verification code has somewhere to go: both lists, one read.
    expect(
      sourceOf("Common/Server/Utils/TwilioAccountAvailability.ts"),
    ).toContain(
      "...GLOBAL_TWILIO_CONFIG_SELECT,\n          ...GLOBAL_CALL_AND_SMS_GATEWAY_SELECT,",
    );
  });

  test("the services read the rows a write changes through those lists", () => {
    const sourceOf: (file: string) => string = (file: string): string => {
      return SERVER_FILES.find((serverFile: ServerFile): boolean => {
        return serverFile.file === file;
      })!.source;
    };

    expect(
      sourceOf("Common/Server/Services/ProjectCallSMSConfigService.ts"),
    ).toContain(
      "findRowsAndHoldUpdateToThem(\n      updateBy,\n      PROJECT_TWILIO_CONFIG_USE_SELECT,",
    );
    expect(sourceOf("Common/Server/Services/GlobalConfigService.ts")).toContain(
      "findRowsAndHoldUpdateToThem(\n      updateBy,\n      GLOBAL_TWILIO_CONFIG_USE_SELECT,",
    );
  });
});

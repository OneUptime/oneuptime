import GlobalConfig from "../../../Models/DatabaseModels/GlobalConfig";
import ProjectCallSMSConfig from "../../../Models/DatabaseModels/ProjectCallSMSConfig";
import { getTableColumns } from "../../../Types/Database/TableColumn";
import {
  GLOBAL_TWILIO_CONFIG_SELECT,
  PROJECT_TWILIO_CONFIG_SELECT,
} from "../../../Server/Utils/TwilioConfigSelect";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * EVERY READ OF A TWILIO CONFIG TO SEND THROUGH IT READS EVERY NUMBER IT
 * SENDS FROM.
 *
 * A config's SMS numbers take the place of its primary and secondary
 * numbers for SMS - for a primary number that can only make calls, such as
 * a Singapore national number. A reader that listed the config's columns by
 * hand, as every reader did, and left the SMS columns out would hand the
 * sender a config without them: every SMS would go out from the number set
 * aside for calls, and Twilio would refuse each one. So the server reads a
 * config only through TwilioConfigSelect's two column lists, and this holds
 * every server file to it:
 *
 *   - no file but TwilioConfigSelect selects a Twilio number column by hand;
 *   - each list names every Twilio column its model has, so a number column
 *     added later is read wherever a config is.
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
  "twilioSmsPhoneNumber",
  "twilioSmsSecondaryPhoneNumbers",
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
          file: path
            .relative(PACKAGES_DIR, filePath)
            .split(path.sep)
            .join("/"),
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

function twilioColumnsOf(model: object): Array<string> {
  return Object.keys(getTableColumns(model as ProjectCallSMSConfig))
    .filter((column: string): boolean => {
      return column.startsWith("twilio");
    })
    .sort();
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
    ).toBe(NUMBER_COLUMNS.length * 2);
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

  test("the two models keep the same Twilio columns", () => {
    expect(twilioColumnsOf(new GlobalConfig())).toEqual(
      twilioColumnsOf(new ProjectCallSMSConfig()),
    );
  });
});

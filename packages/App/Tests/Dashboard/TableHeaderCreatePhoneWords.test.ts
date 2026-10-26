import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import {
  PHONE_CREATE_VERBS,
  getCreateButtonPhoneVerb,
} from "Common/UI/Components/ModelTable/CreateButtonPhoneVerb";

/*
 * A table header's main button on a phone (CardButtonSchema.phoneTitle). It
 * shares its line with the ⋯ there, and "Create Scheduled Maintenance
 * Event" broke onto two lines beside it. A model table's own create button
 * says its verb alone on a phone (getCreateButtonPhoneVerb); a page that
 * builds its list's create button itself - the main button of its card:
 * NORMAL, with the Add icon - says so too, with phoneTitle. This finds
 * every such button in the Dashboard and holds it to that.
 */

const DASHBOARD_SRC: string = path.join(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Dashboard",
  "src",
);

function sourceFiles(directory: string): Array<string> {
  const files: Array<string> = [];

  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const full: string = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      files.push(...sourceFiles(full));
    } else if (entry.name.endsWith(".tsx")) {
      files.push(full);
    }
  }

  return files;
}

// The object literal a `title:` is in: from its "{" to the matching "}".
function enclosingObject(text: string, index: number): string {
  let depth: number = 0;
  let start: number = index;

  for (; start >= 0; start--) {
    const character: string = text[start]!;

    if (character === "}") {
      depth++;
    } else if (character === "{") {
      if (depth === 0) {
        break;
      }
      depth--;
    }
  }

  depth = 0;

  for (let end: number = start; end < text.length; end++) {
    const character: string = text[end]!;

    if (character === "{") {
      depth++;
    } else if (character === "}") {
      depth--;

      if (depth === 0) {
        return text.slice(start, end + 1);
      }
    }
  }

  return text.slice(start);
}

interface MainCreateButton {
  file: string;
  title: string;
  object: string;
}

const CREATE_TITLE: RegExp = /title: "((Create|Add|Invite|Connect) [^"]+)"/g;

function mainCreateButtons(): Array<MainCreateButton> {
  const found: Array<MainCreateButton> = [];

  for (const file of sourceFiles(DASHBOARD_SRC)) {
    const text: string = fs.readFileSync(file, "utf8");

    for (const match of text.matchAll(CREATE_TITLE)) {
      const object: string = enclosingObject(text, match.index!);

      // A card's main button: NORMAL, with the Add icon, and an onClick.
      if (
        object.includes("buttonStyle: ButtonStyleType.NORMAL") &&
        object.includes("icon: IconProp.Add") &&
        object.includes("onClick")
      ) {
        found.push({
          file: path.relative(DASHBOARD_SRC, file),
          title: match[1]!,
          object: object,
        });
      }
    }
  }

  return found;
}

describe("a list's own create button on a phone", () => {
  const buttons: Array<MainCreateButton> = mainCreateButtons();

  test("there are such buttons: the maintenance, monitor, alert, announcement and episode lists'", () => {
    const titles: Array<string> = buttons.map(
      (button: MainCreateButton): string => {
        return button.title;
      },
    );

    expect(titles).toEqual(
      expect.arrayContaining([
        "Create Scheduled Maintenance Event",
        "Create Monitor",
        "Create Alert",
        "Create Announcement",
        "Create Episode",
      ]),
    );
  });

  test("each one says its verb alone on a phone, as a model table's own does", () => {
    const without: Array<string> = buttons
      .filter((button: MainCreateButton): boolean => {
        const verb: string = button.title.split(" ")[0]!;

        return !button.object.includes(`phoneTitle: "${verb}"`);
      })
      .map((button: MainCreateButton): string => {
        return `${button.file}: ${button.title}`;
      });

    expect(without).toEqual([]);
  });

  test("a model table's own create button: the verb, for the verbs that read alone as one", () => {
    expect(PHONE_CREATE_VERBS).toEqual(["Create", "Add", "Invite", "Connect"]);
    expect(
      getCreateButtonPhoneVerb({ itemName: "Scheduled Maintenance Event" }),
    ).toBe("Create");
    expect(
      getCreateButtonPhoneVerb({ verb: "Declare", itemName: "Incident" }),
    ).toBeUndefined();
  });
});

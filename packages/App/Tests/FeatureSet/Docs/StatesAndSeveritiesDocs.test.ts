import {
  STATE_SETTINGS_COPY,
  StateSettingsSharedCopy,
} from "../../../FeatureSet/Dashboard/src/Components/StateSettings/StateSettingsCopy";
import { STATE_LISTS, StateListType } from "Common/Utils/StateOrder";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * The incident docs against the state and severity settings pages they
 * describe. Markdown is not compiled, so nothing else notices when the pages
 * change: the docs used to call the state page "an ordered list" that
 * appends new states at the end, with a note telling readers to ignore the
 * severity form's placeholders. They now describe the drag-ordered table -
 * where a new state lands, the Counts as column, the Built-in tag and its
 * locked Delete - in the words the page uses.
 */

const CONTENT_DIR: string = path.resolve(
  __dirname,
  "../../../FeatureSet/Docs/Content/en",
);

const read: (relativePath: string) => string = (
  relativePath: string,
): string => {
  return fs.readFileSync(path.join(CONTENT_DIR, relativePath), "utf8");
};

const STATES_DOC: string = read("incidents/states-and-severities.md");
const INDEX_DOC: string = read("incidents/index.md");
const SETTINGS_DOC: string = read("incidents/settings.md");

const INCIDENT_COPY: (typeof STATE_SETTINGS_COPY)[StateListType.IncidentState] =
  STATE_SETTINGS_COPY[StateListType.IncidentState];

describe("the states and severities page", () => {
  test("says where a new state goes, as the server puts it", () => {
    // The server's rule: a new state takes the resolved state's place.
    expect(STATE_LISTS[StateListType.IncidentState].insertAboveFlag).toBe(
      "isResolvedState",
    );

    expect(STATES_DOC).toContain("just above the resolved state");
    expect(INCIDENT_COPY.description).toContain(
      "just above the resolved state",
    );
  });

  test("says the rows are dragged, and that there is no number to type", () => {
    expect(STATES_DOC).toContain("Drag a row by its grip");
    expect(STATES_DOC).toContain("there is no order number to type");
  });

  test("names the Counts as column and its three values the way the page does", () => {
    expect(STATES_DOC).toContain(`**${INCIDENT_COPY.countsAs!.title}**`);

    for (const label of new Set(
      Object.values(INCIDENT_COPY.countsAs!.byBuiltIn),
    )) {
      expect(STATES_DOC).toContain(`**${label}**`);
    }
  });

  test("names the Built-in tag, and says built-in states keep their order and cannot be deleted", () => {
    expect(STATES_DOC).toContain(`**${StateSettingsSharedCopy.builtInTag}**`);
    expect(STATES_DOC).toContain("They keep their order.");
    expect(STATES_DOC).toContain("They cannot be deleted.");
  });

  test("no longer describes the old page", () => {
    expect(STATES_DOC).not.toContain("an ordered list sorted by `order`");
    expect(STATES_DOC).not.toContain("new states are appended at the end");
    expect(STATES_DOC).not.toContain("A note on the placeholders");
    expect(INDEX_DOC).not.toContain("appended to the end of the ordered list");
    expect(SETTINGS_DOC).not.toContain("everything after it shifts down");
  });

  test("says a severity is added at the end, most severe first", () => {
    // The server's rule: a severity has nowhere special to go.
    expect(
      STATE_LISTS[StateListType.IncidentSeverity].insertAboveFlag,
    ).toBeUndefined();

    expect(STATES_DOC).toContain("most severe first");
    expect(STATES_DOC).toContain("adds one at the end (the least severe)");
  });

  test("the overview and the settings page point at the same behaviour", () => {
    expect(INDEX_DOC).toContain("just above the resolved state");
    expect(INDEX_DOC).toContain("**Counts as**");
    expect(SETTINGS_DOC).toContain("just above the resolved state");
  });
});

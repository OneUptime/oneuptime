import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import {
  ALERT_EPISODE_TEMPLATE_DYNAMIC_VARIABLES,
  ALERT_EPISODE_TEMPLATE_STATIC_VARIABLES,
  ALERT_EPISODE_TEMPLATE_VARIABLE_GROUPS,
  INCIDENT_EPISODE_TEMPLATE_DYNAMIC_VARIABLES,
  INCIDENT_EPISODE_TEMPLATE_STATIC_VARIABLES,
  INCIDENT_EPISODE_TEMPLATE_VARIABLE_GROUPS,
} from "../../../Utils/Episode/EpisodeTemplateVariables";
import {
  TemplateVariable,
  TemplateVariableGroup,
} from "../../../Types/Template/TemplateVariable";

/*
 * An incident or alert grouping rule's episode title and description
 * templates offer these variables under their fields. The grouping engines
 * fill them: four from the first incident (or alert) when the episode is
 * created, and the count again whenever one joins or leaves - every other
 * {{...}} is cleared. So a variable offered but not filled would vanish from
 * every episode title, and one filled but not offered is one nobody finds.
 * This reads the services that fill them.
 */

const SERVICES: string = path.resolve(__dirname, "../../../Server/Services");

// Every name a source replaces with /\{\{name\}\}/g.
function replacedIn(file: string): Array<string> {
  const source: string = fs.readFileSync(path.join(SERVICES, file), "utf8");

  return Array.from(
    new Set(
      Array.from(
        source.matchAll(/\/\\\{\\\{(\w+)\\\}\\\}\/g/g),
        (match: RegExpMatchArray): string => {
          return match[1]!;
        },
      ),
    ),
  ).sort();
}

function namesOf(variables: ReadonlyArray<TemplateVariable>): Array<string> {
  return variables.map((variable: TemplateVariable): string => {
    return variable.name;
  });
}

describe.each([
  [
    "incident",
    "IncidentGroupingEngineService.ts",
    "IncidentEpisodeService.ts",
    INCIDENT_EPISODE_TEMPLATE_STATIC_VARIABLES,
    INCIDENT_EPISODE_TEMPLATE_DYNAMIC_VARIABLES,
    INCIDENT_EPISODE_TEMPLATE_VARIABLE_GROUPS,
  ],
  [
    "alert",
    "AlertGroupingEngineService.ts",
    "AlertEpisodeService.ts",
    ALERT_EPISODE_TEMPLATE_STATIC_VARIABLES,
    ALERT_EPISODE_TEMPLATE_DYNAMIC_VARIABLES,
    ALERT_EPISODE_TEMPLATE_VARIABLE_GROUPS,
  ],
])(
  "the %s episode template variables",
  (
    kind: string,
    engine: string,
    episodeService: string,
    staticVariables: ReadonlyArray<TemplateVariable>,
    dynamicVariables: ReadonlyArray<TemplateVariable>,
    groups: ReadonlyArray<TemplateVariableGroup>,
  ) => {
    test("are exactly the ones the grouping engine fills", () => {
      expect(
        [...namesOf(staticVariables), ...namesOf(dynamicVariables)].sort(),
      ).toEqual(replacedIn(engine));
    });

    test("the count is the one the episode service fills again as members change", () => {
      expect(namesOf(dynamicVariables)).toEqual(replacedIn(episodeService));
      expect(namesOf(dynamicVariables)).toEqual([`${kind}Count`]);
    });

    test("are grouped by when they are filled: the first one's, then the count", () => {
      expect(groups).toHaveLength(2);
      expect(groups[0]!.title).toBe(`From the first ${kind}`);
      expect(groups[0]!.variables).toBe(staticVariables);
      expect(groups[1]!.title).toBe(`Updated as ${kind}s join`);
      expect(groups[1]!.variables).toBe(dynamicVariables);
    });

    test("each says what it holds, with nothing a translation would trip on", () => {
      for (const group of groups) {
        for (const variable of group.variables) {
          expect(variable.description.trim().length).toBeGreaterThan(0);
          expect(variable.description).not.toContain("{{");
        }
      }
    });
  },
);

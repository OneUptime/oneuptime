// UX rule: Docs/ux/README.md#in-every-language
import { describe, expect, test } from "@jest/globals";
import {
  DropdownOptionSite,
  readAllDropdownOptionSites,
  readDropdownOptionSites,
} from "../../DropdownOptionNames";

/*
 * A PICKER'S OPTION THAT DRAWS A NAME SAYS HOW THE NAME READS (#8065).
 *
 * A Dropdown looks an option's label up in the reader's language unless the
 * option says it is drawn as written (DropdownOption.isUserContent), as it
 * should for the product's words ("Production", "Every day"). Options built
 * by hand from records said nothing, so the Dropdown looked the record's
 * name up too: a team or a label named "Network" read "Red" on a Spanish
 * page, a state a project named "Open" the verb "Abrir". An option whose
 * label is a name now says how it reads, with isUserContent:
 *
 *   - a record's name its owner gave - a team's, a probe's, a template's,
 *     a monitor's - is drawn as written (true);
 *   - a state's, a severity's or a status's name reads by the one rule for
 *     them (Common/Utils/DefaultRecordNames.isRecordNameAsWritten):
 *     OneUptime's default names looked up, the project's own as written;
 *   - a label the page already put in the reader's words - a sentence
 *     with a name in it - is drawn as given (true), never looked up again.
 *
 * DropdownUtil.getDropdownOptionsFromEntityArray decides each option it
 * builds by this rule already, and EntityDropdown decides each entry of a
 * record's table by it (RecordNamesInPickersInSpanish draws both). This
 * reads every option the front ends build by hand (DropdownOptionNames) and
 * fails on one whose label reads a name and does not say how it reads.
 */

const FILE: string =
  "packages/App/FeatureSet/Dashboard/src/Components/Snippet/Snippet.tsx";

const IMPORTS: string = `
import Dropdown, { DropdownOption } from "Common/UI/Components/Dropdown/Dropdown";
import EntityDropdown from "Common/UI/Components/EntityDropdown/EntityDropdown";
`;

function sitesOf(body: string): Array<DropdownOptionSite> {
  return readDropdownOptionSites(FILE, `${IMPORTS}\n${body}`);
}

function onlySiteOf(body: string): DropdownOptionSite {
  const sites: Array<DropdownOptionSite> = sitesOf(body);

  expect(sites).toHaveLength(1);

  return sites[0]!;
}

describe("the reader finds an option by its place", () => {
  test.each([
    [
      "a typed variable",
      `const option: DropdownOption = { value: team.id, label: team.name };`,
    ],
    [
      "a typed list",
      `const options: Array<DropdownOption> = [{ value: team.id, label: team.name }];`,
    ],
    [
      "a map's callback with its return type",
      `const options = teams.map((team: Team): DropdownOption => {
        return { value: team.id, label: team.name || "" };
      });`,
    ],
    [
      "a map's callback with no return type, into a typed list",
      `const options: Array<DropdownOption> = teams.map((team: Team) => ({
        value: team.id,
        label: team.name,
      }));`,
    ],
    [
      "a filtered map, into a typed list",
      `const options: Array<DropdownOption> = teams
        .map((team: Team) => {
          return { value: team.id, label: team.name };
        })
        .filter(Boolean);`,
    ],
    [
      "a push onto a typed list",
      `function f(): void {
        const options: Array<DropdownOption> = [];
        options.push({ value: team.id, label: team.name });
      }`,
    ],
    [
      "a form field's dropdownOptions",
      `const field = { dropdownOptions: [{ value: team.id, label: team.name }] };`,
    ],
    [
      "a filter's filterDropdownOptions",
      `const column = { filterDropdownOptions: teams.map((team: Team) => {
        return { value: team.id, label: team.name };
      }) };`,
    ],
    [
      "a dropdownOptions assigned later",
      `field.dropdownOptions = teams.map((team: Team) => {
        return { value: team.id, label: team.name };
      });`,
    ],
    [
      "a Dropdown's options",
      `const x = (<Dropdown options={[{ value: team.id, label: team.name }]} />);`,
    ],
    [
      "an EntityDropdown's options",
      `const x = (<EntityDropdown options={teams.map((team: Team) => {
        return { value: team.id, label: team.name };
      })} />);`,
    ],
    [
      "an as",
      `const x = { value: team.id, label: team.name } as DropdownOption;`,
    ],
    [
      "a typed function's return",
      `function toOption(team: Team): DropdownOption {
        return { value: team.id, label: team.name };
      }`,
    ],
    [
      "a group's options",
      `const groups: Array<DropdownOptionGroup> = kinds.map((kind: Kind) => {
        return {
          label: kind,
          options: teams.map((team: Team) => {
            return { value: team.id, label: team.name };
          }),
        };
      });`,
    ],
  ])("%s", (_place: string, body: string) => {
    expect(onlySiteOf(body)).toMatchObject({
      readsName: true,
      isMarked: false,
    });
  });

  test.each([
    [
      "a filter chip's option, which draws its label itself",
      `const options: Array<FilterChipDropdownOption> = [{ value: s.id, label: s.name }];`,
    ],
    [
      "a chart's point",
      `const points: Array<ChartPoint> = [{ value: 3, label: monitor.name }];`,
    ],
    [
      "an object with no value",
      `const group: DropdownOption = { label: team.name } as never;`,
    ],
    [
      "a Dropdown of another module's",
      `import Picker from "./Picker";
       const x = (<Picker options={[{ value: team.id, label: team.name }]} />);`,
    ],
  ])("leaves alone %s", (_what: string, body: string) => {
    expect(sitesOf(body)).toEqual([]);
  });
});

describe("the reader tells a name from the product's words", () => {
  test.each([
    ["label: team.name"],
    ['label: state["name"]'],
    ['label: label.getColumnValue("name") as string'],
    ["label: option.severityName"],
    ["label: readName(team)"],
    ["label: `${probe.name} (${probe.region})`"],
    [
      'label: translator.translateTemplate("{{name}} (global)", { name: probe.name })',
    ],
  ])("%s reads a name", (label: string) => {
    expect(
      onlySiteOf(`const option: DropdownOption = { value: "1", ${label} };`)
        .readsName,
    ).toBe(true);
  });

  test.each([
    ['label: "Every day"'],
    ['label: isOn ? "On" : "Off"'],
    ["label: LABELS[kind]"],
    ['label: translationKey("Production")'],
  ])("%s does not", (label: string) => {
    expect(
      onlySiteOf(`const option: DropdownOption = { value: "1", ${label} };`)
        .readsName,
    ).toBe(false);
  });

  test("follows a variable to what it is set to", () => {
    expect(
      onlySiteOf(`
        function f(): DropdownOption {
          const label: string = team.name || "Unnamed team";
          return { value: team.id, label };
        }
      `).readsName,
    ).toBe(true);
  });
});

describe("an option that says how its name reads is marked, whichever way", () => {
  test.each([
    ["isUserContent: true"],
    ["isUserContent: false"],
    [
      "isUserContent: isRecordNameAsWritten(StateListType.IncidentState, state.name)",
    ],
    ["...rest"],
  ])("%s", (mark: string) => {
    expect(
      onlySiteOf(
        `const option: DropdownOption = { value: state.id, label: state.name, ${mark} };`,
      ),
    ).toMatchObject({ readsName: true, isMarked: true });
  });
});

describe("the front ends", () => {
  const sites: Array<DropdownOptionSite> = readAllDropdownOptionSites();

  test("build hundreds of options by hand, so the reader is reading them", () => {
    expect(sites.length).toBeGreaterThan(400);
    expect(
      sites.filter((site: DropdownOptionSite): boolean => {
        return site.readsName;
      }).length,
    ).toBeGreaterThan(100);
  });

  test("every option whose label reads a name says how the name reads", () => {
    const unmarked: Array<string> = sites
      .filter((site: DropdownOptionSite): boolean => {
        return site.readsName && !site.isMarked;
      })
      .map((site: DropdownOptionSite): string => {
        return `${site.file}:${site.line} label: ${site.label}`;
      });

    expect(unmarked).toEqual([]);
  });
});

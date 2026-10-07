import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import ts from "typescript";
import { FormFacts, scanFormFiles } from "../../../Helpers/FormStepsScan";

/*
 * "Please also find similar issues across the project and fix them as
 * well. The idea is to make software as simple as possible to use and
 * reduce decision paralysis." - the maintainer.
 *
 * Incident roles were assigned four ways. Declare Incident had one card per
 * role (IncidentRoleFormField). A monitor rule's incident drew a dropdown of
 * its own per role, a multi-select tagged "Multiple" for some roles. A
 * grouping rule's episode roles were a copy of the declare form's cards with
 * a "Multiple" tag of their own, and the incident's Roles card tagged roles
 * "Multiple" too. Whether a role takes more than one person is a setting
 * folded under More fields on the role (Allow Multiple Users); where it
 * matters, a form shows it by keeping the role's picker after the first
 * pick, and the Roles card by offering Add More. And incident templates
 * prefilled their Initial Incident State with the first state by order,
 * where Declare Incident had stopped prefilling one.
 *
 * Now:
 *
 *   1. No form or card tags a role "Multiple", or draws anything just
 *      because a role takes several people.
 *   2. A role with a people picker for it is drawn in two places only: the
 *      role picker every form uses (IncidentRoleFormField) and the Roles
 *      card of an incident or episode (Common MemberRoleAssignment). Every
 *      form that assigns incident roles draws the picker - the monitor rule
 *      and the grouping rule through adapters that keep the rows they
 *      always stored.
 *   3. No template or declare form seeds the state a record starts in:
 *      left empty, the server starts it in the project's starting state.
 *
 * Read from source, through the TypeScript syntax tree, across the
 * Dashboard, the shared UI, the Admin Dashboard and Enterprise (when it is
 * checked out: CI's Common job runs without ee/).
 */

// packages/Common/Tests/UI/Components/Forms -> the repository root.
const REPOSITORY_ROOT: string = path.resolve(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "..",
  "..",
);

const DASHBOARD: string = "packages/App/FeatureSet/Dashboard/src";

const SCANNED_ROOTS: Array<string> = [
  DASHBOARD,
  "packages/Common/UI",
  "packages/App/FeatureSet/AdminDashboard/src",
  "ee/Dashboard",
  "ee/AdminDashboard",
];

// The one role picker, and the Roles card of an incident or an episode.
const ROLE_PICKER: string = `${DASHBOARD}/Components/Incident/IncidentRoleFormField.tsx`;
const ROLES_CARD: string =
  "packages/Common/UI/Components/MemberRoleAssignment/MemberRoleAssignment.tsx";

// What a role's people are picked with.
const PEOPLE_PICKERS: ReadonlySet<string> = new Set<string>([
  "Dropdown",
  "EntityDropdown",
  "MultiSelectDropdown",
  "PeoplePicker",
  "OwnersPicker",
  "PeopleSearchPopup",
]);

// A condition on whether a role takes several people.
const TAKES_SEVERAL_PEOPLE: RegExp = /\bcanAssignMultipleUsers\b/;

// A .map callback's parameter that is a role: named one, or typed as one.
const ROLE_PARAMETER_NAME: RegExp = /role/i;
const ROLE_PARAMETER_TYPE: RegExp = /Role/;

// A function that looks a record's first state up, to start a form with it.
const FIRST_STATE_LOOKUP: RegExp = /fetchFirst\w*State|getFirst\w*StateId/;

// A template's create or edit page, under a product's Settings.
const TEMPLATE_PAGE: RegExp = /\/Settings\/\w*Templates?(View)?\.tsx$/;

// The calls a string is looked up through before it is shown.
const LOOKUPS: ReadonlySet<string> = new Set<string>([
  "translateText",
  "translateString",
  "translateTerm",
  "translationKey",
  "t",
  "tx",
]);

function listSourceFiles(directory: string): Array<string> {
  const found: Array<string> = [];

  if (!fs.existsSync(directory)) {
    return found;
  }

  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const full: string = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === "build") {
        continue;
      }

      found.push(...listSourceFiles(full));
      continue;
    }

    if (
      (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) &&
      !entry.name.endsWith(".d.ts")
    ) {
      found.push(full);
    }
  }

  return found;
}

function toRepositoryPath(file: string): string {
  return path.relative(REPOSITORY_ROOT, file).split(path.sep).join("/");
}

interface SourceUnderTest {
  // Repository-relative, with forward slashes.
  file: string;
  text: string;
}

const SOURCES: Array<SourceUnderTest> = SCANNED_ROOTS.flatMap(
  (root: string): Array<SourceUnderTest> => {
    return listSourceFiles(path.join(REPOSITORY_ROOT, root)).map(
      (file: string): SourceUnderTest => {
        return {
          file: toRepositoryPath(file),
          text: fs.readFileSync(file, "utf8"),
        };
      },
    );
  },
);

function parse(source: SourceUnderTest): ts.SourceFile {
  return ts.createSourceFile(
    source.file,
    source.text,
    ts.ScriptTarget.Latest,
    true,
    source.file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
}

function lineOf(sourceFile: ts.SourceFile, node: ts.Node): number {
  return (
    sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1
  );
}

function visit(node: ts.Node, onNode: (node: ts.Node) => void): void {
  onNode(node);
  ts.forEachChild(node, (child: ts.Node) => {
    visit(child, onNode);
  });
}

function containsJsx(node: ts.Node): boolean {
  let found: boolean = false;

  visit(node, (child: ts.Node) => {
    if (
      ts.isJsxElement(child) ||
      ts.isJsxSelfClosingElement(child) ||
      ts.isJsxFragment(child)
    ) {
      found = true;
    }
  });

  return found;
}

function calleeName(call: ts.CallExpression): string {
  const callee: ts.Expression = call.expression;

  if (ts.isIdentifier(callee)) {
    return callee.text;
  }

  if (ts.isPropertyAccessExpression(callee)) {
    return callee.name.text;
  }

  return "";
}

/*
 * 1. "Multiple" tags: the word shown as an element's text or looked up to
 * be shown, and anything drawn only because a role takes several people
 * (`{role.canAssignMultipleUsers && <span>...</span>}`, or a condition on
 * it that picks what to draw).
 */
export function findMultipleRoleTags(source: SourceUnderTest): Array<string> {
  const sourceFile: ts.SourceFile = parse(source);
  const found: Array<string> = [];

  visit(sourceFile, (node: ts.Node) => {
    if (ts.isJsxText(node) && node.text.trim() === "Multiple") {
      found.push(
        `${source.file}:${lineOf(sourceFile, node)}: shows the word Multiple`,
      );
    }

    if (
      ts.isCallExpression(node) &&
      LOOKUPS.has(calleeName(node)) &&
      node.arguments[0] &&
      ts.isStringLiteralLike(node.arguments[0]) &&
      node.arguments[0].text === "Multiple"
    ) {
      found.push(
        `${source.file}:${lineOf(sourceFile, node)}: looks up the word Multiple to show it`,
      );
    }

    // Something drawn only for a role that takes several people.
    let condition: ts.Expression | undefined;
    let drawn: Array<ts.Node> = [];

    if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken
    ) {
      condition = node.left;
      drawn = [node.right];
    } else if (ts.isConditionalExpression(node)) {
      condition = node.condition;
      drawn = [node.whenTrue, node.whenFalse];
    }

    if (
      condition &&
      TAKES_SEVERAL_PEOPLE.test(condition.getText(sourceFile)) &&
      drawn.some((branch: ts.Node): boolean => {
        return containsJsx(branch);
      })
    ) {
      found.push(
        `${source.file}:${lineOf(sourceFile, node)}: draws something because a role takes several people`,
      );
    }
  });

  return found;
}

/*
 * 2. Role rows: a `.map` over roles whose callback draws a people picker -
 * a role with a picker for who takes it. The callback's parameter is a
 * role: named one, or typed as one.
 */
export function findRoleRowsWithPeoplePickers(
  source: SourceUnderTest,
): Array<string> {
  const sourceFile: ts.SourceFile = parse(source);
  const found: Array<string> = [];

  visit(sourceFile, (node: ts.Node) => {
    if (
      !ts.isCallExpression(node) ||
      !ts.isPropertyAccessExpression(node.expression) ||
      node.expression.name.text !== "map"
    ) {
      return;
    }

    const callback: ts.Expression | undefined = node.arguments[0];

    if (
      !callback ||
      !(ts.isArrowFunction(callback) || ts.isFunctionExpression(callback))
    ) {
      return;
    }

    const parameter: ts.ParameterDeclaration | undefined =
      callback.parameters[0];

    if (!parameter) {
      return;
    }

    const isRole: boolean =
      ROLE_PARAMETER_NAME.test(parameter.name.getText(sourceFile)) ||
      ROLE_PARAMETER_TYPE.test(parameter.type?.getText(sourceFile) || "");

    if (!isRole) {
      return;
    }

    const pickers: Array<string> = [];

    visit(callback.body, (child: ts.Node) => {
      const tag: ts.JsxTagNameExpression | undefined =
        ts.isJsxOpeningElement(child) || ts.isJsxSelfClosingElement(child)
          ? child.tagName
          : undefined;

      if (tag && PEOPLE_PICKERS.has(tag.getText(sourceFile))) {
        pickers.push(tag.getText(sourceFile));
      }
    });

    if (pickers.length > 0) {
      found.push(
        `${source.file}:${lineOf(sourceFile, node)}: draws a ${pickers[0]} for each role`,
      );
    }
  });

  return found;
}

function sourceOf(file: string): SourceUnderTest {
  const source: SourceUnderTest | undefined = SOURCES.find(
    (candidate: SourceUnderTest): boolean => {
      return candidate.file === file;
    },
  );

  if (!source) {
    throw new Error(`${file} was not scanned`);
  }

  return source;
}

function dense(file: string): string {
  return sourceOf(file).text.replace(/\s+/g, " ");
}

/*
 * The text of the object literal written right around `marker` (a field's
 * `field: { x: true }`): from the `{` that opens the field to the `}` that
 * closes it. Throws rather than returning empty, so a marker that moved
 * cannot make a check pass vacuously.
 */
function fieldObjectAround(source: string, marker: string): string {
  const at: number = source.indexOf(marker);

  if (at < 0 || source.indexOf(marker, at + 1) >= 0) {
    throw new Error(`Expected exactly one ${marker}`);
  }

  let depth: number = 0;
  let start: number = -1;

  for (let index: number = at - 1; index >= 0; index--) {
    const character: string = source[index]!;

    if (character === "}") {
      depth++;
    } else if (character === "{") {
      if (depth === 0) {
        start = index;
        break;
      }

      depth--;
    }
  }

  if (start < 0) {
    throw new Error(`No field object opens before ${marker}`);
  }

  depth = 0;

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

  throw new Error(`The field object around ${marker} never closes`);
}

describe("the guard reads the code it guards", () => {
  test("it scans the Dashboard, the shared UI and the Admin Dashboard", () => {
    const files: Array<string> = SOURCES.map((source: SourceUnderTest) => {
      return source.file;
    });

    expect(files).toContain(ROLE_PICKER);
    expect(files).toContain(ROLES_CARD);
    expect(files).toContain(
      `${DASHBOARD}/Components/Form/Monitor/MonitorCriteriaIncidentForm.tsx`,
    );
    expect(
      files.some((file: string): boolean => {
        return file.startsWith("packages/App/FeatureSet/AdminDashboard/src/");
      }),
    ).toBe(true);
    expect(files.length).toBeGreaterThan(2000);
  });

  // The shapes the old pickers had, so a detector that stopped seeing them fails.
  test("it would have found the old Multiple tags", () => {
    const oldTags: SourceUnderTest = {
      file: "Old.tsx",
      text: `
        const A = () => {
          return (
            <div>
              {role.canAssignMultipleUsers && (
                <span className="text-xs">{translator.translateText("Multiple")}</span>
              )}
              <span>Multiple</span>
              {role.canAssignMultipleUsers ? <Dropdown isMultiSelect={true} /> : <Dropdown />}
            </div>
          );
        };
      `,
    };

    expect(findMultipleRoleTags(oldTags)).toEqual([
      "Old.tsx:5: draws something because a role takes several people",
      "Old.tsx:6: looks up the word Multiple to show it",
      "Old.tsx:8: shows the word Multiple",
      "Old.tsx:9: draws something because a role takes several people",
    ]);
  });

  test("it leaves a role's rule for its picker alone", () => {
    const rule: SourceUnderTest = {
      file: "Rule.tsx",
      text: `
        const canAddMore: boolean = role.canAssignMultipleUsers || members.length === 0;
        const choice = { canAssignMultipleUsers: Boolean(role.canAssignMultipleUsers) };
        const B = () => {
          return <div>{canAddMore && <button>Add More</button>}</div>;
        };
      `,
    };

    expect(findMultipleRoleTags(rule)).toEqual([]);
  });

  test("it would have found the old role rows", () => {
    const oldRows: SourceUnderTest = {
      file: "OldRows.tsx",
      text: `
        const C = () => {
          return (
            <div>
              {props.incidentRoleOptions.map((role: IncidentRoleOption) => {
                return <Dropdown options={users} />;
              })}
              {roles.map((item: RoleData) => {
                return <div><Dropdown options={users} /></div>;
              })}
              {roles.map((item: RoleData) => {
                return <RoleLabel name={item.name} />;
              })}
              {teams.map((team: Team) => {
                return <Dropdown options={users} />;
              })}
            </div>
          );
        };
      `,
    };

    expect(findRoleRowsWithPeoplePickers(oldRows)).toEqual([
      "OldRows.tsx:5: draws a Dropdown for each role",
      "OldRows.tsx:8: draws a Dropdown for each role",
    ]);
  });
});

describe("1. no form or card tags a role Multiple", () => {
  test("no source shows a Multiple tag, or draws anything because a role takes several people", () => {
    const found: Array<string> = SOURCES.flatMap(
      (source: SourceUnderTest): Array<string> => {
        return findMultipleRoleTags(source);
      },
    );

    expect(found).toEqual([]);
  });

  test("the picker and the Roles card still tag the primary roles", () => {
    expect(dense(ROLE_PICKER)).toContain('translator.translateText("Primary")');
    expect(dense(ROLES_CARD)).toContain('translator.translateText("Primary")');
  });

  test("the incident's Roles card no longer says one person per role", () => {
    const card: string = dense(
      `${DASHBOARD}/Components/Incident/IncidentMemberRoleAssignment.tsx`,
    );

    expect(card).toContain(
      'description="Who takes each role on this incident."',
    );
    expect(card).not.toMatch(/one (team )?member per role/i);
    expect(card).not.toMatch(/one person per role/i);
  });
});

describe("2. roles are assigned with one picker", () => {
  test("only the picker and the Roles card draw a people picker for each role", () => {
    const found: Array<string> = SOURCES.flatMap(
      (source: SourceUnderTest): Array<string> => {
        return findRoleRowsWithPeoplePickers(source);
      },
    );

    expect(
      Array.from(
        new Set(
          found.map((entry: string): string => {
            return entry.split(":")[0]!;
          }),
        ),
      ).sort(),
    ).toEqual([ROLE_PICKER, ROLES_CARD].sort());
  });

  /*
   * Every component that holds a role assignment value - a monitor rule's
   * incidentMemberRoles, a grouping rule's episodeMemberRoleAssignments,
   * the picker's RoleAssignment - draws the picker, one of its adapters, or
   * only shows the value.
   */
  const SHOWS_ROLE_ASSIGNMENTS_READ_ONLY: Record<string, string> = {
    [`${DASHBOARD}/Components/IncidentRole/FetchIncidentRoleAssignments.tsx`]:
      "the declare and episode forms' review step: each role with its people, read only",
    [`${DASHBOARD}/Components/Monitor/MonitorSteps/MonitorCriteriaIncident.tsx`]:
      "a monitor rule's read-only view: the people it names for each role",
  };

  const DRAWS_THE_PICKER: RegExp =
    /<(IncidentRoleFormField|IncidentEpisodeRoleFormField|EpisodeMemberRoleAssignmentsFormField)\b/;

  const HOLDS_ROLE_ASSIGNMENTS: RegExp =
    /\b(incidentMemberRoles|episodeMemberRoleAssignments|RoleAssignment)\b/;

  test("every component that holds role assignments draws the one picker, or only shows them", () => {
    const holders: Array<SourceUnderTest> = SOURCES.filter(
      (source: SourceUnderTest): boolean => {
        return (
          source.file.endsWith(".tsx") &&
          source.file !== ROLE_PICKER &&
          HOLDS_ROLE_ASSIGNMENTS.test(source.text)
        );
      },
    );

    const misfits: Array<string> = holders
      .filter((source: SourceUnderTest): boolean => {
        return (
          !DRAWS_THE_PICKER.test(source.text) &&
          SHOWS_ROLE_ASSIGNMENTS_READ_ONLY[source.file] === undefined
        );
      })
      .map((source: SourceUnderTest): string => {
        return source.file;
      });

    expect(misfits).toEqual([]);

    // The forms that assign roles, found by the scan.
    expect(
      holders
        .filter((source: SourceUnderTest): boolean => {
          return DRAWS_THE_PICKER.test(source.text);
        })
        .map((source: SourceUnderTest): string => {
          return source.file;
        })
        .sort(),
    ).toEqual(
      expect.arrayContaining([
        `${DASHBOARD}/Pages/Incidents/Create.tsx`,
        `${DASHBOARD}/Pages/Incidents/EpisodeCreate.tsx`,
        `${DASHBOARD}/Components/Form/Monitor/MonitorCriteriaIncidentForm.tsx`,
        `${DASHBOARD}/Components/IncidentGroupingRule/EpisodeMemberRoleAssignmentsFormField.tsx`,
      ]),
    );
  });

  test("the read-only list names files that still hold role assignments", () => {
    for (const file of Object.keys(SHOWS_ROLE_ASSIGNMENTS_READ_ONLY)) {
      expect(
        `${file}: ${HOLDS_ROLE_ASSIGNMENTS.test(sourceOf(file).text)}`,
      ).toBe(`${file}: true`);
      expect(`${file}: ${DRAWS_THE_PICKER.test(sourceOf(file).text)}`).toBe(
        `${file}: false`,
      );
    }
  });

  test("a monitor rule's incident draws the picker with the roles and people it was handed, and keeps its rows", () => {
    const form: string = dense(
      `${DASHBOARD}/Components/Form/Monitor/MonitorCriteriaIncidentForm.tsx`,
    );

    expect(form).toContain("<IncidentRoleFormField");
    expect(form).toContain("roles={props.incidentRoleOptions}");
    expect(form).toContain("users={props.userDropdownOptions}");
    expect(form).toContain(
      "return criteriaRolesToAssignments(criteriaIncident.incidentMemberRoles);",
    );
    expect(form).toContain("initialValue={roleAssignments}");
    expect(form).toContain(
      'updateField( "incidentMemberRoles", assignmentsToCriteriaRoles(assignments), );',
    );
    // A row for a role the project no longer has does not count as set.
    expect(form).toContain(
      "keepKnownRoles(roleAssignments, props.incidentRoleOptions || []).length > 0;",
    );
    // Its own dropdown per role, and their words, are gone.
    expect(form).not.toContain("canAssignMultipleUsers");
    expect(form).not.toContain("Assign multiple users to the {{role}} role");
    expect(form).not.toContain("Assign a user to the {{role}} role");
    expect(form).not.toContain("Select {{role}}...");
  });

  test("the monitor form reads the roles once, with what the picker shows", () => {
    const steps: string = dense(
      `${DASHBOARD}/Components/Form/Monitor/MonitorSteps.tsx`,
    );

    expect(steps).toContain("modelType: IncidentRole,");
    expect(steps).toContain("select: INCIDENT_ROLE_CHOICE_SELECT,");
    expect(steps).toContain(
      "setIncidentRoleOptions(incidentRoleList.data.map(toIncidentRoleChoice));",
    );
  });

  test("a grouping rule's episode roles are the picker, reading and drawing nothing of their own", () => {
    const field: string = dense(
      `${DASHBOARD}/Components/IncidentGroupingRule/EpisodeMemberRoleAssignmentsFormField.tsx`,
    );

    expect(field).toContain("<IncidentRoleFormField");
    expect(field).toContain(
      "return episodeRolesToAssignments(props.initialValue);",
    );
    expect(field).toContain("initialValue={initialValue}");
    expect(field).toContain(
      "props.onChange?.(assignmentsToEpisodeRoles(assignments));",
    );

    for (const own of ["ModelAPI", "<Dropdown", "<RoleLabel", "useState"]) {
      expect(`${own}: ${field.includes(own)}`).toBe(`${own}: false`);
    }
  });

  test("incident episodes use the incident's picker, not a copy of it", () => {
    const episode: string = dense(
      `${DASHBOARD}/Components/IncidentEpisode/IncidentEpisodeRoleFormField.tsx`,
    );

    expect(episode).toContain("return <IncidentRoleFormField {...props} />;");
  });

  test("the picker reads what it shows of a role the one way every form does", () => {
    const picker: string = dense(ROLE_PICKER);

    expect(picker).toContain("select: INCIDENT_ROLE_CHOICE_SELECT,");
    expect(picker).toContain("rolesResult.data.map(toIncidentRoleChoice)");
    // A form that has the roles and the people hands them in.
    expect(picker).toContain("roles?: Array<IncidentRoleChoice> | undefined;");
    expect(picker).toContain("users?: Array<DropdownOption> | undefined;");
  });

  test("the picker says where roles are made when there are none, on every form", () => {
    const picker: string = dense(ROLE_PICKER);

    expect(picker).toContain(
      'translator.translateText( "No incident roles defined. Go to Incidents → Settings → Incident Roles to create roles first.", )',
    );
    expect(picker).not.toContain("No incident roles found.");
  });
});

describe("3. no template or declare form seeds the state a record starts in", () => {
  test("no source looks a first state up", () => {
    const found: Array<string> = SOURCES.filter(
      (source: SourceUnderTest): boolean => {
        return FIRST_STATE_LOOKUP.test(source.text);
      },
    ).map((source: SourceUnderTest): string => {
      return source.file;
    });

    expect(found).toEqual([]);
  });

  // Every template's create and edit page, and every declare or create form.
  const TEMPLATE_PAGES: Array<string> = SOURCES.filter(
    (source: SourceUnderTest): boolean => {
      return (
        source.file.startsWith(`${DASHBOARD}/Pages/`) &&
        TEMPLATE_PAGE.test(source.file)
      );
    },
  ).map((source: SourceUnderTest): string => {
    return source.file;
  });

  const DECLARE_FORMS: Array<string> = [
    `${DASHBOARD}/Pages/Incidents/Create.tsx`,
    `${DASHBOARD}/Pages/Incidents/EpisodeCreate.tsx`,
    `${DASHBOARD}/Pages/Alerts/Create.tsx`,
    `${DASHBOARD}/Pages/Alerts/EpisodeCreate.tsx`,
    `${DASHBOARD}/Pages/ScheduledMaintenanceEvents/Create.tsx`,
  ];

  const STATE_KEY: RegExp = /State(Id)?$/;

  test("the scan finds the template pages", () => {
    expect(TEMPLATE_PAGES).toEqual(
      expect.arrayContaining([
        `${DASHBOARD}/Pages/Incidents/Settings/IncidentTemplates.tsx`,
        `${DASHBOARD}/Pages/Incidents/Settings/IncidentTemplatesView.tsx`,
        `${DASHBOARD}/Pages/ScheduledMaintenanceEvents/Settings/ScheduledMaintenanceTemplates.tsx`,
        `${DASHBOARD}/Pages/Monitor/Settings/MonitorTemplates.tsx`,
      ]),
    );
  });

  test("no template's create form starts with values a state could hide in, nor with a state", () => {
    const forms: Array<FormFacts> = scanFormFiles({
      repositoryRoot: REPOSITORY_ROOT,
      files: TEMPLATE_PAGES.map((file: string): string => {
        return path.join(REPOSITORY_ROOT, file);
      }),
    }).filter((form: FormFacts): boolean => {
      return form.hasCreateForm === true;
    });

    expect(forms.length).toBeGreaterThanOrEqual(5);

    for (const form of forms) {
      // Readable: written as a literal, or none at all.
      expect(`${form.label}: ${form.createInitialValueKeys !== null}`).toBe(
        `${form.label}: true`,
      );
      expect(
        (form.createInitialValueKeys || []).filter((key: string): boolean => {
          return STATE_KEY.test(key);
        }),
      ).toEqual([]);
    }
  });

  test("no template page or declare form reads a state list to start from", () => {
    for (const file of [...TEMPLATE_PAGES, ...DECLARE_FORMS]) {
      const reads: Array<string> = Array.from(
        dense(file).matchAll(/modelType: (\w*State),/g),
        (match: RegExpMatchArray): string => {
          return match[1]!;
        },
      );

      /*
       * Declare Incident reads the alert states once, to offer
       * acknowledging the alerts it is declared from
       * (DeclareAndCreateFormsGuard pins it).
       */
      const allowed: Array<string> =
        file === `${DASHBOARD}/Pages/Incidents/Create.tsx`
          ? ["AlertState"]
          : [];

      expect(`${file}: ${reads.join(", ")}`).toBe(
        `${file}: ${allowed.join(", ")}`,
      );
    }
  });

  test("an incident template asks for its initial state the way Declare Incident does: empty, saying what empty means, under More fields", () => {
    for (const file of [
      `${DASHBOARD}/Pages/Incidents/Settings/IncidentTemplates.tsx`,
      `${DASHBOARD}/Pages/Incidents/Settings/IncidentTemplatesView.tsx`,
    ]) {
      const source: string = dense(file);
      const field: string = fieldObjectAround(
        source,
        'field: { initialIncidentState: true, }, title: "Initial Incident State",',
      );

      expect(field).toContain(
        'description: "Incidents declared from this template start in this state. Leave it empty for the usual starting state. An incident that starts acknowledged or resolved pages no one.",',
      );
      expect(field).toContain('placeholder: "The usual starting state",');
      expect(field).toContain("required: false,");
      expect(field).toContain("collapsibleSection: advancedSection,");
      expect(field).not.toContain("defaultValue");
      expect(source).not.toContain("createInitialValues");
    }
  });
});

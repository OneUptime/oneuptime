/*
 * Every Workflow Builder control honours the view (WorkflowViewOnly).
 *
 * A view is the Builder of someone who may open a workflow but not change
 * it - a Workflow Member, a viewer - set from getWorkflowEditGate. #5320
 * made the Builder one; its follow-up asked for this guard: "Any new
 * Workflow Builder control must honour WorkflowViewOnlyContext (from
 * getWorkflowEditGate), and any new value field go through ValueTextField or
 * the value picker provider, to stay read-only in a view."
 *
 * So this reads every control the Builder draws (Common/UI/Components/
 * Workflow, through the TypeScript AST: Helpers/WorkflowViewOnlyScan) and
 * holds each to one of these:
 *
 *   - it reads the view itself: useContext(WorkflowViewOnlyContext), or it
 *     draws WorkflowViewOnlyFieldset around what changes a setting, or it
 *     provides the view (the canvas, a step's dialog);
 *   - wherever it is drawn, a WorkflowViewOnlyFieldset holds it - or it is
 *     drawn only inside a control that one holds;
 *   - it is a piece of the value picker that opens and inserts nothing while
 *     the picker is not available, which it never is in a view;
 *   - or it is never part of a view, or changes nothing there, and is listed
 *     below with the reason.
 *
 * A new control that does none of these fails here, named with its line.
 * What a disabled fieldset cannot hold - an editable box, a list a grip
 * reorders, keys handled on an element that is no form control - must read
 * the view itself. And a value field goes through ValueTextField: the only
 * editable box in the Builder is TemplateTextEditor's, and every list of
 * values opens only while the picker is available.
 *
 * WorkflowViewOnlyEveryStepGuard holds the same rule in the browser's DOM,
 * step by step.
 */

import {
  BUILDER_DIRECTORY,
  BUILDER_PAGE_FILE,
  BuilderImport,
  ControlKind,
  ControlSite,
  DrawnElement,
  ViewReading,
  asksIfThePickerIsAvailable,
  findAttributeValues,
  findBuilderImports,
  findControlSites,
  findDrawnElements,
  findPropertyValues,
  findViewReadings,
  listBuilderFiles,
  readBuilderFile,
} from "../../../Helpers/WorkflowViewOnlyScan";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * Builder controls that are never part of a view, or that change nothing
 * in one - and why.
 */
const OUTSIDE_THE_VIEW: Record<string, string> = {
  "ComponentsModal.tsx":
    "The panel steps and triggers are added from. A view never opens it: the add button is locked, the dashed trigger card is not pressed, and Run Workflow offers no Add Trigger (Workflow.tsx).",
  "DocumentationViewer.tsx":
    "A step's help: its one button shows more of the help, and changes nothing.",
  "HuntressTriggerPanel.tsx":
    "The Huntress trigger's panel: Copy, and a signing secret saved behind the Workflow update permission it asks itself (PermissionGate), view or not.",
  "IncomingEmailTriggerPanel.tsx":
    "The Incoming Email trigger's address: Copy, and Reset address behind the address key's own reset gate (getIncomingEmailSecretKeyResetGate).",
  "WebhookTriggerPanel.tsx":
    "The Webhook trigger's URL: Copy, and Reset URL behind the URL key's own reset gate (getWebhookSecretKeyResetGate).",
  "RunModal.tsx":
    "Run Workflow. Running is not changing the workflow: a Workflow Member runs workflows from a view, the run gate decides who may (WorkflowRunGate), and a view leaves its Add Trigger out.",
  "RunForm.tsx":
    "Run Workflow's form: the values one run starts with, not the workflow's settings.",
  "StepTraceViewer.tsx":
    "A run's step trace, in its log: read, and no part of the workflow.",
  "WorkflowEnabledSwitch.tsx":
    "The Builder's on/off switch, behind the workflow's own enable gate (UseWorkflowEnabled).",
  "WorkflowIssuesModal.tsx":
    "What the Builder's checks found: a row opens its step, which a view opens to be read.",
  "WorkflowRunExportActions.tsx": "Copies or downloads a run's log.",
  "WorkflowStatusBar.tsx":
    "The Builder's status: View only in a view (readOnlyReason), and the run log and checks it opens change nothing.",
  "WorkflowTurnedOffNotice.tsx":
    "The note a turned-off workflow shows; the Builder page offers its Turn on only to who may turn the workflow on.",
};

/*
 * Pieces of the value picker whose only controls open a list of values or
 * insert one: they ask the picker whether it is available, and it never is
 * in a view (ValuePickerContext).
 */
const OPEN_ONLY_WHILE_THE_PICKER_IS_AVAILABLE: Record<string, string> = {
  "ValuePicker/InsertValueButton.tsx":
    "The { } Insert value button: it draws nothing while the picker is not available.",
  "ValuePicker/ValueTextField.tsx":
    "A value box: TemplateTextEditor shows its value read only in a view, and its { } and its lists open only while the picker is available.",
};

// The only editable box in the Builder: every value field goes through it.
const VALUE_BOX_FILE: string = "ValuePicker/TemplateTextEditor.tsx";

// The lists of values, opened only where the picker is available.
const VALUE_LISTS: Record<string, Array<string>> = {
  "ValuePicker/ValuePickerPopup.tsx": ["ValuePickerPopup"],
  "ValuePicker/ValuePickerMenu.tsx": ["ValuePickerMenu"],
};

interface BuilderFile {
  file: string;
  source: string;
  sites: Array<ControlSite>;
  readings: Array<ViewReading>;
  imports: Array<BuilderImport>;
}

const readEveryBuilderFile: () => Array<BuilderFile> =
  (): Array<BuilderFile> => {
    return listBuilderFiles().map((file: string): BuilderFile => {
      const source: string = readBuilderFile(file);

      return {
        file,
        source,
        sites: findControlSites(file, source),
        readings: findViewReadings(file, source),
        imports: findBuilderImports(path.join(BUILDER_DIRECTORY, file), source),
      };
    });
  };

const BUILDER: Array<BuilderFile> = readEveryBuilderFile();

const builderFile: (file: string) => BuilderFile = (
  file: string,
): BuilderFile => {
  const found: BuilderFile | undefined = BUILDER.find(
    (candidate: BuilderFile): boolean => {
      return candidate.file === file;
    },
  );

  if (!found) {
    throw new Error(`No Builder file ${file}`);
  }

  return found;
};

interface Place {
  // The file that draws it.
  by: string;
  element: DrawnElement;
}

const PLACES: Map<string, Array<Place>> = new Map<string, Array<Place>>();

// Every place a Builder file's components are drawn in the Builder.
const placesOf: (file: string) => Array<Place> = (
  file: string,
): Array<Place> => {
  const known: Array<Place> | undefined = PLACES.get(file);

  if (known) {
    return known;
  }

  const places: Array<Place> = [];

  for (const drawer of BUILDER) {
    for (const imported of drawer.imports) {
      if (imported.file !== file) {
        continue;
      }

      for (const name of imported.names) {
        for (const element of findDrawnElements(
          drawer.file,
          drawer.source,
          name,
        )) {
          places.push({ by: drawer.file, element });
        }
      }
    }
  }

  PLACES.set(file, places);

  return places;
};

const readsTheView: (file: BuilderFile) => boolean = (
  file: BuilderFile,
): boolean => {
  return file.readings.length > 0;
};

/*
 * Whether a file is never part of a view: listed, or drawn only by files
 * that are not.
 */
const isOutsideTheView: (file: string, seen?: Set<string>) => boolean = (
  file: string,
  seen: Set<string> = new Set<string>(),
): boolean => {
  if (OUTSIDE_THE_VIEW[file]) {
    return true;
  }

  if (seen.has(file)) {
    return false;
  }

  seen.add(file);

  const places: Array<Place> = placesOf(file);

  return (
    places.length > 0 &&
    places.every((place: Place): boolean => {
      return isOutsideTheView(place.by, seen);
    })
  );
};

/*
 * Whether a view holds a file still wherever it is drawn: each place is
 * inside a WorkflowViewOnlyFieldset, or in a file a view holds still, or in
 * a file that opens it only while the picker is available, or outside the
 * view.
 */
const isHeldWhereverDrawn: (file: string, seen?: Set<string>) => boolean = (
  file: string,
  seen: Set<string> = new Set<string>(),
): boolean => {
  if (seen.has(file)) {
    return false;
  }

  seen.add(file);

  const places: Array<Place> = placesOf(file);

  return (
    places.length > 0 &&
    places.every((place: Place): boolean => {
      return (
        place.element.isInsideViewFieldset ||
        Boolean(OPEN_ONLY_WHILE_THE_PICKER_IS_AVAILABLE[place.by]) ||
        isOutsideTheView(place.by) ||
        isHeldWhereverDrawn(place.by, new Set<string>(seen))
      );
    })
  );
};

enum Honour {
  ReadsTheView = "reads the view itself",
  HeldWhereverDrawn = "held still wherever it is drawn",
  OpensOnlyWhileAvailable = "opens nothing while the picker is not available",
  OutsideTheView = "is no part of a view",
}

const honourOf: (file: BuilderFile) => Honour | null = (
  file: BuilderFile,
): Honour | null => {
  if (readsTheView(file)) {
    return Honour.ReadsTheView;
  }

  if (OPEN_ONLY_WHILE_THE_PICKER_IS_AVAILABLE[file.file]) {
    return Honour.OpensOnlyWhileAvailable;
  }

  if (isOutsideTheView(file.file)) {
    return Honour.OutsideTheView;
  }

  if (isHeldWhereverDrawn(file.file)) {
    return Honour.HeldWhereverDrawn;
  }

  return null;
};

const describeSites: (sites: Array<ControlSite>) => string = (
  sites: Array<ControlSite>,
): string => {
  return sites
    .slice(0, 3)
    .map((site: ControlSite): string => {
      return `line ${site.line}: <${site.tag}> ${site.what}`;
    })
    .join("; ");
};

const sitesIn: (source: string, fileName?: string) => Array<string> = (
  source: string,
  fileName: string = "Fixture.tsx",
): Array<string> => {
  return findControlSites(fileName, source).map((site: ControlSite): string => {
    return `${site.kind} @${site.line}: ${site.what}`;
  });
};

const propertyValues: (source: string, name: string) => Array<string> = (
  source: string,
  name: string,
): Array<string> => {
  return findPropertyValues("Fixture.tsx", source, name);
};

const attributeValues: (
  source: string,
  tag: string,
  attribute: string,
) => Array<string> = (
  source: string,
  tag: string,
  attribute: string,
): Array<string> => {
  return findAttributeValues("Fixture.tsx", source, tag, attribute);
};

describe("the reader finds every control and every way a file reads the view", () => {
  test.each([
    [
      "a button",
      '<button type="button">Add</button>',
      "native control @1: button",
    ],
    ["an input", "<input value={a} />", "native control @1: input"],
    ["a text area", "<textarea />", "native control @1: textarea"],
    ["a list of options", "<select />", "native control @1: select"],
  ])("%s", (_name: string, jsx: string, expected: string) => {
    expect(sitesIn(`const a = (${jsx});`)).toEqual([expected]);
  });

  test("an editable box, and the keys it handles", () => {
    expect(
      sitesIn(
        [
          "const a = (",
          "  <div",
          "    contentEditable={!isReadOnly}",
          "    onKeyDown={onKeyDown}",
          "  />",
          ");",
        ].join("\n"),
      ),
    ).toEqual([
      "editable text @2: contentEditable",
      "keys on an element @2: onKeyDown",
    ]);
  });

  test("a list a grip reorders, and a row dragged by hand", () => {
    expect(
      sitesIn(
        [
          "const a = (",
          "  <DragDropContext onDragEnd={end}>",
          '    <Droppable droppableId="x">{rows}</Droppable>',
          "  </DragDropContext>",
          ");",
          "const b = <li draggable={true} />;",
        ].join("\n"),
      ),
    ).toEqual([
      "drag and drop @2: DragDropContext",
      "drag and drop @3: Droppable",
      "drag and drop @6: draggable",
    ]);
  });

  test("a press or a change handled by anything drawn, and keys on a control are the control's", () => {
    expect(
      sitesIn(
        [
          "const a = (",
          "  <>",
          "    <Dropdown onChange={choose} />",
          "    <InsertValueButton onPick={insert} />",
          "    <input onKeyDown={keys} />",
          "  </>",
          ");",
        ].join("\n"),
      ),
    ).toEqual([
      "handler @3: onChange",
      "handler @4: onPick",
      "native control @5: input",
      "handler @5: onKeyDown",
    ]);
  });

  test("a word in a comment or a string is not a control", () => {
    expect(
      sitesIn(
        [
          "// <button onClick={x}> in a comment",
          "/* <div contentEditable /> */",
          'const label: string = "<input onChange={y} />";',
          'const a = <p className="text-sm">Read only</p>;',
        ].join("\n"),
      ),
    ).toEqual([]);
  });

  test("reading the view: the context, the fieldset, and providing it", () => {
    const readings: (source: string) => Array<ViewReading> = (
      source: string,
    ): Array<ViewReading> => {
      return findViewReadings("Fixture.tsx", source);
    };

    expect(
      readings(
        "const isViewOnly: boolean = useContext(WorkflowViewOnlyContext);",
      ),
    ).toEqual([ViewReading.ReadsTheContext]);
    expect(
      readings(
        "const isViewOnly: boolean = React.useContext(WorkflowViewOnlyContext);",
      ),
    ).toEqual([ViewReading.ReadsTheContext]);
    expect(
      readings(
        "const a = <WorkflowViewOnlyFieldset><Dropdown /></WorkflowViewOnlyFieldset>;",
      ),
    ).toEqual([ViewReading.DrawsTheFieldset]);
    expect(
      readings(
        "const a = <WorkflowViewOnlyContext.Provider value={true}>{b}</WorkflowViewOnlyContext.Provider>;",
      ),
    ).toEqual([ViewReading.ProvidesTheView]);

    // Naming it is not reading it.
    expect(
      readings(
        [
          "// useContext(WorkflowViewOnlyContext)",
          'import { WorkflowViewOnlyContext } from "./WorkflowViewOnly";',
          "const other = useContext(SomeOtherContext);",
        ].join("\n"),
      ),
    ).toEqual([]);
  });

  test("where a component is drawn, and whether a fieldset holds it there", () => {
    const drawn: Array<DrawnElement> = findDrawnElements(
      "Fixture.tsx",
      [
        "const a = (",
        "  <>",
        "    <WorkflowViewOnlyFieldset>",
        "      <div><CronScheduleField /></div>",
        "    </WorkflowViewOnlyFieldset>",
        "    <CronScheduleField />",
        "  </>",
        ");",
      ].join("\n"),
      "CronScheduleField",
    );

    expect(drawn).toEqual([
      { tag: "CronScheduleField", line: 4, isInsideViewFieldset: true },
      { tag: "CronScheduleField", line: 6, isInsideViewFieldset: false },
    ]);
  });

  test("whether a file opens its lists only while the picker is available", () => {
    expect(
      asksIfThePickerIsAvailable(
        "Fixture.tsx",
        [
          "const picker = useValuePicker();",
          "if (!picker.isAvailable) { return null; }",
        ].join("\n"),
      ),
    ).toBe(true);
    expect(
      asksIfThePickerIsAvailable(
        "Fixture.tsx",
        "const picker = useValuePicker(); // isAvailable is not asked",
      ),
    ).toBe(false);
  });
});

describe("the walk reads the Builder", () => {
  test("every control file of the Builder, the ones that matter among them", () => {
    const files: Array<string> = BUILDER.map((file: BuilderFile): string => {
      return file.file;
    });

    expect(files.length).toBeGreaterThan(40);
    expect(files).toEqual(
      expect.arrayContaining([
        "ArgumentsForm.tsx",
        "ComponentSettingsModal.tsx",
        "Workflow.tsx",
        "Component.tsx",
        "ValuePicker/TemplateTextEditor.tsx",
        "ValuePicker/ValueTextField.tsx",
        "Switch/SwitchEditor.tsx",
        "Condition/ConditionEditor.tsx",
        "ColumnEditor/ColumnValueInput.tsx",
        "WorkflowViewOnlyFieldset.tsx",
      ]),
    );

    const withControls: Array<BuilderFile> = BUILDER.filter(
      (file: BuilderFile): boolean => {
        return file.sites.length > 0;
      },
    );

    expect(withControls.length).toBeGreaterThan(30);
  });

  test("it reads a step's settings as drawn: where a setting's controls are held still", () => {
    expect(
      placesOf("CronScheduleField.tsx").map((place: Place): string => {
        return `${place.by}:${place.element.isInsideViewFieldset}`;
      }),
    ).toEqual(["ArgumentsForm.tsx:true"]);
    expect(builderFile("ArgumentsForm.tsx").readings).toContain(
      ViewReading.ReadsTheContext,
    );
  });
});

describe("every Builder control honours the view", () => {
  test("no control ignores it", () => {
    const ignoring: Array<string> = BUILDER.filter(
      (file: BuilderFile): boolean => {
        return file.sites.length > 0 && honourOf(file) === null;
      },
    ).map((file: BuilderFile): string => {
      return `${file.file} (${describeSites(file.sites)})`;
    });

    /*
     * A control here can change the workflow in a view. Read
     * WorkflowViewOnlyContext (useContext), draw WorkflowViewOnlyFieldset
     * around what changes a setting, draw it only where one holds it - or,
     * if a view never shows it or it changes nothing, list it in
     * OUTSIDE_THE_VIEW with the reason.
     */
    expect(ignoring).toEqual([]);
  });

  test.each(
    BUILDER.filter((file: BuilderFile): boolean => {
      return file.sites.length > 0;
    }).map((file: BuilderFile): [string, BuilderFile] => {
      return [file.file, file];
    }),
  )("%s honours it", (_file: string, file: BuilderFile) => {
    expect([file.file, honourOf(file)]).toEqual([
      file.file,
      expect.any(String),
    ]);
  });

  test("a step's settings that hold themselves still are drawn inside the fieldset", () => {
    /*
     * The ones ArgumentsForm draws inside WorkflowViewOnlyFieldset. Some
     * read the view too, to leave out what only changes them (a schedule's
     * Clear, a list's Add and remove, a value's way back to typing): the
     * fieldset still holds what they show.
     */
    for (const file of [
      "CronScheduleField.tsx",
      "RecordList/RecordListField.tsx",
      "Choice/ChoiceSettingField.tsx",
      "ValuePicker/ValueSingleField.tsx",
    ]) {
      expect([file, isHeldWhereverDrawn(file)]).toEqual([file, true]);
    }

    expect(honourOf(builderFile("Choice/ChoiceSettingField.tsx"))).toBe(
      Honour.HeldWhereverDrawn,
    );

    for (const file of [
      "CronScheduleField.tsx",
      "RecordList/RecordListField.tsx",
      "ValuePicker/ValueSingleField.tsx",
    ]) {
      expect([file, builderFile(file).readings]).toEqual([
        file,
        expect.arrayContaining([ViewReading.ReadsTheContext]),
      ]);
    }
  });

  test("a list opened only from a control a view leaves out reads the view itself", () => {
    // Add field's list: a view draws no Add field, and the list draws nothing there.
    expect(honourOf(builderFile("FieldPicker/AddFieldsPanel.tsx"))).toBe(
      Honour.ReadsTheView,
    );
  });
});

describe("the lists stay true", () => {
  test.each(Object.keys(OUTSIDE_THE_VIEW))(
    "%s is a Builder control that does not read the view, with a reason",
    (file: string) => {
      const found: BuilderFile = builderFile(file);

      expect(found.sites.length).toBeGreaterThan(0);
      // One that reads the view now comes off the list.
      expect([file, found.readings]).toEqual([file, []]);
      expect(OUTSIDE_THE_VIEW[file]!.length).toBeGreaterThan(20);
    },
  );

  test.each(Object.keys(OPEN_ONLY_WHILE_THE_PICKER_IS_AVAILABLE))(
    "%s asks whether the picker is available, and its only native controls are buttons",
    (file: string) => {
      const found: BuilderFile = builderFile(file);

      expect(asksIfThePickerIsAvailable(file, found.source)).toBe(true);
      expect(
        found.sites
          .filter((site: ControlSite): boolean => {
            return site.kind === ControlKind.Native;
          })
          .map((site: ControlSite): string => {
            return site.tag;
          }),
      ).toEqual(expect.arrayContaining(["button"]));
      expect(
        found.sites.some((site: ControlSite): boolean => {
          return site.kind === ControlKind.Native && site.tag !== "button";
        }),
      ).toBe(false);
      expect(
        found.sites.some((site: ControlSite): boolean => {
          return site.kind === ControlKind.EditableText;
        }),
      ).toBe(false);
    },
  );

  test("a value box draws the one editable box, which reads the view", () => {
    expect(
      findDrawnElements(
        "ValuePicker/ValueTextField.tsx",
        builderFile("ValuePicker/ValueTextField.tsx").source,
        "TemplateTextEditor",
      ).length,
    ).toBe(1);
  });
});

describe("what a disabled fieldset cannot hold reads the view itself", () => {
  /*
   * A disabled fieldset disables form controls, and the pointer cannot reach
   * the rest - but the keyboard can: an editable box, a grip that picks up a
   * row with Space (a Switch case's did, in a view), keys handled on an
   * element that is no form control. A control drawing one reads
   * WorkflowViewOnlyContext itself.
   */
  test("every editable box, list a grip reorders and key-handling element", () => {
    const unheld: Array<string> = BUILDER.filter(
      (file: BuilderFile): boolean => {
        const reachable: Array<ControlSite> = file.sites.filter(
          (site: ControlSite): boolean => {
            return (
              site.kind === ControlKind.EditableText ||
              site.kind === ControlKind.DragAndDrop ||
              site.kind === ControlKind.KeysOnAnElement
            );
          },
        );

        return (
          reachable.length > 0 &&
          !file.readings.includes(ViewReading.ReadsTheContext) &&
          !isOutsideTheView(file.file)
        );
      },
    ).map((file: BuilderFile): string => {
      return file.file;
    });

    expect(unheld).toEqual([]);
  });

  test("among them the value box, a Switch's cases and the field list", () => {
    for (const file of [
      "ValuePicker/TemplateTextEditor.tsx",
      "Switch/SwitchEditor.tsx",
      "ModelFieldPicker.tsx",
    ]) {
      expect([file, builderFile(file).readings]).toEqual([
        file,
        expect.arrayContaining([ViewReading.ReadsTheContext]),
      ]);
    }
  });
});

describe("a value field goes through ValueTextField or the value picker provider", () => {
  test("the only editable box in the Builder is the value box's, which reads the view", () => {
    const editable: Array<string> = BUILDER.filter(
      (file: BuilderFile): boolean => {
        return file.sites.some((site: ControlSite): boolean => {
          return site.kind === ControlKind.EditableText;
        });
      },
    ).map((file: BuilderFile): string => {
      return file.file;
    });

    expect(editable).toEqual([VALUE_BOX_FILE]);
    expect(builderFile(VALUE_BOX_FILE).readings).toContain(
      ViewReading.ReadsTheContext,
    );
  });

  test("every list of values opens only while the picker is available", () => {
    const opening: Array<string> = [];

    for (const [listFile, names] of Object.entries(VALUE_LISTS)) {
      for (const place of placesOf(listFile)) {
        if (Object.keys(VALUE_LISTS).includes(place.by)) {
          continue;
        }

        const drawer: BuilderFile = builderFile(place.by);

        if (
          !names.includes(place.element.tag) ||
          asksIfThePickerIsAvailable(drawer.file, drawer.source)
        ) {
          continue;
        }

        opening.push(`${place.by} line ${place.element.line}`);
      }
    }

    expect(opening).toEqual([]);
  });

  test("the provider says the picker is not available in a view", () => {
    const source: string = readBuilderFile(
      "ValuePicker/ValuePickerContext.tsx",
    );

    expect(findViewReadings("ValuePickerContext.tsx", source)).toContain(
      ViewReading.ReadsTheContext,
    );
    /*
     * Outside a provider there is nothing to pick from; inside one, values
     * are offered only outside a view.
     */
    expect(propertyValues(source, "isAvailable")).toEqual([
      "false",
      "!isViewOnly",
    ]);
  });

  test("the step's settings sit inside the provider", () => {
    const source: string = readBuilderFile("ArgumentsForm.tsx");

    expect(
      findDrawnElements("ArgumentsForm.tsx", source, "ValuePickerProvider")
        .length,
    ).toBeGreaterThanOrEqual(3);
  });
});

describe("the view comes from getWorkflowEditGate", () => {
  test("the Builder page asks the edit gate, and hands the canvas its reason", () => {
    const source: string = fs.readFileSync(BUILDER_PAGE_FILE, "utf8");

    expect(source).toContain("getWorkflowEditGate()");
    expect(attributeValues(source, "Workflow", "editDisabledReason")).toEqual([
      "{editLockedReason}",
    ]);
    expect(
      attributeValues(source, "WorkflowStatusBar", "readOnlyReason"),
    ).toEqual(["{editLockedReason}"]);
  });

  test("the canvas is a view while there is a reason, and its step's dialog is told why", () => {
    const source: string = readBuilderFile("Workflow.tsx");

    expect(source).toContain(
      "const isViewOnly: boolean = Boolean(props.editDisabledReason);",
    );
    expect(
      attributeValues(source, "WorkflowViewOnlyContext.Provider", "value"),
    ).toEqual(["{isViewOnly}"]);
    expect(
      attributeValues(source, "ComponentSettingsModal", "readOnlyReason"),
    ).toEqual(["{props.editDisabledReason}"]);
  });

  test("a step's dialog is a view around its settings and identifier while it has one", () => {
    const source: string = readBuilderFile("ComponentSettingsModal.tsx");

    expect(source).toContain(
      "const isViewOnly: boolean = Boolean(props.readOnlyReason);",
    );
    expect(
      attributeValues(source, "WorkflowViewOnlyContext.Provider", "value"),
    ).toEqual(["{true}"]);
    // The identifier is held still whole.
    expect(
      findDrawnElements(
        "ComponentSettingsModal.tsx",
        source,
        "BasicForm",
      ).every((element: DrawnElement): boolean => {
        return element.isInsideViewFieldset;
      }),
    ).toBe(true);
  });

  test("a step's settings lock every field the form draws, in a view", () => {
    const source: string = readBuilderFile("ArgumentsForm.tsx");

    expect(builderFile("ArgumentsForm.tsx").readings).toContain(
      ViewReading.ReadsTheContext,
    );
    expect(propertyValues(source, "disabled")).toEqual(["isViewOnly"]);
    expect(attributeValues(source, "BasicForm", "disableAutofocus")).toEqual([
      "{isViewOnly}",
    ]);
  });
});

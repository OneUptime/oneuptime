import { describe, expect, test } from "@jest/globals";
import path from "path";
import {
  listScanRoots,
  listSourceFiles,
} from "../../../ForeignHiddenRuleGuard";
import {
  CustomElementComponentFacts,
  FormFacts,
  FormFieldFacts,
  FormStepsScanner,
  MIN_SCANNED_FORMS,
  SourceFileSystem,
  scanFormFiles,
} from "../../../Helpers/FormStepsScan";

/*
 * "A wizard step has to earn its place ... once every remaining step is
 * optional the main action button is available." - the principles behind
 * the maintainer's closing request in the feedback document.
 *
 * A stepped form offers its action as soon as every step left holds valid
 * answers (Forms/Utils/FinishFromAnyStep.ts). A custom element is the one
 * thing the form cannot judge without drawing it: it can fill in a value of
 * its own when it first shows (a monitor type's default criteria, a rule's
 * conditions, a discovery scan's SNMP settings), and a form finished without
 * showing it would save the record without that value. So a step holding one
 * counts as unfinished until it has been shown - unless the field says
 * customElementCanBeSkipped.
 *
 * This guard keeps that word honest, by reading every form in the frontends
 * (Tests/Helpers/FormStepsScan):
 *   - customElementCanBeSkipped is said only on a custom element field;
 *   - a field that says it draws no component that fills in a value of its
 *     own when it is drawn: an effect in it that calls onChange;
 *   - the detector finds the elements known to fill themselves in;
 *   - and the main create forms keep saying it for the pickers that start
 *     empty, so the steps they are on stay one optional click away instead
 *     of quietly becoming mandatory again.
 *
 * The detector is pinned on inline snippets first, then run over the real
 * tree with checks that it really read it.
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
const ADMIN_DASHBOARD: string = "packages/App/FeatureSet/AdminDashboard/src";

const VIRTUAL_ROOT: string = "/repo";

function virtualFileSystem(files: Record<string, string>): SourceFileSystem {
  return {
    readFile: (filePath: string): string | null => {
      const relative: string = path
        .relative(VIRTUAL_ROOT, filePath)
        .split(path.sep)
        .join("/");

      return Object.prototype.hasOwnProperty.call(files, relative)
        ? (files[relative] as string)
        : null;
    },
  };
}

// Scans `Page.tsx` (and whatever it imports from the other files given).
function only(files: Record<string, string>): FormFacts {
  const forms: Array<FormFacts> = scanFormFiles({
    repositoryRoot: VIRTUAL_ROOT,
    files: [path.join(VIRTUAL_ROOT, "Page.tsx")],
    fileSystem: virtualFileSystem(files),
  });

  expect(forms).toHaveLength(1);

  return forms[0]!;
}

function fieldOf(form: FormFacts, key: string): FormFieldFacts {
  const found: FormFieldFacts | undefined = form.fields.find(
    (field: FormFieldFacts): boolean => {
      return field.key === key;
    },
  );

  expect(found).toBeDefined();

  return found!;
}

// A page with one stepped form whose `picker` field draws `element`.
function pageDrawing(element: string, extra: string = ""): string {
  return `
    const Page = () => (
      <ModelForm
        name="Thing"
        formType={FormType.Create}
        steps={[{ id: "one", title: "One" }, { id: "two", title: "Two" }]}
        fields={[
          { field: { name: true }, title: "Name", stepId: "one", fieldType: FormFieldSchemaType.Text },
          {
            field: { picker: true },
            title: "Picker",
            stepId: "two",
            fieldType: FormFieldSchemaType.CustomComponent,
            ${extra}
            getCustomElement: (values, props) => {
              return ${element};
            },
          },
        ]}
      />
    );`;
}

function pickerComponents(
  files: Record<string, string>,
): Array<CustomElementComponentFacts> {
  return fieldOf(only(files), "picker").customElementComponents;
}

// The one component a page's picker draws, declared in Picker.tsx.
function describePicker(pickerSource: string): CustomElementComponentFacts {
  const components: Array<CustomElementComponentFacts> = pickerComponents({
    "Page.tsx": `import Picker from "./Picker";\n${pageDrawing("<Picker {...props} />")}`,
    "Picker.tsx": pickerSource,
  });

  expect(components).toHaveLength(1);

  return components[0]!;
}

describe("the finish-from-any-step detector", () => {
  test("reads customElementCanBeSkipped off a field", () => {
    const page: (extra: string) => FormFieldFacts = (
      extra: string,
    ): FormFieldFacts => {
      return fieldOf(
        only({ "Page.tsx": pageDrawing("<div />", extra) }),
        "picker",
      );
    };

    expect(
      page("customElementCanBeSkipped: true,").customElementCanBeSkipped,
    ).toBe(true);
    expect(
      page("customElementCanBeSkipped: false,").customElementCanBeSkipped,
    ).toBe(false);
    expect(page("").customElementCanBeSkipped).toBe(false);
  });

  test("reads it off a field a helper builds", () => {
    const form: FormFacts = only({
      "Page.tsx": `
        import { getPickerField } from "./Fields";
        const Page = () => (
          <ModelForm name="Thing" formType={FormType.Create} steps={[{ id: "one", title: "One" }, { id: "two", title: "Two" }]}
            fields={[
              { field: { name: true }, title: "Name", stepId: "one", fieldType: FormFieldSchemaType.Text },
              getPickerField({ stepId: "two" }),
            ]}
          />
        );`,
      "Fields.tsx": `
        import Picker from "./Picker";
        export const getPickerField = (options) => {
          return {
            field: { picker: true },
            title: "Picker",
            fieldType: FormFieldSchemaType.CustomComponent,
            customElementCanBeSkipped: true,
            getCustomElement: (values, props) => {
              return <Picker {...props} />;
            },
          };
        };`,
      "Picker.tsx": `
        const Picker = (props) => { return <div />; };
        export default Picker;`,
    });

    const picker: FormFieldFacts = fieldOf(form, "picker");

    expect(picker.customElementCanBeSkipped).toBe(true);
    expect(picker.customElementComponents).toEqual([
      { name: "Picker", file: "Picker.tsx", fillsInOnShow: false },
    ]);
  });

  test("names the components a custom element draws, and the files they come from", () => {
    const components: Array<CustomElementComponentFacts> = pickerComponents({
      "Page.tsx": `
        import Picker from "./Picker";
        import { Hint } from "./Hint";
        ${pageDrawing("<div><Picker {...props} /><Hint text='x'></Hint><React.Fragment /></div>")}`,
      "Picker.tsx": `
        const Picker = (props) => { return <div />; };
        export default Picker;`,
      "Hint.tsx": `
        export const Hint = (props) => { return <p />; };`,
    });

    expect(components).toEqual([
      { name: "Picker", file: "Picker.tsx", fillsInOnShow: false },
      { name: "Hint", file: "Hint.tsx", fillsInOnShow: false },
    ]);
  });

  test("follows a render helper of the same file to the component it draws", () => {
    const components: Array<CustomElementComponentFacts> = pickerComponents({
      "Page.tsx": `
        import MinutesField from "./MinutesField";
        const renderMinutes = (values, props) => {
          return <MinutesField onChange={props.onChange} />;
        };
        ${pageDrawing("renderMinutes(values, props)")}`,
      "MinutesField.tsx": `
        const MinutesField = (props) => { return <input onChange={() => { props.onChange(5); }} />; };
        export default MinutesField;`,
    });

    expect(components).toEqual([
      { name: "MinutesField", file: "MinutesField.tsx", fillsInOnShow: false },
    ]);
  });

  test("a component declared in the page itself is followed there", () => {
    const components: Array<CustomElementComponentFacts> = pickerComponents({
      "Page.tsx": `
        const ScopeEditor = (props) => {
          useEffect(() => { props.onChange?.({ all: true }); }, []);
          return <div />;
        };
        ${pageDrawing("<ScopeEditor {...props} />")}`,
    });

    expect(components).toEqual([
      { name: "ScopeEditor", file: "Page.tsx", fillsInOnShow: true },
    ]);
  });

  test("a component it cannot follow is reported as such", () => {
    expect(
      pickerComponents({
        "Page.tsx": `
          import { Picker } from "some-package";
          ${pageDrawing("<Picker />")}`,
      }),
    ).toEqual([{ name: "Picker", file: null, fillsInOnShow: null }]);
  });

  describe("fills in a value of its own when drawn", () => {
    test("an effect that calls props.onChange", () => {
      expect(
        describePicker(`
          const Picker = (props) => {
            const [steps] = useState(defaultSteps());
            useEffect(() => {
              if (steps && props.onChange) {
                props.onChange(steps);
              }
            }, [steps]);
            return <div />;
          };
          export default Picker;`).fillsInOnShow,
      ).toBe(true);
    });

    test("an optional call, props.onChange?.(...)", () => {
      expect(
        describePicker(`
          const Picker = (props) => {
            useEffect(() => { props.onChange?.([]); }, []);
            return <div />;
          };
          export default Picker;`).fillsInOnShow,
      ).toBe(true);
    });

    test("a destructured onChange", () => {
      expect(
        describePicker(`
          export default function Picker({ onChange }) {
            useLayoutEffect(() => { onChange("seeded"); }, []);
            return <div />;
          }`).fillsInOnShow,
      ).toBe(true);
    });

    test("useAsyncEffect, and React.useEffect", () => {
      expect(
        describePicker(`
          const Picker = (props) => {
            useAsyncEffect(async () => { props.onChange(await load()); }, []);
            return <div />;
          };
          export default Picker;`).fillsInOnShow,
      ).toBe(true);

      expect(
        describePicker(`
          const Picker = (props) => {
            React.useEffect(() => { props.onChange(1); }, []);
            return <div />;
          };
          export default Picker;`).fillsInOnShow,
      ).toBe(true);
    });

    test("an effect that calls a function of the component that calls onChange", () => {
      expect(
        describePicker(`
          const Picker = (props) => {
            const report = (value) => { props.onChange(value); };
            useEffect(() => { report(initial()); }, []);
            return <div />;
          };
          export default Picker;`).fillsInOnShow,
      ).toBe(true);

      expect(
        describePicker(`
          const Picker = (props) => {
            const report = useCallback((value) => { props.onChange(value); }, []);
            useEffect(() => { report(initial()); }, []);
            return <div />;
          };
          export default Picker;`).fillsInOnShow,
      ).toBe(true);
    });

    test("not an onChange called only when the user does something", () => {
      expect(
        describePicker(`
          const Picker = (props) => {
            const [items, setItems] = useState(props.initialValue || []);
            useEffect(() => { fetchOptions(); }, []);
            const add = () => {
              const next = [...items, newItem()];
              setItems(next);
              props.onChange?.(next);
            };
            return <button onClick={add}>Add</button>;
          };
          export default Picker;`).fillsInOnShow,
      ).toBe(false);
    });

    test("not an effect that only syncs what it was handed", () => {
      expect(
        describePicker(`
          const Picker = (props) => {
            const [oids, setOids] = useState(props.value || []);
            useEffect(() => { setOids(props.value || []); }, [props.value]);
            return <div />;
          };
          export default Picker;`).fillsInOnShow,
      ).toBe(false);
    });
  });
});

describe("the project's forms", () => {
  const files: Array<string> = listScanRoots(REPOSITORY_ROOT).flatMap(
    (root: string): Array<string> => {
      return listSourceFiles(root);
    },
  );

  const forms: Array<FormFacts> = scanFormFiles({
    repositoryRoot: REPOSITORY_ROOT,
    files,
  });

  interface FormField {
    form: FormFacts;
    field: FormFieldFacts;
  }

  const fields: Array<FormField> = forms.flatMap(
    (form: FormFacts): Array<FormField> => {
      return form.fields.map((field: FormFieldFacts): FormField => {
        return { form, field };
      });
    },
  );

  const skippable: Array<FormField> = fields.filter(
    (item: FormField): boolean => {
      return item.field.customElementCanBeSkipped;
    },
  );

  const describeField: (item: FormField) => string = (
    item: FormField,
  ): string => {
    return `${item.field.file}:${item.field.line} ${item.form.label} > ${item.field.title || item.field.key}`;
  };

  /*
   * A broken walk must not pass by finding nothing. The floors sit far below
   * today's counts: see MIN_SCANNED_FORMS.
   */
  test("are really read", () => {
    expect(forms.length).toBeGreaterThan(MIN_SCANNED_FORMS);
    expect(skippable.length).toBeGreaterThan(10);
    expect(
      fields.filter((item: FormField): boolean => {
        return item.field.customElementComponents.length > 0;
      }).length,
    ).toBeGreaterThan(40);
  });

  test("say customElementCanBeSkipped only on a custom element", () => {
    expect(
      skippable
        .filter((item: FormField): boolean => {
          return item.field.fieldType !== "FormFieldSchemaType.CustomComponent";
        })
        .map(describeField),
    ).toEqual([]);
  });

  test("never say it of an element that fills in a value of its own when drawn", () => {
    const problems: Array<string> = [];

    for (const item of skippable) {
      if (item.field.customElementComponents.length === 0) {
        problems.push(
          `${describeField(item)}: draws no component this guard can follow`,
        );
      }

      for (const component of item.field.customElementComponents) {
        if (component.fillsInOnShow !== false) {
          problems.push(
            `${describeField(item)}: ${component.name} (${component.file || "not followed"}) ${
              component.fillsInOnShow
                ? "writes a value of its own when it is drawn - drop customElementCanBeSkipped, so the form shows it before it can be finished"
                : "could not be followed"
            }`,
          );
        }
      }
    }

    expect(problems).toEqual([]);
  });

  test("the detector finds the elements known to fill themselves in", () => {
    const scanner: FormStepsScanner = new FormStepsScanner(REPOSITORY_ROOT);

    const known: Array<[string, string]> = [
      // A monitor type's default criteria.
      [
        `${DASHBOARD}/Components/Form/Monitor/MonitorSteps.tsx`,
        "MonitorStepsElement",
      ],
      // A rule's starting conditions (ModelForm draws it on Match Criteria).
      [
        "packages/Common/UI/Components/RuleCriteria/RuleCriteriaBuilder.tsx",
        "RuleCriteriaBuilder",
      ],
      // A discovery scan's SNMP settings.
      [
        `${DASHBOARD}/Components/NetworkDevice/SnmpConfigListEditor.tsx`,
        "SnmpConfigListEditor",
      ],
      [
        `${DASHBOARD}/Components/Metrics/RecordingRule/MetricRecordingRuleDefinitionEditor.tsx`,
        "MetricRecordingRuleDefinitionEditor",
      ],
      [
        `${DASHBOARD}/Components/Traces/RecordingRule/TraceRecordingRuleDefinitionEditor.tsx`,
        "TraceRecordingRuleDefinitionEditor",
      ],
      [
        `${DASHBOARD}/Components/Metrics/PipelineRuleFilter/MetricPipelineRuleFilters.tsx`,
        "MetricPipelineRuleFilters",
      ],
      [
        `${DASHBOARD}/Components/Workspace/NotificationRuleForm/NotificationRuleConditions.tsx`,
        "NotificationRuleConditions",
      ],
      /*
       * The Admin Dashboard's team picker: the project's members team, once
       * the project above it is picked. The forms that draw it are one page
       * (ProjectTeamFormsGuard), so it is always drawn before they are sent.
       */
      [
        `${ADMIN_DASHBOARD}/Components/GlobalProvider/ProjectScopedTeamsPicker.tsx`,
        "ProjectScopedTeamsPicker",
      ],
    ];

    for (const [file, name] of known) {
      expect(
        scanner.describeComponent(path.join(REPOSITORY_ROOT, file), name),
      ).toEqual({ name, file, fillsInOnShow: true });
    }
  });

  /*
   * The pickers of the main create forms start empty and write only what is
   * picked. Each says so, which is what lets Declare Incident, Create Alert,
   * Schedule Maintenance and Create Episode be finished from their first
   * step. One that stops saying it brings back a mandatory click.
   */
  test("the main create forms keep their empty-starting pickers skippable", () => {
    const expected: Array<[string, string]> = [
      [`${DASHBOARD}/Pages/Incidents/Create.tsx`, "monitors"],
      [`${DASHBOARD}/Pages/Incidents/Create.tsx`, "incidentRoles"],
      [`${DASHBOARD}/Pages/Alerts/Create.tsx`, "hosts"],
      [`${DASHBOARD}/Pages/ScheduledMaintenanceEvents/Create.tsx`, "monitors"],
      [
        `${DASHBOARD}/Pages/ScheduledMaintenanceEvents/Create.tsx`,
        "sendSubscriberNotificationsOnBeforeTheEvent",
      ],
      [`${DASHBOARD}/Pages/Incidents/EpisodeCreate.tsx`, "episodeRoles"],
    ];

    for (const [file, key] of expected) {
      const found: Array<FormField> = fields.filter(
        (item: FormField): boolean => {
          return (
            item.form.file === file &&
            item.form.hasCreateForm !== false &&
            item.field.key === key
          );
        },
      );

      expect(`${file} ${key}: ${found.length > 0}`).toBe(
        `${file} ${key}: true`,
      );

      for (const item of found) {
        expect(
          `${describeField(item)}: ${item.field.customElementCanBeSkipped}`,
        ).toBe(`${describeField(item)}: true`);
      }
    }
  });

  test("Create Monitor still shows its criteria before it can be finished", () => {
    const criteria: Array<FormField> = fields.filter(
      (item: FormField): boolean => {
        return (
          item.form.file === `${DASHBOARD}/Pages/Monitor/Create.tsx` &&
          item.field.key === "monitorSteps"
        );
      },
    );

    expect(criteria.length).toBeGreaterThan(0);

    for (const item of criteria) {
      expect(item.field.customElementCanBeSkipped).toBe(false);
      expect(
        item.field.customElementComponents.map(
          (component: CustomElementComponentFacts): boolean | null => {
            return component.fillsInOnShow;
          },
        ),
      ).toContain(true);
    }
  });
});

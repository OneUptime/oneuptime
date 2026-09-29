import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * WHY THIS FILE EXISTS
 *
 * The MAC Address field exists so the topology map can put a ping-only
 * device on the switch port its switch's forwarding table says it is on.
 * That only works if the column can be SET, and there are four places an
 * operator sets anything on a device: the create form on the device list,
 * the Device Settings card, the Overview card and the topology map's "Add
 * to Monitoring" dialog. A surface that forgot the field is a surface from
 * which the device can never be put on its port - and, worse, an operator
 * who typed the MAC on create and cannot see it on Settings has no way to
 * tell whether it was saved.
 *
 * All four render the field through ONE helper, getMacAddressFormField, so
 * the title, the validator and the description cannot drift apart - the
 * same reason every SNMP form routes through getSnmpConfigFormFields, and
 * pinned the same way SnmpConfigFormFields.test.ts pins that: against the
 * sources, comments stripped, whitespace squashed. The App suite has no
 * React renderer and these pages are JSX with no extractable logic.
 *
 * Two things about the CALL matter as well as its presence. Three of the
 * surfaces are stepped wizards, and BasicForm places a field on a step
 * purely from its `stepId` - an unstamped field renders on EVERY step. The
 * Overview card is a single-page form and a stamped field there would name a
 * step the form does not declare, which renders it on NONE. And the field
 * sits beside the hostname on every surface, because it is the device's
 * other address: an operator who learns where it lives on one form finds it
 * in the same place on the next.
 */

const DASHBOARD_SRC: string = path.join(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Dashboard",
  "src",
);

const STEP_ID: string = "device-details";

function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

function readCode(...relativeParts: Array<string>): string {
  return stripComments(
    fs.readFileSync(path.join(DASHBOARD_SRC, ...relativeParts), "utf8"),
  ).replace(/\s+/g, " ");
}

interface MacAddressSurface {
  name: string;
  parts: Array<string>;
  /*
   * The step the field is stamped with on a stepped wizard, or undefined
   * on the one single-page form.
   */
  stepId: string | undefined;
}

const SURFACES: Array<MacAddressSurface> = [
  {
    name: "the create form on the device list",
    parts: ["Pages", "NetworkDevice", "Devices.tsx"],
    stepId: STEP_ID,
  },
  {
    name: "the Device Settings card",
    parts: ["Pages", "NetworkDevice", "View", "Settings.tsx"],
    stepId: STEP_ID,
  },
  {
    name: "the device Overview card",
    parts: ["Pages", "NetworkDevice", "View", "Index.tsx"],
    stepId: undefined,
  },
  {
    name: "the topology map's Add to Monitoring dialog",
    parts: ["Components", "Topology", "AddNeighborToMonitoringModal.tsx"],
    stepId: STEP_ID,
  },
];

/*
 * Hoisted so the literals are not the object of a member expression, which
 * wrap-regex and Prettier cannot agree on.
 */

// The helper, imported from the shared module - by name, whatever else comes with it.
const HELPER_IMPORT: RegExp =
  /import \{[^}]*\bgetMacAddressFormField\b[^}]*\} from "[^"]*\/MacAddressFormField"/;

// Any call at all, so a surface that imports the helper and never calls it fails.
const ANY_CALL: RegExp = /getMacAddressFormField\(/;

// The unstamped call the single-page form makes.
const UNSTEPPED_CALL: RegExp = /getMacAddressFormField\(\s*\)/;

// A call handed an options object of any shape.
const CALL_WITH_OPTIONS: RegExp = /getMacAddressFormField\(\s*\{/;

/*
 * The hostname FORM field - the literal followed by its title, so a
 * `hostname: true` in a select list or a filter list does not count.
 */
const HOSTNAME_FORM_FIELD: RegExp =
  /field: \{ hostname: true,? \}, title: "Hostname"/;

// The start of any form field literal.
const ANY_FIELD_LITERAL: RegExp = /\bfield: \{/;

/*
 * A hand-rolled MAC form field: the column keyed straight into a literal
 * that carries a form schema type. A read-only detail ROW keyed the same
 * way (FieldType, not FormFieldSchemaType) is fine - Settings and the
 * Overview both show the stored value that way.
 */
const HAND_ROLLED_FORM_FIELD: RegExp =
  /field: \{ macAddress: true,? \},[^}]*fieldType: FormFieldSchemaType/;

function steppedCall(stepId: string): RegExp {
  return new RegExp(
    `getMacAddressFormField\\(\\s*\\{\\s*stepId:\\s*"${stepId}",?\\s*\\}\\s*\\)`,
  );
}

function indexOfMatch(pattern: RegExp, text: string): number {
  const match: RegExpMatchArray | null = text.match(pattern);

  if (!match || match.index === undefined) {
    return -1;
  }

  return match.index;
}

/*
 * The index of the LAST hostname form field that precedes `before`, or -1.
 * A page can hold more than one form (Index.tsx renders a detail card with
 * a hostname row as well as its edit form), so the one that matters is the
 * one nearest the call.
 */
function lastHostnameFieldBefore(source: string, before: number): number {
  const scanner: RegExp = new RegExp(HOSTNAME_FORM_FIELD.source, "g");
  let last: number = -1;

  let match: RegExpExecArray | null = scanner.exec(source);

  while (match !== null && match.index < before) {
    last = match.index;
    match = scanner.exec(source);
  }

  return last;
}

describe.each(SURFACES)(
  "MAC Address field on $name",
  (surface: MacAddressSurface) => {
    const source: string = readCode(...surface.parts);

    test("imports the shared helper rather than declaring its own field", () => {
      expect(source).toMatch(HELPER_IMPORT);
      expect(source).not.toMatch(HAND_ROLLED_FORM_FIELD);
    });

    test("calls the helper", () => {
      expect(source).toMatch(ANY_CALL);
    });

    if (surface.stepId) {
      const stepId: string = surface.stepId;

      test(`stamps the field with the "${stepId}" step`, () => {
        expect(source).toMatch(steppedCall(stepId));
      });

      // An unstamped call on a wizard renders the field on every step.
      test("never calls the helper unstamped", () => {
        expect(source).not.toMatch(UNSTEPPED_CALL);
      });
    } else {
      test("calls the helper unstamped, as a single-page form must", () => {
        expect(source).toMatch(UNSTEPPED_CALL);
      });

      // A stamped call on a single-page form names a step it does not declare.
      test("never hands the helper a stepId", () => {
        expect(source).not.toMatch(CALL_WITH_OPTIONS);
      });
    }

    test("places the field right after the hostname field", () => {
      const callIndex: number = indexOfMatch(ANY_CALL, source);
      expect(callIndex).toBeGreaterThan(-1);

      const hostnameIndex: number = lastHostnameFieldBefore(source, callIndex);
      expect(hostnameIndex).toBeGreaterThan(-1);

      /*
       * Nothing else declared between the two: the segment after the
       * hostname literal up to the call holds the rest of the hostname
       * field and no other field's opening.
       */
      const between: string = source.slice(
        hostnameIndex + "field: {".length,
        callIndex,
      );
      expect(between).not.toMatch(ANY_FIELD_LITERAL);
    });
  },
);

/*
 * The list above is the whole inventory. A fifth NetworkDevice form that
 * appears without the field is caught by the create-entry-point tests only
 * if it is a create form; this guards the parse instead - every surface the
 * list names must still exist, so a moved page fails here rather than
 * passing vacuously against a missing file.
 */
describe("MAC Address field surfaces — inventory", () => {
  test.each(SURFACES)("$name still exists", (surface: MacAddressSurface) => {
    expect(fs.existsSync(path.join(DASHBOARD_SRC, ...surface.parts))).toBe(
      true,
    );
  });

  test("covers all four forms that set a device's columns", () => {
    expect(SURFACES).toHaveLength(4);
  });
});

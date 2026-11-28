import { beforeAll, describe, expect, test } from "@jest/globals";
import path from "path";
import {
  buildFirstLoad,
  FirstLoadBuild,
  inputsUnder,
} from "../Helpers/FirstLoadBuild";

const COMMON_ROOT: string = path.resolve(__dirname, "..", "..");

/*
 * A PAGE WITH A FORM, WITHOUT THE ENTITY DROPDOWN UNTIL A FORM DRAWS ONE.
 *
 * FormField draws a field that picks records (one with a dropdownModal: an
 * incident's monitors, a policy's teams) with the entity dropdown, and every
 * page with a form reaches FormField: the sign-in pages, a status page and a
 * public dashboard each downloaded the dropdown before it could draw, though
 * none of their forms picks a record - 8 to 10 KiB gzipped of each one's
 * first load (packages/Common/Scripts/first-load-budgets.js), with its
 * Labels tab's search on the server (#10646) and the Label model that
 * search reads. It is a file of its own (LazyEntityDropdown),
 * which the first form with such a field loads as it is drawn
 * (FormFieldControls).
 *
 * So are the color field, with its custom color panel and the color math
 * they read, and the key/value list, with its key suggestions and its
 * filter operators (LazyColorPicker, LazyDictionary): none of those forms
 * picks a color or holds a list of keys, and the two were some 38 KB before
 * gzip of each one's first load. So is the icon field, with its grid of
 * every icon (LazyIconPicker): none of them picks an icon.
 *
 * Built as the status page builds (the shared esbuild config, for
 * production), with what a public page's forms are drawn with as the entry
 * (Helpers/FirstLoadBuild): a form and its fields.
 */
const FORM_MODULES: ReadonlyArray<string> = [
  "UI/Components/Forms/ModelForm",
  "UI/Components/Forms/BasicForm",
  "UI/Components/Forms/Fields/FormField",
];

interface LeftOut {
  name: string;
  path: string;
}

const LOADED_WHEN_NEEDED: ReadonlyArray<LeftOut> = [
  {
    name: "the entity dropdown",
    path: "UI/Components/EntityDropdown/EntityDropdown.tsx",
  },
  {
    name: "the search its Labels tab sends to the server (#10646)",
    path: "UI/Components/EntityDropdown/LabelSearch.ts",
  },
  {
    name: "the color field",
    path: "UI/Components/Forms/Fields/ColorPicker.tsx",
  },
  {
    name: "the color field's custom color panel",
    path: "UI/Components/ColorPicker/CustomColorPanel.tsx",
  },
  {
    name: "the key/value list",
    path: "UI/Components/Dictionary/Dictionary.tsx",
  },
  {
    name: "the icon field",
    path: "UI/Components/Forms/Fields/IconPicker.tsx",
  },
];

let built: FirstLoadBuild | null = null;

beforeAll(() => {
  built = buildFirstLoad({
    entryLines: FORM_MODULES.map((module: string, index: number): string => {
      return `export { default as Module${index} } from ${JSON.stringify(
        path.join(COMMON_ROOT, module),
      )};`;
    }),
    serviceName: "StatusPage",
    publicPath: "/status-page/dist/",
  });
}, 300000);

describe("what a form puts in the first load", () => {
  test("is the form and its fields, with the places of the controls that load when a form has one", () => {
    for (const module of FORM_MODULES) {
      expect(inputsUnder(built!.firstLoad, `${module}.tsx`).length).toBe(1);
    }

    for (const place of [
      "UI/Components/EntityDropdown/LazyEntityDropdown.tsx",
      "UI/Components/Forms/Fields/LazyColorPicker.tsx",
      "UI/Components/Dictionary/LazyDictionary.tsx",
      "UI/Components/Forms/Fields/LazyIconPicker.tsx",
    ]) {
      expect(inputsUnder(built!.firstLoad, place).length).toBe(1);
    }
  });

  test.each(
    LOADED_WHEN_NEEDED.map((leftOut: LeftOut): [string, LeftOut] => {
      return [leftOut.name, leftOut];
    }),
  )(
    "leaves out %s, which loads in a file of its own when a form has one",
    (_name: string, leftOut: LeftOut) => {
      expect(inputsUnder(built!.firstLoad, leftOut.path)).toEqual([]);
      expect(
        inputsUnder(built!.loadedLater, leftOut.path).length,
      ).toBeGreaterThan(0);
    },
  );
});

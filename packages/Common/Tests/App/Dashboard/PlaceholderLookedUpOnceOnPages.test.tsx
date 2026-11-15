import "@testing-library/jest-dom";
import {
  afterEach,
  beforeAll,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import i18next from "i18next";
import React, { ReactElement } from "react";
import { initReactI18next } from "react-i18next";
import { readDashboardLocale } from "../../Helpers/DashboardLocales";

/*
 * A PLACEHOLDER ON A PAGE IS LOOKED UP ONCE, OUTSIDE FORMS TOO (#7682).
 *
 * Pages looked a placeholder up and handed the translation to a control
 * that looked it up again: Code's context dialog its record and service
 * pickers', the OpenStack lifecycle check its option boxes', a note its
 * file picker's. Where a translation is itself an English key the reader
 * saw the translation of the translation - Spanish says "Red" for
 * "Network", and "Rojo" for "Red". Now each hands its placeholder over in
 * English and the control looks it up, once; a sentence built around a
 * value - a filter's "Filter by {{field}}", a custom field chip's "Enter
 * {{name}}", the volume size's "{{size}}, up to {{max}}" - is put in the
 * reader's words on the page, said so, and drawn as given.
 *
 * Here every one of these placeholders is worded "Red" in Spanish, over
 * the Dashboard's own Spanish file, where "Red" is "Rojo": a placeholder
 * looked up once reads "Red", and twice "Rojo".
 */

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: async (): Promise<{
        data: Array<unknown>;
        count: number;
        skip: number;
        limit: number;
      }> => {
        return { data: [], count: 0, skip: 0, limit: 50 };
      },
    },
  };
});

jest.mock("../../../UI/Utils/Permission", () => {
  return {
    __esModule: true,
    default: {
      getAllPermissions: (): Array<unknown> => {
        return [];
      },
      getProjectPermissions: (): Array<unknown> => {
        return [];
      },
      getGlobalPermissions: (): Array<unknown> => {
        return [];
      },
    },
  };
});

import { CodeTaskContextType } from "../../../Types/AI/CodeTask";
import { CustomFieldDefinition } from "../../../Types/CustomField/CustomFieldDefinition";
import CustomFieldType from "../../../Types/CustomField/CustomFieldType";
import DropdownFilter from "../../../UI/Components/Filters/DropdownFilter";
import FieldType from "../../../UI/Components/Types/FieldType";
import CodeContextModal from "../../../../App/FeatureSet/Dashboard/src/Components/Code/CodeContextModal";
import { buildCustomFieldFacets } from "../../../../App/FeatureSet/Dashboard/src/Components/CustomFields/CustomFieldFacets";
import { getNotesCopy } from "../../../../App/FeatureSet/Dashboard/src/Components/EventNotes/EventNotesUtil";
import NoteComposer from "../../../../App/FeatureSet/Dashboard/src/Components/EventNotes/NoteComposer";
import { OpenStackLifecycleOptionsField } from "../../../../App/FeatureSet/Dashboard/src/Components/OpenStack/Checks/OpenStackCheckFormFields";
import useResourceOwners, {
  ResourceFacet,
  UseResourceOwnersResult,
} from "../../../../App/FeatureSet/Dashboard/src/Components/ResourceOwners/useResourceOwners";
import Incident from "../../../Models/DatabaseModels/Incident";

const ONCE: string = "Red";
const TWICE: string = "Rojo";

// Every placeholder below, in English: each worded "Red" here.
const PLACEHOLDERS: ReadonlyArray<string> = [
  // Code's context dialog: an incident's picker, the logs' and a profile's.
  "Search incidents by title",
  "Any service",
  "Pick a service",
  // A note's file picker.
  "Upload files",
  // The OpenStack lifecycle check's option boxes.
  "The only one there is",
  "{{size}}, up to {{max}}",
  "The cloud's default",
  "The smallest that will do",
  "A small one it finds",
  "The project's only one",
  // A filter's, and a custom field chip's.
  "Filter by {{field}}",
  "Enter {{name}}",
  "Search {{name}}...",
];

// A word as a shared component looks it up (UI/Utils/Translation).
function word(text: string): string {
  return i18next.t(text, {
    defaultValue: text,
    keySeparator: false,
    nsSeparator: false,
  });
}

/*
 * Every text a reader can see as a placeholder: the attributes inputs and
 * editors draw one from, and every line of text with nothing else in it -
 * a dropdown's, a picker's.
 */
function drawnTexts(): Array<string> {
  const texts: Array<string> = [];

  for (const element of Array.from(document.body.querySelectorAll("*"))) {
    for (const attribute of ["placeholder", "data-placeholder"]) {
      const value: string | null = element.getAttribute(attribute);

      if (value) {
        texts.push(value);
      }
    }

    if (element.children.length === 0) {
      const text: string = (element.textContent || "").trim();

      if (text) {
        texts.push(text);
      }
    }
  }

  return texts;
}

async function settle(): Promise<void> {
  for (let index: number = 0; index < 10; index++) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

function expectLookedUpOnce(): void {
  const drawn: Array<string> = drawnTexts();

  expect(drawn).toContain(ONCE);
  expect(drawn).not.toContain(TWICE);
}

beforeAll(async () => {
  const spanish: Record<string, string> = { ...readDashboardLocale("es") };

  for (const placeholder of PLACEHOLDERS) {
    spanish[placeholder] = ONCE;
  }

  await i18next.use(initReactI18next).init({
    lng: "es",
    fallbackLng: "en",
    resources: {
      en: { translation: readDashboardLocale("en") },
      es: { translation: spanish },
    },
    interpolation: { escapeValue: false },
  });
});

afterEach(() => {
  cleanup();
});

describe("the placeholders here", () => {
  test("are the Dashboard's own, each Red here, and Red is Rojo", () => {
    const shipped: Record<string, string> = readDashboardLocale("es");

    for (const placeholder of PLACEHOLDERS) {
      expect(Object.keys(shipped)).toContain(placeholder);
      expect(word(placeholder)).toBe(ONCE);
    }

    expect(word(ONCE)).toBe(TWICE);
  });
});

describe("Code's context dialog", () => {
  test.each([
    ["an incident's record picker", CodeTaskContextType.Incident],
    ["the logs' service picker", CodeTaskContextType.Logs],
    ["a profile's service picker", CodeTaskContextType.Profile],
  ])(
    "%s reads its placeholder looked up once",
    async (_picker: string, kind: CodeTaskContextType) => {
      render(
        <CodeContextModal
          kind={kind}
          onAdd={(): void => {}}
          onClose={(): void => {}}
        />,
      );
      await settle();

      expectLookedUpOnce();
    },
  );
});

describe("the OpenStack lifecycle check's options", () => {
  test("each box reads its placeholder looked up once, the volume size's said in Spanish already", async () => {
    const view: ReturnType<typeof render> = render(
      <OpenStackLifecycleOptionsField
        value={{ isFloatingIpEnabled: true, isVolumeEnabled: true }}
        onChange={(): void => {}}
      />,
    );
    await settle();

    const placeholders: Array<string> = Array.from(
      view.container.querySelectorAll("input[placeholder]"),
    ).map((input: Element): string => {
      return (input as HTMLInputElement).placeholder;
    });

    expect(placeholders).toEqual([ONCE, ONCE, ONCE, ONCE, ONCE, ONCE]);
  });
});

describe("a note's attachments", () => {
  test("the file picker reads its placeholder looked up once", async () => {
    const view: ReturnType<typeof render> = render(
      <NoteComposer
        mode="create"
        visibility="private"
        copy={getNotesCopy("private", "incident")}
        values={{
          note: "",
          attachments: [],
          shouldNotify: false,
          postedAt: null,
        }}
        onChange={(): void => {}}
        editorKey="note"
        isAttachmentsEnabled={true}
        isPostedAtEditable={false}
        isSubmitting={false}
        onSubmit={(): void => {}}
      />,
    );
    await settle();

    fireEvent.click(view.getByTestId("note-attach-button"));
    await settle();

    expect(view.getByTestId("note-attachment-picker")).toBeInTheDocument();
    expectLookedUpOnce();
  });
});

describe("a sentence built around a value, said in Spanish already", () => {
  test("a filter's Filter by {{field}} is drawn as given", async () => {
    render(
      <DropdownFilter<{ state?: string }>
        filter={{
          key: "state",
          title: "State",
          type: FieldType.Dropdown,
          filterDropdownOptions: [{ label: "Up", value: "up" }],
        }}
        filterData={{}}
        onFilterChanged={(): void => {}}
      />,
    );
    await settle();

    expectLookedUpOnce();
  });

  // A custom field's chips, as the facet bar draws them (useResourceOwners).
  const DEFINITIONS: Array<CustomFieldDefinition> = [
    { name: "Rack Tag 7", customFieldType: CustomFieldType.Text },
    {
      name: "Rack Tier 7",
      customFieldType: CustomFieldType.Dropdown,
      dropdownOptions: "Gold\nSilver",
    },
  ];

  const FacetBar: (props: {
    facets: Array<ResourceFacet>;
  }) => ReactElement = (props: {
    facets: Array<ResourceFacet>;
  }): ReactElement => {
    const owners: UseResourceOwnersResult<Incident> =
      useResourceOwners<Incident>({
        showOwnerFacet: false,
        showLabelsFacet: false,
        extraFacets: props.facets,
      });

    return owners.filterBar;
  };

  test.each([
    ["a text field's chip: Enter {{name}}", "Rack Tag 7"],
    ["a dropdown field's chip: Search {{name}}...", "Rack Tier 7"],
  ])("%s is drawn as given", async (_chip: string, name: string) => {
    // Built in the reader's language, as the bar builds them when it draws.
    const view: ReturnType<typeof render> = render(
      <FacetBar facets={buildCustomFieldFacets(DEFINITIONS)} />,
    );
    await settle();

    fireEvent.click(view.getByRole("button", { name: name }));
    await settle();

    const placeholders: Array<string> = Array.from(
      document.body.querySelectorAll("input[placeholder]"),
    ).map((input: Element): string => {
      return (input as HTMLInputElement).placeholder;
    });

    expect(placeholders).toContain(ONCE);
    expect(placeholders).not.toContain(TWICE);
  });
});

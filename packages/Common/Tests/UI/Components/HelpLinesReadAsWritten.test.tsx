import "@testing-library/jest-dom";
import { afterEach, beforeAll, describe, expect, test } from "@jest/globals";
import { cleanup, render } from "@testing-library/react";
import fs from "fs";
import { createInstance, i18n } from "i18next";
import path from "path";
import React, { ReactElement } from "react";
import { I18nextProvider } from "react-i18next";
import readAsWritten, {
  ReadAsWrittenValue,
} from "../../../UI/Components/IsolatedText/ReadAsWritten";
import Toggle from "../../../UI/Components/Toggle/Toggle";
import Checkbox from "../../../UI/Components/Checkbox/Checkbox";
import EmptyState from "../../../UI/Components/EmptyState/EmptyState";
import Card from "../../../UI/Components/Card/Card";
import Modal from "../../../UI/Components/Modal/Modal";
import ConfirmModal from "../../../UI/Components/Modal/ConfirmModal";
import SideOver from "../../../UI/Components/SideOver/SideOver";
import Banner from "../../../UI/Components/Banner/Banner";
import TopAlert from "../../../UI/Components/TopAlert/TopAlert";
import Radio from "../../../UI/Components/Radio/Radio";
import BasicRadioButtons from "../../../UI/Components/RadioButtons/BasicRadioButtons";
import GroupRadioButtons from "../../../UI/Components/RadioButtons/GroupRadioButtons";
import ChoiceRows from "../../../UI/Components/ChoiceRows/ChoiceRows";
import FoldedSection from "../../../UI/Components/FoldedSection/FoldedSection";
import FormFieldLabel from "../../../UI/Components/Forms/Fields/FieldLabel";
import DetailFieldLabel from "../../../UI/Components/Detail/DetailFieldLabel";
import DetailCardFieldLabel from "../../../UI/Components/Detail/FieldLabel";
import Detail from "../../../UI/Components/Detail/Detail";
import BasicForm from "../../../UI/Components/Forms/BasicForm";
import FormFieldSchemaType from "../../../UI/Components/Forms/Types/FormFieldSchemaType";
import FormValues from "../../../UI/Components/Forms/Types/FormValues";
import FieldType from "../../../UI/Components/Types/FieldType";
import IconProp from "../../../Types/Icon/IconProp";

/*
 * A HELP LINE THE READER'S LANGUAGE HAS NOT WORDED YET, READ AS WRITTEN.
 *
 * A switch's description, a card's or a dialog's line under its title, a
 * radio option's line and a field's help are looked up in the reader's
 * language, and a sentence the language has not worded yet is drawn in
 * English. On a Persian page, laid out right to left, that English line put
 * its full stop first (".Turn this on to page the team"). Each shared
 * component now draws such a line in an isolate of its own (readAsWritten,
 * IsolatedText: a bdi whose dir is the way most of its letters read), so the
 * full stop stays where it was written while the line still starts where the
 * page's lines do. A line worded in the page's language, and an English line
 * on an English page, are drawn exactly as before, with no new element.
 *
 * jsdom does not lay a page out, so this pins the elements and their dir;
 * packages/E2E/ReadingDirection measures lines in a real browser.
 */

const ENGLISH_LINE: string =
  "Turn this on to page the team when a monitor goes down.";
const PERSIAN_LINE: string =
  "این را روشن کنید تا وقتی مانیتوری از کار افتاد، تیم خبردار شود.";

type PageName = "en" | "de" | "fa" | "faWorded";

const PAGE_LANGUAGES: Record<PageName, string> = {
  en: "en",
  de: "de",
  fa: "fa",
  faWorded: "fa",
};

const pages: Partial<Record<PageName, i18n>> = {};

beforeAll(async () => {
  for (const name of Object.keys(PAGE_LANGUAGES) as Array<PageName>) {
    const code: string = PAGE_LANGUAGES[name];
    const instance: i18n = createInstance();
    await instance.init({
      lng: code,
      resources: {
        [code]: {
          translation:
            name === "faWorded" ? { [ENGLISH_LINE]: PERSIAN_LINE } : {},
        },
      },
      interpolation: { escapeValue: false },
      keySeparator: false,
      nsSeparator: false,
    });
    pages[name] = instance;
  }
});

afterEach(() => {
  cleanup();
  document.documentElement.removeAttribute("dir");
  document.documentElement.removeAttribute("lang");
});

const renderOn: (page: PageName, element: ReactElement) => void = (
  page: PageName,
  element: ReactElement,
): void => {
  const code: string = PAGE_LANGUAGES[page];
  document.documentElement.setAttribute("lang", code);

  if (code === "fa") {
    document.documentElement.setAttribute("dir", "rtl");
  }

  render(
    <I18nextProvider i18n={pages[page] as i18n}>{element}</I18nextProvider>,
  );
};

// Every text node on the page that holds the line.
const textNodesHolding: (text: string) => Array<Text> = (
  text: string,
): Array<Text> => {
  const walker: TreeWalker = document.createTreeWalker(
    document.body,
    NodeFilter.SHOW_TEXT,
  );
  const found: Array<Text> = [];
  let node: Node | null = walker.nextNode();

  while (node) {
    if ((node.textContent || "").includes(text)) {
      found.push(node as Text);
    }

    node = walker.nextNode();
  }

  return found;
};

const isolateAround: (node: Text) => HTMLElement | null = (
  node: Text,
): HTMLElement | null => {
  return (node.parentElement?.closest("bdi") as HTMLElement | null) || null;
};

const doNothing: () => void = (): void => {
  return;
};

interface HelpLineCase {
  component: string;
  draw: (line: string) => ReactElement;
  /*
   * The option lists take their lines already worded by the page that draws
   * them, rather than looking them up themselves.
   */
  wordedByCaller?: boolean | undefined;
}

interface NamedRow {
  name?: string | undefined;
}

const HELP_LINE_CASES: Array<HelpLineCase> = [
  {
    component: "Toggle (a switch's description)",
    draw: (line: string): ReactElement => {
      return (
        <Toggle onChange={doNothing} title="Page the team" description={line} />
      );
    },
  },
  {
    component: "Checkbox (a check box's description)",
    draw: (line: string): ReactElement => {
      return (
        <Checkbox
          onChange={doNothing}
          title="Page the team"
          description={line}
        />
      );
    },
  },
  {
    component: "EmptyState",
    draw: (line: string): ReactElement => {
      return (
        <EmptyState
          id="no-monitors"
          title="No monitors yet"
          description={line}
          icon={IconProp.Info}
        />
      );
    },
  },
  {
    component: "Card (the line under its title)",
    draw: (line: string): ReactElement => {
      return (
        <Card title="Paging" description={line}>
          <div />
        </Card>
      );
    },
  },
  {
    component: "Modal (the line under its title)",
    draw: (line: string): ReactElement => {
      return (
        <Modal
          title="Page the team"
          description={line}
          onClose={doNothing}
          onSubmit={doNothing}
        >
          <div />
        </Modal>
      );
    },
  },
  {
    component: "ConfirmModal",
    draw: (line: string): ReactElement => {
      return (
        <ConfirmModal
          title="Page the team"
          description={line}
          onClose={doNothing}
          onSubmit={doNothing}
        />
      );
    },
  },
  {
    component: "SideOver (the line under its title)",
    draw: (line: string): ReactElement => {
      return (
        <SideOver title="Page the team" description={line} onClose={doNothing}>
          <div />
        </SideOver>
      );
    },
  },
  {
    component: "Banner",
    draw: (line: string): ReactElement => {
      return <Banner title="Paging" description={line} />;
    },
  },
  {
    component: "TopAlert",
    draw: (line: string): ReactElement => {
      return <TopAlert title="Paging" description={line} />;
    },
  },
  {
    component: "Radio (an option's line)",
    wordedByCaller: true,
    draw: (line: string): ReactElement => {
      return (
        <Radio
          options={[
            { value: "page", label: "Page the team", description: line },
            { value: "quiet", label: "Stay quiet" },
          ]}
        />
      );
    },
  },
  {
    component: "BasicRadioButtons (an option's line)",
    wordedByCaller: true,
    draw: (line: string): ReactElement => {
      return (
        <BasicRadioButtons
          onChange={doNothing}
          options={[
            { value: "page", title: "Page the team", description: line },
            { value: "quiet", title: "Stay quiet" },
          ]}
        />
      );
    },
  },
  {
    component: "GroupRadioButtons (an option's line)",
    wordedByCaller: true,
    draw: (line: string): ReactElement => {
      return (
        <GroupRadioButtons
          onChange={doNothing}
          options={[
            { value: "page", title: "Page the team", description: line },
            { value: "quiet", title: "Stay quiet" },
          ]}
        />
      );
    },
  },
  {
    component: "ChoiceRows (a row's line)",
    draw: (line: string): ReactElement => {
      return (
        <ChoiceRows<string>
          value={null}
          ariaLabel="Paging"
          onPick={doNothing}
          options={[
            { value: "page", title: "Page the team", description: line },
            { value: "quiet", title: "Stay quiet" },
          ]}
        />
      );
    },
  },
  {
    component: "FoldedSection (the line under its title)",
    draw: (line: string): ReactElement => {
      return (
        <FoldedSection
          title="Paging"
          description={line}
          defaultCollapsed={false}
        >
          <div />
        </FoldedSection>
      );
    },
  },
  {
    component: "Forms FieldLabel (a field's help)",
    draw: (line: string): ReactElement => {
      return <FormFieldLabel title="Paging" description={line} />;
    },
  },
  {
    component: "Detail DetailFieldLabel",
    draw: (line: string): ReactElement => {
      return <DetailFieldLabel title="Paging" description={line} />;
    },
  },
  {
    component: "Detail FieldLabel",
    draw: (line: string): ReactElement => {
      return <DetailCardFieldLabel title="Paging" description={line} />;
    },
  },
  {
    component: "Detail (a field's help)",
    draw: (line: string): ReactElement => {
      return (
        <Detail<NamedRow>
          item={{ name: "Checkout API" }}
          fields={[
            {
              key: "name",
              title: "Name",
              description: line,
              fieldType: FieldType.Text,
            },
          ]}
          showDetailsInNumberOfColumns={1}
        />
      );
    },
  },
  {
    component: "BasicForm (the form's line under its title)",
    draw: (line: string): ReactElement => {
      return (
        <BasicForm<FormValues<NamedRow>>
          id="paging-form"
          title="Paging"
          description={line}
          fields={[
            {
              field: { name: true },
              title: "Name",
              fieldType: FormFieldSchemaType.Text,
            },
          ]}
          onSubmit={doNothing}
        />
      );
    },
  },
];

describe("readAsWritten, the helper every shared help line goes through", () => {
  test("a line that reads the other way from the page is drawn in an isolate read the way it is written", () => {
    const { container } = render(<p>{readAsWritten(ENGLISH_LINE, "fa")}</p>);
    const isolate: HTMLElement | null = container.querySelector("bdi");

    expect(isolate).not.toBeNull();
    expect(isolate?.getAttribute("dir")).toBe("ltr");
    expect(isolate?.textContent).toBe(ENGLISH_LINE);
  });

  test("a Persian line someone wrote on an English page is an isolate read right to left", () => {
    const { container } = render(<p>{readAsWritten(PERSIAN_LINE, "en")}</p>);

    expect(container.querySelector("bdi")?.getAttribute("dir")).toBe("rtl");
  });

  test("a line in the page's own way is handed back as the very same string", () => {
    expect(readAsWritten(PERSIAN_LINE, "fa")).toBe(PERSIAN_LINE);
    expect(readAsWritten(ENGLISH_LINE, "en")).toBe(ENGLISH_LINE);
    expect(readAsWritten(ENGLISH_LINE, "de")).toBe(ENGLISH_LINE);
    expect(readAsWritten(ENGLISH_LINE, "ja")).toBe(ENGLISH_LINE);
  });

  test("no language yet reads as an English page", () => {
    expect(readAsWritten(ENGLISH_LINE, undefined)).toBe(ENGLISH_LINE);
    expect(readAsWritten(ENGLISH_LINE, null)).toBe(ENGLISH_LINE);
  });

  test("words with no letters to tell a way by are left alone", () => {
    expect(readAsWritten("42%", "fa")).toBe("42%");
    expect(readAsWritten("", "fa")).toBe("");
    expect(readAsWritten(undefined, "fa")).toBeUndefined();
  });

  test("a line handed over as an element of its own (links, bold names) is drawn exactly as it was", () => {
    const element: ReactElement = (
      <span>
        Read the <a href="/docs">guide</a>.
      </span>
    );
    const drawn: ReadAsWrittenValue = readAsWritten(element, "fa");

    expect(drawn).toBe(element);
  });
});

describe.each(HELP_LINE_CASES)("$component", (helpLine: HelpLineCase) => {
  test("on a Persian page, an English line not worded yet is drawn in an isolate read left to right", () => {
    renderOn("fa", helpLine.draw(ENGLISH_LINE));

    const nodes: Array<Text> = textNodesHolding(ENGLISH_LINE);

    expect(nodes.length).toBeGreaterThan(0);

    for (const node of nodes) {
      const isolate: HTMLElement | null = isolateAround(node);

      expect(isolate).not.toBeNull();
      expect(isolate?.getAttribute("dir")).toBe("ltr");
      // The isolate holds the whole sentence, its full stop with it.
      expect(isolate?.textContent).toBe(ENGLISH_LINE);
    }
  });

  test("on a Persian page, a line worded in Persian is drawn as part of the page's line, with no isolate", () => {
    if (helpLine.wordedByCaller) {
      renderOn("fa", helpLine.draw(PERSIAN_LINE));
    } else {
      renderOn("faWorded", helpLine.draw(ENGLISH_LINE));
    }

    const nodes: Array<Text> = textNodesHolding(PERSIAN_LINE);

    expect(nodes.length).toBeGreaterThan(0);
    expect(textNodesHolding(ENGLISH_LINE)).toHaveLength(0);

    for (const node of nodes) {
      expect(isolateAround(node)).toBeNull();
    }
  });

  test("on an English page, and on a German page still in English, the line is drawn as it always was", () => {
    for (const page of ["en", "de"] as Array<PageName>) {
      renderOn(page, helpLine.draw(ENGLISH_LINE));

      const nodes: Array<Text> = textNodesHolding(ENGLISH_LINE);

      expect(nodes.length).toBeGreaterThan(0);

      for (const node of nodes) {
        expect(isolateAround(node)).toBeNull();
      }

      cleanup();
    }
  });

  test("on an English page, a Persian line someone wrote is an isolate read right to left", () => {
    renderOn("en", helpLine.draw(PERSIAN_LINE));

    const nodes: Array<Text> = textNodesHolding(PERSIAN_LINE);

    expect(nodes.length).toBeGreaterThan(0);

    for (const node of nodes) {
      expect(isolateAround(node)?.getAttribute("dir")).toBe("rtl");
    }
  });
});

/*
 * Which shared components draw their help lines through readAsWritten. A new
 * description, help or option line in one of them goes through it too, and
 * Alert, which had a copy of its own, uses the shared one.
 */
const COMPONENTS: string = path.resolve(__dirname, "../../../UI/Components");
const SOURCE_FILE: RegExp = /\.tsx?$/;
const OWN_COPY: RegExp = /(const|function)\s+readAsWritten\b/;

const SHARED_HELP_LINE_FILES: Array<string> = [
  "Alerts/Alert.tsx",
  "Banner/Banner.tsx",
  "Card/Card.tsx",
  "Checkbox/Checkbox.tsx",
  "ChoiceRows/ChoiceRows.tsx",
  "Detail/Detail.tsx",
  "Detail/DetailFieldLabel.tsx",
  "Detail/FieldLabel.tsx",
  "EmptyState/EmptyState.tsx",
  "FoldedSection/FoldedSection.tsx",
  "Forms/BasicForm.tsx",
  "Forms/Fields/FieldLabel.tsx",
  "Forms/Fields/FormField.tsx",
  "Modal/ConfirmModal.tsx",
  "Modal/Modal.tsx",
  "ModelSwitch/ModelSwitchRow.tsx",
  "Radio/Radio.tsx",
  "RadioButtons/BasicRadioButtons.tsx",
  "RadioButtons/GroupRadioButtons.tsx",
  "SideOver/SideOver.tsx",
  "Toggle/Toggle.tsx",
  "TopAlert/TopAlert.tsx",
];

describe("the shared components that draw help lines", () => {
  test.each(SHARED_HELP_LINE_FILES)(
    "%s draws its lines through the shared readAsWritten",
    (file: string) => {
      const source: string = fs.readFileSync(
        path.join(COMPONENTS, file),
        "utf8",
      );

      expect(source).toMatch(
        /import readAsWritten from "(\.\.\/)+IsolatedText\/ReadAsWritten";/,
      );
      expect(source).toMatch(/readAsWritten\(/);
      // Each line is read against the page's language, never a fixed one.
      expect(source).not.toMatch(/readAsWritten\([^)]*,\s*"[a-z-]+"\s*\)/);
    },
  );

  test("no component keeps a copy of the helper of its own", () => {
    const copies: Array<string> = [];
    const walk: (folder: string) => void = (folder: string): void => {
      for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
        const full: string = path.join(folder, entry.name);

        if (entry.isDirectory()) {
          walk(full);
          continue;
        }

        const isSource: boolean = SOURCE_FILE.test(entry.name);

        if (
          isSource &&
          entry.name !== "ReadAsWritten.tsx" &&
          OWN_COPY.test(fs.readFileSync(full, "utf8"))
        ) {
          copies.push(path.relative(COMPONENTS, full));
        }
      }
    };

    walk(COMPONENTS);

    expect(copies).toEqual([]);
  });

  test("ModelSwitchRow reads both its description and its note as written", () => {
    const source: string = fs.readFileSync(
      path.join(COMPONENTS, "ModelSwitch/ModelSwitchRow.tsx"),
      "utf8",
    );

    expect(source.match(/readAsWritten\(/g)?.length).toBeGreaterThanOrEqual(2);
  });

  test("a date field reads both its help and its time zone sentence as written", () => {
    const source: string = fs.readFileSync(
      path.join(COMPONENTS, "Forms/Fields/FormField.tsx"),
      "utf8",
    );

    expect(source).toMatch(
      /readAsWritten\(translatedDescription, translator\.language\)/,
    );
    expect(source).toMatch(
      /readAsWritten\(timezoneSentence, translator\.language\)/,
    );
  });
});

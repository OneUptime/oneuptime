import fs from "fs";
import path from "path";
import ts from "typescript";

/*
 * THE DESCRIPTIONS A PERSON READS WHILE SETTING SOMETHING UP.
 *
 * "The description is too long as well, so can you please optimise that?
 * Please also do that for other places in the project where the description
 * is long." (the maintainer, on a switch whose five-line description
 * explained both of its states)
 *
 * This reads the frontends' syntax - never their text - and finds every
 * sentence drawn under a label, in a card's header, in a dialog or in an
 * empty list, following a constant, a copy object or a translationKey() to
 * the words it holds. What it finds is sorted into kinds, because where a
 * sentence sits decides how much of it fits:
 *
 *   - field:   under a form field's label (a ModelForm field, a Toggle, a
 *              Checkbox, a radio), or a form field with no description of
 *              its own showing its model column's (column);
 *   - detail:  under a detail card's label (CardModelDetail and list-view
 *              rows);
 *   - section: under a folded form section's title;
 *   - option:  in a choice's tile or row (cardSelectOptions,
 *              radioButtonOptions, dropdownOptions);
 *   - switch:  beside a switch that saves on flip (ModelSwitchRow and the
 *              cards that draw it), and the switch definitions they read;
 *   - card:    under a card's title, beside its buttons;
 *   - dialog:  in a dialog or a confirmation;
 *   - empty:   in a list or page with nothing in it yet;
 *   - page:    under a page's title.
 *
 * Help that waits to be asked for is not here: an (i) tooltip (InfoTooltip,
 * the metric tiles, chart cards, summary fields), a table's help dialog
 * (helpContent), setup guides and the docs carry the detail a one-line
 * description leaves out.
 *
 * A plain module, not a .test.ts file: importing it runs no tests.
 */

export const PACKAGES_ROOT: string = path.resolve(__dirname, "../../..");
export const REPO_ROOT: string = path.resolve(PACKAGES_ROOT, "..");

export type DescriptionKind =
  | "field"
  | "column"
  | "detail"
  | "section"
  | "option"
  | "switch"
  | "card"
  | "dialog"
  | "empty"
  | "page";

export const DESCRIPTION_KINDS: ReadonlyArray<DescriptionKind> = [
  "field",
  "column",
  "detail",
  "section",
  "option",
  "switch",
  "card",
  "dialog",
  "empty",
  "page",
];

export interface FoundDescription {
  kind: DescriptionKind;
  // Where it is drawn: "<path from the repository root>:<line>".
  where: string;
  /*
   * Where its words are written, when that is somewhere else: a constant in
   * another module, a copy object, a model's column.
   */
  writtenAt: string | null;
  // What it is handed to: a component ("ConfirmModal") or a property.
  owner: string;
  text: string;
}

/*
 * Where the scan reads source files: the disk, or (in the guard's own tests)
 * a handful of files held in memory.
 */
export interface SourceReader {
  isFile: (file: string) => boolean;
  isDirectory: (directory: string) => boolean;
  // The names in a directory.
  list: (directory: string) => Array<string>;
  read: (file: string) => string;
}

export const DISK_READER: SourceReader = {
  isFile: (file: string): boolean => {
    return fs.existsSync(file) && fs.statSync(file).isFile();
  },
  isDirectory: (directory: string): boolean => {
    return fs.existsSync(directory) && fs.statSync(directory).isDirectory();
  },
  list: (directory: string): Array<string> => {
    return fs.readdirSync(directory);
  },
  read: (file: string): string => {
    return fs.readFileSync(file, "utf8");
  },
};

/*
 * A reader over files held in memory, keyed by absolute path: what the
 * guard's tests hand the scan to prove it finds a long description and lets
 * a short one through.
 */
export function memoryReader(files: Record<string, string>): SourceReader {
  const paths: Array<string> = Object.keys(files);

  const isDirectory: (directory: string) => boolean = (
    directory: string,
  ): boolean => {
    const prefix: string = directory.endsWith(path.sep)
      ? directory
      : directory + path.sep;

    return paths.some((file: string): boolean => {
      return file.startsWith(prefix);
    });
  };

  return {
    isFile: (file: string): boolean => {
      return files[file] !== undefined;
    },
    isDirectory: isDirectory,
    list: (directory: string): Array<string> => {
      const prefix: string = directory.endsWith(path.sep)
        ? directory
        : directory + path.sep;
      const names: Set<string> = new Set<string>();

      for (const file of paths) {
        if (file.startsWith(prefix)) {
          const name: string | undefined = file
            .slice(prefix.length)
            .split(path.sep)[0];

          if (name) {
            names.add(name);
          }
        }
      }

      return Array.from(names);
    },
    read: (file: string): string => {
      const text: string | undefined = files[file];

      if (text === undefined) {
        throw new Error(`No such file in memory: ${file}`);
      }

      return text;
    },
  };
}

// Where the frontends' words are, from the repository root.
export const SCANNED_ROOTS: ReadonlyArray<string> = [
  "packages/App/FeatureSet/Dashboard/src",
  "packages/App/FeatureSet/AdminDashboard/src",
  "packages/App/FeatureSet/StatusPage/src",
  "packages/App/FeatureSet/Accounts/src",
  "packages/App/FeatureSet/PublicDashboard/src",
  "packages/Common/UI",
  "ee/Dashboard",
  "ee/AdminDashboard",
];

const SOURCE_FILE: RegExp = /\.tsx?$/;
const SKIPPED_FILE: RegExp = /(\.test\.tsx?|\.spec\.tsx?|\.d\.ts)$/;
const SKIPPED_DIRECTORIES: ReadonlySet<string> = new Set<string>([
  "node_modules",
  "build",
  "dist",
  "Tests",
  "__tests__",
]);

/*
 * Module aliases the frontends import through, to the directory each
 * stands for (from the repository root).
 */
const MODULE_ALIASES: ReadonlyArray<{ prefix: string; directory: string }> = [
  { prefix: "Common/", directory: "packages/Common" },
  {
    prefix: "@oneuptime/dashboard/",
    directory: "packages/App/FeatureSet/Dashboard/src",
  },
  {
    prefix: "@oneuptime/admin-dashboard/",
    directory: "packages/App/FeatureSet/AdminDashboard/src",
  },
];

// A call that looks its first argument up as an English key.
const TRANSLATION_CALL: RegExp =
  /^(t|tx|translate|translationKey|translatableTerm|translateString|translateText|translateTemplate|translateValue|translateTerm)$/;

/*
 * A call whose first argument is a count-dependent sentence, a
 * PluralTemplate ({ one, other }): translatePlural(template, count). The
 * reader sees one form or the other, so both are measured.
 */
const PLURAL_CALL: RegExp = /^translatePlural$/;

// The two English sentences of a PluralTemplate.
const PLURAL_FORMS: ReadonlyArray<string> = ["one", "other"];

// The longest of several texts, or undefined for none.
function longestText(texts: Array<FoundText>): FoundText | undefined {
  let longest: FoundText | undefined = undefined;

  for (const text of texts) {
    if (!longest || text.text.length > longest.text.length) {
      longest = text;
    }
  }

  return longest;
}

// A nested locale key, read with t("pages.settings.fieldDescription").
const NESTED_KEY: RegExp = /^[a-zA-Z]\w*(\.\w+)+$/;

/*
 * Each frontend's English, by the directory its sources are in (from the
 * repository root): where a nested key read in that directory is looked up.
 * ee/ pages render inside the frontend they plug into.
 */
const ENGLISH_LOCALES: ReadonlyArray<{ directory: string; locale: string }> = [
  {
    directory: "packages/App/FeatureSet/AdminDashboard/",
    locale: "packages/App/FeatureSet/AdminDashboard/src/Locales/en.json",
  },
  {
    directory: "ee/AdminDashboard/",
    locale: "packages/App/FeatureSet/AdminDashboard/src/Locales/en.json",
  },
  {
    directory: "packages/App/FeatureSet/StatusPage/",
    locale: "packages/App/FeatureSet/StatusPage/src/Locales/en.json",
  },
  {
    directory: "packages/App/FeatureSet/Accounts/",
    locale: "packages/App/FeatureSet/Accounts/src/Locales/en.json",
  },
  {
    directory: "",
    locale: "packages/App/FeatureSet/Dashboard/src/Locales/en.json",
  },
];

// What a template literal's ${...} is shown as: {{name}}.
const NOT_A_NAME_CHARACTER: RegExp = /[^A-Za-z0-9]/g;

const WHITESPACE: RegExp = /\s+/g;

// The properties and attributes that hold a description.
const DESCRIPTION_NAMES: ReadonlySet<string> = new Set<string>([
  "description",
  "sectionDescription",
  "cardDescription",
  "getDescription",
  "note",
  "noItemsMessage",
  "emptyMessage",
  "emptyStateMessage",
  "emptyDescription",
  "emptyStateDescription",
]);

// Names that hold an empty list's explanation, wherever they are.
const EMPTY_NAMES: ReadonlySet<string> = new Set<string>([
  "noItemsMessage",
  "emptyMessage",
  "emptyStateMessage",
  "emptyDescription",
  "emptyStateDescription",
]);

/*
 * Components that show their description only when asked: an (i) beside a
 * title, a tooltip. Detail belongs there, so they are not measured.
 */
const TOOLTIP_TAGS: ReadonlySet<string> = new Set<string>([
  "InfoTooltip",
  "Tooltip",
  "GoldenMetricTile",
  "ChartCard",
  "StatTile",
  "WebVitalsCard",
  "WebVitalRouteBreakdownCard",
]);
const TOOLTIP_TAG_ENDING: RegExp = /(MetricTitle|HeroTileTitle|Tooltip)$/;

const DIALOG_TAG: RegExp = /(Modal|Dialog)$/;
const DIALOG_TAGS: ReadonlySet<string> = new Set<string>([
  "SideOver",
  "DuplicateModel",
]);
const EMPTY_TAG: RegExp = /EmptyState/;
const SWITCH_TAG: RegExp = /^(Toggle|ModelSwitch\w*)$|Switch(Row|Card)$/;
const FIELD_TAGS: ReadonlySet<string> = new Set<string>([
  "Checkbox",
  "CheckboxElement",
  "FieldLabel",
  "FieldLabelElement",
  "Dropdown",
  "BasicRadioButtons",
  "GroupRadioButtons",
  "RadioButtons",
  "StepTimeoutInput",
]);
const CARD_TAG: RegExp = /(Card|Table|Section|Panel|Detail|ObjectID)$/;
const NOT_A_CARD_TAG: RegExp = /^(TableRow|TableCell|TableHeader)$/;

// Elements a sentence can hold: a link, emphasis, a code word.
const INLINE_TAGS: ReadonlySet<string> = new Set<string>([
  "a",
  "b",
  "code",
  "em",
  "i",
  "Link",
  "span",
  "strong",
]);
// Elements that draw a sentence from its template attribute.
const SENTENCE_TAGS: ReadonlySet<string> = new Set<string>([
  "NamedSentence",
  "TranslatedSentence",
]);

// A property or attribute holding one field, or a list of them.
const FIELD_HOLDER: RegExp = /^[a-z]\w*Field$/;
const FIELD_LIST_HOLDER: RegExp = /^[a-z]\w*Fields$/;

// Arrays of choices, by the property that holds them.
const OPTION_LISTS: ReadonlySet<string> = new Set<string>([
  "cardSelectOptions",
  "radioButtonOptions",
  "dropdownOptions",
]);
// Types of a choice, for choices built away from the field.
const OPTION_TYPES: ReadonlySet<string> = new Set<string>([
  "CardSelectOption",
  "RadioButton",
  "DropdownOption",
]);
// Help that waits to be asked for: never measured.
const HELP_PROPERTIES: ReadonlySet<string> = new Set<string>([
  "helpContent",
  "tooltip",
]);

// Field types whose fallback description BasicModelForm leaves out.
const NO_COLUMN_DESCRIPTION_TYPE: RegExp = /FormFieldSchemaType\.Color\b/;
const FORM_FIELD_TYPE: RegExp = /^FormFieldSchemaType\./;
const DETAIL_FIELD_TYPE: RegExp = /^FieldType\./;
const MODEL_MODULE: RegExp = /Models\/(DatabaseModels|AnalyticsModels)\//;
// A type parameter (TBaseModel, T), never a model.
const TYPE_PARAMETER_NAME: RegExp = /^T([A-Z]\w*)?$/;

interface ImportedName {
  specifier: string;
  imported: string;
  isDefault: boolean;
}

interface Located {
  file: string;
  node: ts.Node;
}

interface FoundText {
  text: string;
  file: string;
  node: ts.Node;
}

interface ColumnText {
  text: string;
  node: ts.Node;
}

export class DescriptionScanner {
  private readonly repoRoot: string;
  private readonly reader: SourceReader;
  private readonly parsed: Map<string, ts.SourceFile> = new Map<
    string,
    ts.SourceFile
  >();
  private readonly columnDescriptions: Map<string, Map<string, ColumnText>> =
    new Map<string, Map<string, ColumnText>>();
  private readonly locales: Map<string, unknown> = new Map<string, unknown>();

  public constructor(data: { repoRoot: string; reader?: SourceReader }) {
    this.repoRoot = data.repoRoot;
    this.reader = data.reader || DISK_READER;
  }

  // Every description under the given roots (from the repository root).
  public scan(roots: ReadonlyArray<string>): Array<FoundDescription> {
    const found: Array<FoundDescription> = [];
    const seen: Set<string> = new Set<string>();

    for (const root of roots) {
      for (const file of this.listFiles(path.join(this.repoRoot, root))) {
        for (const description of this.scanFile(file)) {
          const key: string = `${description.kind}|${description.where}|${description.text}`;

          if (!seen.has(key)) {
            seen.add(key);
            found.push(description);
          }
        }
      }
    }

    return found;
  }

  public listFiles(root: string): Array<string> {
    if (this.reader.isFile(root)) {
      return SOURCE_FILE.test(root) ? [root] : [];
    }

    if (!this.reader.isDirectory(root)) {
      return [];
    }

    const files: Array<string> = [];

    for (const name of this.reader.list(root).sort()) {
      const full: string = path.join(root, name);

      if (this.reader.isDirectory(full)) {
        if (!SKIPPED_DIRECTORIES.has(name)) {
          files.push(...this.listFiles(full));
        }
      } else if (SOURCE_FILE.test(name) && !SKIPPED_FILE.test(name)) {
        files.push(full);
      }
    }

    return files;
  }

  public scanFile(file: string): Array<FoundDescription> {
    const found: Array<FoundDescription> = [];

    const add: (
      kind: DescriptionKind,
      owner: string,
      node: ts.Node,
      texts: Array<FoundText>,
    ) => void = (
      kind: DescriptionKind,
      owner: string,
      node: ts.Node,
      texts: Array<FoundText>,
    ): void => {
      for (const text of texts) {
        const shown: string = text.text.replace(WHITESPACE, " ").trim();

        if (!shown) {
          continue;
        }

        found.push({
          kind: kind,
          where: this.where(file, node),
          writtenAt:
            text.file === file && this.isInside(text.node, node)
              ? null
              : this.where(text.file, text.node),
          owner: owner,
          text: shown,
        });
      }
    };

    const visit: (node: ts.Node) => void = (node: ts.Node): void => {
      if (ts.isObjectLiteralExpression(node)) {
        this.visitObject(file, node, add);
      }

      if (ts.isJsxAttribute(node) && node.initializer) {
        this.visitAttribute(file, node, add);
      }

      if (ts.isCallExpression(node)) {
        this.visitCall(file, node, add);
      }

      ts.forEachChild(node, visit);
    };

    visit(this.parse(file));

    return found;
  }

  private visitObject(
    file: string,
    node: ts.ObjectLiteralExpression,
    add: (
      kind: DescriptionKind,
      owner: string,
      node: ts.Node,
      texts: Array<FoundText>,
    ) => void,
  ): void {
    const properties: Map<string, ts.Node> = this.propertiesOf(node);
    const holder: string = this.holderName(node);

    if (HELP_PROPERTIES.has(holder)) {
      return;
    }

    const fieldType: ts.Node | undefined = properties.get("fieldType");
    const fieldTypeText: string = fieldType ? fieldType.getText() : "";
    const isFormField: boolean = FORM_FIELD_TYPE.test(fieldTypeText);
    const isDetailField: boolean = DETAIL_FIELD_TYPE.test(fieldTypeText);

    for (const [name, value] of properties) {
      if (!DESCRIPTION_NAMES.has(name)) {
        continue;
      }

      const kind: DescriptionKind | null = this.objectKind({
        name: name,
        holder: holder,
        properties: properties,
        isFormField: isFormField,
        isDetailField: isDetailField,
        node: node,
      });

      if (kind) {
        add(kind, holder, node, this.textsOf(file, value, 0));
      }
    }

    /*
     * A form field with no description of its own shows its column's
     * (BasicModelForm), which was written for the API reference - unless it
     * says it shows none (Field.hideColumnDescription: true), which
     * BasicModelForm honours too.
     */
    const hidesColumnDescription: boolean =
      properties.get("hideColumnDescription")?.kind ===
      ts.SyntaxKind.TrueKeyword;

    if (
      isFormField &&
      !properties.has("description") &&
      !hidesColumnDescription &&
      !NO_COLUMN_DESCRIPTION_TYPE.test(fieldTypeText)
    ) {
      const field: ts.Node | undefined = properties.get("field");

      if (field && ts.isObjectLiteralExpression(field)) {
        const first: ts.ObjectLiteralElementLike | undefined =
          field.properties[0];
        const column: string | null =
          first &&
          (ts.isPropertyAssignment(first) ||
            ts.isShorthandPropertyAssignment(first))
            ? this.propertyName(first.name)
            : null;
        const model: string | null = this.modelOf(node);
        const modelFile: string | null = model
          ? this.modelFile(file, model)
          : null;
        const description: ColumnText | null =
          modelFile && column
            ? this.columnDescription(modelFile, column)
            : null;

        if (modelFile && description) {
          add("column", `${model}.${column}`, node, [
            {
              text: description.text,
              file: modelFile,
              node: description.node,
            },
          ]);
        }
      }
    }
  }

  private objectKind(data: {
    name: string;
    holder: string;
    properties: Map<string, ts.Node>;
    isFormField: boolean;
    isDetailField: boolean;
    node: ts.ObjectLiteralExpression;
  }): DescriptionKind | null {
    const { name, holder, properties } = data;

    if (EMPTY_NAMES.has(name)) {
      return "empty";
    }

    if (data.isFormField) {
      return name === "description" || name === "sectionDescription"
        ? name === "sectionDescription"
          ? "section"
          : "field"
        : null;
    }

    if (data.isDetailField) {
      return name === "description" ? "detail" : null;
    }

    /*
     * A field handed to a component by name (nameField, descriptionField) or
     * in a list of them (identityFields): the component draws it in a form.
     */
    if (
      name === "description" &&
      (FIELD_HOLDER.test(holder) ||
        FIELD_LIST_HOLDER.test(this.listHolderName(data.node)))
    ) {
      return "field";
    }

    if (name === "cardDescription") {
      return "card";
    }

    if (holder === "cardProps") {
      return name === "description" ? "card" : null;
    }

    if (
      holder === "collapsibleSection" ||
      holder === "getAdvancedFormSection"
    ) {
      return name === "description" ? "section" : null;
    }

    if (name === "getDescription") {
      return "switch";
    }

    if (
      name === "note" &&
      properties.has("title") &&
      (properties.has("column") || properties.has("getDescription"))
    ) {
      return "switch";
    }

    if (name !== "description") {
      return null;
    }

    if (properties.has("title") && properties.has("submitButtonText")) {
      return "dialog";
    }

    if (properties.has("title") && properties.has("column")) {
      return "switch";
    }

    if (this.isOption(data.node)) {
      return "option";
    }

    return null;
  }

  private visitAttribute(
    file: string,
    node: ts.JsxAttribute,
    add: (
      kind: DescriptionKind,
      owner: string,
      node: ts.Node,
      texts: Array<FoundText>,
    ) => void,
  ): void {
    const name: string = node.name.getText();

    if (!DESCRIPTION_NAMES.has(name) || !node.initializer) {
      return;
    }

    const value: ts.Node | undefined = ts.isJsxExpression(node.initializer)
      ? node.initializer.expression
      : node.initializer;
    const tag: string = this.tagOf(node);
    const kind: DescriptionKind | null = this.attributeKind(name, tag);

    if (kind && value) {
      add(kind, tag, node, this.textsOf(file, value, 0));
    }
  }

  private attributeKind(name: string, tag: string): DescriptionKind | null {
    if (TOOLTIP_TAGS.has(tag) || TOOLTIP_TAG_ENDING.test(tag)) {
      return null;
    }

    if (EMPTY_NAMES.has(name) || EMPTY_TAG.test(tag)) {
      return "empty";
    }

    if (name === "cardDescription") {
      return "card";
    }

    if (DIALOG_TAG.test(tag) || DIALOG_TAGS.has(tag)) {
      return name === "description" ? "dialog" : null;
    }

    if (SWITCH_TAG.test(tag)) {
      return "switch";
    }

    if (name !== "description") {
      return null;
    }

    if (FIELD_TAGS.has(tag)) {
      return "field";
    }

    if (tag === "Page") {
      return "page";
    }

    if (tag === "Banner" || (CARD_TAG.test(tag) && !NOT_A_CARD_TAG.test(tag))) {
      return "card";
    }

    return null;
  }

  // getAdvancedFormSection({ description: "..." }) and the like.
  private visitCall(
    file: string,
    node: ts.CallExpression,
    add: (
      kind: DescriptionKind,
      owner: string,
      node: ts.Node,
      texts: Array<FoundText>,
    ) => void,
  ): void {
    if (this.calleeName(node.expression) !== "getAdvancedFormSection") {
      return;
    }

    const argument: ts.Expression | undefined = node.arguments[0];

    if (argument && ts.isObjectLiteralExpression(argument)) {
      const description: ts.Node | undefined =
        this.propertiesOf(argument).get("description");

      if (description) {
        add(
          "section",
          "getAdvancedFormSection",
          argument,
          this.textsOf(file, description, 0),
        );
      }
    }
  }

  // Whether an object is one choice of a field: a card, a radio, an option.
  private isOption(node: ts.ObjectLiteralExpression): boolean {
    let current: ts.Node = node;

    for (let depth: number = 0; depth < 6 && current.parent; depth++) {
      const parent: ts.Node = current.parent;

      if (ts.isPropertyAssignment(parent)) {
        const name: string | null = this.propertyName(parent.name);
        return Boolean(name && OPTION_LISTS.has(name));
      }

      if (
        (ts.isVariableDeclaration(parent) ||
          ts.isPropertyDeclaration(parent) ||
          ts.isParameter(parent)) &&
        parent.type
      ) {
        return this.namesType(parent.type, OPTION_TYPES);
      }

      if (
        (ts.isArrowFunction(parent) ||
          ts.isFunctionDeclaration(parent) ||
          ts.isFunctionExpression(parent) ||
          ts.isMethodDeclaration(parent)) &&
        parent.type
      ) {
        return this.namesType(parent.type, OPTION_TYPES);
      }

      if (ts.isReturnStatement(parent) || ts.isBlock(parent)) {
        current = parent;
        continue;
      }

      if (
        ts.isArrayLiteralExpression(parent) ||
        ts.isParenthesizedExpression(parent) ||
        ts.isAsExpression(parent) ||
        ts.isConditionalExpression(parent) ||
        ts.isCallExpression(parent)
      ) {
        current = parent;
        continue;
      }

      return false;
    }

    return false;
  }

  private namesType(type: ts.TypeNode, names: ReadonlySet<string>): boolean {
    let named: boolean = false;

    const visit: (node: ts.Node) => void = (node: ts.Node): void => {
      if (named) {
        return;
      }

      if (
        ts.isTypeReferenceNode(node) &&
        ts.isIdentifier(node.typeName) &&
        names.has(node.typeName.text)
      ) {
        named = true;
        return;
      }

      ts.forEachChild(node, visit);
    };

    visit(type);

    return named;
  }

  /*
   * The name of what holds an object: the property it is assigned to
   * (cardProps, collapsibleSection), the attribute it is passed as, or the
   * function it is handed to.
   */
  private holderName(node: ts.ObjectLiteralExpression): string {
    let current: ts.Node = node;

    while (
      current.parent &&
      (ts.isParenthesizedExpression(current.parent) ||
        ts.isAsExpression(current.parent))
    ) {
      current = current.parent;
    }

    const parent: ts.Node | undefined = current.parent;

    if (!parent) {
      return "";
    }

    if (ts.isPropertyAssignment(parent)) {
      return this.propertyName(parent.name) || "";
    }

    if (
      ts.isJsxExpression(parent) &&
      parent.parent &&
      ts.isJsxAttribute(parent.parent)
    ) {
      return parent.parent.name.getText();
    }

    if (ts.isCallExpression(parent)) {
      return this.calleeName(parent.expression);
    }

    if (ts.isVariableDeclaration(parent) && parent.type) {
      return parent.type.getText();
    }

    return "";
  }

  // The name an array an object sits in is held by: identityFields={[...]}.
  private listHolderName(node: ts.ObjectLiteralExpression): string {
    const list: ts.Node | undefined = node.parent;

    if (!list || !ts.isArrayLiteralExpression(list)) {
      return "";
    }

    const holder: ts.Node | undefined = list.parent;

    if (holder && ts.isPropertyAssignment(holder)) {
      return this.propertyName(holder.name) || "";
    }

    if (
      holder &&
      ts.isJsxExpression(holder) &&
      holder.parent &&
      ts.isJsxAttribute(holder.parent)
    ) {
      return holder.parent.name.getText();
    }

    return "";
  }

  private tagOf(attribute: ts.JsxAttribute): string {
    const element: ts.Node = attribute.parent.parent;

    if (
      ts.isJsxOpeningElement(element) ||
      ts.isJsxSelfClosingElement(element)
    ) {
      const tag: string = element.tagName.getText();
      const lastDot: number = tag.lastIndexOf(".");
      return lastDot > -1 ? tag.slice(lastDot + 1) : tag;
    }

    return "";
  }

  private propertiesOf(node: ts.ObjectLiteralExpression): Map<string, ts.Node> {
    const properties: Map<string, ts.Node> = new Map<string, ts.Node>();

    for (const property of node.properties) {
      if (ts.isPropertyAssignment(property)) {
        const name: string | null = this.propertyName(property.name);

        if (name) {
          properties.set(name, property.initializer);
        }
      } else if (ts.isShorthandPropertyAssignment(property)) {
        properties.set(property.name.text, property.name);
      } else if (ts.isMethodDeclaration(property)) {
        const name: string | null = this.propertyName(property.name);

        if (name) {
          properties.set(name, property);
        }
      }
    }

    return properties;
  }

  private propertyName(name: ts.Node): string | null {
    if (
      ts.isIdentifier(name) ||
      ts.isStringLiteral(name) ||
      ts.isNoSubstitutionTemplateLiteral(name)
    ) {
      return name.text;
    }

    return null;
  }

  private calleeName(expression: ts.Expression): string {
    if (ts.isIdentifier(expression)) {
      return expression.text;
    }

    if (ts.isPropertyAccessExpression(expression)) {
      return expression.name.text;
    }

    return "";
  }

  public parse(file: string): ts.SourceFile {
    let sourceFile: ts.SourceFile | undefined = this.parsed.get(file);

    if (!sourceFile) {
      sourceFile = ts.createSourceFile(
        file,
        this.reader.read(file),
        ts.ScriptTarget.Latest,
        true,
        file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
      );
      this.parsed.set(file, sourceFile);
    }

    return sourceFile;
  }

  private where(file: string, node: ts.Node): string {
    const sourceFile: ts.SourceFile = this.parse(file);
    const line: number =
      sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line +
      1;

    return `${path.relative(this.repoRoot, file).split(path.sep).join("/")}:${line}`;
  }

  private isInside(inner: ts.Node, outer: ts.Node): boolean {
    return inner.pos >= outer.pos && inner.end <= outer.end;
  }

  private findImport(file: string, name: string): ImportedName | null {
    for (const statement of this.parse(file).statements) {
      if (
        !ts.isImportDeclaration(statement) ||
        !statement.importClause ||
        !ts.isStringLiteral(statement.moduleSpecifier)
      ) {
        continue;
      }

      const specifier: string = statement.moduleSpecifier.text;
      const clause: ts.ImportClause = statement.importClause;

      if (clause.name && clause.name.text === name) {
        return { specifier, imported: "default", isDefault: true };
      }

      if (clause.namedBindings && ts.isNamedImports(clause.namedBindings)) {
        for (const element of clause.namedBindings.elements) {
          if (element.name.text === name) {
            return {
              specifier,
              imported: (element.propertyName || element.name).text,
              isDefault: false,
            };
          }
        }
      }
    }

    return null;
  }

  public resolveModule(file: string, specifier: string): string | null {
    let base: string | null = null;

    if (specifier.startsWith(".")) {
      base = path.resolve(path.dirname(file), specifier);
    } else {
      for (const alias of MODULE_ALIASES) {
        if (specifier.startsWith(alias.prefix)) {
          base = path.join(
            this.repoRoot,
            alias.directory,
            specifier.slice(alias.prefix.length),
          );
          break;
        }
      }
    }

    if (!base) {
      return null;
    }

    for (const candidate of [
      `${base}.ts`,
      `${base}.tsx`,
      path.join(base, "index.ts"),
      path.join(base, "Index.ts"),
    ]) {
      if (this.reader.isFile(candidate)) {
        return candidate;
      }
    }

    return null;
  }

  // A constant or function declared anywhere in a file, by name.
  private findDeclaration(file: string, name: string): ts.Node | null {
    let found: ts.Node | null = null;

    const visit: (node: ts.Node) => void = (node: ts.Node): void => {
      if (found) {
        return;
      }

      if (
        ts.isVariableDeclaration(node) &&
        ts.isIdentifier(node.name) &&
        node.name.text === name &&
        node.initializer
      ) {
        found = node.initializer;
        return;
      }

      if (
        ts.isFunctionDeclaration(node) &&
        node.name &&
        node.name.text === name
      ) {
        found = node;
        return;
      }

      ts.forEachChild(node, visit);
    };

    visit(this.parse(file));

    return found;
  }

  private defaultExport(file: string): ts.Expression | null {
    for (const statement of this.parse(file).statements) {
      if (ts.isExportAssignment(statement)) {
        return statement.expression;
      }
    }

    return null;
  }

  // What a name stands for: a constant of this file or of a module it imports.
  private resolveName(
    file: string,
    name: string,
    depth: number,
  ): Located | null {
    if (depth > 12) {
      return null;
    }

    const local: ts.Node | null = this.findDeclaration(file, name);

    if (local) {
      return { file, node: local };
    }

    const imported: ImportedName | null = this.findImport(file, name);

    if (!imported) {
      return null;
    }

    const target: string | null = this.resolveModule(file, imported.specifier);

    if (!target) {
      return null;
    }

    if (imported.isDefault) {
      const exported: ts.Expression | null = this.defaultExport(target);

      if (exported && ts.isIdentifier(exported)) {
        return this.resolveName(target, exported.text, depth + 1);
      }

      return exported ? { file: target, node: exported } : null;
    }

    const declaration: ts.Node | null = this.findDeclaration(
      target,
      imported.imported,
    );

    return declaration ? { file: target, node: declaration } : null;
  }

  // A name or a chain of property reads (COPY.title.text) to what it holds.
  private resolveExpression(
    file: string,
    node: ts.Node,
    depth: number,
  ): Located | null {
    if (depth > 12) {
      return null;
    }

    if (ts.isIdentifier(node)) {
      return this.resolveName(file, node.text, depth + 1);
    }

    if (ts.isPropertyAccessExpression(node)) {
      let base: Located | null = this.resolveExpression(
        file,
        node.expression,
        depth + 1,
      );

      while (base && this.isWrapper(base.node)) {
        base = { file: base.file, node: this.unwrap(base.node) };
      }

      if (base && ts.isIdentifier(base.node)) {
        base = this.resolveName(base.file, base.node.text, depth + 1);
      }

      if (base && ts.isObjectLiteralExpression(base.node)) {
        const value: ts.Node | undefined = this.propertiesOf(base.node).get(
          node.name.text,
        );

        if (value) {
          return { file: base.file, node: value };
        }
      }
    }

    return null;
  }

  private isWrapper(node: ts.Node): boolean {
    return (
      ts.isAsExpression(node) ||
      ts.isParenthesizedExpression(node) ||
      ts.isSatisfiesExpression(node) ||
      ts.isNonNullExpression(node)
    );
  }

  private unwrap(node: ts.Node): ts.Node {
    let current: ts.Node = node;

    while (
      ts.isAsExpression(current) ||
      ts.isParenthesizedExpression(current) ||
      ts.isSatisfiesExpression(current) ||
      ts.isNonNullExpression(current)
    ) {
      current = current.expression;
    }

    return current;
  }

  /*
   * Every text an expression can show: a literal, a template (its values
   * as {{name}}), both sides of a ternary, an || or a ??, a sum of texts,
   * the key of a translation call, what a function returns, the text of a
   * JSX element, and a constant or copy object's property, followed to the
   * module it is written in.
   */
  public textsOf(
    file: string,
    node: ts.Node | undefined,
    depth: number,
  ): Array<FoundText> {
    if (!node || depth > 14) {
      return [];
    }

    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      return [{ text: node.text, file, node }];
    }

    if (ts.isTemplateExpression(node)) {
      let text: string = node.head.text;

      for (const span of node.templateSpans) {
        const name: string = span.expression
          .getText()
          .replace(NOT_A_NAME_CHARACTER, "")
          .slice(0, 12);
        text += `{{${name}}}${span.literal.text}`;
      }

      return [{ text, file, node }];
    }

    if (this.isWrapper(node)) {
      return this.textsOf(file, this.unwrap(node), depth + 1);
    }

    if (ts.isConditionalExpression(node)) {
      return [
        ...this.textsOf(file, node.whenTrue, depth + 1),
        ...this.textsOf(file, node.whenFalse, depth + 1),
      ];
    }

    if (ts.isBinaryExpression(node)) {
      const operator: ts.SyntaxKind = node.operatorToken.kind;

      if (
        operator === ts.SyntaxKind.BarBarToken ||
        operator === ts.SyntaxKind.QuestionQuestionToken
      ) {
        return [
          ...this.textsOf(file, node.left, depth + 1),
          ...this.textsOf(file, node.right, depth + 1),
        ];
      }

      if (operator === ts.SyntaxKind.AmpersandAmpersandToken) {
        return this.textsOf(file, node.right, depth + 1);
      }

      if (operator === ts.SyntaxKind.PlusToken) {
        const left: Array<FoundText> = this.textsOf(file, node.left, depth + 1);
        const right: Array<FoundText> = this.textsOf(
          file,
          node.right,
          depth + 1,
        );
        const first: FoundText | undefined = left[0];
        const second: FoundText | undefined = right[0];

        if (first && second) {
          return [{ text: first.text + second.text, file, node }];
        }

        return [...left, ...right];
      }

      return [];
    }

    if (
      ts.isArrowFunction(node) ||
      ts.isFunctionExpression(node) ||
      ts.isFunctionDeclaration(node) ||
      ts.isMethodDeclaration(node)
    ) {
      const body: ts.Node | undefined = node.body;

      if (!body) {
        return [];
      }

      if (!ts.isBlock(body)) {
        return this.textsOf(file, body, depth + 1);
      }

      const returned: Array<FoundText> = [];

      const visit: (child: ts.Node) => void = (child: ts.Node): void => {
        if (
          ts.isArrowFunction(child) ||
          ts.isFunctionExpression(child) ||
          ts.isFunctionDeclaration(child)
        ) {
          return;
        }

        if (ts.isReturnStatement(child) && child.expression) {
          returned.push(...this.textsOf(file, child.expression, depth + 1));
        }

        ts.forEachChild(child, visit);
      };

      visit(body);

      return returned;
    }

    if (ts.isCallExpression(node)) {
      // translatePlural({ one, other }, count): either form is drawn.
      if (PLURAL_CALL.test(this.calleeName(node.expression))) {
        return this.pluralTexts(file, node.arguments[0], depth + 1);
      }

      if (TRANSLATION_CALL.test(this.calleeName(node.expression))) {
        const keys: Array<FoundText> = this.textsOf(
          file,
          node.arguments[0],
          depth + 1,
        );

        // t("pages.settings.fieldDescription"): the English it names.
        return keys.map((key: FoundText): FoundText => {
          const english: string | null = NESTED_KEY.test(key.text)
            ? this.englishOfNestedKey(file, key.text)
            : null;

          return english === null ? key : { ...key, text: english };
        });
      }

      return [];
    }

    if (ts.isIdentifier(node) || ts.isPropertyAccessExpression(node)) {
      const resolved: Located | null = this.resolveExpression(
        file,
        node,
        depth + 1,
      );

      return resolved
        ? this.textsOf(resolved.file, resolved.node, depth + 1)
        : [];
    }

    if (
      ts.isJsxElement(node) ||
      ts.isJsxFragment(node) ||
      ts.isJsxSelfClosingElement(node)
    ) {
      return this.jsxTexts(file, node, depth);
    }

    return [];
  }

  // translatePlural(...), by its callee, however it is reached.
  private isPluralCall(node: ts.Node | undefined): boolean {
    if (!node) {
      return false;
    }

    const unwrapped: ts.Node = this.isWrapper(node) ? this.unwrap(node) : node;

    return (
      ts.isCallExpression(unwrapped) &&
      PLURAL_CALL.test(this.calleeName(unwrapped.expression))
    );
  }

  /*
   * Both sentences of a count-dependent template - { one: "...", other:
   * "..." } written in place, or a constant holding one - which
   * translatePlural and a TranslatedSentence with a count draw. Empty for
   * anything that is not a PluralTemplate.
   */
  public pluralTexts(
    file: string,
    node: ts.Node | undefined,
    depth: number,
  ): Array<FoundText> {
    if (!node || depth > 14) {
      return [];
    }

    if (this.isWrapper(node)) {
      return this.pluralTexts(file, this.unwrap(node), depth + 1);
    }

    if (ts.isIdentifier(node) || ts.isPropertyAccessExpression(node)) {
      const resolved: Located | null = this.resolveExpression(
        file,
        node,
        depth + 1,
      );

      return resolved
        ? this.pluralTexts(resolved.file, resolved.node, depth + 1)
        : [];
    }

    if (!ts.isObjectLiteralExpression(node)) {
      return [];
    }

    const properties: Map<string, ts.Node> = this.propertiesOf(node);

    if (
      !PLURAL_FORMS.every((form: string): boolean => {
        return properties.has(form);
      })
    ) {
      return [];
    }

    return PLURAL_FORMS.flatMap((form: string): Array<FoundText> => {
      return this.textsOf(file, properties.get(form), depth + 1);
    });
  }

  /*
   * The sentence a JSX description reads as: its text, with the text of
   * links and emphasis in it, and a TranslatedSentence's template. A JSX
   * description with blocks in it - paragraphs, a list, a code sample, a
   * row of values to copy - is a layout of its own, not a sentence, and is
   * not measured.
   */
  private jsxTexts(
    file: string,
    node: ts.JsxElement | ts.JsxFragment | ts.JsxSelfClosingElement,
    depth: number,
  ): Array<FoundText> {
    const parts: Array<string> = [];
    let isLayout: boolean = false;

    const visit: (child: ts.Node) => void = (child: ts.Node): void => {
      if (isLayout) {
        return;
      }

      if (ts.isJsxElement(child) || ts.isJsxSelfClosingElement(child)) {
        const opening: ts.JsxOpeningElement | ts.JsxSelfClosingElement =
          ts.isJsxElement(child) ? child.openingElement : child;
        const tag: string = opening.tagName.getText();

        if (SENTENCE_TAGS.has(tag)) {
          for (const attribute of opening.attributes.properties) {
            if (
              ts.isJsxAttribute(attribute) &&
              attribute.name.getText() === "template" &&
              attribute.initializer
            ) {
              const value: ts.Node | undefined = ts.isJsxExpression(
                attribute.initializer,
              )
                ? attribute.initializer.expression
                : attribute.initializer;
              /*
               * A count-dependent template draws one of its forms: the
               * longer is the one that has to fit.
               */
              const forms: Array<FoundText> = this.pluralTexts(
                file,
                value,
                depth + 1,
              );
              const template: FoundText | undefined =
                forms.length > 0
                  ? longestText(forms)
                  : this.textsOf(file, value, depth + 1)[0];

              if (template) {
                parts.push(template.text);
              }
            }
          }

          return;
        }

        if (!INLINE_TAGS.has(tag)) {
          isLayout = true;
          return;
        }
      }

      if (ts.isJsxText(child)) {
        const text: string = child.text.replace(WHITESPACE, " ").trim();

        if (text) {
          parts.push(text);
        }

        return;
      }

      if (ts.isJsxExpression(child)) {
        const texts: Array<FoundText> = this.textsOf(
          file,
          child.expression,
          depth + 1,
        );
        /*
         * A count-dependent sentence draws one of its forms: the longer is
         * the one that has to fit.
         */
        const inner: FoundText | undefined = this.isPluralCall(child.expression)
          ? longestText(texts)
          : texts[0];

        if (inner) {
          parts.push(inner.text);
        }

        return;
      }

      if (ts.isJsxAttributes(child)) {
        return;
      }

      ts.forEachChild(child, visit);
    };

    visit(node);

    if (isLayout || parts.length === 0) {
      return [];
    }

    return [{ text: parts.join(" "), file, node }];
  }

  // The English a nested key names in the locale of the file's frontend.
  private englishOfNestedKey(file: string, key: string): string | null {
    const fromRoot: string = path
      .relative(this.repoRoot, file)
      .split(path.sep)
      .join("/");
    const entry: { directory: string; locale: string } | undefined =
      ENGLISH_LOCALES.find(
        (candidate: { directory: string; locale: string }): boolean => {
          return fromRoot.startsWith(candidate.directory);
        },
      );

    if (!entry) {
      return null;
    }

    const localeFile: string = path.join(this.repoRoot, entry.locale);

    if (!this.locales.has(localeFile)) {
      this.locales.set(
        localeFile,
        this.reader.isFile(localeFile)
          ? JSON.parse(this.reader.read(localeFile))
          : null,
      );
    }

    let value: unknown = this.locales.get(localeFile);

    for (const part of key.split(".")) {
      if (!value || typeof value !== "object") {
        return null;
      }

      value = (value as Record<string, unknown>)[part];
    }

    return typeof value === "string" ? value : null;
  }

  /*
   * The model a form field belongs to: the modelType of the nearest JSX
   * element around it (a ModelTable's, a ModelFormModal's, a
   * CardModelDetail's modelDetailProps), or the model a typed list of
   * fields names (Fields<Monitor>, Array<ModelField<Probe>>).
   */
  private modelOf(node: ts.Node): string | null {
    let current: ts.Node | undefined = node.parent;

    while (current) {
      if (
        ts.isJsxOpeningElement(current) ||
        ts.isJsxSelfClosingElement(current)
      ) {
        for (const attribute of current.attributes.properties) {
          if (
            !ts.isJsxAttribute(attribute) ||
            !attribute.initializer ||
            !ts.isJsxExpression(attribute.initializer) ||
            !attribute.initializer.expression
          ) {
            continue;
          }

          const name: string = attribute.name.getText();
          const expression: ts.Expression = attribute.initializer.expression;

          if (name === "modelType" && ts.isIdentifier(expression)) {
            return expression.text;
          }

          if (
            name === "modelDetailProps" &&
            ts.isObjectLiteralExpression(expression)
          ) {
            const modelType: ts.Node | undefined =
              this.propertiesOf(expression).get("modelType");

            if (modelType && ts.isIdentifier(modelType)) {
              return modelType.text;
            }
          }
        }
      }

      const type: ts.TypeNode | undefined =
        ts.isVariableDeclaration(current) ||
        ts.isPropertyDeclaration(current) ||
        ts.isFunctionDeclaration(current) ||
        ts.isArrowFunction(current) ||
        ts.isFunctionExpression(current) ||
        ts.isMethodDeclaration(current)
          ? current.type
          : undefined;

      if (type) {
        const model: string | null = this.modelInType(type);

        if (model) {
          return model;
        }
      }

      current = current.parent;
    }

    return null;
  }

  private modelInType(type: ts.TypeNode): string | null {
    let model: string | null = null;

    const visit: (node: ts.Node) => void = (node: ts.Node): void => {
      if (model) {
        return;
      }

      if (ts.isTypeReferenceNode(node) && node.typeArguments) {
        for (const argument of node.typeArguments) {
          if (
            ts.isTypeReferenceNode(argument) &&
            ts.isIdentifier(argument.typeName) &&
            !argument.typeArguments &&
            !TYPE_PARAMETER_NAME.test(argument.typeName.text)
          ) {
            model = argument.typeName.text;
            return;
          }
        }
      }

      ts.forEachChild(node, visit);
    };

    visit(type);

    return model;
  }

  private modelFile(file: string, model: string): string | null {
    const imported: ImportedName | null = this.findImport(file, model);

    if (
      !imported ||
      !imported.isDefault ||
      !MODEL_MODULE.test(imported.specifier)
    ) {
      return null;
    }

    return this.resolveModule(file, imported.specifier);
  }

  // A model column's description, from its @TableColumn({ description }).
  private columnDescription(
    modelFile: string,
    column: string,
  ): ColumnText | null {
    let descriptions: Map<string, ColumnText> | undefined =
      this.columnDescriptions.get(modelFile);

    if (!descriptions) {
      const read: Map<string, ColumnText> = new Map<string, ColumnText>();
      descriptions = read;

      const visit: (node: ts.Node) => void = (node: ts.Node): void => {
        if (ts.isPropertyDeclaration(node) && ts.isIdentifier(node.name)) {
          const decorators: ReadonlyArray<ts.Decorator> =
            (ts.canHaveDecorators(node) ? ts.getDecorators(node) : undefined) ||
            [];

          for (const decorator of decorators) {
            const call: ts.Expression = decorator.expression;
            const argument: ts.Expression | undefined = ts.isCallExpression(
              call,
            )
              ? call.arguments[0]
              : undefined;

            if (
              ts.isCallExpression(call) &&
              this.calleeName(call.expression) === "TableColumn" &&
              argument &&
              ts.isObjectLiteralExpression(argument)
            ) {
              const description: ts.Node | undefined =
                this.propertiesOf(argument).get("description");
              const text: FoundText | undefined = description
                ? this.textsOf(modelFile, description, 0)[0]
                : undefined;

              if (text && description) {
                read.set(node.name.text, {
                  text: text.text,
                  node: description,
                });
              }
            }
          }
        }

        ts.forEachChild(node, visit);
      };

      visit(this.parse(modelFile));
      this.columnDescriptions.set(modelFile, descriptions);
    }

    return descriptions.get(column) || null;
  }
}

// Every description in the frontends, read from disk.
export function scanProductDescriptions(): Array<FoundDescription> {
  return new DescriptionScanner({ repoRoot: REPO_ROOT }).scan(SCANNED_ROOTS);
}

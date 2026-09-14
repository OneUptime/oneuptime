import DashboardBaseComponent from "../../../Types/Dashboard/DashboardComponents/DashboardBaseComponent";
import DashboardComponentType from "../../../Types/Dashboard/DashboardComponentType";
import DashboardViewConfig from "../../../Types/Dashboard/DashboardViewConfig";
import {
  DashboardTemplate,
  DashboardTemplates,
  DashboardTemplateType,
  getTemplateConfig,
} from "../../../Types/Dashboard/DashboardTemplates";
import ValueFormatter from "../../../Utils/ValueFormatter";

/*
 * EDITORIAL invariants that must hold for EVERY dashboard template,
 * present and future. The structural layer — grid bounds, overlap, unique
 * ids, the misspelled `aggegationType`, gauge threshold ordering, variable
 * shape, Slo widget wiring — lives in DashboardTemplateInvariants and is
 * deliberately not repeated here.
 *
 * This file is the layer above it: a template can satisfy every structural
 * rule and still read badly. A header stranded over an empty band, two
 * gauges with the same name, the same series printed twice, a paragraph
 * dropped into a one-row Text widget, an unbounded list — none of those
 * are type errors, none overlap anything, and all of them ship a dashboard
 * that a reader has to decipher rather than read.
 */

// The grid the dashboard renderer lays out against (DashboardSize.widthInDashboardUnits).
const GRID_WIDTH_IN_UNITS: number = 12;

/*
 * Blank is the "start from scratch" card: it has a catalog entry so it
 * shows up in the modal, but deliberately resolves to no config, so every
 * layout rule below skips it.
 */
const TEMPLATE_TYPES_WITH_CONFIG: Array<DashboardTemplateType> = Object.values(
  DashboardTemplateType,
).filter((type: DashboardTemplateType): boolean => {
  return type !== DashboardTemplateType.Blank;
});

interface LoadedTemplate {
  type: DashboardTemplateType;
  config: DashboardViewConfig;
}

function loadAllTemplates(): Array<LoadedTemplate> {
  return TEMPLATE_TYPES_WITH_CONFIG.map(
    (type: DashboardTemplateType): LoadedTemplate => {
      const config: DashboardViewConfig | null = getTemplateConfig(type);

      if (!config) {
        throw new Error(`Expected ${type} to resolve to a config`);
      }

      return { type: type, config: config };
    },
  );
}

function getArguments(
  component: DashboardBaseComponent,
): Record<string, unknown> {
  return (component.arguments as Record<string, unknown>) || {};
}

/*
 * Every widget family stores its human label under a different argument
 * key, and the label is the only stable handle a reader (or a test) has:
 * componentIds are regenerated on every getTemplateConfig() call and array
 * positions shift whenever a row is inserted.
 */
const TITLE_ARGUMENT_KEYS: Array<string> = [
  "title",
  "chartTitle",
  "gaugeTitle",
  "tableTitle",
  "widgetTitle",
  "text",
];

function titleOf(component: DashboardBaseComponent): string | undefined {
  const args: Record<string, unknown> = getArguments(component);

  for (const key of TITLE_ARGUMENT_KEYS) {
    const value: unknown = args[key];

    if (typeof value === "string") {
      return value;
    }
  }

  return undefined;
}

function describeComponent(
  type: DashboardTemplateType,
  component: DashboardBaseComponent,
): string {
  return `${type} ${component.componentType} "${
    titleOf(component) ?? "<untitled>"
  }" at row ${component.topInDashboardUnits}`;
}

function isTextWidget(component: DashboardBaseComponent): boolean {
  return component.componentType === DashboardComponentType.Text;
}

/*
 * A bold Text widget is what the templates use as a section heading — the
 * renderer gives it `font-semibold` and nothing else distinguishes it from
 * body copy (DashboardTextComponent).
 */
function isSectionHeader(component: DashboardBaseComponent): boolean {
  return isTextWidget(component) && getArguments(component)["isBold"] === true;
}

/*
 * The filterData block that reaches the metric fetch layer, or undefined
 * for widgets that do not query metrics at all (text, lists, log streams,
 * trace and Slo widgets).
 */
function getMetricFilterData(
  component: DashboardBaseComponent,
): Record<string, unknown> | undefined {
  const queryConfig: Record<string, unknown> | undefined = getArguments(
    component,
  )["metricQueryConfig"] as Record<string, unknown> | undefined;

  const queryData: Record<string, unknown> | undefined = queryConfig?.[
    "metricQueryData"
  ] as Record<string, unknown> | undefined;

  const filterData: Record<string, unknown> | undefined = queryData?.[
    "filterData"
  ] as Record<string, unknown> | undefined;

  if (!filterData || typeof filterData["metricName"] !== "string") {
    return undefined;
  }

  return filterData;
}

/*
 * Every widget family whose body is a row list. Derived from the component
 * enum rather than written out, so a new inventory widget is covered the
 * day it is added instead of the day someone remembers to extend a literal
 * array here.
 */
const LIST_COMPONENT_TYPES: Array<DashboardComponentType> = Object.values(
  DashboardComponentType,
).filter((componentType: DashboardComponentType): boolean => {
  return componentType.endsWith("List");
});

/*
 * DashboardTextComponent renders non-markdown text as ONE centred flex
 * line at `fontSize = min(componentHeightInPx * 0.35, 64)`, inside a card
 * whose wrapper is `overflow-hidden`. There is no graceful degradation: a
 * wrapped second line is clipped by the card, so over-long copy simply
 * stops mid-sentence.
 *
 * What fits is a RATIO rather than a pixel count, because the font scales
 * with the row. Running the canvas' own arithmetic (DashboardSize:
 * unit = (canvasWidth - 11 * 10) / 12, widgetWidth = w * unit + (w - 1) * 10,
 * less 12px of card padding and the component's own px-2 on each side), a
 * 12-column, one-row widget holds
 *
 *     (12 * unit + 110 - 40) / (0.35 * unit * averageAdvanceInEm)
 *
 * characters — 71 to 76 of them at an average advance of 0.5em, for canvas
 * widths from 768px to 1920px. The true average advance of the app's
 * semibold UI font sits somewhere in 0.46em-0.55em, so the honest capacity
 * is a band (very roughly 65-80 characters), not a single number.
 *
 * We take the LOOSE end of that band — 6.5 characters per grid column, so
 * 78 for the full-width rows every template uses today. Loose enough that
 * the test never adjudicates a borderline header, tight enough that a
 * paragraph pasted into a header row fails. Height divides the budget
 * because the font grows with the row while the width does not: a two-row
 * Text widget renders at roughly twice the font size and therefore fits
 * about HALF the characters, not double.
 */
const TEXT_CHARACTERS_PER_WIDTH_UNIT: number = 6.5;

function maximumTextLengthFor(component: DashboardBaseComponent): number {
  return Math.floor(
    (TEXT_CHARACTERS_PER_WIDTH_UNIT * component.widthInDashboardUnits) /
      component.heightInDashboardUnits,
  );
}

describe("DashboardTemplates editorial invariants (all templates)", () => {
  describe("opening title", () => {
    /*
     * The card the reader clicked in the "Create from Template" modal and
     * the heading they land on have to be the same words, or the dashboard
     * they just created looks like somebody else's. Equality against the
     * catalog entry — not merely "row 0 holds some bold text" — is what
     * makes renaming a catalog card without renaming its title row fail.
     */
    test("every template opens with a bold, full-width row that carries its catalog name", (): void => {
      const loadedTemplates: Array<LoadedTemplate> = loadAllTemplates();

      expect(loadedTemplates.length).toBeGreaterThan(0);

      for (const loaded of loadedTemplates) {
        const catalogEntry: DashboardTemplate | undefined =
          DashboardTemplates.find((template: DashboardTemplate): boolean => {
            return template.type === loaded.type;
          });

        expect(
          `${loaded.type} has a catalog entry: ${Boolean(catalogEntry)}`,
        ).toBe(`${loaded.type} has a catalog entry: true`);

        const openingRow: Array<DashboardBaseComponent> =
          loaded.config.components.filter(
            (component: DashboardBaseComponent): boolean => {
              return component.topInDashboardUnits === 0;
            },
          );

        expect(`${loaded.type} components on row 0: ${openingRow.length}`).toBe(
          `${loaded.type} components on row 0: 1`,
        );

        const title: DashboardBaseComponent = openingRow[0]!;
        const label: string = `${loaded.type} row 0`;

        expect(`${label} type=${title.componentType}`).toBe(
          `${label} type=${DashboardComponentType.Text}`,
        );
        expect(`${label} isBold=${getArguments(title)["isBold"]}`).toBe(
          `${label} isBold=true`,
        );
        expect(
          `${label} width=${title.widthInDashboardUnits} height=${title.heightInDashboardUnits}`,
        ).toBe(`${label} width=${GRID_WIDTH_IN_UNITS} height=1`);
        expect(`${label} text=${String(titleOf(title))}`).toBe(
          `${label} text=${(catalogEntry as DashboardTemplate).name}`,
        );
      }
    });
  });

  describe("section headers", () => {
    /*
     * A heading is a promise that something follows it. A bold Text widget
     * with nothing starting on the row beneath renders as a stranded label
     * over whitespace — which is exactly what is left behind when a widget
     * is deleted from a template and its header is not.
     */
    test("every bold section header is full width, one row tall, and has a widget directly beneath it", (): void => {
      const loadedTemplates: Array<LoadedTemplate> = loadAllTemplates();

      expect(loadedTemplates.length).toBeGreaterThan(0);

      let headersChecked: number = 0;

      for (const loaded of loadedTemplates) {
        const headers: Array<DashboardBaseComponent> =
          loaded.config.components.filter(isSectionHeader);

        for (const header of headers) {
          headersChecked++;

          const label: string = describeComponent(loaded.type, header);

          expect(
            `${label} width=${header.widthInDashboardUnits} height=${header.heightInDashboardUnits}`,
          ).toBe(`${label} width=${GRID_WIDTH_IN_UNITS} height=1`);

          const rowBeneath: number = header.topInDashboardUnits + 1;
          const widgetsBeneath: number = loaded.config.components.filter(
            (component: DashboardBaseComponent): boolean => {
              return component.topInDashboardUnits === rowBeneath;
            },
          ).length;

          expect(
            `${label} widgets starting on row ${rowBeneath}: ${widgetsBeneath > 0}`,
          ).toBe(`${label} widgets starting on row ${rowBeneath}: true`);
        }
      }

      // Every template ships at least a title row, so this cannot be zero.
      expect(headersChecked).toBeGreaterThan(0);
    });
  });

  describe("vertical rhythm", () => {
    /*
     * A row no widget occupies renders as a band of empty canvas mid
     * dashboard. It is never intentional in a template: it means a widget
     * was resized or removed and the rows below it were not pulled up.
     * (That the declared height CONTAINS the lowest widget is the
     * structural file's rule; this one is about the gaps above it.)
     */
    test("no template leaves an empty row above its lowest widget", (): void => {
      const loadedTemplates: Array<LoadedTemplate> = loadAllTemplates();

      expect(loadedTemplates.length).toBeGreaterThan(0);

      for (const loaded of loadedTemplates) {
        expect(loaded.config.components.length).toBeGreaterThan(0);

        const occupiedRows: Set<number> = new Set<number>();
        let lowestOccupiedEdge: number = 0;

        for (const component of loaded.config.components) {
          const bottom: number =
            component.topInDashboardUnits + component.heightInDashboardUnits;

          lowestOccupiedEdge = Math.max(lowestOccupiedEdge, bottom);

          for (
            let row: number = component.topInDashboardUnits;
            row < bottom;
            row++
          ) {
            occupiedRows.add(row);
          }
        }

        const emptyRows: Array<number> = [];

        for (let row: number = 0; row < lowestOccupiedEdge; row++) {
          if (!occupiedRows.has(row)) {
            emptyRows.push(row);
          }
        }

        expect(
          `${loaded.type} empty rows above row ${lowestOccupiedEdge}: ${emptyRows.join(", ")}`,
        ).toBe(`${loaded.type} empty rows above row ${lowestOccupiedEdge}: `);
      }
    });
  });

  describe("widget titles", () => {
    /*
     * Titles are the handle: the reader uses them to say which widget is
     * wrong, and every per-template suite in this directory looks widgets
     * up by title because ids regenerate on every call. Two Gauges called
     * "MTTR" on one dashboard are indistinguishable to both.
     *
     * Scoped to the component FAMILY on purpose. The Incident and Alert
     * templates legitimately pair a Value tile and a Gauge that both read
     * "MTTR" — different widget shapes showing the same measure, which a
     * reader can tell apart at a glance. Two widgets of the SAME shape
     * sharing a name is the ambiguity worth failing on.
     */
    test("every widget title is non-empty and unique within its component family", (): void => {
      const loadedTemplates: Array<LoadedTemplate> = loadAllTemplates();

      expect(loadedTemplates.length).toBeGreaterThan(0);

      let widgetsChecked: number = 0;

      for (const loaded of loadedTemplates) {
        const seenTitles: Set<string> = new Set<string>();
        const duplicates: Array<string> = [];

        for (const component of loaded.config.components) {
          widgetsChecked++;

          const label: string = describeComponent(loaded.type, component);
          const title: string | undefined = titleOf(component);

          expect(`${label} title is a ${typeof title}`).toBe(
            `${label} title is a string`,
          );
          expect(`${label} title="${(title ?? "").trim()}"`).not.toBe(
            `${label} title=""`,
          );

          const key: string = `${component.componentType}: "${title}"`;

          if (seenTitles.has(key)) {
            duplicates.push(key);
          }

          seenTitles.add(key);
        }

        expect(
          `${loaded.type} duplicate titles: ${duplicates.join(", ")}`,
        ).toBe(`${loaded.type} duplicate titles: `);
      }

      expect(widgetsChecked).toBeGreaterThan(0);
    });
  });

  describe("metric coverage", () => {
    /*
     * The same series, aggregated the same way, drawn twice in the same
     * widget shape is a duplicated widget rather than a second view of the
     * data: it consumes a slot and a fetch and tells the reader nothing new.
     * Deliberate second views differ in at least one of the three —
     * "Worst Response Time" (Max) beside "Avg Response Time" (Avg) on the
     * SLO template, or a Value tile and a Chart of the same series — so the
     * triple, not the metric name alone, is what has to be unique.
     */
    test("no template prints the same component family, metric and aggregation twice", (): void => {
      const loadedTemplates: Array<LoadedTemplate> = loadAllTemplates();

      expect(loadedTemplates.length).toBeGreaterThan(0);

      let seriesChecked: number = 0;

      for (const loaded of loadedTemplates) {
        const seenTriples: Map<string, string> = new Map<string, string>();
        const duplicates: Array<string> = [];

        for (const component of loaded.config.components) {
          const filterData: Record<string, unknown> | undefined =
            getMetricFilterData(component);

          if (!filterData) {
            continue;
          }

          seriesChecked++;

          const triple: string = `${component.componentType}/${String(
            filterData["metricName"],
          )}/${String(filterData["aggegationType"])}`;
          const existing: string | undefined = seenTriples.get(triple);

          if (existing) {
            duplicates.push(
              `${triple} on both "${existing}" and "${titleOf(component)}"`,
            );
          }

          seenTriples.set(triple, String(titleOf(component)));
        }

        expect(`${loaded.type} repeated series: ${duplicates.join("; ")}`).toBe(
          `${loaded.type} repeated series: `,
        );
      }

      expect(seriesChecked).toBeGreaterThan(0);
    });
  });

  describe("row caps", () => {
    /*
     * Inventory widgets render whatever the API hands back. Without a cap a
     * template dropped into a project with 4,000 monitors paints 4,000 rows
     * into a four-row widget — the fetch, the DOM and the scroll position
     * all pay for rows nobody can see. Every list factory defaults
     * `maxRows`, so a missing one means a new family shipped without the
     * default rather than a template opting out.
     */
    test("every list widget caps its rows with a positive integer maxRows", (): void => {
      const loadedTemplates: Array<LoadedTemplate> = loadAllTemplates();

      expect(LIST_COMPONENT_TYPES.length).toBeGreaterThan(0);
      expect(loadedTemplates.length).toBeGreaterThan(0);

      let listWidgetsChecked: number = 0;

      for (const loaded of loadedTemplates) {
        for (const component of loaded.config.components) {
          if (!LIST_COMPONENT_TYPES.includes(component.componentType)) {
            continue;
          }

          listWidgetsChecked++;

          const label: string = describeComponent(loaded.type, component);
          const maxRows: unknown = getArguments(component)["maxRows"];

          expect(`${label} maxRows is a ${typeof maxRows}`).toBe(
            `${label} maxRows is a number`,
          );
          expect(
            `${label} maxRows=${String(maxRows)} usable=${
              typeof maxRows === "number" &&
              Number.isInteger(maxRows) &&
              maxRows > 0
            }`,
          ).toBe(`${label} maxRows=${String(maxRows)} usable=true`);
        }
      }

      expect(listWidgetsChecked).toBeGreaterThan(0);
    });

    /*
     * Tables and log streams take the same argument and pay the same cost,
     * so wherever a template declares one at all it has to be a usable row
     * count. `maxRows: 0` and `maxRows: 12.5` are both type-legal on a
     * Record<string, unknown> and neither renders anything sensible.
     */
    test("every widget that declares maxRows declares a positive whole number", (): void => {
      const loadedTemplates: Array<LoadedTemplate> = loadAllTemplates();

      expect(loadedTemplates.length).toBeGreaterThan(0);

      let declarationsChecked: number = 0;

      for (const loaded of loadedTemplates) {
        for (const component of loaded.config.components) {
          const maxRows: unknown = getArguments(component)["maxRows"];

          if (maxRows === undefined) {
            continue;
          }

          declarationsChecked++;

          const label: string = describeComponent(loaded.type, component);

          expect(
            `${label} maxRows=${String(maxRows)} usable=${
              typeof maxRows === "number" &&
              Number.isInteger(maxRows) &&
              maxRows > 0
            }`,
          ).toBe(`${label} maxRows=${String(maxRows)} usable=true`);
        }
      }

      expect(declarationsChecked).toBeGreaterThan(0);
    });
  });

  describe("gauges", () => {
    /*
     * A gauge's sweep is the reader's only scale. When the series is one
     * the renderer formats as a percentage — which ValueFormatter decides
     * from the metric NAME, `.utilization` / `.ratio` / `.fraction` /
     * `.percent` — the only sweep that means anything is 0 to 100: a dial
     * that stops at 1 pins a 37% reading hard against the top, and one that
     * runs to 1000 leaves it invisible near the bottom.
     *
     * Deriving percent-ness from ValueFormatter rather than from a list
     * written here keeps this test honest about the same metrics the
     * renderer itself treats as percentages, including the two kubeletstats
     * names ValueFormatter deliberately excludes (k8s.node/pod.cpu.utilization
     * are cores despite the name, and are NOT held to a 0-100 sweep here).
     */
    test("every gauge on a percent-formatted metric sweeps exactly 0 to 100", (): void => {
      const loadedTemplates: Array<LoadedTemplate> = loadAllTemplates();

      expect(loadedTemplates.length).toBeGreaterThan(0);

      let percentGaugesChecked: number = 0;

      for (const loaded of loadedTemplates) {
        for (const component of loaded.config.components) {
          if (component.componentType !== DashboardComponentType.Gauge) {
            continue;
          }

          const filterData: Record<string, unknown> | undefined =
            getMetricFilterData(component);

          if (
            !filterData ||
            !ValueFormatter.isFractionMetric(String(filterData["metricName"]))
          ) {
            continue;
          }

          percentGaugesChecked++;

          const args: Record<string, unknown> = getArguments(component);
          const label: string = `${describeComponent(loaded.type, component)} on ${String(
            filterData["metricName"],
          )}`;

          expect(
            `${label} range=${String(args["minValue"])}..${String(args["maxValue"])}`,
          ).toBe(`${label} range=0..100`);
        }
      }

      // Guard: the CPU / memory / interface-utilization gauges below.
      expect(percentGaugesChecked).toBeGreaterThan(0);
    });
  });

  describe("text widgets", () => {
    test("no Text widget carries more copy than its row can render on one line", (): void => {
      const loadedTemplates: Array<LoadedTemplate> = loadAllTemplates();

      expect(loadedTemplates.length).toBeGreaterThan(0);

      let textWidgetsChecked: number = 0;

      for (const loaded of loadedTemplates) {
        for (const component of loaded.config.components) {
          if (!isTextWidget(component)) {
            continue;
          }

          textWidgetsChecked++;

          const text: string = String(getArguments(component)["text"] ?? "");
          const budget: number = maximumTextLengthFor(component);
          const label: string = `${loaded.type} Text at row ${component.topInDashboardUnits} (w${component.widthInDashboardUnits} h${component.heightInDashboardUnits}, budget ${budget})`;

          expect(
            `${label} length=${text.length} withinBudget=${text.length <= budget}`,
          ).toBe(`${label} length=${text.length} withinBudget=true`);
        }
      }

      expect(textWidgetsChecked).toBeGreaterThan(0);
    });
  });

  describe("catalog copy", () => {
    /*
     * The description is the whole of what the modal tells a reader before
     * they commit to a template, and it is rendered as running text under
     * the card's name. A fragment that trails off, or one that starts
     * lower-case because it was written as a continuation of the name,
     * reads as a bug in the modal rather than as a choice.
     */
    test("every catalog entry describes itself in a complete sentence", (): void => {
      expect(DashboardTemplates.length).toBeGreaterThan(0);

      for (const template of DashboardTemplates) {
        const description: string = template.description.trim();
        const label: string = `${template.type} description`;

        expect(`${label} is empty: ${description.length === 0}`).toBe(
          `${label} is empty: false`,
        );
        /*
         * Plain character comparison rather than a regex: eslint's
         * wrap-regex and prettier disagree about the parentheses around an
         * inline literal, and there is no spelling of it both accept.
         */
        const firstCharacter: string = description.charAt(0);
        const startsUpperCase: boolean =
          firstCharacter >= "A" && firstCharacter <= "Z";

        expect(
          `${label} starts upper-case: ${startsUpperCase} ("${description.slice(0, 24)}")`,
        ).toBe(
          `${label} starts upper-case: true ("${description.slice(0, 24)}")`,
        );
        expect(
          `${label} ends with a full stop: ${description.endsWith(".")} ("${description.slice(-24)}")`,
        ).toBe(
          `${label} ends with a full stop: true ("${description.slice(-24)}")`,
        );
      }
    });
  });
});

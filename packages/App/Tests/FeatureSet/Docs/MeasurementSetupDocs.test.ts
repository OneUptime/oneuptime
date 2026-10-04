import { describe, expect, it } from "@jest/globals";
import fs from "fs";
import path from "path";
import {
  CUSTOM_MEASUREMENT_PRESET_ID,
  MeasurementDomain,
  MeasurementMoment,
  getMeasurementMoments,
  getMeasurementPresets,
} from "Common/Utils/Measurement/MeasurementMoments";
import MeasurementUnit from "Common/Types/Measurement/MeasurementUnit";
import MeasurementAggregationType from "Common/Types/Measurement/MeasurementAggregationType";

/*
 * "Please make incident and alert measurements easier to understand. I have
 * no idea what these are." The measurement settings pages now explain
 * themselves - ready-made measurements, moments in plain words, More fields
 * folded - and the docs must describe the same pages: the same ready-made
 * measurements, the same moments, what is under More fields, and View Chart.
 *
 * The lists are read from the module the form is built from
 * (Common/Utils/Measurement/MeasurementMoments), so a measurement or a moment
 * added there without a word here fails this test.
 */

const REPO_ROOT: string = path.resolve(__dirname, "../../../..");

function measurementsSection(): string {
  const page: string = fs.readFileSync(
    path.join(
      REPO_ROOT,
      "App/FeatureSet/Docs/Content/en/incidents/settings.md",
    ),
    "utf8",
  );

  const start: number = page.indexOf("## Measurements");
  expect(start).toBeGreaterThan(-1);

  const end: number = page.indexOf("\n## ", start + 1);

  return page.slice(start, end === -1 ? undefined : end);
}

describe("the English measurements docs", () => {
  const section: string = measurementsSection();

  it("say what a measurement is, in a sentence", () => {
    expect(section).toContain(
      "A measurement is the time between two moments in an incident.",
    );
  });

  it("list every ready-made measurement, with its two moments", () => {
    for (const domain of Object.values(MeasurementDomain)) {
      for (const preset of getMeasurementPresets(domain)) {
        if (preset.id === CUSTOM_MEASUREMENT_PRESET_ID) {
          continue;
        }

        const row: string | undefined = section
          .split("\n")
          .find((line: string): boolean => {
            return (
              line.includes(`**${preset.name}**`) &&
              line.startsWith("|") &&
              line.includes(
                domain === MeasurementDomain.Incident
                  ? "Incidents"
                  : domain === MeasurementDomain.Alert
                    ? "Alerts"
                    : "Scheduled maintenance",
              )
            );
          });

        expect({ preset: preset.name, row: Boolean(row) }).toEqual({
          preset: preset.name,
          row: true,
        });

        const momentLabel: (value: string | undefined) => string = (
          value: string | undefined,
        ): string => {
          return getMeasurementMoments(domain).find(
            (moment: MeasurementMoment): boolean => {
              return moment.value === value;
            },
          )!.label;
        };

        expect(row).toContain(momentLabel(preset.startMoment));
        expect(row).toContain(momentLabel(preset.endMoment));
      }
    }

    expect(section).toContain("**Something else**");
  });

  it("list every incident moment the form offers, and what the API stores it as", () => {
    for (const moment of getMeasurementMoments(MeasurementDomain.Incident)) {
      expect(section).toContain(`**${moment.label}**`);
      expect(section).toContain(`\`${moment.anchorType}\``);

      if (moment.stateRole) {
        expect(section).toContain(`role \`${moment.stateRole}\``);
      }
    }
  });

  it("say what is under More fields, and the defaults", () => {
    for (const text of [
      "**More fields**",
      "**If the start happens more than once**",
      "**If the end happens more than once**",
      "**Use the first time**",
      "**Show durations in**",
      "**Automatic**",
      "**Chart summary**",
      "**Average**",
      "Folded, its header names them and shows the ones that are changed.",
    ]) {
      expect(section).toContain(text);
    }

    expect(section).not.toContain("**Configured**");
  });

  it("give the API's values for the unit and the chart summary", () => {
    for (const unit of Object.values(MeasurementUnit)) {
      expect(section).toContain(`\`${unit}\``);
    }

    for (const aggregation of Object.values(MeasurementAggregationType)) {
      expect(section).toContain(`\`${aggregation}\``);
    }
  });

  it("send people to View Chart for the numbers", () => {
    expect(section).toContain("**View Chart**");
    expect(section).toContain("`oneuptime.incident.measurement.<key>`");
  });

  it("no longer claim Impact Started At can be edited on the incident page, or that history only fills forward", () => {
    expect(section).not.toContain("editable from the incident page");
    expect(section).not.toContain("Charted history fills forward");
    expect(section).toContain("an incident form that asks when impact started");
  });

  it("no longer ask for anchor types by their API names in the steps", () => {
    expect(section).not.toContain("### Choosing the two ends");
    expect(section).not.toMatch(/Ending point\s*\|\s*Resolves to/);
  });

  it("keep the settings table's Measurements row in plain words", () => {
    const page: string = fs.readFileSync(
      path.join(
        REPO_ROOT,
        "App/FeatureSet/Docs/Content/en/incidents/settings.md",
      ),
      "utf8",
    );

    const row: string | undefined = page
      .split("\n")
      .find((line: string): boolean => {
        return line.startsWith("| **Measurements**");
      });

    expect(row).toContain("time to acknowledge or time to resolve");
  });
});

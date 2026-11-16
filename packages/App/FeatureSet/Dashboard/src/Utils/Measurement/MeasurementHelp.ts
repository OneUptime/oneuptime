import {
  MeasurementDomain,
  MeasurementMoment,
  MeasurementPreset,
  CUSTOM_MEASUREMENT_PRESET_ID,
  getMeasurementMoment,
  getMeasurementMoments,
  getMeasurementPresets,
} from "Common/Utils/Measurement/MeasurementMoments";

/*
 * The "?" help of the three Measurements pages, in plain words and in the
 * help dialog's shape (Common HelpContent): what a measurement is in short,
 * then setting one up from the ready-made ones, the moments (written from
 * the same lists the form uses, so the two never disagree), where the
 * numbers show up, and why something can have no number. The help this
 * replaced opened on a flowchart of anchors and statuses.
 */

interface MeasurementHelpWords {
  // "incident", "alert", "maintenance event".
  thing: string;
  // The same with its article, for the start of a sentence: "An incident".
  aThing: string;
  // A gap between two of its moments, as the summary names one.
  gapExample: string;
  // "incidents", "alerts", "maintenance events".
  things: string;
  // The page's Create button.
  createButton: string;
  // The domain's part of the metric name.
  metricName: string;
  // Why one might have no value yet, in this domain's words.
  stillOpen: string;
  neverHappens: string;
  // What a measurement shows that the built-in timings do not, per domain.
  example: string;
}

const WORDS: Record<MeasurementDomain, MeasurementHelpWords> = {
  [MeasurementDomain.Incident]: {
    thing: "incident",
    aThing: "An incident",
    gapExample: "how long until someone acknowledges it",
    things: "incidents",
    createButton: "Create Incident Measurement",
    metricName: "oneuptime.incident.measurement.<key>",
    stillOpen: "the incident is still open",
    neverHappens:
      "the state was skipped, or nobody recorded when impact started",
    example:
      "**Time to acknowledge** is the time from when an incident is declared until someone acknowledges it. **Time to resolve** runs from when it is declared until it is resolved.",
  },
  [MeasurementDomain.Alert]: {
    thing: "alert",
    aThing: "An alert",
    gapExample: "how long until someone acknowledges it",
    things: "alerts",
    createButton: "Create Alert Measurement",
    metricName: "oneuptime.alert.measurement.<key>",
    stillOpen: "the alert is still open",
    neverHappens:
      "the state was skipped, or nobody recorded when impact started",
    example:
      "**Time to acknowledge** is the time from when an alert is created until someone acknowledges it. **Time to resolve** runs from when it is created until it is resolved.",
  },
  [MeasurementDomain.ScheduledMaintenance]: {
    thing: "maintenance event",
    aThing: "A maintenance event",
    gapExample: "how late it really starts",
    things: "maintenance events",
    createButton: "Create Scheduled Maintenance Measurement",
    metricName: "oneuptime.scheduled-maintenance.measurement.<key>",
    stillOpen: "the maintenance has not happened yet",
    neverHappens: "the state was skipped",
    example:
      "**Start delay** is the time from a maintenance event's scheduled start until it really starts. **Overrun** runs from its scheduled end until it really ends.",
  },
};

type MomentLabelFunction = (
  domain: MeasurementDomain,
  value: string | undefined,
) => string;

const momentLabel: MomentLabelFunction = (
  domain: MeasurementDomain,
  value: string | undefined,
): string => {
  const moment: MeasurementMoment | null = getMeasurementMoment({
    domain,
    value,
  });

  return moment ? moment.label.toLowerCase() : "";
};

export const getMeasurementsHelpMarkdown: (
  domain: MeasurementDomain,
) => string = (domain: MeasurementDomain): string => {
  const words: MeasurementHelpWords = WORDS[domain];

  const presets: string = getMeasurementPresets(domain)
    .filter((preset: MeasurementPreset): boolean => {
      return preset.id !== CUSTOM_MEASUREMENT_PRESET_ID;
    })
    .map((preset: MeasurementPreset): string => {
      return `| **${preset.name}** | ${momentLabel(domain, preset.startMoment)} | ${momentLabel(domain, preset.endMoment)} |`;
    })
    .join("\n");

  const moments: string = getMeasurementMoments(domain)
    .map((moment: MeasurementMoment): string => {
      return `| ${moment.label} | ${moment.description} |`;
    })
    .join("\n");

  return `
A measurement times the gap between two moments of every ${words.thing}, such as ${words.gapExample}, and charts it, past ${words.things} included, so you can see whether things are getting faster.

## Set Up a Measurement

Choose **${words.createButton}** and pick a ready-made measurement, or **Something else** to choose the two moments yourself. ${words.example}

| Measurement | Starts when | Ends when |
|-------------|-------------|-----------|
${presets}

A few options most measurements never need are under **More fields** on the second step: whether the first or the last time a state is reached counts (the first, unless you change it), the unit its charts use, how **View Chart** sums up many ${words.things}, and whether each ${words.thing}'s page shows it (it does, unless you turn that off).

## The Moments You Can Pick

| Moment | When it happens |
|--------|-----------------|
${moments}

## Where the Numbers Show Up

Each ${words.thing}'s own page shows its measurements, in a **Measurements** card: the number once both moments have happened, how long it has been running while the clock is still going, or why there is no number.

Choose **View Chart** on a measurement to see it over time. Every measurement is also a metric named \`${words.metricName}\`, which you can add to any dashboard. Its key is made from its name when it is created and never changes, so renaming a measurement keeps its history.

Changing where a measurement starts or ends works it out again for every ${words.thing}. To keep the old numbers, create a new measurement instead.

## When There Is No Number

${words.aThing} gets a number only once both moments have happened. If one has not happened yet, because ${words.stillOpen}, it is counted when it does. If one never will, because ${words.neverHappens}, the ${words.thing} is left out rather than counted as zero, so it cannot pull an average down. ${words.aThing} whose end comes before its start has timestamps that disagree, and is left out too.
`;
};

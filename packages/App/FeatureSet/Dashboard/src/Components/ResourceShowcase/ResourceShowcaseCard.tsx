import React, { FunctionComponent, ReactElement, useId } from "react";
import IconProp from "Common/Types/Icon/IconProp";
import Icon from "Common/UI/Components/Icon/Icon";
import Button, {
  ButtonSize,
  ButtonStyleType,
} from "Common/UI/Components/Button/Button";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { Translator, translationKey } from "Common/UI/Utils/TranslateTemplate";
import {
  ResourceShowcase,
  ShowcaseChartPaths,
  ShowcaseFeature,
  ShowcasePreview,
  ShowcaseRow,
  ShowcaseStat,
  ShowcaseStatus,
  getShowcaseChartPaths,
} from "./ResourceShowcase";

/*
 * An empty resource list's showcase (ResourceShowcase.ts): the pitch and the
 * list's Add button, an example of a connected one beside it, and what comes
 * with it underneath. The example is drawn, not loaded: it says so, and a
 * screen reader hears one sentence for it rather than its made-up numbers.
 */

// The list's own Add button, repeated where the showcase asks for it.
export interface ShowcaseAddButton {
  /*
   * As the list's button says it: English ("Add Kubernetes Cluster"), which
   * the button looks up, or already in the reader's language.
   */
  title: string;
  onClick: () => void;
  disabled?: boolean | undefined;
  // Why it is disabled.
  tooltip?: string | undefined;
}

export interface ComponentProps {
  showcase: ResourceShowcase;
  // Left out where the viewer has no way to add one.
  addButton?: ShowcaseAddButton | undefined;
}

export const RESOURCE_SHOWCASE_TEST_ID: string = "resource-showcase";
export const RESOURCE_SHOWCASE_ADD_BUTTON_TEST_ID: string =
  "resource-showcase-add-button";
export const RESOURCE_SHOWCASE_PREVIEW_TEST_ID: string =
  "resource-showcase-preview";
export const RESOURCE_SHOWCASE_CHART_TEST_ID: string =
  "resource-showcase-chart";

// Over the feature grid.
export const RESOURCE_SHOWCASE_FEATURES_TITLE: string =
  translationKey("What you get");

// The example's corner, and what a screen reader hears for all of it.
export const RESOURCE_SHOWCASE_EXAMPLE_LABEL: string =
  translationKey("Example");
export const RESOURCE_SHOWCASE_EXAMPLE_DESCRIPTION: string = translationKey(
  "An example of what you see once one is connected.",
);

// The example's state, and the span of its chart.
const CONNECTED_TEXT: string = translationKey("Connected");
const CHART_RANGE_TEXT: string = translationKey("Last hour");

// The chart's box, in SVG units; it is stretched to the panel's width.
const CHART_WIDTH: number = 320;
const CHART_HEIGHT: number = 64;

const STATUS_DOT_CLASS_NAMES: Record<ShowcaseStatus, string> = {
  [ShowcaseStatus.Healthy]: "bg-emerald-500",
  [ShowcaseStatus.Warning]: "bg-amber-500",
  [ShowcaseStatus.Critical]: "bg-red-500",
};

const STATUS_PILL_CLASS_NAMES: Record<ShowcaseStatus, string> = {
  [ShowcaseStatus.Healthy]: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  [ShowcaseStatus.Warning]: "bg-amber-50 text-amber-800 ring-amber-200",
  [ShowcaseStatus.Critical]: "bg-red-50 text-red-700 ring-red-200",
};

/*
 * The alert under the example takes the colour of the worst row: red when
 * one is down, amber when one is only degraded.
 */
export function getShowcaseAlertStatus(
  rows: Array<ShowcaseRow>,
): ShowcaseStatus {
  return rows.some((row: ShowcaseRow): boolean => {
    return row.status === ShowcaseStatus.Critical;
  })
    ? ShowcaseStatus.Critical
    : ShowcaseStatus.Warning;
}

const ALERT_CLASS_NAMES: Record<
  ShowcaseStatus,
  { box: string; icon: string; title: string; text: string }
> = {
  [ShowcaseStatus.Healthy]: {
    box: "border-emerald-200 bg-emerald-50",
    icon: "text-emerald-600",
    title: "text-emerald-800",
    text: "text-emerald-700",
  },
  [ShowcaseStatus.Warning]: {
    box: "border-amber-200 bg-amber-50",
    icon: "text-amber-600",
    title: "text-amber-900",
    text: "text-amber-800",
  },
  [ShowcaseStatus.Critical]: {
    box: "border-red-200 bg-red-50",
    icon: "text-red-600",
    title: "text-red-900",
    text: "text-red-700",
  },
};

const ShowcasePreviewPanel: FunctionComponent<{
  icon: IconProp;
  preview: ShowcasePreview;
  translate: (text: string) => string;
}> = (props: {
  icon: IconProp;
  preview: ShowcasePreview;
  translate: (text: string) => string;
}): ReactElement => {
  const translate: (text: string) => string = props.translate;
  const preview: ShowcasePreview = props.preview;
  // An id of the page's own, for the gradient under the line.
  const gradientId: string = `showcase-chart-${useId().replace(
    /[^A-Za-z0-9_-]/g,
    "",
  )}`;
  const paths: ShowcaseChartPaths = getShowcaseChartPaths({
    values: preview.chart.values,
    width: CHART_WIDTH,
    height: CHART_HEIGHT,
  });
  const alertStatus: ShowcaseStatus = getShowcaseAlertStatus(preview.rows);

  return (
    <div
      role="img"
      aria-label={translate(RESOURCE_SHOWCASE_EXAMPLE_DESCRIPTION)}
      data-testid={RESOURCE_SHOWCASE_PREVIEW_TEST_ID}
      className="relative min-w-0"
    >
      <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-xl ring-1 ring-black/5">
        <div className="flex items-center gap-1.5 border-b border-gray-100 bg-gray-50 px-4 py-2.5">
          <span className="h-2.5 w-2.5 rounded-full bg-gray-200" />
          <span className="h-2.5 w-2.5 rounded-full bg-gray-200" />
          <span className="h-2.5 w-2.5 rounded-full bg-gray-200" />
          <span className="ml-auto text-[11px] font-medium uppercase tracking-wider text-gray-400">
            {translate(RESOURCE_SHOWCASE_EXAMPLE_LABEL)}
          </span>
        </div>

        <div className="space-y-4 p-4 sm:p-5">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg border border-indigo-100 bg-indigo-50">
              <Icon icon={props.icon} className="h-5 w-5 text-indigo-600" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-semibold text-gray-900">
                {preview.name}
              </div>
              <div className="truncate text-xs text-gray-500">
                {translate(preview.subtitle)}
              </div>
            </div>
            <span className="inline-flex flex-shrink-0 items-center gap-1.5 rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700 ring-1 ring-inset ring-emerald-200">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
              {translate(CONNECTED_TEXT)}
            </span>
          </div>

          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {preview.stats.map((stat: ShowcaseStat): ReactElement => {
              return (
                <div
                  key={stat.label}
                  className="min-w-0 rounded-lg border border-gray-100 bg-gray-50 px-3 py-2"
                >
                  <div className="truncate text-[11px] font-medium text-gray-500">
                    {translate(stat.label)}
                  </div>
                  <div className="mt-0.5 truncate text-base font-semibold tabular-nums text-gray-900">
                    {stat.value}
                  </div>
                </div>
              );
            })}
          </div>

          <div className="rounded-lg border border-gray-100 px-3 pb-2 pt-2.5">
            <div className="flex items-center justify-between gap-3 text-[11px] font-medium text-gray-500">
              <span className="truncate">{translate(preview.chart.label)}</span>
              <span className="flex-shrink-0 text-gray-400">
                {translate(CHART_RANGE_TEXT)}
              </span>
            </div>
            <svg
              viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}
              preserveAspectRatio="none"
              className="mt-2 h-16 w-full text-indigo-500"
              aria-hidden="true"
              focusable="false"
              data-testid={RESOURCE_SHOWCASE_CHART_TEST_ID}
            >
              <defs>
                <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                  <stop
                    offset="0%"
                    stopColor="currentColor"
                    stopOpacity="0.24"
                  />
                  <stop
                    offset="100%"
                    stopColor="currentColor"
                    stopOpacity="0"
                  />
                </linearGradient>
              </defs>
              <path d={paths.area} fill={`url(#${gradientId})`} />
              <path
                d={paths.line}
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                vectorEffect="non-scaling-stroke"
              />
            </svg>
          </div>

          <ul className="divide-y divide-gray-100 rounded-lg border border-gray-100">
            {preview.rows.map((row: ShowcaseRow): ReactElement => {
              return (
                <li
                  key={row.name}
                  className="flex items-center gap-3 px-3 py-2"
                >
                  <span
                    className={`h-2 w-2 flex-shrink-0 rounded-full ${
                      STATUS_DOT_CLASS_NAMES[row.status]
                    }`}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-mono text-xs text-gray-900">
                      {row.name}
                    </div>
                    <div className="truncate text-[11px] text-gray-500">
                      {translate(row.detail)}
                    </div>
                  </div>
                  <span
                    className={`flex-shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset ${
                      STATUS_PILL_CLASS_NAMES[row.status]
                    }`}
                  >
                    {translate(row.statusText)}
                  </span>
                </li>
              );
            })}
          </ul>

          {preview.alert && (
            <div
              className={`flex items-start gap-3 rounded-lg border px-3 py-2.5 ${ALERT_CLASS_NAMES[alertStatus].box}`}
            >
              <Icon
                icon={IconProp.BellRinging}
                className={`mt-0.5 h-4 w-4 flex-shrink-0 ${ALERT_CLASS_NAMES[alertStatus].icon}`}
              />
              <div className="min-w-0">
                <div
                  className={`text-xs font-semibold ${ALERT_CLASS_NAMES[alertStatus].title}`}
                >
                  {translate(preview.alert.title)}
                </div>
                <div
                  className={`mt-0.5 text-xs leading-snug ${ALERT_CLASS_NAMES[alertStatus].text}`}
                >
                  {translate(preview.alert.description)}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

const ResourceShowcaseCard: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const translate: (text: string) => string = (text: string): string => {
    return translator.translateText(text) || text;
  };
  const showcase: ResourceShowcase = props.showcase;
  const titleId: string = `resource-showcase-title-${useId().replace(
    /[^A-Za-z0-9_-]/g,
    "",
  )}`;

  return (
    <section
      className="mb-5 overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm"
      aria-labelledby={titleId}
      data-testid={RESOURCE_SHOWCASE_TEST_ID}
    >
      <div className="relative">
        {/* A soft glow behind the pitch, and a dotted ground behind the example. */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0"
          style={{
            backgroundImage:
              "radial-gradient(48rem 20rem at 0% 0%, var(--ou-accent-soft, #eef2ff), transparent 70%)",
          }}
        />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-0 right-0 hidden w-1/2 lg:block"
          style={{
            backgroundImage:
              "radial-gradient(var(--ou-border-default, #e5e7eb) 1px, transparent 1px)",
            backgroundSize: "18px 18px",
            maskImage:
              "radial-gradient(ellipse at center, black 30%, transparent 72%)",
            WebkitMaskImage:
              "radial-gradient(ellipse at center, black 30%, transparent 72%)",
          }}
        />

        <div className="relative grid gap-10 px-5 py-8 sm:px-8 lg:grid-cols-2 lg:items-center lg:gap-12 lg:py-10">
          <div className="min-w-0">
            <div className="inline-flex max-w-full items-center gap-2 rounded-full border border-indigo-100 bg-indigo-50 px-3 py-1 text-xs font-medium text-indigo-700">
              <Icon icon={showcase.icon} className="h-4 w-4 flex-shrink-0" />
              <span className="truncate">{translate(showcase.eyebrow)}</span>
            </div>
            <h2
              id={titleId}
              className="mt-4 text-2xl font-semibold tracking-tight text-gray-900 sm:text-3xl"
            >
              {translate(showcase.title)}
            </h2>
            <p className="mt-3 max-w-xl text-base leading-relaxed text-gray-600">
              {translate(showcase.description)}
            </p>

            {props.addButton && (
              <div className="mt-6">
                <Button
                  title={props.addButton.title}
                  icon={IconProp.Add}
                  buttonStyle={ButtonStyleType.PRIMARY}
                  buttonSize={ButtonSize.Large}
                  disabled={props.addButton.disabled}
                  tooltip={props.addButton.tooltip}
                  onClick={props.addButton.onClick}
                  dataTestId={RESOURCE_SHOWCASE_ADD_BUTTON_TEST_ID}
                />
              </div>
            )}

            <ul className="mt-6 flex flex-wrap gap-x-6 gap-y-2">
              {showcase.highlights.map((highlight: string): ReactElement => {
                return (
                  <li
                    key={highlight}
                    className="inline-flex items-center gap-1.5 text-sm text-gray-600"
                  >
                    <Icon
                      icon={IconProp.CheckCircle}
                      className="h-4 w-4 flex-shrink-0 text-emerald-600"
                    />
                    {translate(highlight)}
                  </li>
                );
              })}
            </ul>
          </div>

          <ShowcasePreviewPanel
            icon={showcase.icon}
            preview={showcase.preview}
            translate={translate}
          />
        </div>
      </div>

      <div className="border-t border-gray-100 bg-gray-50/50 px-5 py-8 sm:px-8">
        <h3 className="text-sm font-semibold text-gray-900">
          {translate(RESOURCE_SHOWCASE_FEATURES_TITLE)}
        </h3>
        <ul className="mt-5 grid gap-x-8 gap-y-6 sm:grid-cols-2 lg:grid-cols-3">
          {showcase.features.map((feature: ShowcaseFeature): ReactElement => {
            return (
              <li
                key={feature.title}
                className="flex gap-3"
                data-testid="resource-showcase-feature"
              >
                <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-white shadow-sm ring-1 ring-gray-200">
                  <Icon
                    icon={feature.icon}
                    className="h-5 w-5 text-indigo-600"
                  />
                </div>
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-gray-900">
                    {translate(feature.title)}
                  </div>
                  <p className="mt-1 text-sm leading-relaxed text-gray-500">
                    {translate(feature.description)}
                  </p>
                </div>
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
};

export default ResourceShowcaseCard;

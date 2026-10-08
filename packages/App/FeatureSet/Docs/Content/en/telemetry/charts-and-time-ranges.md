# Zooming Into a Time Range

Drag across a chart to zoom the page into that moment, and double-click to go back. This page explains the gestures, how a zoom behaves, and which charts zoom what.

:::cards
- [Zoom in and back out](#zoom-in-and-back-out): The two gestures, and the Reset zoom button.
- [How zooming behaves](#how-zooming-behaves): Nested zooms, auto-refresh, clicks and drags.
- [Where it works](#where-it-works): The pages and charts a drag retimes.
- [Charts that don't zoom](#charts-that-dont-zoom): Strips, gauges and sparklines.
:::

## Zoom in and back out

Every time-series chart in OneUptime doubles as a time-range picker. When a
chart shows a spike you want to look at, you don't have to open the picker and
type in dates:

:::steps
1. **Drag across the spike** on any chart. The page's time range moves to the
   window you dragged out, exactly as if you had picked it in the time-range
   picker. Every chart, and every tile or table worked out from the page's
   time range, re-queries for it, so you read one moment across all of them.
2. **Double-click any chart** to go back. The page returns to the time range it
   had before you started zooming.
:::

Panels that show the current state stay on now, just as they do when you pick
a range yourself: inventory counts, health, top resource consumers, recent
warnings, open incidents and alerts, and a dashboard's live lists.

While a zoom is active, a **Reset zoom** button appears next to the page's
time-range picker. It does the same thing as a double-click, and it is the way
back for keyboard users and on touch screens.

```mermaid title="What a drag, a double-click and the picker do to the page's time range"
stateDiagram-v2
    state "Range from the picker" as Picked
    state "Zoomed window" as Zoomed
    [*] --> Picked
    Picked --> Zoomed: drag across a chart
    Zoomed --> Zoomed: drag again
    Zoomed --> Picked: double-click or Reset zoom
    Zoomed --> Picked: pick a range
```

## How zooming behaves

- **Zoom as deep as you like; one reset climbs all the way out.** After drilling
  from "Past 1 Hour" into ten minutes and then into one, a single double-click
  (or **Reset zoom**) returns the whole hour rather than one level at a time.
- **Any chart can reset any zoom.** Drag on the CPU chart, double-click the
  memory chart — it is the page that is zoomed, not the chart.
- **Picking a range yourself starts over.** Choosing a preset or a custom range
  in the picker is a new starting point: the zoom is over and **Reset zoom**
  goes away.
- **A zoomed window is fixed.** "Past 30 Minutes" rolls forward with the clock;
  a zoom is a fixed window, so it stops rolling while auto-refresh is on. Reset
  the zoom to start rolling again.
- **A zoom never runs past now.** The newest bucket of a chart is usually still
  filling up; a drag that ends on it is cut at the current time.
- **You can let go of the mouse outside the chart** — the drag still counts.
- **You don't have to wait for the charts to load to go back.** Right after a
  zoom, while the charts are still fetching the window you dragged out, or
  when that window turns out to be empty, a double-click on a chart resets the
  zoom straight away.
- **Double-clicking a page that isn't zoomed does nothing.**

### Clicks and drags

- **On line, area and bar charts, a plain click is not a zoom.** That covers
  most charts: metric cards and the metric explorer, resource overviews, SLOs,
  monitors and every chart on a dashboard. Only a drag across buckets zooms, so
  clicking a point, a bar or a legend entry keeps doing what it did before.
  While a zoom is active, a click on a chart's plot takes effect a moment
  later, so that it can be told apart from the double-click that resets. The
  error-pattern timeline in Logs Insights and an exception's Occurrence Trend
  also zoom on a drag only.
- **On the explorers' volume charts, a click on one bar zooms into that bar.**
  The volume charts of the log, trace, exception and security-event explorers,
  and the log and trace analytics charts, zoom into the bars you drag across,
  or into the single bar you click. These charts say **Click or drag to
  zoom**.

### Hints on the charts

Most charts that zoom name the gesture above the plot — **Drag to zoom**, or
**Click or drag to zoom** — and, while a zoom is active, remind you to
**double-click to reset**. Metric cards, the metric explorer and the explorers'
volume charts always show the hint. On the chart cards of resource overviews
and SLOs, and on some dashboard widgets, it appears only while you point at the
card or tab into it.

## Where it works

Zooming retimes the whole page on:

- resource overviews and their insights pages: Kubernetes clusters, Docker,
  Podman and Docker Swarm hosts, hosts and their processes, services and
  systemd units, VMware, Proxmox, Ceph, storage arrays, databases, cloud
  resources and serverless functions;
- services and RUM applications;
- network devices' metrics and traffic;
- metric cards, including the Metrics tab of a resource and a monitor's metrics;
- the metric explorer;
- SLO history charts;
- Logs Insights, including the "When it happened" timeline of an error
  pattern, whose panel has its own **Reset zoom** because it covers the page's
  picker;
- log, trace, exception and security-event volume charts, and the log and trace
  analytics charts, which retime the explorer they belong to;
- [dashboards](/docs/dashboards/authoring), where a drag retimes the whole
  dashboard.

Charts with a window of their own zoom only that window, so they never change
anything else on the page. That covers a metric preview in a monitor's form
(the monitor keeps evaluating its own rolling window), an exception's
Occurrence Trend, a chart opened in a pop-up or in the Investigate panel, and
charts in AI chat answers. Double-clicking one of them, or its **Reset zoom**
button, puts its own window back.

The telemetry snapshot on an incident, alert or episode page has a window of
its own too. A drag on its chart (the metric chart, or the log, trace or
exception volume chart when that is what the snapshot shows) zooms the whole
snapshot, so its Metrics, Logs, Traces and Exceptions tabs all show the slice
you dragged out. **Reset zoom** beside the snapshot's badge, or a double-click
on that chart, puts the snapshot window back.

## Charts that don't zoom

A few visualizations don't have a time axis to drag across, are too small to
drag on, or always show a fixed window of their own, so they don't zoom:

- uptime history strips (one bar per day), which can't show anything finer
  than a day;
- share and proportion bars, gauges and progress bars;
- flame graphs, service maps and flow diagrams;
- the small trend sparklines in metric lists, where a click opens the metric —
  open it to get a chart you can zoom;
- small sparklines with a fixed window of their own, such as a network
  device's round-trip time over the past hour — its **Open metrics** link
  leads to charts you can zoom.

## Next steps

:::cards
- [Authoring a Dashboard](/docs/dashboards/authoring): Zoom works on every chart of a dashboard.
- [Search Syntax](/docs/telemetry/search-syntax): Filter the explorers once you have found the moment.
- [Metrics Monitor](/docs/monitor/metrics-monitor): Alert on the metric you were looking at.
:::

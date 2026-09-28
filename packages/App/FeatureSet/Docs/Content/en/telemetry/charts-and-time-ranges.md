# Zooming Into a Time Range

## Overview

Every time-series chart in OneUptime doubles as a time-range picker. When a
chart shows a spike you want to look at, you don't have to open the picker and
type in dates:

1. **Drag across the spike** on any chart. The whole page moves to the window
   you dragged out — every chart, table and summary on the page re-queries for
   it, so you read one moment across all of them.
2. **Double-click any chart** to go back. The page returns to the time range it
   had before you started zooming.

While a zoom is active, a **Reset zoom** button appears next to the page's
time-range picker. It does the same thing as a double-click, and it is the way
back for keyboard users and on touch screens.

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
- **A plain click is not a zoom.** Only a drag across buckets zooms, so clicking
  a point, a bar or a legend entry keeps doing what it did before. You can let
  go of the mouse outside the chart — the drag still counts.
- **Double-clicking a page that isn't zoomed does nothing.**

A **Drag to zoom** hint appears on a chart card when you point at it, and reads
**Drag to zoom · double-click to reset** while a zoom is active.

## Where it works

Zooming retimes the whole page on:

- resource overviews and their insights pages: Kubernetes clusters, Docker,
  Podman and Docker Swarm hosts, hosts and their processes, services and
  systemd units, VMware, Proxmox, Ceph, databases, cloud resources and
  serverless functions;
- services and RUM applications;
- metric cards, including the Metrics tab of a resource and a monitor's metrics;
- the metric explorer;
- SLO history charts;
- log, trace, exception and security-event volume charts, and the log and trace
  analytics charts, which retime the explorer they belong to;
- [dashboards](/docs/dashboards/authoring), where a drag retimes the whole
  dashboard.

Charts with a window of their own zoom only themselves, so they never change
anything else on the page. That covers a metric preview in a monitor's form
(the monitor keeps evaluating its own rolling window), an incident's or alert's
telemetry snapshot, a chart opened in a pop-up, and charts in AI chat answers.
Double-clicking one of them, or its **Reset zoom** button, puts its own window
back.

## Charts that don't zoom

A few visualizations don't have a time axis to drag across, or are too small to
drag on, so they don't zoom:

- uptime history strips (one bar per day), which can't show anything finer
  than a day;
- share and proportion bars, gauges and progress bars;
- flame graphs, service maps and flow diagrams;
- the small trend sparklines in metric lists, where a click opens the metric —
  open it to get a chart you can zoom.

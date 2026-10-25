/*
 * A page in the first bundle with one part loaded lazily - a chart, as a
 * dashboard's widget - inside a ContainedErrorBoundary, and a note beside it.
 * When the chart's code is gone after a deploy, only its place says so.
 */
import React, { lazy, Suspense, useState } from "react";
import ContainedErrorBoundary from "Common/UI/Components/ContainedErrorBoundary/ContainedErrorBoundary";

const LatencyChart = lazy(() => import("./LatencyChart"));

const BUILD = typeof __FIXTURE_BUILD__ === "string" ? __FIXTURE_BUILD__ : "?";

export default function Widgets() {
  const [showChart, setShowChart] = useState(false);
  const [note, setNote] = useState("");

  return (
    <section
      data-testid="page-widgets"
      data-build={BUILD}
      className="grid gap-4 md:grid-cols-2"
    >
      <div className="rounded-xl border border-gray-200 bg-white px-6 py-4">
        <h2 className="text-base font-semibold text-gray-900">p95 latency</h2>
        {/* A widget's body: as tall as the dashboard made it. */}
        <div className="mt-4 h-40">
          {showChart ? (
            <ContainedErrorBoundary
              renderFallback={(fallback) => {
                return (
                  <p data-testid="widget-fallback">{fallback.error.message}</p>
                );
              }}
            >
              <Suspense fallback={<p className="text-sm text-gray-500">…</p>}>
                <LatencyChart />
              </Suspense>
            </ContainedErrorBoundary>
          ) : (
            <button
              type="button"
              data-testid="show-chart"
              onClick={() => setShowChart(true)}
              className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700"
            >
              Show latency chart
            </button>
          )}
        </div>
      </div>
      <div
        data-unsaved-changes-scope="form"
        className="rounded-xl border border-gray-200 bg-white px-6 py-4"
      >
        <label className="block text-sm font-medium text-gray-700">
          Note
          <textarea
            data-testid="widgets-note"
            rows={3}
            value={note}
            onChange={(event) => setNote(event.target.value)}
            className="mt-1 block w-full rounded-md border border-gray-300 bg-white p-2 text-sm text-gray-900"
          />
        </label>
      </div>
    </section>
  );
}

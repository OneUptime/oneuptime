/*
 * A widget in a bundle of its own (Widgets.js loads it lazily).
 */
import React from "react";

const BUILD = typeof __FIXTURE_BUILD__ === "string" ? __FIXTURE_BUILD__ : "?";

export default function LatencyChart() {
  return (
    <div
      data-testid="latency-chart"
      data-build={BUILD}
      className="flex h-32 items-end gap-1"
    >
      {[40, 55, 35, 70, 60, 85, 50, 45].map((height, index) => {
        return (
          <span
            key={index}
            className="w-6 rounded-t bg-indigo-500"
            style={{ height: `${height}%` }}
          />
        );
      })}
    </div>
  );
}

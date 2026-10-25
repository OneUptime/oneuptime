/*
 * Another page in a bundle of its own; its link carries a query, which the
 * full load into the new version keeps.
 */
import React from "react";

const BUILD = typeof __FIXTURE_BUILD__ === "string" ? __FIXTURE_BUILD__ : "?";

export default function Incidents() {
  return (
    <section
      data-testid="page-incidents"
      data-build={BUILD}
      className="rounded-xl border border-gray-200 bg-white px-6 py-4"
    >
      <h1 className="text-lg font-semibold text-gray-900">Incidents</h1>
      <p className="mt-1 text-sm text-gray-500">Drawn by build {BUILD}.</p>
    </section>
  );
}

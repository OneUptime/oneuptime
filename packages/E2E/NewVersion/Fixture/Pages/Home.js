/*
 * The page a tab opens on, in the app's first bundle: a long list, so a
 * reload into the new version can be seen coming back to the same place.
 */
import React from "react";

const BUILD = typeof __FIXTURE_BUILD__ === "string" ? __FIXTURE_BUILD__ : "?";

export default function Home() {
  return (
    <section
      data-testid="page-home"
      data-build={BUILD}
      className="rounded-xl border border-gray-200 bg-white"
    >
      <div className="border-b border-gray-200 px-6 py-4">
        <h1 className="text-lg font-semibold text-gray-900">Home</h1>
        <p className="mt-1 text-sm text-gray-500">
          Everything that needs attention in this project.
        </p>
      </div>
      <ul className="divide-y divide-gray-100">
        {Array.from({ length: 60 }, (_item, index) => {
          return (
            <li
              key={index}
              data-testid={`home-row-${index + 1}`}
              className="flex items-center justify-between px-6 py-3 text-sm"
            >
              <span className="text-gray-900">Checkout API {index + 1}</span>
              <span className="text-gray-500">Operational</span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/*
 * A page in a bundle of its own, loaded the first time it is opened - a
 * chunk whose name changes with every build, as each Dashboard section's.
 * Its list has a search box, Common's own Input as every list's search: what
 * is typed in it is a query, never work a new version waits for.
 */
import Input from "Common/UI/Components/Input/Input";
import React from "react";

const BUILD = typeof __FIXTURE_BUILD__ === "string" ? __FIXTURE_BUILD__ : "?";

export default function Monitors() {
  return (
    <section
      data-testid="page-monitors"
      data-build={BUILD}
      className="rounded-xl border border-gray-200 bg-white px-6 py-4"
    >
      <h1 className="text-lg font-semibold text-gray-900">Monitors</h1>
      <p className="mt-1 text-sm text-gray-500">Drawn by build {BUILD}.</p>
      <div className="mt-4 max-w-sm">
        <Input
          isSearchOrFilter={true}
          dataTestId="monitors-search"
          placeholder="Search monitors"
          ariaLabel="Search monitors"
          onChange={() => {}}
        />
      </div>
    </section>
  );
}

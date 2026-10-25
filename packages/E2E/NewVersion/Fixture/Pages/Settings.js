/*
 * A page with a form, marked as BasicForm marks its root: what is typed in
 * it is unsaved until it is saved, so nothing reloads the page under it.
 */
import React, { useState } from "react";

const BUILD = typeof __FIXTURE_BUILD__ === "string" ? __FIXTURE_BUILD__ : "?";

export default function Settings() {
  const [description, setDescription] = useState("");

  return (
    <section
      data-testid="page-settings"
      data-build={BUILD}
      className="rounded-xl border border-gray-200 bg-white px-6 py-4"
    >
      <h1 className="text-lg font-semibold text-gray-900">Status page</h1>
      <div data-unsaved-changes-scope="form" className="mt-4">
        <label className="block text-sm font-medium text-gray-700">
          Description
          <textarea
            data-testid="settings-description"
            rows={3}
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            className="mt-1 block w-full rounded-md border border-gray-300 bg-white p-2 text-sm text-gray-900"
          />
        </label>
      </div>
    </section>
  );
}

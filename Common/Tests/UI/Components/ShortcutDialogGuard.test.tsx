import Modal from "../../../UI/Components/Modal/Modal";
import SideOver from "../../../UI/Components/SideOver/SideOver";
import { hasOpenModalDialog } from "../../../UI/Utils/GlobalKeyboardShortcut";
import { describe, expect, it } from "@jest/globals";
import "@testing-library/jest-dom";
import { render } from "@testing-library/react";
import React from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * WHY THIS FILE EXISTS
 *
 * The global shortcut layer stands down while a modal dialog is open, and it
 * decides that by querying the DOM for [role="dialog"][aria-modal="true"] —
 * an agreement with components it never imports. Unit tests on either side
 * would both keep passing if Modal stopped setting aria-modal, and the only
 * symptom in the product would be that "g" then a letter navigates away from
 * a half-filled form.
 *
 * So the guard is exercised against the real components rather than a
 * hand-written fixture.
 */

describe("the shortcut layer's dialog guard, against the real components", () => {
  it("sees nothing on a page with no dialogs", () => {
    render(<div>An ordinary page</div>);

    expect(hasOpenModalDialog(document)).toBe(false);
  });

  it("sees an open Modal", () => {
    const onClose: MockFunction = getJestMockFunction();

    render(
      <Modal title="Create Monitor" onClose={onClose}>
        <div>A half-filled form</div>
      </Modal>,
    );

    expect(hasOpenModalDialog(document)).toBe(true);
  });

  it("does not see a SideOver, which leaves the page behind it live", () => {
    /*
     * SideOver sets role="dialog" WITHOUT aria-modal on purpose — the page
     * behind it is still usable, so its shortcuts should still work.
     */
    const onClose: MockFunction = getJestMockFunction();

    render(
      <SideOver title="Filters" description="Narrow the list" onClose={onClose}>
        <div>Panel body</div>
      </SideOver>,
    );

    expect(hasOpenModalDialog(document)).toBe(false);
  });

  it("stops seeing a Modal once it unmounts", () => {
    const onClose: MockFunction = getJestMockFunction();

    const { unmount } = render(
      <Modal title="Create Monitor" onClose={onClose}>
        <div>A half-filled form</div>
      </Modal>,
    );

    expect(hasOpenModalDialog(document)).toBe(true);

    unmount();

    expect(hasOpenModalDialog(document)).toBe(false);
  });
});

import "@testing-library/jest-dom";
import { afterEach, describe, expect, test } from "@jest/globals";
import { act, cleanup, render } from "@testing-library/react";
import React, { ReactElement, useContext, useLayoutEffect } from "react";
import {
  FormSectionOpenReport,
  OpenFormSections,
  OpenFormSectionsContext,
  ReportFormSectionOpenFunction,
  updateOpenSections,
  useOpenFormSections,
} from "../../../../UI/Components/Forms/Utils/OpenFormSections";

/*
 * A form dialog keeps a record of which folded sections are open, so it can
 * grow to the wide dialog while a Markdown editor in one is shown
 * (FormModalWidth). The sections report themselves; these tests pin the
 * record: by section on screen, unchanged by a report that changes nothing,
 * and each open id listed once.
 */

afterEach(() => {
  cleanup();
});

function report(
  instanceId: string,
  sectionId: string,
  isOpen: boolean,
): FormSectionOpenReport {
  return { instanceId, sectionId, isOpen };
}

describe("updateOpenSections", () => {
  test("records a section that opens, by the section on screen", () => {
    expect(updateOpenSections({}, report(":r1:", "note", true))).toEqual({
      ":r1:": "note",
    });
  });

  test("forgets a section that folds or goes away", () => {
    expect(
      updateOpenSections(
        { ":r1:": "note", ":r2:": "advanced" },
        report(":r1:", "note", false),
      ),
    ).toEqual({ ":r2:": "advanced" });
  });

  test("keeps the same record for a report that changes nothing, so the dialog does not draw again", () => {
    const open: Readonly<Record<string, string>> = { ":r1:": "note" };

    expect(updateOpenSections(open, report(":r1:", "note", true))).toBe(open);

    const none: Readonly<Record<string, string>> = {};

    expect(updateOpenSections(none, report(":r1:", "note", false))).toBe(none);
  });

  test("never changes the record it is handed", () => {
    const open: Readonly<Record<string, string>> = { ":r1:": "note" };

    updateOpenSections(open, report(":r2:", "advanced", true));
    updateOpenSections(open, report(":r1:", "note", false));

    expect(open).toEqual({ ":r1:": "note" });
  });

  test("follows a section on screen that now draws another section", () => {
    expect(
      updateOpenSections({ ":r1:": "note" }, report(":r1:", "advanced", true)),
    ).toEqual({ ":r1:": "advanced" });
  });
});

describe("useOpenFormSections", () => {
  let latest: OpenFormSections | null = null;

  const Dialog: (props: { children?: ReactElement }) => ReactElement = (props: {
    children?: ReactElement;
  }): ReactElement => {
    const openFormSections: OpenFormSections = useOpenFormSections();
    latest = openFormSections;

    return (
      <OpenFormSectionsContext.Provider
        value={openFormSections.reportSectionOpen}
      >
        {props.children || <></>}
      </OpenFormSectionsContext.Provider>
    );
  };

  // Stands in for a folded section: reports itself open while drawn.
  const OpenSection: (props: {
    instanceId: string;
    sectionId: string;
  }) => ReactElement = (props: {
    instanceId: string;
    sectionId: string;
  }): ReactElement => {
    const reportSectionOpen: ReportFormSectionOpenFunction | null = useContext(
      OpenFormSectionsContext,
    );

    useLayoutEffect(() => {
      reportSectionOpen?.(report(props.instanceId, props.sectionId, true));

      return () => {
        reportSectionOpen?.(report(props.instanceId, props.sectionId, false));
      };
    }, []);

    return <></>;
  };

  test("starts with nothing open", () => {
    render(<Dialog />);

    expect(latest!.openSectionIds).toEqual([]);
  });

  test("lists each open section once, however many times it is drawn", () => {
    render(
      <Dialog>
        <>
          <OpenSection instanceId=":a:" sectionId="note" />
          <OpenSection instanceId=":b:" sectionId="note" />
          <OpenSection instanceId=":c:" sectionId="advanced" />
        </>
      </Dialog>,
    );

    expect([...latest!.openSectionIds].sort()).toEqual(["advanced", "note"]);
  });

  test("drops a section once it is no longer drawn", () => {
    const view: ReturnType<typeof render> = render(
      <Dialog>
        <OpenSection instanceId=":a:" sectionId="note" />
      </Dialog>,
    );

    expect(latest!.openSectionIds).toEqual(["note"]);

    view.rerender(<Dialog />);

    expect(latest!.openSectionIds).toEqual([]);
  });

  test("hands out the same reporter on every render", () => {
    const view: ReturnType<typeof render> = render(<Dialog />);
    const first: ReportFormSectionOpenFunction = latest!.reportSectionOpen;

    act(() => {
      first(report(":a:", "note", true));
    });
    view.rerender(<Dialog />);

    expect(latest!.reportSectionOpen).toBe(first);
    expect(latest!.openSectionIds).toEqual(["note"]);
  });

  test("a section outside any dialog reports to no one", () => {
    expect(() => {
      render(<OpenSection instanceId=":a:" sectionId="note" />);
    }).not.toThrow();
  });
});

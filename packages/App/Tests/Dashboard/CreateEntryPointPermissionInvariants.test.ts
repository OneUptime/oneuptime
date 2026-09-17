import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * Seven tables opt out of ModelTable's built-in create modal - they set
 * isCreateable={false} and substitute a card button that navigates to a full
 * create page instead. That substitution also opts them out of ModelTable's
 * permission gate, which is what issue #3306 reported: a Viewer-only user
 * could open the entire "Create New Monitor" wizard and only be refused at
 * submit, with a form-validation error about a field they were never shown.
 *
 * They are copy-paste siblings of one another, so a new one is far more likely
 * to be written by copying an existing file than by reading the gate's
 * documentation - and the omission is invisible to the type checker and to any
 * test that does not happen to render that particular table as a Viewer.
 *
 * The Monitors table is rendered for real, as a Viewer and as an admin, in
 * Common/Tests/App/Dashboard/CreatePageEntryPointPermissions.test.tsx. That is
 * the behavioural test. This file is the cheap net under the other six, and
 * under the seventh if somebody ever removes the gate from it: the App suite
 * runs in a plain Node environment with no renderer, so the wiring is pinned by
 * reading the source, the same way StatusPageResourcesPageInvariants does.
 *
 * Sources are whitespace-squashed first so prettier re-wrapping a line cannot
 * turn a real regression check into a red herring.
 */

const DASHBOARD_SRC: string = path.join(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Dashboard",
  "src",
);

type CreateEntryPoint = {
  /* Path segments below App/FeatureSet/Dashboard/src. */
  file: Array<string>;
  /* The model whose create permission the button must be gated on. */
  model: string;
  /* The button labels that route to the dedicated create page. */
  buttons: Array<string>;
};

const ENTRY_POINTS: Array<CreateEntryPoint> = [
  {
    file: ["Components", "Monitor", "MonitorTable.tsx"],
    model: "Monitor",
    buttons: ["Create Monitor"],
  },
  {
    file: ["Components", "Incident", "IncidentsTable.tsx"],
    model: "Incident",
    buttons: ["Declare Incident", "Create from Template"],
  },
  {
    file: ["Components", "IncidentEpisode", "IncidentEpisodesTable.tsx"],
    model: "IncidentEpisode",
    buttons: ["Create Episode"],
  },
  {
    file: ["Components", "Alert", "AlertsTable.tsx"],
    model: "Alert",
    buttons: ["Create Alert"],
  },
  {
    file: ["Components", "AlertEpisode", "AlertEpisodesTable.tsx"],
    model: "AlertEpisode",
    buttons: ["Create Episode"],
  },
  {
    file: [
      "Components",
      "ScheduledMaintenance",
      "ScheduledMaintenanceTable.tsx",
    ],
    model: "ScheduledMaintenance",
    buttons: ["Create Scheduled Maintenance Event", "Create from Template"],
  },
  {
    file: ["Components", "Announcement", "AnnouncementsTable.tsx"],
    model: "StatusPageAnnouncement",
    buttons: ["Create Announcement", "Create from Template"],
  },
];

type ReadSourceFunction = (segments: Array<string>) => string;

const readSource: ReadSourceFunction = (segments: Array<string>): string => {
  return fs
    .readFileSync(path.join(DASHBOARD_SRC, ...segments), "utf-8")
    .replace(/\s+/g, " ");
};

describe("dedicated create-page entry points are permission gated", () => {
  for (const entryPoint of ENTRY_POINTS) {
    const name: string = entryPoint.file[entryPoint.file.length - 1] as string;

    describe(name, () => {
      const source: string = readSource(entryPoint.file);

      test("routes its create button through the permission gate", () => {
        expect(source).toContain("PermissionGate.gateCardButton");
      });

      test("gates on the create permission of its own model", () => {
        expect(source).toContain(
          `new ${entryPoint.model}(), ModelAction.Create`,
        );
      });

      /*
       * A button that survives outside the gate is exactly the regression this
       * file exists to catch: the label is still on screen, still navigates,
       * and refuses the user two pages later.
       */
      for (const button of entryPoint.buttons) {
        test(`"${button}" is inside a gateCardButton call`, () => {
          const declaration: string = `title: "${button}"`;

          expect(source).toContain(declaration);

          const gateIndex: number = source.lastIndexOf(
            "PermissionGate.gateCardButton",
            source.indexOf(declaration),
          );

          expect(gateIndex).toBeGreaterThan(-1);

          /*
           * The nearest preceding gate call has to be close by - a button
           * declared hundreds of characters after the last gate is a sibling
           * that was left ungated, not one the gate wraps.
           */
          expect(source.indexOf(declaration) - gateIndex).toBeLessThan(200);
        });
      }
    });
  }
});

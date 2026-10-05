import "@testing-library/jest-dom";
import { cleanup, render, screen, within } from "@testing-library/react";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import React from "react";

/*
 * A STATE CHANGE DIALOG OFFERS ITS NOTE ONLY TO SOMEONE WHO MAY POST IT.
 *
 * The server refuses a state change whose note the person changing the
 * state may not post - the whole change, so nobody is left recorded as told
 * by a public note that was never posted (Common Server/Utils/StatusPage/
 * StateChangePublicNote). A dialog that offered the note to such a person
 * would only walk them into that refusal. So every state change dialog, and
 * the Change State bulk action, names the note it posts (noteModel), and
 * "Add a public note" / "Add a private note" - the template picker and the
 * editor in it - is left out for someone whose permissions do not create
 * that note. The notify box and the state picker stay.
 *
 * Who the person is comes from the permission snapshot the dashboard keeps
 * (PermissionGate). Before it arrives the note is offered: the server keeps
 * the last word, as it always has.
 */

let isMasterAdminForTest: boolean = false;
let permissionsForTest: Array<unknown> = [];

jest.mock("../../../UI/Utils/User", () => {
  return {
    __esModule: true,
    default: {
      isMasterAdmin: (): boolean => {
        return isMasterAdminForTest;
      },
      getUserId: (): null => {
        return null;
      },
    },
  };
});

jest.mock("../../../UI/Utils/Permission", () => {
  return {
    __esModule: true,
    default: {
      getAllPermissions: (): Array<unknown> => {
        return permissionsForTest;
      },
      getProjectPermissions: (): null => {
        return null;
      },
      getGlobalPermissions: (): null => {
        return null;
      },
    },
  };
});

jest.mock("react-i18next", () => {
  return {
    useTranslation: () => {
      return {
        t: (key: string, options?: { defaultValue?: string }): string => {
          return options?.defaultValue ?? key;
        },
      };
    },
  };
});

import {
  STATE_CHANGE_NOTIFY_FIELD_KEY,
  canPostStateChangeNote,
  getStateChangeFormFields,
} from "../../../../App/FeatureSet/Dashboard/src/Components/EventView/StateChangeFormFields";
import BulkChangeStateModal, {
  BulkChangeStateSubmitData,
  getBulkChangeStateFormFields,
} from "../../../../App/FeatureSet/Dashboard/src/Components/EventView/BulkChangeStateModal";
import {
  BulkStateChangeNoteTemplate,
  BulkStateChangeNoteType,
} from "../../../../App/FeatureSet/Dashboard/src/Utils/BulkStateChange";
import AlertEpisodeInternalNote from "../../../Models/DatabaseModels/AlertEpisodeInternalNote";
import AlertInternalNote from "../../../Models/DatabaseModels/AlertInternalNote";
import IncidentEpisodeInternalNote from "../../../Models/DatabaseModels/IncidentEpisodeInternalNote";
import IncidentPublicNote from "../../../Models/DatabaseModels/IncidentPublicNote";
import ScheduledMaintenancePublicNote from "../../../Models/DatabaseModels/ScheduledMaintenancePublicNote";
import { JSONObject } from "../../../Types/JSON";
import Permission from "../../../Types/Permission";
import Field from "../../../UI/Components/Forms/Types/Field";
import Fields from "../../../UI/Components/Forms/Types/Fields";
import PermissionGate, {
  PermissionCheckableModel,
} from "../../../UI/Utils/PermissionGate";
import getJestMockFunction from "../../MockType";

const TEMPLATES: Array<BulkStateChangeNoteTemplate> = [
  {
    id: "cccccccc-cccc-4ccc-8ccc-ccccccccccc1",
    templateName: "Resolved",
    note: "This incident is resolved.",
  },
];

function keyOf(field: Field<JSONObject>): string {
  return field.overrideFieldKey || Object.keys(field.field || {})[0] || "";
}

// The fields on screen: those whose showIf (if any) lets them show.
function visibleKeys(fields: Fields<JSONObject>): Array<string> {
  return fields
    .filter((field: Field<JSONObject>): boolean => {
      return !field.showIf || field.showIf({});
    })
    .map(keyOf);
}

function incidentDialogFields(
  noteModel?: PermissionCheckableModel,
): Fields<JSONObject> {
  return getStateChangeFormFields<JSONObject>({
    noteType: BulkStateChangeNoteType.Public,
    noteDescription:
      "Post a public note about this state change to the status page.",
    noteTemplates: TEMPLATES,
    notifySubscribers: { byDefault: true },
    ...(noteModel ? { noteModel: noteModel } : {}),
  });
}

beforeEach(() => {
  isMasterAdminForTest = false;
  permissionsForTest = [];
  PermissionGate.clearPermissionPropsCache();
});

afterEach(() => {
  cleanup();
});

interface NoteCase {
  dialog: string;
  noteModel: () => PermissionCheckableModel;
  // A role that may post this note.
  mayPost: Permission;
  // A role that may change the state but not post this note.
  mayOnlyChangeState: Permission;
}

const NOTE_CASES: Array<NoteCase> = [
  {
    dialog: "an incident's",
    noteModel: (): PermissionCheckableModel => {
      return new IncidentPublicNote();
    },
    mayPost: Permission.IncidentMember,
    mayOnlyChangeState: Permission.CreateIncidentStateTimeline,
  },
  {
    dialog: "a scheduled maintenance event's",
    noteModel: (): PermissionCheckableModel => {
      return new ScheduledMaintenancePublicNote();
    },
    mayPost: Permission.ScheduledMaintenanceMember,
    mayOnlyChangeState: Permission.CreateScheduledMaintenanceStateTimeline,
  },
  {
    dialog: "an alert's",
    noteModel: (): PermissionCheckableModel => {
      return new AlertInternalNote();
    },
    mayPost: Permission.AlertMember,
    mayOnlyChangeState: Permission.CreateAlertStateTimeline,
  },
  {
    dialog: "an incident episode's",
    noteModel: (): PermissionCheckableModel => {
      return new IncidentEpisodeInternalNote();
    },
    mayPost: Permission.IncidentMember,
    mayOnlyChangeState: Permission.CreateIncidentEpisodeStateTimeline,
  },
  {
    dialog: "an alert episode's",
    noteModel: (): PermissionCheckableModel => {
      return new AlertEpisodeInternalNote();
    },
    mayPost: Permission.AlertMember,
    mayOnlyChangeState: Permission.CreateAlertEpisodeStateTimeline,
  },
];

describe("canPostStateChangeNote", () => {
  test.each(NOTE_CASES)(
    "$dialog note: yes for a role that may create it",
    (noteCase: NoteCase) => {
      permissionsForTest = [noteCase.mayPost];

      expect(canPostStateChangeNote(noteCase.noteModel())).toBe(true);
    },
  );

  test.each(NOTE_CASES)(
    "$dialog note: no for a role that may only change the state",
    (noteCase: NoteCase) => {
      permissionsForTest = [noteCase.mayOnlyChangeState];

      expect(canPostStateChangeNote(noteCase.noteModel())).toBe(false);
    },
  );

  test("yes for a master admin, whatever the snapshot says", () => {
    isMasterAdminForTest = true;
    permissionsForTest = [Permission.CreateIncidentStateTimeline];

    expect(canPostStateChangeNote(new IncidentPublicNote())).toBe(true);
  });

  test("yes while the permissions have not arrived: the server decides", () => {
    permissionsForTest = [];

    expect(canPostStateChangeNote(new IncidentPublicNote())).toBe(true);
  });

  test("yes for the project's owners and admins", () => {
    for (const role of [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
    ]) {
      permissionsForTest = [role];

      expect({
        role,
        offered: canPostStateChangeNote(new IncidentPublicNote()),
      }).toEqual({ role, offered: true });
    }
  });
});

describe("the state change dialog's note", () => {
  test("is offered, with its template picker, to someone who may post it", () => {
    permissionsForTest = [Permission.IncidentMember];

    expect(visibleKeys(incidentDialogFields(new IncidentPublicNote()))).toEqual(
      [STATE_CHANGE_NOTIFY_FIELD_KEY, "publicNoteTemplate", "publicNote"],
    );
  });

  test("is left out for someone who may only change the state: the notify box stays", () => {
    permissionsForTest = [Permission.CreateIncidentStateTimeline];

    expect(visibleKeys(incidentDialogFields(new IncidentPublicNote()))).toEqual(
      [STATE_CHANGE_NOTIFY_FIELD_KEY],
    );
  });

  test("is offered when the dialog does not say which note it posts", () => {
    permissionsForTest = [Permission.CreateIncidentStateTimeline];

    expect(visibleKeys(incidentDialogFields())).toEqual([
      STATE_CHANGE_NOTIFY_FIELD_KEY,
      "publicNoteTemplate",
      "publicNote",
    ]);
  });

  test("the fields are all still there, for the form guards: only their showIf hides them", () => {
    permissionsForTest = [Permission.CreateIncidentStateTimeline];

    expect(incidentDialogFields(new IncidentPublicNote()).map(keyOf)).toEqual([
      STATE_CHANGE_NOTIFY_FIELD_KEY,
      "publicNoteTemplate",
      "publicNote",
    ]);
  });

  test.each(NOTE_CASES)(
    "$dialog private or public note follows its own permission",
    (noteCase: NoteCase) => {
      const fields: () => Fields<JSONObject> = (): Fields<JSONObject> => {
        return getStateChangeFormFields<JSONObject>({
          noteType: BulkStateChangeNoteType.Private,
          noteDescription: "Post a private note about this state change.",
          noteTemplates: TEMPLATES,
          noteModel: noteCase.noteModel(),
        });
      };

      permissionsForTest = [noteCase.mayPost];
      expect(visibleKeys(fields())).toEqual([
        "privateNoteTemplate",
        "privateNote",
      ]);

      permissionsForTest = [noteCase.mayOnlyChangeState];
      expect(visibleKeys(fields())).toEqual([]);
    },
  );
});

describe("the Change State bulk action", () => {
  function bulkFields(
    noteModel?: PermissionCheckableModel,
  ): Fields<JSONObject> {
    return getBulkChangeStateFormFields({
      stateFieldKey: "incidentStateId",
      stateOptions: [{ value: "resolved", label: "Resolved" }],
      noteType: BulkStateChangeNoteType.Public,
      noteTitle: "Public Note",
      noteDescription: "The same note is added to every incident you selected.",
      noteTemplates: TEMPLATES,
      showNotifyStatusPageSubscribers: true,
      ...(noteModel ? { noteModel: noteModel } : {}),
    });
  }

  test("keeps the state and the notify box, and leaves the note out for someone who may not post it", () => {
    permissionsForTest = [Permission.CreateIncidentStateTimeline];

    expect(visibleKeys(bulkFields(new IncidentPublicNote()))).toEqual([
      "incidentStateId",
      STATE_CHANGE_NOTIFY_FIELD_KEY,
    ]);
  });

  test("offers the note to someone who may post it", () => {
    permissionsForTest = [Permission.IncidentAdmin];

    expect(visibleKeys(bulkFields(new IncidentPublicNote()))).toEqual([
      "incidentStateId",
      STATE_CHANGE_NOTIFY_FIELD_KEY,
      "publicNoteTemplate",
      "publicNote",
    ]);
  });

  function renderBulk(): void {
    render(
      <BulkChangeStateModal
        title="Change Incident State"
        description="Select the state to change incidents to."
        stateFieldKey="incidentStateId"
        stateOptions={[{ value: "resolved", label: "Resolved" }]}
        noteType={BulkStateChangeNoteType.Public}
        noteTitle="Public Note"
        noteDescription="The same note is added to every incident you selected."
        noteTemplates={TEMPLATES}
        noteModel={new IncidentPublicNote()}
        showNotifyStatusPageSubscribers={true}
        onClose={getJestMockFunction()}
        onSubmit={
          getJestMockFunction() as unknown as (
            data: BulkChangeStateSubmitData,
          ) => Promise<void>
        }
      />,
    );
  }

  test("drawn for someone who may only change the state: no 'Add a public note' line", async () => {
    permissionsForTest = [Permission.CreateIncidentStateTimeline];

    renderBulk();

    const modal: HTMLElement = screen.getByTestId("modal");

    expect(
      await within(modal).findByRole("checkbox", {
        name: "Notify Status Page Subscribers",
      }),
    ).toBeInTheDocument();
    expect(
      within(modal).queryByRole("button", { name: "Add a public note" }),
    ).toBeNull();
  });

  test("drawn for someone who may post it: the folded 'Add a public note' line is there", async () => {
    permissionsForTest = [Permission.IncidentMember];

    renderBulk();

    const modal: HTMLElement = screen.getByTestId("modal");

    expect(
      await within(modal).findByRole("button", { name: "Add a public note" }),
    ).toBeInTheDocument();
  });
});

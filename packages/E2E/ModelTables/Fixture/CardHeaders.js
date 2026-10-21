/*
 * The card header gallery (/dashboard/<project>/card-headers): one card of
 * every header shape the product draws, side by side the way the pages put
 * them, for CardHeaders.spec.ts to measure where each card's description
 * sits under its title ("There's a lot of gap between the title of the card
 * and the description of the card").
 *
 * Every card is the production Card with production controls: a table's
 * header toolbar (TableHeaderToolbar, its "Search... /" pill, the main button
 * and the ⋯), a details card's Edit, a status pill. Each is wrapped in
 * `data-testid="shape-<name>"`, and holds a body (`shape-body`) so the spec
 * can tell that nothing in the header runs into what comes after it.
 *
 * The page is a wide column of the table cards and the default header, then
 * an overview page's grid: a main column two thirds wide and the one-third
 * column the stacked header is for.
 */
import React, { useState } from "react";
import Card from "Common/UI/Components/Card/Card";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import Pill from "Common/UI/Components/Pill/Pill";
import {
  TableHeaderSearchSlot,
  TableHeaderToolbar,
  getTableHeaderButtons,
} from "Common/UI/Components/Table/TableHeaderControls";
import IconProp from "Common/Types/Icon/IconProp";
import { Green500 } from "Common/Types/BrandColors";

function noop() {}

const EDIT = {
  title: "Edit",
  icon: IconProp.Edit,
  buttonStyle: ButtonStyleType.NORMAL,
  onClick: noop,
};

const CREATE_RUNBOOK = {
  title: "Create Runbook",
  icon: IconProp.Add,
  buttonStyle: ButtonStyleType.NORMAL,
  onClick: noop,
};

const REFRESH = {
  title: "",
  icon: IconProp.Refresh,
  buttonStyle: ButtonStyleType.OUTLINE,
  onClick: noop,
};

const ASSIGN = {
  title: "Assign Role",
  icon: IconProp.Add,
  buttonStyle: ButtonStyleType.NORMAL,
  onClick: noop,
};

const REFRESH_WITH_TITLE = {
  title: "Refresh",
  icon: IconProp.Refresh,
  buttonStyle: ButtonStyleType.OUTLINE,
  onClick: noop,
};

const ONE_LINE =
  "Reusable response procedures: ordered checklists of manual or automated steps.";

const WRAPPED =
  "An incident is a problem that affects your users, like an outage or a slowdown. Declare one to page on-call, track the fix and update your status page. Everyone on the incident sees the same timeline, the same notes and the same next step, so nobody has to ask what is happening or who is on it.";

// A table's header controls, drawn as every model table draws them.
function TableControls() {
  const [isOpen, setIsOpen] = useState(false);
  return (
    <TableHeaderToolbar
      isSearchOpen={isOpen}
      search={
        <TableHeaderSearchSlot
          isOpen={isOpen}
          onOpen={() => {
            setIsOpen(true);
          }}
        >
          <input
            aria-label="Search runbooks"
            className="block w-full rounded-md border border-gray-300 px-3 py-2.5 text-sm md:py-2"
            placeholder="Search runbooks"
          />
        </TableHeaderSearchSlot>
      }
    >
      {getTableHeaderButtons([CREATE_RUNBOOK, REFRESH])}
    </TableHeaderToolbar>
  );
}

function Body() {
  return (
    <div
      data-testid="shape-body"
      className="rounded-md border border-dashed border-gray-300 px-3 py-2 text-sm text-gray-500"
    >
      What the card holds.
    </div>
  );
}

function Shape(props) {
  return (
    <div data-testid={`shape-${props.name}`}>
      <Card bodyClassName={props.bodyClassName} {...props.card}>
        <Body />
      </Card>
    </div>
  );
}

const TABLE_CARDS = [
  // The Runbooks list of the maintainer's screenshot.
  {
    name: "toolbar-one-line",
    card: {
      headerLayout: "toolbar",
      title: "Runbooks",
      description: ONE_LINE,
      buttons: [<TableControls key="controls" />],
    },
  },
  {
    name: "toolbar-wrapped",
    card: {
      headerLayout: "toolbar",
      title: "Incidents",
      description: WRAPPED,
      buttons: [<TableControls key="controls" />],
    },
  },
  {
    name: "toolbar-no-description",
    card: {
      headerLayout: "toolbar",
      title: "Runbooks",
      buttons: [<TableControls key="controls" />],
    },
  },
  {
    name: "toolbar-no-actions",
    card: {
      headerLayout: "toolbar",
      title: "Runbooks",
      description: ONE_LINE,
    },
  },
  {
    name: "toolbar-pill",
    card: {
      headerLayout: "toolbar",
      title: "Runbooks",
      description: ONE_LINE,
      rightElement: <Pill text="3 enabled" color={Green500} isMinimal={true} />,
    },
  },
];

const MAIN_COLUMN = [
  {
    name: "default-edit",
    bodyClassName: undefined,
    card: {
      title: "Incident Description",
      description: "What happened, in the words of whoever declared it.",
      buttons: [EDIT],
    },
  },
  {
    name: "default-no-actions",
    bodyClassName: undefined,
    card: {
      title: "Incident Description",
      description: "What happened, in the words of whoever declared it.",
    },
  },
];

const SIDE_COLUMN = [
  {
    name: "stacked-edit",
    card: {
      headerLayout: "stacked",
      title: "Details",
      description: "Key facts about this incident.",
      buttons: [EDIT],
    },
  },
  {
    name: "stacked-wrapped",
    card: {
      headerLayout: "stacked",
      title: "Details",
      description:
        "Key facts about this incident: who declared it, when, how severe it is and which monitors and services it touches.",
      buttons: [EDIT],
    },
  },
  {
    name: "stacked-long-title",
    card: {
      headerLayout: "stacked",
      title: "Scheduled Maintenance Details",
      description: "Key facts about this event.",
      buttons: [EDIT],
    },
  },
  {
    name: "stacked-pill",
    card: {
      headerLayout: "stacked",
      title: "AI Investigation",
      description: "OneUptime AI's root-cause report.",
      rightElement: <Pill text="Completed" color={Green500} isMinimal={true} />,
    },
  },
  {
    name: "stacked-actions-under",
    card: {
      headerLayout: "stacked",
      title: "Incident Roles",
      description: "Who does what on this incident.",
      buttons: [ASSIGN, REFRESH_WITH_TITLE],
    },
  },
  {
    name: "stacked-no-description",
    card: {
      headerLayout: "stacked",
      title: "Details",
      buttons: [EDIT],
    },
  },
  {
    name: "stacked-no-actions",
    card: {
      headerLayout: "stacked",
      title: "Video Call",
      description: "Where this incident's responders talk it through.",
    },
  },
];

export default function CardHeadersPage() {
  return (
    <div data-testid="card-header-gallery">
      {TABLE_CARDS.map((shape) => {
        // As a model table draws its card: the rows start under the header.
        return <Shape key={shape.name} bodyClassName="" {...shape} />;
      })}
      <div className="grid grid-cols-1 gap-x-5 lg:grid-cols-3">
        <div className="lg:col-span-2">
          {MAIN_COLUMN.map((shape) => {
            return <Shape key={shape.name} {...shape} />;
          })}
        </div>
        <div data-testid="side-column">
          {SIDE_COLUMN.map((shape) => {
            return <Shape key={shape.name} {...shape} />;
          })}
        </div>
      </div>
    </div>
  );
}

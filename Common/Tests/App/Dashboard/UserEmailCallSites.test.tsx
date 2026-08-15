import "@testing-library/jest-dom";
import { render, screen, waitFor } from "@testing-library/react";
import React, { ReactElement } from "react";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * UserElement can only show an email the caller actually asked the API for,
 * and an avatar it was given an id for. Two families of call sites failed one
 * of those and would have kept rendering a bare name after the component
 * change:
 *
 *   - the notification-log tables passed `selectMoreFields={{user: {name}}}`.
 *     BaseModelTable's getSelectFields ASSIGNS selectMoreFields over the
 *     select the columns built, rather than merging into it, so the narrower
 *     one won and only the name was ever fetched.
 *   - the team compliance table hand-builds its user object and left out the
 *     id, so the avatar route could not be built at all.
 *
 * Both are invisible in a screenshot of a seeded dev project (short names, a
 * default avatar) and silent in every other suite, so they are pinned here.
 */

const BLANK_PROFILE_PIC: string = "/blank-profile.svg";

jest.mock("../../../UI/Images/users/blank-profile.svg", () => {
  return BLANK_PROFILE_PIC;
});

jest.mock("../../../UI/Utils/Permission", () => {
  return {
    __esModule: true,
    default: {
      getAllPermissions: () => {
        return [];
      },
      getProjectPermissions: () => {
        return [];
      },
      getGlobalPermissions: () => {
        return [];
      },
    },
  };
});

/*
 * The real ModelTable would drag in the facet bar, URL state and the pager.
 * What matters here is the select it was handed and what its User column does
 * with a row, so it is replaced by a recorder.
 */
type CapturedTableProps = {
  selectMoreFields?: Record<string, unknown> | undefined;
  columns: Array<{
    title?: string | undefined;
    field?: Record<string, unknown> | undefined;
    getElement?: ((item: Record<string, unknown>) => ReactElement) | undefined;
  }>;
};

let capturedTableProps: CapturedTableProps | null = null;

jest.mock("../../../UI/Components/ModelTable/ModelTable", () => {
  return {
    __esModule: true,
    default: (props: CapturedTableProps) => {
      capturedTableProps = props;
      return null;
    },
  };
});

import CallLogsTable from "../../../../App/FeatureSet/Dashboard/src/Components/NotificationLogs/CallLogsTable";
import EmailLogsTable from "../../../../App/FeatureSet/Dashboard/src/Components/NotificationLogs/EmailLogsTable";
import PushLogsTable from "../../../../App/FeatureSet/Dashboard/src/Components/NotificationLogs/PushLogsTable";
import SmsLogsTable from "../../../../App/FeatureSet/Dashboard/src/Components/NotificationLogs/SmsLogsTable";
import TelegramLogsTable from "../../../../App/FeatureSet/Dashboard/src/Components/NotificationLogs/TelegramLogsTable";
import WebhookLogsTable from "../../../../App/FeatureSet/Dashboard/src/Components/NotificationLogs/WebhookLogsTable";
import WhatsAppLogsTable from "../../../../App/FeatureSet/Dashboard/src/Components/NotificationLogs/WhatsAppLogsTable";
import WorkspaceLogsTable from "../../../../App/FeatureSet/Dashboard/src/Components/NotificationLogs/WorkspaceLogsTable";
import TeamComplianceStatusTable from "../../../../App/FeatureSet/Dashboard/src/Components/Team/TeamComplianceStatusTable";
import API from "../../../UI/Utils/API/API";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import ProjectUtil from "../../../UI/Utils/Project";
import ObjectID from "../../../Types/ObjectID";

const PROJECT_ID: ObjectID = new ObjectID(
  "00000000-0000-4000-8000-000000000001",
);
const TEAM_ID: ObjectID = new ObjectID("00000000-0000-4000-8000-000000000002");
const USER_ID: string = "00000000-0000-4000-8000-000000000003";

const NOTIFICATION_LOG_TABLES: Array<{
  name: string;
  Component: React.FunctionComponent<any>;
}> = [
  { name: "CallLogsTable", Component: CallLogsTable },
  { name: "EmailLogsTable", Component: EmailLogsTable },
  { name: "PushLogsTable", Component: PushLogsTable },
  { name: "SmsLogsTable", Component: SmsLogsTable },
  { name: "TelegramLogsTable", Component: TelegramLogsTable },
  { name: "WebhookLogsTable", Component: WebhookLogsTable },
  { name: "WhatsAppLogsTable", Component: WhatsAppLogsTable },
  { name: "WorkspaceLogsTable", Component: WorkspaceLogsTable },
];

type UserColumnFunction = () => CapturedTableProps["columns"][0];

const userColumn: UserColumnFunction = (): CapturedTableProps["columns"][0] => {
  const column: CapturedTableProps["columns"][0] | undefined =
    capturedTableProps?.columns.find(
      (candidate: CapturedTableProps["columns"][0]) => {
        return candidate.title === "User";
      },
    );

  if (!column) {
    throw new Error(
      `No "User" column. Columns: ${(capturedTableProps?.columns || [])
        .map((candidate: CapturedTableProps["columns"][0]) => {
          return candidate.title;
        })
        .join(", ")}`,
    );
  }

  return column;
};

describe("notification log tables", () => {
  beforeEach(() => {
    capturedTableProps = null;
    jest.spyOn(ProjectUtil, "getCurrentProjectId").mockReturnValue(PROJECT_ID);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe.each(NOTIFICATION_LOG_TABLES)(
    "$name",
    ({ Component }: { Component: React.FunctionComponent<any> }) => {
      beforeEach(() => {
        render(<Component />);
      });

      /*
       * selectMoreFields overwrites the column's user select rather than
       * merging with it. Narrowing it back to { name } silently drops the
       * email off the wire and the row goes back to a bare name, with the
       * column definition still (misleadingly) asking for the email.
       */
      test("asks the API for the email, not just the name", () => {
        expect(capturedTableProps!.selectMoreFields!["user"]).toEqual(
          expect.objectContaining({ email: true }),
        );
      });

      test("asks the API for the profile picture too", () => {
        expect(capturedTableProps!.selectMoreFields!["user"]).toEqual(
          expect.objectContaining({ profilePictureId: true }),
        );
      });

      /*
       * The two selects have to agree: whichever one wins, the column's
       * getElement must have the fields it renders.
       */
      test("selects the same user fields in the column and in selectMoreFields", () => {
        expect(capturedTableProps!.selectMoreFields!["user"]).toEqual(
          userColumn().field!["user"],
        );
      });

      test("renders the name, the email and the avatar for a log row", () => {
        render(
          userColumn().getElement!({
            user: {
              _id: USER_ID,
              name: "Jane Doe",
              email: "jane@acme.com",
            },
          }),
        );

        expect(screen.getByText("Jane Doe")).toBeInTheDocument();
        expect(screen.getByTestId("user-email")).toHaveTextContent(
          "jane@acme.com",
        );
        expect(screen.getAllByRole("img")[0]).toHaveAttribute(
          "src",
          `/api/user/profile-picture/${USER_ID}`,
        );
      });

      test("still renders a dash for a log row with no user", () => {
        render(userColumn().getElement!({}));

        expect(screen.getByText("-")).toBeInTheDocument();
      });
    },
  );
});

describe("team compliance status table", () => {
  const complianceResponse: {
    teamId: string;
    teamName: string;
    complianceSettings: Array<{ ruleType: string; enabled: boolean }>;
    userComplianceStatuses: Array<{
      userId: string;
      userName: string;
      userEmail: string;
      isCompliant: boolean;
      nonCompliantRules: Array<{ ruleType: string; reason: string }>;
    }>;
  } = {
    teamId: TEAM_ID.toString(),
    teamName: "On-Call",
    complianceSettings: [
      { ruleType: "HasNotificationEmailMethod", enabled: true },
    ],
    userComplianceStatuses: [
      {
        userId: USER_ID,
        userName: "Jane Doe",
        userEmail: "jane@acme.com",
        isCompliant: false,
        nonCompliantRules: [
          {
            ruleType: "HasNotificationEmailMethod",
            reason: "No email notification method",
          },
        ],
      },
    ],
  };

  beforeEach(async () => {
    jest.spyOn(ModelAPI, "getCommonHeaders").mockReturnValue({});
    jest
      .spyOn(API, "get")
      .mockResolvedValue({ data: complianceResponse } as never);

    render(<TeamComplianceStatusTable teamId={TEAM_ID} />);

    await waitFor(() => {
      expect(screen.getByText("Jane Doe")).toBeInTheDocument();
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("shows the member's email beside their name", () => {
    expect(screen.getByTestId("user-email")).toHaveTextContent("jane@acme.com");
  });

  /*
   * The row is hand-built from the compliance payload. Without the id the
   * avatar route cannot be built and every member falls back to the blank
   * picture, which reads as "nobody has a photo" rather than as a bug.
   */
  test("builds the avatar from the member's own id", () => {
    expect(screen.getAllByRole("img")[0]).toHaveAttribute(
      "src",
      `/api/user/profile-picture/${USER_ID}`,
    );
  });

  test("still shows why the member is non-compliant", () => {
    expect(screen.getByText("Non-Compliant")).toBeInTheDocument();
    expect(
      screen.getByText(/No email notification method/),
    ).toBeInTheDocument();
  });
});

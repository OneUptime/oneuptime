import "@testing-library/jest-dom";
import { cleanup, render, screen } from "@testing-library/react";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "@jest/globals";
import { createInstance, i18n } from "i18next";
import React, { ReactElement } from "react";
import { I18nextProvider } from "react-i18next";
import NotificationChannelOffPanel, {
  NOTIFICATION_CHANNEL_OFF_SENTENCE_TEST_ID,
} from "../../../../App/FeatureSet/Dashboard/src/Components/NotificationMethods/NotificationChannelOffPanel";
import { ProjectChannelState } from "../../../../App/FeatureSet/Dashboard/src/Components/NotificationMethods/ProjectNotificationChannels";
import ProjectNotificationChannelsCopy, {
  CHANNEL_GATED_METHOD_LISTS,
  ChannelGatedMethodListDefinition,
} from "../../../../App/FeatureSet/Dashboard/src/Components/NotificationMethods/ProjectNotificationChannelsCopy";
import {
  ChannelStepCopy,
  SetupStep,
  SetupStepImportance,
  SetupStepStatus,
} from "../../../../App/FeatureSet/Dashboard/src/Components/UserSettings/SetupChecklist/ChecklistModel";
import SetupChecklistTile, {
  BLOCKED_STEP_LABEL,
} from "../../../../App/FeatureSet/Dashboard/src/Components/UserSettings/SetupChecklist/SetupChecklistTile";
import PageMap from "../../../../App/FeatureSet/Dashboard/src/Utils/PageMap";
import englishLocale from "../../../../App/FeatureSet/Dashboard/src/Locales/en.json";
import germanLocale from "../../../../App/FeatureSet/Dashboard/src/Locales/de.json";
import IconProp from "../../../Types/Icon/IconProp";
import Permission from "../../../Types/Permission";

/*
 * Who can turn a channel on, in German, from the real locale files.
 *
 * A project's SMS, phone calls, WhatsApp and Telegram may be turned on only
 * by a project owner or someone with Manage Billing. Every sentence that
 * says so is one whole key, so each language gives "it" the gender of the
 * channel it stands for - and these are drawn through the translator where
 * they are shown, so a German reader reads German:
 *
 *  - the sentence above a person's own method list while its channel is off
 *    (for someone who may not turn it on);
 *  - the setup checklist's step for a verified method on a channel that is
 *    off, its label, and the step a reader who may turn it on is given.
 */

const german: i18n = createInstance();

const DE: Record<string, string> = germanLocale as unknown as Record<
  string,
  string
>;

const PROJECT_ID: string = "dddddddd-4444-4444-8444-444444444444";

const withGerman: (children: ReactElement) => ReactElement = (
  children: ReactElement,
): ReactElement => {
  return <I18nextProvider i18n={german}>{children}</I18nextProvider>;
};

const signInAs: (permissions: Array<Permission>) => void = (
  permissions: Array<Permission>,
): void => {
  localStorage.setItem("user_id", "aaaaaaaa-1111-4111-8111-111111111111");
  localStorage.setItem("is_master_admin", "false");
  sessionStorage.setItem("current_project_id", PROJECT_ID);
  localStorage.setItem(
    "global_permissions",
    JSON.stringify({
      _type: "UserGlobalAccessPermission",
      projectIds: [],
      globalPermissions: [
        Permission.Public,
        Permission.User,
        Permission.CurrentUser,
      ],
    }),
  );
  localStorage.setItem(
    "project_permissions",
    JSON.stringify({
      projectId: PROJECT_ID,
      permissions: permissions.map((permission: Permission) => {
        return { permission: permission };
      }),
    }),
  );
};

const channelStep: (
  status: SetupStepStatus,
  detail: string,
  actionTitle: string,
) => SetupStep = (
  status: SetupStepStatus,
  detail: string,
  actionTitle: string,
): SetupStep => {
  return {
    key: "channels-enabled",
    title: "At least one of your channels is usable here",
    description:
      "A project can switch off SMS, calls, WhatsApp and Telegram. A verified method on a channel that is off cannot be used.",
    detail: detail,
    status: status,
    importance: SetupStepImportance.Required,
    icon: IconProp.Settings,
    iconBackgroundClassName: "bg-slate-500",
    pageMap:
      status === SetupStepStatus.Incomplete
        ? PageMap.SETTINGS_NOTIFICATION_SETTINGS
        : undefined,
    actionTitle: actionTitle,
  };
};

beforeAll(async () => {
  await german.init({
    lng: "de",
    fallbackLng: "en",
    resources: {
      en: { translation: englishLocale },
      de: { translation: germanLocale },
    },
    interpolation: { escapeValue: false },
  });
});

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});

afterEach(() => {
  cleanup();
  localStorage.clear();
  sessionStorage.clear();
});

describe("in German, the sentences that say who can turn a channel on", () => {
  test("are translated, every one, and still name Manage Billing", () => {
    const keys: Array<string> = [
      ...CHANNEL_GATED_METHOD_LISTS.map(
        (definition: ChannelGatedMethodListDefinition): string => {
          return definition.offSentence;
        },
      ),
      ProjectNotificationChannelsCopy.whoCanChange,
      ChannelStepCopy.whoCanTurnOnDetail,
      ChannelStepCopy.canTurnOnDetail,
    ];

    for (const key of keys) {
      expect([key, typeof DE[key]]).toEqual([key, "string"]);
      expect([key, DE[key] === key]).toEqual([key, false]);
    }

    // The permission keeps the name people see it under in the permissions list.
    for (const definition of CHANNEL_GATED_METHOD_LISTS) {
      expect(DE[definition.offSentence]).toContain("„Manage Billing“");
      expect(DE[definition.offSentence]).toContain("Projekteigentümer");
    }
  });

  test.each(
    CHANNEL_GATED_METHOD_LISTS.map(
      (definition: ChannelGatedMethodListDefinition) => {
        return [definition.list, definition];
      },
    ),
  )(
    "%s: a project admin reads the German sentence above the list",
    (_list: string, definition: ChannelGatedMethodListDefinition) => {
      signInAs([Permission.ProjectAdmin]);

      render(
        withGerman(
          <NotificationChannelOffPanel
            list={definition.list}
            state={ProjectChannelState.Off}
          />,
        ),
      );

      expect(
        screen.getByTestId(NOTIFICATION_CHANNEL_OFF_SENTENCE_TEST_ID)
          .textContent,
      ).toBe(DE[definition.offSentence]);
    },
  );

  test("the checklist step for someone who may not turn it on, and its label, read German", () => {
    render(
      withGerman(
        <SetupChecklistTile
          step={channelStep(
            SetupStepStatus.Blocked,
            ChannelStepCopy.whoCanTurnOnDetail,
            ChannelStepCopy.whoCanTurnOnAction,
          )}
        />,
      ),
    );

    expect(
      screen.getByTestId("setup-checklist-detail-channels-enabled")
        .textContent,
    ).toBe(DE[ChannelStepCopy.whoCanTurnOnDetail]);
    expect(screen.getByText(DE[BLOCKED_STEP_LABEL]!)).toBeInTheDocument();
    expect(
      screen.getByText(DE["At least one of your channels is usable here"]!),
    ).toBeInTheDocument();
  });

  test("the checklist step for someone who may turn it on, and its action, read German", () => {
    render(
      withGerman(
        <SetupChecklistTile
          step={channelStep(
            SetupStepStatus.Incomplete,
            ChannelStepCopy.canTurnOnDetail,
            ChannelStepCopy.canTurnOnAction,
          )}
        />,
      ),
    );

    expect(
      screen.getByTestId("setup-checklist-detail-channels-enabled")
        .textContent,
    ).toBe(DE[ChannelStepCopy.canTurnOnDetail]);
    expect(
      screen.getByTestId("setup-checklist-step-channels-enabled"),
    ).toHaveTextContent(`${DE[ChannelStepCopy.canTurnOnAction]} →`);
  });
});

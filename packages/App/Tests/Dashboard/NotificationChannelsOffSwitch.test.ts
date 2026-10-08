import Project from "Common/Models/DatabaseModels/Project";
import TableColumnType from "Common/Types/Database/TableColumnType";
import ProjectNotificationChannelsCopy, {
  CHANNEL_GATED_METHOD_LISTS,
  ChannelGatedMethodList,
  ChannelGatedMethodListDefinition,
  getChannelGatedMethodList,
  getProjectNotificationChannel,
  PROJECT_NOTIFICATION_CHANNEL_COLUMNS,
  PROJECT_NOTIFICATION_CHANNELS,
  ProjectNotificationChannel,
  ProjectNotificationChannelDefinition,
} from "../../FeatureSet/Dashboard/src/Components/NotificationMethods/ProjectNotificationChannelsCopy";
import Permission, {
  PermissionHelper,
  PermissionProps,
} from "Common/Types/Permission";
import {
  getProjectNotificationChannelOffMessage,
  getWhoCanTurnOnSentence,
  INCOMING_CALL_NUMBER_SMS_OFF_MESSAGE,
  PROJECT_NOTIFICATION_CHANNEL_COLUMN_BY_CHANNEL,
  PROJECT_NOTIFICATION_CHANNEL_UPDATE_PERMISSIONS,
} from "Common/Utils/Project/NotificationChannels";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * A project's SMS, phone call, WhatsApp and Telegram channels start off, and
 * the server refuses a method on a channel that is off. So:
 *
 *   - every list of a person's methods on one of those channels (and of their
 *     incoming call numbers, verified by SMS) offers Add only while the
 *     channel is on, and carries the channel's switch - or, for someone who
 *     may not change it, one sentence - at its top while it is off;
 *   - the four switches live in one place, the Notification Channels card on
 *     Project Settings -> Notification Settings, where each saves the moment
 *     it is flipped. No Edit button and no two-step dialog;
 *   - the admin's "Add a notification method" form offers only the channels
 *     that are on;
 *   - wherever a channel is off, the reader who may not turn it on is told
 *     exactly who can - a project owner, a Billing Admin or someone with
 *     Manage Billing, the columns' own update permissions - and never "a
 *     project admin", who may not.
 *
 * This reads the sources so a list written later, or a second home for a
 * switch, cannot quietly bring the refusal back. The behaviour is tested in
 * Common/Tests/App/Dashboard (ProjectNotificationChannels,
 * NotificationChannelOffSwitchLists, AdminUserNotificationMethodsPage).
 */

const DASHBOARD_SRC: string = path.join(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Dashboard",
  "src",
);

const EE_DASHBOARD_SRC: string = path.join(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "ee",
  "Dashboard",
);

const LOCALES_DIR: string = path.join(DASHBOARD_SRC, "Locales");

const DOCS_CONTENT: string = path.join(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Docs",
  "Content",
);

const OTHER_LOCALES: Array<string> = [
  "de",
  "fr",
  "es",
  "it",
  "pt",
  "nl",
  "da",
  "no",
  "sv",
  "ru",
  "ja",
  "ko",
  "zh-CN",
  "zh-TW",
  "hi",
  "fa",
];

// Without its comments, collapsed to one line.
function readSource(file: string): string {
  return fs
    .readFileSync(file, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1")
    .replace(/\s+/g, " ");
}

const SOURCE_FILE: RegExp = /\.tsx?$/;

function listSources(directory: string): Array<string> {
  if (!fs.existsSync(directory)) {
    return [];
  }

  const found: Array<string> = [];

  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const full: string = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      if (
        entry.name === "node_modules" ||
        entry.name === "Locales" ||
        entry.name === "build" ||
        entry.name === "dist"
      ) {
        continue;
      }

      found.push(...listSources(full));
      continue;
    }

    if (SOURCE_FILE.test(entry.name)) {
      found.push(full);
    }
  }

  return found;
}

function relative(file: string): string {
  return path.relative(DASHBOARD_SRC, file).split(path.sep).join("/");
}

function readLocale(locale: string): Record<string, unknown> {
  return JSON.parse(
    fs.readFileSync(path.join(LOCALES_DIR, `${locale}.json`), "utf8"),
  ) as Record<string, unknown>;
}

const NOTIFICATION_METHODS_DIR: string = path.join(
  DASHBOARD_SRC,
  "Components",
  "NotificationMethods",
);

/*
 * The models of a person's methods that need a project channel, and the
 * list each one is drawn by.
 */
const GATED_MODELS: Record<string, ChannelGatedMethodList> = {
  UserSMS: ChannelGatedMethodList.SMS,
  UserCall: ChannelGatedMethodList.Call,
  UserWhatsApp: ChannelGatedMethodList.WhatsApp,
  UserTelegram: ChannelGatedMethodList.Telegram,
  UserIncomingCallNumber: ChannelGatedMethodList.IncomingCallNumber,
};

const CHANNEL_ENUM_MEMBERS: Record<ProjectNotificationChannel, string> = {
  [ProjectNotificationChannel.SMS]: "SMS",
  [ProjectNotificationChannel.Call]: "Call",
  [ProjectNotificationChannel.WhatsApp]: "WhatsApp",
  [ProjectNotificationChannel.Telegram]: "Telegram",
};

const MODEL_TABLE_OVER: RegExp =
  /modelType=\{(UserSMS|UserCall|UserWhatsApp|UserTelegram|UserIncomingCallNumber)\}/g;

const COLUMN_PATTERN: RegExp =
  /\benable(Sms|Call|WhatsApp|Telegram)Notifications\b/g;

describe("the four channels", () => {
  test("each is a boolean Project column that starts off, switched by exactly one definition", () => {
    const project: Project = new Project();

    expect([...PROJECT_NOTIFICATION_CHANNEL_COLUMNS]).toEqual([
      "enableSmsNotifications",
      "enableCallNotifications",
      "enableWhatsAppNotifications",
      "enableTelegramNotifications",
    ]);

    for (const column of PROJECT_NOTIFICATION_CHANNEL_COLUMNS) {
      const metadata: ReturnType<Project["getTableColumnMetadata"]> =
        project.getTableColumnMetadata(column);

      expect([column, metadata?.type, metadata?.defaultValue]).toEqual([
        column,
        TableColumnType.Boolean,
        false,
      ]);
    }

    expect(
      PROJECT_NOTIFICATION_CHANNELS.map(
        (definition: ProjectNotificationChannelDefinition) => {
          return definition.channel;
        },
      ),
    ).toEqual(Object.values(ProjectNotificationChannel));
  });

  test("the server's wording and the dashboard name the same column for each channel", () => {
    for (const definition of PROJECT_NOTIFICATION_CHANNELS) {
      expect([
        definition.channel,
        PROJECT_NOTIFICATION_CHANNEL_COLUMN_BY_CHANNEL[definition.channel],
      ]).toEqual([definition.channel, definition.column]);
    }
  });

  test("every gated list is defined once, on a channel that exists", () => {
    expect(
      CHANNEL_GATED_METHOD_LISTS.map(
        (definition: ChannelGatedMethodListDefinition) => {
          return definition.list;
        },
      ).sort(),
    ).toEqual(Object.values(ChannelGatedMethodList).sort());

    for (const definition of CHANNEL_GATED_METHOD_LISTS) {
      expect(getProjectNotificationChannel(definition.channel).channel).toBe(
        definition.channel,
      );
    }

    // Incoming call numbers are verified by SMS.
    expect(
      getChannelGatedMethodList(ChannelGatedMethodList.IncomingCallNumber)
        .channel,
    ).toBe(ProjectNotificationChannel.SMS);
  });

  test("off means: say so, and who can turn it on; on means: everyone can add one", () => {
    for (const definition of CHANNEL_GATED_METHOD_LISTS) {
      expect(definition.switchOffDescription).toMatch(
        /^Off for this project: /,
      );
      expect(definition.switchOnDescription).toMatch(/^On for this project: /);
      expect(definition.offSentence).toContain(
        "A project owner, a Billing Admin or someone with Manage Billing can turn",
      );
      expect(definition.offSentence).toContain(
        "in Project Settings → Notification Settings.",
      );
      expect(definition.offSentence).toContain("off in this project");
      expect(definition.offSentence.toLowerCase()).not.toContain(
        "project admin",
      );
      // The empty list's heading while off does not ask for one.
      expect(definition.noItemsWhileOff).not.toContain("add");
    }
  });

  test("the people the copy names are the people the columns' update permissions let in", () => {
    const project: Project = new Project();
    const titles: Array<string> = [];

    for (const column of PROJECT_NOTIFICATION_CHANNEL_COLUMNS) {
      const update: Array<Permission> =
        project.getColumnAccessControlFor(column)?.update || [];

      expect([column, [...update].sort()]).toEqual([
        column,
        [...PROJECT_NOTIFICATION_CHANNEL_UPDATE_PERMISSIONS].sort(),
      ]);
    }

    for (const permission of PROJECT_NOTIFICATION_CHANNEL_UPDATE_PERMISSIONS) {
      titles.push(
        PermissionHelper.getAllPermissionProps().find(
          (props: PermissionProps): boolean => {
            return props.permission === permission;
          },
        )?.title || "",
      );
    }

    // "a project owner, a Billing Admin or someone with Manage Billing"
    expect(titles).toEqual([
      "Project Owner",
      "Billing Admin",
      "Manage Billing",
    ]);

    for (const sentence of [
      getWhoCanTurnOnSentence("it"),
      getWhoCanTurnOnSentence("them"),
      ProjectNotificationChannelsCopy.whoCanChange,
      ...CHANNEL_GATED_METHOD_LISTS.map(
        (definition: ChannelGatedMethodListDefinition): string => {
          return definition.offSentence;
        },
      ),
    ]) {
      expect(sentence).toContain("project owner");
      expect(sentence).toContain("a Billing Admin");
      expect(sentence).toContain("Manage Billing");
      expect(sentence.toLowerCase()).not.toContain("project admin");
    }
  });

  test("the dashboard and the server say who can in the same words", () => {
    // The dashboard writes "→" where the server writes ">".
    const asDashboard: (text: string) => string = (text: string): string => {
      return text.replace(/ > /g, " → ");
    };

    const lists: Array<[ChannelGatedMethodList, string]> = [
      [
        ChannelGatedMethodList.SMS,
        getProjectNotificationChannelOffMessage(ProjectNotificationChannel.SMS),
      ],
      [
        ChannelGatedMethodList.Call,
        getProjectNotificationChannelOffMessage(
          ProjectNotificationChannel.Call,
        ),
      ],
      [
        ChannelGatedMethodList.WhatsApp,
        getProjectNotificationChannelOffMessage(
          ProjectNotificationChannel.WhatsApp,
        ),
      ],
      [
        ChannelGatedMethodList.Telegram,
        getProjectNotificationChannelOffMessage(
          ProjectNotificationChannel.Telegram,
        ),
      ],
      [
        ChannelGatedMethodList.IncomingCallNumber,
        INCOMING_CALL_NUMBER_SMS_OFF_MESSAGE,
      ],
    ];

    for (const [list, serverMessage] of lists) {
      expect([list, getChannelGatedMethodList(list).offSentence]).toEqual([
        list,
        asDashboard(serverMessage),
      ]);
    }
  });
});

describe("no list of a person's methods offers Add while its channel is off", () => {
  const files: Array<string> = [
    ...listSources(DASHBOARD_SRC),
    ...listSources(EE_DASHBOARD_SRC),
  ];

  const tables: Array<[string, string, ChannelGatedMethodList]> = [];

  for (const file of files) {
    const source: string = readSource(file);

    for (const match of source.matchAll(MODEL_TABLE_OVER)) {
      tables.push([relative(file), match[1]!, GATED_MODELS[match[1]!]!]);
    }
  }

  test("the five lists are the only tables over these models", () => {
    expect(
      tables
        .map(([file, model]: [string, string, ChannelGatedMethodList]) => {
          return `${file} ${model}`;
        })
        .sort(),
    ).toEqual(
      [
        "Components/NotificationMethods/Call.tsx UserCall",
        "Components/NotificationMethods/IncomingCallNumber.tsx UserIncomingCallNumber",
        "Components/NotificationMethods/SMS.tsx UserSMS",
        "Components/NotificationMethods/Telegram.tsx UserTelegram",
        "Components/NotificationMethods/WhatsApp.tsx UserWhatsApp",
      ].sort(),
    );
  });

  test.each(tables)(
    "%s (%s) offers Add only while its channel is on, and draws its panel",
    (file: string, _model: string, list: ChannelGatedMethodList) => {
      const source: string = readSource(path.join(DASHBOARD_SRC, file));
      const channel: ProjectNotificationChannel =
        getChannelGatedMethodList(list).channel;

      expect(source).toContain(
        `useProjectChannelState( ProjectNotificationChannel.${CHANNEL_ENUM_MEMBERS[channel]}, )`,
      );
      expect(source).toContain("isCreateable={isAddingOffered(channelState)}");
      expect(source).not.toContain("isCreateable={true}");
      expect(source).toContain(
        `<NotificationChannelOffPanel list={ChannelGatedMethodList.${list}} state={channelState} />`,
      );
      // The empty list does not ask for one while it cannot be added.
      expect(source).toMatch(
        /noItemsMessage=\{ isChannelOff \? getChannelGatedMethodList\(/,
      );
    },
  );

  /*
   * A new code is offered in the verify dialog, which asks the server
   * whether one can be sent (the verification-status route's
   * cannotSendReason - channel off, balance too low, no Twilio account) and
   * offers it only then. The lists no longer offer a code of their own: a
   * separate Resend Code row action was where people could not tell
   * whether Verify sent a code or Resend had to come first.
   */
  test.each(
    CHANNEL_GATED_METHOD_LISTS.filter(
      (definition: ChannelGatedMethodListDefinition): boolean => {
        return getProjectNotificationChannel(definition.channel)
          .isCodeResendRefusedWhileOff;
      },
    ).map((definition: ChannelGatedMethodListDefinition) => {
      return [definition.list];
    }),
  )(
    "%s does not offer a new code while the server would refuse to send it",
    (list: ChannelGatedMethodList) => {
      const file: string =
        list === ChannelGatedMethodList.IncomingCallNumber
          ? "IncomingCallNumber.tsx"
          : `${list}.tsx`;

      const source: string = readSource(
        path.join(NOTIFICATION_METHODS_DIR, file),
      );

      // Verifying, and sending a new code, are the dialog's.
      expect(source).toContain("<VerificationCodeModal");
      expect(source).not.toContain('title: "Resend Code"');
      expect(source).not.toContain("/resend-verification-code");

      // And the dialog offers a code only when the server says one can go.
      const dialog: string = readSource(
        path.join(NOTIFICATION_METHODS_DIR, "VerificationCodeModal.tsx"),
      );

      expect(dialog).toContain(
        "const canSendCode: boolean = !cannotSendReason &&",
      );
    },
  );
});

describe("one place for each switch", () => {
  test("no Dashboard file names a channel column but the channels' definition", () => {
    const found: Array<string> = [];

    for (const file of [
      ...listSources(DASHBOARD_SRC),
      ...listSources(EE_DASHBOARD_SRC),
    ]) {
      if (readSource(file).match(COLUMN_PATTERN)) {
        found.push(relative(file));
      }
    }

    expect(found).toEqual([
      "Components/NotificationMethods/ProjectNotificationChannelsCopy.ts",
    ]);
  });

  test("Notification Settings draws the Notification Channels card, with no Edit dialog for the switches", () => {
    const source: string = readSource(
      path.join(DASHBOARD_SRC, "Pages", "Settings", "NotificationSettings.tsx"),
    );

    expect(source).toContain("<ProjectNotificationChannelsCard />");
    expect(source).not.toContain('name="Enable Notifications"');
    expect(source).not.toContain("Edit Notification Settings");
    expect(source).not.toContain("calls-and-sms");
    expect(source).not.toContain("messaging-apps");
  });

  test("the card's rows are switches that save in place, for the current project", () => {
    const source: string = readSource(
      path.join(
        NOTIFICATION_METHODS_DIR,
        "ProjectNotificationChannelsCard.tsx",
      ),
    );

    expect(source).toContain("<ModelSwitchRow<Project>");
    expect(source).toContain("PROJECT_NOTIFICATION_CHANNELS.map(");
    expect(source).not.toContain("CardModelDetail");
    expect(source).not.toContain("formFields");
  });

  test("the setup checklist reads the switches through the shared definition", () => {
    const source: string = readSource(
      path.join(
        DASHBOARD_SRC,
        "Components",
        "UserSettings",
        "SetupChecklist",
        "useSetupChecklist.ts",
      ),
    );

    expect(source).toContain("...getProjectNotificationChannelsSelect()");
    expect(source).toContain("readEnabledProjectChannels(");
    expect(source).toContain("getDisabledProjectChannels(enabled)");
  });
});

describe("nothing tells a reader to ask a project admin, or to turn a channel on themselves", () => {
  /*
   * Only a project owner, a Billing Admin or someone with Manage Billing
   * may switch SMS, calls, WhatsApp or Telegram on. Sources are read without
   * their comments, which may still quote what the copy used to say.
   */
  const REPO_PACKAGES: string = path.join(__dirname, "..", "..", "..");

  const SCANNED: Array<string> = [
    DASHBOARD_SRC,
    EE_DASHBOARD_SRC,
    path.join(REPO_PACKAGES, "Common", "Server"),
    path.join(REPO_PACKAGES, "App", "FeatureSet", "Notification"),
    path.join(REPO_PACKAGES, "..", "ee", "Server"),
  ];

  const FORBIDDEN: Array<[string, RegExp]> = [
    [
      "asks for a project admin to turn a channel on",
      /ask a project admin to enable (it|them|this channel)\b/i,
    ],
    ["says a step needs a project admin", /needs? a project admin/i],
    ["labels a step 'Needs an admin'", /Needs an admin/],
    [
      "tells the reader to enable a channel in Project Settings",
      /Please enable (them|SMS|Call|call|WhatsApp|Telegram)[^"`]*Project Settings/,
    ],
    [
      "tells the reader to turn channels on in Notification Settings",
      /\bTurn (it|them) on in Project Settings > Notification Settings/,
    ],
  ];

  test.each(FORBIDDEN)("no source %s", (_what: string, pattern: RegExp) => {
    const found: Array<string> = [];

    for (const directory of SCANNED) {
      for (const file of listSources(directory)) {
        if (pattern.test(readSource(file))) {
          found.push(path.relative(REPO_PACKAGES, file));
        }
      }
    }

    expect(found).toEqual([]);
  });
});

describe("the admin's Add form offers only the channels that are on", () => {
  const source: string = readSource(
    path.join(
      DASHBOARD_SRC,
      "Pages",
      "Users",
      "View",
      "OnCall",
      "NotificationMethods.tsx",
    ),
  );

  test("its dropdown is built from the project's channels, never the full list", () => {
    expect(source).toContain(
      "dropdownOptions: getOfferedAddableChannelOptions(projectChannels)",
    );
    expect(source).not.toContain("dropdownOptions: ADDABLE_CHANNELS");
  });

  test("every channel it may add but email has its project switch", () => {
    expect(source).toContain(
      "[AdminAddableChannel.Email]: null, [AdminAddableChannel.SMS]: ProjectNotificationChannel.SMS, [AdminAddableChannel.Call]: ProjectNotificationChannel.Call, [AdminAddableChannel.WhatsApp]: ProjectNotificationChannel.WhatsApp,",
    );
  });
});

describe("translations", () => {
  // Channel names may read the same in a language; the sentences may not.
  const names: Array<string> = [
    ...PROJECT_NOTIFICATION_CHANNELS.map(
      (definition: ProjectNotificationChannelDefinition) => {
        return definition.title;
      },
    ),
  ];

  const sentences: Array<string> = [
    ProjectNotificationChannelsCopy.cardTitle,
    ProjectNotificationChannelsCopy.cardDescription,
    "Phone Calls",
    ...PROJECT_NOTIFICATION_CHANNELS.flatMap(
      (definition: ProjectNotificationChannelDefinition) => {
        return [definition.description, definition.balanceNote];
      },
    ),
    ...CHANNEL_GATED_METHOD_LISTS.flatMap(
      (definition: ChannelGatedMethodListDefinition) => {
        return [
          definition.switchOffDescription,
          definition.switchOnDescription,
          definition.offSentence,
          definition.noItemsWhileOff,
        ];
      },
    ),
    ProjectNotificationChannelsCopy.whoCanChange,
    ProjectNotificationChannelsCopy.settingsLinkText,
    "Channels that are off in this project are not offered. A project owner, a Billing Admin or someone with Manage Billing can turn them on in Project Settings → Notification Settings.",
    "Channels that are off in this project are not offered. Turn them on in {{settingsLink}}.",
    "You can add an email address, phone number or WhatsApp number for {{name}}, and remove any method they no longer use. Identifiers are always shown masked.",
    "You can add an email address or phone number for {{name}}, and remove any method they no longer use. Identifiers are always shown masked.",
    "You can add an email address or WhatsApp number for {{name}}, and remove any method they no longer use. Identifiers are always shown masked.",
    "You can add an email address for {{name}}, and remove any method they no longer use. Identifiers are always shown masked.",
  ];

  test("en.json maps every string to itself", () => {
    const english: Record<string, unknown> = readLocale("en");

    for (const text of [...names, ...sentences]) {
      expect([text, english[text]]).toEqual([text, text]);
    }
  });

  test.each(OTHER_LOCALES)(
    "%s has every name, and its own words for every sentence",
    (locale: string) => {
      const translations: Record<string, unknown> = readLocale(locale);

      for (const text of names) {
        expect([text, typeof translations[text]]).toEqual([text, "string"]);
      }

      for (const text of sentences) {
        expect([text, typeof translations[text]]).toEqual([text, "string"]);
        expect([text, translations[text]]).not.toEqual([text, text]);
      }
    },
  );
});

describe("the docs", () => {
  test("say which switch an SMS subscription needs, by its new name, in every language", () => {
    for (const locale of ["en", ...OTHER_LOCALES]) {
      const page: string = fs.readFileSync(
        path.join(DOCS_CONTENT, locale, "status-pages", "subscribers.md"),
        "utf8",
      );

      const smsLine: string =
        page.split("\n").find((line: string): boolean => {
          return line.includes("`enableSmsSubscribers`");
        }) || "";

      const cardTitle: unknown =
        locale === "en"
          ? ProjectNotificationChannelsCopy.cardTitle
          : readLocale(locale)[ProjectNotificationChannelsCopy.cardTitle];

      expect([locale, smsLine.includes(`**${String(cardTitle)}**`)]).toEqual([
        locale,
        true,
      ]);
      expect([locale, smsLine.includes("**SMS**")]).toEqual([locale, true]);
      expect([locale, smsLine.includes("Enable SMS Notifications")]).toEqual([
        locale,
        false,
      ]);
    }
  });
});

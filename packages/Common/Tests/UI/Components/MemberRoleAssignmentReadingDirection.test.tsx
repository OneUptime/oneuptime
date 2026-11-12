import "@testing-library/jest-dom";
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, test } from "@jest/globals";
import { createInstance, i18n } from "i18next";
import React from "react";
import { I18nextProvider } from "react-i18next";
import MemberRoleAssignment, {
  AssignedMember,
  ComponentProps,
  MemberRole,
} from "../../../UI/Components/MemberRoleAssignment/MemberRoleAssignment";
import Color from "../../../Types/Color";
import ObjectID from "../../../Types/ObjectID";
import {
  CLAMPED_LINES_ALIGNED_AS_THE_PAGE_CLASS_NAME,
  LINE_ALIGNED_AS_THE_PAGE_CLASS_NAME,
} from "../../../UI/Utils/LineDirection";

/*
 * THE ROLE CARDS' PEOPLE ON AN ARABIC OR PERSIAN PAGE (#6471).
 *
 * An incident's and an episode's roles card (MemberRoleAssignment) names
 * who holds each role on two lines cut short with "...": their name and
 * their email. Cut where the page's lines end, an English email on an
 * Arabic page lost its start: maya.chen@acme-commerce.example read
 * "...e-commerce.example". Each is a line that reads the way it is written
 * now (IsolatedLine): its "..." at its own end, and a short one still
 * starting beside the avatar, where the page's lines start. A role's name -
 * the project's own - wraps from its own start.
 */

const ENGLISH_NAME: string = "Maya Chen-Rodriguez (Platform SRE, EU West)";
const ENGLISH_EMAIL: string = "maya.chen@acme-commerce.example";
const ARABIC_NAME: string = "مايا تشين رودريغيز";
const ARABIC_ROLE: string = "قائد الحادث";

const NAME_CLASS_NAME: string = "text-sm font-medium text-gray-900 truncate";
const EMAIL_CLASS_NAME: string = "text-xs text-gray-500 truncate";
const ROLE_CLASS_NAME: string =
  "min-w-0 break-words text-sm font-semibold text-gray-900";

const instances: Record<string, i18n> = {};

beforeAll(async () => {
  for (const language of ["en", "ar", "fa"]) {
    const instance: i18n = createInstance();

    await instance.init({
      lng: language,
      fallbackLng: "en",
      resources: {
        en: { translation: {} },
        ar: { translation: {} },
        fa: { translation: {} },
      },
      interpolation: { escapeValue: false },
    });

    instances[language] = instance;
  }
});

afterEach(() => {
  cleanup();
});

const COMMANDER: MemberRole = {
  id: new ObjectID("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1"),
  name: "Incident Commander",
  color: new Color("#6366f1"),
  isPrimaryRole: true,
};

const ARABIC_COMMANDER: MemberRole = {
  id: new ObjectID("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2"),
  name: ARABIC_ROLE,
  color: new Color("#0891b2"),
};

const memberOf: (data: {
  index: number;
  role: MemberRole;
  userName: string;
  userEmail: string;
}) => AssignedMember = (data: {
  index: number;
  role: MemberRole;
  userName: string;
  userEmail: string;
}): AssignedMember => {
  const suffix: string = String(data.index).padStart(12, "0");

  return {
    id: new ObjectID(`bbbbbbbb-bbbb-4bbb-8bbb-${suffix}`),
    memberId: new ObjectID(`bbbbbbbb-bbbb-4bbb-8bbb-${suffix}`),
    userId: new ObjectID(`cccccccc-cccc-4ccc-8ccc-${suffix}`),
    userName: data.userName,
    userEmail: data.userEmail,
    roleId: data.role.id,
    roleName: data.role.name,
    roleColor: data.role.color,
  };
};

const drawCard: (data: {
  language: string;
  members: Array<AssignedMember>;
  roles?: Array<MemberRole> | undefined;
}) => void = (data: {
  language: string;
  members: Array<AssignedMember>;
  roles?: Array<MemberRole> | undefined;
}): void => {
  const props: ComponentProps = {
    title: "Incident Roles",
    description: "Assign one team member per role.",
    roles: data.roles || [COMMANDER, ARABIC_COMMANDER],
    assignedMembers: data.members,
    availableUsers: [],
    onAssignMember: async (): Promise<void> => {},
    onUnassignMember: async (): Promise<void> => {},
    onRefresh: async (): Promise<void> => {},
  };

  render(
    <I18nextProvider i18n={instances[data.language]!}>
      <MemberRoleAssignment {...props} />
    </I18nextProvider>,
  );
};

// The line with this test id that reads `text`.
const lineReading: (testId: string, text: string) => HTMLElement = (
  testId: string,
  text: string,
): HTMLElement => {
  const line: HTMLElement | undefined = screen
    .getAllByTestId(testId)
    .find((each: HTMLElement): boolean => {
      return each.textContent === text;
    });

  if (!line) {
    throw new Error(`No ${testId} reads "${text}"`);
  }

  return line;
};

describe("on an Arabic or Persian page", () => {
  test.each(["ar", "fa"])(
    "%s: an English name and email read left to right, cut short at their own end",
    (language: string) => {
      drawCard({
        language: language,
        members: [
          memberOf({
            index: 1,
            role: COMMANDER,
            userName: ENGLISH_NAME,
            userEmail: ENGLISH_EMAIL,
          }),
        ],
      });

      const name: HTMLElement = lineReading(
        "member-role-member-name",
        ENGLISH_NAME,
      );
      const email: HTMLElement = lineReading(
        "member-role-member-email",
        ENGLISH_EMAIL,
      );

      expect(name.tagName).toBe("P");
      expect(name).toHaveAttribute("dir", "ltr");
      expect(name.getAttribute("class")).toBe(
        `${NAME_CLASS_NAME} ${LINE_ALIGNED_AS_THE_PAGE_CLASS_NAME}`,
      );
      expect(name).toHaveAttribute("title", ENGLISH_NAME);

      expect(email.tagName).toBe("P");
      expect(email).toHaveAttribute("dir", "ltr");
      expect(email.getAttribute("class")).toBe(
        `${EMAIL_CLASS_NAME} ${LINE_ALIGNED_AS_THE_PAGE_CLASS_NAME}`,
      );
      expect(email).toHaveAttribute("title", ENGLISH_EMAIL);

      // The block they share beside the avatar keeps the page's way.
      expect(name.parentElement).not.toHaveAttribute("dir");
      expect(name.parentElement).toHaveClass("min-w-0", "flex-1");
      expect(name.parentElement).toBe(email.parentElement);
    },
  );

  test.each(["ar", "fa"])(
    "%s: someone with no name is named by their email, read left to right",
    (language: string) => {
      drawCard({
        language: language,
        members: [
          memberOf({
            index: 2,
            role: COMMANDER,
            userName: "",
            userEmail: ENGLISH_EMAIL,
          }),
        ],
      });

      const name: HTMLElement = lineReading(
        "member-role-member-name",
        ENGLISH_EMAIL,
      );

      expect(name).toHaveAttribute("dir", "ltr");
      expect(name).toHaveClass(LINE_ALIGNED_AS_THE_PAGE_CLASS_NAME);
      // No second line repeating it.
      expect(screen.queryByTestId("member-role-member-email")).toBeNull();
    },
  );

  test.each(["ar", "fa"])(
    "%s: an Arabic name is drawn as it was, and the Latin email beside it still reads its own way",
    (language: string) => {
      drawCard({
        language: language,
        members: [
          memberOf({
            index: 3,
            role: COMMANDER,
            userName: ARABIC_NAME,
            userEmail: ENGLISH_EMAIL,
          }),
        ],
      });

      const name: HTMLElement = lineReading(
        "member-role-member-name",
        ARABIC_NAME,
      );

      expect(name).not.toHaveAttribute("dir");
      expect(name.getAttribute("class")).toBe(NAME_CLASS_NAME);
      expect(
        lineReading("member-role-member-email", ENGLISH_EMAIL),
      ).toHaveAttribute("dir", "ltr");
    },
  );

  test.each(["ar", "fa"])(
    "%s: a role's English name wraps from its own start, as wide as its words; an Arabic one is drawn as it was",
    (language: string) => {
      drawCard({ language: language, members: [] });

      const english: HTMLElement = lineReading(
        "member-role-name",
        "Incident Commander",
      );
      const arabic: HTMLElement = lineReading("member-role-name", ARABIC_ROLE);

      expect(english.tagName).toBe("SPAN");
      expect(english).toHaveAttribute("dir", "ltr");
      expect(english.getAttribute("class")).toBe(
        `${ROLE_CLASS_NAME} ${CLAMPED_LINES_ALIGNED_AS_THE_PAGE_CLASS_NAME}`,
      );
      // Never lined up by its end: its wrapped lines would hug the right.
      expect(english).not.toHaveClass(LINE_ALIGNED_AS_THE_PAGE_CLASS_NAME);

      expect(arabic).not.toHaveAttribute("dir");
      expect(arabic.getAttribute("class")).toBe(ROLE_CLASS_NAME);

      // The row with its Primary tag keeps the page's way.
      expect(english.parentElement).not.toHaveAttribute("dir");
      expect(
        within(english.parentElement as HTMLElement).getByText("Primary"),
      ).toBeInTheDocument();
    },
  );
});

describe("on an English page", () => {
  test("an English name, email and role are drawn as they were: no dir, their own classes", () => {
    drawCard({
      language: "en",
      members: [
        memberOf({
          index: 4,
          role: COMMANDER,
          userName: ENGLISH_NAME,
          userEmail: ENGLISH_EMAIL,
        }),
      ],
    });

    const name: HTMLElement = lineReading(
      "member-role-member-name",
      ENGLISH_NAME,
    );
    const email: HTMLElement = lineReading(
      "member-role-member-email",
      ENGLISH_EMAIL,
    );
    const role: HTMLElement = lineReading(
      "member-role-name",
      "Incident Commander",
    );

    expect(name).not.toHaveAttribute("dir");
    expect(name.getAttribute("class")).toBe(NAME_CLASS_NAME);
    expect(email).not.toHaveAttribute("dir");
    expect(email.getAttribute("class")).toBe(EMAIL_CLASS_NAME);
    expect(role).not.toHaveAttribute("dir");
    expect(role.getAttribute("class")).toBe(ROLE_CLASS_NAME);
  });

  test("an Arabic name reads right to left, lined up as the page's lines", () => {
    drawCard({
      language: "en",
      members: [
        memberOf({
          index: 5,
          role: ARABIC_COMMANDER,
          userName: ARABIC_NAME,
          userEmail: ENGLISH_EMAIL,
        }),
      ],
    });

    const name: HTMLElement = lineReading(
      "member-role-member-name",
      ARABIC_NAME,
    );

    expect(name).toHaveAttribute("dir", "rtl");
    expect(name.getAttribute("class")).toBe(
      `${NAME_CLASS_NAME} ${LINE_ALIGNED_AS_THE_PAGE_CLASS_NAME}`,
    );
    expect(
      lineReading("member-role-member-email", ENGLISH_EMAIL),
    ).not.toHaveAttribute("dir");
    expect(lineReading("member-role-name", ARABIC_ROLE)).toHaveAttribute(
      "dir",
      "rtl",
    );
  });
});

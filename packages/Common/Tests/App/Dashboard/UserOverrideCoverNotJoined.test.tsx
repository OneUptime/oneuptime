import "@testing-library/jest-dom";
import { render, screen, waitFor } from "@testing-library/react";
import React, { ReactElement } from "react";
import fs from "fs";
import path from "path";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { SpyInstance } from "jest-mock";
import UserOverrideCoverNotJoinedNotice, {
  USER_OVERRIDE_COVER_NOT_JOINED_TEXT,
} from "../../../../App/FeatureSet/Dashboard/src/Components/OnCallPolicy/UserOverrides/UserOverrideCoverNotJoinedNotice";
import {
  USER_OVERRIDE_COVER_KEY,
  getUserOverrideFormFields,
} from "../../../../App/FeatureSet/Dashboard/src/Components/OnCallPolicy/UserOverrides/UserOverrideForm";
import ProjectMembershipLoaderInstance, {
  ProjectMembershipStatus,
} from "../../../../App/FeatureSet/Dashboard/src/Utils/ProjectMembershipLoader";
import OnCallDutyPolicyUserOverride from "../../../Models/DatabaseModels/OnCallDutyPolicyUserOverride";
import Field from "../../../UI/Components/Forms/Types/Field";
import FormValues from "../../../UI/Components/Forms/Types/FormValues";
import ProjectUtil from "../../../UI/Utils/Project";
import ObjectID from "../../../Types/ObjectID";

/*
 * UNDER "WHO COVERS?": THE PERSON PICKED HAS NOT JOINED THE PROJECT YET
 * (#10670).
 *
 * The people picker offers someone invited who has not accepted, and the
 * server takes them as the cover, as it does on an escalation rule or in a
 * rotation. Nothing pages them until they join, so until then nobody is
 * paged in place of the person away: the form says so the moment they are
 * picked, before anything is saved, in both dialogs the form is drawn in
 * (Add and Edit User Override, Skip until...). It says nothing of a member,
 * of nobody picked, or while membership is not known.
 */

const PROJECT: string = "10670000-0000-4000-8000-000000000001";
const IVY: string = "10670000-0000-4000-8000-0000000000a1";
const ANA: string = "10670000-0000-4000-8000-0000000000a2";

const REPOSITORY_ROOT: string = path.resolve(__dirname, "../../../../..");

const LOCALES: string = path.join(
  REPOSITORY_ROOT,
  "packages/App/FeatureSet/Dashboard/src/Locales",
);

describe("the notice under Who covers?", () => {
  let getMembership: SpyInstance<
    typeof ProjectMembershipLoaderInstance.getMembership
  >;

  beforeEach(() => {
    jest.spyOn(ProjectUtil, "getCurrentProjectId").mockImplementation(() => {
      return new ObjectID(PROJECT);
    });
    getMembership = jest.spyOn(
      ProjectMembershipLoaderInstance,
      "getMembership",
    );
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("someone invited who has not accepted: nobody is paged in place of the person away until they do", async () => {
    getMembership.mockResolvedValue(ProjectMembershipStatus.Invited);

    render(<UserOverrideCoverNotJoinedNotice coverUserId={IVY} />);

    await waitFor(() => {
      expect(
        screen.getByTestId("user-override-cover-not-joined"),
      ).toBeInTheDocument();
    });

    expect(
      screen.getByTestId("user-override-cover-not-joined"),
    ).toHaveTextContent(USER_OVERRIDE_COVER_NOT_JOINED_TEXT);
    expect(getMembership).toHaveBeenCalledWith({
      projectId: PROJECT,
      userId: IVY,
    });
  });

  test.each([
    ["a member", ProjectMembershipStatus.Member],
    ["somebody who left the project", ProjectMembershipStatus.NotMember],
    ["somebody whose membership is not known", null],
  ])(
    "%s: nothing",
    async (_label: string, answer: ProjectMembershipStatus | null) => {
      getMembership.mockResolvedValue(answer);

      render(<UserOverrideCoverNotJoinedNotice coverUserId={ANA} />);

      await waitFor(() => {
        expect(getMembership).toHaveBeenCalled();
      });

      expect(
        screen.queryByTestId("user-override-cover-not-joined"),
      ).not.toBeInTheDocument();
    },
  );

  test("nobody picked - the rotation covers: nothing, and nobody is asked about", async () => {
    getMembership.mockResolvedValue(ProjectMembershipStatus.Invited);

    render(<UserOverrideCoverNotJoinedNotice coverUserId={null} />);

    expect(
      screen.queryByTestId("user-override-cover-not-joined"),
    ).not.toBeInTheDocument();
  });
});

describe("the override form draws it under Who covers?, from the person picked", () => {
  const coverField: () => Field<OnCallDutyPolicyUserOverride> =
    (): Field<OnCallDutyPolicyUserOverride> => {
      const field: Field<OnCallDutyPolicyUserOverride> | undefined =
        getUserOverrideFormFields<OnCallDutyPolicyUserOverride>({
          currentUserId: ANA,
        }).find((candidate: Field<OnCallDutyPolicyUserOverride>): boolean => {
          return candidate.title === "Who covers?";
        });

      expect(field).toBeDefined();
      return field!;
    };

  test("in the add form and the edit form alike", () => {
    const element: ReactElement | undefined = coverField().getFooterElement?.({
      [USER_OVERRIDE_COVER_KEY]: new ObjectID(IVY),
    } as unknown as FormValues<OnCallDutyPolicyUserOverride>);

    expect(element?.type).toBe(UserOverrideCoverNotJoinedNotice);
    expect(
      (element?.props as { coverUserId?: string | null }).coverUserId,
    ).toBe(IVY);

    const editing: Field<OnCallDutyPolicyUserOverride> | undefined =
      getUserOverrideFormFields<OnCallDutyPolicyUserOverride>({
        currentUserId: ANA,
        editing: {
          saved: {
            startsAt: new Date("2026-11-30T09:00:00.000Z"),
            endsAt: new Date("2026-11-30T17:00:00.000Z"),
          },
          now: new Date("2026-11-22T09:00:00.000Z"),
        },
      }).find((candidate: Field<OnCallDutyPolicyUserOverride>): boolean => {
        return candidate.title === "Who covers?";
      });

    expect(editing?.getFooterElement).toBeDefined();
  });

  test("with nobody picked, the notice is handed nobody", () => {
    const element: ReactElement | undefined = coverField().getFooterElement?.(
      {} as FormValues<OnCallDutyPolicyUserOverride>,
    );

    expect(
      (element?.props as { coverUserId?: string | null }).coverUserId,
    ).toBeNull();
  });
});

describe("its words, in every Dashboard language", () => {
  const locales: Array<string> = fs
    .readdirSync(LOCALES)
    .filter((file: string): boolean => {
      return file.endsWith(".json");
    });

  test("there are the eighteen Dashboard languages", () => {
    expect(locales).toHaveLength(18);
  });

  test.each(
    fs.readdirSync(LOCALES).filter((file: string): boolean => {
      return file.endsWith(".json");
    }),
  )("%s words the sentence, without an address", (file: string) => {
    const words: Record<string, unknown> = JSON.parse(
      fs.readFileSync(path.join(LOCALES, file), "utf8"),
    );
    const sentence: unknown = words[USER_OVERRIDE_COVER_NOT_JOINED_TEXT];

    expect(typeof sentence).toBe("string");
    expect(String(sentence).trim().length).toBeGreaterThan(20);
    expect(String(sentence)).not.toContain("@");

    if (file === "en.json") {
      expect(sentence).toBe(USER_OVERRIDE_COVER_NOT_JOINED_TEXT);
    } else {
      // Worded in the language, not left in English.
      expect(sentence).not.toBe(USER_OVERRIDE_COVER_NOT_JOINED_TEXT);
    }
  });
});

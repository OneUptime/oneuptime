import { describe, expect, test } from "@jest/globals";
import Permission, {
  PermissionHelper,
  PermissionProps,
} from "../../Types/Permission";
import PermissionGate from "../../UI/Utils/PermissionGate";
import { createTranslator } from "../../UI/Utils/TranslateTemplate";

/*
 * THE PERMISSION THAT PAGES AN ON-CALL POLICY, BY WHAT IT ALLOWS.
 *
 * A locked Page now - on a page OneUptime AI holds, among the buttons that
 * page an on-call policy - ends, as every lock does since #5363, with what
 * would allow it: "You need this permission: Create On-Call Duty Policy
 * Execution Log." That was the permission's internal title, the row a run
 * writes (#5412's UI review). It is "Execute On-Call Policies" now: what
 * it allows, beside its siblings Create, Edit and Read On-Call Policy in the
 * custom role picker, as the docs name it - and never the words of a
 * record's Execute On-Call Policy button, which a translated page draws in
 * its own language. It was "Execute On-Call Duty Policy" until the product
 * was named On-Call (#6817).
 */

const ENGLISH: ReturnType<typeof createTranslator> = createTranslator(
  undefined,
  "en",
);

describe("the permission to page an on-call policy", () => {
  test("is titled by what it allows, and says what that is", () => {
    expect(
      PermissionHelper.getTitle(
        Permission.CreateProjectOnCallDutyPolicyExecutionLog,
      ),
    ).toBe("Execute On-Call Policies");
    expect(
      PermissionHelper.getDescription(
        Permission.CreateProjectOnCallDutyPolicyExecutionLog,
      ),
    ).toBe(
      "This permission can execute on-call policies: page their escalation rules about an incident, an alert or an episode.",
    );
  });

  test("no other permission has its title: a picker never offers two of it", () => {
    const titled: Array<PermissionProps> =
      PermissionHelper.getAllPermissionProps().filter(
        (props: PermissionProps): boolean => {
          return props.title === "Execute On-Call Policies";
        },
      );

    expect(
      titled.map((props: PermissionProps): Permission => {
        return props.permission;
      }),
    ).toEqual([Permission.CreateProjectOnCallDutyPolicyExecutionLog]);
  });

  test("a lock that needs it names it so", () => {
    expect(
      PermissionGate.getNeededPermissionsSentence(
        [
          Permission.ProjectOwner,
          Permission.ProjectAdmin,
          Permission.ProjectMember,
          Permission.OnCallAdmin,
          Permission.OnCallMember,
          Permission.CreateProjectOnCallDutyPolicyExecutionLog,
        ],
        ENGLISH,
      ),
    ).toBe("You need this permission: Execute On-Call Policies.");
  });

  test("is never the words of a record's Execute On-Call Policy button", () => {
    /*
     * The button is a Dashboard label a translated docs page draws in its
     * own language; the permission is named in English, as the custom role
     * picker names it. One string for both would leave a page unable to
     * say which it means.
     */
    expect(
      PermissionHelper.getTitle(
        Permission.CreateProjectOnCallDutyPolicyExecutionLog,
      ),
    ).not.toBe("Execute On-Call Policy");
  });

  test("its title never names the row it writes, any more", () => {
    for (const props of PermissionHelper.getAllPermissionProps()) {
      expect({
        permission: props.permission,
        title:
          props.title === "Create On-Call Duty Policy Execution Log" ||
          props.title === "Create On-Call Policy Execution Log",
      }).toEqual({ permission: props.permission, title: false });
    }
  });
});

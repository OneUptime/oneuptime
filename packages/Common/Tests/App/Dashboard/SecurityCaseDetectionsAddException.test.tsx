import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { act, cleanup, render, screen } from "@testing-library/react";
import * as React from "react";

/*
 * ADD EXCEPTION ON A CASE'S DETECTION: a detection rule that fired on
 * something expected - a scanner, a backup job, a planned test - is tuned
 * where it is seen. The detection's row offers Add Exception (in its
 * menu, only for a detection a rule made, locked for whoever may not add
 * exceptions), and the form starts with the rule and the entity the
 * detection is about.
 */

type Action = {
  title: string;
  icon?: string | undefined;
  placement?: string | undefined;
  disabled?: boolean | undefined;
  tooltip?: string | undefined;
  isVisible?: ((item: unknown) => boolean | undefined) | undefined;
  onClick: (item: unknown, done: () => void, onError: () => void) => void;
};

type Captured = {
  actionButtons?: Array<Action>;
  selectMoreFields?: Record<string, unknown>;
};

type ModalProps = {
  detectionRuleId?: string | undefined;
  entity?: { type: string; value: string } | null | undefined;
  description?: string | undefined;
  onClose: () => void;
  onSuccess: () => void;
};

let captured: Captured | null = null;
let modal: ModalProps | null = null;

jest.mock("../../../UI/Components/ModelTable/ModelTable", () => {
  return {
    __esModule: true,
    default: (props: Captured) => {
      captured = props;
      return React.createElement("div", {
        "data-testid": "security-case-detections-table",
      });
    },
  };
});

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/SecurityEvents/RuleExceptions/AddRuleExceptionModal",
  () => {
    return {
      __esModule: true,
      default: (props: ModalProps) => {
        modal = props;
        return React.createElement("div", {
          "data-testid": "add-rule-exception-modal",
        });
      },
    };
  },
);

import SecurityCaseDetections from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityCase/SecurityCaseDetections";
import { ADD_EXCEPTION_FROM_DETECTION_DESCRIPTION } from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityEvents/RuleExceptions/RuleExceptionsCopy";
import DetectionRuleException from "../../../Models/DatabaseModels/DetectionRuleException";
import SecurityDetection from "../../../Models/DatabaseModels/SecurityDetection";
import IconProp from "../../../Types/Icon/IconProp";
import ObjectID from "../../../Types/ObjectID";
import { SecurityEntityType } from "../../../Types/SecurityCase/SecurityEntity";
import PermissionGate, {
  PermissionGateResult,
} from "../../../UI/Utils/PermissionGate";

const CASE_ID: ObjectID = new ObjectID("11111111-1111-4111-8111-111111111111");
const RULE_ID: string = "22222222-2222-4222-8222-222222222222";

function detection(values: Record<string, unknown>): SecurityDetection {
  const model: SecurityDetection = new SecurityDetection();
  model._id = "33333333-3333-4333-8333-333333333333";
  Object.assign(model, values);
  return model;
}

function action(): Action {
  const found: Action | undefined = captured?.actionButtons?.find(
    (candidate: Action): boolean => {
      return candidate.title === "Add Exception";
    },
  );

  expect(found).toBeDefined();

  return found!;
}

function draw(): void {
  render(<SecurityCaseDetections securityCaseId={CASE_ID} />);
}

describe("Add Exception on a case's detection", () => {
  beforeEach(() => {
    captured = null;
    modal = null;
    jest.spyOn(PermissionGate, "check").mockReturnValue({ isAllowed: true });
  });

  afterEach(() => {
    cleanup();
    jest.restoreAllMocks();
  });

  test("waits in the detection's menu, after Details", () => {
    draw();

    expect(
      (captured?.actionButtons || []).map((candidate: Action): string => {
        return candidate.title;
      }),
    ).toEqual(["Details", "Add Exception"]);
    expect(action().placement).toBe("MoreMenu");
    expect(action().icon).toBe(IconProp.EyeSlash);
  });

  test("only on a detection a rule made: threat intel and connected products have no rule to tune", () => {
    draw();

    expect(
      action().isVisible!(
        detection({ detectionRuleId: new ObjectID(RULE_ID) }),
      ),
    ).toBe(true);
    expect(action().isVisible!(detection({}))).toBe(false);
  });

  test("reads what the form starts with: the rule, and what the rule grouped by", () => {
    draw();

    expect(captured?.selectMoreFields).toMatchObject({
      detectionRuleId: true,
      groupValue: true,
      entities: true,
    });
  });

  test("starts the form with the rule and the entity the detection is about", () => {
    draw();

    act(() => {
      action().onClick(
        detection({
          detectionRuleId: new ObjectID(RULE_ID),
          groupValue: "svc-backup",
          entities: [
            { type: SecurityEntityType.IpAddress, value: "10.0.0.5" },
            { type: SecurityEntityType.User, value: "svc-backup" },
          ],
        }),
        () => {
          // done
        },
        () => {
          // no error
        },
      );
    });

    expect(screen.getByTestId("add-rule-exception-modal")).toBeInTheDocument();
    expect(modal?.detectionRuleId).toBe(RULE_ID);
    expect(modal?.entity).toEqual({
      type: SecurityEntityType.User,
      value: "svc-backup",
    });
    expect(modal?.description).toBe(ADD_EXCEPTION_FROM_DETECTION_DESCRIPTION);

    act(() => {
      modal!.onSuccess();
    });

    expect(screen.queryByTestId("add-rule-exception-modal")).toBeNull();
  });

  test("closing the form leaves the case as it was", () => {
    draw();

    act(() => {
      action().onClick(
        detection({ detectionRuleId: new ObjectID(RULE_ID), entities: [] }),
        () => {
          // done
        },
        () => {
          // no error
        },
      );
    });

    expect(modal?.entity).toBeNull();

    act(() => {
      modal!.onClose();
    });

    expect(screen.queryByTestId("add-rule-exception-modal")).toBeNull();
  });

  test("locked, with the gate's reason, for whoever may not add exceptions", () => {
    jest
      .spyOn(PermissionGate, "check")
      .mockImplementation((model: unknown): PermissionGateResult => {
        return model instanceof DetectionRuleException
          ? { isAllowed: false, disabledReason: "Ask a Security Admin." }
          : { isAllowed: true };
      });

    draw();

    expect(action().disabled).toBe(true);
    expect(action().tooltip).toBe("Ask a Security Admin.");
  });
});

import { describe, expect, test } from "@jest/globals";
import StatusPage from "../../../../Models/DatabaseModels/StatusPage";
import { IsBillingEnabled } from "../../../../Server/EnvironmentConfig";
import ToolImportProjectStateReader from "../../../../Server/Utils/ToolImport/ToolImportProjectStateReader";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { PlanType } from "../../../../Types/Billing/SubscriptionPlan";
import ObjectID from "../../../../Types/ObjectID";
import {
  makeToolImportNote,
  ToolImportNote,
  ToolImportNoteCode,
} from "../../../../Types/ToolImport/ToolImportNote";

/*
 * What a status page can be on the project's plan, asked the way a create
 * asks (ColumnPermission): a private page (StatusPage.isPublicStatusPage
 * off) needs Growth, and letting visitors choose the parts they follow
 * (allowSubscribersToChooseResources) needs Scale - on a billed install
 * only. A column left at its default needs no plan, and OneUptime itself
 * needs none. The suite runs with billing off and on.
 */

function propsOn(plan: PlanType | undefined): DatabaseCommonInteractionProps {
  return {
    tenantId: ObjectID.generate(),
    userId: ObjectID.generate(),
    ...(plan ? { currentPlan: plan, isSubscriptionUnpaid: false } : {}),
  };
}

function refusal(data: {
  column: "isPublicStatusPage" | "allowSubscribersToChooseResources";
  value: boolean;
  props: DatabaseCommonInteractionProps;
}): ToolImportNote | null {
  return ToolImportProjectStateReader.getColumnCreateRefusal({
    model: new StatusPage(),
    column: data.column,
    value: data.value,
    props: data.props,
  });
}

describe("ToolImportProjectStateReader.getColumnCreateRefusal", () => {
  test("a column at its default needs no plan: a public page, a page whose visitors do not choose", () => {
    for (const plan of [PlanType.Free, PlanType.Growth, PlanType.Scale]) {
      expect(
        refusal({
          column: "isPublicStatusPage",
          value: true,
          props: propsOn(plan),
        }),
      ).toBeNull();
      expect(
        refusal({
          column: "allowSubscribersToChooseResources",
          value: false,
          props: propsOn(plan),
        }),
      ).toBeNull();
    }
  });

  test("a private page needs Growth on a billed install; nothing without billing", () => {
    const onFree: ToolImportNote | null = refusal({
      column: "isPublicStatusPage",
      value: false,
      props: propsOn(PlanType.Free),
    });

    if (!IsBillingEnabled) {
      expect(onFree).toBeNull();
      return;
    }

    expect(onFree).toEqual(
      makeToolImportNote(ToolImportNoteCode.NeedsPlan, {
        plan: PlanType.Growth,
      }),
    );

    for (const plan of [PlanType.Growth, PlanType.Scale, PlanType.Enterprise]) {
      expect(
        refusal({
          column: "isPublicStatusPage",
          value: false,
          props: propsOn(plan),
        }),
      ).toBeNull();
    }
  });

  test("letting visitors choose what they follow needs Scale on a billed install; nothing without billing", () => {
    const onGrowth: ToolImportNote | null = refusal({
      column: "allowSubscribersToChooseResources",
      value: true,
      props: propsOn(PlanType.Growth),
    });

    if (!IsBillingEnabled) {
      expect(onGrowth).toBeNull();
      return;
    }

    expect(onGrowth).toEqual(
      makeToolImportNote(ToolImportNoteCode.NeedsPlan, {
        plan: PlanType.Scale,
      }),
    );
    expect(
      refusal({
        column: "allowSubscribersToChooseResources",
        value: true,
        props: propsOn(PlanType.Free),
      }),
    ).toEqual(
      makeToolImportNote(ToolImportNoteCode.NeedsPlan, {
        plan: PlanType.Scale,
      }),
    );
    expect(
      refusal({
        column: "allowSubscribersToChooseResources",
        value: true,
        props: propsOn(PlanType.Scale),
      }),
    ).toBeNull();
  });

  test("OneUptime itself and a server admin are held to no plan", () => {
    for (const props of [
      { isRoot: true },
      { ...propsOn(PlanType.Free), isMasterAdmin: true },
    ] as Array<DatabaseCommonInteractionProps>) {
      expect(
        refusal({ column: "isPublicStatusPage", value: false, props: props }),
      ).toBeNull();
    }
  });
});

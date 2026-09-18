import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import { getNotifySubscribersOfUpdateFormField } from "../../FeatureSet/Dashboard/src/Components/StatusPageSubscribers/SubscriberUpdateNotificationFormField";
import IncidentPublicNote from "Common/Models/DatabaseModels/IncidentPublicNote";
import StatusPageAnnouncement from "Common/Models/DatabaseModels/StatusPageAnnouncement";
import SubscriberUpdateNotification from "Common/Types/StatusPage/SubscriberUpdateNotification";
import { ModelField } from "Common/UI/Components/Forms/ModelForm";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";

/*
 * The "Notify subscribers about this update" checkbox on the announcement and
 * public note edit forms.
 *
 * Its whole contract is how ModelForm treats it: a field with an
 * overrideFieldKey is sent as a misc data prop, not as a column, and only when
 * ticked. That is what lets the server tell "notify about this edit" apart
 * from the edit itself, and what keeps the box unticked on the next edit.
 */

describe("getNotifySubscribersOfUpdateFormField", () => {
  const field: ModelField<StatusPageAnnouncement> =
    getNotifySubscribersOfUpdateFormField<StatusPageAnnouncement>({
      description: "Tell subscribers.",
      stepId: "more",
    });

  test("is sent as the misc data prop the server reads, not as a column", () => {
    expect(field.overrideFieldKey).toBe(
      SubscriberUpdateNotification.miscDataKey,
    );
    expect(field.overrideField).toEqual({
      [SubscriberUpdateNotification.miscDataKey]: true,
    });
    expect(field.field).toBeUndefined();
  });

  test("does not name a real column on the model", () => {
    expect(
      new StatusPageAnnouncement().getTableColumns().columns,
    ).not.toContain(SubscriberUpdateNotification.miscDataKey);
    expect(new IncidentPublicNote().getTableColumns().columns).not.toContain(
      SubscriberUpdateNotification.miscDataKey,
    );
  });

  test("is an optional checkbox that starts unticked", () => {
    expect(field.fieldType).toBe(FormFieldSchemaType.Checkbox);
    expect(field.required).toBe(false);
    expect(field.defaultValue).toBe(false);
    expect(field.getDefaultValue).toBeUndefined();
  });

  test("is only offered when editing", () => {
    expect(field.doNotShowWhenCreating).toBe(true);
    expect(field.doNotShowWhenEditing).toBeFalsy();
  });

  test("is shown without a column permission to check against", () => {
    /*
     * ModelForm drops fields the viewer has no column permission for, and an
     * override key has no column. The edit button that opens the form is
     * already gated on edit permission.
     */
    expect(field.showEvenIfPermissionDoesNotExist).toBe(true);
  });

  test("uses the shared title and the caller's description and step", () => {
    expect(field.title).toBe(SubscriberUpdateNotification.formFieldTitle);
    expect(field.description).toBe("Tell subscribers.");
    expect(field.stepId).toBe("more");
  });

  test("leaves the step unset for forms without steps", () => {
    const withoutStep: ModelField<IncidentPublicNote> =
      getNotifySubscribersOfUpdateFormField<IncidentPublicNote>({
        description: "Tell subscribers.",
      });

    expect(withoutStep.stepId).toBeUndefined();
    expect(Object.keys(withoutStep)).not.toContain("stepId");
  });

  test("returns a new object each call, so one form cannot change another's field", () => {
    const first: ModelField<IncidentPublicNote> =
      getNotifySubscribersOfUpdateFormField<IncidentPublicNote>({
        description: "a",
      });
    const second: ModelField<IncidentPublicNote> =
      getNotifySubscribersOfUpdateFormField<IncidentPublicNote>({
        description: "b",
      });

    expect(first).not.toBe(second);
    expect(first.overrideField).not.toBe(second.overrideField);
    expect(second.description).toBe("b");
  });
});

/*
 * ModelForm is what turns the field into a misc data prop. Pin the two lines
 * of it this feature relies on, so a refactor there cannot quietly start
 * writing the flag as a column or stop sending it on update.
 */
describe("ModelForm sends override-key fields as misc data props on update", () => {
  const source: string = fs
    .readFileSync(
      path.join(
        __dirname,
        "..",
        "..",
        "..",
        "Common",
        "UI",
        "Components",
        "Forms",
        "ModelForm.tsx",
      ),
      "utf8",
    )
    .replace(/\s+/g, " ");

  test("collects values keyed by overrideFieldKey into miscDataProps", () => {
    expect(source).toContain(
      "if (field.overrideFieldKey && values[field.overrideFieldKey]) {",
    );
    expect(source).toContain("delete valuesToSend[key];");
  });

  test("passes miscDataProps to createOrUpdate for both create and update", () => {
    expect(source).toMatch(
      /modelAPI\.createOrUpdate<TBaseModel>\(\{[^}]*formType: props\.formType, miscDataProps: miscDataProps,/,
    );
  });
});

describe("ModelAPI.createOrUpdate sends miscDataProps with an update", () => {
  const source: string = fs
    .readFileSync(
      path.join(
        __dirname,
        "..",
        "..",
        "..",
        "Common",
        "UI",
        "Utils",
        "ModelAPI",
        "ModelAPI.ts",
      ),
      "utf8",
    )
    .replace(/\s+/g, " ");

  test("puts miscDataProps next to data in the request body regardless of method", () => {
    expect(source).toContain("miscDataProps: data.miscDataProps || {},");
    expect(source).toContain(
      "data.formType === FormType.Create ? HTTPMethod.POST : HTTPMethod.PUT;",
    );
  });
});

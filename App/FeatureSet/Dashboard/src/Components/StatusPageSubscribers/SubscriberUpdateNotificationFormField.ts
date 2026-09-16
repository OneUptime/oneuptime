import BaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import SubscriberUpdateNotification from "Common/Types/StatusPage/SubscriberUpdateNotification";
import { ModelField } from "Common/UI/Components/Forms/ModelForm";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";

/**
 * The "tell subscribers about this edit" checkbox on the announcement and
 * public note edit forms.
 *
 * It is deliberately not bound to a column. ModelForm sends a field that has
 * an `overrideFieldKey` as a misc data prop rather than as model data, and the
 * update API hands those to the service's onBeforeUpdate, which queues the
 * notification (see SubscriberUpdateNotification). So the box starts unticked
 * on every edit, and ticking it once never makes a later typo fix page every
 * subscriber.
 *
 * `showEvenIfPermissionDoesNotExist` is needed because the form's per-column
 * permission check has no column to look at; the edit button that opens the
 * form is already gated on edit permission. Create forms leave it out, since
 * posting something already has its own "notify subscribers" choice.
 */
export const getNotifySubscribersOfUpdateFormField: <
  TBaseModel extends BaseModel,
>(data: {
  description: string;
  stepId?: string | undefined;
}) => ModelField<TBaseModel> = <TBaseModel extends BaseModel>(data: {
  description: string;
  stepId?: string | undefined;
}): ModelField<TBaseModel> => {
  const field: ModelField<TBaseModel> = {
    overrideField: {
      [SubscriberUpdateNotification.miscDataKey]: true,
    },
    overrideFieldKey: SubscriberUpdateNotification.miscDataKey,
    showEvenIfPermissionDoesNotExist: true,
    doNotShowWhenCreating: true,
    title: SubscriberUpdateNotification.formFieldTitle,
    description: data.description,
    fieldType: FormFieldSchemaType.Checkbox,
    required: false,
    defaultValue: false,
  };

  if (data.stepId) {
    field.stepId = data.stepId;
  }

  return field;
};

import FormsCopy from "../../../Components/FormBuilder/FormsCopy";
import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import PageComponentProps from "../../PageComponentProps";
import Form from "Common/Models/DatabaseModels/Form";
import Route from "Common/Types/API/Route";
import ObjectID from "Common/Types/ObjectID";
import DuplicateModel from "Common/UI/Components/DuplicateModel/DuplicateModel";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import Navigation from "Common/UI/Utils/Navigation";
import React, { Fragment, FunctionComponent, ReactElement } from "react";

/*
 * Duplicate Form: another form built like this one, to change for another
 * team or another case rather than build again from nothing. It asks only
 * the copy's name (DuplicateModel fills in "<name> 2"), and opens the copy
 * on its builder.
 *
 * The copy has everything a form is built from - its questions, templates,
 * On Submit settings, description, thank-you message, IP allowlist and
 * branding - and a link of its own, which the server mints for every new
 * form. It starts turned off, so nobody reaches it before it is ready; its
 * Share page turns it on. Its submissions start empty: they belong to the
 * original.
 */

/*
 * The copy as it is saved: turned off, and without an IP allowlist the
 * original does not have - the allowlist needs the Scale plan, and sending
 * it empty would still ask for that plan. One the original has is copied:
 * dropping a form's network restriction must never be silent.
 */
export const prepareFormCopy: (copy: Form) => void = (copy: Form): void => {
  copy.isEnabled = false;

  if (!copy.ipWhitelist || !copy.ipWhitelist.trim()) {
    copy.removeValue("ipWhitelist");
  }
};
const FormDuplicate: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  // .../forms/<id>/duplicate: the form is the next-to-last segment.
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  return (
    <Fragment>
      <DuplicateModel<Form>
        modelType={Form}
        modelId={modelId}
        description={FormsCopy.duplicateFormNote}
        fieldsToDuplicate={{
          description: true,
          targetType: true,
          fields: true,
          templates: true,
          targetSettings: true,
          successMessage: true,
          ipWhitelist: true,
          logoFileId: true,
          logoAltText: true,
          faviconFileId: true,
        }}
        prepareCopy={prepareFormCopy}
        navigateToOnSuccess={RouteUtil.populateRouteParams(
          RouteMap[PageMap.FORMS] as Route,
        )}
        fieldsToChange={[
          {
            field: {
              name: true,
            },
            title: "Name",
            description: FormsCopy.nameDescription,
            fieldType: FormFieldSchemaType.Text,
            required: true,
            placeholder: FormsCopy.namePlaceholder,
          },
        ]}
      />
    </Fragment>
  );
};

export default FormDuplicate;

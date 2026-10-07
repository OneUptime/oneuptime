import FormTemplates from "../../../Components/FormBuilder/Templates/FormTemplates";
import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import React, { FunctionComponent, ReactElement } from "react";
import { useParams } from "react-router-dom";

// A form's templates: named sets of answers people start the form from.
const FormTemplatesPage: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const { id } = useParams();

  return <FormTemplates formId={new ObjectID(id || "")} />;
};

export default FormTemplatesPage;

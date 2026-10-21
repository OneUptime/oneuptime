import FormBuilder from "../../../Components/FormBuilder/Builder/FormBuilder";
import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import React, { FunctionComponent, ReactElement } from "react";
import { useParams } from "react-router-dom";

// A form's landing page: its builder.
const FormBuild: FunctionComponent<PageComponentProps> = (): ReactElement => {
  const { id } = useParams();

  return <FormBuilder formId={new ObjectID(id || "")} />;
};

export default FormBuild;

import FormSubmissionsTable from "../../../Components/FormBuilder/Submissions/FormSubmissionsTable";
import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import React, { FunctionComponent, ReactElement } from "react";
import { useParams } from "react-router-dom";

// A form's Submissions page: everything submitted through it.
const FormViewSubmissions: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const { id } = useParams();

  return <FormSubmissionsTable formId={new ObjectID(id || "")} />;
};

export default FormViewSubmissions;

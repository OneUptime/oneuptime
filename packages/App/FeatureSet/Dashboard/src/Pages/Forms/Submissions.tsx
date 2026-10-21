import FormSubmissionsTable from "../../Components/FormBuilder/Submissions/FormSubmissionsTable";
import PageComponentProps from "../PageComponentProps";
import React, { FunctionComponent, ReactElement } from "react";

// Forms > Submissions: every submission made through any of the project's forms.
const FormsSubmissions: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  return <FormSubmissionsTable />;
};

export default FormsSubmissions;

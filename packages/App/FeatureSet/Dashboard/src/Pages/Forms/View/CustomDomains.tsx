import PageComponentProps from "../../PageComponentProps";
import { FORM_CUSTOM_DOMAINS } from "../../../Components/CustomDomain/CustomDomainKinds";
import CustomDomainsTable from "../../../Components/CustomDomain/CustomDomainsTable";
import ObjectID from "Common/Types/ObjectID";
import React, { FunctionComponent, ReactElement } from "react";
import { useParams } from "react-router-dom";

/*
 * Forms -> a form -> Custom Domains: the form on your own domain, such as
 * report.acme.com, at its root. The same table as a status page's and a
 * dashboard's Custom Domains pages (CustomDomainsTable): add the domain on
 * one page, add the record from DNS Setup - Check now orders the free
 * certificate the moment the record is found - and the Status column says
 * where each domain is on its way to HTTPS. The form's Share page lists the
 * live ones among the form's addresses.
 */
const FormCustomDomains: FunctionComponent<PageComponentProps> = (
  props: PageComponentProps,
): ReactElement => {
  const { id } = useParams();
  const modelId: ObjectID = new ObjectID(id || "");

  return (
    <CustomDomainsTable
      kind={FORM_CUSTOM_DOMAINS}
      parentId={modelId}
      currentProject={props.currentProject}
    />
  );
};

export default FormCustomDomains;

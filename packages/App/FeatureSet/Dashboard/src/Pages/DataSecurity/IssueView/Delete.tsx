import PageComponentProps from "../../PageComponentProps";
import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import { ISSUE_DELETE_WARNING } from "../../../Components/DataSecurity/IssueChanges";
import DataSecurityIssueViewContext, {
  useDataSecurityIssueView,
} from "./IssueViewContext";
import DataSecurityIssue from "Common/Models/DatabaseModels/DataSecurityIssue";
import Route from "Common/Types/API/Route";
import ModelDelete from "Common/UI/Components/ModelDelete/ModelDelete";
import Navigation from "Common/UI/Utils/Navigation";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * Delete Issue, where every record's menu keeps its Delete (Advanced). The
 * issue and its timeline go for good - and if its check still fails, the
 * next check opens it again, so the dialog says that closing it is the way
 * to be rid of it. Only who may delete issues may: anyone else sees the
 * button locked, and why.
 */
const DataSecurityIssueDeletePage: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const translator: Translator = useTranslator();
  const view: DataSecurityIssueViewContext = useDataSecurityIssueView();

  return (
    <ModelDelete
      modelType={DataSecurityIssue}
      modelId={view.issueId}
      itemName={
        translator.translateText(view.issue.title) || view.issue.title || ""
      }
      confirmationContent={
        <p className="text-sm text-gray-600">
          {translator.translateText(ISSUE_DELETE_WARNING)}
        </p>
      }
      onDeleteSuccess={() => {
        Navigation.navigate(
          RouteUtil.populateRouteParams(
            RouteMap[PageMap.DATA_SECURITY_ISSUES] as Route,
          ),
        );
      }}
    />
  );
};

export default DataSecurityIssueDeletePage;

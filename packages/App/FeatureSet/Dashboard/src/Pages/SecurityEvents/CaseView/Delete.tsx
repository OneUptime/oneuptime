import PageComponentProps from "../../PageComponentProps";
import SecurityCaseViewContext, {
  useSecurityCaseView,
} from "./SecurityCaseViewContext";
import SecurityCase from "Common/Models/DatabaseModels/SecurityCase";
import IconProp from "Common/Types/Icon/IconProp";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import Card from "Common/UI/Components/Card/Card";
import PermissionGate, {
  ModelAction,
  PermissionGateResult,
} from "Common/UI/Utils/PermissionGate";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * Delete Case, where every record's menu keeps its Delete (Advanced). It
 * asks first, with the same question the header's ⋯ asks - the case and
 * everything on it go for good, and closing it with a verdict keeps the
 * record - and only who may delete cases may: anyone else sees the button
 * locked, and why.
 */
const SecurityCaseDeletePage: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const translator: Translator = useTranslator();
  const view: SecurityCaseViewContext = useSecurityCaseView();
  const securityCase: SecurityCase = view.securityCase;
  const deleteGate: PermissionGateResult = PermissionGate.check(
    new SecurityCase(),
    ModelAction.Delete,
  );

  return (
    <Card
      title="Delete Case"
      description={translator.translateTemplate(
        "{{case}} and its detections, notes and timeline are deleted for good. To keep the record, close it with a verdict instead.",
        {
          case: `${securityCase.caseNumberWithPrefix || ""} ${
            securityCase.title || ""
          }`.trim(),
        },
      )}
      buttons={[
        {
          title: "Delete Case",
          icon: IconProp.Trash,
          buttonStyle: ButtonStyleType.DANGER,
          disabled: !deleteGate.isAllowed || view.isWorking,
          tooltip: deleteGate.isAllowed ? undefined : deleteGate.disabledReason,
          onClick: () => {
            if (deleteGate.isAllowed) {
              view.requestDelete();
            }
          },
        },
      ]}
    />
  );
};

export default SecurityCaseDeletePage;

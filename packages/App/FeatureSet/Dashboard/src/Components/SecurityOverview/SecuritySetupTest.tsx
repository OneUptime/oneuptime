import AppLink from "../AppLink/AppLink";
import SecurityCaseApi from "../SecurityCase/SecurityCaseApi";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import PageMap from "../../Utils/PageMap";
import {
  SecuritySetupTestResult,
  describeSetupCallFailure,
} from "./SecuritySetupModel";
import Route from "Common/Types/API/Route";
import IconProp from "Common/Types/Icon/IconProp";
import DetectionRule from "Common/Models/DatabaseModels/DetectionRule";
import Button, { ButtonStyleType } from "Common/UI/Components/Button/Button";
import Icon from "Common/UI/Components/Icon/Icon";
import PermissionGate, {
  ModelAction,
  PermissionGateResult,
} from "Common/UI/Utils/PermissionGate";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement, useState } from "react";

/*
 * "Send a test attack": a dozen failed sign-ins from one documentation
 * address go through the real pipeline - stored, matched by the brute force
 * rule, grouped into a case, enriched - without paging anybody or reaching
 * a SIEM (Server/Utils/SecurityEvent/SecuritySetup.ts). Get started offers
 * it, and so does the all-quiet card for whoever wants to see it again.
 */

export interface SecuritySetupTestState {
  gate: PermissionGateResult;
  isTesting: boolean;
  result: SecuritySetupTestResult | null;
  error: string;
  run: () => Promise<void>;
}

// The server holds the test to the same rule: whoever may add rules.
export function getSecuritySetupTestGate(): PermissionGateResult {
  return PermissionGate.check(new DetectionRule(), ModelAction.Create);
}

export function useSecuritySetupTest(
  onChanged: () => void,
): SecuritySetupTestState {
  const [isTesting, setIsTesting] = useState<boolean>(false);
  const [result, setResult] = useState<SecuritySetupTestResult | null>(null);
  const [error, setError] = useState<string>("");

  const run: () => Promise<void> = async (): Promise<void> => {
    setIsTesting(true);
    setError("");

    try {
      setResult(await SecurityCaseApi.runSetupTest());
      onChanged();
    } catch (err) {
      // The server's sentence for a role or a plan; the product's own for anything else.
      setError(describeSetupCallFailure(err));
    }

    setIsTesting(false);
  };

  return {
    gate: getSecuritySetupTestGate(),
    isTesting,
    result,
    error,
    run,
  };
}

export const SecuritySetupTestButton: FunctionComponent<{
  test: SecuritySetupTestState;
  buttonStyle?: ButtonStyleType | undefined;
}> = (props: {
  test: SecuritySetupTestState;
  buttonStyle?: ButtonStyleType | undefined;
}): ReactElement => {
  return (
    <Button
      title="Send a test attack"
      icon={IconProp.Beaker}
      buttonStyle={props.buttonStyle || ButtonStyleType.NORMAL}
      isLoading={props.test.isTesting}
      disabled={!props.test.gate.isAllowed || props.test.isTesting}
      tooltip={
        props.test.gate.isAllowed ? undefined : props.test.gate.disabledReason
      }
      dataTestId="security-run-setup-test"
      onClick={() => {
        void props.test.run();
      }}
    />
  );
};

/*
 * What the test did: the case it opened, with a link to it. The case is
 * usually open by the time the call answers; when the rule is still
 * catching up, the line says so.
 */
export const SecuritySetupTestResultLine: FunctionComponent<{
  result: SecuritySetupTestResult;
}> = (props: { result: SecuritySetupTestResult }): ReactElement => {
  const translator: Translator = useTranslator();
  const caseId: string | null = props.result.caseId;

  return (
    <div
      data-testid="security-setup-test-result"
      role="status"
      className="flex flex-col gap-2 rounded-lg bg-indigo-50 px-4 py-3 text-sm text-indigo-900 sm:flex-row sm:items-center sm:justify-between"
    >
      <span>
        {props.result.caseNumber
          ? translator.translateTemplate(
              "The test opened case {{caseNumber}}: a brute force attempt from one address. This is what a real finding looks like.",
              { caseNumber: props.result.caseNumber },
            )
          : translator.translateText(
              "The test events were sent. Their case opens within a minute.",
            )}
      </span>
      {caseId ? (
        <AppLink
          to={RouteUtil.populateRouteParams(
            RouteMap[PageMap.SECURITY_CASE_VIEW] as Route,
            { modelId: caseId },
          )}
          className="inline-flex flex-shrink-0 items-center gap-1 font-medium text-indigo-700 hover:text-indigo-800"
        >
          <>
            <span>{translator.translateText("Open the case")}</span>
            <Icon icon={IconProp.ChevronRight} className="h-3.5 w-3.5" />
          </>
        </AppLink>
      ) : (
        <></>
      )}
    </div>
  );
};

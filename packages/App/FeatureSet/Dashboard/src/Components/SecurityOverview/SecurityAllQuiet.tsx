import {
  SecuritySetupTestButton,
  SecuritySetupTestResultLine,
  SecuritySetupTestState,
  useSecuritySetupTest,
} from "./SecuritySetupTest";
import IconProp from "Common/Types/Icon/IconProp";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import Icon from "Common/UI/Components/Icon/Icon";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";

export const SECURITY_ALL_QUIET_ID: string = "security-all-quiet";

export interface ComponentProps {
  // Called after the test opened a case, so the page reads its figures again.
  onChanged: () => void;
}

/*
 * Nothing needs anybody: no open case, no playbook step waiting for an
 * approval. Said in so many words rather than as three zeros, with what
 * happens next - and the test attack, for whoever wants to see the
 * pipeline work again.
 */
const SecurityAllQuiet: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const test: SecuritySetupTestState = useSecuritySetupTest(props.onChanged);

  return (
    <section
      id={SECURITY_ALL_QUIET_ID}
      data-testid={SECURITY_ALL_QUIET_ID}
      aria-labelledby={`${SECURITY_ALL_QUIET_ID}-title`}
      className="rounded-xl border border-emerald-200 bg-emerald-50 p-5"
    >
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg bg-white text-emerald-600">
            <Icon icon={IconProp.ShieldCheck} className="h-5 w-5" />
          </div>
          <div>
            <h2
              id={`${SECURITY_ALL_QUIET_ID}-title`}
              className="text-base font-semibold text-gray-900"
            >
              {translator.translateText("All quiet")}
            </h2>
            <p className="mt-1 max-w-2xl text-sm text-gray-600">
              {translator.translateText(
                "No open case and nothing waiting for an approval. When a rule finds a threat, its case opens here and your playbooks run on it.",
              )}
            </p>
          </div>
        </div>
        <div className="flex-shrink-0 [&>button]:ml-0 [&>button]:md:ml-0 [&>*>button]:ml-0 [&>*>button]:md:ml-0">
          <SecuritySetupTestButton test={test} />
        </div>
      </div>
      {test.error ? (
        <div className="mt-4">
          <ErrorMessage message={test.error} />
        </div>
      ) : (
        <></>
      )}
      {test.result ? (
        <div className="mt-4">
          <SecuritySetupTestResultLine result={test.result} />
        </div>
      ) : (
        <></>
      )}
    </section>
  );
};

export default SecurityAllQuiet;

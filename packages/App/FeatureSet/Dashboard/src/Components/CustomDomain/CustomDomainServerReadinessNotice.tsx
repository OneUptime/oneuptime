import { ADD_CUSTOM_DOMAIN_TEST_IDS } from "./CustomDomainCopy";
import { CustomDomainKind } from "./CustomDomainKinds";
import CustomDomainServerReadiness, {
  CustomDomainReadinessCheck,
  CustomDomainReadinessOutcome,
  CustomDomainReadinessWords,
  CustomDomainServerReadinessResult,
  describeReadinessCheck,
} from "Common/Types/CustomDomain/CustomDomainServerReadiness";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import URL from "Common/Types/API/URL";
import { JSONObject } from "Common/Types/JSON";
import Alert, { AlertType } from "Common/UI/Components/Alerts/Alert";
import { APP_API_URL, BILLING_ENABLED } from "Common/UI/Config";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";

/*
 * What a self-hosted server still needs before a custom domain can work -
 * said in Add Custom Domain and in DNS Setup, before anybody changes their
 * DNS (the checks are CustomDomainServerReadiness's). Three of the four
 * reports this answers found out only after adding their records and
 * waiting.
 *
 * Nothing at all while the server is ready, while the answer is on its way,
 * when it cannot be read, and on OneUptime Cloud (BILLING_ENABLED), where
 * there is nothing for a customer to set.
 */

export interface ComponentProps {
  kind: CustomDomainKind;
}

/*
 * Reads the kind's server readiness: undefined until it arrives, and when
 * it cannot be read - the notice then says nothing rather than a guess.
 */
export const useCustomDomainServerReadiness: (
  kind: CustomDomainKind,
) => CustomDomainServerReadinessResult | undefined = (
  kind: CustomDomainKind,
): CustomDomainServerReadinessResult | undefined => {
  const [readiness, setReadiness] = useState<
    CustomDomainServerReadinessResult | undefined
  >(undefined);

  useEffect(() => {
    if (BILLING_ENABLED) {
      return;
    }

    let isCurrent: boolean = true;

    const load: () => Promise<void> = async (): Promise<void> => {
      try {
        const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
          await API.get<JSONObject>({
            url: URL.fromString(APP_API_URL.toString()).addRoute(
              `/${new kind.modelType().crudApiPath}/server-readiness`,
            ),
            data: {},
            headers: ModelAPI.getCommonHeaders(),
          });

        if (!isCurrent || !response || response.isFailure?.() !== false) {
          return;
        }

        setReadiness(
          CustomDomainServerReadiness.fromJSON(response.data as JSONObject),
        );
      } catch {
        // Nothing to say rather than a guess.
      }
    };

    void load();

    return () => {
      isCurrent = false;
    };
  }, [kind]);

  return readiness;
};

const CustomDomainServerReadinessNotice: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();

  const readiness: CustomDomainServerReadinessResult | undefined =
    useCustomDomainServerReadiness(props.kind);

  if (!readiness || !CustomDomainServerReadiness.needsAttention(readiness)) {
    return <></>;
  }

  const isReady: boolean = CustomDomainServerReadiness.isReady(readiness);

  // What is wrong, failures first; what passed is left out.
  const problems: Array<CustomDomainReadinessCheck> = readiness.checks
    .filter((check: CustomDomainReadinessCheck): boolean => {
      return check.outcome !== CustomDomainReadinessOutcome.Pass;
    })
    .sort(
      (
        a: CustomDomainReadinessCheck,
        b: CustomDomainReadinessCheck,
      ): number => {
        const rank: (check: CustomDomainReadinessCheck) => number = (
          check: CustomDomainReadinessCheck,
        ): number => {
          return check.outcome === CustomDomainReadinessOutcome.Fail ? 0 : 1;
        };

        return rank(a) - rank(b);
      },
    );

  return (
    <div data-testid={ADD_CUSTOM_DOMAIN_TEST_IDS.readiness}>
      <Alert
        type={isReady ? AlertType.WARNING : AlertType.DANGER}
        strongTitle={
          isReady
            ? CustomDomainReadinessWords.warningTitle
            : CustomDomainReadinessWords.notReadyTitle
        }
        title={
          <div className="space-y-1">
            <ul className="list-disc space-y-1 ps-5">
              {problems.map(
                (check: CustomDomainReadinessCheck): ReactElement => {
                  const described: {
                    template: string;
                    values: Record<string, string>;
                  } = describeReadinessCheck(check);

                  return (
                    <li
                      key={check.id}
                      className="break-words"
                      data-testid={ADD_CUSTOM_DOMAIN_TEST_IDS.readinessCheck}
                      data-check={check.id}
                      data-outcome={check.outcome}
                    >
                      {translator.translateTemplate(
                        described.template,
                        described.values,
                      )}
                    </li>
                  );
                },
              )}
            </ul>
            {readiness.target && !isReady ? (
              <p className="text-xs">
                {translator.translateTemplate(
                  CustomDomainReadinessWords.checkedFromServer,
                  { target: readiness.target },
                )}
              </p>
            ) : (
              <></>
            )}
          </div>
        }
      />
    </div>
  );
};

export default CustomDomainServerReadinessNotice;

import {
  ACCESS_CHECKING,
  ACCESS_CHECK_AGAIN,
  ACCESS_COULD_NOT_CHECK,
  ACCESS_GRANTED,
  ACCESS_MISSING,
  ACCESS_PERMISSION_GRANTED,
  ACCESS_PERMISSION_MISSING,
  AZURE_CLOUD_SHELL,
  CLOUD_WAF_TEST_IDS,
  GOOGLE_CLOUD_SHELL,
} from "./CloudWafCopy";
import { CloudWafAccess, checkCloudWafAccess } from "./CloudWafApi";
import IconProp from "Common/Types/Icon/IconProp";
import Button, { ButtonStyleType } from "Common/UI/Components/Button/Button";
import CodeBlock from "Common/UI/Components/CodeBlock/CodeBlock";
import { ErrorInSentence } from "Common/UI/Components/ErrorMessage/ErrorSentence";
import Icon from "Common/UI/Components/Icon/Icon";
import API from "Common/UI/Utils/API/API";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";

/*
 * WHETHER THE CONNECTION MAY WRITE THE POLICY PICKED IN ADD WAF (#10348,
 * #10349): asked of Azure (the app's permissions at the policy) or Google
 * Cloud (testIamPermissions on its project) as soon as the policy is
 * picked, without writing anything. Each permission it takes shows as
 * Granted or Missing; while one is missing, the exact lines that grant it
 * - a custom role, assigned on that policy alone for Azure, bound on its
 * project for Google Cloud - with a copy button, and Check Again. The
 * dialog adds the policy only once every permission is granted, and the
 * server asks again before it does.
 */

export interface ComponentProps {
  cloudResourceId: string;
  name: string;
  // Told what the last check found, or null while it runs or when it failed.
  onChecked: (access: CloudWafAccess | null) => void;
}

const CloudWafAccessPanel: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const [access, setAccess] = useState<CloudWafAccess | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isChecking, setIsChecking] = useState<boolean>(true);
  const [checkCount, setCheckCount] = useState<number>(0);

  useEffect(() => {
    let isCurrent: boolean = true;

    setIsChecking(true);
    setError(null);
    props.onChecked(null);

    checkCloudWafAccess(props.cloudResourceId)
      .then((found: CloudWafAccess) => {
        if (isCurrent) {
          setAccess(found);
          setIsChecking(false);
          props.onChecked(found);
        }
      })
      .catch((caught: unknown) => {
        if (isCurrent) {
          setAccess(null);
          setIsChecking(false);
          setError(API.getFriendlyMessage(caught));
        }
      });

    return () => {
      isCurrent = false;
    };
  }, [props.cloudResourceId, checkCount]);

  const checkAgain: () => void = (): void => {
    setCheckCount((count: number): number => {
      return count + 1;
    });
  };

  if (isChecking) {
    return (
      <div
        className="flex items-center gap-2 rounded-md bg-gray-50 px-3 py-3 text-sm text-gray-600"
        data-testid={CLOUD_WAF_TEST_IDS.access}
      >
        <Icon icon={IconProp.Spinner} className="h-4 w-4 animate-spin" />
        <span>
          {translator.translateTemplate(ACCESS_CHECKING, { name: props.name })}
        </span>
      </div>
    );
  }

  if (error || !access) {
    return (
      <div
        className="space-y-2 rounded-md border border-gray-200 px-3 py-3 text-sm"
        data-testid={CLOUD_WAF_TEST_IDS.access}
      >
        <p className="text-gray-700">
          {translator.translateText(ACCESS_COULD_NOT_CHECK)}
        </p>
        {error ? <ErrorInSentence message={error} /> : <></>}
        <Button
          title={ACCESS_CHECK_AGAIN}
          icon={IconProp.Refresh}
          buttonStyle={ButtonStyleType.OUTLINE}
          onClick={checkAgain}
          dataTestId={CLOUD_WAF_TEST_IDS.accessCheck}
        />
      </div>
    );
  }

  return (
    <div
      className="space-y-3 rounded-md border border-gray-200 px-3 py-3"
      data-testid={CLOUD_WAF_TEST_IDS.access}
    >
      <div className="flex items-start gap-2 text-sm">
        <Icon
          icon={
            access.isGranted
              ? IconProp.CheckCircle
              : IconProp.ExclaimationCircle
          }
          className={`mt-0.5 h-4 w-4 flex-shrink-0 ${
            access.isGranted ? "text-green-600" : "text-amber-600"
          }`}
        />
        <span className="text-gray-800">
          {access.isGranted
            ? translator.translateTemplate(ACCESS_GRANTED, {
                name: props.name,
              })
            : translator.translateTemplate(ACCESS_MISSING, {
                name: props.name,
                shell:
                  access.shell === "gcp"
                    ? GOOGLE_CLOUD_SHELL
                    : AZURE_CLOUD_SHELL,
              })}
        </span>
      </div>

      <ul className="space-y-1 text-xs">
        {access.checks.map(
          (check: { permission: string; isGranted: boolean }): ReactElement => {
            return (
              <li
                key={check.permission}
                className="flex flex-wrap items-center justify-between gap-x-3 gap-y-0.5"
              >
                <code className="break-all font-mono text-gray-700">
                  {check.permission}
                </code>
                <span
                  className={
                    check.isGranted
                      ? "font-medium text-green-700"
                      : "font-medium text-amber-700"
                  }
                >
                  {translator.translateText(
                    check.isGranted
                      ? ACCESS_PERMISSION_GRANTED
                      : ACCESS_PERMISSION_MISSING,
                  )}
                </span>
              </li>
            );
          },
        )}
      </ul>

      {access.isGranted ? (
        <></>
      ) : (
        <>
          <div data-testid={CLOUD_WAF_TEST_IDS.accessCommand}>
            <CodeBlock
              code={access.command}
              language="bash"
              wrapLongLines={true}
              maxHeight="260px"
            />
          </div>
          <Button
            title={ACCESS_CHECK_AGAIN}
            icon={IconProp.Refresh}
            buttonStyle={ButtonStyleType.OUTLINE}
            onClick={checkAgain}
            dataTestId={CLOUD_WAF_TEST_IDS.accessCheck}
          />
        </>
      )}
    </div>
  );
};

export default CloudWafAccessPanel;

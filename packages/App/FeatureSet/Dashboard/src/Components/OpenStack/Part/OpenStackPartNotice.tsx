import IconProp from "Common/Types/Icon/IconProp";
import Icon from "Common/UI/Components/Icon/Icon";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement, ReactNode } from "react";

/*
 * A sentence a part's page says before its numbers, because they would be misread without
 * it: a lost hypervisor's numbers are last known; a pool's volumes can't be listed from
 * what the agent collects. Amber for what needs reading first, grey for what is only so.
 */
export type OpenStackPartNoticeTone = "warning" | "neutral";

const TONE_CLASS_NAMES: Record<OpenStackPartNoticeTone, string> = {
  warning: "border-amber-200 bg-amber-50 text-amber-800",
  neutral: "border-gray-200 bg-gray-50 text-gray-700",
};

export interface ComponentProps {
  testId: string;
  tone?: OpenStackPartNoticeTone | undefined;
  // English, looked up in the reader's language.
  text?: string | undefined;
  // A sentence the page words itself, with a link in it.
  children?: ReactNode | undefined;
}

const OpenStackPartNotice: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const tone: OpenStackPartNoticeTone = props.tone || "neutral";

  return (
    <div
      data-testid={props.testId}
      data-tone={tone}
      className={`mb-6 flex items-start gap-2 rounded-lg border px-4 py-3 text-sm ${TONE_CLASS_NAMES[tone]}`}
    >
      <Icon
        icon={tone === "warning" ? IconProp.ExclaimationCircle : IconProp.Info}
        className="mt-0.5 h-4 w-4 flex-shrink-0"
      />
      <div className="min-w-0">
        {props.text ? (
          translator.translateText(props.text) || props.text
        ) : (
          <></>
        )}
        {props.children}
      </div>
    </div>
  );
};

export default OpenStackPartNotice;

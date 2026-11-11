import MonitorType, {
  MonitorTypeHelper,
  MonitorTypeProps,
} from "Common/Types/Monitor/MonitorType";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";

// The type's title as the type picker writes it, in English.
export const getMonitorTypeTitle: (
  monitorType: MonitorType | undefined,
) => string = (monitorType: MonitorType | undefined): string => {
  if (!monitorType) {
    return "Unknown";
  }

  const typeProps: MonitorTypeProps | undefined =
    MonitorTypeHelper.getAllMonitorTypeProps().find(
      (item: MonitorTypeProps) => {
        return item.monitorType === monitorType;
      },
    );

  return typeProps?.title || monitorType;
};

export interface ComponentProps {
  monitorType: MonitorType | undefined;
}

/*
 * A monitor's type by the name the type picker gives it, in the reader's
 * language: "SSL-Zertifikat", "يدوي". The type's stored value ("Manual",
 * "SSL Certificate") is English, and was what the monitor list's Monitor
 * Type column and the Overview's Details card showed in every language,
 * beside the picker and the Overview's header that already said it in the
 * reader's.
 */
const MonitorTypeTitle: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const title: string = getMonitorTypeTitle(props.monitorType);

  return <span>{translator.translateText(title) || title}</span>;
};

export default MonitorTypeTitle;

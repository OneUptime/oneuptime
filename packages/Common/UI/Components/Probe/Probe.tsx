import { FILE_URL } from "../../Config";
import Icon from "../Icon/Icon";
import Image from "../Image/Image";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import URL from "../../../Types/API/URL";
import IconProp from "../../../Types/Icon/IconProp";
import { JSONObject } from "../../../Types/JSON";
import Probe from "../../../Models/DatabaseModels/Probe";
import { Translator } from "../../Utils/TranslateTemplate";
import useTranslator from "../../Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";
import IsolatedLine from "../IsolatedText/IsolatedLine";

export interface ComponentProps {
  probe?: Probe | JSONObject | undefined | null;
  suffix?: string | undefined;
}

const ProbeElement: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  let probe: JSONObject | null | undefined = null;

  if (props.probe instanceof Probe) {
    probe = BaseModel.toJSONObject(props.probe, Probe);
  } else {
    probe = props.probe;
  }

  if (!probe) {
    return (
      <div className="flex">
        <div className="bold" data-testid="probe-not-found">
          {translator.translateText("No probe found.")}
        </div>
      </div>
    );
  }

  const name: string = probe["name"]?.toString() || "";

  return (
    <div className="flex">
      <div>
        {props.probe?.iconFileId && (
          <Image
            className="h-6 w-6 rounded-full"
            data-testid="probe-image"
            imageUrl={URL.fromString(FILE_URL.toString()).addRoute(
              "/image/" + props.probe?.iconFileId.toString(),
            )}
            alt={probe["name"]?.toString() || translator.translateText("Probe")}
          />
        )}
        {!props.probe?.iconFileId && (
          <Icon
            data-testid="probe-icon"
            icon={IconProp.Signal}
            className="text-gray-400 group-hover:text-gray-500 flex-shrink-0 -ml-0.5 mt-0.5 h-6 w-6"
          />
        )}
      </div>
      <div className="mt-1 mr-1 ml-3 min-w-0">
        {/*
         * Its name reads the way it is written, and where its box is too
         * narrow for it - a table's cell - it is cut short at its own end
         * (IsolatedLine): an English probe name on an Arabic page lost its
         * start ("gapore office behind the corporate proxy"), with no "..."
         * to say so. It wraps wherever its line may.
         */}
        <IsolatedLine
          text={name}
          className="overflow-hidden text-ellipsis"
          dataTestId="probe-name"
        >
          {`${name} ${props.suffix || ""}`}
        </IsolatedLine>
      </div>
    </div>
  );
};

export default ProbeElement;

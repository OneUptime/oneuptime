import { FILE_URL } from "../../Config";
import Icon from "../Icon/Icon";
import Image from "../Image/Image";
import BaseModel from "Common/Models/BaseModel";
import URL from "Common/Types/API/URL";
import IconProp from "Common/Types/Icon/IconProp";
import { JSONObject } from "Common/Types/JSON";
import Probe from "Common/AppModels/Models/Probe";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  probe?: Probe | JSONObject | undefined | null;
  suffix?: string | undefined;
}

const ProbeElement: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
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
          No probe found.
        </div>
      </div>
    );
  }

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
            alt={probe["name"]?.toString() || "Probe"}
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
      <div className="mt-1 mr-1 ml-3">
        <div>
          <span data-testid="probe-name">{`${
            (probe["name"]?.toString() as string) || ""
          } ${props.suffix || ""}`}</span>{" "}
        </div>
      </div>
    </div>
  );
};

export default ProbeElement;

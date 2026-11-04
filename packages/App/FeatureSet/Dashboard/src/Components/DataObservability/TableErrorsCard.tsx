import AppLink from "../AppLink/AppLink";
import DataObservabilityApi from "./DataObservabilityApi";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import OneUptimeDate from "Common/Types/Date";
import {
  DataObservabilityTableErrorException,
  DataObservabilityTableErrorLog,
  DataObservabilityTableErrors,
} from "Common/Types/DataObservability/DataObservabilityApiTypes";
import ObjectID from "Common/Types/ObjectID";
import Card from "Common/UI/Components/Card/Card";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";

export interface ComponentProps {
  dataAssetId: ObjectID;
}

/*
 * The open exceptions and last day's error logs of the services that write this
 * table, that mention it by name. When a table stops changing, this is the
 * writer saying why. With none, it shows nothing.
 */
const TableErrorsCard: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const [errors, setErrors] = useState<DataObservabilityTableErrors | null>(
    null,
  );

  useEffect(() => {
    let isCurrent: boolean = true;

    DataObservabilityApi.getTableErrors(props.dataAssetId)
      .then((found: DataObservabilityTableErrors): void => {
        if (isCurrent) {
          setErrors(found);
        }
      })
      .catch((): void => {
        // Extra to the page it is on: when it cannot be read, the page carries on without it.
      });

    return () => {
      isCurrent = false;
    };
  }, [props.dataAssetId.toString()]);

  if (!errors || (errors.exceptions.length === 0 && errors.logs.length === 0)) {
    return <></>;
  }

  return (
    <Card
      title="Errors Naming This Table"
      description="Open exceptions and the last day's error logs from the services that write this table."
    >
      <div className="space-y-4 px-6 pb-6 text-sm">
        {errors.exceptions.length > 0 ? (
          <ul className="divide-y divide-gray-100">
            {errors.exceptions.map(
              (
                exception: DataObservabilityTableErrorException,
              ): ReactElement => {
                return (
                  <li key={exception.id} className="py-2">
                    <AppLink
                      className="font-medium text-gray-900 hover:underline"
                      to={RouteUtil.populateRouteParams(
                        RouteMap[PageMap.EXCEPTIONS_VIEW] as Route,
                        { modelId: new ObjectID(exception.id) },
                      )}
                    >
                      {exception.type || exception.message}
                    </AppLink>
                    <p className="truncate text-xs text-gray-600">
                      {exception.message}
                    </p>
                    <p className="text-xs text-gray-500">
                      {exception.serviceName}
                      {" · "}
                      {translator.translatePlural(
                        {
                          one: "{{count}} time",
                          other: "{{count}} times",
                        },
                        exception.count,
                      )}
                      {exception.lastSeenAt
                        ? ` · ${OneUptimeDate.fromNow(
                            OneUptimeDate.fromString(exception.lastSeenAt),
                          )}`
                        : ""}
                    </p>
                  </li>
                );
              },
            )}
          </ul>
        ) : (
          <></>
        )}
        {errors.logs.length > 0 ? (
          <ul className="divide-y divide-gray-100">
            {errors.logs.map(
              (
                log: DataObservabilityTableErrorLog,
                index: number,
              ): ReactElement => {
                return (
                  <li key={index} className="py-2">
                    <p className="truncate font-mono text-xs text-gray-800">
                      {log.body}
                    </p>
                    <p className="text-xs text-gray-500">
                      {log.serviceName}
                      {" · "}
                      {OneUptimeDate.fromNow(
                        OneUptimeDate.fromString(log.time),
                      )}
                    </p>
                  </li>
                );
              },
            )}
          </ul>
        ) : (
          <></>
        )}
      </div>
    </Card>
  );
};

export default TableErrorsCard;

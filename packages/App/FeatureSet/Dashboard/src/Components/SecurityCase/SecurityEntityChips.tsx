import AppLink from "../AppLink/AppLink";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import {
  SecurityEntity,
  getSecurityEntityIcon,
  readSecurityEntities,
} from "Common/Types/SecurityCase/SecurityEntity";

import Icon from "Common/UI/Components/Icon/Icon";
import IsolatedText from "Common/UI/Components/IsolatedText/IsolatedText";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";

// Read where the chips are drawn: Common/Types/SecurityCase/SecurityEntity.
export { readSecurityEntities };

/*
 * Where an entity is investigated: the correlation graph, seeded with it -
 * over the hours a page that read its activity read (Look Up an Entity's 30
 * days), or Correlate's own window when it read none.
 */
export function getCorrelateRouteForEntity(
  value: string,
  hours?: number | undefined,
): Route {
  return (
    RouteUtil.populateRouteParams(
      RouteMap[PageMap.SECURITY_EVENTS_CORRELATE] as Route,
    ) as Route
  ).addQueryParams({
    observable: encodeURIComponent(value),
    ...(hours !== undefined && Number.isInteger(hours) && hours > 0
      ? { hours: String(hours) }
      : {}),
  });
}

export interface SecurityEntityChipProps {
  entity: SecurityEntity;
  // A count shown after the value, e.g. events seen in the last day.
  trailing?: ReactElement | string | undefined;
  isLink?: boolean | undefined;
  /*
   * Let a long value run onto a second line rather than cut it short or
   * widen what holds it: a table column on a phone that has to leave room
   * for the columns beside it (a case's Entities page).
   */
  isValueWrapped?: boolean | undefined;
}

/*
 * A value cut short to its line, or, wrapped, broken where it must be. The
 * value is someone's data, in an isolate that reads the way it is written
 * (IsolatedText): on a Persian page an account or a host is cut at its own
 * end - "k.morgan@acme-comm..." - not at its start.
 */
export const SECURITY_ENTITY_CHIP_VALUE_CLASS_NAME: string =
  "truncate font-mono";
export const SECURITY_ENTITY_CHIP_WRAPPED_VALUE_CLASS_NAME: string =
  "min-w-0 font-mono [overflow-wrap:anywhere]";

export const SecurityEntityChip: FunctionComponent<SecurityEntityChipProps> = (
  props: SecurityEntityChipProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const title: string =
    props.isLink === false
      ? props.entity.value
      : translator.translateTemplate(
          "{{type}}: {{value}} - open it in Correlate",
          {
            type:
              translator.translateText(props.entity.type) || props.entity.type,
            value: props.entity.value,
          },
        );

  const content: ReactElement = (
    <>
      <Icon
        icon={getSecurityEntityIcon(props.entity.type)}
        className="h-3.5 w-3.5 flex-shrink-0 text-gray-400 group-hover:text-indigo-500"
      />
      <IsolatedText
        text={props.entity.value}
        className={
          props.isValueWrapped
            ? SECURITY_ENTITY_CHIP_WRAPPED_VALUE_CLASS_NAME
            : SECURITY_ENTITY_CHIP_VALUE_CLASS_NAME
        }
        title={title}
      />
      {props.trailing !== undefined ? (
        <span className="ml-0.5 flex-shrink-0 rounded bg-gray-100 px-1 text-[10px] font-semibold text-gray-600">
          {props.trailing}
        </span>
      ) : (
        <></>
      )}
    </>
  );

  const className: string =
    "group inline-flex max-w-full items-center gap-1.5 rounded-md border border-gray-200 bg-white px-2 py-0.5 text-xs text-gray-700";

  if (props.isLink === false) {
    return <span className={className}>{content}</span>;
  }

  return (
    <AppLink
      to={getCorrelateRouteForEntity(props.entity.value)}
      className={`${className} hover:border-indigo-300 hover:bg-indigo-50 hover:text-indigo-700`}
    >
      {content}
    </AppLink>
  );
};

export interface SecurityEntityChipsProps {
  entities: Array<SecurityEntity>;
  // Show at most this many, then "+N more".
  limit?: number | undefined;
  emptyText?: string | undefined;
  isLink?: boolean | undefined;
}

const SecurityEntityChips: FunctionComponent<SecurityEntityChipsProps> = (
  props: SecurityEntityChipsProps,
): ReactElement => {
  const translator: Translator = useTranslator();

  if (props.entities.length === 0) {
    return (
      <span className="text-sm text-gray-400">
        {translator.translateText(props.emptyText || "No entities")}
      </span>
    );
  }

  const limit: number = props.limit || props.entities.length;
  const shown: Array<SecurityEntity> = props.entities.slice(0, limit);
  const hidden: number = props.entities.length - shown.length;

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {shown.map((entity: SecurityEntity, index: number): ReactElement => {
        return (
          <SecurityEntityChip
            key={`${entity.type}-${entity.value}-${index}`}
            entity={entity}
            isLink={props.isLink}
          />
        );
      })}
      {hidden > 0 ? (
        <span className="text-xs font-medium text-gray-500">
          {translator.translatePlural(
            { one: "+{{count}} more", other: "+{{count}} more" },
            hidden,
          )}
        </span>
      ) : (
        <></>
      )}
    </div>
  );
};

export default SecurityEntityChips;

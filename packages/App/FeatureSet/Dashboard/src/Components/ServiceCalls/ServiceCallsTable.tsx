import AppLink from "../AppLink/AppLink";
import {
  SERVICE_CALLS_FIGURE_CELL_CLASS_NAME,
  SERVICE_CALLS_FIGURE_HEADER_CLASS_NAME,
  SERVICE_CALLS_FOOTER_CLASS_NAME,
  SERVICE_CALLS_GRID_CLASS_NAME,
  SERVICE_CALLS_HEADER_CLASS_NAME,
  SERVICE_CALLS_NAME_CELL_CLASS_NAME,
  SERVICE_CALLS_NAME_HEADER_CLASS_NAME,
  SERVICE_CALLS_ROW_CLASS_NAME,
  SERVICE_CALLS_TABLE_CLASS_NAME,
} from "./ServiceCallsTableLayout";
import Route from "Common/Types/API/Route";
import IsolatedText from "Common/UI/Components/IsolatedText/IsolatedText";
import { Translator, translationKey } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * The services that call a database, or publish to or consume from a
 * queue, busiest first: each service's name, how many calls, its error
 * rate and its p95 - the Databases product's "Calling services" card and a
 * queue's Producers and Consumers. One table for all three, laid out by its
 * own width (ServiceCallsTableLayout): each figure's column as wide as its
 * name and values need, the service's name in what they leave, and on a
 * phone each service on two lines.
 */

export interface ServiceCallsTableRow {
  serviceId: string;
  // Its Service's name; null when nothing names it, and its id is shown.
  name: string | null;
  // The service's page, for a named one.
  route?: Route | undefined;
  // The figures, written for the reader (formatted by the card).
  calls: string;
  errorRate: string;
  duration: string;
}

export interface ComponentProps {
  rows: Array<ServiceCallsTableRow>;
  // The count's and the duration's column names, as English keys.
  countHeader: string;
  durationHeader: string;
  // Under the table when it leaves services out, in the reader's language.
  footer?: string | undefined;
  dataTestId?: string | undefined;
  rowTestId: string;
  footerTestId: string;
}

export const SERVICE_CALLS_NAME_HEADER: string = translationKey("Service");

export const SERVICE_CALLS_ERRORS_HEADER: string = translationKey("Errors");

const ServiceCallsTable: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();

  return (
    <div
      data-testid={props.dataTestId}
      className={SERVICE_CALLS_TABLE_CLASS_NAME}
    >
      <div role="table" className={SERVICE_CALLS_GRID_CLASS_NAME}>
        <div role="row" className={SERVICE_CALLS_HEADER_CLASS_NAME}>
          <div
            role="columnheader"
            className={SERVICE_CALLS_NAME_HEADER_CLASS_NAME}
          >
            {translator.translateText(SERVICE_CALLS_NAME_HEADER)}
          </div>
          {[
            props.countHeader,
            SERVICE_CALLS_ERRORS_HEADER,
            props.durationHeader,
          ].map((header: string): ReactElement => {
            return (
              <div
                key={header}
                role="columnheader"
                className={SERVICE_CALLS_FIGURE_HEADER_CLASS_NAME}
              >
                {translator.translateText(header)}
              </div>
            );
          })}
        </div>
        {props.rows.map((row: ServiceCallsTableRow): ReactElement => {
          const shownName: string = row.name || row.serviceId;

          return (
            <div
              key={row.serviceId}
              role="row"
              data-testid={props.rowTestId}
              data-service-id={row.serviceId}
              className={SERVICE_CALLS_ROW_CLASS_NAME}
            >
              <div
                role="rowheader"
                className={SERVICE_CALLS_NAME_CELL_CLASS_NAME}
                title={shownName}
              >
                {row.name && row.route ? (
                  <AppLink
                    to={row.route}
                    className="font-medium text-gray-900 hover:underline"
                  >
                    <IsolatedText text={row.name} />
                  </AppLink>
                ) : (
                  <span className="font-mono text-gray-500">{shownName}</span>
                )}
              </div>
              <div role="cell" className={SERVICE_CALLS_FIGURE_CELL_CLASS_NAME}>
                {row.calls}
              </div>
              <div role="cell" className={SERVICE_CALLS_FIGURE_CELL_CLASS_NAME}>
                {row.errorRate}
              </div>
              <div role="cell" className={SERVICE_CALLS_FIGURE_CELL_CLASS_NAME}>
                {row.duration}
              </div>
            </div>
          );
        })}
      </div>
      {props.footer ? (
        <div
          data-testid={props.footerTestId}
          className={SERVICE_CALLS_FOOTER_CLASS_NAME}
        >
          {props.footer}
        </div>
      ) : (
        <></>
      )}
    </div>
  );
};

export default ServiceCallsTable;

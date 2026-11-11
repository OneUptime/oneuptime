import React, { FunctionComponent, ReactElement } from "react";
import Route from "Common/Types/API/Route";
import IconProp from "Common/Types/Icon/IconProp";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import Card from "Common/UI/Components/Card/Card";
import Icon from "Common/UI/Components/Icon/Icon";
import Navigation from "Common/UI/Utils/Navigation";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { Translator, translationKey } from "Common/UI/Utils/TranslateTemplate";
import AppLink from "../AppLink/AppLink";
import {
  CLOUD_APP_SETUP_DESCRIPTION,
  CLOUD_APP_SETUP_GUIDE,
  CLOUD_APP_SETUP_TITLE,
  CloudAppSetupRow,
  CloudAppSetupRowKey,
  CloudAppSetupTone,
} from "../../Pages/AppPlatforms/Utils/CloudAppTelemetrySetup";

/*
 * The top of an App Platforms app's Overview while some number on it waits
 * for something the app does not send (issue #6770): what arrives from the
 * app, kind by kind - traces, metrics, logs - whether its telemetry names
 * its instances and its version, and for an App Service app whether Azure
 * Monitor measures its site. Each row that is missing says what it gives
 * and how to send it; the setup guide is one click away.
 *
 * Laid out as a RUM application's Setup check is (RumSetupCheckCard): a row
 * is a label and its state, side by side once the card is wide enough, one
 * under the other on a phone; the same icons in the same colours. Built by
 * getCloudAppSetupRows, so every row's words are tested without it.
 */

export const CLOUD_APP_CONNECT_AZURE: string = translationKey(
  "Connect a cloud account",
);

interface ToneStyle {
  icon: IconProp;
  className: string;
}

export const CLOUD_APP_SETUP_TONES: Record<CloudAppSetupTone, ToneStyle> = {
  ok: { icon: IconProp.CheckCircle, className: "text-emerald-600" },
  warning: { icon: IconProp.Alert, className: "text-amber-500" },
  off: { icon: IconProp.MinusCircle, className: "text-gray-400" },
  waiting: { icon: IconProp.Clock, className: "text-gray-400" },
};

const ACTION_CLASS_NAME: string =
  "mt-1.5 inline-flex items-center gap-1 rounded-sm text-sm font-medium text-indigo-600 hover:text-indigo-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2";

export interface ComponentProps {
  rows: Array<CloudAppSetupRow>;
  // The environment's setup guide (its Documentation tab).
  guideRoute: Route;
  // Cloud > Connect, for the Azure Monitor row of an App Service app.
  connectRoute?: Route | undefined;
}

const SetupRow: FunctionComponent<{
  row: CloudAppSetupRow;
  connectRoute?: Route | undefined;
}> = (props: {
  row: CloudAppSetupRow;
  connectRoute?: Route | undefined;
}): ReactElement => {
  const translator: Translator = useTranslator();
  const tone: ToneStyle = CLOUD_APP_SETUP_TONES[props.row.tone];
  const testId: string = `cloud-app-setup-${props.row.key}`;
  const showsConnect: boolean = Boolean(
    props.connectRoute &&
      props.row.key === CloudAppSetupRowKey.AzureMonitor &&
      props.row.tone === "off",
  );

  return (
    <li
      className="min-w-0 py-3 first:pt-0 last:pb-0 [@container(min-width:40rem)]:flex [@container(min-width:40rem)]:items-start [@container(min-width:40rem)]:gap-4"
      data-testid={testId}
      data-tone={props.row.tone}
    >
      <div className="min-w-0 text-sm font-medium text-gray-900 [@container(min-width:40rem)]:w-48 [@container(min-width:40rem)]:flex-none">
        {props.row.label}
      </div>
      <div className="mt-1 flex min-w-0 items-start gap-2 [@container(min-width:40rem)]:mt-0 [@container(min-width:40rem)]:flex-1">
        <div className="mt-0.5 flex-shrink-0" aria-hidden={true}>
          <Icon icon={tone.icon} className={`h-4 w-4 ${tone.className}`} />
        </div>
        <div className="min-w-0">
          <div
            className="break-words text-sm text-gray-900"
            data-testid={`${testId}-text`}
          >
            {props.row.text}
          </div>
          {props.row.hint ? (
            <div
              className="mt-0.5 break-words text-sm text-gray-500"
              data-testid={`${testId}-hint`}
            >
              {props.row.hint}
            </div>
          ) : (
            <></>
          )}
          {showsConnect && props.connectRoute ? (
            <AppLink
              to={props.connectRoute}
              className={ACTION_CLASS_NAME}
              dataTestId={`${testId}-action`}
            >
              <span>
                {translator.translateText(CLOUD_APP_CONNECT_AZURE) ||
                  CLOUD_APP_CONNECT_AZURE}
              </span>
              <Icon
                icon={IconProp.ChevronRight}
                className="h-4 w-4"
              />
            </AppLink>
          ) : (
            <></>
          )}
        </div>
      </div>
    </li>
  );
};

const CloudAppSetupCheckCard: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();

  return (
    <div className="mb-6" data-testid="cloud-app-setup-check">
      <Card
        title={CLOUD_APP_SETUP_TITLE}
        description={CLOUD_APP_SETUP_DESCRIPTION}
        buttons={[
          {
            title: CLOUD_APP_SETUP_GUIDE,
            icon: IconProp.Book,
            buttonStyle: ButtonStyleType.NORMAL,
            onClick: () => {
              Navigation.navigate(props.guideRoute);
            },
          },
        ]}
      >
        {/* The card's width, for the rows' side-by-side layout. */}
        <div className="[container-type:inline-size]">
          <ul
            className="divide-y divide-gray-100"
            aria-label={
              translator.translateText(CLOUD_APP_SETUP_TITLE) ||
              CLOUD_APP_SETUP_TITLE
            }
          >
            {props.rows.map((row: CloudAppSetupRow): ReactElement => {
              return (
                <SetupRow
                  key={row.key}
                  row={row}
                  connectRoute={props.connectRoute}
                />
              );
            })}
          </ul>
        </div>
      </Card>
    </div>
  );
};

export default CloudAppSetupCheckCard;

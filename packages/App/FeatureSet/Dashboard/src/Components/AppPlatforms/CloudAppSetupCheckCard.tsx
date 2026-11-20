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
  CLOUD_APP_SETUP_ACTION_LABELS,
  CLOUD_APP_SETUP_DESCRIPTION,
  CLOUD_APP_SETUP_GUIDE,
  CLOUD_APP_SETUP_TITLE,
  CloudAppSetupAction,
  CloudAppSetupRow,
  CloudAppSetupTone,
} from "../../Pages/AppPlatforms/Utils/CloudAppTelemetrySetup";

/*
 * The top of an App Platforms app's Overview while some signal on it is
 * missing (#6770, #10294): each signal on a row of its own - for an App
 * Service app the Azure Monitor connection and its metrics first, then
 * traces, OpenTelemetry metrics, logs, instances and revision - with its
 * status (Received, Not received, Needs setup), when it last came, and for
 * what is missing what to do: a link to connect the subscription, to see
 * the connections, or to the steps that send traces and logs.
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
  setup: { icon: IconProp.Wrench, className: "text-amber-500" },
  off: { icon: IconProp.MinusCircle, className: "text-gray-400" },
  waiting: { icon: IconProp.Clock, className: "text-gray-400" },
};

const ACTION_CLASS_NAME: string =
  "mt-1.5 inline-flex items-center gap-1 rounded-sm text-sm font-medium text-indigo-600 hover:text-indigo-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2";

export interface ComponentProps {
  rows: Array<CloudAppSetupRow>;
  // The setup guide: the environment's Documentation tab, or the app's own steps.
  guideRoute?: Route | undefined;
  onOpenGuide?: (() => void) | undefined;
  // Cloud > Connect, for the Azure Monitor connection's row.
  connectRoute?: Route | undefined;
  // The steps that send the app's traces, metrics and logs, when the page has them.
  onSetUpTelemetry?: (() => void) | undefined;
}

const RowAction: FunctionComponent<{
  action: CloudAppSetupAction;
  testId: string;
  connectRoute?: Route | undefined;
  onSetUpTelemetry?: (() => void) | undefined;
}> = (props: {
  action: CloudAppSetupAction;
  testId: string;
  connectRoute?: Route | undefined;
  onSetUpTelemetry?: (() => void) | undefined;
}): ReactElement => {
  const translator: Translator = useTranslator();
  const label: string = CLOUD_APP_SETUP_ACTION_LABELS[props.action];
  const words: ReactElement = (
    <>
      <span>{translator.translateText(label) || label}</span>
      <Icon icon={IconProp.ChevronRight} className="h-4 w-4" />
    </>
  );

  if (props.action === CloudAppSetupAction.SetUpTelemetry) {
    if (!props.onSetUpTelemetry) {
      return <></>;
    }

    return (
      <button
        type="button"
        className={ACTION_CLASS_NAME}
        onClick={props.onSetUpTelemetry}
        data-testid={`${props.testId}-action`}
      >
        {words}
      </button>
    );
  }

  if (!props.connectRoute) {
    return <></>;
  }

  return (
    <AppLink
      to={props.connectRoute}
      className={ACTION_CLASS_NAME}
      dataTestId={`${props.testId}-action`}
    >
      {words}
    </AppLink>
  );
};

const SetupRow: FunctionComponent<{
  row: CloudAppSetupRow;
  connectRoute?: Route | undefined;
  onSetUpTelemetry?: (() => void) | undefined;
}> = (props: {
  row: CloudAppSetupRow;
  connectRoute?: Route | undefined;
  onSetUpTelemetry?: (() => void) | undefined;
}): ReactElement => {
  const tone: ToneStyle = CLOUD_APP_SETUP_TONES[props.row.tone];
  const testId: string = `cloud-app-setup-${props.row.key}`;

  return (
    <li
      className="min-w-0 py-3 first:pt-0 last:pb-0 [@container(min-width:40rem)]:flex [@container(min-width:40rem)]:items-start [@container(min-width:40rem)]:gap-4"
      data-testid={testId}
      data-tone={props.row.tone}
      data-status={props.row.status}
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
            className="text-sm font-medium text-gray-900"
            data-testid={`${testId}-status`}
          >
            {props.row.statusLabel}
          </div>
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
          {props.row.action ? (
            <RowAction
              action={props.row.action}
              testId={testId}
              connectRoute={props.connectRoute}
              onSetUpTelemetry={props.onSetUpTelemetry}
            />
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
  const openGuide: (() => void) | undefined =
    props.onOpenGuide ||
    (props.guideRoute
      ? (): void => {
          Navigation.navigate(props.guideRoute as Route);
        }
      : undefined);

  return (
    <div className="mb-6" data-testid="cloud-app-setup-check">
      <Card
        title={CLOUD_APP_SETUP_TITLE}
        description={CLOUD_APP_SETUP_DESCRIPTION}
        buttons={
          openGuide
            ? [
                {
                  title: CLOUD_APP_SETUP_GUIDE,
                  icon: IconProp.Book,
                  buttonStyle: ButtonStyleType.NORMAL,
                  onClick: openGuide,
                },
              ]
            : []
        }
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
                  onSetUpTelemetry={props.onSetUpTelemetry}
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

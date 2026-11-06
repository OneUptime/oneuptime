import CloudConnection from "Common/Models/DatabaseModels/CloudConnection";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import CopyTextButton from "Common/UI/Components/CopyTextButton/CopyTextButton";
import Icon from "Common/UI/Components/Icon/Icon";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useId,
  useState,
} from "react";
import {
  CLOUD_STREAM_POLL_MS,
  CloudStreamStatus,
  readCloudStreamHostSubscription,
  readCloudStreamStatus,
} from "./CloudConnectApi";
import { drawCloudTemplate } from "./CloudConnectionWords";
import { CloudStreamStatusWords } from "./CloudStreamWords";

/*
 * What the three clouds' streaming dialogs share (CloudStreamDialog for
 * AWS, CloudStreamAzureDialog, CloudStreamGcpDialog): one test id, so a
 * page or a test finds the dialog whichever cloud it is for; a choice that
 * is on or off; a value to copy for a stream set up another way; the link
 * to the cloud's own shell; the last step, which says what arrived; and
 * the watch behind it, which asks every few seconds while the dialog is
 * open.
 */

export const CLOUD_STREAM_DIALOG_TEST_ID: string = "cloud-stream";

export const CLOUD_STREAM_INPUT_CLASS_NAME: string =
  "block w-full rounded-md border border-gray-300 px-3 py-2 font-mono text-xs text-gray-900 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500";

/*
 * A step's own button - Make a stream key, Turn on reading - starts where
 * the step's words start. Button keeps a dialog footer's margin (md:ml-3)
 * from md up, which set it 12px in from the sentence above it.
 */
export const CLOUD_STREAM_STEP_BUTTON_CLASS_NAME: string = "md:!ml-0";

/*
 * How tall a command is drawn at most - the setup command in each dialog,
 * and the one Stop streaming hands over - before it scrolls: its copy
 * button takes it all.
 */
export const CLOUD_STREAM_COMMAND_MAX_HEIGHT: string = "240px";

/*
 * A field asked for between the question and the steps - a filter of one's
 * own, the subscriptions of a connection that has read none - in a box of
 * its own, as the answer it belongs to.
 */
export const CLOUD_STREAM_FIELD_BOX_CLASS_NAME: string =
  "space-y-1 rounded-lg border border-gray-200 px-4 py-3";

// A test id of the dialog: "cloud-stream-<name>".
export function cloudStreamPart(name: string): string {
  return `${CLOUD_STREAM_DIALOG_TEST_ID}-${name}`;
}

export interface CheckRowProps {
  label: string;
  description?: string | undefined;
  isChecked: boolean;
  onChange: (value: boolean) => void;
  dataTestId: string;
}

// A choice that is on or off, its line under it - as Let AI fix problems has.
export const CloudStreamCheckRow: FunctionComponent<CheckRowProps> = (
  props: CheckRowProps,
): ReactElement => {
  const descriptionId: string = `${props.dataTestId}-description-${useId()}`;

  return (
    <div>
      <label className="flex items-start gap-2 text-sm text-gray-800">
        <input
          type="checkbox"
          className="mt-0.5 h-4 w-4 flex-shrink-0 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
          checked={props.isChecked}
          data-testid={props.dataTestId}
          aria-describedby={props.description ? descriptionId : undefined}
          onChange={(event: React.ChangeEvent<HTMLInputElement>) => {
            props.onChange(event.target.checked);
          }}
        />
        <span className="min-w-0">{props.label}</span>
      </label>
      {props.description ? (
        <p id={descriptionId} className="mt-0.5 ps-6 text-xs text-gray-500">
          {props.description}
        </p>
      ) : (
        <></>
      )}
    </div>
  );
};

export interface CopyRowProps {
  label: string;
  value: string;
  dataTestId: string;
}

// One value to copy for a stream set up another way: its name, and it.
export const CloudStreamCopyRow: FunctionComponent<CopyRowProps> = (
  props: CopyRowProps,
): ReactElement => {
  return (
    <div className="min-w-0" data-testid={props.dataTestId}>
      <p className="text-xs font-medium text-gray-700">{props.label}</p>
      <div className="mt-1 flex items-center gap-2">
        <code
          dir="ltr"
          className="min-w-0 flex-1 break-all rounded-md bg-gray-50 px-2 py-1.5 font-mono text-xs text-gray-900"
        >
          {props.value}
        </code>
        <CopyTextButton
          textToBeCopied={props.value}
          iconOnly={true}
          size="sm"
          variant="ghost"
          title={props.label}
        />
      </div>
    </div>
  );
};

export interface ShellLinkProps {
  shell: { title: string; url: string };
}

// The cloud's own shell, where the command runs: its name kept on one line.
export const CloudStreamShellLink: FunctionComponent<ShellLinkProps> = (
  props: ShellLinkProps,
): ReactElement => {
  const translator: Translator = useTranslator();

  return (
    <a
      href={props.shell.url}
      target="_blank"
      rel="noopener noreferrer"
      data-testid={cloudStreamPart("open-shell")}
      className="inline-flex flex-shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-md bg-indigo-600 px-3 py-2 text-sm font-medium text-white shadow-sm hover:bg-indigo-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2"
    >
      <Icon icon={IconProp.Terminal} className="h-4 w-4" />
      <span>
        {translator.translateTemplate("Open {{shell}}", {
          shell: props.shell.title,
        })}
      </span>
      <Icon icon={IconProp.ExternalLink} className="h-3.5 w-3.5" />
    </a>
  );
};

export interface NoticeProps {
  // In the reader's language already.
  text: string;
  dataTestId: string;
}

// Something to set right first - the connection is turned off, say.
export const CloudStreamNotice: FunctionComponent<NoticeProps> = (
  props: NoticeProps,
): ReactElement => {
  return (
    <div
      className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900"
      data-testid={props.dataTestId}
    >
      <Icon
        icon={IconProp.Alert}
        className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-600"
      />
      <span>{props.text}</span>
    </div>
  );
};

export interface WhatItMakesProps {
  // In the reader's language already.
  text: string;
}

// What the command makes, and what it costs, under it.
export const CloudStreamWhatItMakes: FunctionComponent<WhatItMakesProps> = (
  props: WhatItMakesProps,
): ReactElement => {
  return (
    <div
      className="flex items-start gap-1.5 border-t border-gray-200 pt-3 text-xs text-gray-500"
      data-testid={cloudStreamPart("what-it-makes")}
    >
      <Icon
        icon={IconProp.ShieldCheck}
        className="mt-px h-3.5 w-3.5 flex-shrink-0"
      />
      <span>{props.text}</span>
    </div>
  );
};

export interface LiveStepProps {
  // How the stream is doing, or null while it streams nothing.
  live: CloudStreamStatusWords | null;
  // A key was made, or reading was turned on.
  isOn: boolean;
  // What arrived, one line a place, in the reader's language.
  sources: Array<string>;
  // What to do first, in the reader's language, while it is not on.
  offSentence: string;
}

/*
 * The last step: what arrived and from where, why it was refused, or what
 * to wait for - said politely to a screen reader as it changes.
 */
export const CloudStreamLiveStep: FunctionComponent<LiveStepProps> = (
  props: LiveStepProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const live: CloudStreamStatusWords | null = props.live;

  if (!props.isOn || !live) {
    return (
      <p
        className="text-sm text-gray-500"
        data-testid={cloudStreamPart("live")}
        data-state="no-key"
      >
        {props.offSentence}
      </p>
    );
  }

  if (live.state === "receiving") {
    return (
      <div
        className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3"
        role="status"
        aria-live="polite"
        data-testid={cloudStreamPart("live")}
        data-state="receiving"
      >
        <div className="flex items-start gap-3">
          <Icon
            icon={IconProp.CheckCircle}
            className="mt-0.5 h-4 w-4 flex-shrink-0 text-emerald-600"
          />
          <div className="min-w-0 space-y-1">
            <p className="text-sm text-emerald-900">
              {drawCloudTemplate(translator, live.sentence)}
            </p>
            {props.sources.length > 0 ? (
              <ul
                className="space-y-0.5 text-xs text-emerald-800"
                data-testid={cloudStreamPart("sources")}
              >
                {props.sources.map((source: string): ReactElement => {
                  return <li key={source}>{source}</li>;
                })}
              </ul>
            ) : (
              <></>
            )}
          </div>
        </div>
      </div>
    );
  }

  if (live.state === "refused") {
    return (
      <div
        className="flex items-start gap-3 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3"
        role="status"
        aria-live="polite"
        data-testid={cloudStreamPart("live")}
        data-state="refused"
      >
        <Icon
          icon={IconProp.Alert}
          className="mt-0.5 h-4 w-4 flex-shrink-0 text-rose-600"
        />
        <p className="text-sm text-rose-900">
          {drawCloudTemplate(translator, live.sentence)}
        </p>
      </div>
    );
  }

  return (
    <div
      className="flex items-center gap-3 rounded-lg border border-gray-200 bg-gray-50 px-4 py-3"
      role="status"
      aria-live="polite"
      data-testid={cloudStreamPart("live")}
      data-state={live.state}
    >
      {live.state === "waiting" ? (
        <span className="relative flex h-2.5 w-2.5 flex-shrink-0">
          {/* The dot's own indigo: a mid-tone reads the same in the dark theme. */}
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-indigo-500 opacity-75 motion-reduce:animate-none" />
          <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-indigo-500" />
        </span>
      ) : (
        <Icon
          icon={IconProp.Clock}
          className="h-4 w-4 flex-shrink-0 text-gray-400"
        />
      )}
      <p className="text-sm text-gray-700">
        {drawCloudTemplate(translator, live.sentence)}
      </p>
    </div>
  );
};

export interface CloudStreamWatch {
  status: CloudStreamStatus;
  setStatus: React.Dispatch<React.SetStateAction<CloudStreamStatus>>;
  // Moves on with every answer, so "a minute ago" stays true.
  now: Date;
}

// The connection's stream as the list read it.
export function getCloudStreamStatusOf(
  connection: CloudConnection,
): CloudStreamStatus {
  return {
    streamKeyCreatedAt: connection.streamKeyCreatedAt
      ? new Date(connection.streamKeyCreatedAt)
      : null,
    streamSummary: connection.streamSummary || null,
    hostSubscriptionId: readCloudStreamHostSubscription(connection.streamState),
  };
}

/*
 * While a streaming dialog is open, ask every few seconds what arrived -
 * and stop asking once it is closed.
 */
export function useCloudStreamWatch(
  connection: CloudConnection,
): CloudStreamWatch {
  const [status, setStatus] = useState<CloudStreamStatus>(() => {
    return getCloudStreamStatusOf(connection);
  });
  const [now, setNow] = useState<Date>(() => {
    return new Date();
  });
  const connectionId: string = connection.id?.toString() || "";

  useEffect(() => {
    if (!connection.id) {
      return undefined;
    }

    const id: ObjectID = connection.id;
    let isCurrent: boolean = true;

    const interval: ReturnType<typeof setInterval> = setInterval(() => {
      readCloudStreamStatus(id)
        .then((read: CloudStreamStatus | null) => {
          if (!isCurrent) {
            return;
          }

          if (read) {
            setStatus(read);
          }

          setNow(new Date());
        })
        .catch(() => {
          // Asked again at the next tick.
        });
    }, CLOUD_STREAM_POLL_MS);

    return () => {
      isCurrent = false;
      clearInterval(interval);
    };
  }, [connectionId]);

  return { status, setStatus, now };
}

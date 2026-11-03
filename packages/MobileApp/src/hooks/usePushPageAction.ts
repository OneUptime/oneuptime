import { useEffect, useRef, type MutableRefObject } from "react";
import { Alert } from "react-native";
import {
  getPushPageAnswer,
  isPushPageActionRequest,
  type PushPageActionRequest,
  type PushPageAnswer,
  type PushPageRecordState,
} from "../oncall/pushPageAction";

/*
 * A push's Acknowledge or Escalate, done on the record's screen
 * (oncall/pushPageAction.ts).
 *
 * The push opens the screen with the action in its params. The screen waits
 * until it knows enough to answer - the record, its states, and the reader's
 * open pages about it - then does the action once, as its own button would,
 * and takes the action out of its params so a re-render, a fold or Back never
 * does it twice. A second tap on another push about the same record, with an
 * id of its own, is a new action.
 */
export interface PushPageActionOptions {
  // The screen's params' `pushAction`: anything that is not a request is ignored.
  request: unknown;
  // Takes the action out of the screen's params.
  clear: () => void;
  // The record, its states and the reader's open pages have all been read.
  ready: boolean;
  state: PushPageRecordState;
  // The record's own Acknowledge.
  acknowledge: () => Promise<void> | void;
  // Acknowledge again, on a page again.
  acknowledgeAgain: () => Promise<void> | void;
  // Escalate's question, as the screen's button asks it.
  askToEscalate: () => void;
}

export function runPushPageAnswer(
  answer: PushPageAnswer,
  handlers: Pick<
    PushPageActionOptions,
    "acknowledge" | "acknowledgeAgain" | "askToEscalate"
  >,
): void {
  switch (answer.kind) {
    case "acknowledge":
      void handlers.acknowledge();
      return;
    case "acknowledgeAgain":
      void handlers.acknowledgeAgain();
      return;
    case "askToEscalate":
      handlers.askToEscalate();
      return;
    case "explain":
      Alert.alert(answer.title, answer.message);
      return;
  }
}

export function usePushPageAction(options: PushPageActionOptions): void {
  const handled: MutableRefObject<Set<string>> = useRef<Set<string>>(
    new Set(),
  );
  // The latest of everything, read when the action runs.
  const latest: MutableRefObject<PushPageActionOptions> =
    useRef<PushPageActionOptions>(options);
  latest.current = options;

  const { request, ready } = options;

  useEffect((): void => {
    if (!ready || !isPushPageActionRequest(request)) {
      return;
    }

    const pushRequest: PushPageActionRequest = request;

    if (handled.current.has(pushRequest.id)) {
      return;
    }

    handled.current.add(pushRequest.id);
    latest.current.clear();
    runPushPageAnswer(
      getPushPageAnswer(pushRequest.kind, latest.current.state),
      latest.current,
    );
  }, [request, ready]);
}

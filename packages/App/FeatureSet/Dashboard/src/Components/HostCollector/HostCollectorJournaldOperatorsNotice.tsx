import HostCollectorConfig from "Common/Models/DatabaseModels/HostCollectorConfig";
import CodeType from "Common/Types/Code/CodeType";
import ObjectID from "Common/Types/ObjectID";
import Alert, { AlertType } from "Common/UI/Components/Alerts/Alert";
import CodeEditor from "Common/UI/Components/CodeEditor/CodeEditor";
import Modal, { ModalWidth } from "Common/UI/Components/Modal/Modal";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import Toast from "Common/UI/Utils/Toast";
import { Translator, translationKey } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { JOURNALD_RECEIVER } from "Common/Utils/HostCollector/HostCollectorDefaultConfig";
import {
  JournaldOperatorsCheck,
  JournaldOperatorsState,
  addJournaldOperators,
  checkJournaldOperators,
} from "Common/Utils/HostCollector/HostCollectorJournaldOperators";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useMemo,
  useState,
} from "react";

/*
 * A COLLECTOR CONFIG WHOSE JOURNALD RECEIVER FILES NO LINE UNDER ITS UNIT
 * SAYS WHAT THAT COSTS, WHERE IT IS EDITED (#10127).
 *
 * OneUptime's default config for Linux sends each journal line under the
 * systemd unit it is about, with systemd's result and exit status for a
 * unit that failed (#9748): a failed unit's page, the host's Systemd Units
 * list and its Needs attention say why it failed from those lines. A
 * Collector Config a project wrote before then has a journald receiver
 * with no operators, and every failed unit on its hosts says its journal
 * does not say why - while nothing said so on the config's own page.
 *
 * Above its config.yaml, the page now says so, with one way on:
 *
 *   - no operators: Add OneUptime's operators shows the config as it will
 *     be, the default's operators under the receiver and nothing else
 *     changed (HostCollectorJournaldOperators), saved as a new version only
 *     when the person presses Save - the hosts get it within a minute, and
 *     Put back undoes it;
 *   - operators of the project's own that file no line under its unit, or
 *     a receiver the page cannot add to without rewriting it (one written
 *     on one line), or a reader who may not change the config: Show
 *     OneUptime's operators, to copy. A person's own operators are never
 *     rewritten for them.
 *
 * A config that files each line under its unit, reads no journal, or does
 * not read as YAML (its editor says why) shows nothing.
 */

export const JOURNALD_OPERATORS_NOTICE_TITLE: string = translationKey(
  "Failed systemd units can't say why",
);

const MISSING_ONE: string = translationKey(
  "This config's journald receiver has no operators, so its hosts send each journal line as a whole entry, under no unit.",
);
const MISSING_SOME: string = translationKey(
  "Some of this config's journald receivers have no operators, so its hosts send their journal lines as whole entries, under no unit.",
);
const OWN_ONE: string = translationKey(
  "This config's journald receiver has operators of its own, and none of them files a journal line under its unit.",
);
const OWN_SOME: string = translationKey(
  "Some of this config's journald receivers have operators of their own, and none of them files a journal line under its unit.",
);

export const ADD_OPERATORS: string = translationKey(
  "Add OneUptime's operators",
);
export const SHOW_OPERATORS: string = translationKey(
  "Show OneUptime's operators",
);

const ADD_TITLE: string = translationKey("Add OneUptime's journald operators");
const ADD_DESCRIPTION: string = translationKey(
  "They go under each journald receiver that has none, and nothing else changes. Saved, it is a new version its hosts get within a minute.",
);
const SAVE: string = translationKey("Save as New Version");
const ADDED: string = translationKey(
  "Operators added. The hosts get the new version within a minute.",
);
const NOT_ADDED: string = translationKey("The operators were not added.");

const SHOW_TITLE: string = translationKey("OneUptime's journald operators");
const SHOW_DESCRIPTION: string = translationKey(
  "OneUptime's default journald receiver for Linux. Copy its operators into yours, beside your own, to file each journal line under its unit.",
);

const YAML_VIEW_MAX_HEIGHT: string = "min(60vh, 32rem)";

// The default's receiver as a config writes it, from its own key's line.
const DEFAULT_RECEIVER_YAML: string = JOURNALD_RECEIVER.split("\n")
  .map((line: string): string => {
    return line.startsWith("  ") ? line.slice(2) : line;
  })
  .join("\n");

export const JOURNALD_OPERATORS_NOTICE_TEST_ID: string =
  "host-collector-journald-operators";

export interface ComponentProps {
  modelId: ObjectID;
  // The config's YAML as it is now; undefined while it is read.
  configYaml: string | null | undefined;
  // Whether the reader may change the config: only then is Add offered.
  canEdit: boolean;
  // After the operators are saved: the page reads the config again.
  onSaved: () => void;
}

type Shown = "add" | "show" | null;

const HostCollectorJournaldOperatorsNotice: FunctionComponent<
  ComponentProps
> = (props: ComponentProps): ReactElement => {
  const translator: Translator = useTranslator();
  const [shown, setShown] = useState<Shown>(null);
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [error, setError] = useState<string>("");

  const check: JournaldOperatorsCheck = useMemo(() => {
    return checkJournaldOperators(props.configYaml);
  }, [props.configYaml]);

  // The config with the default's operators added, when they can be.
  const withOperators: string | null = useMemo(() => {
    return check.state === JournaldOperatorsState.Missing
      ? addJournaldOperators(props.configYaml)
      : null;
  }, [check.state, props.configYaml]);

  if (
    check.state !== JournaldOperatorsState.Missing &&
    check.state !== JournaldOperatorsState.OwnOperators
  ) {
    return <Fragment />;
  }

  const isMissing: boolean = check.state === JournaldOperatorsState.Missing;
  const isSome: boolean = check.receivers.length > 1;
  const canAdd: boolean = props.canEdit && withOperators !== null;

  const save: () => Promise<void> = async (): Promise<void> => {
    if (!withOperators) {
      return;
    }

    setIsSaving(true);
    setError("");

    try {
      await ModelAPI.updateById<HostCollectorConfig>({
        modelType: HostCollectorConfig,
        id: props.modelId,
        data: {
          configYaml: withOperators,
        },
      });
      setShown(null);
      Toast.success(translator.translateText(ADDED) || ADDED);
      props.onSaved();
    } catch (err) {
      setError(API.getFriendlyMessage(err));
    }

    setIsSaving(false);
  };

  return (
    <Fragment>
      <Alert
        className="mb-5"
        type={AlertType.WARNING}
        strongTitle={JOURNALD_OPERATORS_NOTICE_TITLE}
        title={
          isMissing
            ? isSome
              ? MISSING_SOME
              : MISSING_ONE
            : isSome
              ? OWN_SOME
              : OWN_ONE
        }
        textOnRight={canAdd ? ADD_OPERATORS : SHOW_OPERATORS}
        dataTestId={JOURNALD_OPERATORS_NOTICE_TEST_ID}
        onClick={() => {
          setError("");
          setShown(canAdd ? "add" : "show");
        }}
      />

      {shown === "add" && withOperators ? (
        <Modal
          title={ADD_TITLE}
          description={ADD_DESCRIPTION}
          modalWidth={ModalWidth.Large}
          onClose={() => {
            setShown(null);
            setError("");
          }}
          submitButtonText={SAVE}
          onSubmit={() => {
            void save();
          }}
          isLoading={isSaving}
          error={error || undefined}
          errorWhatFailed={translator.translateText(NOT_ADDED) || NOT_ADDED}
        >
          <CodeEditor
            type={CodeType.YAML}
            value={withOperators}
            readOnly={true}
            dataTestId={`${JOURNALD_OPERATORS_NOTICE_TEST_ID}-new-yaml`}
            maxHeight={YAML_VIEW_MAX_HEIGHT}
          />
        </Modal>
      ) : (
        <></>
      )}

      {shown === "show" ? (
        <Modal
          title={SHOW_TITLE}
          description={SHOW_DESCRIPTION}
          modalWidth={ModalWidth.Large}
          onClose={() => {
            setShown(null);
          }}
          closeButtonText="Close"
        >
          <CodeEditor
            type={CodeType.YAML}
            value={DEFAULT_RECEIVER_YAML}
            readOnly={true}
            dataTestId={`${JOURNALD_OPERATORS_NOTICE_TEST_ID}-default-yaml`}
            maxHeight={YAML_VIEW_MAX_HEIGHT}
          />
        </Modal>
      ) : (
        <></>
      )}
    </Fragment>
  );
};

export default HostCollectorJournaldOperatorsNotice;

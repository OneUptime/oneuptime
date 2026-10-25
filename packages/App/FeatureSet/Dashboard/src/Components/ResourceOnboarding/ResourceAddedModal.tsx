import React, { FunctionComponent, ReactElement, useMemo } from "react";
import BaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import Icon from "Common/UI/Components/Icon/Icon";
import Modal, { ModalWidth } from "Common/UI/Components/Modal/Modal";
import TranslatedSentence from "Common/UI/Components/TranslatedSentence/TranslatedSentence";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import { SetupGuideFrameProps } from "../SetupGuide/SetupGuideCard";
import PageMap from "../../Utils/PageMap";
import {
  RESOURCE_ADDED,
  RESOURCE_CONNECTION_STEP_TITLE,
} from "./ResourceOnboarding";
import ResourceConnectionWatch from "./ResourceConnectionWatch";

/*
 * What opens once a form has added a resource that still needs something
 * set up to send its data - a database's agent, a queue's broker metrics:
 * its guide, prefilled for the one just added, with a last step that waits
 * for that data. The same guide is the resource's Documentation tab, so
 * closing this loses nothing; the list behind it shows the new row.
 */

export interface ComponentProps {
  // Already in the reader's language, or English the dialog translates.
  title: string;
  description: string;
  modelType: { new (): BaseModel };
  recordId: ObjectID;
  name: string;
  // When its data counts as arrived (ResourceConnectionWatch).
  seenField?: string | undefined;
  viewPage: PageMap;
  // English: "View database".
  viewText: string;
  // While the guide's target loads, and why it could not.
  isLoading?: boolean | undefined;
  error?: string | undefined;
  onClose: () => void;
  renderGuide: (frame: SetupGuideFrameProps) => ReactElement;
}

const ResourceAddedModal: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();

  // Data that arrives from now on is the new resource's first.
  const since: Date = useMemo(() => {
    return new Date();
  }, []);

  return (
    <Modal
      title={props.title}
      description={props.description}
      modalWidth={ModalWidth.Large}
      onClose={props.onClose}
      closeButtonText="Done"
      isBodyLoading={props.isLoading}
      error={props.error}
    >
      <div data-testid="resource-added-modal">
        <div
          className="mb-6 flex items-start gap-3 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800"
          data-testid="resource-added-note"
        >
          <Icon
            icon={IconProp.CheckCircle}
            className="h-5 w-5 flex-shrink-0 text-emerald-600"
          />
          <span className="min-w-0 break-words">
            <TranslatedSentence
              template={RESOURCE_ADDED}
              slots={{
                name: <span className="font-semibold">{props.name}</span>,
              }}
            />
          </span>
        </div>
        {props.error ? (
          <></>
        ) : (
          props.renderGuide({
            isBare: true,
            lastStep: {
              title:
                translator.translateText(RESOURCE_CONNECTION_STEP_TITLE) ||
                RESOURCE_CONNECTION_STEP_TITLE,
              content: (
                <ResourceConnectionWatch
                  modelType={props.modelType}
                  since={since}
                  name={props.name}
                  recordId={props.recordId}
                  seenField={props.seenField}
                  viewPage={props.viewPage}
                  viewText={props.viewText}
                />
              ),
            },
          })
        )}
      </div>
    </Modal>
  );
};

export default ResourceAddedModal;

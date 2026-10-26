import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import BaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import Card, { CardButtonSchema } from "Common/UI/Components/Card/Card";
import { FormType } from "Common/UI/Components/Forms/ModelForm";
import Fields from "Common/UI/Components/Forms/Types/Fields";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import Icon from "Common/UI/Components/Icon/Icon";
import { isWhoOpenedItRootCause } from "Common/Utils/Incident/WhoOpenedItRootCause";
import MarkdownViewer from "Common/UI/Components/Markdown.tsx/LazyMarkdownViewer";
import { ModalWidth } from "Common/UI/Components/Modal/Modal";
import ModelFormModal from "Common/UI/Components/ModelFormModal/ModelFormModal";
import PermissionGate, {
  PermissionGateResult,
} from "Common/UI/Utils/PermissionGate";
import { Translator, translationKey } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  FunctionComponent,
  ReactElement,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

/*
 * "What happened": the first card of an incident's, alert's or episode's
 * overview. What happened in the words the team (or the monitor's template)
 * wrote - the record's description - and why it happened once somebody
 * knows - its root cause. Both used to live only on pages of their own in
 * the side menu, so the overview showed neither; the customer asked for
 * "easy to see what happened". Edit changes both in one dialog; the
 * Description and Root Cause pages stay where they were.
 *
 * Nothing inside the card is a box: the root cause is a section under a
 * hairline, with the same small heading the AI Investigation card's
 * sections use. A long description or root cause shows its first lines and
 * Show more, so it never pushes the rest of the page out of sight.
 */

export const WHAT_HAPPENED_CARD_TITLE: string = translationKey("What happened");

/*
 * What the edit dialog says under an incident's Description: a status page
 * that shows the incident shows its description too. Said where the text is
 * written, so nobody puts there what the public should not read.
 */
export const STATUS_PAGE_DESCRIPTION_HELP: string = translationKey(
  "Shown on the status pages this incident appears on.",
);

/*
 * The same for an incident episode: a status page that shows the episode
 * shows its description (StatusPageAPI reads it for the episode's page).
 */
export const EPISODE_STATUS_PAGE_DESCRIPTION_HELP: string = translationKey(
  "Shown on the status pages this episode appears on.",
);

/*
 * Which public record a description belongs to, when a status page shows
 * it: an incident, or an incident episode.
 */
export type StatusPageRecordKind = "incident" | "episode";

export const getStatusPageDescriptionHelp: (
  kind: StatusPageRecordKind | undefined,
) => string | undefined = (
  kind: StatusPageRecordKind | undefined,
): string | undefined => {
  if (kind === "incident") {
    return STATUS_PAGE_DESCRIPTION_HELP;
  }

  if (kind === "episode") {
    return EPISODE_STATUS_PAGE_DESCRIPTION_HELP;
  }

  return undefined;
};

/*
 * The root cause OneUptime used to write into an incident or an alert that
 * somebody opened without one - "Incident created by [Maya Chen](<their
 * page>)", "Incident created by @maya on Slack.", and nothing else
 * (Common/Utils/Incident/WhoOpenedItRootCause). It says who opened it -
 * which the stat bar's Declared / Created tile already says - not why it
 * happened, so the card reads it as no root cause yet. The Root Cause page
 * still shows it as stored. New records are not given one.
 */
export const isOpenedByRootCause: (rootCause: string) => boolean = (
  rootCause: string,
): boolean => {
  return isWhoOpenedItRootCause(rootCause);
};

export interface ComponentProps<TBaseModel extends BaseModel> {
  modelType: { new (): TBaseModel };
  modelId: ObjectID;
  description?: string | undefined;
  rootCause?: string | undefined;
  /*
   * Whose description a status page shows: an incident's and an incident
   * episode's are, on the pages they appear on, so the edit dialog says so
   * under Description; an alert's or an alert episode's is seen nowhere
   * outside OneUptime.
   */
  statusPageRecord?: StatusPageRecordKind | undefined;
  // After a save: the page reads the record again, and its feed.
  onSaved: () => void;
}

interface ClampedMarkdownProps {
  text: string;
  dataTestId: string;
}

/*
 * How much of a text shows before Show more: about six lines of the
 * viewer's text. The frame is held to it whenever the text is not opened,
 * so whether the text is longer can be measured against it; a text that fits
 * is as tall as it is, and nothing about it changes.
 */
const COLLAPSED_FRAME_CLASS_NAME: string = "max-h-36 overflow-hidden";

/*
 * A longer text's last visible line fades out - a mask, so it fades
 * whatever the card's colour is, in either theme - instead of being cut
 * through the middle.
 */
const FADED_FRAME_CLASS_NAME: string =
  "[-webkit-mask-image:linear-gradient(to_bottom,black_calc(100%-2rem),transparent)] [mask-image:linear-gradient(to_bottom,black_calc(100%-2rem),transparent)]";

const ClampedMarkdown: FunctionComponent<ClampedMarkdownProps> = (
  props: ClampedMarkdownProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const contentId: string = useId();
  const frameRef: React.RefObject<HTMLDivElement> =
    useRef<HTMLDivElement>(null);
  const contentRef: React.RefObject<HTMLDivElement> =
    useRef<HTMLDivElement>(null);
  const [isExpanded, setIsExpanded] = useState<boolean>(false);
  const [isLong, setIsLong] = useState<boolean>(false);
  const [shownText, setShownText] = useState<string>(props.text);

  // A different text is a different read: start it collapsed.
  if (shownText !== props.text) {
    setShownText(props.text);
    setIsExpanded(false);
  }

  /*
   * Whether the text is longer than the collapsed frame is measured, not
   * guessed from its length: the card runs from a phone's width to a wide
   * monitor's, and markdown lays out its own way. The content is observed
   * as well as the frame - the frame stops growing at its cap, the content
   * does not - so a viewer that finishes loading after the first paint is
   * measured again. While expanded, the last measurement stands, which
   * keeps Show less on screen for the reader who opened it.
   */
  useLayoutEffect(() => {
    const frame: HTMLDivElement | null = frameRef.current;
    const content: HTMLDivElement | null = contentRef.current;

    if (!frame || !content || isExpanded) {
      return undefined;
    }

    const measure: () => void = (): void => {
      // The extra pixel absorbs sub-pixel rounding between the two heights.
      setIsLong(content.scrollHeight > frame.clientHeight + 1);
    };

    measure();

    // ResizeObserver is missing in jsdom and in older browsers.
    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", measure);

      return () => {
        window.removeEventListener("resize", measure);
      };
    }

    const observer: ResizeObserver = new ResizeObserver(measure);
    observer.observe(content);
    observer.observe(frame);

    return () => {
      observer.disconnect();
    };
  }, [isExpanded, props.text]);

  return (
    <div data-testid={props.dataTestId}>
      <div
        ref={frameRef}
        id={contentId}
        data-testid={`${props.dataTestId}-text`}
        className={`break-words [&>div>div>*:first-child]:mt-0 [&>div>div>*:last-child]:mb-0 ${
          isExpanded ? "" : COLLAPSED_FRAME_CLASS_NAME
        } ${!isExpanded && isLong ? FADED_FRAME_CLASS_NAME : ""}`}
      >
        <div ref={contentRef}>
          <MarkdownViewer text={props.text} />
        </div>
      </div>
      {isLong ? (
        <button
          type="button"
          onClick={() => {
            setIsExpanded(!isExpanded);
          }}
          aria-expanded={isExpanded}
          aria-controls={contentId}
          className="-ml-1.5 mt-1 inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-xs font-semibold text-indigo-700 transition-colors hover:bg-indigo-50 hover:text-indigo-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2"
        >
          {isExpanded
            ? translator.translateText("Show less")
            : translator.translateText("Show more")}
          <Icon
            icon={IconProp.ChevronDown}
            className={`h-3.5 w-3.5 motion-safe:transition-transform ${
              isExpanded ? "rotate-180" : ""
            }`}
          />
        </button>
      ) : (
        <></>
      )}
    </div>
  );
};

// A quiet line for a section with nothing in it yet.
const EmptyLine: FunctionComponent<{
  text: string;
  dataTestId: string;
}> = (props: { text: string; dataTestId: string }): ReactElement => {
  return (
    <p data-testid={props.dataTestId} className="text-sm text-gray-500">
      {props.text}
    </p>
  );
};

const EventWhatHappenedCard: <TBaseModel extends BaseModel>(
  props: ComponentProps<TBaseModel>,
) => ReactElement = <TBaseModel extends BaseModel>(
  props: ComponentProps<TBaseModel>,
): ReactElement => {
  const translator: Translator = useTranslator();
  const rootCauseHeadingId: string = useId();
  const [isEditing, setIsEditing] = useState<boolean>(false);

  const formFields: Fields<TBaseModel> = [
    {
      field: {
        description: true,
      },
      title: "Description",
      fieldType: FormFieldSchemaType.Markdown,
      required: false,
      placeholder: "Description",
      description: getStatusPageDescriptionHelp(props.statusPageRecord),
    },
    {
      field: {
        rootCause: true,
      },
      title: "Root Cause",
      fieldType: FormFieldSchemaType.Markdown,
      required: false,
      placeholder: "Root Cause",
      description: "Why it happened, once you know.",
    },
  ] as unknown as Fields<TBaseModel>;

  /*
   * As every editable card decides it (CardModelDetail): the button stays,
   * locked with what would open it, for somebody who may not change the
   * two fields, and goes only when there is nothing honest to say yet.
   */
  const editGate: PermissionGateResult = PermissionGate.checkFormUpdate(
    new props.modelType(),
    formFields,
  );

  const buttons: Array<CardButtonSchema> = [];

  if (editGate.isAllowed || editGate.disabledReason) {
    buttons.push({
      title: "Edit",
      icon: IconProp.Edit,
      buttonStyle: ButtonStyleType.NORMAL,
      disabled: !editGate.isAllowed,
      tooltip: editGate.disabledReason,
      onClick: () => {
        if (!editGate.isAllowed) {
          return;
        }

        setIsEditing(true);
      },
    });
  }

  const description: string = props.description?.trim() || "";
  const storedRootCause: string = props.rootCause?.trim() || "";
  const rootCause: string = isOpenedByRootCause(storedRootCause)
    ? ""
    : storedRootCause;

  return (
    <>
      <Card title={WHAT_HAPPENED_CARD_TITLE} buttons={buttons}>
        <div data-testid="what-happened">
          {description ? (
            <ClampedMarkdown
              text={description}
              dataTestId="what-happened-description"
            />
          ) : (
            <EmptyLine
              text={translator.translateText("No description yet.") || ""}
              dataTestId="what-happened-description-empty"
            />
          )}

          <section
            aria-labelledby={rootCauseHeadingId}
            data-testid="what-happened-root-cause"
            className="mt-4 border-t border-gray-100 pt-4"
          >
            <h3
              id={rootCauseHeadingId}
              className="text-sm font-semibold text-gray-900"
            >
              {translator.translateText("Root cause")}
            </h3>
            <div className="mt-1">
              {rootCause ? (
                <ClampedMarkdown
                  text={rootCause}
                  dataTestId="what-happened-root-cause-value"
                />
              ) : (
                <EmptyLine
                  text={translator.translateText("Not identified yet.") || ""}
                  dataTestId="what-happened-root-cause-empty"
                />
              )}
            </div>
          </section>
        </div>
      </Card>

      {isEditing ? (
        <ModelFormModal<TBaseModel>
          title="Edit what happened"
          modalWidth={ModalWidth.Large}
          modelType={props.modelType}
          name="edit-what-happened"
          onClose={() => {
            setIsEditing(false);
          }}
          submitButtonText="Save Changes"
          onSuccess={() => {
            setIsEditing(false);
            props.onSaved();
          }}
          formProps={{
            id: "edit-what-happened",
            name: "edit-what-happened",
            modelType: props.modelType,
            formType: FormType.Update,
            fields: formFields,
            steps: [],
          }}
          modelIdToEdit={props.modelId}
        />
      ) : (
        <></>
      )}
    </>
  );
};

export default EventWhatHappenedCard;

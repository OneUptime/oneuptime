import Incident from "Common/Models/DatabaseModels/Incident";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import Icon from "Common/UI/Components/Icon/Icon";
import MoreMenu from "Common/UI/Components/MoreMenu/MoreMenu";
import MoreMenuItem from "Common/UI/Components/MoreMenu/MoreMenuItem";
import MoreMenuSection from "Common/UI/Components/MoreMenu/MoreMenuSection";
import Pill from "Common/UI/Components/Pill/Pill";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import {
  translatableTerm,
  translationKey,
  Translator,
} from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";
import {
  PostmortemStatusChoice,
  getCurrentPostmortemStatusChoice,
  getPickablePostmortemStatusChoices,
} from "./PostmortemStatusChoices";
import Color from "Common/Types/Color";

export const POSTMORTEM_STATUS_MENU_TITLE: string = translationKey(
  "Move postmortem to",
);

export const POSTMORTEM_STATUS_SAVE_FAILED: string = translationKey(
  "Could not change the postmortem's status.",
);

// What a postmortem with no status yet is shown as while statuses load.
export const POSTMORTEM_STATUS_UNKNOWN: string = translationKey("No status");

export interface ComponentProps {
  incidentId: ObjectID;
  // The status the incident's postmortem is in; null when it has none yet.
  statusId: string | null | undefined;
  // The project's statuses (usePostmortemStatuses); empty while loading.
  choices: Array<PostmortemStatusChoice>;
  /*
   * Whether the reader may move the postmortem (they may edit the
   * incident). Without it the pill is drawn without its menu: anyone who
   * can read the incident can read where its postmortem stands.
   */
  isEditable: boolean;
  // Told once the new status is saved, so the page reads the incident again.
  onChanged?: ((statusId: string) => void) | undefined;
  // A row of a table: the menu is portalled out of its scroller.
  isInTable?: boolean | undefined;
  dataTestId?: string | undefined;
}

/*
 * Where an incident's postmortem stands: a pill in the status's colour that
 * opens a menu of the project's statuses - on the incident's Postmortem page
 * and on every row of the Postmortems list. A move is saved at once (one
 * choice, and nothing anyone is told about), shown before the server
 * answers, and put back with the reason if the save fails. Archived statuses
 * are never offered; a postmortem already in one shows it.
 */
const PostmortemStatusPicker: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();

  const [statusId, setStatusId] = useState<string | null>(
    props.statusId || null,
  );
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [error, setError] = useState<string>("");

  // A reload of the incident brings the status the server holds.
  useEffect(() => {
    setStatusId(props.statusId || null);
  }, [props.statusId]);

  const current: PostmortemStatusChoice | null =
    getCurrentPostmortemStatusChoice({
      choices: props.choices,
      statusId: statusId,
    });

  const pickable: Array<PostmortemStatusChoice> =
    getPickablePostmortemStatusChoices(props.choices);

  const canChange: boolean = props.isEditable && pickable.length > 0;

  const testId: string = props.dataTestId || "postmortem-status";

  const moveTo: (choice: PostmortemStatusChoice) => Promise<void> = async (
    choice: PostmortemStatusChoice,
  ): Promise<void> => {
    if (isSaving || (current && current.id === choice.id && statusId)) {
      return;
    }

    const previous: string | null = statusId;

    setError("");
    setStatusId(choice.id);
    setIsSaving(true);

    try {
      await ModelAPI.updateById<Incident>({
        modelType: Incident,
        id: props.incidentId,
        data: {
          postmortemStatusId: new ObjectID(choice.id),
        },
      });

      props.onChanged?.(choice.id);
    } catch (err) {
      // Back to what is still stored, and why the move did not stick.
      setStatusId(previous);
      setError(API.getFriendlyMessage(err));
    }

    setIsSaving(false);
  };

  const pill: ReactElement = current ? (
    <Pill
      color={new Color(current.color)}
      text={current.name}
      isMinimal={false}
    />
  ) : (
    <span className="text-sm text-gray-500">
      {translator.translateText(POSTMORTEM_STATUS_UNKNOWN)}
    </span>
  );

  return (
    <div
      className="inline-flex flex-col items-start gap-1"
      data-testid={testId}
      data-status-id={current?.id || ""}
    >
      {canChange ? (
        <MoreMenu
          isMenuPortaled={Boolean(props.isInTable)}
          // The pill starts its line, so its menu opens under it, not to its left.
          isMenuLeftAligned={true}
          isDisabled={isSaving}
          dataTestId={`${testId}-menu`}
          elementToBeShownInsteadOfButton={
            <button
              type="button"
              className={`inline-flex max-w-full items-center gap-1 rounded-full transition-opacity hover:opacity-80 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-1 ${
                isSaving ? "opacity-60" : ""
              }`}
              aria-label={translator.translateTemplate(
                "Postmortem status: {{status}}. Change it.",
                {
                  // Named as the pill draws it, in the reader's language.
                  status: translatableTerm(
                    current ? current.name : POSTMORTEM_STATUS_UNKNOWN,
                  ),
                },
              )}
              aria-busy={isSaving}
              data-testid={`${testId}-pill`}
            >
              {pill}
              <Icon
                icon={IconProp.ChevronDown}
                className="h-3 w-3 flex-shrink-0 text-gray-500"
              />
            </button>
          }
        >
          {[
            <MoreMenuSection
              key="statuses"
              // The section translates its own title.
              title={POSTMORTEM_STATUS_MENU_TITLE}
            >
              {pickable.map(
                (choice: PostmortemStatusChoice): ReactElement => {
                  const isSelected: boolean = Boolean(
                    current && current.id === choice.id,
                  );

                  return (
                    <MoreMenuItem
                      key={choice.id}
                      text={choice.name}
                      color={choice.color}
                      tooltip={choice.description || undefined}
                      isChecked={isSelected}
                      rightElement={
                        isSelected ? (
                          <Icon
                            icon={IconProp.Check}
                            className="h-4 w-4 text-indigo-600"
                          />
                        ) : undefined
                      }
                      dataTestId={`${testId}-option`}
                      onClick={() => {
                        void moveTo(choice);
                      }}
                    />
                  );
                },
              )}
            </MoreMenuSection>,
          ]}
        </MoreMenu>
      ) : (
        <span data-testid={`${testId}-pill`}>{pill}</span>
      )}

      {error ? (
        <p
          className="text-xs text-red-700"
          role="alert"
          data-testid={`${testId}-error`}
        >
          {translator.translateText(POSTMORTEM_STATUS_SAVE_FAILED)} {error}
        </p>
      ) : (
        <></>
      )}
    </div>
  );
};

export default PostmortemStatusPicker;

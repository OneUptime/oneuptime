import {
  CANCEL,
  CHANGE_PLACES,
  EXPOSURE_TEST_IDS,
  PLACES_FROM_DATA,
  PLACES_SAID,
  PLACES_SAID_BY_SOMEONE,
  PLACES_SAVED,
  SAVE_PLACES,
  WHERE_FIRST_DESCRIPTION,
  WHERE_FIRST_TITLE,
  WHERE_PEOPLE_LIVE,
} from "./ExposureAssessmentCopy";
import { describePlaces, say } from "./ExposureAssessmentModel";
import { getCountryName } from "../../DataSecurity/ComplianceFacts";
import {
  BREACH_PLACE_CHOICES,
  BREACH_PLACES,
  BreachPlace,
} from "Common/Types/DataSecurity/BreachLaws";
import {
  ExposurePeoplePlaces as SaidPlaces,
  ExposureWhoseData,
} from "Common/Types/DataSecurity/ExposureAssessment";
import IconProp from "Common/Types/Icon/IconProp";
import Button, {
  ButtonSize,
  ButtonStyleType,
} from "Common/UI/Components/Button/Button";
import ErrorLine from "Common/UI/Components/ErrorMessage/ErrorLine";
import Icon from "Common/UI/Components/Icon/Icon";
import API from "Common/UI/Utils/API/API";
import Toast from "Common/UI/Utils/Toast";
import {
  Translator,
  composedValue,
  formatList,
} from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement, useState } from "react";

/*
 * WHERE THE PEOPLE THE DATA IS ABOUT LIVE (#10377): which breach laws
 * apply depends on it. The data may show some of them (the countries its
 * data types are of); a person says the rest, by the places OneUptime's
 * table knows - each a chip pressed on or off - and Save Places applies
 * the laws by their answer from then on. Saving none takes it back.
 *
 * While nobody knows, the question is asked first on the card (isAskedFirst):
 * nothing is due first until it is answered.
 */

export interface ComponentProps {
  whose: ExposureWhoseData;
  said: SaidPlaces | undefined;
  // Who said it, as the project names them.
  saidByName?: string | undefined;
  canChange: boolean;
  isAskedFirst: boolean;
  onSave: (places: Array<BreachPlace>) => Promise<void>;
}

const ExposurePeoplePlaces: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const saidPlaces: Array<BreachPlace> = (props.said?.places || []).filter(
    (place: string): place is BreachPlace => {
      return (BREACH_PLACES as ReadonlyArray<string>).includes(place);
    },
  );
  const [isEditing, setIsEditing] = useState<boolean>(false);
  const [picked, setPicked] = useState<Array<BreachPlace>>(saidPlaces);
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [error, setError] = useState<string>("");
  const isPicking: boolean =
    props.canChange && (isEditing || (props.isAskedFirst && !props.said));

  const save: () => Promise<void> = async (): Promise<void> => {
    setIsSaving(true);
    setError("");

    try {
      await props.onSave(picked);
      setIsEditing(false);
      Toast.success(say(translator, PLACES_SAVED));
    } catch (err) {
      setError(API.getFriendlyMessage(err));
    } finally {
      setIsSaving(false);
    }
  };

  const fromData: string = formatList(
    props.whose.countriesFromData.map((country: string): string => {
      return getCountryName(country, translator);
    }),
    translator,
  );

  return (
    <section
      className="space-y-3"
      data-testid={EXPOSURE_TEST_IDS.places}
      aria-labelledby={`${EXPOSURE_TEST_IDS.places}-heading`}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2">
        <h3
          id={`${EXPOSURE_TEST_IDS.places}-heading`}
          className={
            props.isAskedFirst
              ? "text-lg font-semibold text-gray-900"
              : "text-sm font-semibold text-gray-900"
          }
        >
          {say(
            translator,
            props.isAskedFirst ? WHERE_FIRST_TITLE : WHERE_PEOPLE_LIVE,
          )}
        </h3>
        {props.canChange && !isPicking ? (
          <Button
            title={CHANGE_PLACES}
            icon={IconProp.Edit}
            buttonStyle={ButtonStyleType.OUTLINE}
            buttonSize={ButtonSize.Small}
            dataTestId={`${EXPOSURE_TEST_IDS.places}-change`}
            onClick={() => {
              setPicked(saidPlaces);
              setError("");
              setIsEditing(true);
            }}
          />
        ) : (
          <></>
        )}
      </div>
      {props.isAskedFirst && !props.said ? (
        <p className="text-sm text-gray-700">
          {say(translator, WHERE_FIRST_DESCRIPTION)}
        </p>
      ) : (
        <></>
      )}
      {props.whose.countriesFromData.length > 0 ? (
        <p className="text-sm text-gray-700">
          {translator.translateTemplate(PLACES_FROM_DATA, {
            places: fromData,
          })}
        </p>
      ) : (
        <></>
      )}
      {props.said && saidPlaces.length > 0 ? (
        <div className="flex items-start gap-2 text-sm text-gray-700">
          <Icon
            icon={IconProp.User}
            className="mt-0.5 h-4 w-4 flex-none text-gray-400"
          />
          <span>
            {props.saidByName
              ? translator.translateTemplate(PLACES_SAID, {
                  name: props.saidByName,
                  places: composedValue((sentence: Translator): string => {
                    return describePlaces(saidPlaces, sentence);
                  }),
                })
              : translator.translateTemplate(PLACES_SAID_BY_SOMEONE, {
                  places: composedValue((sentence: Translator): string => {
                    return describePlaces(saidPlaces, sentence);
                  }),
                })}
          </span>
        </div>
      ) : (
        <></>
      )}
      {isPicking ? (
        <div className="space-y-3">
          <div
            className="flex flex-wrap gap-2"
            role="group"
            aria-labelledby={`${EXPOSURE_TEST_IDS.places}-heading`}
          >
            {BREACH_PLACES.map((place: BreachPlace): ReactElement => {
              const isPicked: boolean = picked.includes(place);

              return (
                <button
                  key={place}
                  type="button"
                  aria-pressed={isPicked}
                  data-testid={`${EXPOSURE_TEST_IDS.placeChoice}-${place}`}
                  className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium ring-1 ring-inset focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${
                    isPicked
                      ? "bg-indigo-50 text-indigo-700 ring-indigo-600/30"
                      : "bg-white text-gray-700 ring-gray-300 hover:bg-gray-50"
                  }`}
                  onClick={() => {
                    setPicked(
                      isPicked
                        ? picked.filter((each: BreachPlace): boolean => {
                            return each !== place;
                          })
                        : [...picked, place],
                    );
                  }}
                >
                  {isPicked ? (
                    <Icon icon={IconProp.Check} className="h-3.5 w-3.5" />
                  ) : (
                    <></>
                  )}
                  <span>{say(translator, BREACH_PLACE_CHOICES[place])}</span>
                </button>
              );
            })}
          </div>
          {error ? <ErrorLine message={error} /> : <></>}
          <div className="flex flex-wrap gap-2">
            <Button
              title={SAVE_PLACES}
              buttonStyle={ButtonStyleType.NORMAL}
              buttonSize={ButtonSize.Small}
              isLoading={isSaving}
              disabled={!props.said && picked.length === 0}
              dataTestId={EXPOSURE_TEST_IDS.savePlaces}
              onClick={() => {
                void save();
              }}
            />
            {isEditing ? (
              <Button
                title={CANCEL}
                buttonStyle={ButtonStyleType.OUTLINE}
                buttonSize={ButtonSize.Small}
                dataTestId={`${EXPOSURE_TEST_IDS.places}-cancel`}
                onClick={() => {
                  setIsEditing(false);
                  setError("");
                }}
              />
            ) : (
              <></>
            )}
          </div>
        </div>
      ) : (
        <></>
      )}
    </section>
  );
};

export default ExposurePeoplePlaces;

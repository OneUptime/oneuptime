import {
  DATA_OWNER_HEADING,
  DATA_OWNER_READ_ONLY,
  DATA_OWNER_SAVED,
  EXPOSURE_TEST_IDS,
  HELD_FOR_ANOTHER_SAID,
  HELD_FOR_ANOTHER_SAID_BY_SOMEONE,
  HOLDS_FOR_ANOTHER,
  HOLDS_FOR_ANOTHER_DESCRIPTION,
  OWN_DATA_SAID,
  OWN_DATA_SAID_BY_SOMEONE,
} from "./ExposureAssessmentCopy";
import { say } from "./ExposureAssessmentModel";
import { ExposureDataHeldFor } from "Common/Types/DataSecurity/ExposureAssessment";
import IconProp from "Common/Types/Icon/IconProp";
import ErrorLine from "Common/UI/Components/ErrorMessage/ErrorLine";
import Icon from "Common/UI/Components/Icon/Icon";
import Toggle from "Common/UI/Components/Toggle/Toggle";
import API from "Common/UI/Utils/API/API";
import Toast from "Common/UI/Utils/Toast";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement, useState } from "react";

/*
 * WHETHER THE ORGANIZATION HOLDS THE DATA FOR ANOTHER (#11427). A vendor,
 * processor or service provider that holds data for another organization
 * owes that organization - the data's owner - a notice of a breach, under
 * almost every US state's law and GDPR's Article 33(2). No scan can tell
 * whose data a store holds for whom, so a person says, with one switch: on,
 * the assessment adds those notices; off, it says the data is the
 * organization's own. The answer is kept with the assessment, with who gave
 * it and when, as where the people live is. While nobody has said, the
 * switch is off and the card's "not covered" lines say the notices wait on
 * it.
 */

export interface ComponentProps {
  said: ExposureDataHeldFor | undefined;
  // Who said it, as the project names them.
  saidByName?: string | undefined;
  canChange: boolean;
  onSave: (forAnother: boolean) => Promise<void>;
}

// The line that says who said what, or nothing while nobody has.
export function getDataOwnerSaidLine(
  said: ExposureDataHeldFor | undefined,
  saidByName: string | undefined,
  translator: Translator,
): string {
  if (!said) {
    return "";
  }

  if (said.forAnother) {
    return saidByName
      ? translator.translateTemplate(HELD_FOR_ANOTHER_SAID, {
          name: saidByName,
        })
      : say(translator, HELD_FOR_ANOTHER_SAID_BY_SOMEONE);
  }

  return saidByName
    ? translator.translateTemplate(OWN_DATA_SAID, { name: saidByName })
    : say(translator, OWN_DATA_SAID_BY_SOMEONE);
}

const ExposureDataOwner: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [error, setError] = useState<string>("");
  /*
   * The switch moves as it is pressed: when the answer is not saved, it is
   * drawn again, back at the answer that is.
   */
  const [failures, setFailures] = useState<number>(0);
  const saidLine: string = getDataOwnerSaidLine(
    props.said,
    props.saidByName,
    translator,
  );

  const save: (forAnother: boolean) => Promise<void> = async (
    forAnother: boolean,
  ): Promise<void> => {
    setIsSaving(true);
    setError("");

    try {
      await props.onSave(forAnother);
      Toast.success(say(translator, DATA_OWNER_SAVED));
    } catch (err) {
      setError(API.getFriendlyMessage(err));
      setFailures(failures + 1);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <section
      className="space-y-3"
      data-testid={EXPOSURE_TEST_IDS.dataHolder}
      aria-labelledby={`${EXPOSURE_TEST_IDS.dataHolder}-heading`}
    >
      <h3
        id={`${EXPOSURE_TEST_IDS.dataHolder}-heading`}
        className="text-sm font-semibold text-gray-900"
      >
        {say(translator, DATA_OWNER_HEADING)}
      </h3>
      <Toggle
        key={failures}
        title={HOLDS_FOR_ANOTHER}
        description={HOLDS_FOR_ANOTHER_DESCRIPTION}
        value={props.said?.forAnother === true}
        disabled={!props.canChange || isSaving}
        tooltip={props.canChange ? undefined : DATA_OWNER_READ_ONLY}
        dataTestId={`${EXPOSURE_TEST_IDS.dataHolder}-toggle`}
        onChange={(value: boolean) => {
          void save(value);
        }}
      />
      {saidLine ? (
        <div
          className="flex items-start gap-2 text-sm text-gray-700"
          data-testid={`${EXPOSURE_TEST_IDS.dataHolder}-said`}
        >
          <Icon
            icon={IconProp.User}
            className="mt-0.5 h-4 w-4 flex-none text-gray-400"
          />
          <span>{saidLine}</span>
        </div>
      ) : (
        <></>
      )}
      {error ? <ErrorLine message={error} /> : <></>}
    </section>
  );
};

export default ExposureDataOwner;

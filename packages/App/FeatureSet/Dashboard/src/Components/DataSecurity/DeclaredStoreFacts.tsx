import StoreDataTypeList from "./StoreDataTypeList";
import {
  FILLED_IN_BY_ONEUPTIME,
  READ_BY_SCANS_ONLY,
  WHAT_IT_HOLDS,
  WHO_CAN_READ_IT,
  WRITTEN_BY_YOUR_TEAM,
  getDeclaredPurposeText,
  getDeclaredReaderNames,
  getDeclaredRetentionHint,
  getDeclaredRetentionText,
} from "./DeclaredStoreCopy";
import { DataSecurityDeclaredStore } from "Common/Types/DataSecurity/DataSecurityApiTypes";
import {
  DeclaredDataStoreInfo,
  DeclaredStoreReaders,
  getDeclaredDataStore,
} from "Common/Types/DataSecurity/DeclaredDataStore";
import IsolatedText from "Common/UI/Components/IsolatedText/IsolatedText";
import Pill from "Common/UI/Components/Pill/Pill";
import { PillTone } from "Common/UI/Components/Pill/PillTone";
import { Translator, translationKey } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement, ReactNode } from "react";

/*
 * WHAT ONEUPTIME DECLARES OF ONE OF ITS OWN SECURITY STORES (#10398), as
 * the record of processing says it: what it holds by design, why, for how
 * long and who can read it. OneUptime's purpose and retention read in the
 * reader's language, each saying it is OneUptime's; the team's own words
 * read as written, saying they are the team's.
 */

const PURPOSE: string = translationKey("Purpose");
const RETENTION: string = translationKey("Retention");

const FACT_LABEL_CLASS_NAME: string =
  "text-xs font-medium uppercase tracking-wide text-gray-500";

const Fact: FunctionComponent<{
  label: string;
  dataTestId: string;
  children: ReactNode;
}> = (props: {
  label: string;
  dataTestId: string;
  children: ReactNode;
}): ReactElement => {
  const translator: Translator = useTranslator();

  return (
    <div className="min-w-0" data-testid={props.dataTestId}>
      <dt className={FACT_LABEL_CLASS_NAME}>
        {translator.translateText(props.label)}
      </dt>
      <dd className="mt-1.5 space-y-1 text-sm text-gray-900">
        {props.children}
      </dd>
    </div>
  );
};

// Who reads a declared store: its roles as chips, or the vault's sentence.
export const DeclaredStoreReadersList: FunctionComponent<{
  declared: DataSecurityDeclaredStore;
}> = (props: { declared: DataSecurityDeclaredStore }): ReactElement => {
  const translator: Translator = useTranslator();

  if (props.declared.readers === DeclaredStoreReaders.SecurityEventsScansOnly) {
    return (
      <p className="text-sm text-gray-700">
        {translator.translateText(READ_BY_SCANS_ONLY)}
      </p>
    );
  }

  return (
    <div className="flex flex-wrap gap-1.5">
      {getDeclaredReaderNames(props.declared, translator).map(
        (name: string): ReactElement => {
          return (
            <Pill
              key={name}
              text={name}
              tone={PillTone.Neutral}
              isDotHidden={true}
              isUserContent={true}
            />
          );
        },
      )}
    </div>
  );
};

export interface ComponentProps {
  kind: string;
  declared: DataSecurityDeclaredStore;
  // The store's Purpose and Retention as the record says them.
  purpose: string;
  retention: string;
}

const DeclaredStoreFacts: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const info: DeclaredDataStoreInfo | undefined = getDeclaredDataStore(
    props.kind,
  );
  const purpose: string = getDeclaredPurposeText(
    { purpose: props.purpose, declared: props.declared },
    translator,
  );
  const retention: string = getDeclaredRetentionText(
    { retention: props.retention, declared: props.declared },
    translator,
  );

  return (
    <dl
      className="grid grid-cols-1 gap-x-6 gap-y-5 sm:grid-cols-2"
      data-testid="declared-store-facts"
    >
      <Fact label={WHAT_IT_HOLDS} dataTestId="declared-store-holds">
        <StoreDataTypeList dataTypeIds={info?.dataTypeIds} maxVisible={5} />
      </Fact>
      <Fact label={WHO_CAN_READ_IT} dataTestId="declared-store-readers">
        <DeclaredStoreReadersList declared={props.declared} />
      </Fact>
      <Fact label={PURPOSE} dataTestId="declared-store-purpose">
        <p>
          {props.declared.isPurposeTheTeams ? (
            <IsolatedText text={purpose} />
          ) : (
            purpose
          )}
        </p>
        <p className="text-xs text-gray-500">
          {translator.translateText(
            props.declared.isPurposeTheTeams
              ? WRITTEN_BY_YOUR_TEAM
              : FILLED_IN_BY_ONEUPTIME,
          )}
        </p>
      </Fact>
      <Fact label={RETENTION} dataTestId="declared-store-retention">
        <p>
          {props.declared.isRetentionTheTeams ? (
            <IsolatedText text={retention} />
          ) : (
            retention
          )}
        </p>
        <p className="text-xs text-gray-500">
          {props.declared.isRetentionTheTeams
            ? translator.translateText(WRITTEN_BY_YOUR_TEAM)
            : translator.translateText(
                getDeclaredRetentionHint(props.declared),
              )}
        </p>
      </Fact>
    </dl>
  );
};

export default DeclaredStoreFacts;

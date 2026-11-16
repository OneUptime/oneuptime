import {
  WELCOME_CHECKLIST_COPY,
  WELCOME_GREETING_WITH_NAME,
} from "./WelcomeChecklistCatalog";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import UserUtil from "Common/UI/Utils/User";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * THE GREETING THE QUICKSTART OPENS WITH (issue #8897): "Welcome to
 * OneUptime, Ada 👋" - the person's first name as they typed it, never
 * looked up - or the card's own title when the Dashboard does not know a
 * name. Both views of the checklist start with it, so going from the
 * question to the steps keeps the page's top where it was.
 */

// The first name of the person signed in, or "" when there is none.
export const getGreetingFirstName: () => string = (): string => {
  try {
    return UserUtil.getName().getFirstName().trim();
  } catch {
    return "";
  }
};

export const getGreeting: (
  translator: Translator,
  firstName: string | undefined,
) => string = (
  translator: Translator,
  firstName: string | undefined,
): string => {
  const name: string = (firstName || "").trim();

  if (!name) {
    return translator.translateText(WELCOME_CHECKLIST_COPY.title) || "";
  }

  return translator.translateTemplate(WELCOME_GREETING_WITH_NAME, {
    name: name,
  });
};

export interface ComponentProps {
  firstName?: string | undefined;
  dataTestId?: string | undefined;
  // The heading's id, for the section it names.
  headingId?: string | undefined;
  // Beside the greeting, on its line: the checklist's Hide.
  rightElement?: ReactElement | undefined;
}

const WelcomeGreeting: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();

  return (
    <div className="flex items-start justify-between gap-4">
      <h2
        id={props.headingId}
        data-testid={props.dataTestId}
        className="min-w-0 break-words text-2xl font-semibold tracking-tight text-gray-900 sm:text-3xl"
      >
        {getGreeting(translator, props.firstName)}
      </h2>
      {props.rightElement ? (
        <div className="flex-none pt-1">{props.rightElement}</div>
      ) : (
        <></>
      )}
    </div>
  );
};

export default WelcomeGreeting;

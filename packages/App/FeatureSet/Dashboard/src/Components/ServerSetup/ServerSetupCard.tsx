import { getAdminServerSetupUrl } from "../../Utils/ServerEmail";
import IconProp from "Common/Types/Icon/IconProp";
import { ServerSetupChecklistAnswer } from "Common/Types/ServerSetup/ServerSetupChecklist";
import Button, { ButtonStyleType } from "Common/UI/Components/Button/Button";
import Icon from "Common/UI/Components/Icon/Icon";
import Link from "Common/UI/Components/Link/Link";
import { BILLING_ENABLED } from "Common/UI/Config";
import ServerSetupChecklistLoader, {
  useServerSetupChecklist,
  UseServerSetupChecklistResult,
} from "Common/UI/Utils/ServerSetupChecklist";
import {
  PluralTemplate,
  translationKey,
  Translator,
} from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement, useState } from "react";

/*
 * "THIS SERVER IS NOT FINISHED" - WHERE A NEW SERVER'S FIRST ADMIN LANDS.
 *
 * The first account of a self-hosted server becomes its admin and lands in
 * the Dashboard, on "No projects" and then Home - never in the Admin
 * Dashboard, where the server's setup checklist is. So a master admin sees
 * this card there while a required check is open (email, HTTPS, who can
 * sign up): how many things are left, and the way to them, Server setup
 * (/admin/setup).
 *
 * Nobody else sees it: it is drawn for master admins only, and the
 * checklist answers master admins only. Not on OneUptime Cloud. "Hide"
 * hides it for this admin in every browser (kept on the server), until a
 * required check opens that was not open then.
 */

export const SERVER_SETUP_CARD_COPY: {
  title: PluralTemplate;
  description: string;
  finishSetup: string;
  hide: string;
} = {
  title: {
    one: "This server is not finished: {{count}} thing to set up",
    other: "This server is not finished: {{count}} things to set up",
  },
  description: translationKey("Only you see this, as the server's admin."),
  finishSetup: translationKey("Finish setup"),
  hide: translationKey("Hide"),
};

// Whether the card is drawn for an answer: required checks open, not hidden.
export const isServerSetupCardShown: (
  answer: ServerSetupChecklistAnswer | null,
) => boolean = (answer: ServerSetupChecklistAnswer | null): boolean => {
  return Boolean(
    !BILLING_ENABLED &&
      answer &&
      answer.openRequired.length > 0 &&
      !answer.isHiddenForReader,
  );
};

export interface ComponentProps {
  className?: string | undefined;
}

const ServerSetupCard: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const checklist: UseServerSetupChecklistResult = useServerSetupChecklist();
  const [isHiding, setIsHiding] = useState<boolean>(false);

  if (
    BILLING_ENABLED ||
    !ServerSetupChecklistLoader.isShownToReader() ||
    !isServerSetupCardShown(checklist.answer)
  ) {
    return <></>;
  }

  const count: number = checklist.answer!.openRequired.length;

  return (
    <div
      data-testid="server-setup-card"
      className={`rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 ${props.className || ""}`}
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="flex min-w-0 flex-1 items-start gap-3">
          <Icon
            icon={IconProp.Settings}
            className="mt-0.5 h-5 w-5 flex-none text-amber-600"
          />
          <div className="min-w-0">
            <p
              className="text-sm font-medium text-gray-900 text-pretty"
              data-testid="server-setup-card-title"
            >
              {translator.translatePlural(SERVER_SETUP_CARD_COPY.title, count)}
            </p>
            <p className="mt-0.5 text-sm text-gray-600 text-pretty">
              {translator.translateText(SERVER_SETUP_CARD_COPY.description)}
            </p>
          </div>
        </div>
        <div className="ms-8 flex flex-none items-center gap-3 sm:ms-0">
          <Link
            to={getAdminServerSetupUrl()}
            dataTestId="server-setup-card-finish"
            className="inline-flex items-center rounded-md bg-white px-3 py-1.5 text-sm font-medium text-gray-800 shadow-sm ring-1 ring-inset ring-amber-300 hover:bg-amber-100"
          >
            {translator.translateText(SERVER_SETUP_CARD_COPY.finishSetup)}
          </Link>
          <Button
            title={SERVER_SETUP_CARD_COPY.hide}
            buttonStyle={ButtonStyleType.SECONDARY_LINK}
            isLoading={isHiding}
            onClick={() => {
              setIsHiding(true);
              ServerSetupChecklistLoader.hide()
                .then((answer: ServerSetupChecklistAnswer): void => {
                  checklist.setAnswer(answer);
                })
                .catch((): void => {
                  // Hidden for this visit only.
                  checklist.setAnswer({
                    ...checklist.answer!,
                    isHiddenForReader: true,
                  });
                })
                .finally((): void => {
                  setIsHiding(false);
                });
            }}
            dataTestId="server-setup-card-hide"
          />
        </div>
      </div>
    </div>
  );
};

export default ServerSetupCard;

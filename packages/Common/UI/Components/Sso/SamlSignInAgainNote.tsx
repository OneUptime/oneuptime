import Icon from "../Icon/Icon";
import IsolatedText from "../IsolatedText/IsolatedText";
import Link from "../Link/Link";
import Column from "../ModelTable/Column";
import { drawsItsOwnLines } from "../Table/ColumnLineText";
import FieldType from "../Types/FieldType";
import SelectEntityField from "../../Types/SelectEntityField";
import { Translator, translationKey } from "../../Utils/TranslateTemplate";
import useTranslator from "../../Utils/UseTranslator";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Route from "../../../Types/API/Route";
import IconProp from "../../../Types/Icon/IconProp";
import {
  SamlProviderAddresses,
  SamlSignInAgainAdvice,
  getSamlSignInAgainAdvice,
} from "../../../Types/SSO/SamlSignInAgainAdvice";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * BESIDE A SAML PROVIDER: WHAT SIGN IN AGAIN NEEDS OF IT (#10530).
 *
 * One short line, in amber - something to look at, not something broken -
 * under a project's or the server's SAML provider whose issuer or sign-on
 * URL is Keycloak's or Okta's (Types/SSO/SamlSignInAgainAdvice says why
 * each), with Learn more opening the docs' table of what each identity
 * provider takes: the same section from the Dashboard and the Admin
 * Dashboard, as Global SSO's page sends its readers there too.
 *
 *   - Keycloak over SAML: Sign In Again cannot be checked through it, so
 *     add the realm as an OIDC provider instead - "OIDC Provider", as both
 *     SSO pages' Add button names one.
 *   - Okta: Honor Force Authentication to Yes, in the app's SAML settings,
 *     named as Okta's console names it.
 *
 * Nothing is drawn for any other provider. Drawn where the provider is
 * shown: its row on Settings > SSO, in the Dashboard and the Admin
 * Dashboard (getSamlProviderNameColumn), and under its issuer on a server
 * provider's own page. A status page's providers are left alone: nobody
 * signs in again through them.
 */

export const SAML_SIGN_IN_AGAIN_NOTE_TEST_ID: string =
  "saml-sign-in-again-note";

// What each line says, by the advice it gives.
export const SAML_SIGN_IN_AGAIN_NOTES: Record<SamlSignInAgainAdvice, string> = {
  [SamlSignInAgainAdvice.KeycloakCannotBeChecked]: translationKey(
    "Sign In Again can't be checked through Keycloak over SAML. Add this realm as an OIDC provider instead.",
  ),
  [SamlSignInAgainAdvice.TurnOnOktaHonorForceAuthentication]: translationKey(
    "For Sign In Again, set Honor Force Authentication to Yes in this app's SAML settings in Okta.",
  ),
};

export const SAML_SIGN_IN_AGAIN_LEARN_MORE: string =
  translationKey("Learn more");

// The docs' table of what Sign In Again takes of each identity provider.
export const SIGN_IN_AGAIN_DOCS_ROUTE: Route = Route.fromString(
  "/docs/identity/sso#signing-in-again-to-confirm-its-you",
);

export interface ComponentProps extends SamlProviderAddresses {
  className?: string | undefined;
}

const SamlSignInAgainNote: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const advice: SamlSignInAgainAdvice | null = getSamlSignInAgainAdvice({
    issuerURL: props.issuerURL,
    signOnURL: props.signOnURL,
  });

  if (!advice) {
    return <></>;
  }

  // A div, not a p: the icon draws a div of its own.
  return (
    <div
      role="note"
      data-testid={SAML_SIGN_IN_AGAIN_NOTE_TEST_ID}
      data-advice={advice}
      className={`flex items-start gap-1.5 whitespace-normal text-xs font-normal leading-5 text-amber-700 ${
        props.className || ""
      }`.trim()}
    >
      <div aria-hidden="true" className="mt-0.5 shrink-0 text-amber-500">
        <Icon icon={IconProp.Alert} className="h-3.5 w-3.5" />
      </div>
      <span className="min-w-0">
        {translator.translateText(SAML_SIGN_IN_AGAIN_NOTES[advice])}{" "}
        <Link
          to={SIGN_IN_AGAIN_DOCS_ROUTE}
          openInNewTab={true}
          className="font-medium text-amber-800 underline underline-offset-2 hover:text-amber-900"
          dataTestId={`${SAML_SIGN_IN_AGAIN_NOTE_TEST_ID}-docs`}
        >
          {translator.translateText(SAML_SIGN_IN_AGAIN_LEARN_MORE)}
        </Link>
      </span>
    </div>
  );
};

export default SamlSignInAgainNote;

// What a SAML provider's row holds, as a table reads it.
export interface SamlProviderRow extends SamlProviderAddresses {
  name?: string | undefined;
}

/*
 * A provider's name, as its administrator wrote it (IsolatedText: an
 * English name keeps its way on a Persian page), with the note under it
 * in the page's words, for a provider that needs one.
 */
export const SamlProviderNameCell: FunctionComponent<SamlProviderRow> = (
  props: SamlProviderRow,
): ReactElement => {
  return (
    <div className="space-y-1">
      <span className="block" data-testid="saml-provider-name">
        <IsolatedText text={props.name || ""} />
      </span>
      <SamlSignInAgainNote
        issuerURL={props.issuerURL}
        signOnURL={props.signOnURL}
      />
    </div>
  );
};

// What a SAML providers' table reads besides its columns, for the note.
export const SAML_SIGN_IN_AGAIN_SELECT: { issuerURL: true; signOnURL: true } = {
  issuerURL: true,
  signOnURL: true,
};

/*
 * The Name column of a project's or the server's SAML providers' table:
 * the name, with the note under it. It wraps, so the note is read whole,
 * and each of its lines reads its own way (drawsItsOwnLines). The table
 * selects the issuer and the sign-on URL too (SAML_SIGN_IN_AGAIN_SELECT).
 */
export const getSamlProviderNameColumn: <
  TEntity extends BaseModel,
>() => Column<TEntity> = <TEntity extends BaseModel>(): Column<TEntity> => {
  return {
    field: { name: true } as unknown as SelectEntityField<TEntity>,
    title: "Name",
    type: FieldType.Element,
    wrapContent: true,
    getExportValue: (item: TEntity): string => {
      return (item as unknown as SamlProviderRow).name || "";
    },
    getLineText: drawsItsOwnLines,
    getElement: (item: TEntity): ReactElement => {
      const row: SamlProviderRow = item as unknown as SamlProviderRow;

      return (
        <SamlProviderNameCell
          name={row.name}
          issuerURL={row.issuerURL}
          signOnURL={row.signOnURL}
        />
      );
    },
  };
};

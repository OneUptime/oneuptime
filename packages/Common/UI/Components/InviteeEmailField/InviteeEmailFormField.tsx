import InviteeEmailField from "./InviteeEmailField";
import TeamMember from "../../../Models/DatabaseModels/TeamMember";
import Email from "../../../Types/Email";
import { InviteSuggestion } from "../../../Types/Team/InviteSuggestions";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import { CustomElementProps } from "../Forms/Types/Field";
import FormValues from "../Forms/Types/FormValues";
import { FormValidationMessage } from "../Forms/Utils/FormValidationMessages";
import { translateValidationMessage } from "../Forms/Validation";
import React, { ReactElement } from "react";

/*
 * THE EMAIL ROW OF THE INVITATION FORMS (#9701): Invite New Team Member on
 * a team's Members page and Invite New User on Users - and their twins on
 * the Admin Dashboard's project pages (#9826), which name their project.
 * Each form keeps its row where it was, under its "email" key, and draws it
 * with InviteeEmailField - the form's text box, which suggests people as it
 * is typed in. Drawn by the form as its own element, the row is checked
 * here as an email row always was: an address that is not one is said
 * under the box, in the reader's language.
 */

// The address typed, as the form holds it under the row's key.
export const INVITEE_EMAIL_KEY: string = "email";

// What is wrong with the address typed, or null: none typed is the required check's.
export const getInviteeEmailError: (
  values: FormValues<TeamMember>,
) => string | null = (values: FormValues<TeamMember>): string | null => {
  const typed: unknown = (values as JSONObject)[INVITEE_EMAIL_KEY];

  if (typeof typed !== "string" || !typed.trim()) {
    return null;
  }

  return Email.isValid(typed.trim())
    ? null
    : translateValidationMessage(FormValidationMessage.InvalidEmail);
};

/*
 * The team a form's Team row holds, as an id: a dropdown keeps its pick as
 * an id, an ObjectID or the option's record. Null for none.
 */
export const readFormTeamId: (value: unknown) => string | null = (
  value: unknown,
): string | null => {
  if (!value) {
    return null;
  }

  if (value instanceof ObjectID) {
    return value.toString();
  }

  if (typeof value === "string") {
    return ObjectID.isValidUUID(value) ? value : null;
  }

  if (typeof value === "object" && !Array.isArray(value)) {
    const record: JSONObject = value as JSONObject;

    return (
      readFormTeamId(record["_id"]) ||
      readFormTeamId(record["value"]) ||
      readFormTeamId(record["id"])
    );
  }

  return null;
};

// The row's box, for a form's getCustomElement.
export const drawInviteeEmailField: (data: {
  customProps: CustomElementProps;
  teamId: string | null;
  /*
   * The project the invitation is to, from a page that works in no
   * project (the Admin Dashboard's forms). The Dashboard's leave it out.
   */
  projectId?: string | null | undefined;
  // A suggestion picked: someone with an account, whose name is known.
  onPick?: ((suggestion: InviteSuggestion) => void) | undefined;
}) => ReactElement = (data: {
  customProps: CustomElementProps;
  teamId: string | null;
  projectId?: string | null | undefined;
  onPick?: ((suggestion: InviteSuggestion) => void) | undefined;
}): ReactElement => {
  return (
    <InviteeEmailField
      initialValue={
        typeof data.customProps.initialValue === "string"
          ? data.customProps.initialValue
          : ""
      }
      onChange={(email: string) => {
        data.customProps.onChange?.(email);
      }}
      onBlur={data.customProps.onBlur}
      onEnterPress={data.customProps.onEnterPress}
      error={data.customProps.error}
      placeholder={data.customProps.placeholder}
      ariaLabelledby={data.customProps.ariaLabelledby}
      ariaDescribedby={data.customProps.ariaDescribedby}
      teamId={data.teamId}
      projectId={data.projectId}
      onPick={data.onPick}
      dataTestId="invitee-email"
    />
  );
};

import BaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import { JSONObject, JSONValue } from "Common/Types/JSON";
import JSONFunctions from "Common/Types/JSONFunctions";
import Image from "Common/UI/Components/Image/Image";
import BlankProfilePic from "Common/UI/Images/users/blank-profile.svg";
import User from "Common/Models/DatabaseModels/User";
import React, { FunctionComponent, ReactElement } from "react";
import UserUtil from "Common/UI/Utils/User";
import ObjectID from "Common/Types/ObjectID";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";

export interface ComponentProps {
  user?: User | JSONObject | undefined | null;
  prefix?: string | undefined;
  suffix?: string | undefined;
  suffixClassName?: string | undefined;
  usernameClassName?: string | undefined;
  prefixClassName?: string | undefined;
  emailClassName?: string | undefined;
  hideEmail?: boolean | undefined;
  /*
   * The person is no longer a member of the project (ProjectUserElement
   * finds out): their avatar fades and "No longer a member" takes the email's
   * line, so whoever looks after this setup knows to replace them. Nothing
   * of the project reaches them any more.
   */
  isNotProjectMember?: boolean | undefined;
  /*
   * The person was invited to the project and has not accepted yet: nothing
   * reaches them until they do, so "Invitation not accepted yet" takes the
   * email's line the same way.
   */
  hasPendingProjectInvitation?: boolean | undefined;
}

/*
 * The id of the user a UserElement is drawn for, whichever shape it arrived
 * in (model, serialized model, plain object).
 */
export const getUserElementUserId: (
  user: User | JSONObject | undefined | null,
) => ObjectID | null = (
  user: User | JSONObject | undefined | null,
): ObjectID | null => {
  if (user instanceof User) {
    return user.id || null;
  }

  for (const key of ["_id", "id"]) {
    const value: JSONValue | undefined = user?.[key];

    if (!value) {
      continue;
    }

    try {
      return new ObjectID(value.toString());
    } catch {
      return null;
    }
  }

  return null;
};

/*
 * A user can arrive here as a model instance (Name / Email objects), as the
 * serialized form of one ({_type: "Email", value: "..."}) or as a plain object
 * a caller hand-built from an API response (a bare string). Calling toString()
 * on the serialized shape yields "[object Object]", so unwrap it first.
 */
type ReadableValueFunction = (value: JSONValue | undefined) => string;

/*
 * The avatar never gives up its width. When this element is put somewhere
 * narrower than its text - a table column with a width cap - the row has to
 * shrink, and the text is what should (it truncates). Without this the avatar
 * shrinks with it: an image may not be wider than its box, so a 32px circle
 * becomes an 18px-wide sliver beside a name that is cut short anyway.
 */
const AVATAR_WRAPPER_CLASS_NAME: string = "shrink-0";

const readableValue: ReadableValueFunction = (
  value: JSONValue | undefined,
): string => {
  if (value === null || value === undefined) {
    return "";
  }

  if (typeof value === "object") {
    const serialized: JSONValue | undefined = (value as JSONObject)["value"];

    if ((value as JSONObject)["_type"] && serialized !== undefined) {
      return readableValue(serialized);
    }
  }

  return value.toString();
};

const UserElement: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  let user: JSONObject | null | undefined = null;

  if (props.user instanceof User) {
    user = BaseModel.toJSONObject(props.user, User);
  } else {
    user = props.user;
  }

  const getUserId: () => ObjectID | null = () => {
    if (props.user instanceof User) {
      return props.user.id || null;
    }

    if (user && user["_id"]) {
      try {
        return new ObjectID(user["_id"] as string);
      } catch {
        return null;
      }
    }

    if (user && user["id"]) {
      try {
        return new ObjectID(user["id"] as string);
      } catch {
        return null;
      }
    }

    return null;
  };

  const userId: ObjectID | null = getUserId();
  const profileImageUrl: string = userId
    ? UserUtil.getProfilePictureRoute(userId).toString()
    : BlankProfilePic;

  if (JSONFunctions.isEmptyObject(user)) {
    return (
      <div className="flex">
        <div className={AVATAR_WRAPPER_CLASS_NAME}>
          <Image
            className="h-8 w-8 rounded-full"
            imageUrl={BlankProfilePic}
            alt={"Automation"}
          />
        </div>
        <div className="mt-1 mr-1 ml-3">
          <div>
            <span
              className={props.prefixClassName ? props.prefixClassName : ""}
            >
              {props.prefix}
            </span>{" "}
            <span
              className={props.usernameClassName ? props.usernameClassName : ""}
            >
              {"OneUptime"}
            </span>{" "}
          </div>
        </div>
        {props.suffix && (
          <div>
            <p className={props.suffixClassName}>{props.suffix}</p>
          </div>
        )}
      </div>
    );
  }

  if (user) {
    const name: string = readableValue(user["name"]);
    const email: string = readableValue(user["email"]);

    /*
     * The name line already falls back to the email when there is no name, so
     * showing the email underneath as well would print it twice.
     */
    // Nothing of the project reaches them: the avatar fades, and the line says why.
    const isNotNotified: boolean = Boolean(
      props.isNotProjectMember || props.hasPendingProjectInvitation,
    );

    const showEmail: boolean = Boolean(
      !isNotNotified && !props.hideEmail && name && email && name !== email,
    );

    return (
      <div className="flex">
        <div
          className={`${AVATAR_WRAPPER_CLASS_NAME}${
            isNotNotified ? " opacity-50 grayscale" : ""
          }`}
        >
          <Image
            className="h-8 w-8 rounded-full"
            imageUrl={profileImageUrl}
            alt={name || "User"}
          />
        </div>
        <div className="mt-1 mr-1 ml-3 min-w-0">
          <div>
            <span
              className={props.prefixClassName ? props.prefixClassName : ""}
            >
              {props.prefix}
            </span>{" "}
            <span
              className={props.usernameClassName ? props.usernameClassName : ""}
            >{`${name || email}`}</span>{" "}
          </div>
          {showEmail && (
            <div
              data-testid="user-email"
              className={
                props.emailClassName
                  ? props.emailClassName
                  : "truncate text-xs text-gray-500"
              }
            >
              {email}
            </div>
          )}
          {props.isNotProjectMember && (
            <div
              data-testid="user-not-project-member"
              className="truncate text-xs font-medium text-amber-700"
            >
              {translator.translateText("No longer a member")}
            </div>
          )}
          {!props.isNotProjectMember && props.hasPendingProjectInvitation && (
            <div
              data-testid="user-project-invitation-pending"
              className="truncate text-xs font-medium text-amber-700"
            >
              {translator.translateText("Invitation not accepted yet")}
            </div>
          )}
        </div>
        {props.suffix && (
          <div>
            <p className={props.suffixClassName}>{props.suffix}</p>
          </div>
        )}
      </div>
    );
  }

  return <></>;
};

export default UserElement;

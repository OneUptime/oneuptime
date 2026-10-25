import IconProp from "Common/Types/Icon/IconProp";
import Icon from "Common/UI/Components/Icon/Icon";
import { getOwnersPeoplePickerConfig } from "Common/UI/Components/PeoplePicker/OwnersFormField";
import {
  PeopleSearchNotice,
  PeopleSearchNoticeTone,
} from "Common/UI/Components/PeoplePicker/PeopleSearchNotice";
import PeopleSearchPopup, {
  PEOPLE_SEARCH_POPUP_MAX_HEIGHT_PX,
  PEOPLE_SEARCH_POPUP_WIDTH_PX,
} from "Common/UI/Components/PeoplePicker/PeopleSearchPopup";
import {
  getPeoplePickerOptionKey,
  PeoplePickerFieldConfig,
  PeoplePickerOption,
} from "Common/UI/Components/PeoplePicker/PeoplePickerTypes";
import Tooltip from "Common/UI/Components/Tooltip/Tooltip";
import useAnchoredFieldPopup, {
  AnchoredFieldPopup,
  getAnchoredPopupTriggerProps,
} from "Common/UI/Types/UseAnchoredFieldPopup";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  ADD_OWNERS_TEXT,
  addOwner,
  getOwnerKindAccess,
  OWNER_ADDED_NOTICE,
  OwnerKindAccess,
  OwnersChange,
  OwnersTarget,
} from "./AddOwners";

/*
 * The Add owners list: the record's Owners page opens it from its Add owner
 * button, and every other place that names a record's owners - an
 * overview's header, a monitor's or an SLO's, a postmortem - opens the same
 * list from its own Add, right where it is, so nobody has to leave the page
 * to add an owner. One search box, the project's people and then its teams,
 * whoever owns the record already left out; one click adds an owner, and
 * the list stays open for the next, saying under itself what each pick did.
 * A kind the reader may not add is named locked, with why (AddOwners).
 *
 * Anchored to the control that opens it (useAddOwnersPopup) and drawn in a
 * portal, so it opens over a size-contained header as well as anywhere else.
 */

const OWNERS_PICKER_CONFIG: PeoplePickerFieldConfig =
  getOwnersPeoplePickerConfig();

export interface ComponentProps {
  popup: AnchoredFieldPopup;
  target: OwnersTarget;
  // The record's owners now (getOwnerKeys): the list leaves them out.
  ownerKeys: Set<string>;
  /*
   * After a pick was saved, or refused: the place reads the record's owners
   * again, so it shows the new one at once - and, after a refusal, whoever
   * added the same person a moment earlier. The pick's row stays busy until
   * a promise returned here settles.
   */
  onOwnersChanged?:
    | ((change: OwnersChange) => void | Promise<void>)
    | undefined;
  // The list's name, as the control that opened it is named. Default: Add owners.
  ariaLabel?: string | undefined;
}

/*
 * The list's open state and its placement, for the control that opens it:
 * repositionKey follows that control as owners are added in front of it.
 * Opened low on a phone's screen, the page scrolls to give the list its
 * height rather than a sliver (revealRoomOnOpen).
 */
export const useAddOwnersPopup: (
  repositionKey?: string | number | undefined,
) => AnchoredFieldPopup = (
  repositionKey?: string | number | undefined,
): AnchoredFieldPopup => {
  return useAnchoredFieldPopup({
    popupMaxHeight: PEOPLE_SEARCH_POPUP_MAX_HEIGHT_PX,
    popupWidth: PEOPLE_SEARCH_POPUP_WIDTH_PX,
    repositionKey: repositionKey,
    revealRoomOnOpen: true,
  });
};

/*
 * The next owner's place after a row of owners' avatars - a monitor's, an
 * SLO's, a postmortem's: a dashed circle with a plus, as big as the avatars
 * beside it (the Owners page's "+", at a row's size), that opens the Add
 * owners list under it. The open list lights it, so it is clear which
 * control the list belongs to.
 */
export const ADD_OWNERS_PLACE_CLASS_NAME: string =
  "inline-flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full border border-dashed transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-1";

export const ADD_OWNERS_PLACE_IDLE_CLASS_NAME: string =
  "border-gray-300 bg-white text-gray-400 hover:border-indigo-500 hover:bg-indigo-50 hover:text-indigo-600";

export const ADD_OWNERS_PLACE_OPEN_CLASS_NAME: string =
  "border-indigo-500 bg-indigo-50 text-indigo-600";

export interface AddOwnersPlaceButtonProps {
  popup: AnchoredFieldPopup;
  dataTestId?: string | undefined;
}

export const AddOwnersPlaceButton: FunctionComponent<
  AddOwnersPlaceButtonProps
> = (props: AddOwnersPlaceButtonProps): ReactElement => {
  const translator: Translator = useTranslator();
  const text: string =
    translator.translateText(ADD_OWNERS_TEXT) || ADD_OWNERS_TEXT;

  return (
    <div ref={props.popup.anchorRef} className="inline-flex">
      <Tooltip text={text}>
        <button
          type="button"
          data-testid={props.dataTestId}
          aria-label={text}
          {...getAnchoredPopupTriggerProps(props.popup)}
          className={`${ADD_OWNERS_PLACE_CLASS_NAME} ${
            props.popup.isPopupOpen
              ? ADD_OWNERS_PLACE_OPEN_CLASS_NAME
              : ADD_OWNERS_PLACE_IDLE_CLASS_NAME
          }`}
        >
          <Icon icon={IconProp.Add} className="h-3.5 w-3.5" />
        </button>
      </Tooltip>
    </div>
  );
};

const AddOwnersPopup: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement | null => {
  const translator: Translator = useTranslator();
  const isOpen: boolean = props.popup.isPopupOpen;
  const resourceIdString: string = props.target.resourceId.toString();

  /*
   * Who was added from this opening of the list, left out at once - before
   * the place has read its owners again - so a row just added cannot be
   * picked a second time while that read is on its way.
   */
  const [addedKeys, setAddedKeys] = useState<Set<string>>(new Set<string>());

  useEffect(() => {
    setAddedKeys(new Set<string>());
  }, [isOpen, resourceIdString]);

  const selectedKeys: Set<string> = useMemo((): Set<string> => {
    return new Set<string>([...props.ownerKeys, ...addedKeys]);
  }, [props.ownerKeys, addedKeys]);

  const access: OwnerKindAccess = getOwnerKindAccess(props.target);

  const onPick: (
    option: PeoplePickerOption,
  ) => Promise<Array<PeopleSearchNotice>> = async (
    option: PeoplePickerOption,
  ): Promise<Array<PeopleSearchNotice>> => {
    try {
      await addOwner(props.target, option);
    } catch (err) {
      /*
       * Refused - a second row for an owner somebody added meanwhile, an
       * Owned-only role on a record it does not own: the owners are read
       * again, so the place shows them as they are, and the list says why.
       */
      void Promise.resolve(props.onOwnersChanged?.({ wasAdded: false })).catch(
        () => {
          // The read records its own failure.
        },
      );
      throw err;
    }

    setAddedKeys((current: Set<string>): Set<string> => {
      const next: Set<string> = new Set<string>(current);
      next.add(getPeoplePickerOptionKey(option.kind, option.id));
      return next;
    });

    try {
      await props.onOwnersChanged?.({ wasAdded: true });
    } catch {
      // Added all the same: the place says what its own read came to.
    }

    return [
      {
        tone: PeopleSearchNoticeTone.Done,
        text: translator.translateTemplate(OWNER_ADDED_NOTICE, {
          name: option.name,
        }),
      },
    ];
  };

  return (
    <PeopleSearchPopup
      popup={props.popup}
      kinds={access.kinds}
      lockedKinds={access.locked}
      selectedKeys={selectedKeys}
      selectionMode="add"
      onPick={onPick}
      searchPlaceholder={OWNERS_PICKER_CONFIG.searchPlaceholder}
      emptyText={OWNERS_PICKER_CONFIG.emptyText}
      ariaLabel={props.ariaLabel || ADD_OWNERS_TEXT}
    />
  );
};

export default AddOwnersPopup;

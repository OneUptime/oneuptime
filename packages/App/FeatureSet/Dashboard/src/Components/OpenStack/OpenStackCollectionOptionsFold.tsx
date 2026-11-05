import ObjectID from "Common/Types/ObjectID";
import { JSONObject } from "Common/Types/JSON";
import { OpenStackCollectionOptions } from "Common/Types/OpenStack/OpenStackProbeCollection";
import OpenStackCloud from "Common/Models/DatabaseModels/OpenStackCloud";
import Button, {
  ButtonSize,
  ButtonStyleType,
} from "Common/UI/Components/Button/Button";
import FoldedSection from "Common/UI/Components/FoldedSection/FoldedSection";
import {
  FOLDED_SECTION_ON,
  FoldedSectionItem,
} from "Common/UI/Components/FoldedSection/FoldedSectionItem";
import { FOLDED_SECTION_LINE } from "Common/UI/Components/FoldedSection/FoldedSectionVariant";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import {
  bringPageAnchorIntoView,
  getPageAnchor,
  markPageAnchorLanded,
} from "Common/UI/Utils/PageAnchor";
import React, {
  FunctionComponent,
  MutableRefObject,
  ReactElement,
  useEffect,
  useRef,
  useState,
} from "react";
import { OpenStackCollectionOptionsField } from "./OpenStackConnectionFields";
import {
  OPENSTACK_COLLECTION_OPTIONS_ANCHOR,
  readOpenStackOptions,
  validateOpenStackOptions,
} from "./OpenStackProbeCollectionView";

/*
 * What a collection reads beyond the defaults, on the Settings page's Data Collection card.
 * Most clouds never need either, and each costs the cloud more, so they are folded, with what is
 * on still said on the fold's line: nothing in force is hidden.
 *
 * The Projects page sends people here for Project limits, by the name of this place after the
 * address's "#", so a link that names it finds it open and in view rather than folded away.
 */

export interface ComponentProps {
  modelId: ObjectID;
  saved: unknown;
  canEdit: boolean;
  // Read the cloud again, once a change is saved.
  onSaved: () => Promise<void>;
}

const OpenStackCollectionOptionsFold: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [options, setOptions] = useState<OpenStackCollectionOptions>(
    readOpenStackOptions(props.saved),
  );
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [error, setError] = useState<string>("");

  const isOpenedHere: boolean =
    getPageAnchor() === OPENSTACK_COLLECTION_OPTIONS_ANCHOR;
  const [isFolded, setIsFolded] = useState<boolean>(!isOpenedHere);

  const placeRef: MutableRefObject<HTMLDivElement | null> =
    useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!isOpenedHere || !placeRef.current) {
      return undefined;
    }

    const stopBringingIntoView: () => void = bringPageAnchorIntoView(
      placeRef.current,
    );
    const unmark: () => void = markPageAnchorLanded(placeRef.current);

    return (): void => {
      stopBringingIntoView();
      unmark();
    };
  }, []);

  const savedOptions: OpenStackCollectionOptions = readOpenStackOptions(
    props.saved,
  );
  const isChanged: boolean =
    JSON.stringify(readOpenStackOptions(options)) !==
    JSON.stringify(savedOptions);

  const save: () => void = (): void => {
    // Said here, where the list was typed: the server would refuse it in the same words.
    const refusal: string | null = validateOpenStackOptions(options);

    if (refusal) {
      setError(refusal);
      return;
    }

    setIsSaving(true);
    setError("");
    ModelAPI.updateById({
      modelType: OpenStackCloud,
      id: props.modelId,
      data: {
        collectionOptions: readOpenStackOptions(options) as JSONObject,
      },
    })
      .then(() => {
        return props.onSaved();
      })
      .catch((err: Error) => {
        setError(API.getFriendlyErrorMessage(err));
      })
      .finally(() => {
        setIsSaving(false);
      });
  };

  const items: Array<FoldedSectionItem> = [
    {
      key: "project-limits",
      title: "Project limits",
      isSet: Boolean(savedOptions.collectProjectLimits),
      value: FOLDED_SECTION_ON,
      translateValue: true,
    },
    {
      key: "ports",
      title: "Ports",
      isSet: Boolean(savedOptions.collectPorts),
      value: FOLDED_SECTION_ON,
      translateValue: true,
    },
  ];

  return (
    <div
      ref={placeRef}
      id={OPENSTACK_COLLECTION_OPTIONS_ANCHOR}
      className="mt-6 border-t border-gray-200 pt-4"
      data-testid="openstack-collection-options"
      tabIndex={-1}
    >
      <FoldedSection
        title="What it reads beyond the defaults"
        variant={FOLDED_SECTION_LINE}
        items={items}
        isCollapsed={isFolded}
        onToggle={(isCollapsed: boolean): void => {
          setIsFolded(isCollapsed);
        }}
        dataTestId="openstack-collection-options-fold"
      >
        <div className="pt-3">
          <OpenStackCollectionOptionsField
            value={options}
            disabled={!props.canEdit || isSaving}
            onChange={(value: OpenStackCollectionOptions) => {
              setError("");
              setOptions(value);
            }}
          />
          {props.canEdit && isChanged ? (
            <div className="mt-3 flex justify-end">
              <Button
                title="Save Options"
                buttonStyle={ButtonStyleType.NORMAL}
                buttonSize={ButtonSize.Small}
                isLoading={isSaving}
                dataTestId="openstack-save-collection-options"
                onClick={save}
              />
            </div>
          ) : (
            <></>
          )}
          {error ? (
            <p className="mt-2 text-sm text-red-700" role="alert">
              {error}
            </p>
          ) : (
            <></>
          )}
        </div>
      </FoldedSection>
    </div>
  );
};

export default OpenStackCollectionOptionsFold;

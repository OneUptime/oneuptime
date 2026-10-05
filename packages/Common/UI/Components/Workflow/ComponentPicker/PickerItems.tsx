import Icon from "../../Icon/Icon";
import IconProp from "../../../../Types/Icon/IconProp";
import ComponentMetadata, {
  ComponentType,
} from "../../../../Types/Workflow/Component";
import { HighlightSegment } from "./ComponentSearch";
import { PickerResource } from "./PickerCatalog";
import React, { FunctionComponent, ReactElement } from "react";
import {
  translatableTerm,
  translatePlural,
  Translator,
} from "../../../Utils/TranslateTemplate";
import useTranslator from "../../../Utils/UseTranslator";

/*
 * The pieces the Add Component / Add Trigger picker is drawn from. Colours
 * are Tailwind classes Theme.css re-colours for the dark theme; the guard in
 * Tests/UI/Components/Workflow/ComponentPicker holds them to that.
 */

/*
 * Every focusable entry of a browse view carries this attribute, so the
 * arrow keys can move between them; see ComponentsModal.
 */
export const PICKER_ITEM_ATTRIBUTE: string = "data-picker-item";

export type GetPickerItemPropsFunction = (key: string) => {
  [PICKER_ITEM_ATTRIBUTE]: string;
};

export const getPickerItemProps: GetPickerItemPropsFunction = (
  key: string,
): { [PICKER_ITEM_ATTRIBUTE]: string } => {
  return { [PICKER_ITEM_ATTRIBUTE]: key };
};

export type ComponentItemKeyFunction = (
  componentMetadata: ComponentMetadata,
) => string;

export const componentItemKey: ComponentItemKeyFunction = (
  componentMetadata: ComponentMetadata,
): string => {
  return `component:${componentMetadata.id}`;
};

export type ResourceItemKeyFunction = (resource: PickerResource) => string;

export const resourceItemKey: ResourceItemKeyFunction = (
  resource: PickerResource,
): string => {
  return `resource:${resource.key}`;
};

export const ALL_RESOURCES_ITEM_KEY: string = "all-resources";

export type CountLabelFunction = (
  count: number,
  componentsType: ComponentType,
) => string;

// "8 actions", "1 action", "3 triggers".
export const getStepCountLabel: CountLabelFunction = (
  count: number,
  componentsType: ComponentType,
): string => {
  return componentsType === ComponentType.Trigger
    ? translatePlural(
        { one: "{{count}} trigger", other: "{{count}} triggers" },
        count,
      )
    : translatePlural(
        { one: "{{count}} action", other: "{{count}} actions" },
        count,
      );
};

const FOCUS_RING: string =
  "focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500";

interface IconBoxProps {
  icon: IconProp;
  size?: "small" | "regular" | "large";
}

export const IconBox: FunctionComponent<IconBoxProps> = (
  props: IconBoxProps,
): ReactElement => {
  let boxClass: string = "h-9 w-9 rounded-lg";
  let iconClass: string = "h-4 w-4";

  if (props.size === "small") {
    boxClass = "h-7 w-7 rounded-md";
    iconClass = "h-3.5 w-3.5";
  } else if (props.size === "large") {
    boxClass = "h-11 w-11 rounded-xl";
    iconClass = "h-5 w-5";
  }

  return (
    <div
      aria-hidden="true"
      className={`flex flex-shrink-0 items-center justify-center bg-gray-100 text-gray-600 ${boxClass}`}
    >
      <Icon icon={props.icon} className={iconClass} />
    </div>
  );
};

interface HighlightedTextProps {
  segments: Array<HighlightSegment>;
}

// The matched parts of a search result's title, in bold.
export const HighlightedText: FunctionComponent<HighlightedTextProps> = (
  props: HighlightedTextProps,
): ReactElement => {
  return (
    <>
      {props.segments.map((segment: HighlightSegment, index: number) => {
        if (!segment.isMatch) {
          return <React.Fragment key={index}>{segment.text}</React.Fragment>;
        }

        return (
          <mark
            key={index}
            className="bg-transparent font-semibold text-indigo-700"
          >
            {segment.text}
          </mark>
        );
      })}
    </>
  );
};

interface ComponentTileProps {
  componentMetadata: ComponentMetadata;
  onSelect: (componentMetadata: ComponentMetadata) => void;
}

/*
 * A step in a browse view. One click adds it to the workflow: picking is
 * the whole job of this panel, so there is no second "Add" button to find.
 */
export const ComponentTile: FunctionComponent<ComponentTileProps> = (
  props: ComponentTileProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const descriptionId: string = `workflow-picker-description-${props.componentMetadata.id}`;

  return (
    <button
      type="button"
      {...getPickerItemProps(componentItemKey(props.componentMetadata))}
      aria-label={translator.translateText(props.componentMetadata.title)}
      aria-describedby={descriptionId}
      onClick={() => {
        props.onSelect(props.componentMetadata);
      }}
      className={`flex w-full items-start gap-3 rounded-lg border border-gray-200 bg-white p-3 text-left transition-colors duration-150 hover:border-indigo-300 hover:bg-indigo-50 ${FOCUS_RING}`}
    >
      <IconBox icon={props.componentMetadata.iconProp} />
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium text-gray-900">
          {translator.translateText(props.componentMetadata.title)}
        </div>
        <div
          id={descriptionId}
          className="mt-0.5 line-clamp-2 text-xs leading-5 text-gray-500"
        >
          {translator.translateText(props.componentMetadata.description)}
        </div>
      </div>
    </button>
  );
};

interface ResourceTileProps {
  resource: PickerResource;
  componentsType: ComponentType;
  onOpen: (resource: PickerResource) => void;
}

// A resource on the start view: opens the list of what can be done with it.
export const ResourceTile: FunctionComponent<ResourceTileProps> = (
  props: ResourceTileProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const countLabel: string = getStepCountLabel(
    props.resource.components.length,
    props.componentsType,
  );

  return (
    <button
      type="button"
      {...getPickerItemProps(resourceItemKey(props.resource))}
      aria-label={translator.translateTemplate("{{name}}, {{count}}", {
        name: translatableTerm(props.resource.name),
        count: countLabel,
      })}
      onClick={() => {
        props.onOpen(props.resource);
      }}
      className={`flex w-full items-center gap-3 rounded-lg border border-gray-200 bg-white px-3 py-2.5 text-left transition-colors duration-150 hover:border-indigo-300 hover:bg-indigo-50 ${FOCUS_RING}`}
    >
      <IconBox icon={props.resource.icon} size="small" />
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium text-gray-900">
          {translator.translateText(props.resource.name)}
        </div>
        <div className="text-xs text-gray-500">{countLabel}</div>
      </div>
      <Icon
        icon={IconProp.ChevronRight}
        className="h-4 w-4 flex-shrink-0 text-gray-400"
      />
    </button>
  );
};

interface ResourceRowProps {
  resource: PickerResource;
  componentsType: ComponentType;
  onOpen: (resource: PickerResource) => void;
}

// A resource in the A to Z list of every resource.
export const ResourceRow: FunctionComponent<ResourceRowProps> = (
  props: ResourceRowProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const countLabel: string = getStepCountLabel(
    props.resource.components.length,
    props.componentsType,
  );

  return (
    <button
      type="button"
      {...getPickerItemProps(resourceItemKey(props.resource))}
      aria-label={
        props.resource.disambiguation
          ? translator.translateTemplate("{{name}} ({{detail}}), {{count}}", {
              name: translatableTerm(props.resource.name),
              detail: translatableTerm(props.resource.disambiguation),
              count: countLabel,
            })
          : translator.translateTemplate("{{name}}, {{count}}", {
              name: translatableTerm(props.resource.name),
              count: countLabel,
            })
      }
      onClick={() => {
        props.onOpen(props.resource);
      }}
      className={`flex w-full items-center gap-3 px-3 py-2 text-left transition-colors duration-150 hover:bg-gray-50 ${FOCUS_RING} focus-visible:ring-inset`}
    >
      <IconBox icon={props.resource.icon} size="small" />
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm text-gray-900">
          {translator.translateText(props.resource.name)}
        </div>
        {props.resource.disambiguation && (
          <div className="truncate text-xs text-gray-500">
            {translator.translateText(props.resource.disambiguation)}
          </div>
        )}
      </div>
      <span className="flex-shrink-0 text-xs text-gray-500">{countLabel}</span>
      <Icon
        icon={IconProp.ChevronRight}
        className="h-4 w-4 flex-shrink-0 text-gray-400"
      />
    </button>
  );
};

interface BackButtonProps {
  label: string;
  onBack: () => void;
}

export const BackButton: FunctionComponent<BackButtonProps> = (
  props: BackButtonProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  return (
    <button
      type="button"
      onClick={props.onBack}
      className={`-ml-1 inline-flex items-center gap-1 rounded-md px-1 py-1 text-sm font-medium text-gray-600 transition-colors duration-150 hover:text-gray-900 ${FOCUS_RING}`}
    >
      <Icon icon={IconProp.ChevronLeft} className="h-4 w-4" />
      {translator.translateText(props.label)}
    </button>
  );
};

interface SectionHeadingProps {
  id: string;
  title: string;
  description?: string | undefined;
}

export const SectionHeading: FunctionComponent<SectionHeadingProps> = (
  props: SectionHeadingProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  return (
    <div className="mb-2 px-0.5">
      <h3
        id={props.id}
        className="text-xs font-semibold uppercase tracking-wide text-gray-500"
      >
        {translator.translateText(props.title)}
      </h3>
      {props.description && (
        <p className="mt-1 text-sm text-gray-500">
          {translator.translateText(props.description)}
        </p>
      )}
    </div>
  );
};

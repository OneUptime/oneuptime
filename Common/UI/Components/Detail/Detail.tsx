import AlignItem from "../../Types/AlignItem";
import { Logger } from "../../Utils/Logger";
import useTranslateValue from "../../Utils/Translation";
import CodeBlock from "../CodeBlock/CodeBlock";
import ColorViewer from "../ColorViewer/ColorViewer";
import CopyableButton from "../CopyableButton/CopyableButton";
import DictionaryOfStringsViewer from "../Dictionary/DictionaryOfStingsViewer";
import { DropdownOption, DropdownOptionGroup } from "../Dropdown/Dropdown";
import DropdownValueBadge from "../Dropdown/DropdownValueBadge";
import HiddenText from "../HiddenText/HiddenText";
import MarkdownViewer from "../Markdown.tsx/LazyMarkdownViewer";
import ObjectIDView from "../ObjectID/ObjectIDView";
import FieldType from "../Types/FieldType";
import Field from "./Field";
import FieldLabelElement from "./FieldLabel";
import PlaceholderText from "./PlaceholderText";
import FileModel from "../../../Models/DatabaseModels/DatabaseBaseModel/FileModel";
import Color from "../../../Types/Color";
import DatabaseProperty from "../../../Types/Database/DatabaseProperty";
import OneUptimeDate from "../../../Types/Date";
import Dictionary from "../../../Types/Dictionary";
import BadDataException from "../../../Types/Exception/BadDataException";
import GenericObject from "../../../Types/GenericObject";
import React, { ReactElement, useEffect, useState } from "react";

export enum DetailStyle {
  Default = "default",
  Card = "card",
  Minimal = "minimal",
}

export interface ComponentProps<T extends GenericObject> {
  item: T;
  fields: Array<Field<T>>;
  id?: string | undefined;
  showDetailsInNumberOfColumns?: number | undefined;
  style?: DetailStyle | undefined;
}

type DetailFunction = <T extends GenericObject>(
  props: ComponentProps<T>,
) => ReactElement;

const Detail: DetailFunction = <T extends GenericObject>(
  props: ComponentProps<T>,
): ReactElement => {
  const { translateString } = useTranslateValue();
  // Track mobile view for responsive behavior
  const [isMobile, setIsMobile] = useState<boolean>(false);

  useEffect(() => {
    const checkMobile: () => void = (): void => {
      setIsMobile(window.innerWidth < 768); // md breakpoint
    };

    checkMobile();
    window.addEventListener("resize", checkMobile);

    return () => {
      window.removeEventListener("resize", checkMobile);
    };
  }, []);

  type GetMarkdownViewerFunction = (text: string) => ReactElement;

  const getMarkdownViewer: GetMarkdownViewerFunction = (
    text: string,
  ): ReactElement => {
    if (!text) {
      return <></>;
    }

    return <MarkdownViewer text={text} />;
  };

  type GetDropdownViewerFunction = (
    data: string,
    options: Array<DropdownOption | DropdownOptionGroup>,
    placeholder: string,
  ) => ReactElement;

  const getDropdownViewer: GetDropdownViewerFunction = (
    data: string,
    options: Array<DropdownOption | DropdownOptionGroup>,
    placeholder: string,
  ): ReactElement => {
    if (!options) {
      return (
        <span className="text-gray-400 italic text-sm">
          {translateString("No options found") ?? "No options found"}
        </span>
      );
    }

    const flatOptions: Array<DropdownOption> = options.flatMap(
      (item: DropdownOption | DropdownOptionGroup) => {
        if ("options" in item && Array.isArray(item.options)) {
          return item.options;
        }
        return [item as DropdownOption];
      },
    );

    const selectedOption: DropdownOption | undefined = flatOptions.find(
      (i: DropdownOption) => {
        return i.value === data;
      },
    );

    if (!selectedOption) {
      return (
        <span className="text-gray-400 italic text-sm">{placeholder}</span>
      );
    }

    return (
      <DropdownValueBadge
        label={selectedOption.label as string}
        color={selectedOption.color}
      />
    );
  };

  type GetMultiSelectDropdownViewerFunction = (
    data: Array<string | number | boolean> | string,
    options: Array<DropdownOption | DropdownOptionGroup>,
    placeholder: string,
  ) => ReactElement;

  const getMultiSelectDropdownViewer: GetMultiSelectDropdownViewerFunction = (
    data: Array<string | number | boolean> | string,
    options: Array<DropdownOption | DropdownOptionGroup>,
    placeholder: string,
  ): ReactElement => {
    const values: Array<string | number | boolean> = Array.isArray(data)
      ? data
      : typeof data === "string" && data.length > 0
        ? [data]
        : [];

    if (values.length === 0) {
      return (
        <span className="text-gray-400 italic text-sm">{placeholder}</span>
      );
    }

    const flatOptions: Array<DropdownOption> = (options || []).flatMap(
      (item: DropdownOption | DropdownOptionGroup) => {
        if ("options" in item && Array.isArray(item.options)) {
          return item.options;
        }
        return [item as DropdownOption];
      },
    );

    return (
      <div className="flex flex-wrap gap-1.5">
        {values.map(
          (value: string | number | boolean, index: number): ReactElement => {
            const matched: DropdownOption | undefined = flatOptions.find(
              (option: DropdownOption) => {
                return option.value === value;
              },
            );
            const label: string = matched
              ? (matched.label as string)
              : String(value);
            return (
              <DropdownValueBadge
                key={`${String(value)}-${index}`}
                label={label}
                color={matched?.color}
              />
            );
          },
        )}
      </div>
    );
  };

  /*
   * Relation columns arrive as whole model instances. React throws (and takes
   * the entire page down with it) when handed one as a child, so every object
   * that reaches the renderer is reduced to a label with these keys, in order.
   */
  const entityLabelKeys: Array<string> = [
    "name",
    "title",
    "label",
    "email",
    "slug",
    "value",
  ];

  type GetEntityLabelFunction = (entity: unknown) => string;

  const getEntityLabel: GetEntityLabelFunction = (entity: unknown): string => {
    if (entity === null || entity === undefined) {
      return "";
    }

    if (entity instanceof DatabaseProperty) {
      return entity.toString();
    }

    if (typeof entity !== "object") {
      return String(entity);
    }

    for (const key of entityLabelKeys) {
      const value: unknown = (entity as Dictionary<unknown>)[key];

      if (value === null || value === undefined || value === "") {
        continue;
      }

      if (value instanceof DatabaseProperty) {
        return value.toString();
      }

      if (typeof value !== "object") {
        return String(value);
      }
    }

    return "";
  };

  type GetEntityColorFunction = (entity: unknown) => Color | string | undefined;

  const getEntityColor: GetEntityColorFunction = (
    entity: unknown,
  ): Color | string | undefined => {
    if (!entity || typeof entity !== "object") {
      return undefined;
    }

    const color: unknown = (entity as Dictionary<unknown>)["color"];

    if (color instanceof Color || typeof color === "string") {
      return color;
    }

    return undefined;
  };

  type GetEntityViewerFunction = (entity: unknown) => ReactElement | string;

  const getEntityViewer: GetEntityViewerFunction = (
    entity: unknown,
  ): ReactElement | string => {
    const label: string = getEntityLabel(entity);

    if (!label) {
      // Fall through to the placeholder the field already declares.
      return "";
    }

    return <DropdownValueBadge label={label} color={getEntityColor(entity)} />;
  };

  type GetEntityArrayViewerFunction = (
    entities: Array<unknown>,
  ) => ReactElement | string;

  const getEntityArrayViewer: GetEntityArrayViewerFunction = (
    entities: Array<unknown>,
  ): ReactElement | string => {
    const labelled: Array<{ label: string; entity: unknown }> = entities
      .map((entity: unknown) => {
        return { label: getEntityLabel(entity), entity: entity };
      })
      .filter((item: { label: string; entity: unknown }) => {
        return Boolean(item.label);
      });

    if (labelled.length === 0) {
      return "";
    }

    return (
      <div className="flex flex-wrap gap-1.5">
        {labelled.map(
          (
            item: { label: string; entity: unknown },
            index: number,
          ): ReactElement => {
            return (
              <DropdownValueBadge
                key={`${item.label}-${index}`}
                label={item.label}
                color={getEntityColor(item.entity)}
              />
            );
          },
        )}
      </div>
    );
  };

  type GetDictionaryOfStringsViewerFunction = (
    data: Dictionary<string>,
  ) => ReactElement;

  const getDictionaryOfStringsViewer: GetDictionaryOfStringsViewerFunction = (
    data: Dictionary<string>,
  ): ReactElement => {
    return <DictionaryOfStringsViewer value={data} />;
  };

  type GetColorFieldFunction = (color: Color) => ReactElement;

  const getColorField: GetColorFieldFunction = (color: Color): ReactElement => {
    return <ColorViewer value={color} />;
  };

  type GetUSDCentsFieldFunction = (usdCents: number | null) => ReactElement;

  const getUSDCentsField: GetUSDCentsFieldFunction = (
    usdCents: number | null,
  ): ReactElement => {
    if (usdCents === null) {
      return <></>;
    }

    const formattedAmount: string = (usdCents / 100).toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });

    return (
      <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-emerald-50 border border-emerald-100">
        <svg
          className="w-4 h-4 text-emerald-600"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={1.5}
            d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
          />
        </svg>
        <span className="font-semibold text-emerald-700">
          ${formattedAmount}
        </span>
        <span className="text-xs text-emerald-600 uppercase tracking-wide font-medium">
          USD
        </span>
      </div>
    );
  };

  type GetMinutesFieldFunction = (minutes: number | null) => ReactElement;

  const getMinutesField: GetMinutesFieldFunction = (
    minutes: number | null,
  ): ReactElement => {
    if (minutes === null) {
      return <></>;
    }

    return (
      <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-blue-50 border border-blue-100">
        <svg
          className="w-4 h-4 text-blue-600"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={1.5}
            d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
          />
        </svg>
        <span className="font-semibold text-blue-700">{minutes}</span>
        <span className="text-xs text-blue-600 font-medium">
          {minutes > 1 ? "minutes" : "minute"}
        </span>
      </div>
    );
  };

  type GetFieldFunction = (field: Field<T>, index: number) => ReactElement;

  // Helper function to get nested property values using dot notation
  const getNestedValue: (obj: any, path: string) => any = (
    obj: any,
    path: string,
  ): any => {
    return path.split(".").reduce((current: any, key: string) => {
      return current?.[key];
    }, obj);
  };

  const getField: GetFieldFunction = (
    field: Field<T>,
    index: number,
  ): ReactElement => {
    const fieldKey: keyof T | null = field.key;

    if (!fieldKey) {
      return <></>;
    }

    if (!props.item) {
      throw new BadDataException("Item not found");
    }

    let data: string | ReactElement = "";

    // Use helper function for both simple and nested property access
    const fieldKeyStr: string = String(fieldKey);
    const value: any = getNestedValue(props.item, fieldKeyStr);
    if (value !== undefined && value !== null) {
      data = value;
    }

    if (field.fieldType === FieldType.Date) {
      if (data) {
        const formattedDate: string =
          OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(
            data as string,
            true,
          );
        data = (
          <span className="inline-flex items-center gap-2 text-gray-700">
            <svg
              className="w-4 h-4 text-gray-400"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.5}
                d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"
              />
            </svg>
            <span className="font-medium">{formattedDate}</span>
          </span>
        );
      } else {
        data = field.placeholder || "-";
      }
    }

    if (field.fieldType === FieldType.Boolean) {
      if (data) {
        data = (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-green-50 text-green-700 text-sm font-medium">
            <span className="w-1.5 h-1.5 rounded-full bg-green-500"></span>
            Yes
          </span>
        );
      } else {
        data = (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-gray-100 text-gray-600 text-sm font-medium">
            <span className="w-1.5 h-1.5 rounded-full bg-gray-400"></span>
            No
          </span>
        );
      }
    }

    if (field.fieldType === FieldType.DateTime) {
      if (data) {
        const formattedDateTime: string =
          OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(
            data as string,
            false,
          );
        data = (
          <span className="inline-flex items-center gap-2 text-gray-700">
            <svg
              className="w-4 h-4 text-gray-400"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.5}
                d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
            <span className="font-medium">{formattedDateTime}</span>
          </span>
        );
      } else {
        data = field.placeholder || "-";
      }
    }

    if (data && field.fieldType === FieldType.Color) {
      if (data instanceof Color) {
        data = getColorField(data);
      }
    }

    if (data && field.fieldType === FieldType.USDCents) {
      let usdCents: number | null = null;

      if (typeof data === "string") {
        usdCents = parseInt(data);
      }

      if (typeof data === "number") {
        usdCents = data;
      }

      data = getUSDCentsField(usdCents);
    }

    if (data && field.fieldType === FieldType.Minutes) {
      let minutes: number | null = null;

      if (typeof data === "string") {
        minutes = parseInt(data);
      }

      if (typeof data === "number") {
        minutes = data;
      }

      data = getMinutesField(minutes);
    }

    if (data && field.fieldType === FieldType.DictionaryOfStrings) {
      data = getDictionaryOfStringsViewer(
        props.item[fieldKey] as Dictionary<string>,
      );
    }

    if (data && field.fieldType === FieldType.ArrayOfText) {
      data = (data as any).join(", ");
    }

    if (!data && field.fieldType === FieldType.Color && field.placeholder) {
      data = getColorField(new Color(field.placeholder));
    }

    if (field.fieldType === FieldType.ImageFile) {
      if (
        props.item[fieldKey] &&
        (props.item[fieldKey] as unknown as FileModel).file &&
        (props.item[fieldKey] as unknown as FileModel).fileType
      ) {
        const blob: Blob = new Blob(
          [
            (props.item[fieldKey] as unknown as FileModel).file!
              .buffer as ArrayBuffer,
          ],
          {
            type: (props.item[fieldKey] as unknown as FileModel)
              .fileType as string,
          },
        );

        const url: string = URL.createObjectURL(blob);

        data = (
          <div className="group/image relative inline-block">
            <div className="overflow-hidden rounded-xl shadow-md border border-gray-200 bg-white p-1">
              <img
                src={url}
                className="rounded-lg object-cover transition-all duration-300 hover:scale-105"
                style={{
                  height: "100px",
                }}
                alt={field.title ? `${field.title} image` : "Uploaded image"}
              />
            </div>
          </div>
        );
      } else {
        data = "";
      }
    }

    if (field.fieldType === FieldType.Markdown) {
      if (data) {
        data = getMarkdownViewer(data as string);
      }
    }

    if (field.fieldType === FieldType.Dropdown) {
      data = getDropdownViewer(
        data as string,
        field.dropdownOptions || [],
        field.placeholder as string,
      );
    }

    if (field.fieldType === FieldType.MultiSelectDropdown) {
      data = getMultiSelectDropdownViewer(
        data as Array<string | number | boolean> | string,
        field.dropdownOptions || [],
        field.placeholder as string,
      );
    }

    if (data && field.fieldType === FieldType.Entity) {
      data = getEntityViewer(data);
    }

    if (data && field.fieldType === FieldType.EntityArray) {
      data = getEntityArrayViewer(
        Array.isArray(data) ? (data as Array<unknown>) : [data],
      );
    }

    if (data && field.fieldType === FieldType.HiddenText) {
      data = (
        <HiddenText
          isCopyable={field.opts?.isCopyable || false}
          text={data.toString()}
        />
      );
    }

    if (
      data &&
      (field.fieldType === FieldType.HTML ||
        field.fieldType === FieldType.CSS ||
        field.fieldType === FieldType.JSON ||
        field.fieldType === FieldType.JavaScript ||
        field.fieldType === FieldType.Code)
    ) {
      let language: string = "html";

      if (field.fieldType === FieldType.CSS) {
        language = "css";
      }

      if (field.fieldType === FieldType.JSON) {
        language = "json";

        //make sure json is well formatted.

        if (typeof data === "string") {
          try {
            data = JSON.stringify(JSON.parse(data), null, 2);
          } catch (e) {
            // cant format json for some reason. ignore.
            Logger.error(
              "Cant format json for field: " +
                field.title +
                " with value: " +
                data +
                " Error: " +
                e,
            );
          }
        } else if (typeof data === "object" && data !== null) {
          // If data is already an object, convert it to a formatted JSON string
          try {
            data = JSON.stringify(data, null, 2);
          } catch (e) {
            Logger.error(
              "Cant stringify json object for field: " +
                field.title +
                " Error: " +
                e,
            );
            data = String(data);
          }
        }
      }

      if (field.fieldType === FieldType.JavaScript) {
        language = "javascript";
      }

      if (field.fieldType === FieldType.Code) {
        language = "plaintext";
      }

      data = (
        <CodeBlock
          code={data as string}
          language={language}
          maxHeight="400px"
        />
      );
    }

    if (data && field.fieldType === FieldType.InlineCode) {
      data = (
        <code className="px-2 py-1 bg-gray-100 text-gray-800 rounded font-mono text-sm border border-gray-200 break-all">
          {data as string}
        </code>
      );
    }

    if (data && field.fieldType === FieldType.ObjectID) {
      const objectIdValue: string = data.toString();
      data = <ObjectIDView objectId={objectIdValue} />;
    }

    if (data && field.fieldType === FieldType.Heading) {
      data = (
        <div className="inline-flex items-center">
          <span className="text-2xl font-bold text-gray-900 tracking-tight">
            {data.toString()}
          </span>
        </div>
      );
    }

    if (field.getElement) {
      /*
       * getField runs inside Detail's own render, so a throw out of a field
       * renderer unwinds the whole route to the app level ErrorBoundary and
       * replaces the page with "Something went wrong". One misbehaving field
       * must never cost the entire page: log the misconfiguration and keep
       * whatever this field type already rendered - the entity badge, or ""
       * so the placeholder below can stand in.
       */
      try {
        data = field.getElement(props.item);
      } catch (err) {
        Logger.error(
          "Detail: getElement for '" +
            fieldKeyStr +
            "' threw and was ignored. " +
            (err instanceof Error ? err.message : String(err)),
        );
      }
    }

    let className: string = "sm:col-span-1";

    if (field.colSpan) {
      className = "sm:col-span-" + field.colSpan;
    }

    let alignClassName: string = "flex justify-left";

    if (field.alignItem === AlignItem.Right) {
      alignClassName = "flex justify-end";
    } else if (field.alignItem === AlignItem.Center) {
      alignClassName = "flex justify-center";
    } else if (field.alignItem === AlignItem.Left) {
      alignClassName = "flex justify-start";
    }

    if (data instanceof DatabaseProperty) {
      data = data.toString();
    }

    /*
     * Last resort. Anything still an object here is something no field type
     * claimed - usually a relation column declared without FieldType.Entity.
     * Rendering it would throw "Objects are not valid as a React child" and
     * blank the whole page, so label it instead and log the misconfiguration.
     */
    if (data && typeof data === "object" && !React.isValidElement(data)) {
      Logger.error(
        "Detail: no field type renders the value of '" +
          fieldKeyStr +
          "'. Set fieldType (FieldType.Entity for relations) or getElement on the field.",
      );

      data = Array.isArray(data)
        ? (data as Array<unknown>)
            .map((entity: unknown) => {
              return getEntityLabel(entity);
            })
            .filter((label: string) => {
              return Boolean(label);
            })
            .join(", ")
        : getEntityLabel(data);
    }

    // Determine style-based classes
    const styleType: DetailStyle = props.style || DetailStyle.Default;
    const isCardStyle: boolean = styleType === DetailStyle.Card;
    const isMinimalStyle: boolean = styleType === DetailStyle.Minimal;

    /* Container classes based on style - uses first:pt-0 to remove top padding from first field */
    let containerClasses: string =
      "group transition-all duration-200 ease-in-out";

    if (isCardStyle) {
      containerClasses +=
        " bg-gradient-to-br from-white to-gray-50/50 rounded-xl border border-gray-100 p-4 shadow-sm hover:shadow-md hover:border-gray-200";
    } else if (isMinimalStyle) {
      containerClasses +=
        " py-3 first:pt-0 last:pb-0 border-b border-gray-50 last:border-b-0 hover:bg-gray-50/50 px-2 -mx-2 rounded-lg";
    } else {
      containerClasses +=
        " py-5 first:pt-0 last:pb-0 border-b border-gray-100 last:border-b-0 hover:bg-gray-50/30 px-3 -mx-3 rounded-lg";
    }

    return (
      <div
        className={`${className} ${containerClasses}`}
        key={index}
        id={props.id}
        style={
          props.showDetailsInNumberOfColumns
            ? {
                width: 100 / props.showDetailsInNumberOfColumns + "%",
              }
            : { width: "100%" }
        }
      >
        <FieldLabelElement
          size={field.fieldTitleSize}
          title={field.title}
          description={field.description}
          sideLink={field.sideLink}
          alignClassName={alignClassName}
          isCardStyle={isCardStyle}
        />

        <div
          className={`mt-3 text-sm leading-relaxed ${alignClassName} ${
            isCardStyle ? "text-gray-800" : "text-gray-700"
          }`}
        >
          {data && (
            <div
              className={`${field.contentClassName || ""} w-full ${
                field.opts?.isCopyable
                  ? "flex items-center gap-3 group/copyable"
                  : ""
              }`}
            >
              <div className="break-words leading-relaxed">{data}</div>

              {field.opts?.isCopyable &&
                field.fieldType !== FieldType.HiddenText && (
                  <div className="opacity-0 group-hover/copyable:opacity-100 transition-all duration-200 transform group-hover/copyable:translate-x-0 -translate-x-1">
                    <CopyableButton textToBeCopied={data.toString()} />
                  </div>
                )}
            </div>
          )}
          {(data === null || data === undefined || data === "") &&
            field.placeholder && <PlaceholderText text={field.placeholder} />}
        </div>
      </div>
    );
  };

  // Determine grid gap based on style
  const styleType: DetailStyle = props.style || DetailStyle.Default;
  const isCardStyle: boolean = styleType === DetailStyle.Card;

  // Grid gap classes - cards need more gap, others less since they have internal padding
  const gapClasses: string = isCardStyle ? "gap-4" : "gap-0";

  return (
    <div
      className={`grid grid-cols-1 ${gapClasses} sm:grid-cols-${
        props.showDetailsInNumberOfColumns || 1
      } w-full`}
    >
      {props.fields &&
        props.fields.length > 0 &&
        props.fields
          .filter((field: Field<T>) => {
            // Filter out fields with hideOnMobile on mobile devices
            if (field.hideOnMobile && isMobile) {
              return false;
            }

            // check if showIf exists.
            if (field.showIf) {
              return field.showIf(props.item);
            }

            return true;
          })
          .map((field: Field<T>, i: number) => {
            return getField(field, i);
          })}
    </div>
  );
};

export default Detail;

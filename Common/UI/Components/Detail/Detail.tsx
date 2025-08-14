import AlignItem from "../../Types/AlignItem";
import { Logger } from "../../Utils/Logger";
import CodeEditor from "../CodeEditor/CodeEditor";
import ColorViewer from "../ColorViewer/ColorViewer";
import CopyableButton from "../CopyableButton/CopyableButton";
import DictionaryOfStringsViewer from "../Dictionary/DictionaryOfStingsViewer";
import { DropdownOption } from "../Dropdown/Dropdown";
import HiddenText from "../HiddenText/HiddenText";
import MarkdownViewer from "../Markdown.tsx/LazyMarkdownViewer";
import FieldType from "../Types/FieldType";
import Field from "./Field";
import FieldLabelElement from "./FieldLabel";
import PlaceholderText from "./PlaceholderText";
import FileModel from "../../../Models/DatabaseModels/DatabaseBaseModel/FileModel";
import CodeType from "../../../Types/Code/CodeType";
import Color from "../../../Types/Color";
import DatabaseProperty from "../../../Types/Database/DatabaseProperty";
import OneUptimeDate from "../../../Types/Date";
import Dictionary from "../../../Types/Dictionary";
import BadDataException from "../../../Types/Exception/BadDataException";
import GenericObject from "../../../Types/GenericObject";
import React, { ReactElement, useEffect, useState } from "react";

export interface ComponentProps<T extends GenericObject> {
  item: T;
  fields: Array<Field<T>>;
  id?: string | undefined;
  showDetailsInNumberOfColumns?: number | undefined;
}

type DetailFunction = <T extends GenericObject>(
  props: ComponentProps<T>,
) => ReactElement;

const Detail: DetailFunction = <T extends GenericObject>(
  props: ComponentProps<T>,
): ReactElement => {
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
    options: Array<DropdownOption>,
    placeholder: string,
  ) => ReactElement;

  const getDropdownViewer: GetDropdownViewerFunction = (
    data: string,
    options: Array<DropdownOption>,
    placeholder: string,
  ): ReactElement => {
    if (!options) {
      return <div>No options found</div>;
    }

    if (
      !options.find((i: DropdownOption) => {
        return i.value === data;
      })
    ) {
      return <div>{placeholder}</div>;
    }

    return (
      <div>
        {
          options.find((i: DropdownOption) => {
            return i.value === data;
          })?.label as string
        }
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

    return <div className="text-gray-900">{usdCents / 100} USD</div>;
  };

  type GetMinutesFieldFunction = (minutes: number | null) => ReactElement;

  const getMinutesField: GetMinutesFieldFunction = (
    minutes: number | null,
  ): ReactElement => {
    if (minutes === null) {
      return <></>;
    }

    return (
      <div className="text-gray-900">
        {minutes} {minutes > 1 ? "minutes" : "minute"}
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
        data = OneUptimeDate.getDateAsLocalFormattedString(
          data as string,
          true,
        );
      } else {
        data = field.placeholder || "-";
      }
    }

    if (field.fieldType === FieldType.Boolean) {
      if (data) {
        data = "Yes";
      } else {
        data = "No";
      }
    }

    if (field.fieldType === FieldType.DateTime) {
      if (data) {
        data = OneUptimeDate.getDateAsLocalFormattedString(
          data as string,
          false,
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
          [(props.item[fieldKey] as unknown as FileModel).file as Uint8Array],
          {
            type: (props.item[fieldKey] as unknown as FileModel)
              .fileType as string,
          },
        );

        const url: string = URL.createObjectURL(blob);

        data = (
          <img
            src={url}
            className={"rounded"}
            style={{
              height: "100px",
            }}
          />
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
      let codeType: CodeType = CodeType.HTML;

      if (field.fieldType === FieldType.CSS) {
        codeType = CodeType.CSS;
      }

      if (field.fieldType === FieldType.JSON) {
        codeType = CodeType.JSON;

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
        }
      }

      if (field.fieldType === FieldType.JavaScript) {
        codeType = CodeType.JavaScript;
      }

      if (field.fieldType === FieldType.Code) {
        codeType = CodeType.Text;
      }

      data = (
        <CodeEditor
          type={codeType}
          readOnly={true}
          initialValue={data as string}
        />
      );
    }

    if (field.getElement) {
      data = field.getElement(props.item);
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

    return (
      <div
        className={className}
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
        />

        <div className={`mt-1 text-sm text-gray-900 ${alignClassName}`}>
          {data && (
            <div
              className={`${field.contentClassName} w-full ${
                field.opts?.isCopyable ? "flex" : ""
              }`}
            >
              <div>{data}</div>

              {field.opts?.isCopyable &&
                field.fieldType !== FieldType.HiddenText && (
                  <CopyableButton textToBeCopied={data.toString()} />
                )}
            </div>
          )}
          {(data === null || data === undefined) && field.placeholder && (
            <PlaceholderText text={field.placeholder} />
          )}
        </div>
      </div>
    );
  };

  return (
    <div
      className={`grid grid-cols-1 gap-x-4 gap-y-8 sm:grid-cols-${
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

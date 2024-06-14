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
import FileModel from "Common/Models/FileModel";
import CodeType from "Common/Types/Code/CodeType";
import Color from "Common/Types/Color";
import DatabaseProperty from "Common/Types/Database/DatabaseProperty";
import OneUptimeDate from "Common/Types/Date";
import Dictionary from "Common/Types/Dictionary";
import BadDataException from "Common/Types/Exception/BadDataException";
import GenericObject from "Common/Types/GenericObject";
import get from "lodash/get";
import React, { ReactElement } from "react";

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

    if (get(props.item, fieldKey)) {
      data = (get(props.item, fieldKey, "") as any) || "";
    }

    if (field.fieldType === FieldType.Date) {
      data = OneUptimeDate.getDateAsLocalFormattedString(data as string, true);
    }

    if (field.fieldType === FieldType.Boolean) {
      if (data) {
        data = "Yes";
      } else {
        data = "No";
      }
    }

    if (field.fieldType === FieldType.DateTime) {
      data = OneUptimeDate.getDateAsLocalFormattedString(data as string, false);
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
        (props.item[fieldKey] as FileModel).file &&
        (props.item[fieldKey] as FileModel).type
      ) {
        const blob: Blob = new Blob(
          [(props.item[fieldKey] as FileModel).file as Uint8Array],
          {
            type: (props.item[fieldKey] as FileModel).type as string,
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
        field.fieldType === FieldType.JavaScript)
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
                data,
            );
          }
        }
      }

      if (field.fieldType === FieldType.JavaScript) {
        codeType = CodeType.JavaScript;
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
          {!data && field.placeholder && (
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
        props.fields.map((field: Field<T>, i: number) => {
          return getField(field, i);
        })}
    </div>
  );
};

export default Detail;

import AlignItem from "../../Types/AlignItem";
import { Logger } from "../../Utils/Logger";
import useTranslateValue from "../../Utils/Translation";
import { translatableTerm, Translator } from "../../Utils/TranslateTemplate";
import useTranslator from "../../Utils/UseTranslator";
import TranslatedSentence from "../TranslatedSentence/TranslatedSentence";
import CodeBlock from "../CodeBlock/CodeBlock";
import ColorViewer from "../ColorViewer/ColorViewer";
import CopyableButton from "../CopyableButton/CopyableButton";
import DictionaryOfStringsViewer from "../Dictionary/DictionaryOfStingsViewer";
import { DropdownOption, DropdownOptionGroup } from "../Dropdown/Dropdown";
import DropdownValueBadge from "../Dropdown/DropdownValueBadge";
import HiddenText from "../HiddenText/HiddenText";
import Link from "../Link/Link";
import MarkdownViewer from "../Markdown.tsx/LazyMarkdownViewer";
import ObjectIDView from "../ObjectID/ObjectIDView";
import FieldType from "../Types/FieldType";
import BooleanValue from "./BooleanValue";
import DetailFieldLabel, {
  DETAIL_FIELD_DESCRIPTION_CLASS_NAME,
  DETAIL_FIELD_SIDE_LINK_CLASS_NAME,
} from "./DetailFieldLabel";
import {
  getDetailCellClassNames,
  getDetailGridClassName,
} from "./DetailGridLayout";
import DetailRecordLine from "./DetailRecordLine";
import {
  DETAIL_IMAGE_BACKDROP_ATTRIBUTE,
  DETAIL_IMAGE_BACKDROP_CLASS_NAMES,
  DetailImageBackdrop,
} from "./DetailImageBackdrop";
import { getRecordIdText, isRecordIdField } from "./DetailRecordId";
import {
  getRecordTimes,
  isRecordTimeField,
  RecordTime,
} from "./DetailRecordTime";
import { getDetailCopyText, hasDetailValue } from "./DetailValue";
import { DetailValueContext } from "./DetailValueContext";
import EmptyValue from "./EmptyValue";
import Field from "./Field";
import FileModel from "../../../Models/DatabaseModels/DatabaseBaseModel/FileModel";
import Color from "../../../Types/Color";
import DatabaseProperty from "../../../Types/Database/DatabaseProperty";
import OneUptimeDate from "../../../Types/Date";
import Dictionary from "../../../Types/Dictionary";
import BadDataException from "../../../Types/Exception/BadDataException";
import GenericObject from "../../../Types/GenericObject";
import React, { ReactElement, useEffect, useState } from "react";

export enum DetailStyle {
  /*
   * A detail card's fields: a muted name over each value, in rows that line
   * up in every column count, with a hairline rule across the whole width
   * between two rows (DetailGridLayout.ts).
   */
  Default = "default",
  // Bordered tiles. Nothing draws it today; kept for the API.
  Card = "card",
  // Tighter rows. Nothing draws it today; kept for the API.
  Minimal = "minimal",
  /*
   * Dense label-over-value rows split by hairline dividers, for the narrow
   * right-hand details column of an overview page. Opt-in: the other styles
   * render exactly as before.
   */
  Compact = "compact",
}

/*
 * A field's value under its name: the reading size, in the darkest grey, in
 * the value's own weight - what the eye lands on. Long values wrap.
 */
export const DETAIL_VALUE_CLASS_NAME: string =
  "mt-1 min-w-0 text-sm leading-6 text-gray-900";

// A cell drawn on its own, with no grid placement to read.
export const DETAIL_SINGLE_CELL_CLASS_NAME: string = "min-w-0";

/*
 * A single pill drawn as a value - a dropdown's choice, a related record -
 * sits on the value's line top to top: on the line's baseline it stood 2px
 * lower than the values beside it, and its row 2px taller.
 */
export const DETAIL_VALUE_BADGE_CLASS_NAME: string = "align-top";

/*
 * Several pills drawn as a value - a multi-select's choices, related
 * records - in a row that wraps, as a record's labels are: one line of them
 * is the value's 24px line, centred on it, so their row is as tall as one
 * of text beside it. The pills are 22.7px; without the line's height, their
 * row stood 1.3px shorter than the rest.
 */
export const DETAIL_VALUE_BADGES_CLASS_NAME: string =
  "flex min-h-6 flex-wrap items-center gap-1.5";

export interface ComponentProps<T extends GenericObject> {
  item: T;
  fields: Array<Field<T>>;
  id?: string | undefined;
  showDetailsInNumberOfColumns?: number | undefined;
  style?: DetailStyle | undefined;
  /*
   * The item is a record (the default): its own ID, and when it was created
   * and last updated, go on the small line under the fields rather than in
   * the grid. False for values that are not a record's own columns - a
   * record's custom fields, which people name, and could name "createdAt" -
   * so every field is drawn as the field it is.
   */
  showRecordLine?: boolean | undefined;
}

type DetailFunction = <T extends GenericObject>(
  props: ComponentProps<T>,
) => ReactElement;

const Detail: DetailFunction = <T extends GenericObject>(
  props: ComponentProps<T>,
): ReactElement => {
  const { translateString, translateValue } = useTranslateValue();
  const translator: Translator = useTranslator();
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

    /*
     * The viewer spaces its paragraphs and lists apart; the first's space
     * above and the last's below would put the text further from its name
     * than any other value is, and leave a gap before the next row.
     */
    return (
      <div
        className="[&>div>*:first-child]:mt-0 [&>div>*:last-child]:mb-0"
        data-testid="detail-markdown-value"
      >
        <MarkdownViewer text={text} />
      </div>
    );
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
    const flatOptions: Array<DropdownOption> = (options || []).flatMap(
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
      /*
       * A value the options no longer offer is still the record's value:
       * shown as itself rather than as if nothing were set. Nothing set is
       * the field's own words, or a dash - as every empty field is.
       */
      if (data !== undefined && data !== null && String(data) !== "") {
        return (
          <DropdownValueBadge
            label={String(data)}
            className={DETAIL_VALUE_BADGE_CLASS_NAME}
          />
        );
      }

      return <EmptyValue placeholder={placeholder} />;
    }

    return (
      <DropdownValueBadge
        label={selectedOption.label as string}
        color={selectedOption.color}
        className={DETAIL_VALUE_BADGE_CLASS_NAME}
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
      return <EmptyValue placeholder={placeholder} />;
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
      <div className={DETAIL_VALUE_BADGES_CLASS_NAME}>
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

    return (
      <DropdownValueBadge
        label={label}
        color={getEntityColor(entity)}
        className={DETAIL_VALUE_BADGE_CLASS_NAME}
      />
    );
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
      <div className={DETAIL_VALUE_BADGES_CLASS_NAME}>
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

  // The swatch centred on the value's line, beside the colour's code.
  const getColorField: GetColorFieldFunction = (color: Color): ReactElement => {
    return <ColorViewer value={color} className="items-center" />;
  };

  type GetUSDCentsFieldFunction = (
    usdCents: number | null,
  ) => ReactElement | string;

  /*
   * An amount, read like the values around it: "$12.50 USD", the number in
   * the value's weight and the currency after it in grey. It was a green box
   * with a coin icon - louder than the card's name - and a zero balance
   * showed a bare "0" outside it.
   */
  const getUSDCentsField: GetUSDCentsFieldFunction = (
    usdCents: number | null,
  ): ReactElement | string => {
    if (usdCents === null || !Number.isFinite(usdCents)) {
      return "";
    }

    const formattedAmount: string = (usdCents / 100).toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });

    return (
      <span
        className="inline-flex items-baseline gap-1.5"
        data-testid="detail-usd-value"
      >
        <span className="font-medium tabular-nums">${formattedAmount}</span>
        <span className="text-xs font-medium text-gray-500">USD</span>
      </span>
    );
  };

  type GetMinutesFieldFunction = (
    minutes: number | null,
  ) => ReactElement | string;

  // "5 minutes", in the reader's words, read like the values around it.
  const getMinutesField: GetMinutesFieldFunction = (
    minutes: number | null,
  ): ReactElement | string => {
    if (minutes === null || !Number.isFinite(minutes)) {
      return "";
    }

    return (
      <TranslatedSentence
        template={{ one: "{{count}} minute", other: "{{count}} minutes" }}
        count={minutes}
        slots={{
          count: <span className="font-medium tabular-nums">{minutes}</span>,
        }}
        renderText={(text: string): ReactElement => {
          return <span>{text}</span>;
        }}
      />
    );
  };

  type GetDateValueFunction = (
    value: unknown,
    isDateOnly: boolean,
  ) => ReactElement | string;

  /*
   * A date or a time, as plain text in the reader's time zone, in a <time>
   * that gives it to a machine. It was bold, behind a calendar or a clock
   * icon - the one value on a card drawn heavier than the others.
   */
  const getDateValue: GetDateValueFunction = (
    value: unknown,
    isDateOnly: boolean,
  ): ReactElement | string => {
    if (!value) {
      return "";
    }

    const text: string =
      OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(
        value as string,
        isDateOnly,
      );

    const date: Date = new Date(value as string);
    const machineValue: string | undefined = Number.isNaN(date.getTime())
      ? undefined
      : date.toISOString();

    return <time dateTime={machineValue}>{text}</time>;
  };

  type GetFieldValueContentFunction = (
    field: Field<T>,
    data: string | ReactElement,
    copyText?: string | undefined,
  ) => ReactElement;

  /*
   * The rendered value, shared by every style - or, for a field with no
   * value, the field's own words for that, or a dash (EmptyValue).
   *
   * A long value - an email, a URL, a key - wraps inside its column and
   * breaks where it has to (min-w-0 lets it shrink below its longest word).
   * A copyable one keeps its copy button beside it, always in view: it was
   * hidden until the row was hovered, so a keyboard, a touch screen or a
   * reader who did not think to hover never saw it.
   */
  const getFieldValueContent: GetFieldValueContentFunction = (
    field: Field<T>,
    data: string | ReactElement,
    copyText?: string | undefined,
  ): ReactElement => {
    if (!hasDetailValue(data)) {
      return <EmptyValue placeholder={field.placeholder} />;
    }

    /*
     * Hidden text and an ID bring their own copy control. A second one here
     * was handed the rendered ID element rather than the ID, so it copied
     * "[object Object]" (the project ID on an API key). It copies the value
     * itself, never what was drawn for it.
     */
    const isCopyable: boolean =
      Boolean(field.opts?.isCopyable) &&
      field.fieldType !== FieldType.HiddenText &&
      field.fieldType !== FieldType.ObjectID &&
      Boolean(copyText);

    /*
     * The element a page drew for the value learns that it is one
     * (DetailValueContext): a record's labels then sit side by side, as
     * every other list of pills on a card does, instead of one per line as
     * in a table's cell.
     */
    return (
      <DetailValueContext.Provider value={true}>
        <div
          className={`${field.contentClassName || ""} w-full min-w-0${
            isCopyable ? " flex items-start gap-2" : ""
          }`}
        >
          <div className="min-w-0 break-words">{data}</div>

          {isCopyable ? (
            <div
              className="flex h-6 flex-none items-center"
              data-testid="detail-value-copy"
            >
              <CopyableButton textToBeCopied={copyText || ""} />
            </div>
          ) : (
            <></>
          )}
        </div>
      </DetailValueContext.Provider>
    );
  };

  type GetCompactFieldFunction = (
    field: Field<T>,
    index: number,
    data: string | ReactElement,
    colSpanClassName: string,
    alignClassName: string,
    copyText: string | undefined,
  ) => ReactElement;

  /*
   * DetailStyle.Compact. The DOM keeps the same shape as the other styles -
   * a row holding the label block (div.space-y-1) and then the value - so
   * anything that walks from a label to its value keeps working; only the
   * spacing and type scale change. Rows sit flush in a single column (the
   * container draws hairline dividers between them) and fall back to plain
   * vertical rhythm when several columns share a row.
   */
  const getCompactField: GetCompactFieldFunction = (
    field: Field<T>,
    index: number,
    data: string | ReactElement,
    colSpanClassName: string,
    alignClassName: string,
    copyText: string | undefined,
  ): ReactElement => {
    const translatedTitle: string | undefined = translateString(field.title);
    const translatedDescription: string | ReactElement | undefined =
      translateValue(field.description);
    const translatedSideLinkText: string | undefined = translateString(
      field.sideLink?.text,
    );
    const isSingleColumn: boolean =
      (props.showDetailsInNumberOfColumns || 1) <= 1;

    return (
      <div
        className={`${colSpanClassName} min-w-0 py-3${
          isSingleColumn ? " first:pt-0 last:pb-0" : ""
        }`}
        key={index}
        data-testid="detail-field"
      >
        <div className="space-y-1">
          {translatedTitle && (
            <label
              className={`${alignClassName} items-center gap-2 text-xs font-medium text-gray-500`}
            >
              <span>{translatedTitle}</span>
              {field.sideLink &&
                translatedSideLinkText &&
                field.sideLink.url && (
                  <Link
                    to={field.sideLink.url}
                    openInNewTab={field.sideLink.openLinkInNewTab}
                    className={DETAIL_FIELD_SIDE_LINK_CLASS_NAME}
                  >
                    {translatedSideLinkText}
                  </Link>
                )}
            </label>
          )}
          {/*
           * The default style's grey, which reads at WCAG AA: gray-400 on
           * white does not.
           */}
          {translatedDescription && (
            <div
              className={`${alignClassName} ${DETAIL_FIELD_DESCRIPTION_CLASS_NAME}`}
            >
              {translatedDescription}
            </div>
          )}
        </div>

        <div
          className={`mt-1 text-sm text-gray-900 ${alignClassName}`}
          data-testid="detail-value"
        >
          {getFieldValueContent(field, data, copyText)}
        </div>
      </div>
    );
  };

  type GetFieldFunction = (
    field: Field<T>,
    index: number,
    cellClassName?: string | undefined,
  ) => ReactElement;

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
    cellClassName?: string | undefined,
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

    // No date is an empty value: the field's own words, or a dash.
    if (field.fieldType === FieldType.Date) {
      data = getDateValue(data, true);
    }

    if (field.fieldType === FieldType.Boolean) {
      data = <BooleanValue value={Boolean(data)} />;
    }

    if (field.fieldType === FieldType.DateTime) {
      data = getDateValue(data, false);
    }

    if (data && field.fieldType === FieldType.Color) {
      if (data instanceof Color) {
        data = getColorField(data);
      }
    }

    // Zero is an amount too: a balance of $0.00.
    if (hasDetailValue(data) && field.fieldType === FieldType.USDCents) {
      let usdCents: number | null = null;

      if (typeof data === "string") {
        usdCents = parseInt(data);
      }

      if (typeof data === "number") {
        usdCents = data;
      }

      data = getUSDCentsField(usdCents);
    }

    if (hasDetailValue(data) && field.fieldType === FieldType.Minutes) {
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

        /*
         * A plain frame: no shadow, and no zoom on hover. An image judged on
         * the page it is shown on (a logo) is drawn on that page's own
         * background, with room around it, in both themes.
         */
        const backdrop: DetailImageBackdrop | undefined = field.imageBackdrop;

        data = (
          <div className="relative inline-block max-w-full">
            <div
              className={`overflow-hidden rounded-lg border ${
                backdrop
                  ? `${DETAIL_IMAGE_BACKDROP_CLASS_NAMES[backdrop]} px-4 py-3`
                  : "border-gray-200 bg-white p-1"
              }`}
              {...(backdrop
                ? {
                    [DETAIL_IMAGE_BACKDROP_ATTRIBUTE]: backdrop.toLowerCase(),
                  }
                : {})}
            >
              <img
                src={url}
                className="max-w-full rounded-md object-contain"
                style={{
                  height: "100px",
                }}
                alt={
                  field.title
                    ? translator.translateTemplate("{{field}} image", {
                        field: translatableTerm(field.title),
                      })
                    : translator.translateText("Uploaded image")
                }
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
        field.fieldType === FieldType.YAML ||
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

      /*
       * Rendered verbatim, unlike the JSON arm above: re-emitting YAML through
       * a parser would drop the comments, anchors and key ordering that a hand
       * written document (a Sigma rule, a collector config) is written with.
       */
      if (field.fieldType === FieldType.YAML) {
        language = "yaml";
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
      /*
       * Read like the record's own ID on the ID line: an analytics row holds
       * an ObjectID and JSON holds { _type, value }, whose toString() is
       * "[object Object]" - in the pill, and in what it copied. No ID at all
       * leaves the field empty, for its placeholder.
       */
      const objectIdValue: string = getRecordIdText(data);
      data = objectIdValue ? <ObjectIDView objectId={objectIdValue} /> : "";
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

    let alignClassName: string = "flex justify-start";

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

    // What a copy button beside this value copies (DetailValue.ts).
    const copyText: string | undefined = getDetailCopyText(data, value);

    // Determine style-based classes
    const styleType: DetailStyle = props.style || DetailStyle.Default;
    const isCardStyle: boolean = styleType === DetailStyle.Card;

    if (styleType === DetailStyle.Compact) {
      return getCompactField(
        field,
        index,
        data,
        className,
        alignClassName,
        copyText,
      );
    }

    /*
     * The default style: the field's name over its value, in a cell whose
     * padding, rule and gutter its place in the grid decides
     * (DetailGridLayout.ts) - so the cells of one row share their top, and
     * the rule above a row runs the whole row. No width of its own: the
     * grid sizes the cell. It used to carry an inline width of 100/n
     * percent, measured against its own grid column, so it filled 1/n of
     * it.
     */
    if (styleType === DetailStyle.Default) {
      return (
        <div
          className={cellClassName || DETAIL_SINGLE_CELL_CLASS_NAME}
          key={index}
          data-testid="detail-field"
        >
          <DetailFieldLabel
            title={field.title}
            description={field.description}
            sideLink={field.sideLink}
            alignClassName={alignClassName}
            sizeClassName={field.fieldTitleSize}
          />

          <div
            className={`${DETAIL_VALUE_CLASS_NAME} ${alignClassName}`}
            data-testid="detail-value"
          >
            {getFieldValueContent(field, data, copyText)}
          </div>
        </div>
      );
    }

    /*
     * The two styles nothing draws today keep their boxes - a tile each
     * (Card), or tighter rows (Minimal) - with the default style's name and
     * value, and the grid's own widths.
     */
    const containerClasses: string = isCardStyle
      ? "bg-gradient-to-br from-white to-gray-50/50 rounded-xl border border-gray-100 p-4 shadow-sm"
      : "py-3 first:pt-0 last:pb-0 border-b border-gray-50 last:border-b-0";

    return (
      <div
        className={`${className} min-w-0 ${containerClasses}`}
        key={index}
        data-testid="detail-field"
      >
        <DetailFieldLabel
          title={field.title}
          description={field.description}
          sideLink={field.sideLink}
          alignClassName={alignClassName}
          sizeClassName={field.fieldTitleSize}
        />

        <div
          className={`${DETAIL_VALUE_CLASS_NAME} ${alignClassName}`}
          data-testid="detail-value"
        >
          {getFieldValueContent(field, data, copyText)}
        </div>
      </div>
    );
  };

  // Determine grid gap based on style
  const styleType: DetailStyle = props.style || DetailStyle.Default;
  const isCardStyle: boolean = styleType === DetailStyle.Card;

  // Grid gap classes - cards need more gap, others less since they have internal padding
  let gapClasses: string = isCardStyle ? "gap-4" : "gap-0";

  if (styleType === DetailStyle.Compact) {
    /*
     * Hairline dividers between stacked rows. Once several columns share a
     * row (sm and up) a top border would also land on the first row's
     * right-hand cells, so that layout separates cells with whitespace.
     */
    gapClasses =
      (props.showDetailsInNumberOfColumns || 1) > 1
        ? "gap-0 divide-y divide-gray-100 sm:gap-x-6 sm:divide-y-0"
        : "gap-0 divide-y divide-gray-100";
  }

  const shownFields: Array<Field<T>> = (props.fields || []).filter(
    (field: Field<T>) => {
      // Filter out fields with hideOnMobile on mobile devices
      if (field.hideOnMobile && isMobile) {
        return false;
      }

      // check if showIf exists.
      if (field.showIf) {
        return field.showIf(props.item);
      }

      return true;
    },
  );

  const showRecordLine: boolean = props.showRecordLine !== false;

  type IsRecordLineFieldFunction = (field: Field<T>) => boolean;

  /*
   * The record's own ID is not one of the fields: it goes on one small line
   * under them, with a copy button (DetailRecordId.ts says why). So do when
   * the record was created and last updated, after the ID
   * (DetailRecordTime.ts). A card that declared one twice still says it once.
   */
  const isRecordLineField: IsRecordLineFieldFunction = (
    field: Field<T>,
  ): boolean => {
    return (
      showRecordLine && (isRecordIdField(field) || isRecordTimeField(field))
    );
  };

  const recordIdField: Field<T> | undefined = showRecordLine
    ? shownFields.find((field: Field<T>) => {
        return isRecordIdField(field);
      })
    : undefined;

  const recordId: string =
    recordIdField && props.item
      ? getRecordIdText(getNestedValue(props.item, String(recordIdField.key)))
      : "";

  const recordTimes: Array<RecordTime> =
    showRecordLine && props.item
      ? getRecordTimes(shownFields, (field: Field<T>): unknown => {
          return getNestedValue(props.item, String(field.key));
        })
      : [];

  /*
   * The fields the grid draws: not the ones on the record line, and not one
   * without a key, which draws nothing - a cell for it would leave a hole in
   * a row.
   */
  const gridFields: Array<Field<T>> = shownFields.filter((field: Field<T>) => {
    return !isRecordLineField(field) && Boolean(field.key);
  });

  const isDefaultStyle: boolean = styleType === DetailStyle.Default;

  // Each cell's place in the rows, at every width (DetailGridLayout.ts).
  const cellClassNames: Array<string> = isDefaultStyle
    ? getDetailCellClassNames(
        gridFields.map((field: Field<T>): number | undefined => {
          return field.colSpan;
        }),
        props.showDetailsInNumberOfColumns,
      )
    : [];

  const gridClassName: string = isDefaultStyle
    ? getDetailGridClassName(props.showDetailsInNumberOfColumns)
    : `grid grid-cols-1 ${gapClasses} sm:grid-cols-${
        props.showDetailsInNumberOfColumns || 1
      } w-full`;

  const renderedFields: Array<ReactElement> = gridFields.map(
    (field: Field<T>, i: number) => {
      return getField(field, i, cellClassNames[i]);
    },
  );

  if (!recordId && recordTimes.length === 0) {
    return (
      /*
       * The id names this detail, so it belongs to the element that holds all
       * of it. It used to be stamped on every row instead, which put the same
       * id on as many elements as the detail had fields: invalid HTML, an
       * anchor or getElementById that reaches only the first row, and a
       * Playwright locator that resolves to several elements and fails strict
       * mode - which is how the SLO settings E2E found it.
       */
      <div id={props.id} className={gridClassName}>
        {renderedFields}
      </div>
    );
  }

  /*
   * With a record line the detail is the fields and the line under them, so
   * the id moves to the element that holds both. The grid inside keeps its
   * own classes, and its last row no padding under it; the line draws the
   * one divider above it, in the rhythm of the rows: the compact style's
   * rows are py-3 apart, the others' wider.
   */
  const recordLineClassName: string =
    gridFields.length === 0
      ? ""
      : styleType === DetailStyle.Compact
        ? "mt-3 border-t border-gray-100 pt-3"
        : "mt-4 border-t border-gray-100 pt-3";

  return (
    <div id={props.id} className="w-full">
      {gridFields.length > 0 ? (
        <div className={gridClassName}>{renderedFields}</div>
      ) : (
        <></>
      )}
      <DetailRecordLine
        recordId={recordId}
        times={recordTimes}
        className={recordLineClassName}
      />
    </div>
  );
};

export default Detail;

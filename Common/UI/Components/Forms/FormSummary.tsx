import React, { ReactElement } from "react";
import Detail from "../Detail/Detail";
import FormValues from "./Types/FormValues";
import GenericObject from "../../../Types/GenericObject";
import Fields from "./Types/Fields";
import FormFieldSchemaTypeUtil from "./Utils/FormFieldSchemaTypeUtil";
import FormFieldSchemaType from "./Types/FormFieldSchemaType";
import DetailField from "../Detail/Field";
import Field from "./Types/Field";
import FieldType from "../Types/FieldType";

export interface ComponentProps<T> {
    formValues: FormValues<T>;
    formFields: Fields<T>;
}

const FormSummary: <T extends GenericObject>(
    props: ComponentProps<T>,
) => ReactElement = <T extends GenericObject>(
    props: ComponentProps<T>,
): ReactElement => {
        const { formValues, formFields } = props;

        const getDetailForFormFields: <T extends GenericObject>(
            formValues: FormValues<T>,
            formFields: Fields<T>,
        ) => ReactElement = <T extends GenericObject>(
            formValues: FormValues<T>,
            formFields: Fields<T>,
        ): ReactElement => {
                return (
                    <Detail
                        item={formValues as T}
                        fields={
                            formFields.map((field: Field<T>) => {
                                const detailField: DetailField<T> = {
                                    title: field.title || "",
                                    fieldType: field.getSummaryElement ?
                                        FieldType.Element :
                                        FormFieldSchemaTypeUtil.toFieldType(
                                            field.fieldType || FormFieldSchemaType.Text,
                                        ),
                                    description: field.description || "",
                                    getElement: field.getSummaryElement as any,
                                    sideLink: field.sideLink,
                                    key: (Object.keys(
                                        field.field || {},
                                    )[0]?.toString() || "") as keyof T,
                                };
                                return detailField;
                            }) as DetailField<GenericObject>[]
                        }
                    />

                );
            };

        return getDetailForFormFields(formValues, formFields);
    };

export default FormSummary;


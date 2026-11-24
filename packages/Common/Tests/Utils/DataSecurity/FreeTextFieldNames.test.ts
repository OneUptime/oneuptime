import { describe, expect, test } from "@jest/globals";
import {
  classifyField,
  FieldClassification,
  getValuesForModel,
  isReadByModel,
} from "../../../Utils/DataSecurity/FieldClassifier";
import {
  FREE_TEXT_FIELD_WORDS,
  getFieldNameWords,
  isFreeTextFieldName,
} from "../../../Utils/DataSecurity/FreeTextFieldNames";
import {
  ModelRecognitions,
  RecognizedEntity,
} from "../../../Utils/DataSecurity/Model/RecognizedEntity";

/*
 * A SHORT FIELD THE NAMES-AND-ADDRESSES MODEL READS: ONE NAMED FOR FREE
 * TEXT (#10927).
 *
 * The model reads a field of long values, and a log body however short;
 * now also a field whose name says a person wrote free text in it - a
 * note, a comment, a remark - in the seven languages it is measured in,
 * however short its values. A catalog's column - a product's name, a
 * title, a label - is not read for being short, as a measurement showed
 * it would make false names of brands and characters.
 */

// What a stand-in model found: one name, wherever it is.
function recognitionsOf(name: string): ModelRecognitions {
  return {
    get: (text: string): ReadonlyArray<RecognizedEntity> | undefined => {
      const start: number = text.indexOf(name);

      return start < 0
        ? []
        : [
            {
              dataTypeId: "person-name",
              start,
              end: start + name.length,
              score: 0.95,
            },
          ];
    },
  };
}

describe("a field named for free text", () => {
  test("notes, comments and remarks, in the seven languages", () => {
    for (const fieldPath of [
      "orders.delivery_note",
      "tickets.comment",
      "crm.remarks",
      "public.support_tickets.internal_notes",
      "customerComment",
      "CustomerFeedback",
      "attributes.order.message",
      "pedidos.nota_entrega",
      "tickets.comentario",
      "crm.observaciones",
      "bestellungen.lieferhinweis",
      "tickets.kommentar",
      "crm.bemerkungen",
      "kunden.Anmerkungen",
      "commandes.note_livraison",
      "tickets.commentaire",
      "crm.remarques",
      "ordini.note_consegna",
      "ticket.commento",
      "crm.osservazioni",
      "pedidos.observacao_entrega",
      "crm.observações",
      "bestellingen.bezorgopmerking",
      "tickets.opmerking",
      "crm.notities",
      "klant.toelichting",
    ]) {
      expect({ fieldPath, read: isFreeTextFieldName(fieldPath) }).toEqual({
        fieldPath,
        read: true,
      });
    }
  });

  test("not a catalog's columns, nor a description", () => {
    for (const fieldPath of [
      "products.product_name",
      "catalog.title",
      "categories.label",
      "staff.job_title",
      "stores.store_name",
      "products.description",
      "customers.name",
      "users.email",
      "orders.status",
      "keynote",
      "notebook_model",
      "remarkable_items",
      "messaging.system",
      "",
    ]) {
      expect({ fieldPath, read: isFreeTextFieldName(fieldPath) }).toEqual({
        fieldPath,
        read: false,
      });
    }

    expect(isFreeTextFieldName(undefined)).toBe(false);
    expect(isFreeTextFieldName(null)).toBe(false);
  });

  test("not a field about a note rather than the note: its id, its count, its time", () => {
    for (const fieldPath of [
      "messages.message_id",
      "tickets.comment_count",
      "notes.note_type",
      "crm.remarks_updated_at",
      "chat.message_status",
    ]) {
      expect({ fieldPath, read: isFreeTextFieldName(fieldPath) }).toEqual({
        fieldPath,
        read: false,
      });
    }
  });

  test("only the field's own name counts, not the table or the object it is in", () => {
    expect(isFreeTextFieldName("notes.id")).toBe(false);
    expect(isFreeTextFieldName("comments.author_email")).toBe(false);
    expect(isFreeTextFieldName("exports/*/notes-*.csv › author")).toBe(false);
    expect(isFreeTextFieldName("exports/*/users-*.csv › comment")).toBe(true);
  });

  test("a field's own name is split into words, its accents gone", () => {
    expect(getFieldNameWords("public.crm.observações")).toEqual([
      "observacoes",
    ]);
    expect(getFieldNameWords("customerDeliveryNote")).toEqual([
      "customer",
      "delivery",
      "note",
    ]);
    expect(getFieldNameWords("orders.items[]")).toEqual(["items"]);
  });

  test("every word is in lower case, without accents, once", () => {
    for (const word of FREE_TEXT_FIELD_WORDS) {
      expect(word).toBe(
        word.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase(),
      );
    }

    expect(new Set(FREE_TEXT_FIELD_WORDS).size).toBe(
      FREE_TEXT_FIELD_WORDS.length,
    );
  });
});

describe("what the model reads of a field", () => {
  const SHORT_NOTES: Array<string> = [
    "Called Jonas Becker about the late invoice",
    "Customer wants a refund",
    "Resent the confirmation email",
  ];

  test("a short field named for free text: its values, however short", () => {
    expect(isReadByModel(SHORT_NOTES, {}, "tickets.comment")).toBe(true);
    expect(
      getValuesForModel(SHORT_NOTES, { fieldPath: "tickets.comment" }),
    ).toEqual(SHORT_NOTES);
  });

  test("the same values in a catalog's column: none", () => {
    expect(isReadByModel(SHORT_NOTES, {}, "products.product_name")).toBe(false);
    expect(
      getValuesForModel(SHORT_NOTES, { fieldPath: "products.product_name" }),
    ).toEqual([]);
    // Without a name, as before: short values are not read.
    expect(getValuesForModel(SHORT_NOTES)).toEqual([]);
  });

  test("a short comment column's name found by the model is a finding of it", () => {
    const found: Array<FieldClassification> = classifyField(
      "tickets.comment",
      SHORT_NOTES,
      { recognitions: recognitionsOf("Jonas Becker") },
    );
    const name: FieldClassification | undefined = found.find(
      (classification: FieldClassification): boolean => {
        return classification.dataTypeId === "person-name";
      },
    );

    expect(name).toEqual(
      expect.objectContaining({
        matchCount: 1,
        foundByModel: true,
        maskedSamples: ["J****"],
      }),
    );
  });

  test("the same in a product's name column is no finding: the model is not asked", () => {
    let asked: number = 0;
    const found: Array<FieldClassification> = classifyField(
      "products.product_name",
      ["Ralph Lauren Slim Fit Polo Shirt", "Wireless Optical Mouse M185"],
      {
        recognitions: {
          get: (text: string): ReadonlyArray<RecognizedEntity> | undefined => {
            asked++;
            return recognitionsOf("Ralph Lauren").get(text);
          },
        },
      },
    );

    expect(asked).toBe(0);
    expect(
      found.some((classification: FieldClassification): boolean => {
        return classification.dataTypeId === "person-name";
      }),
    ).toBe(false);
  });
});

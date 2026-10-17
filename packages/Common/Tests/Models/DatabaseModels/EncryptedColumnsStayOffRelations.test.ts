import AllModelTypes from "../../../Models/DatabaseModels/Index";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import { TableColumnMetadata } from "../../../Types/Database/TableColumn";
import TableColumnType from "../../../Types/Database/TableColumnType";
import { describe, expect, test } from "@jest/globals";

/*
 * NO STORED SECRET IS SELECTED THROUGH A RELATION BY A REQUEST.
 *
 * DatabaseService decrypts the encrypted columns of every record a read
 * returns, the records joined in through a relation included - so that a
 * status page's SMS is sent with its Twilio config's auth token, not with
 * the ciphertext the database holds. That is safe only while no request
 * may select an encrypted column through a relation: the permission layer
 * lets a request select a related record's column only when the column is
 * marked canReadOnRelationQuery (QueryPermission.checkRelationQueryPermission),
 * and a secret marked so would come back to whoever may read the record
 * that names it, decrypted.
 *
 * So no encrypted column is marked canReadOnRelationQuery. A secret a
 * relation needs to show belongs in a column of its own that says whether
 * one is set (Workflow.isWebhookSigningSecretSet), never in the secret.
 */

interface EncryptedColumn {
  model: string;
  column: string;
  metadata: TableColumnMetadata;
}

function getEncryptedColumns(): Array<EncryptedColumn> {
  const columns: Array<EncryptedColumn> = [];

  for (const modelType of AllModelTypes) {
    const model: BaseModel = new modelType();

    for (const column of model.getEncryptedColumns().columns) {
      columns.push({
        model: model.tableName || modelType.name,
        column: column,
        metadata: model.getTableColumnMetadata(column),
      });
    }
  }

  return columns;
}

const ENCRYPTED_COLUMNS: Array<EncryptedColumn> = getEncryptedColumns();

describe("encrypted columns", () => {
  test("are really read from every model", () => {
    // 32 on 2026-10-14, the Twilio auth token among them.
    expect(ENCRYPTED_COLUMNS.length).toBeGreaterThanOrEqual(30);
    expect(
      ENCRYPTED_COLUMNS.map((column: EncryptedColumn): string => {
        return `${column.model}.${column.column}`;
      }),
    ).toEqual(
      expect.arrayContaining([
        "ProjectCallSMSConfig.twilioAuthToken",
        "LlmProvider.apiKey",
        "MonitorSecret.secretValue",
      ]),
    );
  });

  test("are never selectable through a relation", () => {
    expect(
      ENCRYPTED_COLUMNS.filter((column: EncryptedColumn): boolean => {
        return Boolean(column.metadata.canReadOnRelationQuery);
      }).map((column: EncryptedColumn): string => {
        return `${column.model}.${column.column}`;
      }),
    ).toEqual([]);
  });

  test("are never a relation themselves", () => {
    expect(
      ENCRYPTED_COLUMNS.filter((column: EncryptedColumn): boolean => {
        return (
          column.metadata.type === TableColumnType.Entity ||
          column.metadata.type === TableColumnType.EntityArray
        );
      }).map((column: EncryptedColumn): string => {
        return `${column.model}.${column.column}`;
      }),
    ).toEqual([]);
  });
});

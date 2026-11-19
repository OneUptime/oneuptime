import type { AxiosResponse } from "axios";
import apiClient from "./client";
import { LIST_COLUMNS } from "./recordFilters";
import { toPlainText } from "../utils/text";
import type { ColorField } from "./types";
import type { FilterableList } from "../filters/recordFilters";

/*
 * Who owns a record and how it is labelled, for its detail screen: the
 * owner tables beside the record (as the Dashboard's Owners card reads
 * them) and the record's own labels.
 */

export interface RecordOwner {
  kind: "user" | "team";
  id: string;
  name: string;
  // A person's email: their name when they have not set one.
  email?: string;
}

export interface RecordLabel {
  id: string;
  name: string;
  color?: ColorField | string | null;
}

function rowsOf(response: AxiosResponse): Array<Record<string, unknown>> {
  const rows: unknown = response.data?.data;
  if (!Array.isArray(rows)) {
    return [];
  }
  return rows.filter((row: unknown): row is Record<string, unknown> => {
    return Boolean(row) && typeof row === "object";
  });
}

function relation(
  row: Record<string, unknown>,
  key: string,
): Record<string, unknown> | null {
  const value: unknown = row[key];
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : null;
}

// The people first, then the teams, each by name; nobody twice.
export async function fetchRecordOwners(
  projectId: string,
  list: FilterableList,
  recordId: string,
): Promise<Array<RecordOwner>> {
  const tables: (typeof LIST_COLUMNS)[FilterableList]["owners"] =
    LIST_COLUMNS[list].owners;
  const read: (
    path: string,
    select: Record<string, unknown>,
  ) => Promise<AxiosResponse> = (
    path: string,
    select: Record<string, unknown>,
  ): Promise<AxiosResponse> => {
    return apiClient.post(
      `${path}/get-list?skip=0&limit=100`,
      {
        query: { [tables.recordIdColumn]: recordId },
        select: { _id: true, ...select },
        sort: { createdAt: "ASC" },
      },
      { headers: { tenantid: projectId } },
    );
  };

  const [people, teams]: [AxiosResponse, AxiosResponse] = await Promise.all([
    read(tables.userPath, { user: { _id: true, name: true, email: true } }),
    read(tables.teamPath, { team: { _id: true, name: true } }),
  ]);

  const owners: Array<RecordOwner> = [];
  const seen: Set<string> = new Set();
  const add: (owner: RecordOwner) => void = (owner: RecordOwner): void => {
    const key: string = `${owner.kind}:${owner.id}`;
    if (!owner.id || seen.has(key)) {
      return;
    }
    seen.add(key);
    owners.push(owner);
  };

  rowsOf(people).forEach((row: Record<string, unknown>): void => {
    const user: Record<string, unknown> | null = relation(row, "user");
    if (!user) {
      return;
    }
    const name: string = toPlainText(user["name"]).trim();
    const email: string = toPlainText(user["email"]).trim();
    add({
      kind: "user",
      id: toPlainText(user["_id"]),
      name: name || email,
      email: email || undefined,
    });
  });
  rowsOf(teams).forEach((row: Record<string, unknown>): void => {
    const team: Record<string, unknown> | null = relation(row, "team");
    if (!team) {
      return;
    }
    add({
      kind: "team",
      id: toPlainText(team["_id"]),
      name: toPlainText(team["name"]).trim(),
    });
  });

  return owners.filter((owner: RecordOwner): boolean => {
    return owner.name.length > 0;
  });
}

// The record's labels, by name.
export async function fetchRecordLabels(
  projectId: string,
  list: FilterableList,
  recordId: string,
): Promise<Array<RecordLabel>> {
  const response: AxiosResponse = await apiClient.post(
    `${LIST_COLUMNS[list].path}/get-list?skip=0&limit=1`,
    {
      query: { _id: recordId },
      select: { _id: true, labels: { _id: true, name: true, color: true } },
      sort: {},
    },
    { headers: { tenantid: projectId } },
  );
  const record: Record<string, unknown> | undefined = rowsOf(response)[0];
  const labels: unknown = record?.["labels"];
  if (!Array.isArray(labels)) {
    return [];
  }
  return labels
    .filter((label: unknown): label is Record<string, unknown> => {
      return Boolean(label) && typeof label === "object";
    })
    .map((label: Record<string, unknown>): RecordLabel => {
      return {
        id: toPlainText(label["_id"]),
        name: toPlainText(label["name"]).trim(),
        color: label["color"] as RecordLabel["color"],
      };
    })
    .filter((label: RecordLabel): boolean => {
      return label.id.length > 0 && label.name.length > 0;
    })
    .sort((a: RecordLabel, b: RecordLabel): number => {
      return a.name.localeCompare(b.name);
    });
}

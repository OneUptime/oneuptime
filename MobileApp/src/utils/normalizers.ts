export const ensureId = <T extends { id?: string; _id?: string }>(model: T): T & { id: string; _id?: string } => {
  const id = model.id ?? model._id ?? "";

  return {
    ...model,
    id,
    _id: model._id ?? id,
  } as T & { id: string; _id?: string };
};

export const ensureListIds = <T extends { id?: string; _id?: string }>(items: T[]): Array<T & { id: string; _id?: string }> => {
  return items.map((item) => ensureId(item));
};

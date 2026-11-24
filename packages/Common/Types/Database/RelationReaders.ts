/*
 * WHO READS A COLUMN THROUGH A RELATION (TableColumnMetadata.relationReaders),
 * once canReadOnRelationQuery lets a relation read it at all (#10281).
 *
 * A record names others, and a read of it may take some of their columns
 * along: `{ title: true, dataStore: { name: true } }`. Who may read those
 * columns is the question this answers, column by column:
 *
 *   - everyone who may read the relation, the record's own readers - a
 *     label on the joined row: a monitor's name on the incidents that name
 *     it, a severity's color, a data store's name on the data assets in it.
 *     The related record's own read permissions are not asked. A column
 *     marked canReadOnRelationQuery and nothing else is read so;
 *   - only those who may read the column on the related record itself, by
 *     its own read permissions: a data store's sensitivity, exposure and risk
 *     score, which the Security tiers read on the data security issue that
 *     names the store, and which a Viewer who reads the data assets in the
 *     store may not read. Before #10281 every column was read the first way,
 *     so that Viewer read every store's sensitivity, exposure, risk score,
 *     open issues and cloud account through the assets in it - what the Data
 *     Store model keeps to the Security tiers: "which buckets hold card
 *     numbers is exactly what an attacker wants to know".
 *
 * A select through the relation that names a column of the second kind is
 * refused whole for anyone else, as one naming a column no relation reads
 * is; so is a filter or an order by it, which read a value one guess at a
 * time (QueryPermission, SortValidator). A page reads such a column for the
 * readers who may (RelationReadersUtil.getSelectReadableThroughRelations).
 *
 * Which kind a column is, is decided where the column is declared, and a
 * column whose own read is narrower than the readers of a relation that
 * reaches it is read the first way only for a reason written down beside
 * the others (RelationReadsNoWiderThanTheColumn).
 */
enum RelationReaders {
  // Every reader of the relation: a label on the joined row. The default.
  EveryReaderOfTheRelation = "every-reader-of-the-relation",
  // Only who may read the column itself, by its own read permissions.
  ColumnReaders = "column-readers",
}

export default RelationReaders;

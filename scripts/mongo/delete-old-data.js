var collectionNames = db.getCollectionNames();

for (var collectionName of collectionNames) {
    print("Deleting " + collectionName);
    db.getCollection(collectionName).remove({ deleted: true });
    print("Deleted " + collectionName);
}
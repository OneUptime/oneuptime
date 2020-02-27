/* eslint-disable no-undef */

/**
 * This implementation is intended to execute within tests */

const collectionObject = {
    find: jest.fn().mockReturnValue({ toArray: () => [] }),
    insertMany: jest.fn().mockReturnValue(Promise.resolve({})),
    updateOne: jest.fn().mockReturnValue(Promise.resolve({})),
};

const collectionObjectWithRecords = {
    ...collectionObject,
    find: jest.fn().mockReturnValue({ toArray: () => [{}, {}] }),
};

function mockDbCollection(returnMultipleRecords) {
    global.db = {
        collection: () =>
            returnMultipleRecords
                ? collectionObjectWithRecords
                : collectionObject,
    };
}

function mockDbClient() {
    global.client = {
        connect: jest.fn().mockReturnValue({
            db: jest.fn().mockReturnValue({
                collection: jest.fn().mockReturnValue(collectionObject),
            }),
            close: jest.fn(),
        }),
    };
}

module.exports = {
    collectionObject,
    mockDbCollection,
    mockDbClient,
};

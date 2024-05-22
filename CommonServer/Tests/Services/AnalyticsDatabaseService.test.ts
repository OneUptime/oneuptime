import '../TestingUtils/Init';
import AnalyticsBaseModel from 'Common/AnalyticsModels/BaseModel';
import Route from 'Common/Types/API/Route';
import AnalyticsTableEngine from 'Common/Types/AnalyticsDatabase/AnalyticsTableEngine';
import AnalyticsTableColumn from 'Common/Types/AnalyticsDatabase/TableColumn';
import TableColumnType from 'Common/Types/AnalyticsDatabase/TableColumnType';
import AnalyticsDatabaseService from '../../Services/AnalyticsDatabaseService';
import { SQL, Statement } from '../../Utils/AnalyticsDatabase/Statement';
import logger from '../../Utils/Logger';
import GenericObject from 'Common/Types/GenericObject';

describe('AnalyticsDatabaseService', () => {
    class TestModel extends AnalyticsBaseModel {
        public constructor() {
            super({
                tableName: '<table-name>',
                singularName: '<singular-name>',
                pluralName: '<plural-name>',
                tableColumns: [
                    new AnalyticsTableColumn({
                        key: `column_ObjectID`,
                        title: '<title>',
                        description: '<description>',
                        required: true,
                        type: TableColumnType.ObjectID,
                    }),
                    new AnalyticsTableColumn({
                        key: `column_1`,
                        title: '<title>',
                        description: '<description>',
                        required: false,
                        type: TableColumnType.Text,
                    }),
                    new AnalyticsTableColumn({
                        key: `column_2`,
                        title: '<title>',
                        description: '<description>',
                        required: false,
                        type: TableColumnType.Number,
                    }),
                ],
                crudApiPath: new Route('route'),
                primaryKeys: ['column_ObjectID'],
                tableEngine: AnalyticsTableEngine.MergeTree,
            });
        }
    }

    let service: AnalyticsDatabaseService<TestModel>;
    beforeEach(() => {
        service = new AnalyticsDatabaseService({
            modelType: TestModel,
        });
    });

    describe('toCountStatement', () => {
        beforeEach(() => {
            service.statementGenerator.toWhereStatement = jest.fn(() => {
                return SQL`<where-statement>`;
            });
            jest.spyOn(logger, 'debug').mockImplementation(() => {
                return undefined!;
            });
        });

        afterEach(() => {
            jest.restoreAllMocks();
        });

        test('should return count statement', () => {
            const statement: Statement = service.toCountStatement({
                query: '<query>' as GenericObject,
                props: '<props>' as GenericObject,
            });

            expect(service.statementGenerator.toWhereStatement).toBeCalledWith(
                '<query>'
            );

            expect(logger.debug).toHaveBeenCalledTimes(2);
            expect(logger.debug).toHaveBeenNthCalledWith(
                1,
                '<table-name> Count Statement'
            );
            expect(logger.debug).toHaveBeenNthCalledWith(2, statement);

            expect(statement.query).toBe(
                'SELECT\n' +
                    '    count()\n' +
                    'FROM {p0:Identifier}.{p1:Identifier}\n' +
                    'WHERE TRUE <where-statement>'
            );
            expect(statement.query_params).toStrictEqual({
                p0: 'oneuptime',
                p1: '<table-name>',
            });
        });

        test('optionally adds LIMIT', () => {
            const statement: Statement = service.toCountStatement({
                query: '<query>' as GenericObject,
                props: '<props>' as GenericObject,
                limit: 123,
            });

            expect(statement.query).toBe(
                'SELECT\n' +
                    '    count()\n' +
                    'FROM {p0:Identifier}.{p1:Identifier}\n' +
                    'WHERE TRUE <where-statement>\n' +
                    'LIMIT {p2:Int32}'
            );
            expect(statement.query_params).toStrictEqual({
                p0: 'oneuptime',
                p1: '<table-name>',
                p2: 123,
            });
        });

        test('optionally adds OFFSET', () => {
            const statement: Statement = service.toCountStatement({
                query: '<query>' as GenericObject,
                props: '<props>' as GenericObject,
                skip: 123,
            });

            expect(statement.query).toBe(
                'SELECT\n' +
                    '    count()\n' +
                    'FROM {p0:Identifier}.{p1:Identifier}\n' +
                    'WHERE TRUE <where-statement>\n' +
                    'OFFSET {p2:Int32}'
            );
            expect(statement.query_params).toStrictEqual({
                p0: 'oneuptime',
                p1: '<table-name>',
                p2: 123,
            });
        });
    });

    describe('toFindStatement', () => {
        beforeEach(() => {
            service.statementGenerator.toSelectStatement = jest.fn(() => {
                return {
                    statement: SQL`<select-statement>`,
                    columns: ['<column-1>', '<column-2>'],
                };
            });
            service.statementGenerator.toWhereStatement = jest.fn(() => {
                return SQL`<where-statement>`;
            });
            service.statementGenerator.toSortStatement = jest.fn(() => {
                return SQL`<sort-statement>`;
            });
            jest.spyOn(logger, 'debug').mockImplementation(() => {
                return undefined!;
            });
        });

        afterEach(() => {
            jest.restoreAllMocks();
        });

        test('should return find statement', () => {
            const { statement, columns } = service.toFindStatement({
                select: '<select>' as GenericObject,
                query: '<query>' as GenericObject,
                props: '<props>' as GenericObject,
                sort: '<sort>' as GenericObject,
                limit: 123,
                skip: 234,
            });

            expect(service.statementGenerator.toSelectStatement).toBeCalledWith(
                '<select>'
            );
            expect(service.statementGenerator.toWhereStatement).toBeCalledWith(
                '<query>'
            );
            expect(service.statementGenerator.toSortStatement).toBeCalledWith(
                '<sort>'
            );

            expect(jest.mocked(logger.debug)).toHaveBeenCalledTimes(2);
            expect(jest.mocked(logger.debug)).toHaveBeenNthCalledWith(
                1,
                '<table-name> Find Statement'
            );
            expect(jest.mocked(logger.debug)).toHaveBeenNthCalledWith(
                2,
                statement
            );

            expect(statement.query).toBe(
                'SELECT <select-statement> FROM {p0:Identifier}.{p1:Identifier} WHERE TRUE <where-statement> ORDER BY <sort-statement> LIMIT {p2:Int32} OFFSET {p3:Int32}'
            );
            expect(statement.query_params).toStrictEqual({
                p0: 'oneuptime',
                p1: '<table-name>',
                p2: 123, // limit
                p3: 234, // offset
            });
            expect(columns).toStrictEqual(['<column-1>', '<column-2>']);
        });

        describe('toDeleteStatement', () => {
            beforeEach(() => {
                service.statementGenerator.toWhereStatement = jest.fn(() => {
                    return SQL`<where-statement>`;
                });
                jest.spyOn(logger, 'debug').mockImplementation(() => {
                    return undefined!;
                });
            });

            afterEach(() => {
                jest.restoreAllMocks();
            });

            test('should return delete statement', () => {
                const statement: Statement = service.toDeleteStatement({
                    query: '<query>' as GenericObject,
                    props: '<props>' as GenericObject,
                });

                expect(
                    service.statementGenerator.toWhereStatement
                ).toBeCalledWith('<query>');

                expect(logger.debug).toHaveBeenCalledTimes(2);
                expect(logger.debug).toHaveBeenNthCalledWith(
                    1,
                    '<table-name> Delete Statement'
                );
                expect(logger.debug).toHaveBeenNthCalledWith(2, statement);

                expect(statement.query).toBe(
                    'ALTER TABLE {p0:Identifier}.{p1:Identifier}\n' +
                        'DELETE WHERE TRUE <where-statement>'
                );
                expect(statement.query_params).toStrictEqual({
                    p0: 'oneuptime',
                    p1: '<table-name>',
                });
            });
        });
    });
});

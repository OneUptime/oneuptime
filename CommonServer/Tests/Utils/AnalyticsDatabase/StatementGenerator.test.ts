import '../../TestingUtils/Init';
import AnalyticsBaseModel from 'Common/AnalyticsModels/BaseModel';
import AnalyticsTableColumn from 'Common/Types/AnalyticsDatabase/TableColumn';
import TableColumnType from 'Common/Types/AnalyticsDatabase/TableColumnType';
import StatementGenerator from '../../../Utils/AnalyticsDatabase/StatementGenerator';
import { ClickhouseAppInstance } from '../../../Infrastructure/ClickhouseDatabase';
import ObjectID from 'Common/Types/ObjectID';

describe('StatementGenerator', () => {
    class TestModel extends AnalyticsBaseModel {
        public constructor() {
            super({
                tableName: '<table-name>',
                singularName: '<singular-name>',
                pluralName: '<plural-name>',
                tableColumns: Object.keys(TableColumnType)
                    .filter((tableColumnType: string) => {
                        // NestedModel not supported?
                        return tableColumnType !== 'NestedModel';
                    })
                    .map((tableColumnType: string) => {
                        return new AnalyticsTableColumn({
                            key: `column_${tableColumnType}`,
                            title: '<title>',
                            description: '<description>',
                            required: tableColumnType === 'ObjectID',
                            type: TableColumnType[
                                tableColumnType as keyof typeof TableColumnType
                            ],
                        });
                    }),
                primaryKeys: ['column_ObjectID'],
            });
        }
    }

    let generator: StatementGenerator<TestModel>;
    beforeEach(async () => {
        generator = new StatementGenerator<TestModel>({
            modelType: TestModel,
            database: ClickhouseAppInstance,
        });
    });

    describe('toSetStatement', () => {
        let model: TestModel;
        beforeEach(() => {
            model = new TestModel();
        });

        test('should return the contents of a SET statement', () => {
            model.setColumnValue('column_ObjectID', new ObjectID('<value>'));
            model.setColumnValue('column_Date', new Date(9876543210));
            model.setColumnValue('column_Number', 123);
            model.setColumnValue('column_Text', '<value>');
            model.setColumnValue('column_JSON', { key: '<value>' });
            model.setColumnValue('column_Decimal', 234.56);
            model.setColumnValue('column_ArrayNumber', [3, 4, 5]);
            model.setColumnValue('column_ArrayText', [
                '<value-1>',
                '<value-2>',
            ]);
            model.setColumnValue('column_LongNumber', '12345678901234567890');
            expect(generator.toSetStatement(model)).toEqual(
                "column_ObjectID = '<value>', " +
                    "column_Date = parseDateTimeBestEffortOrNull('1970-04-25T07:29:03.210Z'), " +
                    'column_Number = 123, ' +
                    "column_Text = '<value>', " +
                    'column_JSON = \'{"key":"<value>"}\', ' +
                    'column_Decimal = 234.56, ' +
                    'column_ArrayNumber = [3, 4, 5], ' +
                    "column_ArrayText = ['<value-1>', '<value-2>'], " +
                    "column_LongNumber = CAST('12345678901234567890' AS Int128)"
            );
        });

        test('should sanitize column values', () => {
            const unsafeString: string = "Robert'; DROP TABLE Students;--";
            model.setColumnValue('column_ObjectID', new ObjectID(unsafeString));
            // model.setColumnValue('column_Date', unsafeString); // throws error
            model.setColumnValue('column_Number', unsafeString);
            model.setColumnValue('column_Text', unsafeString);
            model.setColumnValue('column_JSON', { key: unsafeString });
            model.setColumnValue('column_Decimal', unsafeString);
            model.setColumnValue('column_ArrayNumber', [
                ']; DROP TABLE Students;--',
            ]);
            model.setColumnValue('column_ArrayText', [
                "Robert']; DROP TABLE Students;--",
            ]);
            model.setColumnValue(
                'column_LongNumber',
                '0; DROP TABLE Students;--'
            );
            expect(generator.toSetStatement(model)).toEqual(
                "column_ObjectID = 'Robert\\'; DROP TABLE Students;--', " +
                    'column_Number = NULL, ' +
                    "column_Text = 'Robert\\'; DROP TABLE Students;--', " +
                    'column_JSON = \'{"key":"Robert\\\'; DROP TABLE Students;--"}\', ' +
                    'column_Decimal = NULL, ' +
                    'column_ArrayNumber = [NULL], ' +
                    "column_ArrayText = ['Robert\\']; DROP TABLE Students;--'], " +
                    "column_LongNumber = CAST('0; DROP TABLE Students;--' AS Int128)"
            );
        });

        test('should set column to NULL', () => {
            model.setColumnValue('column_Text', null);
            expect(generator.toSetStatement(model)).toEqual(
                'column_Text = NULL'
            );
        });
    });
});

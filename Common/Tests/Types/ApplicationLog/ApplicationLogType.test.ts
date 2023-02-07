import ApplicationLogType from '../../../Types/ApplicationLog/ApplicationLogType';



describe('ApplicationLogType', () => {
    test('ApplicationLogType.Info to be Info', () => {
        expect(ApplicationLogType.Info).toBe('Info');
    });
    test('ApplicationLogType.Error to Error', () => {
        expect(ApplicationLogType.Error).toBe('Error');
    }); 
    test('ApplicationLogType.Warning to Warning', () => {
        expect(ApplicationLogType.Warning).toBe('Warning');
    }); 
    
});

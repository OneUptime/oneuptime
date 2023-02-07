import AlertType from '../../../Types/Alerts/AlertType';



describe('AlertType', () => {
    
    test('AlertType.Email to be Email', () => {
        expect(AlertType.Webhook).toBe('Webhook');
    });
    test('AlertType.Acknowledged to Acknowledged', () => {
        expect(AlertType.Email).toBe('Email');
    }); 
    test('AlertType.SMS to SMS', () => {
        expect(AlertType.SMS).toBe('SMS');
    }); 
    test('AlertType.Call to Call', () => {
        expect(AlertType.Call).toBe('Call');
    }); 
    test('AlertType.PushNotification to PushNotification', () => {
        expect(AlertType.PushNotification).toBe('PushNotification');
    }); 
 
});

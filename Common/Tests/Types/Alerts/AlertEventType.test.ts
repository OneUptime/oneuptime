import AlertEventType from '../../../Types/Alerts/AlertEventType';

describe('AlertEventType', () => {
    test('AlertEventType.Identified to be Identified', () => {
        expect(AlertEventType.Identified).toBe('Identified');
    });
    test('AlertEventType.Acknowledged to Acknowledged', () => {
        expect(AlertEventType.Acknowledged).toBe('Acknowledged');
    });
    test('AlertEventType.Resolved to Resolved', () => {
        expect(AlertEventType.Resolved).toBe('Resolved');
    });
    test('AlertEventType.InvestigationNoteCreated to Investigation note created', () => {
        expect(AlertEventType.InvestigationNoteCreated).toBe(
            'Investigation note created'
        );
    });
    test('AlertEventType.InvestigationNoteUpdated to Investigation note updated', () => {
        expect(AlertEventType.InvestigationNoteUpdated).toBe(
            'Investigation note updated'
        );
    });
    test('AlertEventType.ScheduledMaintenanceCreated to Scheduled maintenance created', () => {
        expect(AlertEventType.ScheduledMaintenanceCreated).toBe(
            'Scheduled maintenance created'
        );
    });
    test('AlertEventType.ScheduledMaintenanceNoteCreated to Scheduled maintenance note Created', () => {
        expect(AlertEventType.ScheduledMaintenanceNoteCreated).toBe(
            'Scheduled maintenance note created'
        );
    });

    test('AlertEventType.ScheduledMaintenanceResolved to scheduled maintenance resolved', () => {
        expect(AlertEventType.ScheduledMaintenanceResolved).toBe(
            'Scheduled maintenance resolved'
        );
    });
    test('AlertEventType.Acknowledged to Scheduled maintenance cancelled', () => {
        expect(AlertEventType.ScheduledMaintenanceCancelled).toBe(
            'Scheduled maintenance cancelled'
        );
    });
    test('AlertEventType.AnnouncementNotificationCreated to Announcement notification created', () => {
        expect(AlertEventType.AnnouncementNotificationCreated).toBe(
            'Announcement notification created'
        );
    });
});

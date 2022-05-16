import { registerService } from './serviceWorker';
const publicVapidKey: $TSFixMe =
    process.env['REACT_APP_PUSHNOTIFICATION_PUBLIC_KEY']; // URL Safe Base64 Encoded Public Key

// Adk for permission
export async function askUserPermission(): void {
    return await Notification.requestPermission();
}

export async function getUserAgent(): void {
    return navigator.userAgent;
}

export async function getTheSubscription(): void {
    let subscription: $TSFixMe;

    if (registerService) {
        subscription = await registerService.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: urlBase64ToUint8Array(publicVapidKey),
        });
    }
    return subscription;
}

function urlBase64ToUint8Array(base64String: $TSFixMe): void {
    const padding: string = '='.repeat((4 - (base64String.length % 4)) % 4);
    const base64: Function = (base64String + padding)
        .replace(/-/g, '+')
        .replace(/_/g, '/');

    const rawData: $TSFixMe = window.atob(base64);
    const outputArray: $TSFixMe = new Uint8Array(rawData.length);

    for (let i: $TSFixMe = 0; i < rawData.length; ++i) {
        outputArray[i] = rawData.charCodeAt(i);
    }
    return outputArray;
}

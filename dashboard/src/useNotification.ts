import { registerService } from './serviceWorker';
const publicVapidKey = process.env.REACT_APP_PUSHNOTIFICATION_PUBLIC_KEY; // URL Safe Base64 Encoded Public Key

// Adk for permission
export async function askUserPermission() {
    return await Notification.requestPermission();
}

export async function getUserAgent() {
    return await navigator.userAgent;
}

export async function getTheSubscription() {
    let subscription;
    if (registerService) {
        subscription = await registerService.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: urlBase64ToUint8Array(publicVapidKey),
        });
    }
    return subscription;
}

function urlBase64ToUint8Array(base64String) {
    const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
    const base64 = (base64String + padding)
        .replace(/-/g, '+')
        .replace(/_/g, '/');

    const rawData = window.atob(base64);
    const outputArray = new Uint8Array(rawData.length);

    for (let i = 0; i < rawData.length; ++i) {
        outputArray[i] = rawData.charCodeAt(i);
    }
    return outputArray;
}

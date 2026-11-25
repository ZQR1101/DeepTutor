import { TurboModuleRegistry, type TurboModule } from 'react-native';

interface NetworkingCookies extends TurboModule {
  clearCookies(callback: (removedCookies: boolean) => void): void;
}

/**
 * Native networking and WebSocket share the OS cookie store. Cookies are not
 * scoped by port, so switching origins must clear the jar before probing the
 * next origin. Never read HttpOnly values into JavaScript.
 */
export async function clearNativeCookies(): Promise<void> {
  const networking = TurboModuleRegistry.get<NetworkingCookies>('Networking');
  if (!networking || typeof networking.clearCookies !== 'function') {
    throw new Error('此版本无法清除已保存的登录状态。');
  }
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error('无法清除已保存的登录状态。')),
      5000,
    );
    // False means the store was already empty on either supported platform.
    networking.clearCookies(() => {
      clearTimeout(timer);
      resolve();
    });
  });
}

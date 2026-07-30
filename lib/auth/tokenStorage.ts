import * as SecureStore from 'expo-secure-store'
import { Platform } from 'react-native'

import type { TokenStorage } from '@convex-dev/auth/react'

function getWebStorage(): Storage {
  return globalThis.localStorage
}

export const tokenStorage: TokenStorage = {
  getItem: (key: string): Promise<string | null> => {
    if (Platform.OS === 'web') {
      return Promise.resolve(getWebStorage().getItem(key))
    }

    return SecureStore.getItemAsync(key)
  },
  removeItem: (key: string): Promise<void> => {
    if (Platform.OS === 'web') {
      getWebStorage().removeItem(key)
      return Promise.resolve()
    }

    return SecureStore.deleteItemAsync(key)
  },
  setItem: (key: string, value: string): Promise<void> =>
    Platform.OS === 'web'
      ? Promise.resolve(getWebStorage().setItem(key, value))
      : SecureStore.setItemAsync(key, value),
}

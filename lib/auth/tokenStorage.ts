import * as SecureStore from 'expo-secure-store'

import type { TokenStorage } from '@convex-dev/auth/react'

export const tokenStorage: TokenStorage = {
  getItem: (key: string): Promise<string | null> => SecureStore.getItemAsync(key),
  removeItem: (key: string): Promise<void> => SecureStore.deleteItemAsync(key),
  setItem: (key: string, value: string): Promise<void> =>
    SecureStore.setItemAsync(key, value),
}

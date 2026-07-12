import '../global.css'

import { Stack } from 'expo-router'
import type { ReactElement } from 'react'

export default function RootLayout(): ReactElement {
  return <Stack screenOptions={{ headerShown: false }} />
}

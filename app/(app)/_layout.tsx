import { Tabs } from 'expo-router'
import type { ReactElement } from 'react'

export default function AppLayout(): ReactElement {
  return (
    <Tabs>
      <Tabs.Screen name="chat" options={{ title: 'Chat' }} />
      <Tabs.Screen name="history" options={{ title: 'History' }} />
      <Tabs.Screen name="profile" options={{ title: 'Profile' }} />
    </Tabs>
  )
}

import { Tabs } from 'expo-router'
import type { ReactElement } from 'react'
import { StyleSheet } from 'react-native'

export default function AppLayout(): ReactElement {
  return (
    <Tabs screenOptions={screenOptions}>
      <Tabs.Screen name="chat" />
      <Tabs.Screen name="history" options={{ href: null }} />
      <Tabs.Screen name="motion-lab" options={{ href: null }} />
      <Tabs.Screen name="profile" options={{ href: null }} />
    </Tabs>
  )
}

const styles = StyleSheet.create({
  tabBar: { display: 'none' },
})

const screenOptions = {
  headerShown: false,
  tabBarStyle: styles.tabBar,
} as const

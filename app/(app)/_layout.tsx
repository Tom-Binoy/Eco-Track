import { Tabs } from 'expo-router'
import type { ReactElement } from 'react'
import { StyleSheet } from 'react-native'

import { AppTabIcon, type AppTabName } from '@/components/ui/AppTabIcon'
import { colors, typography } from '@/components/ui/theme'

export default function AppLayout(): ReactElement {
  return (
    <Tabs screenOptions={screenOptions}>
      {(['chat', 'history', 'report'] as const).map((name) => (
        <Tabs.Screen
          key={name}
          name={name}
          options={{
            tabBarAccessibilityLabel: `${name[0]?.toUpperCase()}${name.slice(1)} tab`,
            tabBarIcon: ({ color }) => <AppTabIcon color={color} name={name as AppTabName} />,
            title: `${name[0]?.toUpperCase()}${name.slice(1)}`,
          }}
        />
      ))}
      <Tabs.Screen name="profile" options={{ href: null }} />
    </Tabs>
  )
}

const styles = StyleSheet.create({
  tabBar: {
    backgroundColor: colors.nav,
    borderTopColor: colors.borderSubtle,
    borderTopWidth: StyleSheet.hairlineWidth,
    height: 64,
    paddingBottom: 7,
    paddingTop: 5,
  },
  tabLabel: { fontFamily: typography.body, fontSize: 10, fontWeight: '600', letterSpacing: 0.3, textTransform: 'uppercase' },
})

const screenOptions = {
  headerShown: false,
  sceneStyle: { backgroundColor: colors.background },
  tabBarActiveTintColor: colors.accent,
  tabBarHideOnKeyboard: true,
  tabBarInactiveTintColor: '#aaa69f',
  tabBarItemStyle: { minHeight: 44 },
  tabBarLabelStyle: styles.tabLabel,
  tabBarStyle: styles.tabBar,
} as const

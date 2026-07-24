import { StyleSheet, Text, View } from 'react-native'
import type { ReactElement } from 'react'

export default function OnboardingScreen(): ReactElement {
  return (
    <View style={styles.container}>
      <Text>Onboarding (Phase 8)</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  container: { alignItems: 'center', flex: 1, justifyContent: 'center' },
})

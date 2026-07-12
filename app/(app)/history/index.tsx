import { StyleSheet, Text, View } from 'react-native'
import type { ReactElement } from 'react'

export default function HistoryScreen(): ReactElement {
  return (
    <View style={styles.container}>
      <Text>History Screen</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  container: { alignItems: 'center', flex: 1, justifyContent: 'center' },
})

import { StyleSheet, Text, View } from 'react-native'
import type { ReactElement } from 'react'

export default function SignInScreen(): ReactElement {
  return (
    <View style={styles.container}>
      <Text>Sign In Screen</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  container: { alignItems: 'center', flex: 1, justifyContent: 'center' },
})

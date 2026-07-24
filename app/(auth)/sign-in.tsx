import * as Linking from 'expo-linking'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import type { ReactElement } from 'react'

import { useAuth } from '@/hooks/useAuth'

export default function SignInScreen(): ReactElement {
  const { signIn } = useAuth()

  const handleGoogleSignIn = async (): Promise<void> => {
    const { redirect } = await signIn('google', {
      redirectTo: Linking.createURL('/'),
    })

    if (redirect !== undefined) {
      await Linking.openURL(redirect.toString())
    }
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Welcome to Eco Track</Text>
      <Pressable
        accessibilityRole="button"
        onPress={() => void handleGoogleSignIn()}
        style={styles.googleButton}
      >
        <Text style={styles.googleButtonText}>Continue with Google</Text>
      </Pressable>
    </View>
  )
}

const styles = StyleSheet.create({
  container: { alignItems: 'center', flex: 1, justifyContent: 'center' },
  googleButton: {
    alignItems: 'center',
    backgroundColor: '#000',
    borderRadius: 8,
    justifyContent: 'center',
    minHeight: 44,
    paddingHorizontal: 20,
  },
  googleButtonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  title: { fontSize: 24, marginBottom: 32 },
})

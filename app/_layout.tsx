import '../global.css'

import { ConvexAuthProvider, useAuthActions } from '@convex-dev/auth/react'
import { ConvexReactClient, useMutation } from 'convex/react'
import * as Linking from 'expo-linking'
import { Slot, useRouter, useSegments } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import type { Href } from 'expo-router'
import { useEffect } from 'react'
import type { ReactElement } from 'react'
import { ActivityIndicator, Platform, StyleSheet, Text, View } from 'react-native'
import { GestureHandlerRootView } from 'react-native-gesture-handler'

import { api } from '@/convex/_generated/api'
import { useAuth } from '@/hooks/useAuth'
import { tokenStorage } from '@/lib/auth/tokenStorage'
import { colors } from '@/components/ui/theme'
import { MotionProvider } from '@/hooks/useMotion'

const convexUrl = process.env.EXPO_PUBLIC_CONVEX_URL

if (convexUrl === undefined) {
  throw new Error('EXPO_PUBLIC_CONVEX_URL is required')
}

const convex = new ConvexReactClient(convexUrl)

function OAuthCallbackHandler(): null {
  const { signIn } = useAuthActions()

  useEffect(() => {
    const completeSignIn = (url: string): void => {
      const code = Linking.parse(url).queryParams?.code

      if (typeof code === 'string') {
        void signIn('google', { code })
      }
    }

    void Linking.getInitialURL().then((url) => {
      if (url !== null) {
        completeSignIn(url)
      }
    })

    const subscription = Linking.addEventListener('url', ({ url }) => {
      completeSignIn(url)
    })

    return (): void => subscription.remove()
  }, [signIn])

  return null
}

function AuthGuard(): ReactElement {
  const { isLoading, isOnboarded, isSignedIn, profile } = useAuth()
  const createProfile = useMutation(api.functions.profiles.createProfile)
  const router = useRouter()
  const segments = useSegments()

  useEffect(() => {
    if (isSignedIn && profile === null) {
      void createProfile({})
    }
  }, [createProfile, isSignedIn, profile])

  useEffect(() => {
    if (isLoading || (isSignedIn && profile === null)) {
      return
    }

    const inAuthGroup = segments[0] === '(auth)'
    const onOnboarding = segments.join('/') === '(auth)/onboarding'

    if (!isSignedIn && !inAuthGroup) {
      router.replace('/(auth)/sign-in')
    } else if (isSignedIn && !isOnboarded && !onOnboarding) {
      router.replace('/(auth)/onboarding' as Href)
    } else if (isSignedIn && isOnboarded && inAuthGroup) {
      router.replace('/(app)/chat')
    }
  }, [isLoading, isOnboarded, isSignedIn, profile, router, segments])

  if (isLoading || (isSignedIn && profile === null)) {
    return <AppLoadingScreen />
  }

  return <Slot />
}

function AppLoadingScreen(): ReactElement {
  return (
    <View style={styles.loadingContainer}>
      <ActivityIndicator color="#ffffff" size="small" />
      <Text style={styles.loadingLabel}>Opening Eco Track…</Text>
    </View>
  )
}

export default function RootLayout(): ReactElement {
  return (
    <GestureHandlerRootView style={styles.root}>
      <StatusBar style="light" />
      <ConvexAuthProvider client={convex} storage={tokenStorage}>
        <MotionProvider>
          {Platform.OS !== 'web' && <OAuthCallbackHandler />}
          <AuthGuard />
        </MotionProvider>
      </ConvexAuthProvider>
    </GestureHandlerRootView>
  )
}

const styles = StyleSheet.create({
  loadingContainer: {
    alignItems: 'center',
    backgroundColor: colors.frame,
    flex: 1,
    gap: 12,
    justifyContent: 'center',
  },
  loadingLabel: { color: '#ffffff', fontSize: 15 },
  root: { backgroundColor: colors.frame, flex: 1 },
})

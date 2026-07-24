import { useAuthActions, useConvexAuth } from '@convex-dev/auth/react'
import { useQuery } from 'convex/react'

import { api } from '@/convex/_generated/api'

type UseAuthResult = {
  isLoading: boolean
  isOnboarded: boolean
  isSignedIn: boolean
  profile: ReturnType<typeof useQuery<typeof api.functions.profiles.getMyProfile>>
  signIn: ReturnType<typeof useAuthActions>['signIn']
  signOut: ReturnType<typeof useAuthActions>['signOut']
}

export function useAuth(): UseAuthResult {
  const { signIn, signOut } = useAuthActions()
  const { isAuthenticated, isLoading: isAuthLoading } = useConvexAuth()
  const profile = useQuery(
    api.functions.profiles.getMyProfile,
    isAuthenticated ? {} : 'skip',
  )

  const isLoading = isAuthLoading || (isAuthenticated && profile === undefined)
  const isOnboarded =
    isAuthenticated &&
    profile !== null &&
    profile !== undefined &&
    profile.timezone !== 'UTC' &&
    profile.goals !== ''

  return {
    signIn,
    signOut,
    profile,
    isLoading,
    isSignedIn: isAuthenticated,
    isOnboarded,
  }
}

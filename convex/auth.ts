import Google from '@auth/core/providers/google'
import { convexAuth } from '@convex-dev/auth/server'

const nativeRedirectUrl = 'eco-track://'

function isAllowedRedirect(redirectTo: string): boolean {
  if (redirectTo.startsWith(nativeRedirectUrl)) {
    return true
  }

  try {
    const url = new URL(redirectTo)
    return (
      url.protocol === 'http:' &&
      (url.hostname === 'localhost' || url.hostname === '127.0.0.1')
    )
  } catch {
    return false
  }
}

export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
  providers: [Google],
  callbacks: {
    async redirect({ redirectTo }) {
      return isAllowedRedirect(redirectTo) ? redirectTo : nativeRedirectUrl
    },
  },
})

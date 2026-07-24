import Google from '@auth/core/providers/google'
import { convexAuth } from "@convex-dev/auth/server";

export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
  providers: [Google],
  callbacks: {
    async redirect({ redirectTo }) {
      return redirectTo.startsWith('eco-track://')
        ? redirectTo
        : 'eco-track://'
    },
  },
});

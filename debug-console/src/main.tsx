import { ConvexAuthProvider } from '@convex-dev/auth/react'
import { ConvexReactClient } from 'convex/react'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import { App } from './App'
import './styles.css'

const convexUrl =
  import.meta.env.VITE_CONVEX_URL ??
  import.meta.env.EXPO_PUBLIC_CONVEX_URL

const root = document.getElementById('root')
if (root === null) throw new Error('Root element was not found.')

if (convexUrl === undefined) {
  createRoot(root).render(
    <StrictMode>
      <main className="configuration-error">
        <p className="eyebrow">ECO / DEBUG CONSOLE</p>
        <h1>Development URL missing</h1>
        <p>
          Set <code>VITE_CONVEX_URL</code>, or keep the app&apos;s existing
          <code> EXPO_PUBLIC_CONVEX_URL</code> in the parent environment.
        </p>
      </main>
    </StrictMode>,
  )
} else {
  const convex = new ConvexReactClient(convexUrl)
  createRoot(root).render(
    <StrictMode>
      <ConvexAuthProvider
        client={convex}
        replaceURL={(relativeUrl) => {
          window.history.replaceState({}, '', relativeUrl)
        }}
      >
        <App />
      </ConvexAuthProvider>
    </StrictMode>,
  )
}

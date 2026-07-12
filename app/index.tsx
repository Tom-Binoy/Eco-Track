import { Redirect } from 'expo-router'
import type { ReactElement } from 'react'

export default function Index(): ReactElement {
  return <Redirect href="/(auth)/sign-in" />
}

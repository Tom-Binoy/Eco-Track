import { useReducedMotion } from 'react-native-reanimated'
import { createContext, useContext, type ReactNode, type ReactElement } from 'react'

import { useAuth } from '@/hooks/useAuth'
import { defaultEcoRevealPreference, defaultMotionPreference, type EcoRevealPreference, type MotionPreference } from '@/types/motion'

export interface MotionTokens {
  ambient: number
  entrance: number
  modal: number
  stagger: number
}

interface MotionContextValue {
  ecoRevealPreference: EcoRevealPreference
  motionPreference: MotionPreference
  reducedMotion: boolean
  tokens: MotionTokens
}

const MotionContext = createContext<MotionContextValue>({
  ecoRevealPreference: defaultEcoRevealPreference,
  motionPreference: defaultMotionPreference,
  reducedMotion: false,
  tokens: { ambient: 1800, entrance: 240, modal: 320, stagger: 45 },
})

const responsiveTokens: MotionTokens = { ambient: 1800, entrance: 240, modal: 320, stagger: 45 }
const cinematicTokens: MotionTokens = { ambient: 2600, entrance: 440, modal: 560, stagger: 85 }

export function MotionProvider({ children }: { children: ReactNode }): ReactElement {
  const { profile } = useAuth()
  const reduceMotion = useReducedMotion()
  const motionPreference = profile?.motionPreference ?? defaultMotionPreference
  const ecoRevealPreference = profile?.ecoRevealPreference ?? defaultEcoRevealPreference

  return (
    <MotionContext.Provider value={{
      ecoRevealPreference,
      motionPreference,
      reducedMotion: reduceMotion,
      tokens: motionPreference === 'cinematic' ? cinematicTokens : responsiveTokens,
    }}>
      {children}
    </MotionContext.Provider>
  )
}

export function useMotion(): MotionContextValue {
  return useContext(MotionContext)
}

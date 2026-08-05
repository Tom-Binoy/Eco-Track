import { Platform } from 'react-native'

export const colors = {
  accent: '#22c55e',
  accentDark: '#14532d',
  accentGlow: 'rgba(34, 197, 94, 0.20)',
  accentMuted: '#4ade80',
  background: '#2b2a27',
  border: 'rgba(255, 255, 255, 0.08)',
  borderSubtle: 'rgba(255, 255, 255, 0.04)',
  danger: '#ef4444',
  dangerMuted: '#d98282',
  faint: '#696762',
  frame: '#151412',
  inset: '#252420',
  nav: '#201f1c',
  surface: '#302f2c',
  surfaceRaised: '#3a3936',
  text: '#eeeeee',
  textMuted: '#9a9893',
} as const

export const shadows = {
  card: Platform.select({
    android: { elevation: 5 },
    default: { shadowColor: '#000000', shadowOffset: { height: 4, width: 0 }, shadowOpacity: 0.24, shadowRadius: 12 },
  }),
  composer: Platform.select({
    android: { elevation: 8 },
    default: { shadowColor: '#000000', shadowOffset: { height: 8, width: 0 }, shadowOpacity: 0.30, shadowRadius: 14 },
  }),
  glow: Platform.select({
    android: { elevation: 3 },
    default: { shadowColor: colors.accent, shadowOffset: { height: 0, width: 0 }, shadowOpacity: 0.28, shadowRadius: 8 },
  }),
} as const

export const typography = {
  body: 'serif',
  mono: 'monospace',
} as const

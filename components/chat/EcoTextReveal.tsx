import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react'
import { Pressable, StyleSheet, Text } from 'react-native'

import { useMotion } from '@/hooks/useMotion'
import { colors, typography } from '@/components/ui/theme'

interface EcoTextRevealProps {
  animate: boolean
  onComplete: () => void
  text: string
}

function splitWords(text: string): string[] {
  return text.match(/\S+\s*/gu) ?? []
}

function endsSentence(value: string): boolean {
  return /[.!?…](?:[””'\])}]*)\s*$/u.test(value)
}

function naturalGroupSize(word: string, position: number): number {
  if (endsSentence(word)) return 1
  return 2 + (position % 4)
}

export function EcoTextReveal({ animate, onComplete, text }: EcoTextRevealProps): ReactElement {
  const { ecoRevealPreference, reducedMotion } = useMotion()
  const words = useMemo(() => splitWords(text), [text])
  const randomDelays = useRef<{ text: string; values: number[] }>({ text: '', values: [] })
  if (randomDelays.current.text !== text) {
    randomDelays.current = { text, values: words.map(() => 80 + Math.floor(Math.random() * 271)) }
  }
  const shouldAnimate = animate && !reducedMotion && words.length > 0
  const [visibleCount, setVisibleCount] = useState(shouldAnimate ? 0 : words.length)

  useEffect(() => {
    setVisibleCount(shouldAnimate ? 0 : words.length)
  }, [shouldAnimate, text, words.length])

  const complete = useCallback((): void => {
    setVisibleCount(words.length)
    onComplete()
  }, [onComplete, words.length])

  useEffect(() => {
    if (!shouldAnimate || visibleCount >= words.length) {
      if (visibleCount >= words.length) onComplete()
      return
    }

    const current = words[visibleCount] ?? ''
    const naturalCount = naturalGroupSize(current, visibleCount)
    const nextCount = ecoRevealPreference === 'natural'
      ? Math.min(words.length, visibleCount + naturalCount)
      : visibleCount + 1
    const baseDelay = ecoRevealPreference === 'natural'
      ? 35 + ((visibleCount * 17) % 41)
      : randomDelays.current.values[visibleCount] ?? 80
    const sentencePause = endsSentence(current) ? (ecoRevealPreference === 'natural' ? 160 : 250) : 0
    const maxDuration = ecoRevealPreference === 'natural' ? 3000 : 8000
    const scaledDelay = Math.min(baseDelay + sentencePause, Math.max(20, Math.floor(maxDuration / words.length)))
    const timer = setTimeout(() => setVisibleCount(nextCount), scaledDelay)
    return (): void => clearTimeout(timer)
  }, [ecoRevealPreference, onComplete, shouldAnimate, visibleCount, words])

  const completeText = words.slice(0, visibleCount).join('')
  const isComplete = visibleCount >= words.length

  return (
    <Pressable
      accessibilityHint={isComplete ? undefined : 'Completes Eco’s response immediately'}
      accessibilityLabel={text}
      accessibilityRole="text"
      onPress={isComplete ? undefined : complete}
      style={styles.pressable}
    >
      <Text style={styles.text}>{completeText}</Text>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  pressable: { alignSelf: 'flex-start' },
  text: { color: colors.text, fontFamily: typography.body, fontSize: 15, lineHeight: 26, marginBottom: 4 },
})

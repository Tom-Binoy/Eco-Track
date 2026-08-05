import { useEffect, useRef } from 'react'
import type { ReactElement } from 'react'
import { Animated, StyleSheet, View } from 'react-native'

import { colors } from '@/components/ui/theme'
import { useMotion } from '@/hooks/useMotion'

export function TypingIndicator(): ReactElement {
  const { reducedMotion, tokens } = useMotion()
  const firstOpacity = useRef(new Animated.Value(0.3)).current
  const secondOpacity = useRef(new Animated.Value(0.3)).current
  const thirdOpacity = useRef(new Animated.Value(0.3)).current

  useEffect(() => {
    if (reducedMotion) return
    const dots = [firstOpacity, secondOpacity, thirdOpacity]
    const animation = Animated.loop(
      Animated.sequence(
        dots.flatMap((dot) => [
          Animated.timing(dot, { duration: Math.round(tokens.ambient / 6), toValue: 1, useNativeDriver: true }),
          Animated.timing(dot, { duration: Math.round(tokens.ambient / 6), toValue: 0.3, useNativeDriver: true }),
        ]),
      ),
    )

    animation.start()

    return (): void => animation.stop()
  }, [firstOpacity, reducedMotion, secondOpacity, thirdOpacity, tokens.ambient])

  return (
    <View style={styles.row}>
      <View style={styles.bubble}>
        <Animated.View style={[styles.dot, { opacity: firstOpacity }]} />
        <Animated.View style={[styles.dot, { opacity: secondOpacity }]} />
        <Animated.View style={[styles.dot, { opacity: thirdOpacity }]} />
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  bubble: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 5,
    paddingVertical: 8,
  },
  dot: { backgroundColor: colors.faint, borderRadius: 3, height: 6, width: 6 },
  row: { alignItems: 'flex-start', width: '100%' },
})

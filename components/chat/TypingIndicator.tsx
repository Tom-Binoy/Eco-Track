import { useEffect, useRef } from 'react'
import type { ReactElement } from 'react'
import { Animated, StyleSheet, View } from 'react-native'

export function TypingIndicator(): ReactElement {
  const firstOpacity = useRef(new Animated.Value(0.3)).current
  const secondOpacity = useRef(new Animated.Value(0.3)).current
  const thirdOpacity = useRef(new Animated.Value(0.3)).current

  useEffect(() => {
    const dots = [firstOpacity, secondOpacity, thirdOpacity]
    const animation = Animated.loop(
      Animated.sequence(
        dots.flatMap((dot) => [
          Animated.timing(dot, { duration: 250, toValue: 1, useNativeDriver: true }),
          Animated.timing(dot, { duration: 250, toValue: 0.3, useNativeDriver: true }),
        ]),
      ),
    )

    animation.start()

    return (): void => animation.stop()
  }, [firstOpacity, secondOpacity, thirdOpacity])

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
  dot: { backgroundColor: '#696762', borderRadius: 3, height: 6, width: 6 },
  row: { alignItems: 'flex-start', width: '100%' },
})

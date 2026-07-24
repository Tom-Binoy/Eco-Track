import { useEffect } from 'react'
import type { ReactElement } from 'react'
import { StyleSheet, View } from 'react-native'
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedProps,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated'
import Svg, { Circle, Path } from 'react-native-svg'

export type EcoMarkMotionMode = 'breeze' | 'launch' | 'pulse'

interface EcoMarkMotionProps {
  mode: EcoMarkMotionMode
  runKey: number
}

const AnimatedCircle = Animated.createAnimatedComponent(Circle)
const AnimatedPath = Animated.createAnimatedComponent(Path)

const CORE_CENTER_X = 121
const CORE_CENTER_Y = 145
const MARK_SIZE = 244
const OUTER_PATH_LENGTH = 430

function makeOuterPath(flow: number): string {
  'worklet'

  const crestLift = flow * 3
  const crestDrift = flow * 2
  const rightTension = flow * 1.5

  return [
    'M 50 165',
    'C 27 143 27 95 60 79',
    `C 79 70 ${102 + crestDrift} ${69 - crestLift} ${116 + crestDrift} ${52 - crestLift}`,
    `C ${129 + crestDrift} ${37 - crestLift} ${141 + crestDrift} ${23 - crestLift} ${160 + crestDrift} ${22 - crestLift}`,
    `C ${186 + rightTension} ${20 + crestLift} ${207 + rightTension} ${37 + crestLift} ${207 + rightTension} ${74 + crestLift}`,
    `C ${207 + rightTension} ${117 + crestLift} ${187 + rightTension} ${156 + crestLift} 187 169`,
  ].join(' ')
}

export function EcoMarkMotion({ mode, runKey }: EcoMarkMotionProps): ReactElement {
  const coreOffset = useSharedValue(0)
  const flow = useSharedValue(0)
  const greenOpacity = useSharedValue(1)
  const greenScale = useSharedValue(1)
  const pathReveal = useSharedValue(1)

  useEffect(() => {
    cancelAnimation(coreOffset)
    cancelAnimation(flow)
    cancelAnimation(greenOpacity)
    cancelAnimation(greenScale)
    cancelAnimation(pathReveal)

    coreOffset.value = 0
    flow.value = 0
    greenOpacity.value = 1
    greenScale.value = 1
    pathReveal.value = 1

    if (mode === 'launch') {
      coreOffset.value = -112
      greenOpacity.value = 0
      greenScale.value = 0.92
      pathReveal.value = 0

      coreOffset.value = withSequence(
        withTiming(12, { duration: 340, easing: Easing.in(Easing.quad) }),
        withTiming(0, { duration: 270, easing: Easing.out(Easing.cubic) }),
      )
      greenOpacity.value = withDelay(340, withTiming(1, { duration: 130 }))
      greenScale.value = withDelay(340, withTiming(1, { duration: 170, easing: Easing.out(Easing.cubic) }))
      pathReveal.value = withDelay(560, withTiming(1, { duration: 470, easing: Easing.out(Easing.cubic) }))
      flow.value = withDelay(760, withSequence(withTiming(0.35, { duration: 280 }), withTiming(0, { duration: 460 })))
      return
    }

    if (mode === 'breeze') {
      coreOffset.value = withRepeat(
        withSequence(
          withTiming(-2.5, { duration: 4200, easing: Easing.inOut(Easing.sin) }),
          withTiming(2.5, { duration: 4200, easing: Easing.inOut(Easing.sin) }),
        ),
        -1,
        true,
      )
      flow.value = withRepeat(
        withSequence(
          withTiming(1, { duration: 4500, easing: Easing.inOut(Easing.sin) }),
          withTiming(-1, { duration: 4500, easing: Easing.inOut(Easing.sin) }),
        ),
        -1,
        true,
      )
      return
    }

    greenOpacity.value = withRepeat(
      withSequence(withTiming(0.64, { duration: 700 }), withTiming(1, { duration: 700 })),
      -1,
      true,
    )
    flow.value = withRepeat(
      withSequence(withTiming(0.85, { duration: 850, easing: Easing.inOut(Easing.quad) }), withTiming(0, { duration: 1050 })),
      -1,
      true,
    )
  }, [coreOffset, flow, greenOpacity, greenScale, mode, pathReveal, runKey])

  const coreProps = useAnimatedProps(() => ({ cy: CORE_CENTER_Y + coreOffset.value }))
  const outerPathProps = useAnimatedProps(() => ({
    d: makeOuterPath(flow.value),
    opacity: pathReveal.value,
    strokeDashoffset: OUTER_PATH_LENGTH * (1 - pathReveal.value),
  }))
  const greenPathProps = useAnimatedProps(() => ({ opacity: greenOpacity.value }))
  const greenStyle = useAnimatedStyle(() => ({ transform: [{ scaleX: greenScale.value }] }))

  return (
    <View style={styles.container}>
      <Animated.View style={[styles.greenGlow, greenStyle]} />
      <Svg height={MARK_SIZE} viewBox="0 0 240 240" width={MARK_SIZE}>
        <AnimatedPath
          animatedProps={outerPathProps}
          d={makeOuterPath(0)}
          fill="none"
          stroke="#eeeeee"
          strokeDasharray={`${OUTER_PATH_LENGTH} ${OUTER_PATH_LENGTH}`}
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={12}
        />
        <AnimatedPath
          animatedProps={greenPathProps}
          d="M 94 183 C 111 191 136 191 153 183"
          fill="none"
          stroke="#22c55e"
          strokeLinecap="round"
          strokeWidth={12}
        />
        <AnimatedCircle animatedProps={coreProps} cx={CORE_CENTER_X} cy={CORE_CENTER_Y} fill="#eeeeee" r={28} />
      </Svg>
    </View>
  )
}

const styles = StyleSheet.create({
  container: { alignItems: 'center', height: MARK_SIZE, justifyContent: 'center', width: MARK_SIZE },
  greenGlow: {
    backgroundColor: 'rgba(34, 197, 94, 0.17)',
    borderRadius: 70,
    bottom: 18,
    height: 50,
    position: 'absolute',
    width: 130,
  },
})

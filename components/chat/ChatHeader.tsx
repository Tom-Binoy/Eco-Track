import type { ReactElement } from 'react'
import { useRouter } from 'expo-router'
import type { Href } from 'expo-router'
import { Pressable, StyleSheet, Text, View } from 'react-native'

export function ChatHeader(): ReactElement {
  const router = useRouter()

  return (
    <View style={styles.container}>
      {__DEV__ ? (
        <Pressable
          accessibilityHint="Opens the development motion preview"
          accessibilityLabel="Open Eco motion lab"
          accessibilityRole="button"
          onLongPress={() => router.push('/(app)/motion-lab' as Href)}
          style={styles.avatar}
        >
          <Text style={styles.avatarLabel}>E</Text>
        </Pressable>
      ) : (
        <View style={styles.avatar}>
          <Text style={styles.avatarLabel}>E</Text>
        </View>
      )}
      <Text style={styles.title}>Today&apos;s Session</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  avatar: {
    alignItems: 'center',
    backgroundColor: '#3a3936',
    borderColor: '#22c55e',
    borderRadius: 19,
    borderWidth: 2,
    height: 38,
    justifyContent: 'center',
    left: 12,
    position: 'absolute',
    width: 38,
  },
  avatarLabel: { color: '#eeeeee', fontFamily: 'serif', fontSize: 13, fontStyle: 'italic', fontWeight: '700' },
  container: {
    alignItems: 'center',
    backgroundColor: '#2b2a27',
    borderBottomColor: 'rgba(255, 255, 255, 0.06)',
    borderBottomWidth: StyleSheet.hairlineWidth,
    height: 52,
    justifyContent: 'center',
  },
  title: { color: '#eeeeee', fontFamily: 'serif', fontSize: 14, fontWeight: '600', letterSpacing: 0.14 },
})

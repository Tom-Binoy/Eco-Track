import { useMutation } from 'convex/react'
import { useEffect, useState, type ReactElement } from 'react'
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

import { ScreenHeader } from '@/components/ui/ScreenHeader'
import { colors, shadows, typography } from '@/components/ui/theme'
import { api } from '@/convex/_generated/api'
import { useAuth } from '@/hooks/useAuth'

type ReportType = 'bug' | 'feature' | 'other'

export default function ProfileScreen(): ReactElement {
  const { profile, signOut } = useAuth()
  const updateUnits = useMutation(api.functions.profiles.updateUnits)
  const updateMotionPreferences = useMutation(api.functions.profiles.updateMotionPreferences)
  const submitReport = useMutation(api.functions.userReports.submit)
  const [distanceUnit, setDistanceUnit] = useState<'km' | 'miles'>('km')
  const [weightUnit, setWeightUnit] = useState<'kg' | 'lbs'>('kg')
  const [motionPreference, setMotionPreference] = useState<'responsive' | 'cinematic'>('responsive')
  const [ecoRevealPreference, setEcoRevealPreference] = useState<'natural' | 'random'>('natural')
  const [isSavingUnits, setIsSavingUnits] = useState(false)
  const [isSavingMotion, setIsSavingMotion] = useState(false)
  const [reportOpen, setReportOpen] = useState(false)
  const [reportText, setReportText] = useState('')
  const [reportType, setReportType] = useState<ReportType>('bug')
  const [reportStatus, setReportStatus] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  useEffect(() => {
    if (profile !== null && profile !== undefined) {
      setDistanceUnit(profile.distanceUnit)
      setWeightUnit(profile.weightUnit)
      setMotionPreference(profile.motionPreference ?? 'responsive')
      setEcoRevealPreference(profile.ecoRevealPreference ?? 'natural')
    }
  }, [profile])

  const saveUnits = async (nextWeight: 'kg' | 'lbs', nextDistance: 'km' | 'miles'): Promise<void> => {
    setIsSavingUnits(true)
    const result = await updateUnits({ distanceUnit: nextDistance, weightUnit: nextWeight })
    if (!('error' in result)) {
      setDistanceUnit(nextDistance)
      setWeightUnit(nextWeight)
    }
    setIsSavingUnits(false)
  }

  const saveMotion = async (nextMotion: 'responsive' | 'cinematic', nextReveal: 'natural' | 'random'): Promise<void> => {
    setIsSavingMotion(true)
    const result = await updateMotionPreferences({ ecoRevealPreference: nextReveal, motionPreference: nextMotion })
    if (!('error' in result)) {
      setMotionPreference(nextMotion)
      setEcoRevealPreference(nextReveal)
    }
    setIsSavingMotion(false)
  }

  const sendReport = async (): Promise<void> => {
    setIsSubmitting(true)
    setReportStatus(null)
    const result = await submitReport({ message: reportText, type: reportType })
    if ('error' in result) setReportStatus(result.error ?? 'Could not send feedback')
    else {
      setReportStatus('Thanks — your feedback was sent.')
      setReportText('')
    }
    setIsSubmitting(false)
  }

  const initials = (profile?.name ?? 'Athlete').split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase()

  return (
    <SafeAreaView edges={['top', 'bottom']} style={styles.safeArea}>
      <ScreenHeader back title="Settings" />
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.profileCard}>
          <View style={styles.avatar}><Text style={styles.avatarText}>{initials}</Text></View>
          <Text style={styles.name}>{profile?.name ?? 'Athlete'}</Text>
          <Text style={styles.companion}>Training with Eco</Text>
        </View>

        <Text style={styles.sectionLabel}>Preferences</Text>
        <View style={styles.group}>
          <View style={styles.row}>
            <View style={styles.icon}><Text>⚖️</Text></View>
            <Text style={styles.rowTitle}>Weight unit</Text>
            <View style={styles.segment}>
              {(['kg', 'lbs'] as const).map((unit) => <Pressable key={unit} disabled={isSavingUnits} onPress={() => void saveUnits(unit, distanceUnit)} style={[styles.segmentButton, weightUnit === unit && styles.segmentSelected]}><Text style={[styles.segmentText, weightUnit === unit && styles.segmentTextSelected]}>{unit}</Text></Pressable>)}
            </View>
          </View>
          <View style={styles.row}>
            <View style={styles.icon}><Text>↔️</Text></View>
            <Text style={styles.rowTitle}>Distance unit</Text>
            <View style={styles.segment}>
              {(['km', 'miles'] as const).map((unit) => <Pressable key={unit} disabled={isSavingUnits} onPress={() => void saveUnits(weightUnit, unit)} style={[styles.segmentButton, distanceUnit === unit && styles.segmentSelected]}><Text style={[styles.segmentText, distanceUnit === unit && styles.segmentTextSelected]}>{unit}</Text></Pressable>)}
            </View>
          </View>
        </View>
        {isSavingUnits ? <ActivityIndicator color={colors.accent} style={styles.saving} /> : null}

        <Text style={styles.sectionLabel}>Experience</Text>
        <View style={styles.group}>
          <View style={styles.row}>
            <View style={styles.icon}><Text>◌</Text></View>
            <View style={styles.rowMain}><Text style={styles.rowTitle}>Motion pace</Text><Text style={styles.rowSub}>Choose the feel of transitions</Text></View>
            <View style={styles.segment}>
              {(['responsive', 'cinematic'] as const).map((preference) => <Pressable key={preference} disabled={isSavingMotion} onPress={() => void saveMotion(preference, ecoRevealPreference)} style={[styles.segmentButton, styles.wideSegmentButton, motionPreference === preference && styles.segmentSelected]}><Text style={[styles.segmentText, motionPreference === preference && styles.segmentTextSelected]}>{preference}</Text></Pressable>)}
            </View>
          </View>
          <View style={styles.row}>
            <View style={styles.icon}><Text>✦</Text></View>
            <View style={styles.rowMain}><Text style={styles.rowTitle}>Eco reply rhythm</Text><Text style={styles.rowSub}>How new replies appear</Text></View>
            <View style={styles.segment}>
              {(['natural', 'random'] as const).map((preference) => <Pressable key={preference} disabled={isSavingMotion} onPress={() => void saveMotion(motionPreference, preference)} style={[styles.segmentButton, styles.wideSegmentButton, ecoRevealPreference === preference && styles.segmentSelected]}><Text style={[styles.segmentText, ecoRevealPreference === preference && styles.segmentTextSelected]}>{preference}</Text></Pressable>)}
            </View>
          </View>
        </View>
        {isSavingMotion ? <ActivityIndicator color={colors.accent} style={styles.saving} /> : null}

        <Text style={styles.sectionLabel}>Support</Text>
        <View style={styles.group}>
          <Pressable accessibilityRole="button" onPress={() => { setReportStatus(null); setReportOpen(true) }} style={({ pressed }) => [styles.row, pressed && styles.pressed]}>
            <View style={styles.icon}><Text>✎</Text></View>
            <View style={styles.rowMain}><Text style={styles.rowTitle}>Report a bug or share feedback</Text><Text style={styles.rowSub}>Help shape Eco Track</Text></View>
            <Text style={styles.chevron}>›</Text>
          </Pressable>
        </View>

        <Pressable accessibilityRole="button" onPress={() => void signOut()} style={({ pressed }) => [styles.signOut, pressed && styles.pressed]}><Text style={styles.signOutText}>Sign out</Text></Pressable>
        <Text style={styles.version}>Eco Track · development build</Text>
      </ScrollView>

      <Modal animationType="slide" onRequestClose={() => setReportOpen(false)} transparent visible={reportOpen}>
        <View style={styles.modalRoot}>
          <Pressable accessibilityLabel="Close feedback" onPress={() => setReportOpen(false)} style={styles.backdrop} />
          <View style={styles.sheet}>
            <View style={styles.handle} />
            <Text style={styles.sheetKicker}>Tell us what happened</Text>
            <Text style={styles.sheetTitle}>Feedback</Text>
            <View style={styles.typeRow}>
              {(['bug', 'feature', 'other'] as const).map((type) => <Pressable key={type} onPress={() => setReportType(type)} style={[styles.typeButton, reportType === type && styles.typeSelected]}><Text style={[styles.typeText, reportType === type && styles.typeTextSelected]}>{type}</Text></Pressable>)}
            </View>
            <TextInput
              keyboardAppearance="dark"
              maxLength={4000}
              multiline
              onChangeText={setReportText}
              placeholder="A few details will help us understand it."
              placeholderTextColor={colors.textMuted}
              style={styles.reportInput}
              textAlignVertical="top"
              value={reportText}
            />
            {reportStatus !== null ? <Text style={reportStatus.startsWith('Thanks') ? styles.success : styles.error}>{reportStatus}</Text> : null}
            <Pressable disabled={isSubmitting || reportText.trim().length < 3} onPress={() => void sendReport()} style={[styles.submit, (isSubmitting || reportText.trim().length < 3) && styles.disabled]}><Text style={styles.submitText}>{isSubmitting ? 'Sending…' : 'Send feedback'}</Text></Pressable>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  avatar: { alignItems: 'center', backgroundColor: colors.surfaceRaised, borderRadius: 33, height: 66, justifyContent: 'center', width: 66 },
  avatarText: { color: colors.text, fontFamily: typography.body, fontSize: 20, fontWeight: '700' },
  backdrop: { ...StyleSheet.absoluteFill },
  chevron: { color: colors.faint, fontFamily: typography.body, fontSize: 20 },
  companion: { color: colors.textMuted, fontFamily: typography.body, fontSize: 12, marginTop: 3 },
  content: { padding: 16, paddingBottom: 40 },
  disabled: { opacity: 0.5 },
  error: { color: '#fca5a5', fontFamily: typography.body, fontSize: 12, marginBottom: 8 },
  group: { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: 13, borderWidth: 1, overflow: 'hidden', ...shadows.card },
  handle: { alignSelf: 'center', backgroundColor: colors.faint, borderRadius: 2, height: 4, marginBottom: 18, width: 36 },
  icon: { alignItems: 'center', backgroundColor: 'rgba(34, 197, 94, 0.07)', borderRadius: 8, height: 30, justifyContent: 'center', width: 30 },
  modalRoot: { backgroundColor: 'rgba(0, 0, 0, 0.58)', flex: 1, justifyContent: 'flex-end', padding: 12 },
  name: { color: colors.text, fontFamily: typography.body, fontSize: 18, fontWeight: '600', marginTop: 13 },
  pressed: { opacity: 0.72 },
  profileCard: { alignItems: 'center', backgroundColor: colors.surface, borderColor: colors.border, borderRadius: 14, borderWidth: 1, padding: 21, ...shadows.card },
  reportInput: { backgroundColor: colors.inset, borderColor: colors.border, borderRadius: 12, borderWidth: 1, color: colors.text, fontFamily: typography.body, fontSize: 14, lineHeight: 21, marginBottom: 10, minHeight: 130, padding: 13 },
  row: { alignItems: 'center', borderBottomColor: colors.border, borderBottomWidth: StyleSheet.hairlineWidth, flexDirection: 'row', gap: 11, minHeight: 60, paddingHorizontal: 14, paddingVertical: 10 },
  rowMain: { flex: 1 },
  rowSub: { color: colors.textMuted, fontFamily: typography.body, fontSize: 11, marginTop: 3 },
  rowTitle: { color: colors.text, flex: 1, fontFamily: typography.body, fontSize: 14, fontWeight: '600' },
  safeArea: { backgroundColor: colors.background, flex: 1 },
  saving: { marginTop: 9 },
  sectionLabel: { color: colors.faint, fontFamily: typography.body, fontSize: 9, fontWeight: '700', letterSpacing: 1.4, marginBottom: 9, marginTop: 21, textTransform: 'uppercase' },
  segment: { backgroundColor: colors.inset, borderRadius: 8, flexDirection: 'row', padding: 3 },
  segmentButton: { alignItems: 'center', borderRadius: 6, justifyContent: 'center', minHeight: 32, minWidth: 44, paddingHorizontal: 8 },
  wideSegmentButton: { minWidth: 0, paddingHorizontal: 7 },
  segmentSelected: { backgroundColor: colors.accent },
  segmentText: { color: colors.textMuted, fontFamily: typography.body, fontSize: 11, fontWeight: '600', textTransform: 'uppercase' },
  segmentTextSelected: { color: '#ffffff' },
  sheet: { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: 20, borderWidth: 1, padding: 20, ...shadows.card },
  sheetKicker: { color: colors.faint, fontFamily: typography.body, fontSize: 10, fontWeight: '700', letterSpacing: 1.2, textTransform: 'uppercase' },
  sheetTitle: { color: colors.text, fontFamily: typography.body, fontSize: 28, fontWeight: '500', marginBottom: 16 },
  signOut: { alignItems: 'center', backgroundColor: 'rgba(239, 68, 68, 0.045)', borderColor: 'rgba(239, 68, 68, 0.20)', borderRadius: 10, borderWidth: 1, justifyContent: 'center', marginTop: 22, minHeight: 48 },
  signOutText: { color: colors.dangerMuted, fontFamily: typography.body, fontSize: 13, fontWeight: '600' },
  submit: { alignItems: 'center', backgroundColor: colors.accent, borderRadius: 10, justifyContent: 'center', minHeight: 48, ...shadows.glow },
  submitText: { color: '#ffffff', fontFamily: typography.body, fontSize: 14, fontWeight: '700' },
  success: { color: colors.accentMuted, fontFamily: typography.body, fontSize: 12, marginBottom: 8 },
  typeButton: { alignItems: 'center', borderColor: colors.border, borderRadius: 9, borderWidth: 1, flex: 1, justifyContent: 'center', minHeight: 40 },
  typeRow: { flexDirection: 'row', gap: 7, marginBottom: 11 },
  typeSelected: { backgroundColor: colors.accent, borderColor: colors.accent },
  typeText: { color: colors.textMuted, fontFamily: typography.body, fontSize: 11, fontWeight: '600', textTransform: 'capitalize' },
  typeTextSelected: { color: '#ffffff' },
  version: { color: colors.faint, fontFamily: typography.body, fontSize: 10, marginTop: 14, textAlign: 'center' },
})

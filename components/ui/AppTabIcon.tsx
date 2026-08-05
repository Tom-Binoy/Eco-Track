import type { ReactElement } from 'react'
import type { ColorValue } from 'react-native'
import Svg, { Path } from 'react-native-svg'

export type AppTabName = 'chat' | 'history' | 'report'

interface AppTabIconProps {
  color: ColorValue
  name: AppTabName
}

const paths: Record<AppTabName, string> = {
  chat: 'M5 18.5 3 21v-5.2A8 8 0 1 1 6.2 19H5Z',
  history: 'M7 4h10M7 8h10M6 3v18h12V3M9 13h6M9 17h4',
  report: 'M4 20h16M6 17V9h3v8m3 0V4h3v13m3 0v-5h2v5',
}

export function AppTabIcon({ color, name }: AppTabIconProps): ReactElement {
  return (
    <Svg height={20} viewBox="0 0 24 24" width={20}>
      <Path d={paths[name]} fill="none" stroke={color} strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} />
    </Svg>
  )
}

import i18next from 'i18next'
import { Trans } from 'react-i18next'


export function renderLabel(key: string) {
  return <Trans i18nKey={key} />
}

export function RenderProp({ key }: { key: string }) {
  return <Trans i18nKey={key} />
}

export function translate(key: string) {
  return i18next.t(key)
}

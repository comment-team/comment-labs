import i18next from 'i18next'
import { Trans, useTranslation } from 'react-i18next'


export function App({ value }: { value: 'one' | 'two' }) {
  const { t: tSection } = useTranslation('translation', { keyPrefix: 'section' })
  const { t: tCommon } = useTranslation('translation', { keyPrefix: 'common' })
  const formatLabel = (id: string) => `${tCommon('ok')} ${id}`

  return (
    <>
      <h1>{tSection('title')}</h1>
      <p>{tSection(`dynamic.${value}` as string)}</p>
      <p>{tSection('concat.' + value)}</p>
      <p>{tCommon('ok')}</p>
      <p>{formatLabel(value)}</p>
      <Trans i18nKey="common.ok" />
      <p>{i18next.t('unused')}</p>
    </>
  )
}

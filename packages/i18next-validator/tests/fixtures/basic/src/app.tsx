import { useTranslation } from 'react-i18next'


export function App() {
  const { t } = useTranslation()

  return (
    <div>
      <h1>{t('home.title')}</h1>
      <p>{t(`errors.${getErrorCode()}`)}</p>
    </div>
  )
}

function getErrorCode(): string {
  return 'required'
}
